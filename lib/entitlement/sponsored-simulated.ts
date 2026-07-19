// lib/entitlement/sponsored-simulated.ts
//
// RP-004E1 — Simulated Sponsored Unlock service (provider-neutral core).
//
// This module owns the *lifecycle* of a SponsoredUnlockEvent — the
// server-owned interstitial state that must exist before a Free-tier
// LibraryUnlock is claimed. It is intentionally not the LibraryUnlock
// itself: the actual entitlement is still granted by the central
// `claimLibrarySessionUnlock` helper (Phase 4B-1), which the completion
// path calls with the server-generated `providerEventId`.
//
// Provider independence:
//
//   * The `provider` column on SponsoredUnlockEvent is an enum today
//     containing only SIMULATED_SOFTVIBE. RP-004E2 will introduce real
//     provider values (e.g. AD_MANAGER_X) via an additive enum change
//     and reuse the same start/complete service shape.
//   * No React import, no route import, no HTTP concern — this module
//     is a pure prisma-and-time service so future providers can call it
//     from a server-verified webhook handler without a browser round-trip.
//
// Feature flag:
//
//   * `SIMULATED_SPONSORED_UNLOCK_ENABLED` (env). When missing or falsy
//     the start / complete entry points return NOT_AVAILABLE. Paid
//     direct access and active-unlock playback continue to work in that
//     state — see the /api/library/sponsored/simulated/* routes.
//
// Timing constants (kept server-owned so a manipulated client can never
// change them):
//
//   * SIMULATED_VISIBLE_MINIMUM_SECONDS  — 8s. Completion is rejected
//     before eligibleAt = createdAt + 8s.
//   * SIMULATED_EVENT_LIFETIME_SECONDS   — 300s (5 min). Completion is
//     rejected after expiresAt = createdAt + 300s; the event transitions
//     out of PENDING on the next start/complete for the same session.
//
// Concurrency model:
//
//   * Start reuses an existing PENDING event for the same
//     (user, session) if it is still valid — this keeps browser
//     reload / re-open flows from creating an unbounded pending stack.
//     Stale (expired) PENDING events are transitioned to EXPIRED
//     opportunistically on read.
//   * Complete runs inside a transaction that (a) re-checks the event
//     status, (b) invokes `claimLibrarySessionUnlock` — which owns its
//     own advisory lock, daily-limit gate, and providerEventId
//     uniqueness — and (c) sets consumedAt/status=CONSUMED under the
//     same transaction.
//   * Retries are idempotent: a CONSUMED event replays the same
//     LibraryUnlock outcome via the shared providerEventId lookup in
//     the central claim helper.
//
// System separation preserved:
//
//   * This module never reads or writes User.credits,
//     User.probeGenerationsUsed, PeriodUsage, Job, Track or Story.
//     Only SponsoredUnlockEvent, LibraryUnlock (via central helper),
//     LibrarySession, User.plan / planPeriodEnd / timezone.

import {
  SponsoredUnlockEventStatus,
  SponsoredUnlockProvider,
  type Plan,
  type PrismaClient,
} from "@prisma/client";
import { randomBytes } from "node:crypto";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { resolveEffectivePlan } from "@/lib/entitlement/resolver";
import {
  claimLibrarySessionUnlock,
  type ClaimLibrarySessionUnlockErrorCode,
} from "@/lib/entitlement/library-unlock";
import type { LibraryEffectiveAccess } from "@/lib/entitlement/library-effective-access";

/**
 * Minimum server-observed lifetime (in seconds) before an event may be
 * completed. Backs the visible interstitial duration and is used verbatim
 * as `eligibleAt = createdAt + this`. Server-owned so a manipulated
 * client cannot shortcut it.
 */
export const SIMULATED_VISIBLE_MINIMUM_SECONDS = 8;

/**
 * Total lifetime of a PENDING event before it can no longer be
 * completed. Bounds abandoned tabs / dangling promises to a small
 * window (5 minutes) so we never accumulate arbitrarily old rows.
 */
export const SIMULATED_EVENT_LIFETIME_SECONDS = 300;

/**
 * ENV flag controlling whether the simulated adapter is active. The
 * check happens at request time via `isSimulatedSponsoredUnlockEnabled`
 * so tests can flip it without process restart.
 */
export function isSimulatedSponsoredUnlockEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const raw = env.SIMULATED_SPONSORED_UNLOCK_ENABLED;
  if (typeof raw !== "string") return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

