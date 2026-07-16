// lib/entitlement/library-unlock.ts
//
// RP-010 Phase 4B-1 — Free Library Unlock Runtime (Write Side).
//
// Central write-side helper that grants per-session curated Library access.
// Paid plans (STARTER / PREMIUM) receive direct access with no persisted
// unlock row; FREE users obtain one atomic LibraryUnlock row per authorized
// claim, valid for exactly eight hours, capped at three new unlocks per UTC
// day. This module owns the whole claim; the surrounding /api/library/unlock
// route is only a thin authenticated dispatcher.
//
// Five invariants matter here. They mirror the reservation / probe contracts
// so all three admission paths look and reason the same.
//
//   * User is atomically serialized against themselves. All read + count +
//     check + insert steps run inside a single Prisma interactive transaction,
//     and the transaction opens with a PostgreSQL `pg_advisory_xact_lock`
//     keyed to (LIBRARY_UNLOCK_LOCK_NAMESPACE, hashtext(userId)). The lock
//     scope is (a) per user, (b) per subsystem (namespaced away from any
//     future advisory-lock user), (c) transactional — released the moment
//     the enclosing transaction commits or aborts. No other user's claim
//     ever blocks on ours, so cross-user parallelism is preserved.
//
//   * Daily limit enforcement is atomic. Under READ COMMITTED, two writers
//     could otherwise both `count()` at 2, both `create()`, and both commit
//     — the advisory lock collapses that window: only one claim is inside
//     the critical section at a time for any given user, so the fourth
//     concurrent claim of the day always observes count = 3 and rejects
//     with DAILY_UNLOCK_LIMIT_REACHED.
//
//   * Same-session reuse is atomic. Two racing claims for the same session
//     serialise on the same per-user advisory lock. The first inserts, the
//     second observes the fresh active row and returns `reused` without a
//     second insert and without consuming a second slot. No time-bounded
//     unique constraint is invented — the lock alone suffices.
//
//   * Provider Event IDs are idempotent. `LibraryUnlock.providerEventId` is
//     already `@unique`. When a caller supplies one and a row with that ID
//     already exists for the same (user, session), we return it as `reused`;
//     a mismatched (user, session) surfaces CONCURRENCY_CONFLICT rather than
//     silently attach the event to the wrong record. A rare concurrent race
//     that trips the DB unique constraint is caught explicitly.
//
//   * Systems remain strictly separated. This helper never reads or writes
//     User.credits, User.probeGenerationsUsed, PeriodUsage, Job — nothing
//     but LibrarySession, User.plan/planPeriodEnd (read-only), and
//     LibraryUnlock. Neither the Probe lifecycle nor the paid Minute
//     lifecycle can influence Library-Unlock outcomes and vice versa.
//
// The route wired on top is intentionally minimal in this phase:
//   * Paid callers receive `direct_plan_access` unconditionally.
//   * FREE callers receive REQUIRES_SPONSORED_VERIFICATION — no actual
//     unlock is created. A real Sponsored-provider signal is out of scope
//     for Phase 4B-1; a public POST is not, on its own, a trustworthy
//     signal that a sponsored obligation was fulfilled.
//
// A trusted internal caller (a future server-verified Sponsored provider
// integration in Phase 4B-2) can still exercise the full write path via
// `claimLibrarySessionUnlock` directly; the current Phase 4B-1 route simply
// refuses to expose it to unauthenticated Free client requests.

import { LibraryUnlockSource, type Plan, type PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { resolveEffectivePlan } from "@/lib/entitlement/resolver";

/**
 * Duration of a new Free LibraryUnlock in milliseconds.
 * Product rule (RP-010 Phase 4B-1): eight hours from unlock time.
 */
export const UNLOCK_DURATION_MS = 8 * 60 * 60 * 1000;

/**
 * Maximum number of *new* LibraryUnlock rows a Free user may create per
 * UTC calendar day. Reused active unlocks do not count against this cap.
 */
export const DAILY_UNLOCK_LIMIT = 3;

/**
 * PostgreSQL advisory-lock namespace used by this subsystem. Two-argument
 * `pg_advisory_xact_lock(ns, key)` partitions the lock keyspace, so
 * Library-Unlock claims cannot collide with any future advisory-lock user
 * even if they hash the same userId to the same 32-bit key. The value is
 * an arbitrary constant unique to this file.
 */
const LIBRARY_UNLOCK_LOCK_NAMESPACE = 730104;

/**
 * Server-side day boundary used by the daily limit. UTC calendar day: the
 * window is `[start, start + 24h)` where `start` is the UTC midnight
 * preceding `now`. No user-timezone preference exists and none is invented
 * for this phase — the day boundary is a server-side product rule.
 */
export function startOfUtcDay(now: Date): Date {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0,
      0,
      0,
      0
    )
  );
}

