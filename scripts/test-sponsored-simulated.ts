// scripts/test-sponsored-simulated.ts
//
// RP-004E1 — Offline tests for lib/entitlement/sponsored-simulated.ts.
//
// Exercises startSimulatedSponsoredEvent, completeSimulatedSponsoredEvent,
// cancelSimulatedSponsoredEvent, and their interaction with the central
// claimLibrarySessionUnlock (real code path, not stubbed — we replace
// only the prisma client via the injected argument).
//
// Run with:  npx tsx scripts/test-sponsored-simulated.ts

import {
  startSimulatedSponsoredEvent,
  completeSimulatedSponsoredEvent,
  cancelSimulatedSponsoredEvent,
  isSimulatedSponsoredUnlockEnabled,
  SIMULATED_VISIBLE_MINIMUM_SECONDS,
  SIMULATED_EVENT_LIFETIME_SECONDS,
} from "../lib/entitlement/sponsored-simulated";
import type { Plan, PrismaClient } from "@prisma/client";

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

function assertTruthy(name: string, actual: unknown): void {
  if (actual) {
    console.log(`[PASS] ${name}`);
    passed++;
  } else {
    console.log(`[FAIL] ${name}\n       expected=truthy\n       actual=  ${String(actual)}`);
    failed++;
  }
}

// ─── isSimulatedSponsoredUnlockEnabled ───────────────────────────────

check("flag: undefined disabled", isSimulatedSponsoredUnlockEnabled({}), false);
check("flag: '0' disabled", isSimulatedSponsoredUnlockEnabled({ SIMULATED_SPONSORED_UNLOCK_ENABLED: "0" }), false);
check("flag: '' disabled", isSimulatedSponsoredUnlockEnabled({ SIMULATED_SPONSORED_UNLOCK_ENABLED: "" }), false);
check("flag: 'false' disabled", isSimulatedSponsoredUnlockEnabled({ SIMULATED_SPONSORED_UNLOCK_ENABLED: "false" }), false);
check("flag: '1' enabled", isSimulatedSponsoredUnlockEnabled({ SIMULATED_SPONSORED_UNLOCK_ENABLED: "1" }), true);
check("flag: 'true' enabled", isSimulatedSponsoredUnlockEnabled({ SIMULATED_SPONSORED_UNLOCK_ENABLED: "true" }), true);
check("flag: 'YES' enabled (case-insensitive)", isSimulatedSponsoredUnlockEnabled({ SIMULATED_SPONSORED_UNLOCK_ENABLED: "YES" }), true);
check("flag: 'on' enabled", isSimulatedSponsoredUnlockEnabled({ SIMULATED_SPONSORED_UNLOCK_ENABLED: "on" }), true);

// ─── Constants ──────────────────────────────────────────────────────

check("visible minimum seconds", SIMULATED_VISIBLE_MINIMUM_SECONDS, 8);
check("event lifetime seconds", SIMULATED_EVENT_LIFETIME_SECONDS, 300);

// ─── In-memory Prisma stub ──────────────────────────────────────────
//
// Same shape as scripts/test-library-unlock.ts, extended with a
// sponsoredUnlockEvent table. The stub exercises the REAL library-unlock
// path — we do not re-mock claimLibrarySessionUnlock — so the tests
// verify end-to-end that a simulated completion becomes a persisted
// LibraryUnlock via the shared providerEventId path.

type StoreUser = {
  id: string;
  plan: Plan;
  planPeriodStart: Date | null;
  planPeriodEnd: Date | null;
  probeGenerationsUsed: number;
  credits: number;
  timezone: string | null;
};

type StoreSession = { id: string; isActive: boolean };

type StoreUnlock = {
  id: string;
  userId: string;
  librarySessionId: string;
  unlockedAt: Date;
  expiresAt: Date;
  source: "SPONSORED";
  providerEventId: string | null;
};

type StoreEvent = {
  id: string;
  userId: string;
  librarySessionId: string;
  provider: "SIMULATED_SOFTVIBE";
  status: "PENDING" | "COMPLETED" | "CONSUMED" | "EXPIRED" | "CANCELLED";
  providerEventId: string;
  createdAt: Date;
  eligibleAt: Date;
  expiresAt: Date;
  completedAt: Date | null;
  consumedAt: Date | null;
  cancelledAt: Date | null;
};

