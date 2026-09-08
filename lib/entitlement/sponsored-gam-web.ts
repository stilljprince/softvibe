// lib/entitlement/sponsored-gam-web.ts
//
// F-003 Slice 1 — Google Ad Manager Rewarded Web provider-ready path.
// Curated Library Sponsored Unlocks ONLY.
//
// This module owns the *lifecycle* of a GOOGLE_AD_MANAGER_WEB
// SponsoredUnlockEvent — the server-owned state that must exist before a
// Free-tier LibraryUnlock is claimed. It is intentionally not the
// LibraryUnlock itself: the actual entitlement is still granted by the
// central `claimLibrarySessionUnlock` helper, exactly as the existing
// SIMULATED_SOFTVIBE provider already does. Both provider paths converge
// on that single grant authority; this file adds no second unlock
// lifecycle and mutates no LibraryUnlock row directly.
//
// Security model (must not drift):
//
//   * Google / GPT confirms a reward only in the browser
//     (`rewardedSlotGranted`). There is no server-to-server callback for
//     this MVP path — the browser's "reward granted" signal is an
//     authenticated-but-unverifiable client assertion, NOT cryptographic
//     provider proof. This is an accepted MVP residual risk (see
//     app/api/library/sponsored/verify/route.ts for the actually-verified
//     HMAC contract, which this module does not touch and does not
//     weaken).
//   * Every fact this module trusts is either read from the persisted
//     SponsoredUnlockEvent row or derived server-side: userId comes from
//     the authenticated session (route layer), librarySessionId comes
//     from the persisted event, provider is checked against the
//     persisted event, and expiry is checked against the server clock.
//     The browser payload for completion is only an eventId.
//
// Timing:
//
//   * `eligibleAt` is set to `now` at event creation. The 8-second
//     simulated "watch the interstitial" delay used by
//     SIMULATED_SOFTVIBE is a simulation-specific UX device, not a
//     security mechanism — GAM Web has no equivalent artificial delay.
//     Eligibility for this provider comes from the ad-reward signal, not
//     elapsed time.
//   * `expiresAt` uses the same bounded 300-second PENDING window as the
//     existing simulated event, so abandoned tabs / dangling promises
//     behave identically across providers and no new timeout policy is
//     introduced.
//
// Provider-Ready / Test mode:
//
//   * Controlled by `SPONSORED_GAM_WEB_MODE` (server env): "disabled"
//     (default), "test" or "live". Any other/missing value is
//     "disabled" — fail closed. Test mode does not "fall back" from a
//     missing live config; it must be explicitly selected.
//   * In test mode, this module still runs the full GAM backend
//     lifecycle (start → PENDING GOOGLE_AD_MANAGER_WEB event → complete
//     → claimLibrarySessionUnlock). Only the external ad-provider
//     trigger is simulated by the caller (browser) — never by falling
//     back to SIMULATED_SOFTVIBE.
//
// Provider Event ID semantics:
//
//   * Server-generated, unique, and used as `claimLibrarySessionUnlock`'s
//     idempotency key — exactly the same mechanical role as the
//     simulated provider's id. It is a correlation / idempotency id
//     WITHIN SoftVibe, never evidence that Google confirmed the reward.

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
  DAILY_UNLOCK_LIMIT,
  type ClaimLibrarySessionUnlockErrorCode,
} from "@/lib/entitlement/library-unlock";
import { localDayBoundsUtc } from "@/lib/entitlement/timezone";
import type { LibraryEffectiveAccess } from "@/lib/entitlement/library-effective-access";

/**
 * Total lifetime of a PENDING GOOGLE_AD_MANAGER_WEB event before it can
 * no longer be completed. Mirrors the existing simulated provider's
 * 300-second bound — no new timeout policy.
 */
export const GAM_WEB_EVENT_LIFETIME_SECONDS = 300;

/**
 * Server-side operating mode for the GOOGLE_AD_MANAGER_WEB provider.
 * "disabled" is the only default; "test" and "live" both require an
 * explicit, exact env value.
 */
export type SponsoredGamWebMode = "disabled" | "test" | "live";

/**
 * ENV flag controlling the GAM Web operating mode. Fails closed: any
 * missing or unrecognised value resolves to "disabled". "test" never
 * auto-activates merely because "live" configuration is absent — both
 * are equally explicit, independent selections.
 */
export function getSponsoredGamWebMode(
  env: Record<string, string | undefined> = process.env
): SponsoredGamWebMode {
  const raw = env.SPONSORED_GAM_WEB_MODE;
  if (typeof raw !== "string") return "disabled";
  const v = raw.trim().toLowerCase();
  if (v === "test") return "test";
  if (v === "live") return "live";
  return "disabled";
}

export function isSponsoredGamWebEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return getSponsoredGamWebMode(env) !== "disabled";
}

// ─── Types ────────────────────────────────────────────────────────────