// ─── Types ────────────────────────────────────────────────────────────

export type StartSponsoredEventErrorCode =
  | "SIMULATION_DISABLED"
  | "USER_NOT_FOUND"
  | "SESSION_NOT_FOUND"
  | "SESSION_INACTIVE"
  | "CONCURRENCY_CONFLICT";

export type StartSponsoredEventResult =
  | {
      ok: true;
      outcome: "direct_plan_access";
      plan: Plan;
      librarySessionId: string;
    }
  | {
      ok: true;
      outcome: "active_unlock";
      librarySessionId: string;
      unlockExpiresAt: Date;
    }
  | {
      ok: true;
      outcome: "event_created";
      eventId: string;
      librarySessionId: string;
      eligibleAt: Date;
      expiresAt: Date;
      minimumDurationSeconds: number;
    }
  | {
      ok: true;
      outcome: "event_reused";
      eventId: string;
      librarySessionId: string;
      eligibleAt: Date;
      expiresAt: Date;
      minimumDurationSeconds: number;
    }
  | { ok: false; error: StartSponsoredEventErrorCode };

export type CompleteSponsoredEventErrorCode =
  | "SIMULATION_DISABLED"
  | "EVENT_NOT_FOUND"
  | "EVENT_WRONG_USER"
  | "EVENT_TOO_EARLY"
  | "EVENT_EXPIRED"
  | "EVENT_CANCELLED"
  | ClaimLibrarySessionUnlockErrorCode;

export type CompleteSponsoredEventResult =
  | {
      ok: true;
      outcome: "created";
      unlockId: string;
      librarySessionId: string;
      unlockedAt: Date;
      expiresAt: Date;
    }
  | {
      ok: true;
      outcome: "reused";
      unlockId: string;
      librarySessionId: string;
      unlockedAt: Date;
      expiresAt: Date;
    }
  | {
      ok: true;
      outcome: "direct_plan_access";
      plan: Plan;
      librarySessionId: string;
    }
  | { ok: false; error: CompleteSponsoredEventErrorCode };

export type StartSponsoredEventParams = {
  userId: string;
  librarySessionId: string;
  provider?: SponsoredUnlockProvider;
  now?: Date;
  env?: Record<string, string | undefined>;
  /**
   * Optional precomputed effective-access snapshot. When supplied, its
   * `effectiveMode` supersedes the raw plan calculation — a paid /
   * ADMIN mode short-circuits to `direct_plan_access` without ever
   * creating a SponsoredUnlockEvent. Omitting the field preserves the
   * ordinary plan-based behaviour used by legacy tests.
   */
  effectiveAccess?: LibraryEffectiveAccess;
};

export type CompleteSponsoredEventParams = {
  userId: string;
  eventId: string;
  now?: Date;
  env?: Record<string, string | undefined>;
  /** See StartSponsoredEventParams.effectiveAccess. */
  effectiveAccess?: LibraryEffectiveAccess;
};

// ─── Internal helpers ─────────────────────────────────────────────────

/**
 * Server-generated correlation id passed to `claimLibrarySessionUnlock`
 * as `providerEventId`. Uses 128 bits of randomness base64url-encoded —
 * uniqueness is enforced by the DB unique index on
 * SponsoredUnlockEvent.providerEventId AND LibraryUnlock.providerEventId
 * (both are unique, and the value crosses both models).
 *
 * The prefix `sim_` marks the value as originating from the simulation
 * so future audits can distinguish it from RP-004E2 real-provider rows.
 */
function makeProviderEventId(): string {
  const b = randomBytes(16);
  return `sim_${b.toString("base64url")}`;
}

/**
 * Build the outcome shape for a "start" call that observes a currently
 * valid PENDING event and reuses it instead of creating a new row.
 */
function shapeExistingPendingEvent(
  event: {
    id: string;
    librarySessionId: string;
    eligibleAt: Date;
    expiresAt: Date;
  }
): StartSponsoredEventResult {
  return {
    ok: true,
    outcome: "event_reused",
    eventId: event.id,
    librarySessionId: event.librarySessionId,
    eligibleAt: event.eligibleAt,
    expiresAt: event.expiresAt,
    minimumDurationSeconds: SIMULATED_VISIBLE_MINIMUM_SECONDS,
  };
}

// ─── Start ────────────────────────────────────────────────────────────

