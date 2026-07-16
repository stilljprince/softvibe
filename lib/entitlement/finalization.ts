// lib/entitlement/finalization.ts
//
// RP-010 Phase 3B — Minute Finalization (Write Side).
//
// Central write-side helper that finalizes the Custom-Minute usage of a
// successfully completed PLAN_MINUTES Job and persists the final Job state
// (status = DONE, resultUrl, error cleared) as one atomic unit. This module
// owns the finalize half of the reserve → finalize → release lifecycle;
// release-on-failure, stale recovery, probe finalization, credit refund on
// success and audio authorization are all explicitly out of scope for this
// phase.
//
// Four invariants matter here:
//
//   * Job.usageFinalizedAt, status = DONE, resultUrl and the PeriodUsage
//     minutes transfer all commit together inside a single Prisma
//     interactive transaction. If any step fails the whole transaction
//     rolls back — so a Job cannot appear DONE without its matching
//     PeriodUsage minutes transfer, and a PeriodUsage cannot record used
//     minutes without the Job also being persisted as DONE.
//
//   * A single Compare-And-Set claim on the Job protects against
//     double-finalization. The `updateMany` guard sets
//     status = DONE, usageFinalizedAt = now
//     only when the current row satisfies
//         entitlementKind = PLAN_MINUTES
//     AND usageFinalizedAt IS NULL
//     AND usageReleasedAt IS NULL
//     AND reservedMinutes  > 0
//     AND periodUsageId    IS NOT NULL
//     — the DB serialises concurrent updates on the same row, so at most
//     one caller can win the claim. Every other caller falls through to
//     the idempotent no-op path or a controlled error.
//
//   * Minutes are moved against the *reserved* PeriodUsage row, identified
//     by Job.periodUsageId. The user's current planPeriodStart is deliberately
//     ignored — a billing period rollover between reserve and finalize
//     must not shift the debit onto a new period.
//
//   * The minutes value used for the transfer is Job.reservedMinutes.
//     Actual rendered audio duration, Track.durationSeconds, character
//     count and chapter count are never consulted. Custom Minutes are
//     billed on requested duration, not measured duration.
//
// The atomic transfer is:
//     PeriodUsage.minutesReserved  -=  Job.reservedMinutes
//     PeriodUsage.minutesUsed      +=  Job.reservedMinutes
// gated by a numeric bound so a shortage of reserved minutes surfaces as a
// controlled RESERVED_MINUTES_UNDERFLOW rather than a negative counter.
//
// Non-PLAN_MINUTES Jobs (legacy, FREE, admin, untagged) still flow through
// this function so the /complete route has exactly one DONE-persist call
// site. Their branch simply writes the final Job fields — no PeriodUsage
// is touched, no usage timestamp is set.

import type { PrismaClient, Job } from "@prisma/client";
import { $Enums } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";

/**
 * Fields the caller wants echoed back on the finalized Job. Kept in sync
 * with the response shape returned by /api/jobs/[id]/complete so the
 * finalization function can fully own the terminal DONE-write.
 */
export type FinalizedJobFields = Pick<
  Job,
  | "id"
  | "status"
  | "resultUrl"
  | "durationSec"
  | "title"
  | "prompt"
  | "preset"
  | "createdAt"
>;

/**
 * Final Job fields the caller wants persisted on the successful terminal
 * write. Kept intentionally small: this function is not a general-purpose
 * Job updater and must not accept fields unrelated to the DONE transition.
 */
export type FinalJobData = {
  /** The resolved resultUrl for the completed Job. */
  resultUrl: string;
};

export type FinalizationOutcome =
  /** PLAN_MINUTES Job — minutes moved reserved → used and DONE persisted. */
  | "finalized"
  /**
   * Non-PLAN_MINUTES Job (legacy, FREE, admin, untagged) — DONE persisted,
   * no PeriodUsage mutation, no usage timestamp set. Existing success
   * behaviour is preserved.
   */
  | "no_reservation"
  /**
   * PLAN_MINUTES Job that was already finalized by a prior request. No
   * writes performed; the caller receives the current Job fields.
   * Idempotent second finalize.
   */
  | "already_finalized";

export type FinalizationErrorCode =
  | "JOB_NOT_FOUND"
  | "ALREADY_RELEASED"
  | "MISSING_RESERVATION"
  | "PERIOD_USAGE_NOT_FOUND"
  | "RESERVED_MINUTES_UNDERFLOW"
  | "CONCURRENCY_CONFLICT";

