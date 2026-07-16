// lib/entitlement/reservation.ts
//
// RP-010 Phase 3A — Minute Reservation (Write Side).
//
// Central write-side helper that reserves Custom Minutes for paid users and
// creates the backing Job in a single atomic transaction. This module owns
// the reserve half of the reserve → finalize → release lifecycle; finalize,
// release, stale-recovery, probe reservation, probe enforcement, Library
// Unlock and audio authorization are all explicitly out of scope for this
// phase.
//
// Four invariants matter here:
//
//   * Credit debit, Custom-Minute reservation and Job.create all run inside
//     the same Prisma interactive transaction. If any step fails the whole
//     transaction rolls back — so a decremented credit can never remain
//     without its matching Job, and a Job tagged `entitlementKind =
//     PLAN_MINUTES` cannot exist without a matching PeriodUsage.minutesReserved
//     increment.
//
//   * The monthly allowance is enforced atomically. The reservation only
//     commits when
//         PeriodUsage.minutesUsed
//       + PeriodUsage.minutesReserved
//       + requestedMinutes  <=  monthlyAllowance
//     against the *current committed row*, not a pre-transaction snapshot.
//     This is achieved with a numeric-bound conditional `updateMany`; under
//     PostgreSQL READ COMMITTED the WHERE clause is re-evaluated after any
//     concurrent conflicting UPDATE commits, so two writers cannot both
//     succeed and push the total past the allowance.
//
//   * The first PeriodUsage row for a given period can race between two
//     concurrent writers. Both may see "no row yet" and both may try to
//     INSERT — one wins, the other hits the unique constraint on
//     (userId, periodStart) and raises P2002. We handle this deterministically
//     with a single bounded retry: on the retry the losing writer sees the
//     committed row and takes the atomic-increment path. A second P2002 is
//     surfaced as `CONCURRENCY_CONFLICT` rather than a generic 500.
//
//   * Non-reserving paths (FREE, expired paid, missing period, zero minutes)
//     go through the same atomic function so callers get exactly one Job
//     either way — the entitlement fields are simply left null.
//
// Allowance values are sourced from `lib/entitlement/plan.ts`:
//   FREE = 0   STARTER = 80   PREMIUM = 200
//
// The existing Credits admission system remains authoritative for whether a
// Job may be admitted at all; Custom-Minute reservation is additive on top
// and only affects paid users. Credit decrement now lives inside the same
// transaction as the reservation — there is no longer a separate refund
// path for INSUFFICIENT_MINUTES.

import { EntitlementKind, Prisma } from "@prisma/client";
import type { Plan, PrismaClient, Job } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { resolveEffectivePlan } from "@/lib/entitlement/resolver";
import { getMonthlyMinuteAllowance } from "@/lib/entitlement/plan";

/**
 * Data required to create the backing Job. Mirrors the fields the /api/jobs
 * POST handler currently passes to `prisma.job.create`, minus the entitlement
 * fields — those are set by this module based on the reservation outcome.
 */
export type JobCreateData = {
  userId: string;
  prompt: string;
  preset: string | null;
  status: Prisma.JobCreateInput["status"];
  durationSec: number | null;
  title: string;
  language: string;
  voiceGender: string;
  voiceStyle: string;
  narrativeMode: string | null;
  scriptOverride: string | null;
};

export type ReservationErrorCode =
  | "USER_NOT_FOUND"
  | "NO_CREDITS"
  | "INSUFFICIENT_MINUTES"
  | "CONCURRENCY_CONFLICT";

export type ReserveAndCreateJobResult =
  | {
      ok: true;
      job: Pick<Job, "id" | "status" | "title" | "prompt">;
      reservation:
        | "reserved"
        | "skipped_free"
        | "skipped_no_period"
        | "skipped_zero_minutes";
      minutes?: number;
      periodStart?: Date;
    }
  | { ok: false; error: ReservationErrorCode };

