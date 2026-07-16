// lib/entitlement/probe-restoration.ts
//
// RP-010 Phase 4A-2 — Probe Restoration on Technical Failure (Write Side).
//
// Central write-side helper that returns a previously-claimed lifetime Free
// Probe Generation slot when the backing Job terminates with a non-success
// state (FAILED). Owns the restoration half of the probe lifecycle; the
// claim half lives in lib/entitlement/probe.ts.
//
// The core product rule: a probe attempt is only "spent" if the Job reaches
// DONE. Any terminal FAILED (script failure, safety refusal, TTS failure,
// audio-storage failure, stale-recovery, manual /fail) atomically returns
// the counter by exactly one — regardless of whether ttsStartedAt was set.
// Successful probes stay spent forever; no restoration path applies to a
// DONE job.
//
// Five invariants matter here — deliberately shaped like release.ts /
// finalization.ts so the three lifecycle halves reason the same way:
//
//   * Job.probeRestoredAt, the terminal FAILED write (when the caller
//     requests it) and the User.probeGenerationsUsed decrement all commit
//     together inside a single Prisma interactive transaction. If any step
//     fails the whole transaction rolls back — so a Job cannot appear
//     restored without its matching counter decrement, and a counter cannot
//     be decremented without the matching Job.probeRestoredAt persisted
//     alongside it.
//
//   * A single Compare-And-Set claim on the Job protects against double
//     restoration AND against restoration-after-success. The `updateMany`
//     guard sets probeRestoredAt (and, when persistFailedStatus is true,
//     status = FAILED + error) only when the current row satisfies
//         entitlementKind  = PROBE
//     AND status          != DONE
//     AND probeRestoredAt  IS NULL
//     — the DB serialises concurrent updates on the same row, so at most
//     one caller can win the claim. A concurrent success write (finalize on
//     a mis-tagged Job, or a manual DONE write) will flip status to DONE,
//     and the loser's CAS returns count = 0.
//
//   * The counter decrement is itself a numeric-bound `updateMany` (guarded
//     by probeGenerationsUsed > 0) so the counter can never go negative.
//     A shortage surfaces as a controlled PROBE_COUNTER_UNDERFLOW and rolls
//     the Job.probeRestoredAt write back — no silent data correction.
//
//   * This module MUST NOT touch: User.credits, Job.creditRefundedAt,
//     PeriodUsage.*, Job.reservedMinutes, Job.periodUsageId,
//     Job.usageFinalizedAt, Job.usageReleasedAt, LibraryUnlock. Probe
//     restoration is its own bucket; the credits / plan-minutes / library
//     lifecycles have their own release semantics that must remain
//     authoritative for their bucket.
//
//   * Non-PROBE Jobs are a controlled no-op (NOT_PROBE_JOB error). This
//     module never falls through to the release / finalize helpers — the
//     caller must dispatch on entitlementKind and route PLAN_MINUTES /
//     legacy Jobs through release.ts (which itself keeps PLAN_MINUTES and
//     no_reservation branches).
//
// The atomic reverse-transfer is:
//     User.probeGenerationsUsed  -=  1     (guarded by > 0)
//     Job.probeRestoredAt         =  now   (CAS on NULL)
//     Job.status                  =  FAILED  (only if persistFailedStatus)
//     Job.error                   =  errorText  (only if persistFailedStatus)

import type { PrismaClient, Job } from "@prisma/client";
import { $Enums } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";

/**
 * Fields the caller wants echoed back on the restored Job. Kept small on
 * purpose: restoration is a terminal helper, not a general Job reader.
 */
export type RestoredJobFields = Pick<
  Job,
  "id" | "status" | "error" | "probeRestoredAt"
>;

export type ProbeRestorationOutcome =
  /** PROBE Job — slot returned and (optionally) FAILED persisted. */
  | "restored"
  /**
   * PROBE Job whose slot was already returned by a prior request. No
   * writes performed; probeRestoredAt preserved. Idempotent second call.
   */
  | "already_restored";

export type ProbeRestorationErrorCode =
  | "JOB_NOT_FOUND"
  | "NOT_PROBE_JOB"
  | "ALREADY_COMPLETED"
  | "PROBE_COUNTER_UNDERFLOW"
  | "USER_NOT_FOUND"
  | "CONCURRENCY_CONFLICT";

