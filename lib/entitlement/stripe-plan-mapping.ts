// lib/entitlement/stripe-plan-mapping.ts
//
// Small mapping helper (RP-010 Phase 2B-2).
//
// Translates a Stripe subscription context (Price ID, and best-effort
// metadata plan string) into the local Plan enum used by the Entitlement
// Resolver. Strictly a lookup — no I/O, no side effects, no enforcement.
//
// Price-ID lookup is authoritative when configured. Metadata is used only as
// a fallback for older sessions where a Price-ID env mapping is not
// available. Any input that cannot be mapped resolves to `null` so the
// webhook can decide to leave the persisted plan untouched.
//
// This helper is intentionally not aware of Checkout / one-time payments —
// those flows credit the legacy Credits column and must NOT change Plan.
// The webhook only invokes this helper when a Stripe Subscription is
// present.
//
// Env conventions supported for Price-ID mapping:
//   STRIPE_PRICE_STARTER  → STARTER
//   STRIPE_PRICE_PREMIUM  → PREMIUM
//   STRIPE_PRICE_PRO      → PREMIUM  (legacy tier consolidated into PREMIUM)
//   STRIPE_PRICE_ULTRA    → PREMIUM  (legacy tier consolidated into PREMIUM)
//
// Metadata fallback (session.metadata.plan / subscription.metadata.plan):
//   "starter"                        → STARTER
//   "premium" | "pro" | "ultra"      → PREMIUM
//
// Everything else → null.

import { Plan } from "@prisma/client";
import type Stripe from "stripe";

function readEnv(name: string): string | null {
  const value = process.env[name];
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Map a Stripe Price-ID to a local Plan. Returns null when no configured
 * env mapping matches the given id.
 */
export function mapStripePriceIdToPlan(
  priceId: string | null | undefined
): Plan | null {
  if (!priceId) return null;

  const starter = readEnv("STRIPE_PRICE_STARTER");
  if (starter && priceId === starter) return "STARTER";

  const premium = readEnv("STRIPE_PRICE_PREMIUM");
  if (premium && priceId === premium) return "PREMIUM";

  const pro = readEnv("STRIPE_PRICE_PRO");
  if (pro && priceId === pro) return "PREMIUM";

  const ultra = readEnv("STRIPE_PRICE_ULTRA");
  if (ultra && priceId === ultra) return "PREMIUM";

  return null;
}

/**
 * Map a raw Stripe metadata plan string to a local Plan. Best-effort
 * fallback for cases where the Price-ID env mapping is missing.
 */
export function mapMetadataPlanToPlan(
  rawPlan: string | null | undefined
): Plan | null {
  if (!rawPlan) return null;
  const normalized = rawPlan.trim().toLowerCase();
  if (normalized === "starter") return "STARTER";
  if (normalized === "premium") return "PREMIUM";
  if (normalized === "pro" || normalized === "ultra") return "PREMIUM";
  return null;
}

/**
 * Discrete sync action a webhook handler should apply for a Stripe
 * subscription, based on its status. Pure — the caller performs the DB
 * write; this function never touches Stripe or Prisma.
 *
 * Semantics (RP-010 Phase 2B-2, CEO decision Option C):
 *
 *   SYNC_PAID
 *     Adopt / refresh the paid plan from Price-ID or metadata and store
 *     the current billing period. Applies to fully active subscriptions.
 *
 *   KEEP_PAID_UPDATE_PERIOD
 *     Payment failed but the current billing period is not yet over.
 *     The user must keep their existing paid plan until planPeriodEnd —
 *     only refresh the period boundaries. No grace-period timer added.
 *     Applies to past_due.
 *
 *   DOWNGRADE_FREE
 *     Subscription is unambiguously no longer usable. Plan is reset to
 *     FREE and the billing period is cleared. Applies to unpaid,
 *     incomplete_expired, canceled.
 *
 *   NO_CHANGE
 *     Conservative fallback for statuses that must NOT flip a user into
 *     a paid plan and must NOT extend an existing paid plan artificially.
 *     Applies to incomplete, paused, and any unknown / future value the
 *     Stripe API might return.
 */
export type SubscriptionSyncAction =
  | "SYNC_PAID"
  | "KEEP_PAID_UPDATE_PERIOD"
  | "DOWNGRADE_FREE"
  | "NO_CHANGE";

export function classifySubscriptionStatus(
  status: string | null | undefined
): SubscriptionSyncAction {
  switch (status) {
    case "active":
    case "trialing":
      return "SYNC_PAID";

    case "past_due":
      return "KEEP_PAID_UPDATE_PERIOD";

    case "unpaid":
    case "incomplete_expired":
    case "canceled":
      return "DOWNGRADE_FREE";

    // Conservative: never activate paid, never extend paid.
    case "incomplete":
    case "paused":
      return "NO_CHANGE";

    default:
      return "NO_CHANGE";
  }
}

/**
 * Derive the local Plan for a Stripe subscription. Uses Price-ID mapping
 * first, falls back to subscription metadata. Returns null when no
 * mapping is available — the caller should then leave the persisted plan
 * untouched rather than guess.
 */
export function derivePlanFromSubscription(
  sub: Stripe.Subscription
): Plan | null {
  const firstItem = sub.items?.data?.[0];
  const priceId = firstItem?.price?.id ?? null;

  const byPrice = mapStripePriceIdToPlan(priceId);
  if (byPrice) return byPrice;

  const metaPlan =
    typeof sub.metadata?.plan === "string" ? sub.metadata.plan : null;
  return mapMetadataPlanToPlan(metaPlan);
}

/**
 * Extract the current billing period for a Stripe subscription. In the
 * current Stripe API version (2025-10-29.clover) these live on the first
 * subscription item, not on the subscription root. Defensive: any missing
 * or non-finite value yields `null` for that boundary — never throws.
 */
export function extractBillingPeriod(sub: Stripe.Subscription): {
  start: Date | null;
  end: Date | null;
} {
  const firstItem = sub.items?.data?.[0];
  const startSec = firstItem?.current_period_start;
  const endSec = firstItem?.current_period_end;

  const start =
    typeof startSec === "number" && Number.isFinite(startSec)
      ? new Date(startSec * 1000)
      : null;
  const end =
    typeof endSec === "number" && Number.isFinite(endSec)
      ? new Date(endSec * 1000)
      : null;

  return { start, end };
}