export type ClaimLibrarySessionUnlockErrorCode =
  | "USER_NOT_FOUND"
  | "SESSION_NOT_FOUND"
  | "SESSION_INACTIVE"
  | "DAILY_UNLOCK_LIMIT_REACHED"
  | "CONCURRENCY_CONFLICT";

export type ClaimLibrarySessionUnlockResult =
  | {
      ok: true;
      outcome: "direct_plan_access";
      plan: Plan;
    }
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
  | { ok: false; error: ClaimLibrarySessionUnlockErrorCode };

/**
 * Internal signal used to abort the claim transaction with a caller-visible
 * reason. Prisma's interactive `$transaction` rolls back on throw — we lean
 * on that so a rejected claim cannot leak a half-written LibraryUnlock row.
 */
class ClaimRejectError extends Error {
  constructor(public readonly code: ClaimLibrarySessionUnlockErrorCode) {
    super(code);
    this.name = "ClaimRejectError";
  }
}

/**
 * P2002 detector for the LibraryUnlock.providerEventId unique constraint.
 * A concurrent claim with the same providerEventId can lose the create
 * race after our findUnique returned null; we surface that as a controlled
 * CONCURRENCY_CONFLICT rather than an uncontrolled 500.
 */
function isProviderEventUniqueConflict(e: unknown): boolean {
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
      (t) =>
        typeof t === "string" && t.toLowerCase().includes("providereventid")
    );
  }
  if (typeof target === "string") {
    const s = target.toLowerCase();
    return s.includes("providereventid") || s.includes("libraryunlock");
  }
  if (typeof err.message === "string") {
    return err.message.toLowerCase().includes("providereventid");
  }
  return false;
}

/**
 * Atomically claim a LibraryUnlock for a Free user, or resolve direct
 * plan access for a paid user, or return an existing active unlock as
 * `reused`. See the top-of-file invariants for the guarantees this helper
 * provides.
 *
 * The `providerEventId` field is persisted verbatim and — via the DB
 * unique constraint plus an in-transaction findUnique — behaves
 * idempotently on retry. This phase does NOT verify signatures, HMACs or
 * replay windows; the field is simply a persisted provider correlation
 * id. Public routes MUST NOT trust an arbitrary client-supplied event id
 * as proof of sponsored completion.
 */