export type ProbeRestorationResult =
  | {
      ok: true;
      outcome: ProbeRestorationOutcome;
      job: RestoredJobFields;
      /**
       * True iff this call actually decremented probeGenerationsUsed. False
       * on the already_restored branch (no writes fire).
       */
      counterRestored: boolean;
    }
  | { ok: false; error: ProbeRestorationErrorCode };

/**
 * Internal signal used to abort a transaction with a caller-visible reason.
 * Prisma's interactive `$transaction` rolls back on throw — we lean on that
 * so a rejected restoration cannot leak a committed counter write or a
 * half-updated Job.
 */
class ProbeRestorationRejectError extends Error {
  constructor(public readonly code: ProbeRestorationErrorCode) {
    super(code);
    this.name = "ProbeRestorationRejectError";
  }
}

const RESTORED_JOB_SELECT = {
  id: true,
  status: true,
  error: true,
  probeRestoredAt: true,
} as const;

/**
 * Atomically return the probe slot of a PROBE Job that terminates with a
 * technical or content-safety failure, and (optionally) persist the Job's
 * terminal FAILED state in the same transaction.
 *
 * The whole operation runs inside a single Prisma interactive transaction:
 *
 *   1. Load the Job. Reject JOB_NOT_FOUND if missing.
 *   2. Reject NOT_PROBE_JOB if entitlementKind ≠ PROBE.
 *   3. Reject ALREADY_COMPLETED if status = DONE (a successful probe
 *      cannot be restored).
 *   4. Short-circuit `already_restored` if probeRestoredAt is already set
 *      — the counter was returned by a prior call, and repeating the call
 *      must not touch the counter or the timestamp again.
 *   5. CAS: `updateMany` that sets probeRestoredAt (and, when
 *      persistFailedStatus is true, status = FAILED + error) only when
 *      entitlementKind = PROBE, probeRestoredAt IS NULL, status ≠ DONE.
 *      Zero-count outcome distinguished by a follow-up read.
 *   6. `updateMany` on User: decrement probeGenerationsUsed by 1 only when
 *      probeGenerationsUsed > 0. Zero-count → PROBE_COUNTER_UNDERFLOW,
 *      which throws and rolls the Job CAS back.
 *   7. Return current Job fields.
 *
 * The `persistFailedStatus` flag lets the caller decouple restoration from
 * the FAILED status write when they own the status transition themselves
 * (e.g., after release.ts already persisted FAILED for a legacy Job that
 * happens to be PROBE-tagged, or when the caller only wants to attempt
 * restoration without changing status). When true, the CAS additionally
 * writes status = FAILED and error. When false, only the restoration
 * timestamp and counter decrement fire — status is left untouched.
 */
