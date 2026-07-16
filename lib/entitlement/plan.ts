// lib/entitlement/plan.ts
//
// Central plan catalog (RP-010 Phase 2B-1, read side).
//
// Single source of truth for the product-level limits of every Plan tier.
// Consumed only by the read-only Entitlement Resolver in this phase; no
// enforcement, no Stripe wiring, no UI wiring. Stripe Price-ID mapping is
// intentionally kept out of this file — it belongs to a later Stripe-specific
// phase to avoid coupling the catalog to billing.

import { Plan } from "@prisma/client";

/** Lifetime cap on Free Probe Generations. Applies to FREE only. */
export const PROBE_LIFETIME_LIMIT = 2;

export type PlanConfig = {
  /** Custom Minutes granted per billing period. FREE = 0. */
  monthlyMinutes: number;
  /**
   * Whether this plan grants direct access to curated Library sessions.
   * Meaning: paid-plan Library access, not the presence of a specific
   * per-session unlock. FREE resolves to false here — Free-plan
   * per-session unlocks are a later phase.
   */
  directLibraryAccess: boolean;
};

const CATALOG: Record<Plan, PlanConfig> = {
  FREE: {
    monthlyMinutes: 0,
    directLibraryAccess: false,
  },
  STARTER: {
    monthlyMinutes: 80,
    directLibraryAccess: true,
  },
  PREMIUM: {
    monthlyMinutes: 200,
    directLibraryAccess: true,
  },
};

export function getPlanConfig(plan: Plan): PlanConfig {
  return CATALOG[plan];
}

export function getMonthlyMinuteAllowance(plan: Plan): number {
  return CATALOG[plan].monthlyMinutes;
}

export function hasDirectLibraryAccess(plan: Plan): boolean {
  return CATALOG[plan].directLibraryAccess;
}