export type FinalizationResult =
  | { ok: true; outcome: FinalizationOutcome; job: FinalizedJobFields }
  | { ok: false; error: FinalizationErrorCode };

/**
 * Internal signal used to abort a transaction with a caller-visible reason.
 * Prisma's interactive `$transaction` rolls back on throw — we lean on that
 * so a rejected finalization cannot leak a committed PeriodUsage write or
 * a half-updated Job.
 */
class FinalizationRejectError extends Error {
  constructor(public readonly code: FinalizationErrorCode) {
    super(code);
    this.name = "FinalizationRejectError";
  }
}

const FINAL_JOB_SELECT = {
  id: true,
  status: true,
  resultUrl: true,
  durationSec: true,
  title: true,
  prompt: true,
  preset: true,
  createdAt: true,
} as const;

/**
 * Persist the final DONE state of a Job and, if it holds a Custom-Minute
 * reservation, atomically move its reserved minutes into used minutes on
 * the originally reserved PeriodUsage row.
 *
 * The whole operation runs inside a single Prisma interactive transaction.
 *
 * Non-PLAN_MINUTES Jobs (entitlementKind ≠ PLAN_MINUTES OR reservedMinutes ≤ 0
 * OR reservedMinutes IS NULL) take the "no_reservation" branch: only the
 * terminal Job.update fires, matching pre-Phase-3B behaviour.
 *
 * PLAN_MINUTES Jobs must additionally have Job.periodUsageId set — the
 * stable mapping to the reserved PeriodUsage row (Phase 3A → 3B). Missing
 * mapping surfaces as MISSING_RESERVATION with no writes performed.
 *
 * Concurrency and idempotency are enforced by a single Compare-And-Set
 * `updateMany` on the Job row (see module docstring). The paired
 * `updateMany` on PeriodUsage carries a numeric-bound guard
 * (minutesReserved ≥ Job.reservedMinutes) so an underflow is caught by
 * the DB itself — the counter never goes negative and the Job write
 * rolls back atomically with the failed usage write.
 */