export async function restoreProbeOnTerminalFailure(
  params: {
    jobId: string;
    /**
     * When true (default), the CAS additionally sets status = FAILED and
     * error inside the same transaction so restoration and the terminal
     * FAILED write commit atomically. When false, only probeRestoredAt and
     * the counter decrement fire — caller owns the status transition.
     */
    persistFailedStatus?: boolean;
    /**
     * Optional error text written when persistFailedStatus is true. Ignored
     * when persistFailedStatus is false. Passed through to Job.error.
     */
    error?: string | null;
    now?: Date;
  },
  client: PrismaClient = defaultPrisma
): Promise<ProbeRestorationResult> {
  const now = params.now ?? new Date();
  const persistFailedStatus = params.persistFailedStatus !== false;
  const errorText = params.error ?? null;
  try {
    return await client.$transaction(async (tx) => {
      const job = await tx.job.findUnique({
        where: { id: params.jobId },
        select: {
          id: true,
          userId: true,
          status: true,
          entitlementKind: true,
          probeRestoredAt: true,
        },
      });
      if (!job) {
        throw new ProbeRestorationRejectError("JOB_NOT_FOUND");
      }

      if (job.entitlementKind !== $Enums.EntitlementKind.PROBE) {
        // Non-PROBE Jobs (PLAN_MINUTES, legacy, admin-untagged) belong to
        // release.ts / finalization.ts. Refuse rather than accidentally
        // decrementing a counter for the wrong bucket.
        throw new ProbeRestorationRejectError("NOT_PROBE_JOB");
      }

      if (job.status === $Enums.JobStatus.DONE) {
        // Successful probes are permanently spent. This branch also
        // protects against a late failure signal arriving after finalize
        // succeeded (should not happen in the current lifecycle, but the
        // check is cheap and forecloses the entire class of bug).
        throw new ProbeRestorationRejectError("ALREADY_COMPLETED");
      }

      if (job.probeRestoredAt) {
        // Idempotent second call. Return the existing state without any
        // writes — the counter was returned by the prior call and must
        // stay put.
        const current = await tx.job.findUnique({
          where: { id: params.jobId },
          select: RESTORED_JOB_SELECT,
        });
        if (!current) {
          throw new ProbeRestorationRejectError("JOB_NOT_FOUND");
        }
        return {
          ok: true,
          outcome: "already_restored",
          job: current,
          counterRestored: false,
        } as ProbeRestorationResult;
      }

      // Atomic Compare-And-Set claim. The WHERE guard is the sole
      // idempotency and race key: exactly one concurrent caller can flip
      // probeRestoredAt from NULL to a value, and that same caller (when
      // persistFailedStatus is true) owns the FAILED + error write of
      // this Job. Two parallel callers cannot both succeed — the loser's
      // CAS returns count = 0. A concurrent success write (status = DONE)
      // similarly disqualifies the loser through the `not: DONE` guard.
      const claimData: {
        probeRestoredAt: Date;
        status?: $Enums.JobStatus;
        error?: string | null;
      } = { probeRestoredAt: now };
      if (persistFailedStatus) {
        claimData.status = $Enums.JobStatus.FAILED;
        claimData.error = errorText;
      }
      const claim = await tx.job.updateMany({
        where: {
          id: params.jobId,
          entitlementKind: $Enums.EntitlementKind.PROBE,
          probeRestoredAt: null,
          status: { not: $Enums.JobStatus.DONE },
        },
        data: claimData,
      });

      if (claim.count === 0) {
        // The claim can only fail if a concurrent request restored the Job
        // or a status transition to DONE landed between our findUnique and
        // this update. Re-read to distinguish and surface a controlled
        // result.
        const post = await tx.job.findUnique({
          where: { id: params.jobId },
          select: {
            status: true,
            probeRestoredAt: true,
          },
        });
        if (post?.status === $Enums.JobStatus.DONE) {
          throw new ProbeRestorationRejectError("ALREADY_COMPLETED");
        }
        if (post?.probeRestoredAt) {
          const current = await tx.job.findUnique({
            where: { id: params.jobId },
            select: RESTORED_JOB_SELECT,
          });
          if (current) {
            return {
              ok: true,
              outcome: "already_restored",
              job: current,
              counterRestored: false,
            } as ProbeRestorationResult;
          }
        }
        throw new ProbeRestorationRejectError("CONCURRENCY_CONFLICT");
      }

      // Counter decrement, gated by a positive balance so the counter can
      // never go negative. `updateMany` returns count = 0 if either the
      // User row vanished mid-tx or the counter is already at 0 — both
      // roll back via a controlled throw so the Job CAS above cannot
      // remain committed without its matching counter decrement.
      const counterUpdate = await tx.user.updateMany({
        where: {
          id: job.userId,
          probeGenerationsUsed: { gt: 0 },
        },
        data: {
          probeGenerationsUsed: { decrement: 1 },
        },
      });

      if (counterUpdate.count === 0) {
        // Distinguish "user vanished" from "counter already 0" so the
        // caller can log an accurate diagnostic. In both cases the
        // enclosing throw rolls back the Job.updateMany above — the Job
        // cannot remain restored without its matching counter decrement.
        const existing = await tx.user.findUnique({
          where: { id: job.userId },
          select: { id: true },
        });
        if (!existing) {
          throw new ProbeRestorationRejectError("USER_NOT_FOUND");
        }
        throw new ProbeRestorationRejectError("PROBE_COUNTER_UNDERFLOW");
      }

      const updated = await tx.job.findUnique({
        where: { id: params.jobId },
        select: RESTORED_JOB_SELECT,
      });
      if (!updated) {
        throw new ProbeRestorationRejectError("JOB_NOT_FOUND");
      }
      return {
        ok: true,
        outcome: "restored",
        job: updated,
        counterRestored: true,
      } as ProbeRestorationResult;
    });
  } catch (e) {
    if (e instanceof ProbeRestorationRejectError) {
      return { ok: false, error: e.code };
    }
    throw e;
  }
}
