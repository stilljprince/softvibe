// app/api/billing/checkout/route.ts
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { jsonOk, jsonError, readJsonSafe, requireAuth } from "@/lib/api";
import { classifySubscriptionStatus } from "@/lib/entitlement/stripe-plan-mapping";

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

type SubscriptionGuardResult =
  // Subscription is still active/trialing or otherwise payment-relevant
  // (past_due, incomplete, paused). None of these represent an
  // unambiguously ended claim — keep blocking new checkouts.
  | { outcome: "BLOCK" }
  // Subscription is unambiguously ended or gone (deleted/resource_missing,
  // canceled, unpaid, incomplete_expired). Safe to clear and allow a new
  // checkout.
  | { outcome: "STALE" }
  // Stripe could not be reached or returned an unexpected error. Fail
  // closed: do not touch local state, do not allow a new checkout.
  | { outcome: "STRIPE_UNAVAILABLE"; reason: string }
  // Stripe returned a subscription status with no defined checkout-guard
  // semantics (unknown or introduced after this guard was written). Fail
  // closed exactly like STRIPE_UNAVAILABLE: do not touch local state, do
  // not allow a new checkout.
  | { outcome: "UNKNOWN_STATUS"; status: string };

/**
 * Resolve whether an existing local stripeSubscriptionId still represents
 * an active claim at Stripe. Reuses classifySubscriptionStatus for the
 * unambiguous SYNC_PAID / KEEP_PAID_UPDATE_PERIOD / DOWNGRADE_FREE buckets
 * so the guard never diverges from the webhook's own status semantics
 * (F-009). classifySubscriptionStatus() collapses "incomplete", "paused",
 * and any unknown/future status into a single conservative NO_CHANGE
 * bucket — correct for the webhook sync, but too coarse for a checkout
 * guard, which must keep blocking known non-terminal statuses
 * (incomplete/paused) while failing closed on genuinely unrecognized ones
 * instead of treating them as stale.
 */
async function resolveExistingSubscriptionGuard(
  subscriptionId: string
): Promise<SubscriptionGuardResult> {
  let subscription: Stripe.Subscription;

  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (err) {
    if (
      err instanceof Stripe.errors.StripeInvalidRequestError &&
      err.code === "resource_missing"
    ) {
      return { outcome: "STALE" };
    }

    const reason = err instanceof Error ? err.message : "Unknown error";
    return { outcome: "STRIPE_UNAVAILABLE", reason };
  }

  const status = subscription.status;
  const action = classifySubscriptionStatus(status);

  if (action === "SYNC_PAID" || action === "KEEP_PAID_UPDATE_PERIOD") {
    return { outcome: "BLOCK" };
  }

  if (action === "DOWNGRADE_FREE") {
    return { outcome: "STALE" };
  }

  // action === "NO_CHANGE": disambiguate the collapsed bucket ourselves.
  if (status === "incomplete" || status === "paused") {
    return { outcome: "BLOCK" };
  }

  return { outcome: "UNKNOWN_STATUS", status: status ?? "unknown" };
}

/**
 * Clears a stale local subscription reference. Mirrors the exact same
 * database semantics as resetUserToFree() in the Stripe webhook handler
 * (customer.subscription.deleted) — intentionally not a second, diverging
 * reset implementation.
 */
async function resetStaleLocalSubscription(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      plan: "FREE",
      planPeriodStart: null,
      planPeriodEnd: null,
      stripeSubscriptionId: null,
    },
  });
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
  //    Eine lokal vorhandene stripeSubscriptionId wird serverseitig gegen
  //    den tatsächlichen Stripe-Status geprüft, statt sie nur auf
  //    Truthiness zu prüfen. Eine stale/gelöschte/inaktive Referenz darf
  //    einen neuen Checkout nicht dauerhaft blockieren (F-009).
  if (user.stripeSubscriptionId) {
    const guard = await resolveExistingSubscriptionGuard(
      user.stripeSubscriptionId
    );

    if (guard.outcome === "STRIPE_UNAVAILABLE") {
      console.error(
        "[billing/checkout] Stripe-Subscription-Status konnte nicht geklärt werden — Checkout wird fail-closed abgelehnt",
        { userId: user.id, subscriptionId: user.stripeSubscriptionId, reason: guard.reason }
      );
      return jsonError("SUBSCRIPTION_STATUS_UNAVAILABLE", 503, {
        message:
          "Dein Abonnement-Status konnte momentan nicht geprüft werden. Bitte versuche es in Kürze erneut.",
      });
    }

    if (guard.outcome === "UNKNOWN_STATUS") {
      console.error(
        "[billing/checkout] Unbekannter Stripe-Subscription-Status — Checkout wird fail-closed abgelehnt",
        { userId: user.id, subscriptionId: user.stripeSubscriptionId, status: guard.status }
      );
      return jsonError("SUBSCRIPTION_STATUS_UNAVAILABLE", 503, {
        message:
          "Dein Abonnement-Status konnte momentan nicht geprüft werden. Bitte versuche es in Kürze erneut.",
      });
    }

    if (guard.outcome === "BLOCK") {
      return jsonError("ALREADY_SUBSCRIBED", 400, {
        message:
          "Du hast bereits ein aktives Abonnement. Bitte verwalte es im Account- oder Billing-Bereich.",
      });
    }

    // guard.outcome === "STALE" → lokale Referenz bereinigen und normal
    // mit der Checkout-Erstellung fortfahren.
    await resetStaleLocalSubscription(user.id);
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
