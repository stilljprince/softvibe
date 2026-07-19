// lib/entitlement/library-audio-access.ts
//
// RP-010 Phase 4C — Read-side audio authorization for curated Library
// sessions.
//
// Single source of truth for the question:
//
//   "May THIS user retrieve the audio bytes of THIS curated library
//    chapter, right now?"
//
// The resolver is strictly read-only. It never creates, updates or deletes
// any row — no LibraryUnlock write, no probe write, no PeriodUsage write,
// no credit / minute write, no Stripe call. Enforcement is meant to run
// immediately in front of the audio streaming step so that no audio bytes
// leave the server without a positive authorization outcome.
//
// Authorization rules (RP-010 Phase 4C):
//
//   * STARTER and PREMIUM users (still inside their billing period, per
//     resolveEffectivePlan / Option C) receive direct access. No
//     LibraryUnlock is required and none is consulted.
//   * FREE users (including expired paid plans that resolve to FREE) may
//     stream only if an ACTIVE LibraryUnlock exists for exactly the same
//     (userId, librarySessionId) with expiresAt > now.
//   * Inactive sessions grant no access even if an old unlock exists.
//   * An unlock for session A NEVER unlocks a chapter of session B —
//     the check keys off the chapter's actual parent session id, so a
//     mismatched (chapter, session) input is refused before any plan or
//     unlock logic runs.
//   * Anonymous (unauthenticated) callers receive AUTH_REQUIRED and no
//     database read happens.
//
// The resolver is called by /api/library/chapters/[id]/audio. Because the
// route only carries a chapter id in the URL, the resolver accepts a
// chapter id and, optionally, an expected library-session id — a future
// route shape like /api/library/sessions/[sessionId]/chapters/[chapterId]
// can pass both, and CHAPTER_SESSION_MISMATCH surfaces if they disagree.