/**
 * Begin a simulated Sponsored Unlock experience for a specific
 * (user, session) pair. Returns an outcome describing what the client
 * should do:
 *
 *   * `direct_plan_access` — paid caller, no event created.
 *   * `active_unlock`       — Free caller already holds an unlock,
 *                             no event created.
 *   * `event_created`       — new PENDING event created; caller must
 *                             display the interstitial and call
 *                             completeSimulatedSponsoredEvent later.
 *   * `event_reused`        — a still-valid PENDING event exists for
 *                             this (user, session); caller may keep
 *                             running the interstitial from where it
 *                             left off.
 *
 * The client never learns internal database timings; all timestamps
 * come from the server.
 */
export async function startSimulatedSponsoredEvent(
  params: StartSponsoredEventParams,
  client: PrismaClient = defaultPrisma
): Promise<StartSponsoredEventResult> {
  const now = params.now ?? new Date();
  const env = params.env ?? process.env;
  const provider = params.provider ?? SponsoredUnlockProvider.SIMULATED_SOFTVIBE;

  if (!isSimulatedSponsoredUnlockEnabled(env)) {
    return { ok: false, error: "SIMULATION_DISABLED" };
  }

  const user = await client.user.findUnique({
    where: { id: params.userId },
    select: { plan: true, planPeriodEnd: true },
  });
  if (!user) return { ok: false, error: "USER_NOT_FOUND" };

  const session = await client.librarySession.findUnique({
    where: { id: params.librarySessionId },
    select: { id: true, isActive: true },
  });
  if (!session) return { ok: false, error: "SESSION_NOT_FOUND" };
  if (!session.isActive) return { ok: false, error: "SESSION_INACTIVE" };

  // Paid / ADMIN caller — no interstitial, no event. If the caller
  // supplied an effective-access snapshot from
  // `resolveLibraryEffectiveAccess`, its effectiveMode wins; otherwise
  // fall back to the raw plan calculation so legacy tests keep working.
  const rawEffectivePlan = resolveEffectivePlan(
    user.plan,
    user.planPeriodEnd,
    now
  );
  const effectiveMode = params.effectiveAccess?.effectiveMode ?? rawEffectivePlan;
  if (effectiveMode !== "FREE") {
    return {
      ok: true,
      outcome: "direct_plan_access",
      // `plan` remains a Plan enum (no ADMIN value). ADMIN QA callers
      // still land here — surface the real effective plan for logging.
      plan: rawEffectivePlan,
      librarySessionId: session.id,
    };
  }

  // Free caller with an active unlock — no interstitial, playback
  // proceeds through the existing 8 h grace window.
  const activeUnlock = await client.libraryUnlock.findFirst({
    where: {
      userId: params.userId,
      librarySessionId: session.id,
      expiresAt: { gt: now },
    },
    orderBy: { expiresAt: "desc" },
    select: { expiresAt: true },
  });
  if (activeUnlock) {
    return {
      ok: true,
      outcome: "active_unlock",
      librarySessionId: session.id,
      unlockExpiresAt: activeUnlock.expiresAt,
    };
  }

  // Free locked session — create OR reuse a PENDING event.
  // Look for a still-valid PENDING event for this (user, session). If
  // it's expired, transition it to EXPIRED and create a fresh row.
  const pending = await client.sponsoredUnlockEvent.findFirst({
    where: {
      userId: params.userId,
      librarySessionId: session.id,
      status: SponsoredUnlockEventStatus.PENDING,
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      librarySessionId: true,
      eligibleAt: true,
      expiresAt: true,
    },
  });

  if (pending && pending.expiresAt.getTime() > now.getTime()) {
    return shapeExistingPendingEvent(pending);
  }
  if (pending) {
    // Stale — mark expired so we don't leave dangling PENDING rows.
    // This is best-effort: any race that flips it CONSUMED first wins
    // because the update filter still requires status = PENDING.
    await client.sponsoredUnlockEvent.updateMany({
      where: { id: pending.id, status: SponsoredUnlockEventStatus.PENDING },
      data: { status: SponsoredUnlockEventStatus.EXPIRED },
    });
  }

  const eligibleAt = new Date(
    now.getTime() + SIMULATED_VISIBLE_MINIMUM_SECONDS * 1000
  );
  const expiresAt = new Date(
    now.getTime() + SIMULATED_EVENT_LIFETIME_SECONDS * 1000
  );
  try {
    const created = await client.sponsoredUnlockEvent.create({
      data: {
        userId: params.userId,
        librarySessionId: session.id,
        provider,
        status: SponsoredUnlockEventStatus.PENDING,
        providerEventId: makeProviderEventId(),
        createdAt: now,
        eligibleAt,
        expiresAt,
      },
      select: { id: true, librarySessionId: true, eligibleAt: true, expiresAt: true },
    });
    return {
      ok: true,
      outcome: "event_created",
      eventId: created.id,
      librarySessionId: created.librarySessionId,
      eligibleAt: created.eligibleAt,
      expiresAt: created.expiresAt,
      minimumDurationSeconds: SIMULATED_VISIBLE_MINIMUM_SECONDS,
    };
  } catch (e) {
    // A providerEventId collision is astronomically unlikely with 128
    // bits of randomness, but surface it as a controlled conflict so
    // the client can safely retry once.
    if (
      e &&
      typeof e === "object" &&
      (e as { code?: unknown }).code === "P2002"
    ) {
      return { ok: false, error: "CONCURRENCY_CONFLICT" };
    }
    throw e;
  }
}

