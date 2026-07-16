// lib/entitlement/library-catalog.ts
//
// RP-010 Phase 4D — Curated Library Catalog Read API (read-only).
//
// Central read-side helper that answers two questions:
//
//   1. "What ACTIVE curated LibrarySessions exist right now, and what
//       does THIS user's access to each one look like?"
//   2. "Given a specific active session id, what safe metadata and
//       chapter list should we hand back to THIS user?"
//
// The helper is strictly read-only. It never creates, updates or deletes
// any row — no LibraryUnlock write, no probe write, no PeriodUsage write,
// no credit / minute write, no Stripe call, no Job write. Enforcement of
// actual audio delivery still runs in /api/library/chapters/[id]/audio;
// the `access` field returned here is INFORMATIONAL only and must never
// substitute for that server-side authorization step.
//
// Product / security invariants exercised here:
//
//   * Only LibrarySession.isActive === true rows leave the helper. An
//     inactive session is externally indistinguishable from a session
//     that never existed — SESSION_NOT_FOUND covers both.
//   * `audioKey` (the internal storage locator) NEVER appears in the
//     returned shape. Chapters expose an `audioUrl` that points to the
//     protected Phase-4C route, and that route re-verifies access per
//     request. Emitting the URL for a locked session is safe because
//     the caller cannot bypass the authorization check by knowing it.
//   * The effective-plan decision uses the shared resolveEffectivePlan
//     (Option C). Expired paid plans resolve to FREE for the access
//     hint just like they do for audio auth.
//   * The list path is O(1) plan lookup + O(1) session-with-count query
//     + O(1) unlock-batch query. No per-session User re-read, no
//     per-session resolver call, no per-session unlock query.

import type { Plan, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { resolveEffectivePlan } from "@/lib/entitlement/resolver";

/**
 * Maximum number of sessions returned by `listActiveLibrarySessions`
 * per call. The MVP curated catalog is small, so a single bounded read
 * is acceptable; cursor pagination is out of scope for Phase 4D.
 */
export const LIBRARY_CATALOG_DEFAULT_MAX = 100;
export const LIBRARY_CATALOG_HARD_MAX = 100;

export type LibraryCatalogAccessStatus =
  | "direct_plan_access"
  | "active_unlock"
  | "requires_sponsored_unlock";

export type LibraryCatalogAccess = {
  status: LibraryCatalogAccessStatus;
  /** Expiry of the active LibraryUnlock, only populated on `active_unlock`. */
  unlockExpiresAt: Date | null;
};

export type LibraryCatalogSessionListItem = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  preset: string;
  durationSeconds: number | null;
  chapterCount: number;
  access: LibraryCatalogAccess;
};

export type LibraryCatalogChapterDetail = {
  id: string;
  partIndex: number;
  title: string | null;
  durationSeconds: number | null;
  /**
   * URL pointing to the protected Phase-4C chapter audio route. Server
   * re-verifies access on every request; the URL alone is NOT a
   * capability token.
   */
  audioUrl: string;
};

export type LibraryCatalogSessionDetail = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  preset: string;
  durationSeconds: number | null;
  access: LibraryCatalogAccess;
  chapters: LibraryCatalogChapterDetail[];
};

export type LibraryCatalogListError = "AUTH_REQUIRED" | "USER_NOT_FOUND";
export type LibraryCatalogDetailError =
  | "AUTH_REQUIRED"
  | "USER_NOT_FOUND"
  | "SESSION_NOT_FOUND";

export type ListActiveLibrarySessionsResult =
  | { ok: true; sessions: LibraryCatalogSessionListItem[] }
  | { ok: false; error: LibraryCatalogListError };

export type GetActiveLibrarySessionDetailResult =
  | { ok: true; session: LibraryCatalogSessionDetail }
  | { ok: false; error: LibraryCatalogDetailError };

export type ListActiveLibrarySessionsOptions = {
  /** Optional cap. Clamped to [1, LIBRARY_CATALOG_HARD_MAX]. */
  take?: number;
  /** Explicit clock for deterministic tests. */
  now?: Date;
};

export type GetActiveLibrarySessionDetailOptions = {
  now?: Date;
};

/**
 * Build the protected Phase-4C audio URL for a chapter id. Kept as a
 * single helper so the URL shape is spelled exactly once and cannot
 * drift between list and detail responses.
 */
export function libraryChapterAudioUrl(chapterId: string): string {
  return `/api/library/chapters/${chapterId}/audio`;
}

function clampTake(input: number | undefined): number {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    return LIBRARY_CATALOG_DEFAULT_MAX;
  }
  const floored = Math.floor(input);
  if (floored < 1) return 1;
  if (floored > LIBRARY_CATALOG_HARD_MAX) return LIBRARY_CATALOG_HARD_MAX;
  return floored;
}

function normalizeUserId(userId: string | null | undefined): string | null {
  return typeof userId === "string" && userId.trim() !== "" ? userId : null;
}

function accessFor(
  plan: Plan,
  unlockExpiresAt: Date | null
): LibraryCatalogAccess {
  if (plan !== "FREE") {
    return { status: "direct_plan_access", unlockExpiresAt: null };
  }
  if (unlockExpiresAt) {
    return { status: "active_unlock", unlockExpiresAt };
  }
  return { status: "requires_sponsored_unlock", unlockExpiresAt: null };
}

/**
 * List active curated LibrarySessions with per-user access hints.
 *
 * Read shape:
 *   * one user read (plan + period end),
 *   * one librarySession read (with chapter count),
 *   * one libraryUnlock read (batched by session id, FREE only).
 *
 * No per-session User re-read, no per-session unlock query.
 */