import type { Plan, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { resolveEffectivePlan } from "@/lib/entitlement/resolver";
import type { LibraryEffectiveAccess } from "@/lib/entitlement/library-effective-access";

/**
 * Outcomes for successful and refused authorization decisions.
 *
 * Every "ok: false" carries a stable, machine-readable error code so the
 * caller can map to an HTTP status without pattern-matching on strings.
 */
export type LibraryAudioAccessErrorCode =
  | "AUTH_REQUIRED"
  | "USER_NOT_FOUND"
  | "CHAPTER_NOT_FOUND"
  | "SESSION_NOT_FOUND"
  | "SESSION_INACTIVE"
  | "CHAPTER_SESSION_MISMATCH"
  | "CHAPTER_AUDIO_UNAVAILABLE"
  | "UNLOCK_REQUIRED";

export type LibraryAudioAccessGrant = {
  librarySessionId: string;
  librarySessionChapterId: string;
  audioKey: string;
  plan: Plan;
};

export type LibraryAudioAccessResult =
  | {
      ok: true;
      outcome: "allowed_direct_plan";
      grant: LibraryAudioAccessGrant;
    }
  | {
      ok: true;
      outcome: "allowed_active_unlock";
      grant: LibraryAudioAccessGrant;
      /** Persisted unlock id — for logging only. Never a capability token. */
      unlockId: string;
      unlockExpiresAt: Date;
    }
  | { ok: false; error: LibraryAudioAccessErrorCode };

/**
 * Stable HTTP mapping for refused audio-access outcomes. Kept alongside
 * the resolver so route callers and test harnesses share exactly the
 * same mapping — a new refusal outcome cannot be introduced without a
 * matching HTTP status.
 *
 *   AUTH_REQUIRED             → 401
 *   USER_NOT_FOUND            → 401  (session refers to a purged user)
 *   CHAPTER_NOT_FOUND         → 404
 *   SESSION_NOT_FOUND         → 404
 *   SESSION_INACTIVE          → 403  (product-rule refusal)
 *   CHAPTER_SESSION_MISMATCH  → 403  (would leak cross-session access)
 *   CHAPTER_AUDIO_UNAVAILABLE → 500  (controlled server-content error)
 *   UNLOCK_REQUIRED           → 403  (client uses the code to prompt)
 */
export function httpStatusForAccessError(
  code: LibraryAudioAccessErrorCode
): number {
  switch (code) {
    case "AUTH_REQUIRED":
    case "USER_NOT_FOUND":
      return 401;
    case "CHAPTER_NOT_FOUND":
    case "SESSION_NOT_FOUND":
      return 404;
    case "SESSION_INACTIVE":
    case "CHAPTER_SESSION_MISMATCH":
    case "UNLOCK_REQUIRED":
      return 403;
    case "CHAPTER_AUDIO_UNAVAILABLE":
      return 500;
  }
}

export type ResolveLibraryAudioAccessInput = {
  /**
   * Authenticated user id, or null for an anonymous request. A null value
   * is refused at the top of the resolver — no data read happens.
   */
  userId: string | null | undefined;
  /**
   * The curated chapter the caller wants to stream. Required. The chapter
   * is the authoritative source of the parent LibrarySession id — an
   * unlock is only checked against that resolved parent, never against
   * caller-supplied metadata.
   */
  librarySessionChapterId: string;
  /**
   * Optional expected parent LibrarySession id. When provided, must match
   * the chapter's actual parent id or the resolver refuses with
   * CHAPTER_SESSION_MISMATCH. Meant for routes that carry both ids in
   * their URL (e.g. /api/library/sessions/[sessionId]/chapters/[chapterId]).
   */
  expectedLibrarySessionId?: string;
  /**
   * Precomputed effective-access snapshot from
   * `resolveLibraryEffectiveAccess`. When supplied, the resolver uses
   * its `effectiveMode` in place of `resolveEffectivePlan(user.plan, …)`,
   * which is how the QA override (admin-only, dev-only) flows into
   * this authorization step without duplicating the guard logic.
   *
   * When omitted (or provided but with `effectiveMode: undefined`
   * shape), the resolver falls back to the ordinary plan-based
   * calculation and NEVER applies an override — legacy tests keep
   * working unchanged.
   */
  effectiveAccess?: LibraryEffectiveAccess;
  /**
   * Explicit clock override for deterministic tests. Falls back to
   * `new Date()` in production callers.
   */
  now?: Date;
};

/**
 * Pure read-side authorization for curated Library chapter audio. Order
 * of checks follows the RP-010 Phase 4C recommended sequence:
 *
 *   1. Authenticated caller?
 *   2. Chapter exists?
 *   3. Chapter's parent matches expected session (if supplied)?
 *   4. Session exists and active?
 *   5. Effective plan (Option C) — paid → allow.
 *   6. Free → active unlock for (user, session) with expiresAt > now?
 *
 * The chapter is loaded BEFORE any storage IO happens in the caller, and
 * the audio key is only returned on a successful outcome — a refused
 * caller never learns the underlying S3 key.
 */
export async function resolveLibraryAudioAccess(
  input: ResolveLibraryAudioAccessInput,
  client: PrismaClient = defaultPrisma
): Promise<LibraryAudioAccessResult> {
  const now = input.now ?? new Date();

  // 1. Auth gate. No DB read on the anonymous path — a signed-out caller
  // must not be able to enumerate chapter ids by probing this endpoint.
  const userId =
    typeof input.userId === "string" && input.userId.trim() !== ""
      ? input.userId
      : null;
  if (!userId) {
    return { ok: false, error: "AUTH_REQUIRED" };
  }

  // 2. Chapter lookup. Selects only the minimum needed fields — no
  // parent-session join here; the session record is loaded separately so
  // the isActive check runs on a fresh row.
  const chapter = await client.librarySessionChapter.findUnique({
    where: { id: input.librarySessionChapterId },
    select: {
      id: true,
      librarySessionId: true,
      audioKey: true,
    },
  });
  if (!chapter) {
    return { ok: false, error: "CHAPTER_NOT_FOUND" };
  }

  // 3. Optional cross-reference: if the caller carried both a session id
  // and a chapter id, they must agree. This is where an unlock for
  // session A would otherwise leak into a chapter of session B — the
  // mismatch is refused before any plan or unlock logic runs.
  if (
    input.expectedLibrarySessionId &&
    input.expectedLibrarySessionId !== chapter.librarySessionId
  ) {
    return { ok: false, error: "CHAPTER_SESSION_MISMATCH" };
  }

  // 4. Session must exist and be active. isActive is the product-level
  // "publicly playable" flag — an inactive session revokes access even
  // if an old LibraryUnlock is still nominally within its 8-hour window.
  const session = await client.librarySession.findUnique({
    where: { id: chapter.librarySessionId },
    select: { id: true, isActive: true },
  });
  if (!session) {
    return { ok: false, error: "SESSION_NOT_FOUND" };
  }
  if (!session.isActive) {
    return { ok: false, error: "SESSION_INACTIVE" };
  }

  // Load the user AFTER the session gate so an anonymous chapter-id
  // probe can't cheaply distinguish "which user am I" — the response
  // path is identical up to this point.
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { plan: true, planPeriodEnd: true },
  });
  if (!user) {
    return { ok: false, error: "USER_NOT_FOUND" };
  }

  // Missing / empty audioKey is a curated-content data defect, not an
  // authorization refusal. Surface a distinct outcome so the route can
  // return a controlled server-side error without leaking that the
  // caller *would* have been authorized.
  if (!chapter.audioKey || chapter.audioKey.trim() === "") {
    return { ok: false, error: "CHAPTER_AUDIO_UNAVAILABLE" };
  }

  // 5. Effective plan gate (RP-010 Phase 2B-2, Option C). A paid plan
  // whose period has already ended resolves to FREE on the read side —
  // we never re-check Stripe here, we never mutate User.plan.
  //
  // If the caller supplied a precomputed effective-access snapshot
  // (Library-QA override path), its `effectiveMode` wins over the raw
  // plan calculation. ADMIN grants direct access exactly like a paid
  // plan, no LibraryUnlock consulted; FREE routes through the unlock
  // gate below just as a real FREE caller would.
  const rawEffectivePlan = resolveEffectivePlan(
    user.plan,
    user.planPeriodEnd,
    now
  );
  const effectiveMode = input.effectiveAccess?.effectiveMode ?? rawEffectivePlan;
  // The grant.plan field is a Plan enum, which currently has no ADMIN
  // value — surface the underlying real plan there for logging while
  // the effectiveMode governs the actual authorization decision.
  const grant: LibraryAudioAccessGrant = {
    librarySessionId: session.id,
    librarySessionChapterId: chapter.id,
    audioKey: chapter.audioKey,
    plan: rawEffectivePlan,
  };

  if (effectiveMode !== "FREE") {
    // STARTER / PREMIUM / ADMIN — direct access, no LibraryUnlock consulted.
    return {
      ok: true,
      outcome: "allowed_direct_plan",
      grant,
    };
  }

  // 6. FREE path — require an ACTIVE LibraryUnlock for exactly this
  // (user, session). expiresAt uses strict `> now`: at the exact
  // millisecond of expiry the unlock is considered gone (the product
  // rule is "8 hours from unlock", not "8 hours inclusive"). No unlock
  // mutation happens here — expired rows are neither renewed nor
  // deleted, and no new unlock is created on the audio path.
  const unlock = await client.libraryUnlock.findFirst({
    where: {
      userId,
      librarySessionId: session.id,
      expiresAt: { gt: now },
    },
    orderBy: { expiresAt: "desc" },
    select: {
      id: true,
      expiresAt: true,
    },
  });
  if (!unlock) {
    return { ok: false, error: "UNLOCK_REQUIRED" };
  }

  return {
    ok: true,
    outcome: "allowed_active_unlock",
    grant,
    unlockId: unlock.id,
    unlockExpiresAt: unlock.expiresAt,
  };
}