export async function claimLibrarySessionUnlock(
  params: {
    userId: string;
    librarySessionId: string;
    providerEventId?: string;
    now?: Date;
  },
  client: PrismaClient = defaultPrisma
): Promise<ClaimLibrarySessionUnlockResult> {
  const now = params.now ?? new Date();

  try {
    return await client.$transaction(async (tx) => {
      // -----------------------------------------------------------------
      // 1. Load the user's plan / period state. We do NOT read credits,
      // probeGenerationsUsed or any Job / PeriodUsage state here — those
      // systems are strictly independent from Library Unlocks.
      // -----------------------------------------------------------------
      const user = await tx.user.findUnique({
        where: { id: params.userId },
        select: { plan: true, planPeriodEnd: true },
      });
      if (!user) throw new ClaimRejectError("USER_NOT_FOUND");

      // -----------------------------------------------------------------
      // 2. Load the session. It must exist and be flagged active. The
      // helper never activates an inactive session — that would be a
      // silent product-rule change.
      // -----------------------------------------------------------------
      const session = await tx.librarySession.findUnique({
        where: { id: params.librarySessionId },
        select: { id: true, isActive: true },
      });
      if (!session) throw new ClaimRejectError("SESSION_NOT_FOUND");
      if (!session.isActive) throw new ClaimRejectError("SESSION_INACTIVE");

      // -----------------------------------------------------------------
      // 3. Effective plan gate. STARTER / PREMIUM (still inside their
      // billing period) resolve to direct access and NEVER create a
      // LibraryUnlock row. Expired paid plans downgrade to FREE via
      // resolveEffectivePlan and fall through to the Free path — matching
      // the resolver / probe convention.
      // -----------------------------------------------------------------
      const effectivePlan = resolveEffectivePlan(
        user.plan,
        user.planPeriodEnd,
        now
      );
      if (effectivePlan !== "FREE") {
        return {
          ok: true,
          outcome: "direct_plan_access",
          plan: effectivePlan,
        } as ClaimLibrarySessionUnlockResult;
      }

      // -----------------------------------------------------------------
      // 4. Per-user advisory lock inside the transaction. Both arguments
      // are BOUND parameters ($1 = namespace int, $2 = userId string) —
      // no string interpolation. hashtext() maps userId to a 32-bit int
      // deterministically. The lock releases automatically when the
      // transaction commits or aborts (that's the -xact- suffix), so no
      // manual release / stale-holder recovery is possible or needed.
      // -----------------------------------------------------------------
      // Prisma's tagged-template $queryRaw exists on both the top-level
      // client and the transaction client. We cast to a minimal shape to
      // avoid pulling the full Prisma runtime type here — the SQL is
      // fully parameter-bound below.
      await (
        tx as unknown as {
          $queryRaw: (
            strings: TemplateStringsArray,
            ...values: unknown[]
          ) => Promise<unknown>;
        }
      ).$queryRaw`SELECT pg_advisory_xact_lock(${LIBRARY_UNLOCK_LOCK_NAMESPACE}::int, hashtext(${params.userId})::int)`;

      // -----------------------------------------------------------------
      // 5. Provider Event ID idempotency (optional). Runs INSIDE the
      // per-user lock, so a concurrent claim carrying the same
      // providerEventId cannot squeeze past. The DB unique constraint is
      // an additional last-resort safety net handled by the outer catch.
      // -----------------------------------------------------------------
      if (params.providerEventId) {
        const existingByEvent = await tx.libraryUnlock.findUnique({
          where: { providerEventId: params.providerEventId },
          select: {
            id: true,
            userId: true,
            librarySessionId: true,
            unlockedAt: true,
            expiresAt: true,
          },
        });
        if (existingByEvent) {
          // A providerEventId is by contract unique per event. If it is
          // reused for a different user or session that is a controlled
          // conflict — never silently re-target it.
          if (
            existingByEvent.userId !== params.userId ||
            existingByEvent.librarySessionId !== params.librarySessionId
          ) {
            throw new ClaimRejectError("CONCURRENCY_CONFLICT");
          }
          return {
            ok: true,
            outcome: "reused",
            unlockId: existingByEvent.id,
            librarySessionId: existingByEvent.librarySessionId,
            unlockedAt: existingByEvent.unlockedAt,
            expiresAt: existingByEvent.expiresAt,
          } as ClaimLibrarySessionUnlockResult;
        }
      }

      // -----------------------------------------------------------------
      // 6. Active same-session reuse. If the user already holds an
      // unexpired unlock for THIS session, return it unchanged. No new
      // unlockedAt, no expiresAt extension, no daily slot consumed.
      // -----------------------------------------------------------------
      const activeSame = await tx.libraryUnlock.findFirst({
        where: {
          userId: params.userId,
          librarySessionId: params.librarySessionId,
          expiresAt: { gt: now },
        },
        orderBy: { unlockedAt: "desc" },
        select: {
          id: true,
          librarySessionId: true,
          unlockedAt: true,
          expiresAt: true,
        },
      });
      if (activeSame) {
        return {
          ok: true,
          outcome: "reused",
          unlockId: activeSame.id,
          librarySessionId: activeSame.librarySessionId,
          unlockedAt: activeSame.unlockedAt,
          expiresAt: activeSame.expiresAt,
        } as ClaimLibrarySessionUnlockResult;
      }

      // -----------------------------------------------------------------
      // 7. Daily limit gate. Count NEW unlock rows created during the
      // current UTC day window. Because we're inside the per-user
      // advisory lock, this count → check → create is atomic against
      // any concurrent claim by the same user.
      // -----------------------------------------------------------------
      const dayStart = startOfUtcDay(now);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const todayCount = await tx.libraryUnlock.count({
        where: {
          userId: params.userId,
          unlockedAt: { gte: dayStart, lt: dayEnd },
        },
      });
      if (todayCount >= DAILY_UNLOCK_LIMIT) {
        throw new ClaimRejectError("DAILY_UNLOCK_LIMIT_REACHED");
      }

      // -----------------------------------------------------------------
      // 8. Create the unlock. Eight-hour window from `now`. Source is
      // fixed to SPONSORED — the only defined LibraryUnlockSource in this
      // phase. providerEventId is persisted as-supplied.
      // -----------------------------------------------------------------
      const expiresAt = new Date(now.getTime() + UNLOCK_DURATION_MS);
      const created = await tx.libraryUnlock.create({
        data: {
          userId: params.userId,
          librarySessionId: params.librarySessionId,
          unlockedAt: now,
          expiresAt,
          source: LibraryUnlockSource.SPONSORED,
          providerEventId: params.providerEventId ?? null,
        },
        select: {
          id: true,
          librarySessionId: true,
          unlockedAt: true,
          expiresAt: true,
        },
      });

      return {
        ok: true,
        outcome: "created",
        unlockId: created.id,
        librarySessionId: created.librarySessionId,
        unlockedAt: created.unlockedAt,
        expiresAt: created.expiresAt,
      } as ClaimLibrarySessionUnlockResult;
    });
  } catch (e) {
    if (e instanceof ClaimRejectError) {
      return { ok: false, error: e.code };
    }
    if (isProviderEventUniqueConflict(e)) {
      return { ok: false, error: "CONCURRENCY_CONFLICT" };
    }
    throw e;
  }
}

