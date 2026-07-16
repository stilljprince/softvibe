// scripts/test-library-unlock.ts
//
// Offline tests for the RP-010 Phase 4B-1 Library Unlock write-side helper
// (lib/entitlement/library-unlock.ts). Exercises the pure UTC-day helper,
// the routing helper, and the transactional claimLibrarySessionUnlock
// function through an in-memory Prisma stub. Run with:
//
//   npx tsx scripts/test-library-unlock.ts
//
// The Prisma stub simulates a PostgreSQL `pg_advisory_xact_lock` via a
// per-user promise chain: every call to $queryRaw with the lock SQL
// enqueues itself behind any currently-held holder for the same userId,
// and releases automatically when the enclosing $transaction ends
// (success or rollback). That mirrors the transactional-scope semantics
// of the real advisory lock closely enough to reproduce the same race
// outcomes the production helper relies on.
//
// The stub also asserts strict system separation by keeping — but never
// letting the helper mutate — credits, probeGenerationsUsed and
// PeriodUsage / Job stores.

import {
  claimLibrarySessionUnlock,
  decidePublicClaimRouting,
  startOfUtcDay,
  DAILY_UNLOCK_LIMIT,
  UNLOCK_DURATION_MS,
} from "../lib/entitlement/library-unlock";
import type { Plan, PrismaClient } from "@prisma/client";

// --- Tiny assertion runner ------------------------------------------------

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

// ---------------------------------------------------------------------------
// Pure helper: startOfUtcDay
// ---------------------------------------------------------------------------

{
  // A random mid-day UTC timestamp.
  const t = new Date("2026-07-15T14:37:11.512Z");
  const d = startOfUtcDay(t);
  check("startOfUtcDay: floors to 00:00 UTC (year)", d.getUTCFullYear(), 2026);
  check("startOfUtcDay: floors to 00:00 UTC (month)", d.getUTCMonth(), 6); // July = 6
  check("startOfUtcDay: floors to 00:00 UTC (date)", d.getUTCDate(), 15);
  check("startOfUtcDay: floors to 00:00 UTC (hours)", d.getUTCHours(), 0);
  check("startOfUtcDay: floors to 00:00 UTC (minutes)", d.getUTCMinutes(), 0);
  check("startOfUtcDay: floors to 00:00 UTC (seconds)", d.getUTCSeconds(), 0);
  check("startOfUtcDay: floors to 00:00 UTC (ms)", d.getUTCMilliseconds(), 0);
}

{
  // 23:59:59.999 UTC → same day, floors to 00:00:00.000 UTC of that day.
  const t = new Date("2026-07-15T23:59:59.999Z");
  check(
    "startOfUtcDay: 23:59:59.999Z stays same UTC day",
    startOfUtcDay(t).toISOString(),
    "2026-07-15T00:00:00.000Z"
  );
}

{
  // 00:00:00.000 UTC (day boundary) → same day.
  const t = new Date("2026-07-16T00:00:00.000Z");
  check(
    "startOfUtcDay: 00:00:00.000Z next day",
    startOfUtcDay(t).toISOString(),
    "2026-07-16T00:00:00.000Z"
  );
}

check("DAILY_UNLOCK_LIMIT = 3", DAILY_UNLOCK_LIMIT, 3);
check(
  "UNLOCK_DURATION_MS = 8h",
  UNLOCK_DURATION_MS,
  8 * 60 * 60 * 1000
);

// ---------------------------------------------------------------------------
// In-memory Prisma stub
// ---------------------------------------------------------------------------

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

type StoreLibraryUnlock = {
  id: string;
  userId: string;
  librarySessionId: string;
  unlockedAt: Date;
  expiresAt: Date;
  source: "SPONSORED";
  providerEventId: string | null;
};

type StoreJob = {
  id: string;
  userId: string;
};
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
  unlocks: Map<string, StoreLibraryUnlock>;
  jobs: Map<string, StoreJob>;
  periodUsages: Map<string, StorePeriodUsage>;
  unlockSeq: number;
  // Per-user promise chain simulating pg_advisory_xact_lock.
  userLocks: Map<string, Promise<void>>;
};

