// app/api/billing/checkout/route.ts
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { jsonOk, jsonError, readJsonSafe, requireAuth } from "@/lib/api";

export const runtime = "nodejs";

type PlanId = "starter" | "pro" | "ultra";

type CheckoutBody = {
  plan?: PlanId;
  priceId?: string;
  mode?: "payment" | "subscription";
};

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
function resolvePriceId(body: CheckoutBody): { priceId: string; plan: PlanId | null } | null {
  // 1) explizit vom Client geschickt?
  if (body.priceId && body.priceId.trim() !== "") {
    return { priceId: body.priceId.trim(), plan: body.plan ?? null };
  }

  // 2) Plan → env
  const plan: PlanId = body.plan ?? "starter";

  const envKey =
    plan === "starter"
      ? "STRIPE_PRICE_STARTER"
      : plan === "pro"
      ? "STRIPE_PRICE_PRO"
      : "STRIPE_PRICE_ULTRA";

  const fromEnv = process.env[envKey];
  if (!fromEnv) return null;

  return { priceId: fromEnv, plan };
}

export async function POST(req: Request): Promise<Response> {
  // 🔐 Auth
  const auth = await requireAuth();
  if (!auth) {
    return jsonError("UNAUTHORIZED", 401, { message: "Bitte einloggen." });
  }

  const userId = auth.userId;
  const body = (await readJsonSafe<CheckoutBody>(req)) ?? {};

  // 🎯 Price bestimmen
  const resolved = resolvePriceId(body);
  if (!resolved) {
    return jsonError("MISSING_PRICE", 400, {
      message: "Kein gültiger Plan/Price konfiguriert.",
    });
  }
  const { priceId, plan } = resolved;

  // 💳 Mode (Zahlart): default payment
  const mode: "payment" | "subscription" =
    body.mode === "subscription" ? "subscription" : "payment";

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
      message: "Admin-Accounts benötigen keinen Kauf von Credits.",
    });
  }

// 🚫 Doppeltes Abo verhindern
  if (mode === "subscription" && user.stripeSubscriptionId) {
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

  // 💳 Checkout-Session erstellen
  const isSubscription = mode === "subscription";

  const session = await stripe.checkout.sessions.create({
    mode,
    customer: customerId,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    metadata: {
      userId: user.id,
      plan: plan ?? "",
    },
    ...(isSubscription
      ? {
          subscription_data: {
            metadata: {
              userId: user.id,
              plan: plan ?? "",
            },
          },
        }
      : {}),
    success_url: `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}&plan=${plan ?? ""}`,
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
      plan: plan ?? null,
      mode,
    },
    200
  );
}