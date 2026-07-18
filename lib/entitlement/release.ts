// lib/entitlement/release.ts
//
// RP-010 Phase 3C — Minute Release & Recovery (Write Side).
//
// Central write-side helper that releases the Custom-Minute reservation of a
// PLAN_MINUTES Job that failed after reservation but before or during TTS
// rendering, and persists the final Job state (status = FAILED, optional
// error text) as one atomic unit. This module owns the release half of the
// reserve → finalize → release lifecycle; success finalization, probe
// reservation and stale-recovery orchestration all live elsewhere. Optional
// pre-TTS credit refund is bundled into the same transaction so callers no
// longer need a separate refund path — see the refundCreditIfEligible
// contract below.
//
// Five invariants matter here — deliberately mirrored on finalization.ts so
// the two halves of the lifecycle look and reason the same:
//
//   * Job.usageReleasedAt, status = FAILED, error text, the PeriodUsage
//     minutesReserved decrement and (optional) credit refund all commit
//     together inside a single Prisma interactive transaction. If any step
//     fails the whole transaction rolls back — so a Job cannot appear
//     released without its matching PeriodUsage decrement, a PeriodUsage
//     cannot lose reserved minutes without the Job also being persisted as
//     released, and User.credits cannot be incremented without both the
//     release and Job.creditRefundedAt being persisted alongside it.
//
//   * A single Compare-And-Set claim on the Job protects against
//     double-release AND against release-after-finalize. The `updateMany`
//     guard sets
//         status = FAILED, usageReleasedAt = now, error = <text>
//     only when the current row satisfies
//         entitlementKind    = PLAN_MINUTES
//     AND usageFinalizedAt   IS NULL
//     AND usageReleasedAt    IS NULL
//     AND reservedMinutes    > 0
//     AND periodUsageId      IS NOT NULL
//     — the DB serialises concurrent updates on the same row, so at most
//     one caller can win the claim. A concurrent finalize (which sets
//     usageFinalizedAt) and a concurrent release (which sets
//     usageReleasedAt) cannot both succeed on the same Job: whichever
//     writer commits first flips the other's guard column from NULL to a
//     value, and the loser's CAS returns count = 0.
//
//   * Minutes are moved against the *reserved* PeriodUsage row, identified
//     by Job.periodUsageId. The user's current planPeriodStart is
//     deliberately ignored — a billing period rollover between reserve
//     and release must not shift the credit onto a new period.
//
//   * The minutes value used for the reverse-transfer is Job.reservedMinutes.
//     Actual rendered audio duration, Track.durationSeconds, character
//     count and chapter count are never consulted. Custom Minutes are
//     billed on requested duration and released on requested duration —
//     no partial-consumption accounting.
//
//   * Credit refund (opt-in via refundCreditIfEligible) is gated by the
//     product rule that predates Phase 3C:
//         creditRefundedAt IS NULL  (never refunded)
//     AND ttsStartedAt     IS NULL  (audio was never produced)
//     Admin exclusion belongs to the caller — admins are never debited at
//     job creation, so their releases must always pass
//     refundCreditIfEligible = false. The refund itself is a second
//     `updateMany` CAS claim on the Job (WHERE the two guards are still
//     null) paired with a User.credits increment inside the same
//     transaction, so at most one refund is ever issued per Job and
//     concurrent callers cannot double-credit.
//
// The atomic reverse-transfer is:
//     PeriodUsage.minutesReserved  -=  Job.reservedMinutes
//     PeriodUsage.minutesUsed      is untouched
// gated by a numeric bound so a shortage of reserved minutes surfaces as a
// controlled RESERVED_MINUTES_UNDERFLOW rather than a negative counter.
//
// Non-PLAN_MINUTES Jobs (legacy, FREE, admin, untagged) still flow through
// this function so every terminal FAILED write path can call exactly one
// helper. Their branch simply writes the final Job fields — no PeriodUsage
// is touched, no usage timestamp is set. If refundCreditIfEligible is
// enabled they participate in the same in-tx credit-refund claim: this
// matches the pre-Phase-3C tryRefundCredit behaviour but folds it into a
// single atomic write path.

import type { PrismaClient, Job } from "@prisma/client";
import { $Enums } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";

/**
 * Fields the caller wants echoed back on the released Job. Kept small on
 * purpose: release is a terminal helper, not a general-purpose Job reader.
 */