type WriteOp = { kind: "unlock.create"; id: string };
type ReleaseFn = () => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTxOps(store: Store, writes: WriteOp[], releases: ReleaseFn[]) {
  return {
    user: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        const u = store.users.get(where.id);
        if (!u) return null;
        return {
          plan: u.plan,
          planPeriodEnd: u.planPeriodEnd,
          planPeriodStart: u.planPeriodStart,
          probeGenerationsUsed: u.probeGenerationsUsed,
          credits: u.credits,
        };
      },
    },
    librarySession: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        const s = store.sessions.get(where.id);
        if (!s) return null;
        return { id: s.id, isActive: s.isActive };
      },
    },
    libraryUnlock: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        if (where.providerEventId != null) {
          for (const u of store.unlocks.values()) {
            if (u.providerEventId === where.providerEventId) {
              return {
                id: u.id,
                userId: u.userId,
                librarySessionId: u.librarySessionId,
                unlockedAt: u.unlockedAt,
                expiresAt: u.expiresAt,
              };
            }
          }
          return null;
        }
        if (typeof where.id === "string") {
          const u = store.unlocks.get(where.id);
          return u ?? null;
        }
        return null;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findFirst: async ({ where, orderBy }: any) => {
        const rows: StoreLibraryUnlock[] = [];
        for (const u of store.unlocks.values()) {
          if (where.userId && u.userId !== where.userId) continue;
          if (
            where.librarySessionId &&
            u.librarySessionId !== where.librarySessionId
          ) {
            continue;
          }
          if (where.expiresAt && where.expiresAt.gt) {
            if (!(u.expiresAt.getTime() > (where.expiresAt.gt as Date).getTime())) {
              continue;
            }
          }
          rows.push(u);
        }
        if (orderBy && orderBy.unlockedAt === "desc") {
          rows.sort((a, b) => b.unlockedAt.getTime() - a.unlockedAt.getTime());
        }
        const row = rows[0];
        if (!row) return null;
        return {
          id: row.id,
          librarySessionId: row.librarySessionId,
          unlockedAt: row.unlockedAt,
          expiresAt: row.expiresAt,
        };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      count: async ({ where }: any) => {
        let n = 0;
        for (const u of store.unlocks.values()) {
          if (where.userId && u.userId !== where.userId) continue;
          if (where.unlockedAt) {
            const gte = where.unlockedAt.gte as Date | undefined;
            const lt = where.unlockedAt.lt as Date | undefined;
            if (gte && u.unlockedAt.getTime() < gte.getTime()) continue;
            if (lt && u.unlockedAt.getTime() >= lt.getTime()) continue;
          }
          n++;
        }
        return n;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async ({ data, select }: any) => {
        // Enforce the DB-side unique constraint on providerEventId.
        if (data.providerEventId != null) {
          for (const u of store.unlocks.values()) {
            if (u.providerEventId === data.providerEventId) {
              const err = new Error(
                "Unique constraint failed on the fields: (`providerEventId`)"
              );
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (err as any).code = "P2002";
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (err as any).meta = { target: ["providerEventId"] };
              throw err;
            }
          }
        }
        const id = `unlock-${++store.unlockSeq}`;
        const row: StoreLibraryUnlock = {
          id,
          userId: data.userId,
          librarySessionId: data.librarySessionId,
          unlockedAt: data.unlockedAt,
          expiresAt: data.expiresAt,
          source: "SPONSORED",
          providerEventId: data.providerEventId ?? null,
        };
        store.unlocks.set(id, row);
        writes.push({ kind: "unlock.create", id });
        if (select) {
          return {
            id: row.id,
            librarySessionId: row.librarySessionId,
            unlockedAt: row.unlockedAt,
            expiresAt: row.expiresAt,
          };
        }
        return row;
      },
    },
    // Surfaces the helper MUST NOT touch. If it ever does, tests fail
    // loudly on separation invariants rather than silently passing.
    periodUsage: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async () => null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateMany: async () => ({ count: 0 }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async () => {
        throw new Error("library-unlock path must not touch PeriodUsage");
      },
    },
    job: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async () => {
        throw new Error("library-unlock path must not touch Job");
      },
    },
    // Advisory lock simulation. The production helper calls
    // `SELECT pg_advisory_xact_lock($1::int, hashtext($2)::int)` inside
    // the transaction; $1 is the namespace constant, $2 is the userId
    // string. We ignore the namespace (all Library-Unlock calls share it)
    // and queue on the userId.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = Array.from(strings).join("?").toLowerCase();
      if (sql.includes("pg_advisory_xact_lock")) {
        // values[0] = namespace int, values[1] = userId string
        const userId = String(values[1]);
        const prev = store.userLocks.get(userId) ?? Promise.resolve();
        let release!: () => void;
        const next = new Promise<void>((r) => (release = r));
        store.userLocks.set(userId, next);
        // Wait for the previous holder (previous tx) to release. Only
        // AFTER that does this claim proceed inside its critical section.
        await prev;
        releases.push(() => {
          // Only clear the tail if we are still the current tail; a later
          // waiter may already have set itself as the new tail.
          if (store.userLocks.get(userId) === next) {
            store.userLocks.delete(userId);
          }
          release();
        });
        return [];
      }
      return [];
    },
  };
}

function rollback(store: Store, writes: WriteOp[]): void {
  for (let i = writes.length - 1; i >= 0; i--) {
    const w = writes[i];
    if (w.kind === "unlock.create") {
      store.unlocks.delete(w.id);
    }
  }
}

function buildStubClient(store: Store): PrismaClient {
  const client = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: async (fn: any) => {
      const writes: WriteOp[] = [];
      const releases: ReleaseFn[] = [];
      const ops = buildTxOps(store, writes, releases);
      try {
        const result = await fn(ops);
        // Release advisory locks on commit.
        for (const r of releases) r();
        return result;
      } catch (e) {
        rollback(store, writes);
        // Release advisory locks on rollback.
        for (const r of releases) r();
        throw e;
      }
    },
    // Top-level (non-transactional) callers — used by decidePublicClaimRouting.
    user: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        const u = store.users.get(where.id);
        if (!u) return null;
        return {
          plan: u.plan,
          planPeriodEnd: u.planPeriodEnd,
        };
      },
    },
    librarySession: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        const s = store.sessions.get(where.id);
        if (!s) return null;
        return { id: s.id, isActive: s.isActive };
      },
    },
  };
  return client as unknown as PrismaClient;
}

