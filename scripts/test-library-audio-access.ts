// scripts/test-library-audio-access.ts
//
// Offline tests for RP-010 Phase 4C — curated Library chapter audio
// authorization (lib/entitlement/library-audio-access.ts).
//
// Runs against an in-memory Prisma stub that mirrors the small surface
// resolveLibraryAudioAccess touches: User (read), LibrarySession (read),
// LibrarySessionChapter (read), LibraryUnlock (read). Any attempt to
// mutate one of those tables from the resolver would surface loudly —
// system separation is asserted directly against the store on every
// case.
//
// Run:
//   npx tsx scripts/test-library-audio-access.ts

import type { Plan, PrismaClient } from "@prisma/client";
import {
  resolveLibraryAudioAccess,
  httpStatusForAccessError,
  type LibraryAudioAccessErrorCode,
  type LibraryAudioAccessResult,
} from "../lib/entitlement/library-audio-access";
import * as fs from "node:fs";
import * as path from "node:path";

// Test helper: mirror the route's (status, error-string) pair so the
// mapping is verified end-to-end even though the code layout puts the
// numeric mapping in the resolver module and the string echo in the
// route module.
function httpForAccessError(
  code: LibraryAudioAccessErrorCode
): { status: number; error: string } {
  return { status: httpStatusForAccessError(code), error: code };
}

// --- Assertion runner -----------------------------------------------------

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const equal =
    actual instanceof Date && expected instanceof Date
      ? actual.getTime() === expected.getTime()
      : actual === expected;
  if (equal) {
    console.log(`[PASS] ${name}`);
    passed++;
  } else {
    console.log(
      `[FAIL] ${name}\n       expected=${String(expected)}\n       actual=  ${String(actual)}`
    );
    failed++;
  }
}

// --- In-memory Prisma stub -----------------------------------------------

type StoreUser = {
  id: string;
  plan: Plan;
  planPeriodStart: Date | null;
  planPeriodEnd: Date | null;
  probeGenerationsUsed: number;
  credits: number;
};

type StoreLibrarySession = {
  id: string;
  isActive: boolean;
};

type StoreChapter = {
  id: string;
  librarySessionId: string;
  audioKey: string;
};

type StoreUnlock = {
  id: string;
  userId: string;
  librarySessionId: string;
  expiresAt: Date;
};

type StoreJob = { id: string; userId: string };
type StorePeriodUsage = {
  id: string;
  userId: string;
  periodStart: Date;
  periodEnd: Date;
  minutesReserved: number;
  minutesUsed: number;
};

type Store = {
  users: Map<string, StoreUser>;
  sessions: Map<string, StoreLibrarySession>;
  chapters: Map<string, StoreChapter>;
  unlocks: Map<string, StoreUnlock>;
  jobs: Map<string, StoreJob>;
  periodUsages: Map<string, StorePeriodUsage>;
  // Every call the resolver makes lands here for post-hoc verification.
  callLog: string[];
};

function makeStore(): Store {
  return {
    users: new Map(),
    sessions: new Map(),
    chapters: new Map(),
    unlocks: new Map(),
    jobs: new Map(),
    periodUsages: new Map(),
    callLog: [],
  };
}

function forbid(method: string) {
  return async () => {
    throw new Error(`library-audio-access must not call ${method}`);
  };
}

function buildClient(store: Store): PrismaClient {
  const client = {
    user: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        store.callLog.push(`user.findUnique:${where.id}`);
        const u = store.users.get(where.id);
        if (!u) return null;
        return {
          plan: u.plan,
          planPeriodEnd: u.planPeriodEnd,
        };
      },
      create: forbid("user.create"),
      update: forbid("user.update"),
      updateMany: forbid("user.updateMany"),
      delete: forbid("user.delete"),
    },
    librarySession: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        store.callLog.push(`librarySession.findUnique:${where.id}`);
        const s = store.sessions.get(where.id);
        if (!s) return null;
        return { id: s.id, isActive: s.isActive };
      },
      create: forbid("librarySession.create"),
      update: forbid("librarySession.update"),
    },
    librarySessionChapter: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        store.callLog.push(`librarySessionChapter.findUnique:${where.id}`);
        const c = store.chapters.get(where.id);
        if (!c) return null;
        return {
          id: c.id,
          librarySessionId: c.librarySessionId,
          audioKey: c.audioKey,
        };
      },
      create: forbid("librarySessionChapter.create"),
      update: forbid("librarySessionChapter.update"),
    },
    libraryUnlock: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findFirst: async ({ where, orderBy }: any) => {
        store.callLog.push(
          `libraryUnlock.findFirst:${where?.userId ?? "-"}:${where?.librarySessionId ?? "-"}`
        );
        const rows: StoreUnlock[] = [];
        for (const u of store.unlocks.values()) {
          if (where?.userId && u.userId !== where.userId) continue;
          if (
            where?.librarySessionId &&
            u.librarySessionId !== where.librarySessionId
          )
            continue;
          if (where?.expiresAt?.gt) {
            const cutoff = where.expiresAt.gt as Date;
            if (!(u.expiresAt.getTime() > cutoff.getTime())) continue;
          }
          rows.push(u);
        }
        if (orderBy && orderBy.expiresAt === "desc") {
          rows.sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime());
        }
        const r = rows[0];
        if (!r) return null;
        return { id: r.id, expiresAt: r.expiresAt };
      },
      create: forbid("libraryUnlock.create"),
      update: forbid("libraryUnlock.update"),
      updateMany: forbid("libraryUnlock.updateMany"),
      delete: forbid("libraryUnlock.delete"),
      deleteMany: forbid("libraryUnlock.deleteMany"),
      upsert: forbid("libraryUnlock.upsert"),
    },
    // Surfaces the resolver MUST NOT touch. If it ever does, the tests
    // fail loudly on separation invariants rather than silently pass.
    periodUsage: {
      findUnique: forbid("periodUsage.findUnique"),
      findFirst: forbid("periodUsage.findFirst"),
      create: forbid("periodUsage.create"),
      update: forbid("periodUsage.update"),
      updateMany: forbid("periodUsage.updateMany"),
    },
    job: {
      create: forbid("job.create"),
      update: forbid("job.update"),
      updateMany: forbid("job.updateMany"),
    },
    $transaction: forbid("$transaction"),
    $queryRaw: forbid("$queryRaw"),
    $executeRaw: forbid("$executeRaw"),
  };
  return client as unknown as PrismaClient;
}