export async function finalizePlanMinuteUsage(
  params: {
    jobId: string;
    finalJobData: FinalJobData;
    now?: Date;
  },
  client: PrismaClient = defaultPrisma
): Promise<FinalizationResult> {
  const now = params.now ?? new Date();
  try {
    return await client.$transaction(async (tx) => {
      const job = await tx.job.findUnique({
        where: { id: params.jobId },
        select: {
          id: true,
          status: true,
          entitlementKind: true,
          reservedMinutes: true,
          periodUsageId: true,
          usageFinalizedAt: true,
          usageReleasedAt: true,
        },
      });
      if (!job) {
        throw new FinalizationRejectError("JOB_NOT_FOUND");
      }

      const isPlanMinutes =
        job.entitlementKind === $Enums.EntitlementKind.PLAN_MINUTES;
      const reservedMinutes = job.reservedMinutes ?? 0;

      // ── Non-PLAN_MINUTES path ────────────────────────────────────────
      // Legacy, FREE, admin and untagged Jobs never touch PeriodUsage.
      // We still own the terminal DONE-write so the caller has exactly
      // one atomic write path — matches pre-Phase-3B behaviour for these
      // Jobs, without letting them accidentally trigger a usage transfer.
      if (!isPlanMinutes || reservedMinutes <= 0) {
        // PLAN_MINUTES jobs with reservedMinutes ≤ 0 are structurally
        // invalid: the reservation invariant guarantees > 0. A tagged
        // Job without a positive reservation is a bug — treat as a
        // controlled error rather than silently moving zero minutes.
        if (isPlanMinutes) {
          throw new FinalizationRejectError("MISSING_RESERVATION");
        }
        const updated = await tx.job.update({
          where: { id: params.jobId },
          data: {
            status: $Enums.JobStatus.DONE,
            resultUrl: params.finalJobData.resultUrl,
            error: null,
          },
          select: FINAL_JOB_SELECT,
        });
        return {
          ok: true,
          outcome: "no_reservation",
          job: updated,
        } as FinalizationResult;
      }

      // ── PLAN_MINUTES path ────────────────────────────────────────────
      if (job.usageReleasedAt) {
        // Reservation was already released (Phase 3C territory) — must
        // never finalize on top. Never both timestamps set.
        throw new FinalizationRejectError("ALREADY_RELEASED");
      }
      if (job.usageFinalizedAt) {
        // Idempotent second call. No writes; return current final fields.
        const current = await tx.job.findUnique({
          where: { id: params.jobId },
          select: FINAL_JOB_SELECT,
        });
        // Should always exist — we just read it above under the same tx.
        if (!current) {
          throw new FinalizationRejectError("JOB_NOT_FOUND");
        }
        return {
          ok: true,
          outcome: "already_finalized",
          job: current,
        } as FinalizationResult;
      }
      if (!job.periodUsageId) {
        // PLAN_MINUTES tagged but missing the stable mapping — cannot
        // determine which PeriodUsage row to debit against. Refuse
        // rather than guessing at the caller's current billing period.
        throw new FinalizationRejectError("MISSING_RESERVATION");
      }

      // Atomic Compare-And-Set claim. The WHERE guard is the sole
      // idempotency key: exactly one concurrent caller can set
      // usageFinalizedAt from NULL to a value, and that same caller
      // owns the DONE + resultUrl write of this Job.
      const claim = await tx.job.updateMany({
        where: {
          id: params.jobId,
          entitlementKind: $Enums.EntitlementKind.PLAN_MINUTES,
          usageFinalizedAt: null,
          usageReleasedAt: null,
          reservedMinutes: { gt: 0 },
          periodUsageId: job.periodUsageId,
        },
        data: {
          status: $Enums.JobStatus.DONE,
          resultUrl: params.finalJobData.resultUrl,
          error: null,
          usageFinalizedAt: now,
        },
      });

      if (claim.count === 0) {
        // The claim can only fail if a concurrent request finalized or
        // released the Job between our findUnique and this update — the
        // pre-checks above already ruled out every other reason. Re-read
        // to distinguish and surface a controlled result.
        const post = await tx.job.findUnique({
          where: { id: params.jobId },
          select: FINAL_JOB_SELECT,
          // Note: we intentionally do not include usageReleasedAt /
          // usageFinalizedAt here because we cannot return an unrelated
          // ALREADY_RELEASED under FinalizedJobFields. Instead, a second
          // findUnique with the state fields decides which branch.
        });
        const stateCheck = await tx.job.findUnique({
          where: { id: params.jobId },
          select: {
            usageFinalizedAt: true,
            usageReleasedAt: true,
          },
        });
        if (stateCheck?.usageReleasedAt) {
          throw new FinalizationRejectError("ALREADY_RELEASED");
        }
        if (stateCheck?.usageFinalizedAt && post) {
          // Someone else won the race; treat as idempotent no-op.
          return {
            ok: true,
            outcome: "already_finalized",
            job: post,
          } as FinalizationResult;
        }
        throw new FinalizationRejectError("CONCURRENCY_CONFLICT");
      }

      // Move minutes: reserved → used, gated on a positive balance.
      const usageUpdate = await tx.periodUsage.updateMany({
        where: {
          id: job.periodUsageId,
          minutesReserved: { gte: reservedMinutes },
        },
        data: {
          minutesReserved: { decrement: reservedMinutes },
          minutesUsed: { increment: reservedMinutes },
        },
      });

      if (usageUpdate.count === 0) {
        // Distinguish "row vanished" from "balance too low" so the caller
        // can log an accurate diagnostic. In both cases the enclosing
        // throw rolls back the Job.updateMany above — the Job cannot
        // remain DONE with its usage untransferred.
        const existing = await tx.periodUsage.findUnique({
          where: { id: job.periodUsageId },
          select: { id: true },
        });
        if (!existing) {
          throw new FinalizationRejectError("PERIOD_USAGE_NOT_FOUND");
        }
        throw new FinalizationRejectError("RESERVED_MINUTES_UNDERFLOW");
      }

      const updated = await tx.job.findUnique({
        where: { id: params.jobId },
        select: FINAL_JOB_SELECT,
      });
      // Cannot vanish — we just updated it under the same tx.
      if (!updated) {
        throw new FinalizationRejectError("JOB_NOT_FOUND");
      }
      return {
        ok: true,
        outcome: "finalized",
        job: updated,
      } as FinalizationResult;
    });
  } catch (e) {
    if (e instanceof FinalizationRejectError) {
      return { ok: false, error: e.code };
    }
    throw e;
  }
}