function seedStore(): Store {
  return {
    users: new Map(),
    sessions: new Map(),
    unlocks: new Map(),
    jobs: new Map(),
    periodUsages: new Map(),
    unlockSeq: 0,
    userLocks: new Map(),
  };
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

// ---------------------------------------------------------------------------
// Common time constants
// ---------------------------------------------------------------------------

const paidPeriodStart = new Date("2026-07-01T00:00:00.000Z");
const paidPeriodEnd = new Date("2026-08-01T00:00:00.000Z");
// A stable "mid-day" reference now used by most tests.
const midDay = new Date("2026-07-15T12:00:00.000Z");
// After the paid period ends → expired paid users effectively FREE.
const pastPaidPeriod = new Date("2026-09-01T12:00:00.000Z");

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

async function runTests(): Promise<void> {
  // ----- Paid direct access -------------------------------------------------

  // (1) STARTER → direct_plan_access, no LibraryUnlock row.
  {
    const store = seedStore();
    seedUser(store, {
      id: "u-starter",
      plan: "STARTER",
      planPeriodStart: paidPeriodStart,
      planPeriodEnd: paidPeriodEnd,
      credits: 5,
      probeGenerationsUsed: 1,
    });
    seedSession(store, { id: "sess-1" });
    const client = buildStubClient(store);
    const r = await claimLibrarySessionUnlock(
      {
        userId: "u-starter",
        librarySessionId: "sess-1",
        now: midDay,
      },
      client
    );
    check("STARTER: ok=true", r.ok, true);
    if (r.ok) check("STARTER: outcome=direct_plan_access", r.outcome, "direct_plan_access");
    if (r.ok && r.outcome === "direct_plan_access") {
      check("STARTER: plan reported STARTER", r.plan, "STARTER");
    }
    check("STARTER: no LibraryUnlock row", store.unlocks.size, 0);
    check(
      "STARTER: credits unchanged (still 5)",
      store.users.get("u-starter")?.credits,
      5
    );
    check(
      "STARTER: probeGenerationsUsed unchanged (still 1)",
      store.users.get("u-starter")?.probeGenerationsUsed,
      1
    );
  }

  // (2) PREMIUM → direct_plan_access, no LibraryUnlock row.
  {
    const store = seedStore();
    seedUser(store, {
      id: "u-premium",
      plan: "PREMIUM",
      planPeriodStart: paidPeriodStart,
      planPeriodEnd: paidPeriodEnd,
    });
    seedSession(store, { id: "sess-1" });
    const client = buildStubClient(store);
    const r = await claimLibrarySessionUnlock(
      { userId: "u-premium", librarySessionId: "sess-1", now: midDay },
      client
    );
    check("PREMIUM: ok=true", r.ok, true);
    if (r.ok) check("PREMIUM: outcome=direct_plan_access", r.outcome, "direct_plan_access");
    if (r.ok && r.outcome === "direct_plan_access") {
      check("PREMIUM: plan reported PREMIUM", r.plan, "PREMIUM");
    }
    check("PREMIUM: no LibraryUnlock row", store.unlocks.size, 0);
  }

  // (3) Expired paid plan → effective FREE → NOT direct access; enters Free
  // path and creates a normal unlock.
  {
    const store = seedStore();
    seedUser(store, {
      id: "u-expired",
      plan: "STARTER",
      planPeriodStart: paidPeriodStart,
      planPeriodEnd: paidPeriodEnd,
    });
    seedSession(store, { id: "sess-1" });
    const client = buildStubClient(store);
    const r = await claimLibrarySessionUnlock(
      {
        userId: "u-expired",
        librarySessionId: "sess-1",
        now: pastPaidPeriod,
      },
      client
    );
    check("Expired paid: ok=true", r.ok, true);
    if (r.ok) check("Expired paid: outcome=created (Free path)", r.outcome, "created");
    check("Expired paid: exactly one LibraryUnlock row", store.unlocks.size, 1);
  }

  // ----- Free happy path ----------------------------------------------------

  // (4) First new Free unlock → created with SPONSORED / +8h.
  {
    const store = seedStore();
    seedUser(store, { id: "u-free", plan: "FREE" });
    seedSession(store, { id: "sess-A" });
    const client = buildStubClient(store);
    const r = await claimLibrarySessionUnlock(
      { userId: "u-free", librarySessionId: "sess-A", now: midDay },
      client
    );
    check("Free 1st: ok=true", r.ok, true);
    if (r.ok && r.outcome === "created") {
      check("Free 1st: outcome=created", r.outcome, "created");
      check(
        "Free 1st: expiresAt = now + 8h",
        r.expiresAt.getTime(),
        midDay.getTime() + UNLOCK_DURATION_MS
      );
      check("Free 1st: unlockedAt = now", r.unlockedAt.getTime(), midDay.getTime());
    }
    check("Free 1st: one row created", store.unlocks.size, 1);
    const row = Array.from(store.unlocks.values())[0];
    check("Free 1st: source=SPONSORED", row.source, "SPONSORED");
    check("Free 1st: providerEventId=null", row.providerEventId, null);
  }

  // (5) Second + third distinct-session unlocks in the same UTC day succeed.
  {
    const store = seedStore();
    seedUser(store, { id: "u-free2", plan: "FREE" });
    seedSession(store, { id: "sess-A" });
    seedSession(store, { id: "sess-B" });
    seedSession(store, { id: "sess-C" });
    const client = buildStubClient(store);
    const r1 = await claimLibrarySessionUnlock(
      { userId: "u-free2", librarySessionId: "sess-A", now: midDay },
      client
    );
    const r2 = await claimLibrarySessionUnlock(
      { userId: "u-free2", librarySessionId: "sess-B", now: midDay },
      client
    );
    const r3 = await claimLibrarySessionUnlock(
      { userId: "u-free2", librarySessionId: "sess-C", now: midDay },
      client
    );
    check("Free 3 distinct: r1 created", r1.ok && r1.outcome, "created");
    check("Free 3 distinct: r2 created", r2.ok && r2.outcome, "created");
    check("Free 3 distinct: r3 created", r3.ok && r3.outcome, "created");
    check("Free 3 distinct: three rows total", store.unlocks.size, 3);
  }

  // (6) Fourth new Free unlock in the same UTC day → DAILY_UNLOCK_LIMIT_REACHED.
  {
    const store = seedStore();
    seedUser(store, { id: "u-limit", plan: "FREE" });
    for (const s of ["sess-A", "sess-B", "sess-C", "sess-D"]) {
      seedSession(store, { id: s });
    }
    const client = buildStubClient(store);
    await claimLibrarySessionUnlock(
      { userId: "u-limit", librarySessionId: "sess-A", now: midDay },
      client
    );
    await claimLibrarySessionUnlock(
      { userId: "u-limit", librarySessionId: "sess-B", now: midDay },
      client
    );
    await claimLibrarySessionUnlock(
      { userId: "u-limit", librarySessionId: "sess-C", now: midDay },
      client
    );
    const r4 = await claimLibrarySessionUnlock(
      { userId: "u-limit", librarySessionId: "sess-D", now: midDay },
      client
    );
    check("4th: ok=false", r4.ok, false);
    if (!r4.ok) {
      check("4th: error=DAILY_UNLOCK_LIMIT_REACHED", r4.error, "DAILY_UNLOCK_LIMIT_REACHED");
    }
    check("4th: still exactly three rows", store.unlocks.size, 3);
  }

  // ----- Reuse --------------------------------------------------------------

  // (7) Same session, still active → reused; same id, same expiresAt, no
  // new row, no new daily slot.
  {
    const store = seedStore();
    seedUser(store, { id: "u-reuse", plan: "FREE" });
    seedSession(store, { id: "sess-A" });
    const client = buildStubClient(store);
    const first = await claimLibrarySessionUnlock(
      { userId: "u-reuse", librarySessionId: "sess-A", now: midDay },
      client
    );
    check("Reuse: first=created", first.ok && first.outcome, "created");
    // 30 minutes later — still inside the 8h window.
    const later = new Date(midDay.getTime() + 30 * 60 * 1000);
    const second = await claimLibrarySessionUnlock(
      { userId: "u-reuse", librarySessionId: "sess-A", now: later },
      client
    );
    check("Reuse: second=reused", second.ok && second.outcome, "reused");
    if (
      first.ok &&
      first.outcome === "created" &&
      second.ok &&
      second.outcome === "reused"
    ) {
      check("Reuse: same unlockId", second.unlockId, first.unlockId);
      check(
        "Reuse: expiresAt unchanged (no extension)",
        second.expiresAt.getTime(),
        first.expiresAt.getTime()
      );
      check(
        "Reuse: unlockedAt unchanged",
        second.unlockedAt.getTime(),
        first.unlockedAt.getTime()
      );
    }
    check("Reuse: still exactly one row", store.unlocks.size, 1);
  }

  // (8) Same session AFTER expiry → new row allowed (daily slot free).
  {
    const store = seedStore();
    seedUser(store, { id: "u-reuse-exp", plan: "FREE" });
    seedSession(store, { id: "sess-A" });
    const client = buildStubClient(store);
    const first = await claimLibrarySessionUnlock(
      { userId: "u-reuse-exp", librarySessionId: "sess-A", now: midDay },
      client
    );
    // 9 hours later — past the 8h window.
    const later = new Date(midDay.getTime() + 9 * 60 * 60 * 1000);
    // Move `later` forward one UTC day to avoid tripping the daily limit
    // in a way that muddles the test intent — pick a fresh UTC day.
    const nextDayMidDay = new Date(midDay.getTime() + 25 * 60 * 60 * 1000);
    void later; // referenced only for readability of the setup
    const second = await claimLibrarySessionUnlock(
      { userId: "u-reuse-exp", librarySessionId: "sess-A", now: nextDayMidDay },
      client
    );
    check("Reuse expired: second=created", second.ok && second.outcome, "created");
    if (
      first.ok &&
      first.outcome === "created" &&
      second.ok &&
      second.outcome === "created"
    ) {
      check("Reuse expired: new unlockId", second.unlockId !== first.unlockId, true);
      check(
        "Reuse expired: new 8h window",
        second.expiresAt.getTime(),
        nextDayMidDay.getTime() + UNLOCK_DURATION_MS
      );
    }
    check("Reuse expired: two rows total", store.unlocks.size, 2);
  }

  // (9) At limit-3, active same-session unlock still reusable.
  {
    const store = seedStore();
    seedUser(store, { id: "u-reuse-limit", plan: "FREE" });
    seedSession(store, { id: "sess-A" });
    seedSession(store, { id: "sess-B" });
    seedSession(store, { id: "sess-C" });
    const client = buildStubClient(store);
    // Three distinct sessions unlocked today.
    await claimLibrarySessionUnlock(
      { userId: "u-reuse-limit", librarySessionId: "sess-A", now: midDay },
      client
    );
    await claimLibrarySessionUnlock(
      { userId: "u-reuse-limit", librarySessionId: "sess-B", now: midDay },
      client
    );
    await claimLibrarySessionUnlock(
      { userId: "u-reuse-limit", librarySessionId: "sess-C", now: midDay },
      client
    );
    // Reusing sess-A must still work — reuse is not a new slot.
    const reused = await claimLibrarySessionUnlock(
      {
        userId: "u-reuse-limit",
        librarySessionId: "sess-A",
        now: new Date(midDay.getTime() + 15 * 60 * 1000),
      },
      client
    );
    check("Reuse-at-limit: outcome=reused", reused.ok && reused.outcome, "reused");
    check("Reuse-at-limit: still exactly three rows", store.unlocks.size, 3);
    // And a new session at limit-3 is refused.
    seedSession(store, { id: "sess-D" });
    const refused = await claimLibrarySessionUnlock(
      { userId: "u-reuse-limit", librarySessionId: "sess-D", now: midDay },
      client
    );
    check("Reuse-at-limit: new session at limit refused", refused.ok, false);
    if (!refused.ok) {
      check(
        "Reuse-at-limit: error=DAILY_UNLOCK_LIMIT_REACHED",
        refused.error,
        "DAILY_UNLOCK_LIMIT_REACHED"
      );
    }
  }

  // ----- Session validation -------------------------------------------------

  // (10) Unknown session → SESSION_NOT_FOUND, no row.
  {
    const store = seedStore();
    seedUser(store, { id: "u-nosess", plan: "FREE" });
    const client = buildStubClient(store);
    const r = await claimLibrarySessionUnlock(
      { userId: "u-nosess", librarySessionId: "does-not-exist", now: midDay },
      client
    );
    check("Unknown session: ok=false", r.ok, false);
    if (!r.ok) check("Unknown session: error=SESSION_NOT_FOUND", r.error, "SESSION_NOT_FOUND");
    check("Unknown session: no row created", store.unlocks.size, 0);
  }

  // (11) Inactive session → SESSION_INACTIVE, no row.
  {
    const store = seedStore();
    seedUser(store, { id: "u-inact", plan: "FREE" });
    seedSession(store, { id: "sess-off", isActive: false });
    const client = buildStubClient(store);
    const r = await claimLibrarySessionUnlock(
      { userId: "u-inact", librarySessionId: "sess-off", now: midDay },
      client
    );
    check("Inactive session: ok=false", r.ok, false);
    if (!r.ok) check("Inactive session: error=SESSION_INACTIVE", r.error, "SESSION_INACTIVE");
    check("Inactive session: no row", store.unlocks.size, 0);
  }

  // (12) Unknown user → USER_NOT_FOUND.
  {
    const store = seedStore();
    seedSession(store, { id: "sess-A" });
    const client = buildStubClient(store);
    const r = await claimLibrarySessionUnlock(
      { userId: "ghost-user", librarySessionId: "sess-A", now: midDay },
      client
    );
    check("Unknown user: ok=false", r.ok, false);
    if (!r.ok) check("Unknown user: error=USER_NOT_FOUND", r.error, "USER_NOT_FOUND");
    check("Unknown user: no row", store.unlocks.size, 0);
  }

  // ----- Atomic daily limit under concurrency -------------------------------

  // (13) Four parallel NEW-session claims at count 0 → at most three succeed.
  {
    const store = seedStore();
    seedUser(store, { id: "u-race", plan: "FREE" });
    for (const s of ["sess-A", "sess-B", "sess-C", "sess-D"]) {
      seedSession(store, { id: s });
    }
    const client = buildStubClient(store);
    const results = await Promise.all([
      claimLibrarySessionUnlock(
        { userId: "u-race", librarySessionId: "sess-A", now: midDay },
        client
      ),
      claimLibrarySessionUnlock(
        { userId: "u-race", librarySessionId: "sess-B", now: midDay },
        client
      ),
      claimLibrarySessionUnlock(
        { userId: "u-race", librarySessionId: "sess-C", now: midDay },
        client
      ),
      claimLibrarySessionUnlock(
        { userId: "u-race", librarySessionId: "sess-D", now: midDay },
        client
      ),
    ]);
    const okCount = results.filter((r) => r.ok && r.outcome === "created").length;
    const rejectedCount = results.filter(
      (r) => !r.ok && r.error === "DAILY_UNLOCK_LIMIT_REACHED"
    ).length;
    check("Race 4×0: exactly three created", okCount, 3);
    check("Race 4×0: exactly one refused as DAILY_UNLOCK_LIMIT_REACHED", rejectedCount, 1);
    check("Race 4×0: exactly three rows in store", store.unlocks.size, 3);
  }

  // (14) Two parallel claims of the SAME session → exactly one new row.
  {
    const store = seedStore();
    seedUser(store, { id: "u-race-same", plan: "FREE" });
    seedSession(store, { id: "sess-A" });
    const client = buildStubClient(store);
    const results = await Promise.all([
      claimLibrarySessionUnlock(
        { userId: "u-race-same", librarySessionId: "sess-A", now: midDay },
        client
      ),
      claimLibrarySessionUnlock(
        { userId: "u-race-same", librarySessionId: "sess-A", now: midDay },
        client
      ),
    ]);
    const createdCount = results.filter((r) => r.ok && r.outcome === "created").length;
    const reusedCount = results.filter((r) => r.ok && r.outcome === "reused").length;
    check("Race same 2: exactly one created", createdCount, 1);
    check("Race same 2: exactly one reused", reusedCount, 1);
    check("Race same 2: exactly one row in store", store.unlocks.size, 1);
    // Both callers must refer to the same unlockId.
    const ids = results
      .filter((r) => r.ok && (r.outcome === "created" || r.outcome === "reused"))
      .map((r) => (r as { unlockId: string }).unlockId);
    check("Race same 2: same unlockId for both", ids[0], ids[1]);
  }

  // (15) Parallel reuse of an already-active session (five concurrent) → no
  // new rows, all reused.
  {
    const store = seedStore();
    seedUser(store, { id: "u-race-reuse", plan: "FREE" });
    seedSession(store, { id: "sess-A" });
    const client = buildStubClient(store);
    // Prime one row.
    const primer = await claimLibrarySessionUnlock(
      { userId: "u-race-reuse", librarySessionId: "sess-A", now: midDay },
      client
    );
    check("Race reuse: primer=created", primer.ok && primer.outcome, "created");
    // Now five racing reuse attempts.
    const later = new Date(midDay.getTime() + 60 * 1000);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        claimLibrarySessionUnlock(
          { userId: "u-race-reuse", librarySessionId: "sess-A", now: later },
          client
        )
      )
    );
    const createdCount = results.filter((r) => r.ok && r.outcome === "created").length;
    const reusedCount = results.filter((r) => r.ok && r.outcome === "reused").length;
    check("Race reuse: none created", createdCount, 0);
    check("Race reuse: all five reused", reusedCount, 5);
    check("Race reuse: still exactly one row", store.unlocks.size, 1);
  }

  // ----- UTC-day boundary ---------------------------------------------------

  // (16) Three unlocks just before UTC midnight; a fourth unlock a moment
  // AFTER midnight (new UTC day) is allowed.
  {
    const store = seedStore();
    seedUser(store, { id: "u-utc", plan: "FREE" });
    for (const s of ["sess-A", "sess-B", "sess-C", "sess-D"]) {
      seedSession(store, { id: s });
    }
    const client = buildStubClient(store);
    // 23:59 UTC.
    const beforeMidnight = new Date("2026-07-15T23:59:00.000Z");
    await claimLibrarySessionUnlock(
      { userId: "u-utc", librarySessionId: "sess-A", now: beforeMidnight },
      client
    );
    await claimLibrarySessionUnlock(
      { userId: "u-utc", librarySessionId: "sess-B", now: beforeMidnight },
      client
    );
    await claimLibrarySessionUnlock(
      { userId: "u-utc", librarySessionId: "sess-C", now: beforeMidnight },
      client
    );
    // 4th attempt same day → refused.
    const stillSameDay = await claimLibrarySessionUnlock(
      { userId: "u-utc", librarySessionId: "sess-D", now: beforeMidnight },
      client
    );
    check(
      "UTC boundary: 4th same-day refused",
      stillSameDay.ok === false && stillSameDay.error === "DAILY_UNLOCK_LIMIT_REACHED",
      true
    );
    // 00:00:30 UTC next day → allowed (fresh UTC day).
    const afterMidnight = new Date("2026-07-16T00:00:30.000Z");
    const nextDay = await claimLibrarySessionUnlock(
      { userId: "u-utc", librarySessionId: "sess-D", now: afterMidnight },
      client
    );
    check("UTC boundary: 1st next-day succeeds", nextDay.ok && nextDay.outcome, "created");
    check("UTC boundary: four rows total", store.unlocks.size, 4);
  }

  // (17) Active 8h unlock spanning UTC midnight is still reusable and does
  // not consume the new day's slot count.
  {
    const store = seedStore();
    seedUser(store, { id: "u-span", plan: "FREE" });
    seedSession(store, { id: "sess-A" });
    seedSession(store, { id: "sess-B" });
    seedSession(store, { id: "sess-C" });
    seedSession(store, { id: "sess-D" });
    const client = buildStubClient(store);
    // 21:00 UTC — 8h window ends at 05:00 UTC next day.
    const evening = new Date("2026-07-15T21:00:00.000Z");
    await claimLibrarySessionUnlock(
      { userId: "u-span", librarySessionId: "sess-A", now: evening },
      client
    );
    // 02:00 UTC next day — still inside sess-A window, reuse.
    const nextDayEarly = new Date("2026-07-16T02:00:00.000Z");
    const reused = await claimLibrarySessionUnlock(
      { userId: "u-span", librarySessionId: "sess-A", now: nextDayEarly },
      client
    );
    check(
      "UTC span: reuse across midnight",
      reused.ok && reused.outcome,
      "reused"
    );
    // Also confirm that the new day still allows three NEW unlocks — the
    // spanning row is on the previous UTC day and doesn't count against
    // the new day.
    const nd1 = await claimLibrarySessionUnlock(
      { userId: "u-span", librarySessionId: "sess-B", now: nextDayEarly },
      client
    );
    const nd2 = await claimLibrarySessionUnlock(
      { userId: "u-span", librarySessionId: "sess-C", now: nextDayEarly },
      client
    );
    const nd3 = await claimLibrarySessionUnlock(
      { userId: "u-span", librarySessionId: "sess-D", now: nextDayEarly },
      client
    );
    check("UTC span: nd1 created", nd1.ok && nd1.outcome, "created");
    check("UTC span: nd2 created", nd2.ok && nd2.outcome, "created");
    check("UTC span: nd3 created", nd3.ok && nd3.outcome, "created");
  }

  // ----- Provider Event ID --------------------------------------------------

  // (18) Unique providerEventId → persisted.
  {
    const store = seedStore();
    seedUser(store, { id: "u-prov", plan: "FREE" });
    seedSession(store, { id: "sess-A" });
    const client = buildStubClient(store);
    const r = await claimLibrarySessionUnlock(
      {
        userId: "u-prov",
        librarySessionId: "sess-A",
        providerEventId: "evt-1",
        now: midDay,
      },
      client
    );
    check("providerEventId: ok=true", r.ok, true);
    if (r.ok && r.outcome === "created") {
      check("providerEventId: outcome=created", r.outcome, "created");
    }
    const row = Array.from(store.unlocks.values())[0];
    check("providerEventId: stored", row.providerEventId, "evt-1");
  }

  // (19) Same providerEventId re-submitted → idempotent reuse, no second
  // row created.
  {
    const store = seedStore();
    seedUser(store, { id: "u-prov-idem", plan: "FREE" });
    seedSession(store, { id: "sess-A" });
    const client = buildStubClient(store);
    const first = await claimLibrarySessionUnlock(
      {
        userId: "u-prov-idem",
        librarySessionId: "sess-A",
        providerEventId: "evt-42",
        now: midDay,
      },
      client
    );
    const second = await claimLibrarySessionUnlock(
      {
        userId: "u-prov-idem",
        librarySessionId: "sess-A",
        providerEventId: "evt-42",
        now: new Date(midDay.getTime() + 60 * 1000),
      },
      client
    );
    check("providerEvent idempotency: first=created", first.ok && first.outcome, "created");
    check("providerEvent idempotency: second=reused", second.ok && second.outcome, "reused");
    if (
      first.ok &&
      first.outcome === "created" &&
      second.ok &&
      second.outcome === "reused"
    ) {
      check("providerEvent idempotency: same unlockId", second.unlockId, first.unlockId);
    }
    check("providerEvent idempotency: still one row", store.unlocks.size, 1);
  }

  // (20) providerEventId reused for a DIFFERENT session → CONCURRENCY_CONFLICT
  // (a controlled refusal — never silently re-target).
  {
    const store = seedStore();
    seedUser(store, { id: "u-prov-x", plan: "FREE" });
    seedSession(store, { id: "sess-A" });
    seedSession(store, { id: "sess-B" });
    const client = buildStubClient(store);
    await claimLibrarySessionUnlock(
      {
        userId: "u-prov-x",
        librarySessionId: "sess-A",
        providerEventId: "evt-99",
        now: midDay,
      },
      client
    );
    const second = await claimLibrarySessionUnlock(
      {
        userId: "u-prov-x",
        librarySessionId: "sess-B",
        providerEventId: "evt-99",
        now: midDay,
      },
      client
    );
    check("providerEvent cross-session: ok=false", second.ok, false);
    if (!second.ok) {
      check(
        "providerEvent cross-session: error=CONCURRENCY_CONFLICT",
        second.error,
        "CONCURRENCY_CONFLICT"
      );
    }
    check("providerEvent cross-session: still one row", store.unlocks.size, 1);
  }

  // (21) No providerEventId supplied — create still works (path used by the
  // future trusted internal sponsored integration when the provider does
  // not carry a stable event id).
  {
    const store = seedStore();
    seedUser(store, { id: "u-no-prov", plan: "FREE" });
    seedSession(store, { id: "sess-A" });
    const client = buildStubClient(store);
    const r = await claimLibrarySessionUnlock(
      { userId: "u-no-prov", librarySessionId: "sess-A", now: midDay },
      client
    );
    check("no providerEventId: created", r.ok && r.outcome, "created");
    const row = Array.from(store.unlocks.values())[0];
    check("no providerEventId: stored as null", row.providerEventId, null);
  }

  // ----- System separation --------------------------------------------------

  // (22) Free unlock never touches credits or probeGenerationsUsed or
  // PeriodUsage / Job.
  {
    const store = seedStore();
    seedUser(store, {
      id: "u-sep",
      plan: "FREE",
      credits: 9,
      probeGenerationsUsed: 1,
    });
    seedSession(store, { id: "sess-A" });
    const client = buildStubClient(store);
    const r = await claimLibrarySessionUnlock(
      { userId: "u-sep", librarySessionId: "sess-A", now: midDay },
      client
    );
    check("Separation: ok=true", r.ok, true);
    check(
      "Separation: credits unchanged (9)",
      store.users.get("u-sep")?.credits,
      9
    );
    check(
      "Separation: probeGenerationsUsed unchanged (1)",
      store.users.get("u-sep")?.probeGenerationsUsed,
      1
    );
    check("Separation: PeriodUsage store empty", store.periodUsages.size, 0);
    check("Separation: Job store empty", store.jobs.size, 0);
  }

  // (23) Paid direct access likewise touches nothing outside its own read.
  {
    const store = seedStore();
    seedUser(store, {
      id: "u-sep-paid",
      plan: "PREMIUM",
      planPeriodStart: paidPeriodStart,
      planPeriodEnd: paidPeriodEnd,
      credits: 3,
      probeGenerationsUsed: 2,
    });
    seedSession(store, { id: "sess-A" });
    const client = buildStubClient(store);
    await claimLibrarySessionUnlock(
      { userId: "u-sep-paid", librarySessionId: "sess-A", now: midDay },
      client
    );
    check(
      "Separation paid: credits unchanged (3)",
      store.users.get("u-sep-paid")?.credits,
      3
    );
    check(
      "Separation paid: probeGenerationsUsed unchanged (2)",
      store.users.get("u-sep-paid")?.probeGenerationsUsed,
      2
    );
    check("Separation paid: no unlock row created", store.unlocks.size, 0);
    check("Separation paid: PeriodUsage store empty", store.periodUsages.size, 0);
  }

  // (24) DAILY_UNLOCK_LIMIT_REACHED does not touch counters.
  {
    const store = seedStore();
    seedUser(store, {
      id: "u-sep-lim",
      plan: "FREE",
      credits: 7,
      probeGenerationsUsed: 2,
    });
    for (const s of ["sess-A", "sess-B", "sess-C", "sess-D"]) {
      seedSession(store, { id: s });
    }
    const client = buildStubClient(store);
    await claimLibrarySessionUnlock(
      { userId: "u-sep-lim", librarySessionId: "sess-A", now: midDay },
      client
    );
    await claimLibrarySessionUnlock(
      { userId: "u-sep-lim", librarySessionId: "sess-B", now: midDay },
      client
    );
    await claimLibrarySessionUnlock(
      { userId: "u-sep-lim", librarySessionId: "sess-C", now: midDay },
      client
    );
    await claimLibrarySessionUnlock(
      { userId: "u-sep-lim", librarySessionId: "sess-D", now: midDay },
      client
    );
    check(
      "Separation limit: credits unchanged (7)",
      store.users.get("u-sep-lim")?.credits,
      7
    );
    check(
      "Separation limit: probeGenerationsUsed unchanged (2)",
      store.users.get("u-sep-lim")?.probeGenerationsUsed,
      2
    );
  }

  // ----- Cross-user isolation ----------------------------------------------

  // (25) Two Free users each have their own daily counter; user A hitting
  // the limit doesn't affect user B.
  {
    const store = seedStore();
    seedUser(store, { id: "u-a", plan: "FREE" });
    seedUser(store, { id: "u-b", plan: "FREE" });
    for (const s of ["sess-1", "sess-2", "sess-3", "sess-4"]) {
      seedSession(store, { id: s });
    }
    const client = buildStubClient(store);
    // u-a burns all 3 slots.
    await claimLibrarySessionUnlock(
      { userId: "u-a", librarySessionId: "sess-1", now: midDay },
      client
    );
    await claimLibrarySessionUnlock(
      { userId: "u-a", librarySessionId: "sess-2", now: midDay },
      client
    );
    await claimLibrarySessionUnlock(
      { userId: "u-a", librarySessionId: "sess-3", now: midDay },
      client
    );
    // u-b still gets a fresh slot.
    const bFirst = await claimLibrarySessionUnlock(
      { userId: "u-b", librarySessionId: "sess-1", now: midDay },
      client
    );
    check(
      "Cross-user: u-b first unlock still allowed",
      bFirst.ok && bFirst.outcome,
      "created"
    );
    // u-a's next is refused.
    const aRefused = await claimLibrarySessionUnlock(
      { userId: "u-a", librarySessionId: "sess-4", now: midDay },
      client
    );
    check(
      "Cross-user: u-a refused as limit reached",
      aRefused.ok === false && aRefused.error === "DAILY_UNLOCK_LIMIT_REACHED",
      true
    );
    check("Cross-user: 4 rows total (3 for u-a, 1 for u-b)", store.unlocks.size, 4);
  }

  // ----- Route-decision helper ---------------------------------------------
  //
  // decidePublicClaimRouting is the single source of truth for the /api/library/unlock
  // dispatcher. Test it directly: no next.js required.
  //

  // (26) FREE + valid session → requires_sponsored_verification.
  {
    const store = seedStore();
    seedUser(store, { id: "u-route-free", plan: "FREE" });
    seedSession(store, { id: "sess-A" });
    const client = buildStubClient(store);
    const d = await decidePublicClaimRouting(
      { userId: "u-route-free", librarySessionId: "sess-A", now: midDay },
      client
    );
    check("Route FREE: ok=true", d.ok, true);
    if (d.ok) {
      check(
        "Route FREE: outcome=requires_sponsored_verification",
        d.outcome,
        "requires_sponsored_verification"
      );
    }
    check("Route FREE: no LibraryUnlock created", store.unlocks.size, 0);
  }

  // (27) STARTER + valid session → direct_plan_access.
  {
    const store = seedStore();
    seedUser(store, {
      id: "u-route-starter",
      plan: "STARTER",
      planPeriodStart: paidPeriodStart,
      planPeriodEnd: paidPeriodEnd,
    });
    seedSession(store, { id: "sess-A" });
    const client = buildStubClient(store);
    const d = await decidePublicClaimRouting(
      { userId: "u-route-starter", librarySessionId: "sess-A", now: midDay },
      client
    );
    check("Route STARTER: ok=true", d.ok, true);
    if (d.ok && d.outcome === "direct_plan_access") {
      check("Route STARTER: outcome=direct_plan_access", d.outcome, "direct_plan_access");
      check("Route STARTER: plan=STARTER", d.plan, "STARTER");
    }
    check("Route STARTER: no LibraryUnlock created", store.unlocks.size, 0);
  }

  // (28) PREMIUM + valid session → direct_plan_access.
  {
    const store = seedStore();
    seedUser(store, {
      id: "u-route-premium",
      plan: "PREMIUM",
      planPeriodStart: paidPeriodStart,
      planPeriodEnd: paidPeriodEnd,
    });
    seedSession(store, { id: "sess-A" });
    const client = buildStubClient(store);
    const d = await decidePublicClaimRouting(
      { userId: "u-route-premium", librarySessionId: "sess-A", now: midDay },
      client
    );
    check("Route PREMIUM: ok=true", d.ok, true);
    if (d.ok && d.outcome === "direct_plan_access") {
      check("Route PREMIUM: plan=PREMIUM", d.plan, "PREMIUM");
    }
  }

  // (29) Route: unknown user → USER_NOT_FOUND.
  {
    const store = seedStore();
    seedSession(store, { id: "sess-A" });
    const client = buildStubClient(store);
    const d = await decidePublicClaimRouting(
      { userId: "ghost", librarySessionId: "sess-A", now: midDay },
      client
    );
    check("Route unknown user: ok=false", d.ok, false);
    if (!d.ok) check("Route unknown user: USER_NOT_FOUND", d.error, "USER_NOT_FOUND");
  }

  // (30) Route: unknown session → SESSION_NOT_FOUND.
  {
    const store = seedStore();
    seedUser(store, { id: "u-r", plan: "FREE" });
    const client = buildStubClient(store);
    const d = await decidePublicClaimRouting(
      { userId: "u-r", librarySessionId: "missing", now: midDay },
      client
    );
    check("Route unknown session: ok=false", d.ok, false);
    if (!d.ok) check("Route unknown session: SESSION_NOT_FOUND", d.error, "SESSION_NOT_FOUND");
  }

  // (31) Route: inactive session → SESSION_INACTIVE.
  {
    const store = seedStore();
    seedUser(store, { id: "u-r2", plan: "FREE" });
    seedSession(store, { id: "sess-off", isActive: false });
    const client = buildStubClient(store);
    const d = await decidePublicClaimRouting(
      { userId: "u-r2", librarySessionId: "sess-off", now: midDay },
      client
    );
    check("Route inactive session: ok=false", d.ok, false);
    if (!d.ok) check("Route inactive session: SESSION_INACTIVE", d.error, "SESSION_INACTIVE");
  }

  // (32) Route: expired paid → decision falls to Free path (requires
  // sponsored verification), matching resolveEffectivePlan semantics.
  {
    const store = seedStore();
    seedUser(store, {
      id: "u-exp",
      plan: "STARTER",
      planPeriodStart: paidPeriodStart,
      planPeriodEnd: paidPeriodEnd,
    });
    seedSession(store, { id: "sess-A" });
    const client = buildStubClient(store);
    const d = await decidePublicClaimRouting(
      { userId: "u-exp", librarySessionId: "sess-A", now: pastPaidPeriod },
      client
    );
    check("Route expired paid: ok=true", d.ok, true);
    if (d.ok) {
      check(
        "Route expired paid: outcome=requires_sponsored_verification",
        d.outcome,
        "requires_sponsored_verification"
      );
    }
    check("Route expired paid: no unlock created", store.unlocks.size, 0);
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