// ─── Complete ─────────────────────────────────────────────────────────

/**
 * Complete a previously started simulated Sponsored Unlock event and
 * claim the underlying LibraryUnlock via the central helper.
 *
 * Guarantees:
 *
 *   * Only the owning user may complete the event; a stolen event id
 *     from another user returns EVENT_WRONG_USER.
 *   * `now < eligibleAt` returns EVENT_TOO_EARLY without ever touching
 *     the LibraryUnlock table.
 *   * `now >= expiresAt` on a PENDING event returns EVENT_EXPIRED and
 *     transitions the event to EXPIRED.
 *   * A CANCELLED event returns EVENT_CANCELLED verbatim.
 *   * A CONSUMED event replays the same LibraryUnlock outcome
 *     idempotently — the central claim helper looks up the
 *     providerEventId and returns `reused` with the same unlock row.
 *   * Session binding at completion time comes from the persisted
 *     event, never from the client payload; the event's stored
 *     librarySessionId flows straight into claimLibrarySessionUnlock.
 */
export async function completeSimulatedSponsoredEvent(
  params: CompleteSponsoredEventParams,
  client: PrismaClient = defaultPrisma
): Promise<CompleteSponsoredEventResult> {
  const now = params.now ?? new Date();
  const env = params.env ?? process.env;

  if (!isSimulatedSponsoredUnlockEnabled(env)) {
    return { ok: false, error: "SIMULATION_DISABLED" };
  }

  const event = await client.sponsoredUnlockEvent.findUnique({
    where: { id: params.eventId },
    select: {
      id: true,
      userId: true,
      librarySessionId: true,
      status: true,
      eligibleAt: true,
      expiresAt: true,
      providerEventId: true,
    },
  });
  if (!event) return { ok: false, error: "EVENT_NOT_FOUND" };
  if (event.userId !== params.userId) {
    return { ok: false, error: "EVENT_WRONG_USER" };
  }

  // Effective-mode short-circuit. When the caller's Library mode is
  // paid or ADMIN (usually because a QA admin switched away from FREE
  // mid-flow), we must NOT drive the LibraryUnlock claim: the CEO spec
  // is explicit that no SponsoredUnlockEvent transitions to CONSUMED
  // and no LibraryUnlock row is created for paid/admin modes. Report
  // `direct_plan_access` bound to the persisted event's session so the
  // client can begin direct playback.
  if (
    params.effectiveAccess &&
    params.effectiveAccess.effectiveMode !== "FREE"
  ) {
    return {
      ok: true,
      outcome: "direct_plan_access",
      plan: params.effectiveAccess.databasePlan,
      librarySessionId: event.librarySessionId,
    };
  }
  if (event.status === SponsoredUnlockEventStatus.CANCELLED) {
    return { ok: false, error: "EVENT_CANCELLED" };
  }
  if (event.status === SponsoredUnlockEventStatus.EXPIRED) {
    return { ok: false, error: "EVENT_EXPIRED" };
  }

  // Time gates apply only for the first completion attempt. Once the
  // event is CONSUMED / COMPLETED, we bypass the eligibleAt / expiresAt
  // check and let the central claim helper produce the idempotent
  // outcome — a legitimate retry after a network failure must succeed
  // long after the visible countdown ended.
  if (
    event.status === SponsoredUnlockEventStatus.PENDING &&
    now.getTime() < event.eligibleAt.getTime()
  ) {
    return { ok: false, error: "EVENT_TOO_EARLY" };
  }
  if (
    event.status === SponsoredUnlockEventStatus.PENDING &&
    now.getTime() >= event.expiresAt.getTime()
  ) {
    // Opportunistic transition — a subsequent start call would do the
    // same. Best-effort: a concurrent CONSUMED writer wins.
    await client.sponsoredUnlockEvent.updateMany({
      where: {
        id: event.id,
        status: SponsoredUnlockEventStatus.PENDING,
      },
      data: { status: SponsoredUnlockEventStatus.EXPIRED },
    });
    return { ok: false, error: "EVENT_EXPIRED" };
  }

  // Delegate to the central claim helper. It owns its own advisory
  // lock, daily-limit gate, active-unlock reuse and providerEventId
  // uniqueness — this file must not duplicate any of that logic.
  const result = await claimLibrarySessionUnlock(
    {
      userId: event.userId,
      librarySessionId: event.librarySessionId,
      providerEventId: event.providerEventId,
      now,
    },
    client
  );
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  // Mark CONSUMED on successful claim. `updateMany` with a status
  // filter is an atomic conditional write — if a concurrent retry
  // already flipped the row to CONSUMED, our update becomes a no-op
  // and we still return the correct outcome.
  if (result.outcome !== "direct_plan_access") {
    await client.sponsoredUnlockEvent.updateMany({
      where: {
        id: event.id,
        status: {
          in: [
            SponsoredUnlockEventStatus.PENDING,
            SponsoredUnlockEventStatus.COMPLETED,
          ],
        },
      },
      data: {
        status: SponsoredUnlockEventStatus.CONSUMED,
        completedAt: event.status === SponsoredUnlockEventStatus.PENDING ? now : undefined,
        consumedAt: now,
      },
    });
    return {
      ok: true,
      outcome: result.outcome,
      unlockId: result.unlockId,
      librarySessionId: result.librarySessionId,
      unlockedAt: result.unlockedAt,
      expiresAt: result.expiresAt,
    };
  }

  // direct_plan_access — the effective plan flipped between event
  // creation and completion (e.g. user upgraded in another tab).
  // Preserve the outcome verbatim but attach the persisted event's
  // librarySessionId so the caller has an authoritative binding.
  return {
    ok: true,
    outcome: "direct_plan_access",
    plan: result.plan,
    librarySessionId: event.librarySessionId,
  };
}

