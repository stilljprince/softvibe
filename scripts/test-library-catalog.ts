// scripts/test-library-catalog.ts
//
// Offline tests for RP-010 Phase 4D — Curated Library Catalog Read API
// (lib/entitlement/library-catalog.ts).
//
// The harness spins up an in-memory Prisma stub that mirrors the small
// surface listActiveLibrarySessions / getActiveLibrarySessionDetail
// touch: User (read), LibrarySession (read, with chapters + _count),
// LibrarySessionChapter (nested read only), LibraryUnlock (read).
//
// Every mutating method on those surfaces is a hard error, so the
// system-separation invariants (no probe/credit/period/job/unlock/stripe
// writes) are asserted directly against the store on every case.
//
// Run:
//   npx tsx scripts/test-library-catalog.ts

import type { Plan, PrismaClient } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  listActiveLibrarySessions,
  getActiveLibrarySessionDetail,
  libraryChapterAudioUrl,
  LIBRARY_CATALOG_HARD_MAX,
  LIBRARY_CATALOG_DEFAULT_MAX,
  type ListActiveLibrarySessionsResult,
  type GetActiveLibrarySessionDetailResult,
} from "../lib/entitlement/library-catalog";

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

// --- In-memory Prisma stub ------------------------------------------------

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
  slug: string;
  title: string;
  description: string | null;
  preset: string;
  durationSeconds: number | null;
  isActive: boolean;
  createdAt: Date;
};

type StoreChapter = {
  id: string;
  librarySessionId: string;
  partIndex: number;
  title: string | null;
  durationSeconds: number | null;
  audioKey: string; // present so we can catch leaks
};

type StoreUnlock = {
  id: string;
  userId: string;
  librarySessionId: string;
  unlockedAt: Date;
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
    throw new Error(`library-catalog must not call ${method}`);
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
        return { plan: u.plan, planPeriodEnd: u.planPeriodEnd };
      },
      create: forbid("user.create"),
      update: forbid("user.update"),
      updateMany: forbid("user.updateMany"),
      delete: forbid("user.delete"),
    },
    librarySession: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: async (args: any) => {
        store.callLog.push(`librarySession.findMany`);
        const isActiveFilter =
          typeof args?.where?.isActive === "boolean"
            ? args.where.isActive
            : undefined;

        let rows = Array.from(store.sessions.values());
        if (isActiveFilter !== undefined) {
          rows = rows.filter((s) => s.isActive === isActiveFilter);
        }

        // orderBy: support the [{ createdAt: 'desc' }, { id: 'asc' }] shape.
        const orderBy = args?.orderBy;
        if (Array.isArray(orderBy)) {
          rows.sort((a, b) => {
            for (const clause of orderBy) {
              if (clause.createdAt === "desc") {
                const d = b.createdAt.getTime() - a.createdAt.getTime();
                if (d !== 0) return d;
              } else if (clause.createdAt === "asc") {
                const d = a.createdAt.getTime() - b.createdAt.getTime();
                if (d !== 0) return d;
              } else if (clause.id === "asc") {
                if (a.id < b.id) return -1;
                if (a.id > b.id) return 1;
              } else if (clause.id === "desc") {
                if (a.id > b.id) return -1;
                if (a.id < b.id) return 1;
              }
            }
            return 0;
          });
        }

        if (typeof args?.take === "number") {
          rows = rows.slice(0, args.take);
        }

        return rows.map((s) => {
          const chapterCount = Array.from(store.chapters.values()).filter(
            (c) => c.librarySessionId === s.id
          ).length;
          return {
            id: s.id,
            slug: s.slug,
            title: s.title,
            description: s.description,
            preset: s.preset,
            durationSeconds: s.durationSeconds,
            _count: { chapters: chapterCount },
          };
        });
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async (args: any) => {
        store.callLog.push(`librarySession.findUnique:${args.where.id}`);
        const s = store.sessions.get(args.where.id);
        if (!s) return null;
        const includeChapters = !!args?.select?.chapters;
        const base = {
          id: s.id,
          slug: s.slug,
          title: s.title,
          description: s.description,
          preset: s.preset,
          durationSeconds: s.durationSeconds,
          isActive: s.isActive,
        } as Record<string, unknown>;
        if (includeChapters) {
          const chapterOrder = args.select.chapters.orderBy;
          let chapters = Array.from(store.chapters.values()).filter(
            (c) => c.librarySessionId === s.id
          );
          if (chapterOrder?.partIndex === "asc") {
            chapters = chapters.sort((a, b) => a.partIndex - b.partIndex);
          } else if (chapterOrder?.partIndex === "desc") {
            chapters = chapters.sort((a, b) => b.partIndex - a.partIndex);
          }
          // Detect audioKey leak in the select projection — if the
          // resolver ever added audioKey to the select block we would
          // silently start passing it through. Fail loudly instead.
          if (args.select.chapters.select?.audioKey) {
            throw new Error(
              "library-catalog selected audioKey — this is a leak"
            );
          }
          base.chapters = chapters.map((c) => ({
            id: c.id,
            partIndex: c.partIndex,
            title: c.title,
            durationSeconds: c.durationSeconds,
          }));
        }
        return base;
      },
      create: forbid("librarySession.create"),
      update: forbid("librarySession.update"),
      updateMany: forbid("librarySession.updateMany"),
      delete: forbid("librarySession.delete"),
    },
    librarySessionChapter: {
      findUnique: forbid("librarySessionChapter.findUnique"),
      findMany: forbid("librarySessionChapter.findMany"),
      create: forbid("librarySessionChapter.create"),
      update: forbid("librarySessionChapter.update"),
    },
    libraryUnlock: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: async (args: any) => {
        store.callLog.push(`libraryUnlock.findMany`);
        const where = args?.where ?? {};
        let rows = Array.from(store.unlocks.values());
        if (where.userId) rows = rows.filter((r) => r.userId === where.userId);
        if (Array.isArray(where.librarySessionId?.in)) {
          const set = new Set<string>(where.librarySessionId.in);
          rows = rows.filter((r) => set.has(r.librarySessionId));
        }
        if (where.expiresAt?.gt) {
          const cutoff = where.expiresAt.gt as Date;
          rows = rows.filter((r) => r.expiresAt.getTime() > cutoff.getTime());
        }
        if (args?.orderBy?.expiresAt === "desc") {
          rows.sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime());
        }
        return rows.map((r) => ({
          librarySessionId: r.librarySessionId,
          expiresAt: r.expiresAt,
        }));
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findFirst: async (args: any) => {
        store.callLog.push(`libraryUnlock.findFirst`);
        const where = args?.where ?? {};
        let rows = Array.from(store.unlocks.values());
        if (where.userId) rows = rows.filter((r) => r.userId === where.userId);
        if (where.librarySessionId)
          rows = rows.filter(
            (r) => r.librarySessionId === where.librarySessionId
          );
        if (where.expiresAt?.gt) {
          const cutoff = where.expiresAt.gt as Date;
          rows = rows.filter((r) => r.expiresAt.getTime() > cutoff.getTime());
        }
        if (args?.orderBy?.expiresAt === "desc") {
          rows.sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime());
        }
        const r = rows[0];
        if (!r) return null;
        return { expiresAt: r.expiresAt };
      },
      create: forbid("libraryUnlock.create"),
      update: forbid("libraryUnlock.update"),
      updateMany: forbid("libraryUnlock.updateMany"),
      delete: forbid("libraryUnlock.delete"),
      deleteMany: forbid("libraryUnlock.deleteMany"),
      upsert: forbid("libraryUnlock.upsert"),
    },
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

