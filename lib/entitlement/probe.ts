// lib/entitlement/probe.ts
//
// RP-010 Phase 4A — Free Probe Enforcement (Write Side).
//
// Central write-side helper that claims one of the user's two lifetime Free
// Probe Generations and creates the backing Job atomically. This module owns
// the claim half of the probe lifecycle; the counter is never decremented by
// this file, and no restoration policy is implemented in this phase (see the
// "Failure lifecycle" note at the bottom of this comment).
//
// Four invariants matter here — they mirror the Phase 3A reservation contract
// so the two admission paths look and reason the same:
//
//   * The probe counter increment and Job.create run inside a single Prisma
//     interactive transaction. If any step fails the whole transaction rolls
//     back — so a bumped probeGenerationsUsed can never remain without its
//     matching Job, and a Job tagged `entitlementKind = PROBE` cannot exist
//     without a matching User.probeGenerationsUsed increment.
//
//   * The lifetime cap is enforced atomically. The counter is only committed
//     when
//         probeGenerationsUsed < PROBE_LIFETIME_LIMIT
//     against the *current committed row*, not a pre-transaction snapshot.
//     This is achieved with a conditional `updateMany` whose WHERE clause
//     asserts `probeGenerationsUsed { lt: PROBE_LIFETIME_LIMIT }`; under
//     PostgreSQL READ COMMITTED the WHERE clause is re-evaluated after any
//     concurrent conflicting UPDATE commits, so N concurrent writers cannot
//     all succeed and push the total past the lifetime limit.
//
//   * Probe admission is gated on the *effective* plan, computed with the
//     already-blessed resolveEffectivePlan pure function. An expired paid
//     plan resolves to FREE and therefore gets the probe path; an active
//     paid plan is refused with NOT_FREE_PLAN so this path can never overlap
//     with the PLAN_MINUTES reservation path.
//
//   * Duration is enforced server-side: 60–480 seconds inclusive. A
//     manipulated client cannot request a 20-minute probe. Non-finite,
//     null, undefined or out-of-range inputs surface INVALID_PROBE_DURATION
//     rather than being silently coerced. The 8-minute upper bound is the
//     primary cost-protection boundary; the 1-minute floor lets Free users
//     freely explore any short duration in the approved probe range.
//
// This module MUST remain narrowly scoped:
//   - no PeriodUsage read / write (probes are wholly separate from monthly
//     Custom Minutes)
//   - no credit read / write (probes do not consume credits)
//   - no Library Unlock or audio-authorization interaction
//   - no Stripe I/O
//
// Failure lifecycle: in Phase 4A a technical failure that finalises the Job
// as FAILED after the counter has been claimed does *not* return the counter
// to the user. The existing release.ts flow does not know about probe counters
// and this phase intentionally does not extend it. See the closing report for
// the follow-up run that considers whether — and how — an aborted probe
// should refund its lifetime slot.

import { EntitlementKind } from "@prisma/client";
import type { Plan, PrismaClient, Job } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { resolveEffectivePlan } from "@/lib/entitlement/resolver";
import { PROBE_LIFETIME_LIMIT } from "@/lib/entitlement/plan";

/** Server-enforced lower bound on probe duration (1 minute). */
export const PROBE_MIN_DURATION_SEC = 60;
/** Server-enforced upper bound on probe duration (8 minutes). */
export const PROBE_MAX_DURATION_SEC = 480;

/**
 * Data required to create the backing Job. Mirrors the reservation helper's
 * shape so the /api/jobs POST handler can build one payload and hand it to
 * whichever admission path applies.
 */
export type ProbeJobCreateData = {
  userId: string;
  prompt: string;
  preset: string | null;
  status: Job["status"];
  durationSec: number | null;
  title: string;
  language: string;
  voiceGender: string;
  voiceStyle: string;
  narrativeMode: string | null;
  scriptOverride: string | null;
};

export type ProbeClaimErrorCode =
  | "USER_NOT_FOUND"
  | "NOT_FREE_PLAN"
  | "PROBE_LIMIT_REACHED"
  | "INVALID_PROBE_DURATION"
  | "CONCURRENCY_CONFLICT";

export type ClaimProbeAndCreateJobResult =
  | {
      ok: true;
      job: Pick<Job, "id" | "status" | "title" | "prompt">;
      /** Value of probeGenerationsUsed AFTER this successful claim. */
      probeGenerationsUsed: number;
    }
  | { ok: false; error: ProbeClaimErrorCode };

/**
 * Pure server-side duration guard. Rejects anything outside 60..480 s and
 * anything not a positive finite integer-ish number. Used at the top of the
 * transaction so the counter is never touched for an invalid request.
 */
export function isValidProbeDuration(
  durationSec: number | null | undefined
): boolean {
  if (durationSec == null) return false;
  if (typeof durationSec !== "number") return false;
  if (!Number.isFinite(durationSec)) return false;
  if (durationSec < PROBE_MIN_DURATION_SEC) return false;
  if (durationSec > PROBE_MAX_DURATION_SEC) return false;
  return true;
}