// ─── Cancel ───────────────────────────────────────────────────────────
//
// Cancellation is optional in RP-004E1: a PENDING event that no one
// completes simply transitions to EXPIRED on the next start call for
// the same session. The dedicated cancel helper exists so the future
// route (if we choose to add one) already has an implementation, and
// so tests can validate that a CANCELLED event never completes.

export type CancelSponsoredEventErrorCode =
  | "SIMULATION_DISABLED"
  | "EVENT_NOT_FOUND"
  | "EVENT_WRONG_USER";

export type CancelSponsoredEventResult =
  | { ok: true; alreadyTerminal: boolean }
  | { ok: false; error: CancelSponsoredEventErrorCode };

export async function cancelSimulatedSponsoredEvent(
  params: {
    userId: string;
    eventId: string;
    now?: Date;
    env?: Record<string, string | undefined>;
  },
  client: PrismaClient = defaultPrisma
): Promise<CancelSponsoredEventResult> {
  const now = params.now ?? new Date();
  const env = params.env ?? process.env;
  if (!isSimulatedSponsoredUnlockEnabled(env)) {
    return { ok: false, error: "SIMULATION_DISABLED" };
  }
  const event = await client.sponsoredUnlockEvent.findUnique({
    where: { id: params.eventId },
    select: { id: true, userId: true, status: true },
  });
  if (!event) return { ok: false, error: "EVENT_NOT_FOUND" };
  if (event.userId !== params.userId) {
    return { ok: false, error: "EVENT_WRONG_USER" };
  }
  if (event.status !== SponsoredUnlockEventStatus.PENDING) {
    return { ok: true, alreadyTerminal: true };
  }
  await client.sponsoredUnlockEvent.updateMany({
    where: { id: event.id, status: SponsoredUnlockEventStatus.PENDING },
    data: {
      status: SponsoredUnlockEventStatus.CANCELLED,
      cancelledAt: now,
    },
  });
  return { ok: true, alreadyTerminal: false };
}