type Store = {
  users: Map<string, StoreUser>;
  sessions: Map<string, StoreSession>;
  unlocks: Map<string, StoreUnlock>;
  events: Map<string, StoreEvent>;
  seq: number;
  userLocks: Map<string, Promise<void>>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeOps(store: Store, txWrites: Array<() => void>, releases: Array<() => void>) {
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
          timezone: u.timezone,
          probeGenerationsUsed: u.probeGenerationsUsed,
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
        return null;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findFirst: async ({ where, orderBy }: any) => {
        const rows: StoreUnlock[] = [];
        for (const u of store.unlocks.values()) {
          if (where.userId && u.userId !== where.userId) continue;
          if (where.librarySessionId && u.librarySessionId !== where.librarySessionId) continue;
          if (where.expiresAt?.gt && !(u.expiresAt.getTime() > (where.expiresAt.gt as Date).getTime())) continue;
          rows.push(u);
        }
        if (orderBy?.expiresAt === "desc") rows.sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime());
        if (orderBy?.unlockedAt === "desc") rows.sort((a, b) => b.unlockedAt.getTime() - a.unlockedAt.getTime());
        const r = rows[0];
        if (!r) return null;
        return {
          id: r.id,
          librarySessionId: r.librarySessionId,
          unlockedAt: r.unlockedAt,
          expiresAt: r.expiresAt,
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
      create: async ({ data }: any) => {
        if (data.providerEventId != null) {
          for (const u of store.unlocks.values()) {
            if (u.providerEventId === data.providerEventId) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const err: any = new Error("P2002");
              err.code = "P2002";
              err.meta = { target: ["providerEventId"] };
              throw err;
            }
          }
        }
        const id = `unlock-${++store.seq}`;
        const row: StoreUnlock = {
          id,
          userId: data.userId,
          librarySessionId: data.librarySessionId,
          unlockedAt: data.unlockedAt,
          expiresAt: data.expiresAt,
          source: "SPONSORED",
          providerEventId: data.providerEventId ?? null,
        };
        store.unlocks.set(id, row);
        return {
          id: row.id,
          librarySessionId: row.librarySessionId,
          unlockedAt: row.unlockedAt,
          expiresAt: row.expiresAt,
        };
      },
    },
    sponsoredUnlockEvent: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        const e = store.events.get(where.id);
        if (!e) return null;
        return { ...e };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findFirst: async ({ where, orderBy }: any) => {
        const rows: StoreEvent[] = [];
        for (const e of store.events.values()) {
          if (where.userId && e.userId !== where.userId) continue;
          if (where.librarySessionId && e.librarySessionId !== where.librarySessionId) continue;
          if (where.status && e.status !== where.status) continue;
          rows.push(e);
        }
        if (orderBy?.createdAt === "desc") rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const r = rows[0];
        if (!r) return null;
        return { ...r };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async ({ data }: any) => {
        for (const e of store.events.values()) {
          if (e.providerEventId === data.providerEventId) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const err: any = new Error("P2002");
            err.code = "P2002";
            err.meta = { target: ["providerEventId"] };
            throw err;
          }
        }
        const id = `event-${++store.seq}`;
        const row: StoreEvent = {
          id,
          userId: data.userId,
          librarySessionId: data.librarySessionId,
          provider: data.provider,
          status: data.status,
          providerEventId: data.providerEventId,
          createdAt: data.createdAt,
          eligibleAt: data.eligibleAt,
          expiresAt: data.expiresAt,
          completedAt: null,
          consumedAt: null,
          cancelledAt: null,
        };
        store.events.set(id, row);
        return { ...row };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateMany: async ({ where, data }: any) => {
        let n = 0;
        for (const e of store.events.values()) {
          if (where.id && e.id !== where.id) continue;
          if (where.status) {
            if (typeof where.status === "string") {
              if (e.status !== where.status) continue;
            } else if (where.status.in) {
              if (!(where.status.in as string[]).includes(e.status)) continue;
            }
          }
          if (data.status !== undefined) e.status = data.status;
          if (data.completedAt !== undefined) e.completedAt = data.completedAt;
          if (data.consumedAt !== undefined) e.consumedAt = data.consumedAt;
          if (data.cancelledAt !== undefined) e.cancelledAt = data.cancelledAt;
          n++;
        }
        return { count: n };
      },
    },
    // Advisory lock — mirrors the pattern used by test-library-unlock.
    // Production calls the lock via $executeRaw (see library-unlock.ts;
    // pg_advisory_xact_lock returns void which $queryRaw cannot
    // deserialize). The stubs intercept $executeRaw accordingly.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = Array.from(strings).join("?").toLowerCase();
      if (sql.includes("pg_advisory_xact_lock")) {
        const userId = String(values[1]);
        const prev = store.userLocks.get(userId) ?? Promise.resolve();
        let release!: () => void;
        const next = new Promise<void>((r) => (release = r));
        store.userLocks.set(userId, next);
        await prev;
        releases.push(release);
        return 1;
      }
      return 0;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $queryRaw: async () => {
      return [];
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const localReleases: Array<() => void> = [];
      const ops = makeOps(store, txWrites, localReleases);
      try {
        const out = await fn(ops);
        for (const r of localReleases) r();
        return out;
      } catch (e) {
        for (const r of localReleases) r();
        throw e;
      }
    },
  } as unknown as PrismaClient;
}

