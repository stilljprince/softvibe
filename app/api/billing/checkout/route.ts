// app/api/billing/checkout/route.ts
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { jsonOk, jsonError, readJsonSafe, requireAuth } from "@/lib/api";

export const runtime = "nodejs";

// Only the two MVP plans are purchasable. The server — never the client —
// resolves the Stripe Price ID.
type PlanId = "starter" | "premium";

type CheckoutBody = {
  plan?: unknown;
};

// Canonical server-side mapping. Any purchasable plan added here must have a
// matching STRIPE_PRICE_<PLAN> env var configured in the deployment target.
const PLAN_ENV_KEY: Record<PlanId, string> = {
  starter: "STRIPE_PRICE_STARTER",
  premium: "STRIPE_PRICE_PREMIUM",
};

function isPurchasablePlan(value: unknown): value is PlanId {
  return value === "starter" || value === "premium";
}

function getBaseUrl(): string {
  // In Dev bevorzugt localhost/NEXTAUTH_URL
  if (process.env.NODE_ENV !== "production") {
    if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL;
    return "http://localhost:3000";
  }

  // In Production:
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL;
  return "http://localhost:3000";
}

export async function POST(req: Request): Promise<Response> {
  // 🔐 Auth
  const auth = await requireAuth();
  if (!auth) {
    return jsonError("UNAUTHORIZED", 401, { message: "Bitte einloggen." });
  }

  const userId = auth.userId;
  const body = (await readJsonSafe<CheckoutBody>(req)) ?? {};

  // 🎯 Plan validieren — Server bestimmt den Stripe-Price ausschließlich
  //    selbst. Client-Preis-IDs oder abweichende Modi werden nicht akzeptiert.
  if (!isPurchasablePlan(body.plan)) {
    return jsonError("INVALID_PLAN", 400, {
      message:
        "Ungültiger Plan. Es können ausschließlich Starter oder Premium gewählt werden.",
    });
  }
  const plan: PlanId = body.plan;

  const priceId = process.env[PLAN_ENV_KEY[plan]];
  if (!priceId || priceId.trim() === "") {
    console.error(
      "[billing/checkout] Serverseitige Stripe-Price-Konfiguration fehlt",
      { plan, envKey: PLAN_ENV_KEY[plan] }
    );
    return jsonError("PLAN_NOT_CONFIGURED", 500, {
      message: "Der gewählte Plan ist momentan nicht verfügbar.",
    });
  }

  // 👤 User laden
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      isAdmin: true,
    },
  });

  if (!user) {
    return jsonError("USER_NOT_FOUND", 404, { message: "User nicht gefunden." });
  }

  // Admins brauchen keinen Checkout
  if (user.isAdmin) {
    return jsonError("ADMIN_NO_CHECKOUT", 400, {
      message: "Admin-Accounts benötigen kein kostenpflichtiges Abonnement.",
    });
  }

  // 🚫 Doppeltes Abo verhindern — Starter/Premium sind reine Subscriptions.
  if (user.stripeSubscriptionId) {
    return jsonError("ALREADY_SUBSCRIBED", 400, {
      message:
        "Du hast bereits ein aktives Abonnement. Bitte verwalte es im Account- oder Billing-Bereich.",
    });
  }

  // 👛 Stripe-Customer sicherstellen
  let customerId = user.stripeCustomerId ?? undefined;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name ?? undefined,
      metadata: { appUserId: user.id },
    });

    customerId = customer.id;

    await prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: customerId },
    });
  }

  const baseUrl = getBaseUrl();

  // 💳 Checkout-Session erstellen — immer als Subscription.
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    metadata: {
      userId: user.id,
      plan,
    },
    subscription_data: {
      metadata: {
        userId: user.id,
        plan,
      },
    },
    success_url: `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}&plan=${plan}`,
    cancel_url: `${baseUrl}/billing?canceled=1`,
  });

  if (!session.url) {
    return jsonError("NO_SESSION_URL", 500, {
      message: "Konnte keine Stripe-Checkout-URL erzeugen.",
    });
  }

  // 🚀 Frontend kann auf session.url redirecten
  return jsonOk(
    {
      url: session.url,
      sessionId: session.id,
      plan,
      mode: "subscription" as const,
    },
    200
  );
}