/**
 * Convert requested duration in seconds to whole reservation minutes.
 * Rounds up so a 30-second request still costs one minute; the future
 * finalize path will draw the same value back down, keeping reserve and
 * finalize symmetrical.
 *
 * Non-finite, null, undefined and non-positive inputs collapse to zero,
 * which the reservation function treats as a soft skip.
 */
export function minutesFromDurationSec(
  durationSec: number | null | undefined
): number {
  if (durationSec == null) return 0;
  if (!Number.isFinite(durationSec)) return 0;
  if (durationSec <= 0) return 0;
  return Math.ceil(durationSec / 60);
}

export type ReservationDecision =
  | { action: "reserve"; minutes: number; periodStart: Date; periodEnd: Date }
  | { action: "skipped_free" }
  | { action: "skipped_no_period" }
  | { action: "skipped_zero_minutes" };

export type ReservationDecisionInput = {
  plan: Plan;
  planPeriodStart: Date | null;
  planPeriodEnd: Date | null;
  requestedMinutes: number;
  now?: Date;
};

/**
 * Pure decision function. Given persisted plan state and requested minutes,
 * decide whether to reserve and, if so, how many minutes against which
 * billing period. No I/O — safe to unit-test.
 */
export function decidePlanMinuteReservation(
  input: ReservationDecisionInput
): ReservationDecision {
  const now = input.now ?? new Date();
  const effectivePlan = resolveEffectivePlan(
    input.plan,
    input.planPeriodEnd,
    now
  );
  if (effectivePlan === "FREE") return { action: "skipped_free" };
  if (!input.planPeriodStart || !input.planPeriodEnd) {
    return { action: "skipped_no_period" };
  }
  const minutes = Math.max(0, Math.floor(input.requestedMinutes));
  if (minutes <= 0) return { action: "skipped_zero_minutes" };
  return {
    action: "reserve",
    minutes,
    periodStart: input.planPeriodStart,
    periodEnd: input.planPeriodEnd,
  };
}

/**
 * Internal signal used to abort a transaction with a caller-visible reason.
 * Prisma's interactive `$transaction` rolls back on throw — we lean on that
 * so a rejected reservation cannot leak a committed credit debit or a
 * half-written PeriodUsage row.
 */
class ReservationRejectError extends Error {
  constructor(public readonly code: ReservationErrorCode) {
    super(code);
    this.name = "ReservationRejectError";
  }
}

/**
 * Recognise a P2002 unique-constraint violation on
 * `PeriodUsage_userId_periodStart`. Production Prisma raises
 * `PrismaClientKnownRequestError` with `code === "P2002"` and
 * `meta.target` describing the constraint; the offline test stub raises a
 * plain Error with the same shape. We look at both fields and, as a last
 * resort, fall back to the message text so no legitimate first-row conflict
 * slips past uncaught.
 */
function isPeriodUsageUniqueConflict(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as {
    code?: unknown;
    meta?: { target?: unknown };
    message?: unknown;
  };
  if (err.code !== "P2002") return false;
  const target = err.meta?.target;
  if (Array.isArray(target)) {
    return target.some(
      (t) => typeof t === "string" && t.toLowerCase().includes("periodstart")
    );
  }
  if (typeof target === "string") {
    const s = target.toLowerCase();
    return s.includes("periodstart") || s.includes("periodusage");
  }
  if (typeof err.message === "string") {
    return err.message.toLowerCase().includes("periodstart");
  }
  return false;
}