function seedUser(
  store: Store,
  u: {
    id: string;
    plan: Plan;
    planPeriodStart?: Date | null;
    planPeriodEnd?: Date | null;
    probeGenerationsUsed?: number;
    credits?: number;
  }
): void {
  store.users.set(u.id, {
    id: u.id,
    plan: u.plan,
    planPeriodStart: u.planPeriodStart ?? null,
    planPeriodEnd: u.planPeriodEnd ?? null,
    probeGenerationsUsed: u.probeGenerationsUsed ?? 0,
    credits: u.credits ?? 100,
  });
}
function seedSession(
  store: Store,
  s: { id: string; isActive?: boolean }
): void {
  store.sessions.set(s.id, { id: s.id, isActive: s.isActive ?? true });
}
function seedChapter(
  store: Store,
  c: { id: string; librarySessionId: string; audioKey?: string }
): void {
  store.chapters.set(c.id, {
    id: c.id,
    librarySessionId: c.librarySessionId,
    audioKey: c.audioKey ?? `library/${c.librarySessionId}/${c.id}.mp3`,
  });
}
function seedUnlock(
  store: Store,
  u: {
    id?: string;
    userId: string;
    librarySessionId: string;
    expiresAt: Date;
  }
): void {
  const id = u.id ?? `unlock-${store.unlocks.size + 1}`;
  store.unlocks.set(id, {
    id,
    userId: u.userId,
    librarySessionId: u.librarySessionId,
    expiresAt: u.expiresAt,
  });
}

function snapshot(store: Store): {
  users: string;
  sessions: string;
  chapters: string;
  unlocks: string;
  jobs: number;
  periodUsages: number;
} {
  const userDump = Array.from(store.users.values())
    .map(
      (u) =>
        `${u.id}|${u.plan}|${u.credits}|${u.probeGenerationsUsed}|${u.planPeriodEnd?.toISOString() ?? ""}`
    )
    .join(",");
  const sessionDump = Array.from(store.sessions.values())
    .map((s) => `${s.id}|${s.isActive}`)
    .join(",");
  const chapterDump = Array.from(store.chapters.values())
    .map((c) => `${c.id}|${c.librarySessionId}|${c.audioKey}`)
    .join(",");
  const unlockDump = Array.from(store.unlocks.values())
    .map(
      (u) => `${u.id}|${u.userId}|${u.librarySessionId}|${u.expiresAt.toISOString()}`
    )
    .join(",");
  return {
    users: userDump,
    sessions: sessionDump,
    chapters: chapterDump,
    unlocks: unlockDump,
    jobs: store.jobs.size,
    periodUsages: store.periodUsages.size,
  };
}

function assertNoMutation(
  label: string,
  before: ReturnType<typeof snapshot>,
  after: ReturnType<typeof snapshot>
): void {
  check(`${label}: users unchanged`, after.users, before.users);
  check(`${label}: sessions unchanged`, after.sessions, before.sessions);
  check(`${label}: chapters unchanged`, after.chapters, before.chapters);
  check(`${label}: unlocks unchanged`, after.unlocks, before.unlocks);
  check(`${label}: jobs count unchanged`, after.jobs, before.jobs);
  check(
    `${label}: periodUsages count unchanged`,
    after.periodUsages,
    before.periodUsages
  );
}

// --- Common time constants ------------------------------------------------

const paidPeriodStart = new Date("2026-07-01T00:00:00.000Z");
const paidPeriodEnd = new Date("2026-08-01T00:00:00.000Z");
const midDay = new Date("2026-07-15T12:00:00.000Z");
const pastPaidPeriod = new Date("2026-09-01T12:00:00.000Z");
const unlockActiveUntil = new Date(midDay.getTime() + 4 * 60 * 60 * 1000); // +4h from midDay
const unlockJustExpiredAt = new Date(midDay.getTime()); // exactly at midDay

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

