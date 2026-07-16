// lib/entitlement/resolver.ts
//
// Central read-only Entitlement Resolver (RP-010 Phase 2B-1 / 2B-2).
//
// Given a userId, produces a stable typed snapshot of the user's active plan,
// Custom-Minute usage against the current billing period, remaining lifetime
// Probe Generations, and whether the current plan grants direct curated
// Library access.
//
// The resolver reports an **effective** plan (Phase 2B-2, CEO Option C):
// a persisted paid plan whose billing period has already ended is treated
// as FREE for all read-side calculations. No database write is performed —
// the persisted User.plan value is not modified here. See resolveEffectivePlan
// for the exact rules.
//
// This module MUST remain strictly read-only:
//   - no Prisma create / update / upsert / delete
//   - no Stripe calls
//   - no PeriodUsage repair or backfill
//   - no LibraryUnlock evaluation (per-session unlock lives in a later phase)
//
// Enforcement (reservation, finalization, refunds, probe claim, audio auth,
// Stripe lifecycle) is intentionally out of scope for this phase.

import { Plan } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  PROBE_LIFETIME_LIMIT,
  getPlanConfig,
  hasDirectLibraryAccess,
} from "@/lib/entitlement/plan";

export type ResolvedEntitlements = {
  plan: Plan;
  monthlyMinutes: {
    allowance: number;
    used: number;
    reserved: number;
    remaining: number;
  };
  billingPeriod: {
    start: Date | null;
    end: Date | null;
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

export type ResolveEntitlementsError = "USER_NOT_FOUND";

export type ResolveEntitlementsResult =
  | { ok: true; data: ResolvedEntitlements }
  | { ok: false; error: ResolveEntitlementsError };

// Input shape for the pure calculation. Kept minimal and free of Prisma
// runtime types so the calculation can be unit-tested without a database.
export type ResolverInput = {
  plan: Plan;
  planPeriodStart: Date | null;
  planPeriodEnd: Date | null;
  probeGenerationsUsed: number;
  /**
   * The PeriodUsage row matching the user's current billing period, if any.
   * Missing rows are treated as zero usage — the resolver never creates one.
   */
  periodUsage: {
    minutesUsed: number;
    minutesReserved: number;
  } | null;
};

function clampNonNegative(n: number): number {
  return n < 0 ? 0 : n;
}

/**
 * Determine the effective plan given the persisted plan and the current
 * billing-period end. Pure and read-only — never writes to the database.
 *
 * Rules (RP-010 Phase 2B-2, CEO Option C):
 *
 *   - FREE always resolves to FREE, regardless of any period data.
 *   - A paid plan (STARTER / PREMIUM) whose planPeriodEnd is still in the
 *     future keeps the paid plan.
 *   - A paid plan whose planPeriodEnd has already elapsed (planPeriodEnd
 *     <= now) is downgraded to FREE for read-side calculations only. The
 *     persisted User.plan value is NOT modified — enforcement of the
 *     downgrade happens purely on the read side.
 *   - A paid plan with planPeriodEnd === null is kept as the paid plan.
 *     The Stripe → DB synchronization is new; legacy demo / test accounts
 *     may still be missing period boundaries. Downgrading them here would
 *     silently break existing users, so we leave the plan intact until a
 *     later phase reconciles those rows.
 */
export function resolveEffectivePlan(
  plan: Plan,
  planPeriodEnd: Date | null,
  now: Date
): Plan {
  if (plan === "FREE") return "FREE";
  if (planPeriodEnd === null) return plan;
  return planPeriodEnd.getTime() > now.getTime() ? plan : "FREE";
}

/**
 * Pure calculation. Given persisted user + period-usage state, produce the
 * stable resolved snapshot. No I/O, no side effects — safe to unit-test.
 *
 * `now` may be passed explicitly for deterministic tests. When omitted the
 * current wall clock is used. Only the effective-plan decision depends on
 * `now`; all other numeric fields are derived from persisted state.
 */
export function calculateResolvedEntitlements(
  input: ResolverInput,
  now: Date = new Date()
): ResolvedEntitlements {
  const { plan, planPeriodStart, planPeriodEnd, probeGenerationsUsed, periodUsage } = input;

  const effectivePlan = resolveEffectivePlan(plan, planPeriodEnd, now);

  const config = getPlanConfig(effectivePlan);
  const allowance = config.monthlyMinutes;

  // FREE (effective) plans must always resolve to zero monthly usage
  // regardless of any stale PeriodUsage rows that may exist from a prior
  // paid subscription — this also covers paid plans that have expired.
  const used =
    effectivePlan === "FREE" ? 0 : clampNonNegative(periodUsage?.minutesUsed ?? 0);
  const reserved =
    effectivePlan === "FREE" ? 0 : clampNonNegative(periodUsage?.minutesReserved ?? 0);
  const remaining = clampNonNegative(allowance - used - reserved);

  const probeUsed = clampNonNegative(probeGenerationsUsed);
  const probeRemaining = clampNonNegative(PROBE_LIFETIME_LIMIT - probeUsed);
  const canUseProbe = effectivePlan === "FREE" && probeRemaining > 0;

  return {
    plan: effectivePlan,
    monthlyMinutes: {
      allowance,
      used,
      reserved,
      remaining,
    },
    billingPeriod: {
      start: planPeriodStart,
      end: planPeriodEnd,
    },
    probes: {
      lifetimeLimit: PROBE_LIFETIME_LIMIT,
      used: probeUsed,
      remaining: probeRemaining,
      canUse: canUseProbe,
    },
    library: {
      hasDirectAccess: hasDirectLibraryAccess(effectivePlan),
    },
  };
}

/**
 * Read-only resolver. Loads the User and the current-period PeriodUsage
 * (matched exactly by userId + periodStart) and hands them to the pure
 * calculation. Never writes.
 */
export async function resolveEntitlements(
  userId: string
): Promise<ResolveEntitlementsResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      plan: true,
      planPeriodStart: true,
      planPeriodEnd: true,
      probeGenerationsUsed: true,
    },
  });

  if (!user) {
    return { ok: false, error: "USER_NOT_FOUND" };
  }

  // Match the current PeriodUsage row exactly. Never fall back to "latest
  // row" — that would risk attributing usage to the wrong billing period.
  let periodUsage: { minutesUsed: number; minutesReserved: number } | null = null;
  if (user.planPeriodStart) {
    periodUsage = await prisma.periodUsage.findUnique({
      where: {
        userId_periodStart: {
          userId,
          periodStart: user.planPeriodStart,
        },
      },
      select: {
        minutesUsed: true,
        minutesReserved: true,
      },
    });
  }

  return {
    ok: true,
    data: calculateResolvedEntitlements({
      plan: user.plan,
      planPeriodStart: user.planPeriodStart,
      planPeriodEnd: user.planPeriodEnd,
      probeGenerationsUsed: user.probeGenerationsUsed,
      periodUsage,
    }),
  };
}