function freshStore(): Store {
  return {
    users: new Map(),
    sessions: new Map(),
    unlocks: new Map(),
    events: new Map(),
    seq: 0,
    userLocks: new Map(),
  };
}

function seedUser(store: Store, id: string, plan: Plan = "FREE", timezone: string | null = null): void {
  store.users.set(id, {
    id,
    plan,
    planPeriodStart: null,
    planPeriodEnd: plan === "FREE" ? null : new Date("2099-01-01T00:00:00Z"),
    probeGenerationsUsed: 0,
    credits: 0,
    timezone,
  });
}

function seedSession(store: Store, id: string, isActive: boolean = true): void {
  store.sessions.set(id, { id, isActive });
}

const enabledEnv: Record<string, string | undefined> = { SIMULATED_SPONSORED_UNLOCK_ENABLED: "1" };
const disabledEnv: Record<string, string | undefined> = {};

async function runTests(): Promise<void> {
// ─── Start: feature flag ─────────────────────────────────────────────

{
  const store = freshStore();
  seedUser(store, "u1");
  seedSession(store, "s1");
  const client = makeOps(store, [], []);
  const r = await startSimulatedSponsoredEvent(
    { userId: "u1", librarySessionId: "s1", env: disabledEnv },
    client
  );
  check("start: disabled flag returns SIMULATION_DISABLED", r.ok, false);
  if (!r.ok) check("start: disabled error code", r.error, "SIMULATION_DISABLED");
}

// ─── Start: unknown user / session / inactive ────────────────────────

{
  const store = freshStore();
  seedSession(store, "s1");
  const client = makeOps(store, [], []);
  const r = await startSimulatedSponsoredEvent(
    { userId: "u1", librarySessionId: "s1", env: enabledEnv },
    client
  );
  check("start: user not found", (r as { ok: false; error?: string }).error, "USER_NOT_FOUND");
}

{
  const store = freshStore();
  seedUser(store, "u1");
  const client = makeOps(store, [], []);
  const r = await startSimulatedSponsoredEvent(
    { userId: "u1", librarySessionId: "s-missing", env: enabledEnv },
    client
  );
  check("start: session not found", (r as { ok: false; error?: string }).error, "SESSION_NOT_FOUND");
}

{
  const store = freshStore();
  seedUser(store, "u1");
  seedSession(store, "s1", false);
  const client = makeOps(store, [], []);
  const r = await startSimulatedSponsoredEvent(
    { userId: "u1", librarySessionId: "s1", env: enabledEnv },
    client
  );
  check("start: inactive session rejected", (r as { ok: false; error?: string }).error, "SESSION_INACTIVE");
}

// ─── Start: paid returns direct_plan_access, no event ────────────────

{
  const store = freshStore();
  seedUser(store, "u1", "STARTER");
  seedSession(store, "s1");
  const client = makeOps(store, [], []);
  const r = await startSimulatedSponsoredEvent(
    { userId: "u1", librarySessionId: "s1", env: enabledEnv, now: new Date("2026-07-15T10:00:00Z") },
    client
  );
  check("start: paid outcome", (r as { outcome?: string }).outcome, "direct_plan_access");
  check("start: paid creates no event", store.events.size, 0);
  check("start: paid creates no unlock", store.unlocks.size, 0);
}

// ─── Start: active unlock returns active_unlock, no event ────────────

{
  const store = freshStore();
  seedUser(store, "u1");
  seedSession(store, "s1");
  const now = new Date("2026-07-15T10:00:00Z");
  const unlockId = `unlock-${++store.seq}`;
  store.unlocks.set(unlockId, {
    id: unlockId,
    userId: "u1",
    librarySessionId: "s1",
    unlockedAt: new Date(now.getTime() - 3600_000),
    expiresAt: new Date(now.getTime() + 3600_000),
    source: "SPONSORED",
    providerEventId: null,
  });
  const client = makeOps(store, [], []);
  const r = await startSimulatedSponsoredEvent(
    { userId: "u1", librarySessionId: "s1", env: enabledEnv, now },
    client
  );
  check("start: active_unlock outcome", (r as { outcome?: string }).outcome, "active_unlock");
  check("start: active unlock creates no event", store.events.size, 0);
}

// ─── Start: free locked creates event with correct timings ───────────

{
  const store = freshStore();
  seedUser(store, "u1");
  seedSession(store, "s1");
  const now = new Date("2026-07-15T10:00:00Z");
  const client = makeOps(store, [], []);
  const r = await startSimulatedSponsoredEvent(
    { userId: "u1", librarySessionId: "s1", env: enabledEnv, now },
    client
  );
  check("start: event_created outcome", (r as { outcome?: string }).outcome, "event_created");
  check("start: exactly one event", store.events.size, 1);
  const ev = [...store.events.values()][0];
  check("start: event bound to user", ev.userId, "u1");
  check("start: event bound to session", ev.librarySessionId, "s1");
  check("start: event status PENDING", ev.status, "PENDING");
  check("start: eligibleAt = createdAt + 8s", ev.eligibleAt.getTime() - ev.createdAt.getTime(), 8_000);
  check("start: expiresAt = createdAt + 300s", ev.expiresAt.getTime() - ev.createdAt.getTime(), 300_000);
  assertTruthy("start: providerEventId sim_ prefix", ev.providerEventId.startsWith("sim_"));
  check("start: eligibleAt is server-time based on `now`", ev.eligibleAt.toISOString(), new Date(now.getTime() + 8_000).toISOString());
  if ((r as { outcome?: string }).outcome === "event_created") {
    check("start: response minimumDurationSeconds is 8", (r as { minimumDurationSeconds?: number }).minimumDurationSeconds, 8);
  }
}

// ─── Start: reuses existing PENDING event ────────────────────────────

{
  const store = freshStore();
  seedUser(store, "u1");
  seedSession(store, "s1");
  const now = new Date("2026-07-15T10:00:00Z");
  const client = makeOps(store, [], []);
  const first = await startSimulatedSponsoredEvent(
    { userId: "u1", librarySessionId: "s1", env: enabledEnv, now },
    client
  );
  const later = new Date(now.getTime() + 30_000);
  const second = await startSimulatedSponsoredEvent(
    { userId: "u1", librarySessionId: "s1", env: enabledEnv, now: later },
    client
  );
  check("start: second call reuses existing event", (second as { outcome?: string }).outcome, "event_reused");
  check("start: still only one event row", store.events.size, 1);
  if ((first as { eventId?: string }).eventId && (second as { eventId?: string }).eventId) {
    check(
      "start: reused event id matches original",
      (second as { eventId: string }).eventId,
      (first as { eventId: string }).eventId
    );
  }
}

// ─── Start: expired PENDING gets refreshed ───────────────────────────

{
  const store = freshStore();
  seedUser(store, "u1");
  seedSession(store, "s1");
  const t0 = new Date("2026-07-15T10:00:00Z");
  const client = makeOps(store, [], []);
  await startSimulatedSponsoredEvent(
    { userId: "u1", librarySessionId: "s1", env: enabledEnv, now: t0 },
    client
  );
  // Advance past expiresAt (300s) and start again.
  const t1 = new Date(t0.getTime() + 500_000);
  const r = await startSimulatedSponsoredEvent(
    { userId: "u1", librarySessionId: "s1", env: enabledEnv, now: t1 },
    client
  );
  check("start: after expiry creates new event", (r as { outcome?: string }).outcome, "event_created");
  check("start: two event rows total", store.events.size, 2);
  const rows = [...store.events.values()];
  const expired = rows.find((e) => e.status === "EXPIRED");
  const pending = rows.find((e) => e.status === "PENDING");
  assertTruthy("start: old event marked EXPIRED", !!expired);
  assertTruthy("start: new event PENDING", !!pending);
}

// ─── Complete: feature flag / basic errors ───────────────────────────

{
  const store = freshStore();
  seedUser(store, "u1");
  seedSession(store, "s1");
  const client = makeOps(store, [], []);
  const r = await completeSimulatedSponsoredEvent(
    { userId: "u1", eventId: "missing", env: disabledEnv },
    client
  );
  check("complete: disabled flag rejects", (r as { ok: false; error?: string }).error, "SIMULATION_DISABLED");
}

{
  const store = freshStore();
  seedUser(store, "u1");
  const client = makeOps(store, [], []);
  const r = await completeSimulatedSponsoredEvent(
    { userId: "u1", eventId: "missing", env: enabledEnv },
    client
  );
  check("complete: event not found", (r as { ok: false; error?: string }).error, "EVENT_NOT_FOUND");
}

// ─── Complete: wrong user ────────────────────────────────────────────

{
  const store = freshStore();
  seedUser(store, "u1");
  seedUser(store, "u2");
  seedSession(store, "s1");
  const now = new Date("2026-07-15T10:00:00Z");
  const client = makeOps(store, [], []);
  const start = await startSimulatedSponsoredEvent(
    { userId: "u1", librarySessionId: "s1", env: enabledEnv, now },
    client
  );
  if ((start as { eventId?: string }).eventId) {
    const r = await completeSimulatedSponsoredEvent(
      {
        userId: "u2",
        eventId: (start as { eventId: string }).eventId,
        env: enabledEnv,
        now: new Date(now.getTime() + 10_000),
      },
      client
    );
    check("complete: wrong user rejected", (r as { ok: false; error?: string }).error, "EVENT_WRONG_USER");
    check("complete: no unlock created for wrong user", store.unlocks.size, 0);
  }
}

// ─── Complete: too early ─────────────────────────────────────────────

{
  const store = freshStore();
  seedUser(store, "u1");
  seedSession(store, "s1");
  const now = new Date("2026-07-15T10:00:00Z");
  const client = makeOps(store, [], []);
  const start = await startSimulatedSponsoredEvent(
    { userId: "u1", librarySessionId: "s1", env: enabledEnv, now },
    client
  );
  if ((start as { eventId?: string }).eventId) {
    const r = await completeSimulatedSponsoredEvent(
      { userId: "u1", eventId: (start as { eventId: string }).eventId, env: enabledEnv, now: new Date(now.getTime() + 3_000) },
      client
    );
    check("complete: too early rejected", (r as { ok: false; error?: string }).error, "EVENT_TOO_EARLY");
    check("complete: no unlock created before eligibleAt", store.unlocks.size, 0);
  }
}

// ─── Complete: expired ───────────────────────────────────────────────

{
  const store = freshStore();
  seedUser(store, "u1");
  seedSession(store, "s1");
  const now = new Date("2026-07-15T10:00:00Z");
  const client = makeOps(store, [], []);
  const start = await startSimulatedSponsoredEvent(
    { userId: "u1", librarySessionId: "s1", env: enabledEnv, now },
    client
  );
  if ((start as { eventId?: string }).eventId) {
    const r = await completeSimulatedSponsoredEvent(
      { userId: "u1", eventId: (start as { eventId: string }).eventId, env: enabledEnv, now: new Date(now.getTime() + 500_000) },
      client
    );
    check("complete: expired rejected", (r as { ok: false; error?: string }).error, "EVENT_EXPIRED");
    const ev = [...store.events.values()][0];
    check("complete: expired event marked EXPIRED", ev.status, "EXPIRED");
  }
}

// ─── Complete: valid completion creates unlock ────────────────────────

{
  const store = freshStore();
  seedUser(store, "u1");
  seedSession(store, "s1");
  const now = new Date("2026-07-15T10:00:00Z");
  const client = makeOps(store, [], []);
  const start = await startSimulatedSponsoredEvent(
    { userId: "u1", librarySessionId: "s1", env: enabledEnv, now },
    client
  );
  const eventId = (start as { eventId?: string }).eventId!;
  const r = await completeSimulatedSponsoredEvent(
    { userId: "u1", eventId, env: enabledEnv, now: new Date(now.getTime() + 10_000) },
    client
  );
  check("complete: valid outcome", (r as { outcome?: string }).outcome, "created");
  check("complete: exactly one unlock row", store.unlocks.size, 1);
  const unlock = [...store.unlocks.values()][0];
  const ev = [...store.events.values()][0];
  check("complete: unlock bound to user", unlock.userId, "u1");
  check("complete: unlock bound to session", unlock.librarySessionId, "s1");
  check("complete: unlock carries server providerEventId", unlock.providerEventId, ev.providerEventId);
  check(
    "complete: unlock expires exactly 8h after unlockedAt",
    unlock.expiresAt.getTime() - unlock.unlockedAt.getTime(),
    8 * 60 * 60 * 1000
  );
  check("complete: event marked CONSUMED", ev.status, "CONSUMED");
  assertTruthy("complete: consumedAt populated", !!ev.consumedAt);
  assertTruthy("complete: completedAt populated", !!ev.completedAt);
}

// ─── Complete: retry is idempotent ───────────────────────────────────

{
  const store = freshStore();
  seedUser(store, "u1");
  seedSession(store, "s1");
  const now = new Date("2026-07-15T10:00:00Z");
  const client = makeOps(store, [], []);
  const start = await startSimulatedSponsoredEvent(
    { userId: "u1", librarySessionId: "s1", env: enabledEnv, now },
    client
  );
  const eventId = (start as { eventId?: string }).eventId!;
  const first = await completeSimulatedSponsoredEvent(
    { userId: "u1", eventId, env: enabledEnv, now: new Date(now.getTime() + 10_000) },
    client
  );
  const second = await completeSimulatedSponsoredEvent(
    { userId: "u1", eventId, env: enabledEnv, now: new Date(now.getTime() + 500_000) },
    client
  );
  check("complete-retry: first outcome created", (first as { outcome?: string }).outcome, "created");
  check("complete-retry: second outcome reused (idempotent)", (second as { outcome?: string }).outcome, "reused");
  check("complete-retry: still exactly one unlock", store.unlocks.size, 1);
  if (
    (first as { unlockId?: string }).unlockId &&
    (second as { unlockId?: string }).unlockId
  ) {
    check(
      "complete-retry: same unlock id both times",
      (second as { unlockId: string }).unlockId,
      (first as { unlockId: string }).unlockId
    );
  }
}

// ─── Complete: daily limit rejects the 4th session ───────────────────

{
  const store = freshStore();
  seedUser(store, "u1");
  seedSession(store, "s1");
  seedSession(store, "s2");
  seedSession(store, "s3");
  seedSession(store, "s4");
  const t0 = new Date("2026-07-15T10:00:00Z");
  const client = makeOps(store, [], []);
  for (let i = 1; i <= 3; i++) {
    const sid = `s${i}`;
    const s = await startSimulatedSponsoredEvent(
      { userId: "u1", librarySessionId: sid, env: enabledEnv, now: t0 },
      client
    );
    const eventId = (s as { eventId?: string }).eventId!;
    const c = await completeSimulatedSponsoredEvent(
      { userId: "u1", eventId, env: enabledEnv, now: new Date(t0.getTime() + 10_000) },
      client
    );
    check(`daily-limit: session ${i} created`, (c as { outcome?: string }).outcome, "created");
  }
  const start4 = await startSimulatedSponsoredEvent(
    { userId: "u1", librarySessionId: "s4", env: enabledEnv, now: t0 },
    client
  );
  const eventId4 = (start4 as { eventId?: string }).eventId!;
  const complete4 = await completeSimulatedSponsoredEvent(
    { userId: "u1", eventId: eventId4, env: enabledEnv, now: new Date(t0.getTime() + 10_000) },
    client
  );
  check(
    "daily-limit: 4th session rejected",
    (complete4 as { ok: false; error?: string }).error,
    "DAILY_UNLOCK_LIMIT_REACHED"
  );
  check("daily-limit: still only 3 unlock rows", store.unlocks.size, 3);
}

// ─── Complete: event cannot unlock a different session ───────────────

{
  const store = freshStore();
  seedUser(store, "u1");
  seedSession(store, "s1");
  seedSession(store, "s2");
  const now = new Date("2026-07-15T10:00:00Z");
  const client = makeOps(store, [], []);
  const start = await startSimulatedSponsoredEvent(
    { userId: "u1", librarySessionId: "s1", env: enabledEnv, now },
    client
  );
  const eventId = (start as { eventId?: string }).eventId!;
  // Even if a caller forged a completion for s2, the server binds via
  // the persisted event.librarySessionId — the resulting unlock still
  // targets s1. This test proves the completion path never accepts a
  // client-supplied librarySessionId.
  await completeSimulatedSponsoredEvent(
    { userId: "u1", eventId, env: enabledEnv, now: new Date(now.getTime() + 10_000) },
    client
  );
  const unlock = [...store.unlocks.values()][0];
  check("session binding: unlock stays on s1 (server-owned)", unlock.librarySessionId, "s1");
}

// ─── Cancel: cancelled event cannot complete ─────────────────────────

{
  const store = freshStore();
  seedUser(store, "u1");
  seedSession(store, "s1");
  const now = new Date("2026-07-15T10:00:00Z");
  const client = makeOps(store, [], []);
  const start = await startSimulatedSponsoredEvent(
    { userId: "u1", librarySessionId: "s1", env: enabledEnv, now },
    client
  );
  const eventId = (start as { eventId?: string }).eventId!;
  const cancel = await cancelSimulatedSponsoredEvent(
    { userId: "u1", eventId, env: enabledEnv, now: new Date(now.getTime() + 1_000) },
    client
  );
  check("cancel: ok", (cancel as { ok?: boolean }).ok, true);
  const ev = [...store.events.values()][0];
  check("cancel: event marked CANCELLED", ev.status, "CANCELLED");
  const complete = await completeSimulatedSponsoredEvent(
    { userId: "u1", eventId, env: enabledEnv, now: new Date(now.getTime() + 10_000) },
    client
  );
  check("cancel: complete on cancelled rejected", (complete as { ok: false; error?: string }).error, "EVENT_CANCELLED");
  check("cancel: no unlock created", store.unlocks.size, 0);
}

// ─── Timezone-aware daily limit ──────────────────────────────────────
//
// A Free user with tz Europe/Berlin completing at 2026-07-15 22:30 UTC
// is on 2026-07-16 local Berlin (already past midnight). The prior
// three completions at 2026-07-15 09:00 UTC (still 2026-07-15 local)
// consumed slots on the previous local day — so the fourth completion
// should succeed under the new tz-aware boundary.

{
  const store = freshStore();
  seedUser(store, "u1", "FREE", "Europe/Berlin");
  seedSession(store, "s1");
  seedSession(store, "s2");
  seedSession(store, "s3");
  seedSession(store, "s4");
  const client = makeOps(store, [], []);

  const midDay = new Date("2026-07-15T09:00:00Z"); // 11:00 local
  for (let i = 1; i <= 3; i++) {
    const sid = `s${i}`;
    const s = await startSimulatedSponsoredEvent(
      { userId: "u1", librarySessionId: sid, env: enabledEnv, now: midDay },
      client
    );
    const eventId = (s as { eventId?: string }).eventId!;
    const c = await completeSimulatedSponsoredEvent(
      { userId: "u1", eventId, env: enabledEnv, now: new Date(midDay.getTime() + 10_000) },
      client
    );
    check(`tz-daily: mid-day #${i} created`, (c as { outcome?: string }).outcome, "created");
  }
  // 22:30 UTC = 2026-07-16 00:30 local Berlin (CEST). New local day.
  const nextLocalDay = new Date("2026-07-15T22:30:00Z");
  const s4 = await startSimulatedSponsoredEvent(
    { userId: "u1", librarySessionId: "s4", env: enabledEnv, now: nextLocalDay },
    client
  );
  const eventId4 = (s4 as { eventId?: string }).eventId!;
  const c4 = await completeSimulatedSponsoredEvent(
    { userId: "u1", eventId: eventId4, env: enabledEnv, now: new Date(nextLocalDay.getTime() + 10_000) },
    client
  );
  check(
    "tz-daily: 4th session in new local day succeeds",
    (c4 as { outcome?: string }).outcome,
    "created"
  );
  check("tz-daily: four unlocks total", store.unlocks.size, 4);
}

}

runTests()
  .then(() => {
    console.log("");
    console.log(`Total: ${passed + failed}   Passed: ${passed}   Failed: ${failed}`);
    if (failed > 0) process.exit(1);
  })
  .catch((err) => {
    console.error("Test harness threw:", err);
    process.exit(2);
  });
