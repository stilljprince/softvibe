// lib/entitlement-view.ts
//
// Small, client-safe structural type describing the resolved-entitlement
// snapshot as it appears on the read side of the API (JSON payload from
// /api/account/summary) and when passed from the Account server component
// into the Account client component.
//
// This file intentionally lives OUTSIDE lib/entitlement/** so that it never
// pulls Prisma / server-only modules into a client bundle. It is a pure
// type module. Keep it minimal — only the fields consumed by Generate and
// Account UI are declared here.

export type EntitlementPlanView = "FREE" | "STARTER" | "PREMIUM";

export type EntitlementsView = {
  plan: EntitlementPlanView;
  monthlyMinutes: {
    allowance: number;
    used: number;
    reserved: number;
    remaining: number;
  };
  probes: {
    lifetimeLimit: number;
    used: number;
    remaining: number;
    canUse: boolean;
  };
  library: {
    hasDirectAccess: boolean;
  };
};

// Pure human-readable label for the visible plan pill. Sourced from the
// resolved entitlement snapshot (the effective plan), never from a Stripe
// Price ID — a paid subscription whose billing period has already elapsed
// resolves to FREE server-side and MUST render as "Free" here.
export function labelFromEntitlementPlan(plan: EntitlementPlanView): string {
  switch (plan) {
    case "STARTER":
      return "Starter";
    case "PREMIUM":
      return "Premium";
    case "FREE":
    default:
      return "Free";
  }
}

// Gates the Stripe status decoration (aktiv / gekündigt / inaktiv) so that
// it can only accompany the visible plan label when the effective plan is
// paid. A user whose paid billing period has elapsed resolves to FREE but
// may still carry a Stripe subscription reporting active — attaching that
// status would render "Free · aktiv", which is misleading. Returning null
// suppresses the decoration; hasSubscription and the Customer Portal are
// intentionally unaffected.
export function resolveVisiblePlanStatus(
  plan: EntitlementPlanView,
  stripeStatusLabel: string | null
): string | null {
  if (!stripeStatusLabel) return null;
  if (plan === "STARTER" || plan === "PREMIUM") return stripeStatusLabel;
  return null;
}