export async function listActiveLibrarySessions(
  userId: string | null | undefined,
  options: ListActiveLibrarySessionsOptions = {},
  client: PrismaClient = defaultPrisma
): Promise<ListActiveLibrarySessionsResult> {
  const uid = normalizeUserId(userId);
  if (!uid) return { ok: false, error: "AUTH_REQUIRED" };

  const now = options.now ?? new Date();
  const take = clampTake(options.take);

  const user = await client.user.findUnique({
    where: { id: uid },
    select: { plan: true, planPeriodEnd: true },
  });
  if (!user) return { ok: false, error: "USER_NOT_FOUND" };

  const effectivePlan = resolveEffectivePlan(
    user.plan,
    user.planPeriodEnd,
    now
  );

  // Sessions with chapter count in a single query. Deterministic order:
  // createdAt desc first, then id asc as a stable tiebreaker so the
  // response is reproducible even when two rows share createdAt.
  const sessions = await client.librarySession.findMany({
    where: { isActive: true },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take,
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      preset: true,
      durationSeconds: true,
      _count: { select: { chapters: true } },
    },
  });

  // Batched unlock lookup — only needed if the caller resolves to FREE.
  // For paid callers no unlock is ever consulted (system separation) so
  // the query is skipped entirely.
  const unlockByLibrarySessionId = new Map<string, Date>();
  if (effectivePlan === "FREE" && sessions.length > 0) {
    const sessionIds = sessions.map((s) => s.id);
    const activeUnlocks = await client.libraryUnlock.findMany({
      where: {
        userId: uid,
        librarySessionId: { in: sessionIds },
        expiresAt: { gt: now },
      },
      orderBy: { expiresAt: "desc" },
      select: {
        librarySessionId: true,
        expiresAt: true,
      },
    });
    // Multiple unlocks for the same session should be rare (Phase 4B-1
    // reuses an active row). If they do occur, `orderBy expiresAt desc`
    // + first-seen-wins picks the latest deterministic winner.
    for (const u of activeUnlocks) {
      if (!unlockByLibrarySessionId.has(u.librarySessionId)) {
        unlockByLibrarySessionId.set(u.librarySessionId, u.expiresAt);
      }
    }
  }

  const items: LibraryCatalogSessionListItem[] = sessions.map((s) => {
    const unlockExpiresAt =
      effectivePlan === "FREE"
        ? unlockByLibrarySessionId.get(s.id) ?? null
        : null;
    return {
      id: s.id,
      slug: s.slug,
      title: s.title,
      description: s.description,
      preset: s.preset,
      durationSeconds: s.durationSeconds,
      chapterCount: s._count.chapters,
      access: accessFor(effectivePlan, unlockExpiresAt),
    };
  });

  return { ok: true, sessions: items };
}

/**
 * Return safe metadata for a single active curated LibrarySession,
 * including its chapters (partIndex asc) with protected audio URLs.
 *
 * Read shape:
 *   * one user read,
 *   * one librarySession read (session + chapters combined),
 *   * one libraryUnlock read (FREE only).
 *
 * Inactive and unknown sessions produce the same external outcome:
 * SESSION_NOT_FOUND. Callers MUST NOT distinguish the two.
 */
export async function getActiveLibrarySessionDetail(
  userId: string | null | undefined,
  librarySessionId: string,
  options: GetActiveLibrarySessionDetailOptions = {},
  client: PrismaClient = defaultPrisma
): Promise<GetActiveLibrarySessionDetailResult> {
  const uid = normalizeUserId(userId);
  if (!uid) return { ok: false, error: "AUTH_REQUIRED" };

  const now = options.now ?? new Date();

  if (typeof librarySessionId !== "string" || librarySessionId.trim() === "") {
    // A missing / blank id can never resolve to a real session — treat
    // it exactly like a lookup miss so inactive rows and blanks are
    // externally indistinguishable.
    return { ok: false, error: "SESSION_NOT_FOUND" };
  }

  const user = await client.user.findUnique({
    where: { id: uid },
    select: { plan: true, planPeriodEnd: true },
  });
  if (!user) return { ok: false, error: "USER_NOT_FOUND" };

  const effectivePlan = resolveEffectivePlan(
    user.plan,
    user.planPeriodEnd,
    now
  );

  const session = await client.librarySession.findUnique({
    where: { id: librarySessionId },
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      preset: true,
      durationSeconds: true,
      isActive: true,
      chapters: {
        orderBy: { partIndex: "asc" },
        select: {
          id: true,
          partIndex: true,
          title: true,
          durationSeconds: true,
          // NOTE: audioKey deliberately NOT selected. It is a
          // server-only value and must never leave the resolver.
        },
      },
    },
  });

  if (!session || !session.isActive) {
    return { ok: false, error: "SESSION_NOT_FOUND" };
  }

  let unlockExpiresAt: Date | null = null;
  if (effectivePlan === "FREE") {
    const unlock = await client.libraryUnlock.findFirst({
      where: {
        userId: uid,
        librarySessionId: session.id,
        expiresAt: { gt: now },
      },
      orderBy: { expiresAt: "desc" },
      select: { expiresAt: true },
    });
    unlockExpiresAt = unlock?.expiresAt ?? null;
  }

  const chapters: LibraryCatalogChapterDetail[] = session.chapters.map((c) => ({
    id: c.id,
    partIndex: c.partIndex,
    title: c.title,
    durationSeconds: c.durationSeconds,
    audioUrl: libraryChapterAudioUrl(c.id),
  }));

  return {
    ok: true,
    session: {
      id: session.id,
      slug: session.slug,
      title: session.title,
      description: session.description,
      preset: session.preset,
      durationSeconds: session.durationSeconds,
      access: accessFor(effectivePlan, unlockExpiresAt),
      chapters,
    },
  };
}