/**
 * Atomically debit a credit (paid users only), reserve Custom Minutes and
 * create the backing Job.
 *
 * The whole operation runs inside a single Prisma interactive transaction:
 *
 *   1. Load the user's plan and current billing period.
 *   2. For non-admin callers: atomically decrement `User.credits` with a
 *      `updateMany` guarded by `credits >= 1`. If zero rows match the
 *      transaction aborts as NO_CREDITS.
 *   3. Decide whether reservation applies (see decidePlanMinuteReservation).
 *   4. On the `reserve` branch:
 *        a. Compute the plan allowance from the effective plan.
 *        b. Attempt a conditional `updateMany` that increments minutesReserved
 *           only when the row satisfies
 *             minutesReserved <= allowance - requestedMinutes - minutesUsed_snap
 *           — combined with the row-lock semantics of PostgreSQL READ
 *           COMMITTED, this is the atomic allowance gate. The snapshot value
 *           of minutesUsed is safe to reuse in the bound because Phase 3A
 *           never mutates minutesUsed (finalize is later phase).
 *        c. If the update affected zero rows, either the row doesn't exist
 *           yet or the allowance would be exceeded. Distinguish via an
 *           existence check: an existing row that failed the WHERE is a
 *           definite INSUFFICIENT_MINUTES; a missing row triggers a
 *           fresh, allowance-guarded create.
 *        d. Create the Job with `entitlementKind = PLAN_MINUTES` and
 *           `reservedMinutes = decision.minutes`.
 *   5. On any non-reserving branch: create the Job with null entitlement
 *      fields — the caller still gets exactly one Job.
 *
 * If two callers race to create the first PeriodUsage for a period, one
 * will hit `P2002` on `(userId, periodStart)`. That specific error triggers
 * a single retry of the whole transaction: on the retry the losing caller
 * now sees the committed row and takes the atomic-increment path, so the
 * outcome is deterministic. A second P2002 is surfaced as
 * `CONCURRENCY_CONFLICT` — never as an uncontrolled 500.
 */
export async function reserveAndCreateJob(
  params: {
    userId: string;
    isAdmin: boolean;
    jobData: JobCreateData;
    requestedMinutes: number;
    now?: Date;
  },
  client: PrismaClient = defaultPrisma
): Promise<ReserveAndCreateJobResult> {
  try {
    return await runReservationTx(params, client);
  } catch (e) {
    if (isPeriodUsageUniqueConflict(e)) {
      try {
        return await runReservationTx(params, client);
      } catch (e2) {
        if (isPeriodUsageUniqueConflict(e2)) {
          return { ok: false, error: "CONCURRENCY_CONFLICT" };
        }
        throw e2;
      }
    }
    throw e;
  }
}