// --- Seeders --------------------------------------------------------------

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
  s: {
    id: string;
    slug?: string;
    title?: string;
    description?: string | null;
    preset?: string;
    durationSeconds?: number | null;
    isActive?: boolean;
    createdAt?: Date;
  }
): void {
  store.sessions.set(s.id, {
    id: s.id,
    slug: s.slug ?? `slug-${s.id}`,
    title: s.title ?? `Title ${s.id}`,
    description: s.description ?? null,
    preset: s.preset ?? "sleep_story",
    durationSeconds: s.durationSeconds ?? null,
    isActive: s.isActive ?? true,
    createdAt: s.createdAt ?? new Date("2026-07-01T00:00:00.000Z"),
  });
}

function seedChapter(
  store: Store,
  c: {
    id: string;
    librarySessionId: string;
    partIndex: number;
    title?: string | null;
    durationSeconds?: number | null;
    audioKey?: string;
  }
): void {
  store.chapters.set(c.id, {
    id: c.id,
    librarySessionId: c.librarySessionId,
    partIndex: c.partIndex,
    title: c.title ?? null,
    durationSeconds: c.durationSeconds ?? null,
    audioKey: c.audioKey ?? `library/${c.librarySessionId}/${c.id}.mp3`,
  });
}

function seedUnlock(
  store: Store,
  u: {
    id?: string;
    userId: string;
    librarySessionId: string;
    unlockedAt?: Date;
    expiresAt: Date;
  }
): void {
  const id = u.id ?? `unlock-${store.unlocks.size + 1}`;
  store.unlocks.set(id, {
    id,
    userId: u.userId,
    librarySessionId: u.librarySessionId,
    unlockedAt: u.unlockedAt ?? new Date(),
    expiresAt: u.expiresAt,
  });
}

function snapshot(store: Store) {
  const userDump = Array.from(store.users.values())
    .map(
      (u) =>
        `${u.id}|${u.plan}|${u.credits}|${u.probeGenerationsUsed}|${u.planPeriodEnd?.toISOString() ?? ""}`
    )
    .join(",");
  const sessionDump = Array.from(store.sessions.values())
    .map((s) => `${s.id}|${s.isActive}|${s.title}`)
    .join(",");
  const chapterDump = Array.from(store.chapters.values())
    .map((c) => `${c.id}|${c.librarySessionId}|${c.partIndex}|${c.audioKey}`)
    .join(",");
  const unlockDump = Array.from(store.unlocks.values())
    .map(
      (u) =>
        `${u.id}|${u.userId}|${u.librarySessionId}|${u.expiresAt.toISOString()}`
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
const unlockActiveUntil = new Date(midDay.getTime() + 4 * 60 * 60 * 1000);

// Response-safety scan: recursively assert no field named `audioKey`,
// `providerEventId`, `credits`, `probeGenerationsUsed`, etc. escapes.
const FORBIDDEN_KEYS = new Set([
  "audioKey",
  "providerEventId",
  "credits",
  "probeGenerationsUsed",
  "planPeriodStart",
  "planPeriodEnd",
  "stripeCustomerId",
  "userId",
  "unlockId",
  "unlockedAt",
]);
function assertNoForbiddenKeys(label: string, obj: unknown): void {
  function walk(node: unknown, pathParts: string[]): void {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, pathParts.concat(String(i))));
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (FORBIDDEN_KEYS.has(k)) {
        console.log(
          `[FAIL] ${label}: forbidden key "${k}" at ${pathParts.concat(k).join(".")}`
        );
        failed++;
      }
      walk(v, pathParts.concat(k));
    }
  }
  walk(obj, []);
}