/**
 * Pure decision helper. Given a persisted plan + period end and the current
 * time, decide whether the caller is on the probe path. Exposed for tests
 * and for the /api/jobs handler's dispatch — see canUseProbePath().
 */
export function isOnProbePath(
  plan: Plan,
  planPeriodEnd: Date | null,
  now: Date = new Date()
): boolean {
  return resolveEffectivePlan(plan, planPeriodEnd, now) === "FREE";
}

/**
 * Internal signal used to abort the transaction with a caller-visible reason.
 * Prisma's interactive `$transaction` rolls back on throw — we lean on that
 * so a rejected claim cannot leak a committed counter bump or a half-written
 * Job row.
 */
class ProbeClaimRejectError extends Error {
  constructor(public readonly code: ProbeClaimErrorCode) {
    super(code);
    this.name = "ProbeClaimRejectError";
  }
}

/**
 * Atomically claim one lifetime Free Probe Generation and create the backing
 * Job.
 *
 * The whole operation runs inside a single Prisma interactive transaction:
 *
 *   1. Load the user's persisted plan, period boundaries and the current
 *      probeGenerationsUsed value.
 *   2. Reject INVALID_PROBE_DURATION *before* any write so a manipulated
 *      client cannot even bump the counter with an out-of-range request.
 *   3. Compute the effective plan (resolveEffectivePlan). Any non-FREE
 *      effective plan aborts with NOT_FREE_PLAN — the probe path is Free-only.
 *   4. Attempt a conditional `updateMany` that increments
 *      probeGenerationsUsed by 1 only when the current row satisfies
 *        probeGenerationsUsed { lt: PROBE_LIFETIME_LIMIT }
 *      — combined with the row-lock semantics of PostgreSQL READ COMMITTED,
 *      this is the atomic lifetime gate. If zero rows match the transaction
 *      aborts as PROBE_LIMIT_REACHED.
 *   5. Create the Job with `entitlementKind = PROBE` and null reservation
 *      fields.
 *
 * If any step throws, Prisma rolls back the entire transaction: no counter
 * bump remains, no Job remains, no orphan writes leak. Concurrency between
 * two racing claimers with a counter of 0 is handled by the DB — both
 * `updateMany`s serialise on the same row, so at most PROBE_LIFETIME_LIMIT
 * writers ever see `count = 1`.
 */
export async function claimProbeAndCreateJob(
  params: {
    userId: string;
    jobData: ProbeJobCreateData;
    durationSec: number | null;
    now?: Date;
  },
  client: PrismaClient = defaultPrisma
): Promise<ClaimProbeAndCreateJobResult> {
  try {
    return await client.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: params.userId },
        select: {
          plan: true,
          planPeriodEnd: true,
          probeGenerationsUsed: true,
        },
      });
      if (!user) throw new ProbeClaimRejectError("USER_NOT_FOUND");

      // Duration guard runs before any write. An out-of-range request must
      // never bump the counter, even transiently.
      if (!isValidProbeDuration(params.durationSec)) {
        throw new ProbeClaimRejectError("INVALID_PROBE_DURATION");
      }

      const now = params.now ?? new Date();
      const effectivePlan = resolveEffectivePlan(
        user.plan,
        user.planPeriodEnd,
        now
      );
      if (effectivePlan !== "FREE") {
        throw new ProbeClaimRejectError("NOT_FREE_PLAN");
      }

      // Atomic lifetime gate. The `lt` bound is re-evaluated by Postgres
      // against the current committed row under READ COMMITTED, so N
      // concurrent claimers cannot all squeeze past PROBE_LIFETIME_LIMIT.
      // Snapshot value is fine to read outside a lock: it's used purely for
      // audit / return-value purposes; the authoritative counter change is
      // this updateMany.
      const claim = await tx.user.updateMany({
        where: {
          id: params.userId,
          probeGenerationsUsed: { lt: PROBE_LIFETIME_LIMIT },
        },
        data: {
          probeGenerationsUsed: { increment: 1 },
        },
      });

      if (claim.count === 0) {
        // Two cases collapse into the same rejection here:
        //   (a) counter is already at the limit → definite refusal
        //   (b) counter is already >  the limit (should not happen but is
        //       still a refusal). The rejection is deterministic; no write
        //       is attempted to "correct" (b) because that would be a
        //       silent product-rule change.
        throw new ProbeClaimRejectError("PROBE_LIMIT_REACHED");
      }

      // The counter has been claimed. Job.create runs inside the same
      // transaction — any failure propagates and rolls the claim back.
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
          entitlementKind: EntitlementKind.PROBE,
          reservedMinutes: null,
          periodUsageId: null,
        },
        select: { id: true, status: true, title: true, prompt: true },
      });

      return {
        ok: true,
        job,
        // snapshot + 1 is safe: the atomic claim above proved the counter was
        // strictly < PROBE_LIFETIME_LIMIT and incremented it by exactly 1.
        probeGenerationsUsed: user.probeGenerationsUsed + 1,
      } as ClaimProbeAndCreateJobResult;
    });
  } catch (e) {
    if (e instanceof ProbeClaimRejectError) {
      return { ok: false, error: e.code };
    }
    throw e;
  }
}