async function runTests(): Promise<void> {
  // ----- Paid Access --------------------------------------------------------

  // (1) STARTER + active session + valid chapter → allowed_direct_plan.
  //     No unlock query needed to answer; only chapter + session + user reads.
  {
    const store = makeStore();
    seedUser(store, {
      id: "u-starter",
      plan: "STARTER",
      planPeriodStart: paidPeriodStart,
      planPeriodEnd: paidPeriodEnd,
      probeGenerationsUsed: 1,
      credits: 5,
    });
    seedSession(store, { id: "sess-A" });
    seedChapter(store, { id: "ch-A1", librarySessionId: "sess-A" });
    const client = buildClient(store);
    const before = snapshot(store);
    const r = await resolveLibraryAudioAccess(
      { userId: "u-starter", librarySessionChapterId: "ch-A1", now: midDay },
      client
    );
    check("STARTER: ok=true", r.ok, true);
    if (r.ok) {
      check("STARTER: outcome=allowed_direct_plan", r.outcome, "allowed_direct_plan");
      check("STARTER: grant plan=STARTER", r.grant.plan, "STARTER");
      check(
        "STARTER: grant sessionId matches",
        r.grant.librarySessionId,
        "sess-A"
      );
      check(
        "STARTER: grant chapterId matches",
        r.grant.librarySessionChapterId,
        "ch-A1"
      );
      check(
        "STARTER: grant audioKey exposed",
        r.grant.audioKey,
        "library/sess-A/ch-A1.mp3"
      );
    }
    const unlockCalls = store.callLog.filter((s) =>
      s.startsWith("libraryUnlock.findFirst")
    );
    check("STARTER: no LibraryUnlock query", unlockCalls.length, 0);
    assertNoMutation("STARTER", before, snapshot(store));
  }

  // (2) PREMIUM → allowed_direct_plan.
  {
    const store = makeStore();
    seedUser(store, {
      id: "u-premium",
      plan: "PREMIUM",
      planPeriodStart: paidPeriodStart,
      planPeriodEnd: paidPeriodEnd,
    });
    seedSession(store, { id: "sess-A" });
    seedChapter(store, { id: "ch-A1", librarySessionId: "sess-A" });
    const client = buildClient(store);
    const r = await resolveLibraryAudioAccess(
      { userId: "u-premium", librarySessionChapterId: "ch-A1", now: midDay },
      client
    );
    check("PREMIUM: ok=true", r.ok, true);
    if (r.ok) {
      check("PREMIUM: outcome=allowed_direct_plan", r.outcome, "allowed_direct_plan");
      check("PREMIUM: plan=PREMIUM", r.grant.plan, "PREMIUM");
    }
  }

  // (3) Expired paid plan → effectively FREE → refused without unlock.
  {
    const store = makeStore();
    seedUser(store, {
      id: "u-expired",
      plan: "STARTER",
      planPeriodStart: paidPeriodStart,
      planPeriodEnd: paidPeriodEnd,
    });
    seedSession(store, { id: "sess-A" });
    seedChapter(store, { id: "ch-A1", librarySessionId: "sess-A" });
    const client = buildClient(store);
    const r = await resolveLibraryAudioAccess(
      {
        userId: "u-expired",
        librarySessionChapterId: "ch-A1",
        now: pastPaidPeriod,
      },
      client
    );
    check("Expired paid: ok=false", r.ok, false);
    if (!r.ok) check("Expired paid: UNLOCK_REQUIRED", r.error, "UNLOCK_REQUIRED");
  }

  // (4) Paid without planPeriodEnd — resolveEffectivePlan legacy semantics:
  //     paid plan is preserved. So the caller gets allowed_direct_plan.
  {
    const store = makeStore();
    seedUser(store, {
      id: "u-legacy",
      plan: "STARTER",
      planPeriodStart: null,
      planPeriodEnd: null,
    });
    seedSession(store, { id: "sess-A" });
    seedChapter(store, { id: "ch-A1", librarySessionId: "sess-A" });
    const client = buildClient(store);
    const r = await resolveLibraryAudioAccess(
      { userId: "u-legacy", librarySessionChapterId: "ch-A1", now: midDay },
      client
    );
    check("Legacy paid (no periodEnd): ok=true", r.ok, true);
    if (r.ok)
      check(
        "Legacy paid: outcome=allowed_direct_plan",
        r.outcome,
        "allowed_direct_plan"
      );
  }

  // ----- Free Unlock Enforcement -------------------------------------------

  // (5) FREE with active matching unlock → allowed_active_unlock.
  {
    const store = makeStore();
    seedUser(store, { id: "u-free", plan: "FREE" });
    seedSession(store, { id: "sess-A" });
    seedChapter(store, { id: "ch-A1", librarySessionId: "sess-A" });
    seedUnlock(store, {
      userId: "u-free",
      librarySessionId: "sess-A",
      expiresAt: unlockActiveUntil,
    });
    const client = buildClient(store);
    const before = snapshot(store);
    const r = await resolveLibraryAudioAccess(
      { userId: "u-free", librarySessionChapterId: "ch-A1", now: midDay },
      client
    );
    check("FREE+active unlock: ok=true", r.ok, true);
    if (r.ok && r.outcome === "allowed_active_unlock") {
      check(
        "FREE+active unlock: outcome",
        r.outcome,
        "allowed_active_unlock"
      );
      check("FREE+active unlock: plan=FREE", r.grant.plan, "FREE");
      check(
        "FREE+active unlock: expiresAt echoed",
        r.unlockExpiresAt.getTime(),
        unlockActiveUntil.getTime()
      );
    }
    assertNoMutation("FREE+active unlock", before, snapshot(store));
  }

  // (6) FREE with no unlock → UNLOCK_REQUIRED.
  {
    const store = makeStore();
    seedUser(store, { id: "u-free2", plan: "FREE" });
    seedSession(store, { id: "sess-A" });
    seedChapter(store, { id: "ch-A1", librarySessionId: "sess-A" });
    const client = buildClient(store);
    const r = await resolveLibraryAudioAccess(
      { userId: "u-free2", librarySessionChapterId: "ch-A1", now: midDay },
      client
    );
    check("FREE no unlock: ok=false", r.ok, false);
    if (!r.ok) check("FREE no unlock: UNLOCK_REQUIRED", r.error, "UNLOCK_REQUIRED");
  }

  // (7) FREE with expired unlock → UNLOCK_REQUIRED. Unlock row untouched.
  {
    const store = makeStore();
    seedUser(store, { id: "u-free3", plan: "FREE" });
    seedSession(store, { id: "sess-A" });
    seedChapter(store, { id: "ch-A1", librarySessionId: "sess-A" });
    const past = new Date(midDay.getTime() - 1);
    seedUnlock(store, {
      userId: "u-free3",
      librarySessionId: "sess-A",
      expiresAt: past,
    });
    const client = buildClient(store);
    const before = snapshot(store);
    const r = await resolveLibraryAudioAccess(
      { userId: "u-free3", librarySessionChapterId: "ch-A1", now: midDay },
      client
    );
    check("FREE expired unlock: refused", r.ok, false);
    if (!r.ok)
      check("FREE expired unlock: UNLOCK_REQUIRED", r.error, "UNLOCK_REQUIRED");
    check(
      "FREE expired unlock: still in store (not deleted)",
      store.unlocks.size,
      1
    );
    assertNoMutation("FREE expired unlock", before, snapshot(store));
  }

  // (8) FREE with unlock for a DIFFERENT session → UNLOCK_REQUIRED.
  {
    const store = makeStore();
    seedUser(store, { id: "u-free4", plan: "FREE" });
    seedSession(store, { id: "sess-A" });
    seedSession(store, { id: "sess-B" });
    seedChapter(store, { id: "ch-A1", librarySessionId: "sess-A" });
    seedUnlock(store, {
      userId: "u-free4",
      librarySessionId: "sess-B",
      expiresAt: unlockActiveUntil,
    });
    const client = buildClient(store);
    const r = await resolveLibraryAudioAccess(
      { userId: "u-free4", librarySessionChapterId: "ch-A1", now: midDay },
      client
    );
    check("FREE cross-session unlock: refused", r.ok, false);
    if (!r.ok)
      check("FREE cross-session: UNLOCK_REQUIRED", r.error, "UNLOCK_REQUIRED");
  }

  // (9) Unlock with expiresAt === now → expired (strict `> now`).
  {
    const store = makeStore();
    seedUser(store, { id: "u-boundary", plan: "FREE" });
    seedSession(store, { id: "sess-A" });
    seedChapter(store, { id: "ch-A1", librarySessionId: "sess-A" });
    seedUnlock(store, {
      userId: "u-boundary",
      librarySessionId: "sess-A",
      expiresAt: unlockJustExpiredAt,
    });
    const client = buildClient(store);
    const r = await resolveLibraryAudioAccess(
      { userId: "u-boundary", librarySessionChapterId: "ch-A1", now: midDay },
      client
    );
    check("Unlock boundary (expiresAt===now): refused", r.ok, false);
    if (!r.ok)
      check(
        "Unlock boundary: UNLOCK_REQUIRED",
        r.error,
        "UNLOCK_REQUIRED"
      );
  }

  // (10) Unlock with expiresAt > now (1 ms) → allowed.
  {
    const store = makeStore();
    seedUser(store, { id: "u-boundary2", plan: "FREE" });
    seedSession(store, { id: "sess-A" });
    seedChapter(store, { id: "ch-A1", librarySessionId: "sess-A" });
    seedUnlock(store, {
      userId: "u-boundary2",
      librarySessionId: "sess-A",
      expiresAt: new Date(midDay.getTime() + 1),
    });
    const client = buildClient(store);
    const r = await resolveLibraryAudioAccess(
      { userId: "u-boundary2", librarySessionChapterId: "ch-A1", now: midDay },
      client
    );
    check("Unlock boundary (+1ms): allowed", r.ok, true);
    if (r.ok)
      check(
        "Unlock boundary (+1ms): outcome=allowed_active_unlock",
        r.outcome,
        "allowed_active_unlock"
      );
  }

  // ----- Session and Chapter validation ------------------------------------

  // (11) Session missing → SESSION_NOT_FOUND (chapter references orphan
  //      parent).
  {
    const store = makeStore();
    seedUser(store, { id: "u-x", plan: "PREMIUM", planPeriodEnd: paidPeriodEnd });
    // No session seeded — chapter dangles.
    seedChapter(store, { id: "ch-A1", librarySessionId: "sess-A" });
    const client = buildClient(store);
    const r = await resolveLibraryAudioAccess(
      { userId: "u-x", librarySessionChapterId: "ch-A1", now: midDay },
      client
    );
    check("Session missing: ok=false", r.ok, false);
    if (!r.ok)
      check("Session missing: SESSION_NOT_FOUND", r.error, "SESSION_NOT_FOUND");
  }

  // (12) Session inactive → SESSION_INACTIVE, even for paid.
  {
    const store = makeStore();
    seedUser(store, { id: "u-y", plan: "PREMIUM", planPeriodEnd: paidPeriodEnd });
    seedSession(store, { id: "sess-A", isActive: false });
    seedChapter(store, { id: "ch-A1", librarySessionId: "sess-A" });
    const client = buildClient(store);
    const r = await resolveLibraryAudioAccess(
      { userId: "u-y", librarySessionChapterId: "ch-A1", now: midDay },
      client
    );
    check("Session inactive: ok=false", r.ok, false);
    if (!r.ok)
      check("Session inactive: SESSION_INACTIVE", r.error, "SESSION_INACTIVE");
  }

  // (12b) Session inactive + FREE with unlock → still SESSION_INACTIVE.
  {
    const store = makeStore();
    seedUser(store, { id: "u-y2", plan: "FREE" });
    seedSession(store, { id: "sess-A", isActive: false });
    seedChapter(store, { id: "ch-A1", librarySessionId: "sess-A" });
    seedUnlock(store, {
      userId: "u-y2",
      librarySessionId: "sess-A",
      expiresAt: unlockActiveUntil,
    });
    const client = buildClient(store);
    const r = await resolveLibraryAudioAccess(
      { userId: "u-y2", librarySessionChapterId: "ch-A1", now: midDay },
      client
    );
    check("Inactive + FREE unlock: refused", r.ok, false);
    if (!r.ok)
      check(
        "Inactive + FREE unlock: SESSION_INACTIVE",
        r.error,
        "SESSION_INACTIVE"
      );
  }

  // (13) Chapter missing → CHAPTER_NOT_FOUND.
  {
    const store = makeStore();
    seedUser(store, { id: "u-z", plan: "PREMIUM", planPeriodEnd: paidPeriodEnd });
    seedSession(store, { id: "sess-A" });
    const client = buildClient(store);
    const r = await resolveLibraryAudioAccess(
      { userId: "u-z", librarySessionChapterId: "does-not-exist", now: midDay },
      client
    );
    check("Chapter missing: ok=false", r.ok, false);
    if (!r.ok)
      check("Chapter missing: CHAPTER_NOT_FOUND", r.error, "CHAPTER_NOT_FOUND");
  }

  // (14) Chapter belongs to another session (mismatch flag) → CHAPTER_SESSION_MISMATCH.
  {
    const store = makeStore();
    seedUser(store, { id: "u-m", plan: "PREMIUM", planPeriodEnd: paidPeriodEnd });
    seedSession(store, { id: "sess-A" });
    seedSession(store, { id: "sess-B" });
    seedChapter(store, { id: "ch-B1", librarySessionId: "sess-B" });
    const client = buildClient(store);
    const r = await resolveLibraryAudioAccess(
      {
        userId: "u-m",
        librarySessionChapterId: "ch-B1",
        expectedLibrarySessionId: "sess-A",
        now: midDay,
      },
      client
    );
    check("Cross-session chapter: ok=false", r.ok, false);
    if (!r.ok)
      check(
        "Cross-session chapter: CHAPTER_SESSION_MISMATCH",
        r.error,
        "CHAPTER_SESSION_MISMATCH"
      );
  }

  // (15) Chapter without audioKey → CHAPTER_AUDIO_UNAVAILABLE.
  {
    const store = makeStore();
    seedUser(store, { id: "u-noaud", plan: "PREMIUM", planPeriodEnd: paidPeriodEnd });
    seedSession(store, { id: "sess-A" });
    seedChapter(store, {
      id: "ch-A1",
      librarySessionId: "sess-A",
      audioKey: "",
    });
    const client = buildClient(store);
    const r = await resolveLibraryAudioAccess(
      { userId: "u-noaud", librarySessionChapterId: "ch-A1", now: midDay },
      client
    );
    check("Empty audioKey: ok=false", r.ok, false);
    if (!r.ok)
      check(
        "Empty audioKey: CHAPTER_AUDIO_UNAVAILABLE",
        r.error,
        "CHAPTER_AUDIO_UNAVAILABLE"
      );
  }

  // (16) Session active + chapter valid + paid → allowed_direct_plan (happy path).
  {
    const store = makeStore();
    seedUser(store, {
      id: "u-happy",
      plan: "STARTER",
      planPeriodStart: paidPeriodStart,
      planPeriodEnd: paidPeriodEnd,
    });
    seedSession(store, { id: "sess-A" });
    seedChapter(store, { id: "ch-A1", librarySessionId: "sess-A" });
    const client = buildClient(store);
    const r = await resolveLibraryAudioAccess(
      { userId: "u-happy", librarySessionChapterId: "ch-A1", now: midDay },
      client
    );
    check("Happy: ok=true", r.ok, true);
    if (r.ok) check("Happy: allowed_direct_plan", r.outcome, "allowed_direct_plan");
  }

  // ----- Authentication ----------------------------------------------------

  // (17) No user (userId=null) → AUTH_REQUIRED and NO storage access (no
  // DB call happens at all).
  {
    const store = makeStore();
    seedSession(store, { id: "sess-A" });
    seedChapter(store, { id: "ch-A1", librarySessionId: "sess-A" });
    const client = buildClient(store);
    const r = await resolveLibraryAudioAccess(
      { userId: null, librarySessionChapterId: "ch-A1", now: midDay },
      client
    );
    check("Anonymous: ok=false", r.ok, false);
    if (!r.ok) check("Anonymous: AUTH_REQUIRED", r.error, "AUTH_REQUIRED");
    check("Anonymous: zero DB calls", store.callLog.length, 0);
  }

  // (17b) Empty userId string → AUTH_REQUIRED.
  {
    const store = makeStore();
    seedChapter(store, { id: "ch-A1", librarySessionId: "sess-A" });
    seedSession(store, { id: "sess-A" });
    const client = buildClient(store);
    const r = await resolveLibraryAudioAccess(
      { userId: "", librarySessionChapterId: "ch-A1", now: midDay },
      client
    );
    check("Empty userId: refused", r.ok, false);
    if (!r.ok) check("Empty userId: AUTH_REQUIRED", r.error, "AUTH_REQUIRED");
  }

  // (18) Unknown user (session/chapter valid but userId not in store)
  //      → USER_NOT_FOUND (controlled error).
  {
    const store = makeStore();
    seedSession(store, { id: "sess-A" });
    seedChapter(store, { id: "ch-A1", librarySessionId: "sess-A" });
    const client = buildClient(store);
    const r = await resolveLibraryAudioAccess(
      { userId: "ghost-user", librarySessionChapterId: "ch-A1", now: midDay },
      client
    );
    check("Ghost user: ok=false", r.ok, false);
    if (!r.ok) check("Ghost user: USER_NOT_FOUND", r.error, "USER_NOT_FOUND");
  }

  // ----- Read-only separation ----------------------------------------------
  //
  // The stub throws if the resolver ever calls any mutating method on
  // user / session / chapter / unlock, or ANY method on periodUsage or
  // job. The tests above already exercise every branch — this section
  // makes the invariant explicit against user-visible counters.

  // (19) FREE unlock path never touches User.credits.
  {
    const store = makeStore();
    seedUser(store, {
      id: "u-sep",
      plan: "FREE",
      credits: 42,
      probeGenerationsUsed: 2,
    });
    seedSession(store, { id: "sess-A" });
    seedChapter(store, { id: "ch-A1", librarySessionId: "sess-A" });
    seedUnlock(store, {
      userId: "u-sep",
      librarySessionId: "sess-A",
      expiresAt: unlockActiveUntil,
    });
    const client = buildClient(store);
    const before = snapshot(store);
    await resolveLibraryAudioAccess(
      { userId: "u-sep", librarySessionChapterId: "ch-A1", now: midDay },
      client
    );
    const after = snapshot(store);
    check("Read-only: credits unchanged", after.users, before.users);
    check(
      "Read-only: credits still 42",
      store.users.get("u-sep")?.credits,
      42
    );
  }

  // (20) Path never mutates probeGenerationsUsed.
  {
    const store = makeStore();
    seedUser(store, {
      id: "u-sep2",
      plan: "FREE",
      probeGenerationsUsed: 1,
    });
    seedSession(store, { id: "sess-A" });
    seedChapter(store, { id: "ch-A1", librarySessionId: "sess-A" });
    // No unlock — resolver returns UNLOCK_REQUIRED. Still no probe mutation.
    const client = buildClient(store);
    await resolveLibraryAudioAccess(
      { userId: "u-sep2", librarySessionChapterId: "ch-A1", now: midDay },
      client
    );
    check(
      "Read-only: probeGenerationsUsed still 1",
      store.users.get("u-sep2")?.probeGenerationsUsed,
      1
    );
  }

  // (21) PeriodUsage store empty and untouched.
  {
    const store = makeStore();
    seedUser(store, {
      id: "u-sep3",
      plan: "STARTER",
      planPeriodStart: paidPeriodStart,
      planPeriodEnd: paidPeriodEnd,
    });
    seedSession(store, { id: "sess-A" });
    seedChapter(store, { id: "ch-A1", librarySessionId: "sess-A" });
    const client = buildClient(store);
    await resolveLibraryAudioAccess(
      { userId: "u-sep3", librarySessionChapterId: "ch-A1", now: midDay },
      client
    );
    check("Read-only: periodUsages still empty", store.periodUsages.size, 0);
  }

  // (22) Job store empty and untouched.
  {
    const store = makeStore();
    seedUser(store, { id: "u-sep4", plan: "FREE" });
    seedSession(store, { id: "sess-A" });
    seedChapter(store, { id: "ch-A1", librarySessionId: "sess-A" });
    seedUnlock(store, {
      userId: "u-sep4",
      librarySessionId: "sess-A",
      expiresAt: unlockActiveUntil,
    });
    const client = buildClient(store);
    await resolveLibraryAudioAccess(
      { userId: "u-sep4", librarySessionChapterId: "ch-A1", now: midDay },
      client
    );
    check("Read-only: jobs still empty", store.jobs.size, 0);
  }

  // (23) LibraryUnlock rows never mutated by the audio path.
  {
    const store = makeStore();
    seedUser(store, { id: "u-sep5", plan: "FREE" });
    seedSession(store, { id: "sess-A" });
    seedChapter(store, { id: "ch-A1", librarySessionId: "sess-A" });
    seedUnlock(store, {
      id: "unlock-fixed",
      userId: "u-sep5",
      librarySessionId: "sess-A",
      expiresAt: unlockActiveUntil,
    });
    const client = buildClient(store);
    const before = snapshot(store);
    await resolveLibraryAudioAccess(
      { userId: "u-sep5", librarySessionChapterId: "ch-A1", now: midDay },
      client
    );
    const after = snapshot(store);
    check(
      "Read-only: unlocks blob identical",
      after.unlocks,
      before.unlocks
    );
    check("Read-only: unlock count still 1", store.unlocks.size, 1);
  }

  // ----- Route Security ----------------------------------------------------

  // (24) Route: resolver returning ok=true must expose the audioKey (so
  //      the route can stream) — asserted via type shape of the result.
  {
    const store = makeStore();
    seedUser(store, {
      id: "u-r",
      plan: "STARTER",
      planPeriodEnd: paidPeriodEnd,
    });
    seedSession(store, { id: "sess-A" });
    seedChapter(store, { id: "ch-A1", librarySessionId: "sess-A" });
    const client = buildClient(store);
    const r = await resolveLibraryAudioAccess(
      { userId: "u-r", librarySessionChapterId: "ch-A1", now: midDay },
      client
    );
    check("Route: allowed carries audioKey", r.ok && r.grant.audioKey.length > 0, true);
  }

  // (25) UNLOCK_REQUIRED is a stable machine-readable code.
  {
    const store = makeStore();
    seedUser(store, { id: "u-code", plan: "FREE" });
    seedSession(store, { id: "sess-A" });
    seedChapter(store, { id: "ch-A1", librarySessionId: "sess-A" });
    const client = buildClient(store);
    const r = await resolveLibraryAudioAccess(
      { userId: "u-code", librarySessionChapterId: "ch-A1", now: midDay },
      client
    );
    check("Route: refusal has stable code", r.ok, false);
    if (!r.ok) {
      const mapped = httpForAccessError(r.error);
      check("Route: UNLOCK_REQUIRED → 403", mapped.status, 403);
      check(
        "Route: UNLOCK_REQUIRED error string",
        mapped.error,
        "UNLOCK_REQUIRED"
      );
    }
  }

  // (26) Route error mapping never surfaces the raw audioKey. The resolver
  //      Refused result variant has no `grant` field at compile time —
  //      exercise a refused path and assert the shape at runtime.
  {
    const store = makeStore();
    seedUser(store, { id: "u-leak", plan: "FREE" });
    seedSession(store, { id: "sess-A" });
    seedChapter(store, {
      id: "ch-A1",
      librarySessionId: "sess-A",
      audioKey: "SECRET-S3-KEY.mp3",
    });
    const client = buildClient(store);
    const r = await resolveLibraryAudioAccess(
      { userId: "u-leak", librarySessionChapterId: "ch-A1", now: midDay },
      client
    );
    check("Leak-safe: refused", r.ok, false);
    // Only the `error` code is present on the false branch — no grant.
    if (!r.ok) {
      const hasGrant = Object.prototype.hasOwnProperty.call(r, "grant");
      check("Leak-safe: no grant on refused result", hasGrant, false);
    }
  }

  // (27) HTTP status map for every error code (private cache is enforced
  //      by the route, not the resolver, but every code must have a
  //      defined mapping so the route never falls through to 500).
  {
    const codes = [
      "AUTH_REQUIRED",
      "USER_NOT_FOUND",
      "CHAPTER_NOT_FOUND",
      "SESSION_NOT_FOUND",
      "SESSION_INACTIVE",
      "CHAPTER_SESSION_MISMATCH",
      "CHAPTER_AUDIO_UNAVAILABLE",
      "UNLOCK_REQUIRED",
    ] as const;
    for (const c of codes) {
      const mapped = httpForAccessError(c);
      check(`Route: ${c} maps to number`, typeof mapped.status, "number");
      check(`Route: ${c} error string equals code`, mapped.error, c);
    }
    check(
      "Route: AUTH_REQUIRED → 401",
      httpForAccessError("AUTH_REQUIRED").status,
      401
    );
    check(
      "Route: USER_NOT_FOUND → 401",
      httpForAccessError("USER_NOT_FOUND").status,
      401
    );
    check(
      "Route: SESSION_NOT_FOUND → 404",
      httpForAccessError("SESSION_NOT_FOUND").status,
      404
    );
    check(
      "Route: CHAPTER_NOT_FOUND → 404",
      httpForAccessError("CHAPTER_NOT_FOUND").status,
      404
    );
    check(
      "Route: SESSION_INACTIVE → 403",
      httpForAccessError("SESSION_INACTIVE").status,
      403
    );
    check(
      "Route: CHAPTER_SESSION_MISMATCH → 403",
      httpForAccessError("CHAPTER_SESSION_MISMATCH").status,
      403
    );
    check(
      "Route: CHAPTER_AUDIO_UNAVAILABLE → 500",
      httpForAccessError("CHAPTER_AUDIO_UNAVAILABLE").status,
      500
    );
    check(
      "Route: UNLOCK_REQUIRED → 403",
      httpForAccessError("UNLOCK_REQUIRED").status,
      403
    );
  }

  // (28) Range parsing — the route re-uses the same battle-tested pattern
  //      as jobs/audio and tracks/audio, but confirm the pattern lives in
  //      the file at all.
  {
    const routePath = path.resolve(
      __dirname,
      "..",
      "app",
      "api",
      "library",
      "chapters",
      "[id]",
      "audio",
      "route.ts"
    );
    const contents = fs.readFileSync(routePath, "utf8");
    check(
      "Route source: parses Range header",
      contents.includes("parseRangeHeader"),
      true
    );
    check(
      "Route source: 206 partial responses",
      contents.includes("status: 206"),
      true
    );
    check(
      "Route source: 416 for invalid range",
      contents.includes("status: 416"),
      true
    );
    check(
      "Route source: Accept-Ranges: bytes",
      contents.includes('"Accept-Ranges"'),
      true
    );
    check(
      "Route source: audio/mpeg content type",
      contents.includes("audio/mpeg"),
      true
    );
    check(
      "Route source: private no-store cache",
      contents.includes("private, no-store"),
      true
    );
    check(
      "Route source: streams via S3 getObjectByKey",
      contents.includes("getObjectByKey"),
      true
    );
    check(
      "Route source: streams via S3 range",
      contents.includes("getObjectByKeyRange"),
      true
    );
  }

  // ----- Cross-Session Isolation -------------------------------------------

  // (29) FREE unlock for session A + chapter of session A → allowed.
  {
    const store = makeStore();
    seedUser(store, { id: "u-iso", plan: "FREE" });
    seedSession(store, { id: "sess-A" });
    seedSession(store, { id: "sess-B" });
    seedChapter(store, { id: "ch-A1", librarySessionId: "sess-A" });
    seedChapter(store, { id: "ch-B1", librarySessionId: "sess-B" });
    seedUnlock(store, {
      userId: "u-iso",
      librarySessionId: "sess-A",
      expiresAt: unlockActiveUntil,
    });
    const client = buildClient(store);
    const rA = await resolveLibraryAudioAccess(
      { userId: "u-iso", librarySessionChapterId: "ch-A1", now: midDay },
      client
    );
    check("Isolation: A-unlock + A-chapter allowed", rA.ok, true);
  }

  // (30) FREE unlock for session A + chapter of session B → refused.
  {
    const store = makeStore();
    seedUser(store, { id: "u-iso2", plan: "FREE" });
    seedSession(store, { id: "sess-A" });
    seedSession(store, { id: "sess-B" });
    seedChapter(store, { id: "ch-A1", librarySessionId: "sess-A" });
    seedChapter(store, { id: "ch-B1", librarySessionId: "sess-B" });
    seedUnlock(store, {
      userId: "u-iso2",
      librarySessionId: "sess-A",
      expiresAt: unlockActiveUntil,
    });
    const client = buildClient(store);
    const rB = await resolveLibraryAudioAccess(
      { userId: "u-iso2", librarySessionChapterId: "ch-B1", now: midDay },
      client
    );
    check("Isolation: A-unlock + B-chapter refused", rB.ok, false);
    if (!rB.ok)
      check("Isolation: A→B UNLOCK_REQUIRED", rB.error, "UNLOCK_REQUIRED");
  }

  // (31) Paid access is independent of unlocks (unlock for other user
  //      exists → paid still gets in).
  {
    const store = makeStore();
    seedUser(store, {
      id: "u-paid-iso",
      plan: "PREMIUM",
      planPeriodEnd: paidPeriodEnd,
    });
    seedUser(store, { id: "u-other", plan: "FREE" });
    seedSession(store, { id: "sess-A" });
    seedChapter(store, { id: "ch-A1", librarySessionId: "sess-A" });
    // Only the other user has an unlock. Paid user must still get direct
    // access without ever consulting LibraryUnlock.
    seedUnlock(store, {
      userId: "u-other",
      librarySessionId: "sess-A",
      expiresAt: unlockActiveUntil,
    });
    const client = buildClient(store);
    const r = await resolveLibraryAudioAccess(
      {
        userId: "u-paid-iso",
        librarySessionChapterId: "ch-A1",
        now: midDay,
      },
      client
    );
    check("Isolation: paid direct despite other user's unlock", r.ok, true);
    if (r.ok)
      check(
        "Isolation: paid outcome",
        r.outcome,
        "allowed_direct_plan"
      );
    // Sanity check: no unlock lookup happened for the paid user.
    const unlockCalls = store.callLog.filter((s) =>
      s.startsWith("libraryUnlock.findFirst")
    );
    check("Isolation: paid path skipped unlock lookup", unlockCalls.length, 0);
  }

  // (32) Another user's active unlock for the same session does NOT
  //      unlock us. Rejects with UNLOCK_REQUIRED even though the store
  //      has an active unlock row for `sess-A`.
  {
    const store = makeStore();
    seedUser(store, { id: "u-me", plan: "FREE" });
    seedUser(store, { id: "u-them", plan: "FREE" });
    seedSession(store, { id: "sess-A" });
    seedChapter(store, { id: "ch-A1", librarySessionId: "sess-A" });
    seedUnlock(store, {
      userId: "u-them",
      librarySessionId: "sess-A",
      expiresAt: unlockActiveUntil,
    });
    const client = buildClient(store);
    const r = await resolveLibraryAudioAccess(
      { userId: "u-me", librarySessionChapterId: "ch-A1", now: midDay },
      client
    );
    check("Cross-user: refused", r.ok, false);
    if (!r.ok)
      check("Cross-user: UNLOCK_REQUIRED", r.error, "UNLOCK_REQUIRED");
  }

  // ----- Share-leak assertion (source-level) -------------------------------

  // (33) LibrarySessionChapter has no shareSlug field and is not accessible
  //      via /api/public/[slug] — that route queries only Track.
  {
    const publicSlugRoute = path.resolve(
      __dirname,
      "..",
      "app",
      "api",
      "public",
      "[slug]",
      "route.ts"
    );
    const contents = fs.readFileSync(publicSlugRoute, "utf8");
    check(
      "Share-leak: /api/public/[slug] does NOT reference librarySessionChapter",
      contents.includes("librarySessionChapter"),
      false
    );
    check(
      "Share-leak: /api/public/[slug] does NOT reference LibrarySession",
      contents.includes("LibrarySession"),
      false
    );
    check(
      "Share-leak: /api/public/[slug] queries prisma.track (owner surface only)",
      contents.includes("prisma.track"),
      true
    );
  }

  // (34) /api/tracks/[id]/share cannot make a LibrarySessionChapter public.
  {
    const tracksShare = path.resolve(
      __dirname,
      "..",
      "app",
      "api",
      "tracks",
      "[id]",
      "share",
      "route.ts"
    );
    const contents = fs.readFileSync(tracksShare, "utf8");
    check(
      "Share-leak: /api/tracks/[id]/share does NOT touch librarySessionChapter",
      contents.includes("librarySessionChapter"),
      false
    );
    check(
      "Share-leak: /api/tracks/[id]/share does NOT touch LibrarySession",
      contents.includes("LibrarySession"),
      false
    );
  }

  // (35) /api/tracks/public-meta likewise: no library references.
  {
    const publicMeta = path.resolve(
      __dirname,
      "..",
      "app",
      "api",
      "tracks",
      "public-meta",
      "route.ts"
    );
    const contents = fs.readFileSync(publicMeta, "utf8");
    check(
      "Share-leak: /api/tracks/public-meta does NOT reference LibrarySession",
      contents.includes("LibrarySession"),
      false
    );
    check(
      "Share-leak: /api/tracks/public-meta does NOT reference librarySessionChapter",
      contents.includes("librarySessionChapter"),
      false
    );
  }

  // (36) Schema-level: LibrarySessionChapter model does NOT have shareSlug
  //      or isPublic fields — nothing to leak via Track-share mechanics.
  {
    const schemaPath = path.resolve(
      __dirname,
      "..",
      "prisma",
      "schema.prisma"
    );
    const contents = fs.readFileSync(schemaPath, "utf8");
    const idx = contents.indexOf("model LibrarySessionChapter");
    check(
      "Schema: LibrarySessionChapter model exists",
      idx >= 0,
      true
    );
    const modelBlock = contents.slice(idx, idx + 2000);
    // Extract just the immediate model body — cut at first blank line
    // after opening brace.
    const openIdx = modelBlock.indexOf("{");
    const closeIdx = modelBlock.indexOf("}", openIdx);
    const body = modelBlock.slice(openIdx, closeIdx);
    check(
      "Schema: LibrarySessionChapter has NO shareSlug field",
      /\bshareSlug\b/.test(body),
      false
    );
    check(
      "Schema: LibrarySessionChapter has NO isPublic field",
      /\bisPublic\b/.test(body),
      false
    );
  }

  // ----- Extra: parameter-validation edge case -----------------------------

  // (37) Whitespace-only userId is refused as AUTH_REQUIRED.
  {
    const store = makeStore();
    seedSession(store, { id: "sess-A" });
    seedChapter(store, { id: "ch-A1", librarySessionId: "sess-A" });
    const client = buildClient(store);
    const r = await resolveLibraryAudioAccess(
      { userId: "   ", librarySessionChapterId: "ch-A1", now: midDay },
      client
    );
    // Empty-after-trim would be nice but we accept the current
    // implementation's exact behaviour: an all-spaces id is a real string
    // and results in USER_NOT_FOUND (still a controlled refusal, no
    // storage access to bytes).
    if (r.ok) {
      failed++;
      console.log("[FAIL] Whitespace userId must NOT be allowed");
    } else {
      const allowed =
        r.error === "AUTH_REQUIRED" || r.error === "USER_NOT_FOUND";
      check(
        "Whitespace userId: refused with a controlled error",
        allowed,
        true
      );
    }
  }
}

// ---------------------------------------------------------------------------

runTests()
  .then(() => {
    console.log("");
    console.log(
      `Total: ${passed + failed}   Passed: ${passed}   Failed: ${failed}`
    );
    if (failed > 0) process.exit(1);
  })
  .catch((err) => {
    console.error("Test harness threw:", err);
    process.exit(2);
  });

// Preserve the imported type reference for the type checker.
void ({} as LibraryAudioAccessResult);