/**
 * Public-route decision helper.
 *
 * The Phase 4B-1 /api/library/unlock route is deliberately conservative:
 * it will not create a Free-user unlock on the strength of a plain
 * authenticated POST — a Sponsored provider integration is not yet in
 * place, and no signature / event verification is implemented in this
 * phase. Paid users, on the other hand, need no verification: they
 * already hold direct plan access.
 *
 * This helper is the single point of truth for that split. It is
 * intentionally exported so the route stays a thin dispatcher and the
 * test suite can assert the routing without spinning up Next.js.
 */
export type PublicClaimRoutingDecisionErrorCode =
  | "USER_NOT_FOUND"
  | "SESSION_NOT_FOUND"
  | "SESSION_INACTIVE";

export type PublicClaimRoutingDecision =
  | {
      ok: true;
      outcome: "direct_plan_access";
      plan: Plan;
      librarySessionId: string;
    }
  | {
      ok: true;
      outcome: "requires_sponsored_verification";
      librarySessionId: string;
    }
  | { ok: false; error: PublicClaimRoutingDecisionErrorCode };

export async function decidePublicClaimRouting(
  params: {
    userId: string;
    librarySessionId: string;
    now?: Date;
  },
  client: PrismaClient = defaultPrisma
): Promise<PublicClaimRoutingDecision> {
  const now = params.now ?? new Date();

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

  const effectivePlan = resolveEffectivePlan(user.plan, user.planPeriodEnd, now);
  if (effectivePlan !== "FREE") {
    return {
      ok: true,
      outcome: "direct_plan_access",
      plan: effectivePlan,
      librarySessionId: session.id,
    };
  }

  // FREE — the route refuses to create an unlock without a trusted
  // Sponsored signal. The claim helper is not invoked at all on this
  // path; the caller receives a controlled REQUIRES_SPONSORED_VERIFICATION
  // result and no LibraryUnlock row is created.
  return {
    ok: true,
    outcome: "requires_sponsored_verification",
    librarySessionId: session.id,
  };
}