export type StartGamWebEventErrorCode =
  | "PROVIDER_UNAVAILABLE"
  | "USER_NOT_FOUND"
  | "SESSION_NOT_FOUND"
  | "SESSION_INACTIVE"
  | "DAILY_UNLOCK_LIMIT_REACHED"
  | "CONCURRENCY_CONFLICT";

export type StartGamWebEventResult =
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
      outcome: "event_created" | "event_reused";
      eventId: string;
      librarySessionId: string;
      eligibleAt: Date;
      expiresAt: Date;
    }
  | { ok: false; error: StartGamWebEventErrorCode };

export type CompleteGamWebEventErrorCode =
  | "PROVIDER_UNAVAILABLE"
  | "EVENT_NOT_FOUND"
  | "EVENT_WRONG_USER"
  | "PROVIDER_MISMATCH"
  | "EVENT_EXPIRED"
  | "EVENT_CANCELLED"
  | ClaimLibrarySessionUnlockErrorCode;

export type CompleteGamWebEventResult =
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
  | { ok: false; error: CompleteGamWebEventErrorCode };

export type StartGamWebEventParams = {
  userId: string;
  librarySessionId: string;
  now?: Date;
  env?: Record<string, string | undefined>;
  /** See lib/entitlement/library-effective-access.ts. */
  effectiveAccess?: LibraryEffectiveAccess;
};

export type CompleteGamWebEventParams = {
  userId: string;
  eventId: string;
  now?: Date;
  env?: Record<string, string | undefined>;
  /** See lib/entitlement/library-effective-access.ts. */
  effectiveAccess?: LibraryEffectiveAccess;
};

// ─── Internal helpers ─────────────────────────────────────────────────

/**
 * Server-generated correlation id passed to `claimLibrarySessionUnlock`
 * as `providerEventId`. 128 bits of randomness, base64url-encoded; the
 * `gam_` prefix distinguishes GAM Web rows from the `sim_`-prefixed
 * simulated provider for audit purposes only — it carries no security
 * meaning.
 */
function makeGamWebProviderEventId(): string {
  const b = randomBytes(16);
  return `gam_${b.toString("base64url")}`;
}

function isProviderEventUniqueConflict(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { code?: unknown }).code === "P2002";
}

// ─── Start ────────────────────────────────────────────────────────────

/**
 * Begin a Google Ad Manager Web rewarded-unlock flow for a specific
 * (user, session) pair. Curated Library only. Mirrors the shape of
 * `startSimulatedSponsoredEvent` but is independent code — see the
 * top-of-file rationale for why this is not a shared abstraction.
 */