export type ReleasedJobFields = Pick<
  Job,
  "id" | "status" | "error" | "usageReleasedAt" | "usageFinalizedAt"
>;

export type ReleaseOutcome =
  /** PLAN_MINUTES Job — reservation released and FAILED persisted. */
  | "released"
  /**
   * Non-PLAN_MINUTES Job (legacy, FREE, admin, untagged) — FAILED
   * persisted, no PeriodUsage mutation, no usage timestamp set.
   */
  | "no_reservation"
  /**
   * PLAN_MINUTES Job that was already released by a prior request. No
   * writes performed; existing usageReleasedAt preserved. Idempotent
   * second release.
   */
  | "already_released";

export type ReleaseErrorCode =
  | "JOB_NOT_FOUND"
  | "ALREADY_FINALIZED"
  | "MISSING_RESERVATION"
  | "PERIOD_USAGE_NOT_FOUND"
  | "RESERVED_MINUTES_UNDERFLOW"
  | "CONCURRENCY_CONFLICT";

export type ReleaseResult =
  | {
      ok: true;
      outcome: ReleaseOutcome;
      job: ReleasedJobFields;
      /**
       * True iff this call actually claimed the credit-refund slot AND
       * incremented User.credits inside the same transaction. False when
       * refundCreditIfEligible was omitted / false, when ttsStartedAt or
       * creditRefundedAt were already set (product rule denies refund),
       * or on the already_released idempotent branch where no writes fire.
       */
      creditRefunded: boolean;
    }
  | { ok: false; error: ReleaseErrorCode };

/**
 * Internal signal used to abort a transaction with a caller-visible reason.
 * Prisma's interactive `$transaction` rolls back on throw — we lean on that
 * so a rejected release cannot leak a committed PeriodUsage write or a
 * half-updated Job.
 */
class ReleaseRejectError extends Error {
  constructor(public readonly code: ReleaseErrorCode) {
    super(code);
    this.name = "ReleaseRejectError";
  }
}

const RELEASED_JOB_SELECT = {
  id: true,
  status: true,
  error: true,
  usageReleasedAt: true,
  usageFinalizedAt: true,
} as const;

/**
 * Persist the final FAILED state of a Job and, if it holds a Custom-Minute
 * reservation, atomically move its reserved minutes back off the originally
 * reserved PeriodUsage row (decrementing minutesReserved without touching
 * minutesUsed). When the caller opts in via refundCreditIfEligible the
 * standard pre-TTS credit refund is also folded into the same transaction.
 *
 * The whole operation runs inside a single Prisma interactive transaction.
 *
 * Non-PLAN_MINUTES Jobs (entitlementKind ≠ PLAN_MINUTES OR reservedMinutes ≤ 0
 * OR reservedMinutes IS NULL) take the "no_reservation" branch: only the
 * terminal Job.update fires, matching pre-Phase-3C behaviour for legacy /
 * FREE / admin Jobs. If refundCreditIfEligible is set they still participate
 * in the in-tx credit-refund claim — same product rule, same idempotency.
 *
 * PLAN_MINUTES Jobs must additionally have Job.periodUsageId set — the
 * stable mapping to the reserved PeriodUsage row (Phase 3A). A missing
 * mapping surfaces as MISSING_RESERVATION with no writes performed. Jobs
 * already finalized (usageFinalizedAt set) surface as ALREADY_FINALIZED —
 * the two lifecycle halves must never both succeed on the same Job.
 *
 * Concurrency and idempotency are enforced by Compare-And-Set `updateMany`
 * writes on the Job row (see module docstring). The paired `updateMany` on
 * PeriodUsage carries a numeric-bound guard (minutesReserved ≥
 * Job.reservedMinutes) so an underflow is caught by the DB itself — the
 * counter never goes negative and the Job write rolls back atomically with
 * the failed usage write. The optional credit refund uses its own CAS
 * (WHERE creditRefundedAt IS NULL AND ttsStartedAt IS NULL) so at most one
 * refund is ever issued.
 */