async function runReservationTx(
  params: {
    userId: string;
    isAdmin: boolean;
    jobData: JobCreateData;
    requestedMinutes: number;
    now?: Date;
  },
  client: PrismaClient
): Promise<ReserveAndCreateJobResult> {
  try {
    return await client.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: params.userId },
        select: {
          plan: true,
          planPeriodStart: true,
          planPeriodEnd: true,
        },
      });
      if (!user) throw new ReservationRejectError("USER_NOT_FOUND");

      // Atomic credit debit for non-admin callers. Any downstream failure
      // — INSUFFICIENT_MINUTES, PeriodUsage write, Job create, P2002 —
      // rolls this back with the rest of the transaction, so no manual
      // refund path is needed.
      if (!params.isAdmin) {
        const creditRes = await tx.user.updateMany({
          where: { id: params.userId, credits: { gte: 1 } },
          data: { credits: { decrement: 1 } },
        });
        if (creditRes.count === 0) {
          throw new ReservationRejectError("NO_CREDITS");
        }
      }

      const decision = decidePlanMinuteReservation({
        plan: user.plan,
        planPeriodStart: user.planPeriodStart,
        planPeriodEnd: user.planPeriodEnd,
        requestedMinutes: params.requestedMinutes,
        now: params.now,
      });

      if (decision.action !== "reserve") {
        // Non-reserving branch — create the Job untagged and return.
        const job = await tx.job.create({
          data: {
            userId: params.jobData.userId,
            prompt: params.jobData.prompt,
            preset: params.jobData.preset ?? null,
            status: params.jobData.status,
            durationSec: params.jobData.durationSec,
            title: params.jobData.title,
            language: params.jobData.language,
            voiceGender: params.jobData.voiceGender,
            voiceStyle: params.jobData.voiceStyle,
            narrativeMode: params.jobData.narrativeMode,
            scriptOverride: params.jobData.scriptOverride,
          },
          select: { id: true, status: true, title: true, prompt: true },
        });
        return {
          ok: true,
          job,
          reservation: decision.action,
        } as ReserveAndCreateJobResult;
      }

      // Reserving branch. Compute the effective plan's allowance now — under
      // resolveEffectivePlan an elapsed paid plan is already downgraded to FREE
      // in decidePlanMinuteReservation, so we only land here on an active paid
      // plan whose allowance is strictly > 0.
      const now = params.now ?? new Date();
      const effectivePlan = resolveEffectivePlan(
        user.plan,
        user.planPeriodEnd,
        now
      );
      const allowance = getMonthlyMinuteAllowance(effectivePlan);

      // Snapshot minutesUsed for the WHERE bound. Safe in Phase 3A because no
      // write path in this phase mutates minutesUsed; finalize is out of scope.
      const snapshot = await tx.periodUsage.findUnique({
        where: {
          userId_periodStart: {
            userId: params.userId,
            periodStart: decision.periodStart,
          },
        },
        select: { minutesUsed: true },
      });
      const usedSnapshot = snapshot?.minutesUsed ?? 0;

      const bound = allowance - decision.minutes - usedSnapshot;
      if (bound < 0) {
        // Even a fresh row (minutesReserved = 0) would exceed the allowance —
        // no need to hit the DB again. Applies both to first-time reservations
        // and to rows that already exist.
        throw new ReservationRejectError("INSUFFICIENT_MINUTES");
      }

      // Conditional atomic increment. The `lte` bound on minutesReserved is
      // the allowance gate: PostgreSQL re-evaluates it against the current
      // committed row under READ COMMITTED, so concurrent reservations cannot
      // both squeeze past the cap.
      const claim = await tx.periodUsage.updateMany({
        where: {
          userId: params.userId,
          periodStart: decision.periodStart,
          minutesReserved: { lte: bound },
        },
        data: {
          minutesReserved: { increment: decision.minutes },
        },
      });

      if (claim.count === 0) {
        // Two cases:
        //   (a) row exists but its minutesReserved would push past the allowance
        //       → definite INSUFFICIENT_MINUTES.
        //   (b) row doesn't exist for this period yet → create it with the
        //       initial minutesReserved. `bound >= 0` above already guarantees
        //       decision.minutes <= allowance, so the fresh row is valid.
        const existing = await tx.periodUsage.findUnique({
          where: {
            userId_periodStart: {
              userId: params.userId,
              periodStart: decision.periodStart,
            },
          },
          select: { id: true },
        });
        if (existing) {
          throw new ReservationRejectError("INSUFFICIENT_MINUTES");
        }
        // Fresh create. If a concurrent transaction wins the create race,
        // P2002 propagates and the outer layer retries the whole transaction
        // exactly once — the retry then takes the atomic-increment path.
        await tx.periodUsage.create({
          data: {
            userId: params.userId,
            periodStart: decision.periodStart,
            periodEnd: decision.periodEnd,
            minutesReserved: decision.minutes,
            minutesUsed: 0,
          },
        });
      }

      // Job creation, atomic with the credit debit and reservation write above.
      const job = await tx.job.create({
        data: {
          userId: params.jobData.userId,
          prompt: params.jobData.prompt,
          preset: params.jobData.preset ?? null,
          status: params.jobData.status,
          durationSec: params.jobData.durationSec,
          title: params.jobData.title,
          language: params.jobData.language,
          voiceGender: params.jobData.voiceGender,
          voiceStyle: params.jobData.voiceStyle,
          narrativeMode: params.jobData.narrativeMode,
          scriptOverride: params.jobData.scriptOverride,
          entitlementKind: EntitlementKind.PLAN_MINUTES,
          reservedMinutes: decision.minutes,
        },
        select: { id: true, status: true, title: true, prompt: true },
      });

      return {
        ok: true,
        job,
        reservation: "reserved",
        minutes: decision.minutes,
        periodStart: decision.periodStart,
      } as ReserveAndCreateJobResult;
    });
  } catch (e) {
    if (e instanceof ReservationRejectError) {
      return { ok: false, error: e.code };
    }
    throw e;
  }
}