export async function startGamWebSponsoredEvent(
  params: StartGamWebEventParams,
  client: PrismaClient = defaultPrisma
): Promise<StartGamWebEventResult> {
  const now = params.now ?? new Date();
  const env = params.env ?? process.env;

  if (!isSponsoredGamWebEnabled(env)) {
    return { ok: false, error: "PROVIDER_UNAVAILABLE" };
  }

  const user = await client.user.findUnique({
    where: { id: params.userId },
    select: { plan: true, planPeriodEnd: true, timezone: true },
  });
  if (!user) return { ok: false, error: "USER_NOT_FOUND" };

  const session = await client.librarySession.findUnique({
    where: { id: params.librarySessionId },
    select: { id: true, isActive: true },
  });
  if (!session) return { ok: false, error: "SESSION_NOT_FOUND" };
  if (!session.isActive) return { ok: false, error: "SESSION_INACTIVE" };

  // Paid / ADMIN caller — no interstitial, no event. The client-supplied
  // plan/access is never trusted; this reads the same server-resolved
  // effective-access snapshot the simulated provider uses.
  const rawEffectivePlan = resolveEffectivePlan(user.plan, user.planPeriodEnd, now);
  const effectiveMode = params.effectiveAccess?.effectiveMode ?? rawEffectivePlan;
  if (effectiveMode !== "FREE") {
    return {
      ok: true,
      outcome: "direct_plan_access",
      plan: rawEffectivePlan,
      librarySessionId: session.id,
    };
  }

  // Free caller with an active unlock — no interstitial, playback
  // proceeds through the existing 8h grace window regardless of which
  // provider originally granted it.
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

  // Read-only daily-limit UX precheck. This is NOT the authoritative
  // enforcement — that remains solely inside `claimLibrarySessionUnlock`'s
  // advisory-locked transaction (see completeGamWebSponsoredEvent). This
  // check only avoids starting a new ad for a Free user who has already
  // exhausted today's new-unlock quota, so they aren't asked to watch an
  // ad that the Complete step would reject anyway. It reuses the exact
  // same day-boundary/timezone semantics as the authoritative check
  // (`localDayBoundsUtc` + `DAILY_UNLOCK_LIMIT`) so the two never disagree
  // on what "today" means. A concurrent claim from another tab/session can
  // still change the count between this read and a later Complete call —
  // that race is accepted; the atomic check in claimLibrarySessionUnlock
  // is what actually protects the limit.
  const { start: dayStart, end: dayEnd } = localDayBoundsUtc(now, user.timezone);
  const todayCount = await client.libraryUnlock.count({
    where: {
      userId: params.userId,
      unlockedAt: { gte: dayStart, lt: dayEnd },
    },
  });
  if (todayCount >= DAILY_UNLOCK_LIMIT) {
    return { ok: false, error: "DAILY_UNLOCK_LIMIT_REACHED" };
  }

  // Free locked session — create OR reuse a PENDING GAM Web event.
  // Scoped to provider = GOOGLE_AD_MANAGER_WEB so a stale SIMULATED_SOFTWARE
  // PENDING row for the same (user, session) is never touched or reused
  // by this path — the two provider event pools are independent.
  const pending = await client.sponsoredUnlockEvent.findFirst({
    where: {
      userId: params.userId,
      librarySessionId: session.id,
      provider: SponsoredUnlockProvider.GOOGLE_AD_MANAGER_WEB,
      status: SponsoredUnlockEventStatus.PENDING,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, librarySessionId: true, eligibleAt: true, expiresAt: true },
  });

  if (pending && pending.expiresAt.getTime() > now.getTime()) {
    return {
      ok: true,
      outcome: "event_reused",
      eventId: pending.id,
      librarySessionId: pending.librarySessionId,
      eligibleAt: pending.eligibleAt,
      expiresAt: pending.expiresAt,
    };
  }
  if (pending) {
    // Stale — mark expired so we don't leave dangling PENDING rows.
    // Best-effort: a concurrent CONSUMED writer wins.
    await client.sponsoredUnlockEvent.updateMany({
      where: { id: pending.id, status: SponsoredUnlockEventStatus.PENDING },
      data: { status: SponsoredUnlockEventStatus.EXPIRED },
    });
  }

  const eligibleAt = now;
  const expiresAt = new Date(now.getTime() + GAM_WEB_EVENT_LIFETIME_SECONDS * 1000);
  try {
    const created = await client.sponsoredUnlockEvent.create({
      data: {
        userId: params.userId,
        librarySessionId: session.id,
        provider: SponsoredUnlockProvider.GOOGLE_AD_MANAGER_WEB,
        status: SponsoredUnlockEventStatus.PENDING,
        providerEventId: makeGamWebProviderEventId(),
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
    };
  } catch (e) {
    if (isProviderEventUniqueConflict(e)) {
      return { ok: false, error: "CONCURRENCY_CONFLICT" };
    }
    throw e;
  }
}

// ─── Complete ─────────────────────────────────────────────────────────

/**
 * Complete a previously started GAM Web event and claim the underlying
 * LibraryUnlock via the central helper.
 *
 * Guarantees:
 *
 *   * Only the owning user may complete the event; EVENT_WRONG_USER
 *     otherwise.
 *   * The event's persisted provider must be GOOGLE_AD_MANAGER_WEB;
 *     otherwise PROVIDER_MISMATCH — this route can never consume a
 *     SIMULATED_SOFTWARE event or vice versa.
 *   * `librarySessionId` is derived from the persisted event, never
 *     from the caller.
 *   * A CONSUMED event replays the same LibraryUnlock outcome
 *     idempotently via the shared providerEventId lookup in the central
 *     claim helper — duplicate completion never creates a second
 *     unlock.
 */
export async function completeGamWebSponsoredEvent(
  params: CompleteGamWebEventParams,
  client: PrismaClient = defaultPrisma
): Promise<CompleteGamWebEventResult> {
  const now = params.now ?? new Date();
  const env = params.env ?? process.env;

  if (!isSponsoredGamWebEnabled(env)) {
    return { ok: false, error: "PROVIDER_UNAVAILABLE" };
  }

  const event = await client.sponsoredUnlockEvent.findUnique({
    where: { id: params.eventId },
    select: {
      id: true,
      userId: true,
      librarySessionId: true,
      provider: true,
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
  if (event.provider !== SponsoredUnlockProvider.GOOGLE_AD_MANAGER_WEB) {
    return { ok: false, error: "PROVIDER_MISMATCH" };
  }

  // Effective-mode short-circuit — mirrors the simulated provider so a
  // caller whose Library mode flipped to paid/ADMIN mid-flow never
  // drives a LibraryUnlock claim or a CONSUMED transition.
  if (params.effectiveAccess && params.effectiveAccess.effectiveMode !== "FREE") {
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
  if (
    event.status === SponsoredUnlockEventStatus.PENDING &&
    now.getTime() >= event.expiresAt.getTime()
  ) {
    await client.sponsoredUnlockEvent.updateMany({
      where: { id: event.id, status: SponsoredUnlockEventStatus.PENDING },
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

  if (result.outcome !== "direct_plan_access") {
    await client.sponsoredUnlockEvent.updateMany({
      where: {
        id: event.id,
        status: {
          in: [SponsoredUnlockEventStatus.PENDING, SponsoredUnlockEventStatus.COMPLETED],
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

  return {
    ok: true,
    outcome: "direct_plan_access",
    plan: result.plan,
    librarySessionId: event.librarySessionId,
  };
}