function assertNoAudioKeyInJson(label: string, obj: unknown): void {
  const s = JSON.stringify(obj);
  check(`${label}: JSON contains no audioKey`, /audioKey/.test(s), false);
  check(`${label}: JSON contains no S3 fragment .mp3`, /\.mp3/.test(s), false);
  check(
    `${label}: JSON contains no S3 prefix`,
    /library\//.test(s.replace(/api\/library\/chapters/g, "")),
    false
  );
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

async function runTests(): Promise<void> {
  // ================================================================
  // LIST route
  // ================================================================

  // (L1) authenticated FREE — only active sessions returned.
  {
    const store = makeStore();
    seedUser(store, { id: "u1", plan: "FREE" });
    seedSession(store, {
      id: "s1",
      title: "Ocean",
      createdAt: new Date("2026-07-10T00:00:00.000Z"),
    });
    seedSession(store, {
      id: "s2",
      title: "Hidden",
      isActive: false,
      createdAt: new Date("2026-07-11T00:00:00.000Z"),
    });
    seedSession(store, {
      id: "s3",
      title: "Rain",
      createdAt: new Date("2026-07-12T00:00:00.000Z"),
    });
    seedChapter(store, { id: "s1-c1", librarySessionId: "s1", partIndex: 1 });
    seedChapter(store, { id: "s1-c2", librarySessionId: "s1", partIndex: 2 });
    seedChapter(store, { id: "s3-c1", librarySessionId: "s3", partIndex: 1 });

    const client = buildClient(store);
    const before = snapshot(store);
    const r = await listActiveLibrarySessions(
      "u1",
      { now: midDay },
      client
    );
    check("L1: ok=true", r.ok, true);
    if (r.ok) {
      check("L1: only active sessions returned", r.sessions.length, 2);
      const titles = r.sessions.map((s) => s.title).join(",");
      // Sorted by createdAt desc → Rain, Ocean
      check("L1: sorted createdAt desc", titles, "Rain,Ocean");
      check("L1: no inactive leaked", titles.includes("Hidden"), false);
      check("L1: s1 chapterCount", r.sessions.find((s) => s.id === "s1")?.chapterCount, 2);
      check("L1: s3 chapterCount", r.sessions.find((s) => s.id === "s3")?.chapterCount, 1);
      assertNoAudioKeyInJson("L1", r.sessions);
      assertNoForbiddenKeys("L1", r.sessions);
    }
    assertNoMutation("L1", before, snapshot(store));
  }

  // (L2) empty library → empty list.
  {
    const store = makeStore();
    seedUser(store, { id: "u1", plan: "FREE" });
    const client = buildClient(store);
    const r = await listActiveLibrarySessions("u1", { now: midDay }, client);
    check("L2: empty ok", r.ok, true);
    if (r.ok) check("L2: empty sessions", r.sessions.length, 0);
    // With no sessions, unlock query MUST be skipped (batched cost=0).
    const unlockCalls = store.callLog.filter((c) =>
      c.startsWith("libraryUnlock.findMany")
    );
    check("L2: no unlock lookup on empty list", unlockCalls.length, 0);
  }

  // (L3) inactive-only library → empty list.
  {
    const store = makeStore();
    seedUser(store, { id: "u1", plan: "FREE" });
    seedSession(store, { id: "s1", isActive: false });
    seedSession(store, { id: "s2", isActive: false });
    const client = buildClient(store);
    const r = await listActiveLibrarySessions("u1", { now: midDay }, client);
    check("L3: ok true", r.ok, true);
    if (r.ok) check("L3: no rows leak", r.sessions.length, 0);
  }

  // (L4) deterministic ordering: two sessions with identical createdAt
  // fall back to id asc.
  {
    const store = makeStore();
    seedUser(store, { id: "u1", plan: "FREE" });
    const same = new Date("2026-07-10T00:00:00.000Z");
    seedSession(store, { id: "sB", title: "B", createdAt: same });
    seedSession(store, { id: "sA", title: "A", createdAt: same });
    const client = buildClient(store);
    const r = await listActiveLibrarySessions("u1", { now: midDay }, client);
    if (r.ok) {
      const ids = r.sessions.map((s) => s.id).join(",");
      check("L4: id asc tiebreaker", ids, "sA,sB");
    }
  }

  // (L5) STARTER → direct_plan_access on every session, no unlock lookup.
  {
    const store = makeStore();
    seedUser(store, {
      id: "u1",
      plan: "STARTER",
      planPeriodStart: paidPeriodStart,
      planPeriodEnd: paidPeriodEnd,
    });
    seedSession(store, { id: "s1" });
    seedSession(store, { id: "s2" });
    const client = buildClient(store);
    const r = await listActiveLibrarySessions("u1", { now: midDay }, client);
    check("L5: ok", r.ok, true);
    if (r.ok) {
      check("L5: two rows", r.sessions.length, 2);
      for (const s of r.sessions) {
        check(`L5: ${s.id} direct_plan_access`, s.access.status, "direct_plan_access");
        check(`L5: ${s.id} null unlockExpiresAt`, s.access.unlockExpiresAt, null);
      }
    }
    const unlockCalls = store.callLog.filter((c) =>
      c.startsWith("libraryUnlock.findMany")
    );
    check("L5: paid path skipped unlock lookup", unlockCalls.length, 0);
  }

  // (L6) PREMIUM → direct_plan_access.
  {
    const store = makeStore();
    seedUser(store, {
      id: "u1",
      plan: "PREMIUM",
      planPeriodStart: paidPeriodStart,
      planPeriodEnd: paidPeriodEnd,
    });
    seedSession(store, { id: "s1" });
    const client = buildClient(store);
    const r = await listActiveLibrarySessions("u1", { now: midDay }, client);
    if (r.ok)
      check(
        "L6: PREMIUM direct_plan_access",
        r.sessions[0]?.access.status,
        "direct_plan_access"
      );
  }

  // (L7) expired paid plan → effective FREE.
  {
    const store = makeStore();
    seedUser(store, {
      id: "u1",
      plan: "STARTER",
      planPeriodStart: paidPeriodStart,
      planPeriodEnd: paidPeriodEnd,
    });
    seedSession(store, { id: "s1" });
    const client = buildClient(store);
    const r = await listActiveLibrarySessions(
      "u1",
      { now: pastPaidPeriod },
      client
    );
    if (r.ok)
      check(
        "L7: expired paid → requires_sponsored_unlock",
        r.sessions[0]?.access.status,
        "requires_sponsored_unlock"
      );
  }

  // (L8) paid with null planPeriodEnd (legacy) → still paid.
  {
    const store = makeStore();
    seedUser(store, {
      id: "u1",
      plan: "STARTER",
      planPeriodStart: null,
      planPeriodEnd: null,
    });
    seedSession(store, { id: "s1" });
    const client = buildClient(store);
    const r = await listActiveLibrarySessions("u1", { now: midDay }, client);
    if (r.ok)
      check(
        "L8: legacy paid direct_plan_access",
        r.sessions[0]?.access.status,
        "direct_plan_access"
      );
  }

  // (L9) FREE with active unlock only for s1 → s1 active_unlock, s2 requires.
  {
    const store = makeStore();
    seedUser(store, { id: "u1", plan: "FREE" });
    seedSession(store, {
      id: "s1",
      createdAt: new Date("2026-07-11T00:00:00.000Z"),
    });
    seedSession(store, {
      id: "s2",
      createdAt: new Date("2026-07-10T00:00:00.000Z"),
    });
    seedUnlock(store, {
      userId: "u1",
      librarySessionId: "s1",
      expiresAt: unlockActiveUntil,
    });
    const client = buildClient(store);
    const r = await listActiveLibrarySessions("u1", { now: midDay }, client);
    if (r.ok) {
      const s1 = r.sessions.find((x) => x.id === "s1");
      const s2 = r.sessions.find((x) => x.id === "s2");
      check("L9: s1 active_unlock", s1?.access.status, "active_unlock");
      check(
        "L9: s1 unlockExpiresAt echoed",
        s1?.access.unlockExpiresAt?.getTime(),
        unlockActiveUntil.getTime()
      );
      check(
        "L9: s2 requires_sponsored_unlock",
        s2?.access.status,
        "requires_sponsored_unlock"
      );
      check("L9: s2 null expiry", s2?.access.unlockExpiresAt, null);
    }
    // Exactly one batched unlock query.
    const unlockCalls = store.callLog.filter((c) =>
      c.startsWith("libraryUnlock.findMany")
    );
    check("L9: single batched unlock query", unlockCalls.length, 1);
  }

  // (L10) expired unlock ignored → requires_sponsored_unlock.
  {
    const store = makeStore();
    seedUser(store, { id: "u1", plan: "FREE" });
    seedSession(store, { id: "s1" });
    seedUnlock(store, {
      userId: "u1",
      librarySessionId: "s1",
      expiresAt: new Date(midDay.getTime() - 1),
    });
    const client = buildClient(store);
    const r = await listActiveLibrarySessions("u1", { now: midDay }, client);
    if (r.ok)
      check(
        "L10: expired unlock → requires_sponsored_unlock",
        r.sessions[0]?.access.status,
        "requires_sponsored_unlock"
      );
  }

  // (L11) unlock at exactly expiresAt === now is expired (strict >).
  {
    const store = makeStore();
    seedUser(store, { id: "u1", plan: "FREE" });
    seedSession(store, { id: "s1" });
    seedUnlock(store, {
      userId: "u1",
      librarySessionId: "s1",
      expiresAt: midDay,
    });
    const client = buildClient(store);
    const r = await listActiveLibrarySessions("u1", { now: midDay }, client);
    if (r.ok)
      check(
        "L11: expiresAt=now → expired",
        r.sessions[0]?.access.status,
        "requires_sponsored_unlock"
      );
  }

  // (L12) unlock for OTHER session/user does not carry over.
  {
    const store = makeStore();
    seedUser(store, { id: "u1", plan: "FREE" });
    seedUser(store, { id: "u2", plan: "FREE" });
    seedSession(store, { id: "s1" });
    seedSession(store, { id: "s2" });
    seedUnlock(store, {
      userId: "u2",
      librarySessionId: "s1",
      expiresAt: unlockActiveUntil,
    });
    seedUnlock(store, {
      userId: "u1",
      librarySessionId: "s2",
      expiresAt: unlockActiveUntil,
    });
    const client = buildClient(store);
    const r = await listActiveLibrarySessions("u1", { now: midDay }, client);
    if (r.ok) {
      const s1 = r.sessions.find((x) => x.id === "s1");
      const s2 = r.sessions.find((x) => x.id === "s2");
      check(
        "L12: other user's unlock ignored for s1",
        s1?.access.status,
        "requires_sponsored_unlock"
      );
      check("L12: my unlock present for s2", s2?.access.status, "active_unlock");
    }
  }

  // (L13) multiple active unlocks for the same session → latest wins.
  {
    const store = makeStore();
    seedUser(store, { id: "u1", plan: "FREE" });
    seedSession(store, { id: "s1" });
    const early = new Date(midDay.getTime() + 60 * 60 * 1000); // +1h
    const late = new Date(midDay.getTime() + 6 * 60 * 60 * 1000); // +6h
    seedUnlock(store, {
      userId: "u1",
      librarySessionId: "s1",
      expiresAt: early,
    });
    seedUnlock(store, {
      userId: "u1",
      librarySessionId: "s1",
      expiresAt: late,
    });
    const client = buildClient(store);
    const r = await listActiveLibrarySessions("u1", { now: midDay }, client);
    if (r.ok) {
      check(
        "L13: latest unlock chosen",
        r.sessions[0]?.access.unlockExpiresAt?.getTime(),
        late.getTime()
      );
    }
  }

  // (L14) anonymous → AUTH_REQUIRED, zero DB reads.
  {
    const store = makeStore();
    seedSession(store, { id: "s1" });
    const client = buildClient(store);
    const r = await listActiveLibrarySessions(null, { now: midDay }, client);
    check("L14: refused", r.ok, false);
    if (!r.ok) check("L14: AUTH_REQUIRED", r.error, "AUTH_REQUIRED");
    check("L14: zero DB reads", store.callLog.length, 0);
  }

  // (L15) empty userId → AUTH_REQUIRED.
  {
    const store = makeStore();
    const client = buildClient(store);
    const r = await listActiveLibrarySessions("", { now: midDay }, client);
    if (!r.ok) check("L15: AUTH_REQUIRED for empty id", r.error, "AUTH_REQUIRED");
  }

  // (L16) unknown user → USER_NOT_FOUND.
  {
    const store = makeStore();
    seedSession(store, { id: "s1" });
    const client = buildClient(store);
    const r = await listActiveLibrarySessions("ghost", { now: midDay }, client);
    if (!r.ok) check("L16: USER_NOT_FOUND", r.error, "USER_NOT_FOUND");
  }

  // (L17) User is read exactly once per request.
  {
    const store = makeStore();
    seedUser(store, { id: "u1", plan: "FREE" });
    for (let i = 0; i < 10; i++) {
      seedSession(store, { id: `s${i}`, createdAt: new Date(2026, 6, 10 + i) });
    }
    const client = buildClient(store);
    await listActiveLibrarySessions("u1", { now: midDay }, client);
    const userCalls = store.callLog.filter((c) => c.startsWith("user.findUnique"));
    check("L17: user read exactly once", userCalls.length, 1);
  }

  // (L18) Unlock is queried at most once for the list (batched).
  {
    const store = makeStore();
    seedUser(store, { id: "u1", plan: "FREE" });
    for (let i = 0; i < 5; i++) {
      seedSession(store, { id: `s${i}` });
      seedUnlock(store, {
        userId: "u1",
        librarySessionId: `s${i}`,
        expiresAt: unlockActiveUntil,
      });
    }
    const client = buildClient(store);
    await listActiveLibrarySessions("u1", { now: midDay }, client);
    const unlockCalls = store.callLog.filter((c) =>
      c.startsWith("libraryUnlock.findMany")
    );
    check("L18: exactly one batched unlock query for many sessions", unlockCalls.length, 1);
  }

  // (L19) Sessions read exactly once.
  {
    const store = makeStore();
    seedUser(store, { id: "u1", plan: "FREE" });
    for (let i = 0; i < 3; i++) seedSession(store, { id: `s${i}` });
    const client = buildClient(store);
    await listActiveLibrarySessions("u1", { now: midDay }, client);
    const sessionCalls = store.callLog.filter((c) =>
      c.startsWith("librarySession.findMany")
    );
    check("L19: sessions read once", sessionCalls.length, 1);
  }

  // (L20) take clamp — request 500 → serves 100 max.
  {
    const store = makeStore();
    seedUser(store, { id: "u1", plan: "FREE" });
    for (let i = 0; i < 150; i++) {
      seedSession(store, {
        id: `s${String(i).padStart(3, "0")}`,
        createdAt: new Date(2026, 0, 1 + i),
      });
    }
    const client = buildClient(store);
    const r = await listActiveLibrarySessions(
      "u1",
      { take: 500, now: midDay },
      client
    );
    if (r.ok)
      check(
        `L20: hard cap ${LIBRARY_CATALOG_HARD_MAX}`,
        r.sessions.length,
        LIBRARY_CATALOG_HARD_MAX
      );
  }

  // (L21) default take = LIBRARY_CATALOG_DEFAULT_MAX.
  {
    const store = makeStore();
    seedUser(store, { id: "u1", plan: "FREE" });
    for (let i = 0; i < 120; i++) {
      seedSession(store, {
        id: `s${String(i).padStart(3, "0")}`,
        createdAt: new Date(2026, 0, 1 + i),
      });
    }
    const client = buildClient(store);
    const r = await listActiveLibrarySessions("u1", { now: midDay }, client);
    if (r.ok)
      check(
        `L21: default cap ${LIBRARY_CATALOG_DEFAULT_MAX}`,
        r.sessions.length,
        LIBRARY_CATALOG_DEFAULT_MAX
      );
  }

  // (L22) list response shape has expected keys and NOTHING extra.
  {
    const store = makeStore();
    seedUser(store, { id: "u1", plan: "FREE" });
    seedSession(store, {
      id: "s1",
      slug: "sea",
      title: "Sea",
      description: "Waves",
      preset: "sleep_story",
      durationSeconds: 600,
    });
    seedChapter(store, { id: "s1-c1", librarySessionId: "s1", partIndex: 1 });
    const client = buildClient(store);
    const r = await listActiveLibrarySessions("u1", { now: midDay }, client);
    if (r.ok && r.sessions[0]) {
      const s = r.sessions[0];
      const keys = Object.keys(s).sort().join(",");
      check(
        "L22: list item keys",
        keys,
        "access,chapterCount,description,durationSeconds,id,preset,slug,title"
      );
      const accessKeys = Object.keys(s.access).sort().join(",");
      check("L22: access keys", accessKeys, "status,unlockExpiresAt");
    }
  }

  // ================================================================
  // DETAIL route
  // ================================================================

  // (D1) active session for FREE without unlock → requires_sponsored_unlock,
  // audioUrl set for each chapter.
  {
    const store = makeStore();
    seedUser(store, { id: "u1", plan: "FREE" });
    seedSession(store, { id: "s1", slug: "sea", title: "Sea" });
    seedChapter(store, {
      id: "s1-c2",
      librarySessionId: "s1",
      partIndex: 2,
      title: "Later",
      durationSeconds: 120,
    });
    seedChapter(store, {
      id: "s1-c1",
      librarySessionId: "s1",
      partIndex: 1,
      title: "Intro",
      durationSeconds: 90,
    });
    const client = buildClient(store);
    const before = snapshot(store);
    const r = await getActiveLibrarySessionDetail(
      "u1",
      "s1",
      { now: midDay },
      client
    );
    check("D1: ok", r.ok, true);
    if (r.ok) {
      check("D1: id echoed", r.session.id, "s1");
      check(
        "D1: access status",
        r.session.access.status,
        "requires_sponsored_unlock"
      );
      check("D1: null unlock expiry", r.session.access.unlockExpiresAt, null);
      // Chapters ordered by partIndex asc.
      const order = r.session.chapters.map((c) => c.partIndex).join(",");
      check("D1: chapters partIndex asc", order, "1,2");
      check(
        "D1: chapter audioUrl points at protected route",
        r.session.chapters[0]?.audioUrl,
        "/api/library/chapters/s1-c1/audio"
      );
      check(
        "D1: chapter title present",
        r.session.chapters[0]?.title,
        "Intro"
      );
      assertNoAudioKeyInJson("D1", r.session);
      assertNoForbiddenKeys("D1", r.session);
    }
    assertNoMutation("D1", before, snapshot(store));
  }

  // (D2) STARTER → direct_plan_access, no unlock query.
  {
    const store = makeStore();
    seedUser(store, {
      id: "u1",
      plan: "STARTER",
      planPeriodStart: paidPeriodStart,
      planPeriodEnd: paidPeriodEnd,
    });
    seedSession(store, { id: "s1" });
    seedChapter(store, { id: "s1-c1", librarySessionId: "s1", partIndex: 1 });
    const client = buildClient(store);
    const r = await getActiveLibrarySessionDetail(
      "u1",
      "s1",
      { now: midDay },
      client
    );
    if (r.ok) {
      check(
        "D2: direct_plan_access",
        r.session.access.status,
        "direct_plan_access"
      );
    }
    const unlockCalls = store.callLog.filter((c) =>
      c.startsWith("libraryUnlock")
    );
    check("D2: paid: no unlock lookup", unlockCalls.length, 0);
  }

  // (D3) FREE with active matching unlock → active_unlock + expiry.
  {
    const store = makeStore();
    seedUser(store, { id: "u1", plan: "FREE" });
    seedSession(store, { id: "s1" });
    seedChapter(store, { id: "s1-c1", librarySessionId: "s1", partIndex: 1 });
    seedUnlock(store, {
      userId: "u1",
      librarySessionId: "s1",
      expiresAt: unlockActiveUntil,
    });
    const client = buildClient(store);
    const r = await getActiveLibrarySessionDetail(
      "u1",
      "s1",
      { now: midDay },
      client
    );
    if (r.ok) {
      check("D3: active_unlock", r.session.access.status, "active_unlock");
      check(
        "D3: expiry echoed",
        r.session.access.unlockExpiresAt?.getTime(),
        unlockActiveUntil.getTime()
      );
    }
  }

  // (D4) inactive session → SESSION_NOT_FOUND.
  {
    const store = makeStore();
    seedUser(store, { id: "u1", plan: "PREMIUM", planPeriodEnd: paidPeriodEnd });
    seedSession(store, { id: "s1", isActive: false });
    seedChapter(store, { id: "s1-c1", librarySessionId: "s1", partIndex: 1 });
    const client = buildClient(store);
    const r = await getActiveLibrarySessionDetail(
      "u1",
      "s1",
      { now: midDay },
      client
    );
    check("D4: refused", r.ok, false);
    if (!r.ok) check("D4: SESSION_NOT_FOUND", r.error, "SESSION_NOT_FOUND");
  }

  // (D5) unknown session id → SESSION_NOT_FOUND.
  {
    const store = makeStore();
    seedUser(store, { id: "u1", plan: "FREE" });
    const client = buildClient(store);
    const r = await getActiveLibrarySessionDetail(
      "u1",
      "does-not-exist",
      { now: midDay },
      client
    );
    if (!r.ok) check("D5: unknown session", r.error, "SESSION_NOT_FOUND");
  }

  // (D6) blank / empty id → SESSION_NOT_FOUND.
  {
    const store = makeStore();
    seedUser(store, { id: "u1", plan: "FREE" });
    const client = buildClient(store);
    const r1 = await getActiveLibrarySessionDetail("u1", "", {}, client);
    if (!r1.ok) check("D6a: blank id", r1.error, "SESSION_NOT_FOUND");
    const r2 = await getActiveLibrarySessionDetail("u1", "   ", {}, client);
    if (!r2.ok) check("D6b: whitespace id", r2.error, "SESSION_NOT_FOUND");
  }

  // (D7) anonymous → AUTH_REQUIRED, no DB read.
  {
    const store = makeStore();
    seedSession(store, { id: "s1" });
    const client = buildClient(store);
    const r = await getActiveLibrarySessionDetail(null, "s1", {}, client);
    if (!r.ok) check("D7: AUTH_REQUIRED", r.error, "AUTH_REQUIRED");
    check("D7: no DB reads", store.callLog.length, 0);
  }

  // (D8) unknown user → USER_NOT_FOUND.
  {
    const store = makeStore();
    seedSession(store, { id: "s1" });
    const client = buildClient(store);
    const r = await getActiveLibrarySessionDetail("ghost", "s1", {}, client);
    if (!r.ok) check("D8: USER_NOT_FOUND", r.error, "USER_NOT_FOUND");
  }

  // (D9) response shape (top-level session keys).
  {
    const store = makeStore();
    seedUser(store, { id: "u1", plan: "FREE" });
    seedSession(store, {
      id: "s1",
      slug: "sea",
      title: "Sea",
      description: "d",
      preset: "sleep_story",
      durationSeconds: 300,
    });
    seedChapter(store, { id: "s1-c1", librarySessionId: "s1", partIndex: 1 });
    const client = buildClient(store);
    const r = await getActiveLibrarySessionDetail(
      "u1",
      "s1",
      { now: midDay },
      client
    );
    if (r.ok) {
      const keys = Object.keys(r.session).sort().join(",");
      check(
        "D9: session keys",
        keys,
        "access,chapters,description,durationSeconds,id,preset,slug,title"
      );
      const cKeys = Object.keys(r.session.chapters[0] ?? {}).sort().join(",");
      check(
        "D9: chapter keys",
        cKeys,
        "audioUrl,durationSeconds,id,partIndex,title"
      );
    }
  }

  // (D10) audioUrl always points at Phase-4C route regardless of access.
  {
    const store = makeStore();
    seedUser(store, { id: "u1", plan: "FREE" });
    seedSession(store, { id: "s1" });
    seedChapter(store, { id: "s1-c1", librarySessionId: "s1", partIndex: 1 });
    const client = buildClient(store);
    const r = await getActiveLibrarySessionDetail(
      "u1",
      "s1",
      { now: midDay },
      client
    );
    if (r.ok) {
      const url = r.session.chapters[0]?.audioUrl;
      check(
        "D10: audioUrl is Phase-4C route",
        url,
        "/api/library/chapters/s1-c1/audio"
      );
      check(
        "D10: audioUrl contains no S3 fragment",
        /\.mp3|s3:\/\/|https?:\/\//.test(url ?? ""),
        false
      );
    }
  }

  // (D11) empty chapters — still returns session with empty chapters.
  {
    const store = makeStore();
    seedUser(store, { id: "u1", plan: "FREE" });
    seedSession(store, { id: "s1" });
    const client = buildClient(store);
    const r = await getActiveLibrarySessionDetail(
      "u1",
      "s1",
      { now: midDay },
      client
    );
    if (r.ok) check("D11: empty chapters ok", r.session.chapters.length, 0);
  }

  // (D12) expired paid → effective FREE, without unlock →
  // requires_sponsored_unlock.
  {
    const store = makeStore();
    seedUser(store, {
      id: "u1",
      plan: "PREMIUM",
      planPeriodStart: paidPeriodStart,
      planPeriodEnd: paidPeriodEnd,
    });
    seedSession(store, { id: "s1" });
    seedChapter(store, { id: "s1-c1", librarySessionId: "s1", partIndex: 1 });
    const client = buildClient(store);
    const r = await getActiveLibrarySessionDetail(
      "u1",
      "s1",
      { now: pastPaidPeriod },
      client
    );
    if (r.ok)
      check(
        "D12: expired paid → sponsored required",
        r.session.access.status,
        "requires_sponsored_unlock"
      );
  }

  // (D13) unlock for another session does not carry over.
  {
    const store = makeStore();
    seedUser(store, { id: "u1", plan: "FREE" });
    seedSession(store, { id: "s1" });
    seedSession(store, { id: "s2" });
    seedUnlock(store, {
      userId: "u1",
      librarySessionId: "s2",
      expiresAt: unlockActiveUntil,
    });
    const client = buildClient(store);
    const r = await getActiveLibrarySessionDetail(
      "u1",
      "s1",
      { now: midDay },
      client
    );
    if (r.ok)
      check(
        "D13: cross-session unlock ignored",
        r.session.access.status,
        "requires_sponsored_unlock"
      );
  }

  // (D14) list <-> detail parity: same access status for the same user+session.
  {
    const store = makeStore();
    seedUser(store, { id: "u1", plan: "FREE" });
    seedSession(store, { id: "s1" });
    seedChapter(store, { id: "s1-c1", librarySessionId: "s1", partIndex: 1 });
    seedUnlock(store, {
      userId: "u1",
      librarySessionId: "s1",
      expiresAt: unlockActiveUntil,
    });
    const client = buildClient(store);
    const list = await listActiveLibrarySessions(
      "u1",
      { now: midDay },
      client
    );
    const detail = await getActiveLibrarySessionDetail(
      "u1",
      "s1",
      { now: midDay },
      client
    );
    if (list.ok && detail.ok) {
      check(
        "D14: list.access == detail.access status",
        list.sessions[0]?.access.status,
        detail.session.access.status
      );
      check(
        "D14: list.expiry == detail.expiry",
        list.sessions[0]?.access.unlockExpiresAt?.getTime() ?? null,
        detail.session.access.unlockExpiresAt?.getTime() ?? null
      );
    }
  }

  // (D15) audioKey NEVER appears in any detail response.
  {
    const store = makeStore();
    seedUser(store, { id: "u1", plan: "PREMIUM", planPeriodEnd: paidPeriodEnd });
    seedSession(store, { id: "s1" });
    seedChapter(store, {
      id: "s1-c1",
      librarySessionId: "s1",
      partIndex: 1,
      audioKey: "SECRET-S3-KEY-abc.mp3",
    });
    const client = buildClient(store);
    const r = await getActiveLibrarySessionDetail(
      "u1",
      "s1",
      { now: midDay },
      client
    );
    if (r.ok) {
      const j = JSON.stringify(r.session);
      check("D15: no audioKey", /audioKey/.test(j), false);
      check("D15: no SECRET-S3-KEY", /SECRET-S3-KEY/.test(j), false);
    }
  }

  // ================================================================
  // Read-only separation
  // ================================================================

  // (S1) FREE list path never mutates credits / probe / period / job / unlock.
  {
    const store = makeStore();
    seedUser(store, {
      id: "u1",
      plan: "FREE",
      credits: 42,
      probeGenerationsUsed: 1,
    });
    seedSession(store, { id: "s1" });
    seedUnlock(store, {
      userId: "u1",
      librarySessionId: "s1",
      expiresAt: unlockActiveUntil,
    });
    const client = buildClient(store);
    const before = snapshot(store);
    await listActiveLibrarySessions("u1", { now: midDay }, client);
    const after = snapshot(store);
    assertNoMutation("S1 list FREE", before, after);
    check("S1: credits still 42", store.users.get("u1")?.credits, 42);
    check(
      "S1: probeGenerationsUsed still 1",
      store.users.get("u1")?.probeGenerationsUsed,
      1
    );
  }

  // (S2) Paid list path also mutates nothing.
  {
    const store = makeStore();
    seedUser(store, {
      id: "u1",
      plan: "STARTER",
      planPeriodStart: paidPeriodStart,
      planPeriodEnd: paidPeriodEnd,
    });
    seedSession(store, { id: "s1" });
    const client = buildClient(store);
    const before = snapshot(store);
    await listActiveLibrarySessions("u1", { now: midDay }, client);
    assertNoMutation("S2 list paid", before, snapshot(store));
  }

  // (S3) Detail path mutates nothing.
  {
    const store = makeStore();
    seedUser(store, { id: "u1", plan: "FREE" });
    seedSession(store, { id: "s1" });
    seedChapter(store, { id: "s1-c1", librarySessionId: "s1", partIndex: 1 });
    seedUnlock(store, {
      userId: "u1",
      librarySessionId: "s1",
      expiresAt: unlockActiveUntil,
    });
    const client = buildClient(store);
    const before = snapshot(store);
    await getActiveLibrarySessionDetail("u1", "s1", { now: midDay }, client);
    assertNoMutation("S3 detail", before, snapshot(store));
  }

  // (S4) Stripe / periodUsage / job never accessed by either path.
  {
    const store = makeStore();
    seedUser(store, {
      id: "u1",
      plan: "STARTER",
      planPeriodEnd: paidPeriodEnd,
    });
    seedSession(store, { id: "s1" });
    seedChapter(store, { id: "s1-c1", librarySessionId: "s1", partIndex: 1 });
    const client = buildClient(store);
    await listActiveLibrarySessions("u1", { now: midDay }, client);
    await getActiveLibrarySessionDetail("u1", "s1", { now: midDay }, client);
    // Any touch of periodUsage / job would have thrown from `forbid`.
    check("S4: periodUsage untouched", store.periodUsages.size, 0);
    check("S4: jobs untouched", store.jobs.size, 0);
  }

  // ================================================================
  // Route source assertions
  // ================================================================

  const listRoutePath = path.resolve(
    __dirname,
    "..",
    "app",
    "api",
    "library",
    "sessions",
    "route.ts"
  );
  const detailRoutePath = path.resolve(
    __dirname,
    "..",
    "app",
    "api",
    "library",
    "sessions",
    "[id]",
    "route.ts"
  );

  // (R1) List route file exists and has expected structure.
  {
    check(
      "R1: list route file exists",
      fs.existsSync(listRoutePath),
      true
    );
    const src = fs.readFileSync(listRoutePath, "utf8");
    check("R1: list uses requireAuth via next-auth", /getServerSession/.test(src), true);
    check("R1: list sets private no-store", /private, no-store/.test(src), true);
    check(
      "R1: list uses listActiveLibrarySessions",
      /listActiveLibrarySessions/.test(src),
      true
    );
    // Comments in the route source may mention audioKey when documenting
    // what is NOT emitted. Only a property-like `audioKey:` would be a
    // real leak vector.
    check(
      "R1: list has no audioKey property emission",
      /audioKey\s*:/.test(src),
      false
    );
    check(
      "R1: list marks route dynamic",
      /force-dynamic|dynamic\s*=\s*['"]force-dynamic['"]/.test(src),
      true
    );
    check(
      "R1: list responds 401 for anonymous",
      /Unauthorized"?,\s*401/.test(src),
      true
    );
  }

  // (R2) Detail route file exists and has expected structure.
  {
    check(
      "R2: detail route file exists",
      fs.existsSync(detailRoutePath),
      true
    );
    const src = fs.readFileSync(detailRoutePath, "utf8");
    check("R2: detail uses getServerSession", /getServerSession/.test(src), true);
    check("R2: detail sets private no-store", /private, no-store/.test(src), true);
    check(
      "R2: detail uses getActiveLibrarySessionDetail",
      /getActiveLibrarySessionDetail/.test(src),
      true
    );
    check(
      "R2: detail has no audioKey property emission",
      /audioKey\s*:/.test(src),
      false
    );
    check(
      "R2: detail responds 404 for missing/inactive",
      /SESSION_NOT_FOUND"?,\s*404/.test(src),
      true
    );
    check(
      "R2: detail responds 401 for anonymous",
      /Unauthorized"?,\s*401/.test(src),
      true
    );
  }

  // (R3) Helper module never selects audioKey in a prisma select block.
  {
    const helperPath = path.resolve(
      __dirname,
      "..",
      "lib",
      "entitlement",
      "library-catalog.ts"
    );
    const src = fs.readFileSync(helperPath, "utf8");
    check(
      "R3: helper does NOT include audioKey selection",
      /audioKey\s*:\s*true/.test(src),
      false
    );
    check(
      "R3: helper uses resolveEffectivePlan",
      /resolveEffectivePlan/.test(src),
      true
    );
    check("R3: helper is import-only from prisma", /new PrismaClient/.test(src), false);
    check(
      "R3: helper contains no prisma.create/update/delete",
      /\.\s*(create|update|updateMany|delete|deleteMany|upsert)\s*\(/.test(src),
      false
    );
  }

  // (R4) libraryChapterAudioUrl helper is stable.
  {
    check(
      "R4: audioUrl helper shape",
      libraryChapterAudioUrl("abc-123"),
      "/api/library/chapters/abc-123/audio"
    );
  }

  // ================================================================
  // Storage isolation (source-level)
  // ================================================================

  // (X1) Neither route imports from lib/s3 — no storage touch.
  {
    const listSrc = fs.readFileSync(listRoutePath, "utf8");
    const detailSrc = fs.readFileSync(detailRoutePath, "utf8");
    check("X1: list has no @/lib/s3 import", /from ['"]@\/lib\/s3/.test(listSrc), false);
    check(
      "X1: detail has no @/lib/s3 import",
      /from ['"]@\/lib\/s3/.test(detailSrc),
      false
    );
    check("X1: list has no getObjectByKey", /getObjectByKey/.test(listSrc), false);
    check("X1: detail has no getObjectByKey", /getObjectByKey/.test(detailSrc), false);
  }

  // ---------------------------------------------------------------------------
  // Type-preservation guard
  void ({} as ListActiveLibrarySessionsResult);
  void ({} as GetActiveLibrarySessionDetailResult);
}

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