export async function releasePlanMinuteReservation(
  params: {
    jobId: string;
    error?: string | null;
    now?: Date;
    /**
     * If true, the helper additionally attempts to refund one credit
     * inside the same transaction, subject to the standard product rule
     * (creditRefundedAt IS NULL AND ttsStartedAt IS NULL). Callers must
     * pre-filter admins (admins are never debited and must always pass
     * false here). Defaults to false — /fail and any path that must not
     * touch credits should omit it.
     */
    refundCreditIfEligible?: boolean;
  },
  client: PrismaClient = defaultPrisma
): Promise<ReleaseResult> {
  const now = params.now ?? new Date();
  const errorText = params.error ?? null;
  const refundCreditIfEligible = params.refundCreditIfEligible === true;
  try {
    return await client.$transaction(async (tx) => {
      const job = await tx.job.findUnique({
        where: { id: params.jobId },
        select: {
          id: true,
          userId: true,
          status: true,
          entitlementKind: true,
          reservedMinutes: true,
          periodUsageId: true,
          usageFinalizedAt: true,
          usageReleasedAt: true,
          ttsStartedAt: true,
          creditRefundedAt: true,
        },
      });
      if (!job) {
        throw new ReleaseRejectError("JOB_NOT_FOUND");
      }

      const isPlanMinutes =
        job.entitlementKind === $Enums.EntitlementKind.PLAN_MINUTES;
      const reservedMinutes = job.reservedMinutes ?? 0;

      // ── Non-PLAN_MINUTES path ────────────────────────────────────────
      // Legacy, FREE, admin and untagged Jobs never touch PeriodUsage.
      // We still own the terminal FAILED-write so the caller has a single
      // atomic write path — matches pre-Phase-3C behaviour, without
      // letting these Jobs accidentally trigger a usage decrement. When
      // refundCreditIfEligible is set we also fold the credit refund
      // into this same tx so a non-plan fail path is fully atomic.
      if (!isPlanMinutes || reservedMinutes <= 0) {
        // PLAN_MINUTES jobs with reservedMinutes ≤ 0 are structurally
        // invalid: the reservation invariant guarantees > 0. A tagged
        // Job without a positive reservation is a bug — treat as a
        // controlled error rather than silently moving zero minutes.
        if (isPlanMinutes) {
          throw new ReleaseRejectError("MISSING_RESERVATION");
        }
        const updated = await tx.job.update({
          where: { id: params.jobId },
          data: {
            status: $Enums.JobStatus.FAILED,
            error: errorText,
          },
          select: RELEASED_JOB_SELECT,
        });
        const creditRefunded = refundCreditIfEligible
          ? await tryClaimCreditRefund(tx, {
              jobId: params.jobId,
              userId: job.userId,
              now,
            })
          : false;
        return {
          ok: true,
          outcome: "no_reservation",
          job: updated,
          creditRefunded,
        } as ReleaseResult;
      }

      // ── PLAN_MINUTES path ────────────────────────────────────────────
      if (job.usageFinalizedAt) {
        // Reservation was already finalized (Phase 3B territory) — must
        // never release on top. Never both timestamps set.
        throw new ReleaseRejectError("ALREADY_FINALIZED");
      }
      if (job.usageReleasedAt) {
        // Idempotent second call. No writes; return current released
        // Job fields with the *original* usageReleasedAt preserved.
        const current = await tx.job.findUnique({
          where: { id: params.jobId },
          select: RELEASED_JOB_SELECT,
        });
        // Should always exist — we just read it above under the same tx.
        if (!current) {
          throw new ReleaseRejectError("JOB_NOT_FOUND");
        }
        return {
          ok: true,
          outcome: "already_released",
          job: current,
          creditRefunded: false,
        } as ReleaseResult;
      }
      if (!job.periodUsageId) {
        // PLAN_MINUTES tagged but missing the stable mapping — cannot
        // determine which PeriodUsage row to credit back. Refuse
        // rather than guessing at the caller's current billing period.
        throw new ReleaseRejectError("MISSING_RESERVATION");
      }

      // Atomic Compare-And-Set claim. The WHERE guard is the sole
      // idempotency and race key: exactly one concurrent caller can flip
      // usageReleasedAt from NULL to a value, and that same caller owns
      // the FAILED + error write of this Job. A concurrent finalize
      // (which sets usageFinalizedAt) will see the guard fail here.
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
          status: $Enums.JobStatus.FAILED,
          error: errorText,
          usageReleasedAt: now,
        },
      });

      if (claim.count === 0) {
        // The claim can only fail if a concurrent request finalized or
        // released the Job between our findUnique and this update — the
        // pre-checks above already ruled out every other reason. Re-read
        // to distinguish and surface a controlled result.
        const stateCheck = await tx.job.findUnique({
          where: { id: params.jobId },
          select: {
            usageFinalizedAt: true,
            usageReleasedAt: true,
          },
        });
        if (stateCheck?.usageFinalizedAt) {
          throw new ReleaseRejectError("ALREADY_FINALIZED");
        }
        if (stateCheck?.usageReleasedAt) {
          const current = await tx.job.findUnique({
            where: { id: params.jobId },
            select: RELEASED_JOB_SELECT,
          });
          if (current) {
            return {
              ok: true,
              outcome: "already_released",
              job: current,
              creditRefunded: false,
            } as ReleaseResult;
          }
        }
        throw new ReleaseRejectError("CONCURRENCY_CONFLICT");
      }

      // Reverse-transfer: minutesReserved -= reservedMinutes, gated on a
      // sufficient balance so the counter can never go negative.
      // minutesUsed is deliberately not touched — releases do not
      // consume plan minutes.
      const usageUpdate = await tx.periodUsage.updateMany({
        where: {
          id: job.periodUsageId,
          minutesReserved: { gte: reservedMinutes },
        },
        data: {
          minutesReserved: { decrement: reservedMinutes },
        },
      });

      if (usageUpdate.count === 0) {
        // Distinguish "row vanished" from "balance too low" so the caller
        // can log an accurate diagnostic. In both cases the enclosing
        // throw rolls back the Job.updateMany above — the Job cannot
        // remain FAILED-with-usageReleasedAt without its usage
        // decrement, and the reservation cannot appear released
        // without the Job update.
        const existing = await tx.periodUsage.findUnique({
          where: { id: job.periodUsageId },
          select: { id: true },
        });
        if (!existing) {
          throw new ReleaseRejectError("PERIOD_USAGE_NOT_FOUND");
        }
        throw new ReleaseRejectError("RESERVED_MINUTES_UNDERFLOW");
      }

      // RP-004D1 — PLAN_MINUTES jobs never consumed a legacy User.credits
      // unit (reservation debits PeriodUsage.minutesReserved, not credits).
      // Any refund on release would therefore mint a phantom credit. We
      // short-circuit here regardless of refundCreditIfEligible so callers
      // that still pass the flag for a PLAN_MINUTES job cannot cause a
      // spurious increment. Legacy pre-TTS refunds remain intact on the
      // non-PLAN_MINUTES branch above.
      const creditRefunded = false;

      const updated = await tx.job.findUnique({
        where: { id: params.jobId },
        select: RELEASED_JOB_SELECT,
      });
      // Cannot vanish — we just updated it under the same tx.
      if (!updated) {
        throw new ReleaseRejectError("JOB_NOT_FOUND");
      }
      return {
        ok: true,
        outcome: "released",
        job: updated,
        creditRefunded,
      } as ReleaseResult;
    });
  } catch (e) {
    if (e instanceof ReleaseRejectError) {
      return { ok: false, error: e.code };
    }
    throw e;
  }
}

/**
 * Attempt to claim the credit-refund slot on a Job and, on success,
 * increment the owning User's credits by one. Runs inside the enclosing
 * interactive transaction: on any thrown error the caller's Prisma tx
 * rolls back the Job/PeriodUsage writes too.
 *
 * Idempotency is a Compare-And-Set on Job.creditRefundedAt guarded by
 *   creditRefundedAt IS NULL AND ttsStartedAt IS NULL
 * — the same product rule that lived in tryRefundCredit pre-Phase-3C.
 * Concurrent releases can both call this; exactly one wins the claim,
 * every other gets count = 0 and returns false without incrementing.
 */
async function tryClaimCreditRefund(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  params: { jobId: string; userId: string; now: Date }
): Promise<boolean> {
  const claim = await tx.job.updateMany({
    where: {
      id: params.jobId,
      creditRefundedAt: null,
      ttsStartedAt: null,
    },
    data: {
      creditRefundedAt: params.now,
    },
  });
  if (claim.count === 0) {
    return false;
  }
  await tx.user.update({
    where: { id: params.userId },
    data: { credits: { increment: 1 } },
  });
  return true;
}
