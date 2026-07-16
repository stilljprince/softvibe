// scripts/test-reservation.ts
//
// Offline tests for the RP-010 Phase 3A Minute Reservation module.
// Exercises the pure decision helpers and the transactional
// reserveAndCreateJob function through an in-memory Prisma stub.
// Run with:
//
//   npx tsx scripts/test-reservation.ts
//
// Covers:
//   * minutesFromDurationSec — rounding, invalid input, boundary values
//   * decidePlanMinuteReservation
//       - FREE always skips
//       - Expired paid plan (effective FREE) skips
//       - Paid plan with null period skips
//       - Zero or negative requested minutes skip
//       - STARTER / PREMIUM with valid period → reserve
//   * reserveAndCreateJob (against in-memory Prisma mock)
//       - USER_NOT_FOUND for unknown user
//       - FREE creates the Job untagged (no PeriodUsage, no entitlement)
//       - STARTER creates a fresh PeriodUsage with correct fields AND
//         creates a Job tagged PLAN_MINUTES atomically
//       - PREMIUM creates a fresh PeriodUsage with correct fields AND
//         creates a Job tagged PLAN_MINUTES atomically
//       - Second reservation for the same user reuses the same PeriodUsage
//         and increments minutesReserved atomically
//       - minutesUsed is never mutated
//       - usageFinalizedAt / usageReleasedAt remain null
//       - Expired paid plan → skipped_free branch, no PeriodUsage row
//       - Legacy paid plan with null period → skipped_no_period, Job created
//       - Zero-minute request → skipped_zero_minutes branch, Job created
//   * Allowance enforcement
//       - STARTER 79 + 1 → allowed
//       - STARTER 79 + 2 → rejected (INSUFFICIENT_MINUTES)
//       - PREMIUM 199 + 1 → allowed
//       - PREMIUM 199 + 2 → rejected (INSUFFICIENT_MINUTES)
//       - STARTER first reservation exceeding allowance → rejected
//       - PREMIUM first reservation exceeding allowance → rejected
//       - Rejected reservation must NOT create the Job (transaction rollback)
//       - Rejected reservation must NOT increment PeriodUsage
//       - Rejected reservation must NOT mark a Job PLAN_MINUTES
//       - Rejection preserves minutesUsed at 0 (never touched by this path)
//       - Concurrent reservations at the boundary cannot exceed allowance
//         (some succeed, some are rejected; the total never overshoots)
//   * Common transaction (RP-010 Phase 3A final)
//       - Credit debit, PeriodUsage reservation and Job.create are one
//         atomic unit. Rejection at any step reverts every earlier write.
//       - NO_CREDITS surfaces from the atomic credit gate; no PeriodUsage,
//         no Job is created.
//       - INSUFFICIENT_MINUTES rolls the credit debit back.
//       - Injected Job.create failure rolls credit + reservation back.
//       - Injected PeriodUsage.update failure rolls credit back, no Job.
//       - Happy path debits exactly one credit and creates exactly one Job.
//   * First-PeriodUsage-row concurrency (RP-010 Phase 3A final)
//       - Two parallel first reservations that both fit: both succeed,
//         one PeriodUsage row, correct sum, one credit per success, two Jobs.
//       - Two parallel first reservations that together exceed the cap:
//         the winner succeeds, the loser sees INSUFFICIENT_MINUTES on retry,
//         limit never overshoots, loser retains its credit, no orphan Job.
//       - Injected single P2002 on the first create: exactly one retry,
//         one net credit debit, one net reservation, one Job.
//       - Persistent P2002 on create: controlled CONCURRENCY_CONFLICT after
//         one retry, no credit lost, no reservation, no Job.

import {
  decidePlanMinuteReservation,
  minutesFromDurationSec,
  reserveAndCreateJob,
  type JobCreateData,
} from "../lib/entitlement/reservation";
import type { Plan, PrismaClient, EntitlementKind } from "@prisma/client";

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
// Pure helper tests
// ---------------------------------------------------------------------------

check("minutesFromDurationSec: null → 0", minutesFromDurationSec(null), 0);
check(
  "minutesFromDurationSec: undefined → 0",
  minutesFromDurationSec(undefined),
  0
);
check("minutesFromDurationSec: 0 → 0", minutesFromDurationSec(0), 0);
check("minutesFromDurationSec: -60 → 0", minutesFromDurationSec(-60), 0);
check("minutesFromDurationSec: NaN → 0", minutesFromDurationSec(NaN), 0);
check(
  "minutesFromDurationSec: Infinity → 0",
  minutesFromDurationSec(Infinity),
  0
);
check("minutesFromDurationSec: 30 → 1 (round up)", minutesFromDurationSec(30), 1);
check("minutesFromDurationSec: 60 → 1", minutesFromDurationSec(60), 1);
check("minutesFromDurationSec: 61 → 2 (round up)", minutesFromDurationSec(61), 2);
check(
  "minutesFromDurationSec: 300 → 5 (exact)",
  minutesFromDurationSec(300),
  5
);
check(
  "minutesFromDurationSec: 301 → 6 (round up)",
  minutesFromDurationSec(301),
  6
);
check(
  "minutesFromDurationSec: 12000 → 200 (PREMIUM cap-adjacent)",
  minutesFromDurationSec(12000),
  200
);

const periodStart = new Date("2026-07-01T00:00:00.000Z");
const periodEnd = new Date("2026-08-01T00:00:00.000Z");
const insidePeriod = new Date("2026-07-15T00:00:00.000Z");
const pastPeriod = new Date("2026-09-01T00:00:00.000Z");

check(
  "decide: FREE → skipped_free",
  decidePlanMinuteReservation({
    plan: "FREE",
    planPeriodStart: null,
    planPeriodEnd: null,
    requestedMinutes: 10,
    now: insidePeriod,
  }).action,
  "skipped_free"
);
check(
  "decide: STARTER expired period → skipped_free",
  decidePlanMinuteReservation({
    plan: "STARTER",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
    requestedMinutes: 10,
    now: pastPeriod,
  }).action,
  "skipped_free"
);
check(
  "decide: PREMIUM expired period → skipped_free",
  decidePlanMinuteReservation({
    plan: "PREMIUM",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
    requestedMinutes: 10,
    now: pastPeriod,
  }).action,
  "skipped_free"
);
check(
  "decide: STARTER null period → skipped_no_period",
  decidePlanMinuteReservation({
    plan: "STARTER",
    planPeriodStart: null,
    planPeriodEnd: null,
    requestedMinutes: 10,
    now: insidePeriod,
  }).action,
  "skipped_no_period"
);
check(
  "decide: STARTER zero minutes → skipped_zero_minutes",
  decidePlanMinuteReservation({
    plan: "STARTER",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
    requestedMinutes: 0,
    now: insidePeriod,
  }).action,
  "skipped_zero_minutes"
);
check(
  "decide: STARTER negative minutes → skipped_zero_minutes",
  decidePlanMinuteReservation({
    plan: "STARTER",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
    requestedMinutes: -5,
    now: insidePeriod,
  }).action,
  "skipped_zero_minutes"
);
{
  const d = decidePlanMinuteReservation({
    plan: "STARTER",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
    requestedMinutes: 12,
    now: insidePeriod,
  });
  check("decide: STARTER valid → reserve", d.action, "reserve");
  if (d.action === "reserve") {
    check("decide: STARTER minutes echoed", d.minutes, 12);
    check("decide: STARTER periodStart echoed", d.periodStart, periodStart);
    check("decide: STARTER periodEnd echoed", d.periodEnd, periodEnd);
  }
}
{
  const d = decidePlanMinuteReservation({
    plan: "PREMIUM",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
    requestedMinutes: 45,
    now: insidePeriod,
  });
  check("decide: PREMIUM valid → reserve", d.action, "reserve");
  if (d.action === "reserve") {
    check("decide: PREMIUM minutes echoed", d.minutes, 45);
  }
}

// ---------------------------------------------------------------------------
// In-memory Prisma stub
// ---------------------------------------------------------------------------
//
// Implements the surface reserveAndCreateJob touches:
//   - $transaction(async (tx) => …)  — runs against the store; on a thrown
//     error every write from the fn is rolled back.
//   - user.findUnique
//   - user.updateMany (credit debit)
//   - periodUsage.findUnique + updateMany + create
//   - job.create
//
// A per-transaction WriteLog captures each mutation, and $transaction only
// commits them if fn returns without throwing. This lets us model rollback
// on P2002-style unique-constraint failures. The store is otherwise a plain
// object shared between the "client" and each "tx" handle.

type StoreUser = {
  id: string;
  plan: Plan;
  planPeriodStart: Date | null;
  planPeriodEnd: Date | null;
  credits: number;
};
type StoreJob = {
  id: string;
  userId: string;
  entitlementKind: EntitlementKind | null;
  reservedMinutes: number | null;
  usageFinalizedAt: Date | null;
  usageReleasedAt: Date | null;
  periodUsageId: string | null;
  prompt: string;
  title: string;
  status: string;
};
type StorePeriodUsage = {
  userId: string;
  periodStart: Date;
  periodEnd: Date;
  minutesReserved: number;
  minutesUsed: number;
};

type Store = {
  users: Map<string, StoreUser>;
  jobs: Map<string, StoreJob>;
  // Keyed by `${userId}::${periodStart.toISOString()}` to mirror the
  // userId_periodStart composite unique index.
  periodUsages: Map<string, StorePeriodUsage>;
  jobSeq: number;
  // Test injection hooks. Each one is consumed on the next matching call
  // unless marked "always".
  injectPeriodUsageCreateP2002Once?: boolean;
  injectPeriodUsageCreateP2002Always?: boolean;
  injectJobCreateErrorOnce?: Error;
  injectPeriodUsageUpdateErrorOnce?: Error;
};

function pukey(userId: string, periodStart: Date): string {
  return `${userId}::${periodStart.toISOString()}`;
}

type WriteOp =
  | { kind: "job.create"; jobId: string }
  | { kind: "periodUsage.create"; key: string }
  | {
      kind: "periodUsage.increment";
      key: string;
      by: number;
      prev: number;
    }
  | { kind: "user.decrement"; userId: string; by: number; prev: number };

function makeP2002(): Error {
  const err = new Error(
    "Unique constraint failed on the fields: (`userId`,`periodStart`)"
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (err as any).code = "P2002";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (err as any).meta = { target: ["userId", "periodStart"] };
  return err;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTxOps(store: Store, writes: WriteOp[]) {
  return {
    user: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        const u = store.users.get(where.id);
        if (!u) return null;
        return {
          plan: u.plan,
          planPeriodStart: u.planPeriodStart,
          planPeriodEnd: u.planPeriodEnd,
        };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateMany: async ({ where, data }: any) => {
        const u = store.users.get(where.id);
        if (!u) return { count: 0 };
        if (
          where.credits &&
          typeof where.credits.gte === "number" &&
          u.credits < where.credits.gte
        ) {
          return { count: 0 };
        }
        const prev = u.credits;
        if (data.credits && "decrement" in data.credits) {
          u.credits -= data.credits.decrement;
          writes.push({
            kind: "user.decrement",
            userId: u.id,
            by: data.credits.decrement,
            prev,
          });
        }
        return { count: 1 };
      },
    },
    job: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async ({ data, select }: any) => {
        if (store.injectJobCreateErrorOnce) {
          const err = store.injectJobCreateErrorOnce;
          store.injectJobCreateErrorOnce = undefined;
          throw err;
        }
        const id = `job-${++store.jobSeq}`;
        const job: StoreJob = {
          id,
          userId: data.userId,
          entitlementKind: data.entitlementKind ?? null,
          reservedMinutes: data.reservedMinutes ?? null,
          usageFinalizedAt: null,
          usageReleasedAt: null,
          periodUsageId: data.periodUsageId ?? null,
          prompt: data.prompt,
          title: data.title,
          status: data.status,
        };
        store.jobs.set(id, job);
        writes.push({ kind: "job.create", jobId: id });
        if (select) {
          return {
            id: job.id,
            status: job.status,
            title: job.title,
            prompt: job.prompt,
          };
        }
        return job;
      },
    },
    periodUsage: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        const composite = where.userId_periodStart;
        const key = pukey(composite.userId, composite.periodStart);
        const existing = store.periodUsages.get(key);
        if (!existing) return null;
        return { ...existing, id: key };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateMany: async ({ where, data }: any) => {
        if (store.injectPeriodUsageUpdateErrorOnce) {
          const err = store.injectPeriodUsageUpdateErrorOnce;
          store.injectPeriodUsageUpdateErrorOnce = undefined;
          throw err;
        }
        // Match on (userId, periodStart) + a numeric-bound predicate on
        // minutesReserved. Mirrors Postgres row-level atomicity: this is a
        // single synchronous read-check-write so concurrent callers cannot
        // both see a stale value.
        const key = pukey(where.userId, where.periodStart);
        const existing = store.periodUsages.get(key);
        if (!existing) return { count: 0 };
        if (
          where.minutesReserved &&
          typeof where.minutesReserved.lte === "number" &&
          existing.minutesReserved > where.minutesReserved.lte
        ) {
          return { count: 0 };
        }
        const prev = existing.minutesReserved;
        if (data.minutesReserved && "increment" in data.minutesReserved) {
          existing.minutesReserved += data.minutesReserved.increment;
          writes.push({
            kind: "periodUsage.increment",
            key,
            by: data.minutesReserved.increment,
            prev,
          });
        }
        return { count: 1 };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async ({ data, select }: any) => {
        const key = pukey(data.userId, data.periodStart);
        // Persistent injection wins: every create throws P2002 until cleared.
        if (store.injectPeriodUsageCreateP2002Always) {
          throw makeP2002();
        }
        // One-shot injection: simulate that a concurrent tx already
        // committed the row under our feet. Seed it in the store so the
        // outer retry can find it and increment atomically — mirrors what
        // the real DB would look like on the second attempt.
        if (store.injectPeriodUsageCreateP2002Once) {
          store.injectPeriodUsageCreateP2002Once = false;
          if (!store.periodUsages.has(key)) {
            store.periodUsages.set(key, {
              userId: data.userId,
              periodStart: data.periodStart,
              periodEnd: data.periodEnd,
              minutesReserved: 0,
              minutesUsed: 0,
            });
          }
          throw makeP2002();
        }
        if (store.periodUsages.has(key)) {
          // Real unique-constraint conflict. Aborts the outer transaction —
          // matches production behaviour.
          throw makeP2002();
        }
        store.periodUsages.set(key, {
          userId: data.userId,
          periodStart: data.periodStart,
          periodEnd: data.periodEnd,
          minutesReserved: data.minutesReserved,
          minutesUsed: data.minutesUsed,
        });
        writes.push({ kind: "periodUsage.create", key });
        if (select) {
          return { id: key };
        }
        return { id: key };
      },
    },
  };
}

function rollback(store: Store, writes: WriteOp[]): void {
  // Undo in reverse order so create→increment sequences unwind cleanly.
  for (let i = writes.length - 1; i >= 0; i--) {
    const w = writes[i];
    if (w.kind === "job.create") {
      store.jobs.delete(w.jobId);
    } else if (w.kind === "periodUsage.create") {
      store.periodUsages.delete(w.key);
    } else if (w.kind === "periodUsage.increment") {
      const row = store.periodUsages.get(w.key);
      if (row) row.minutesReserved = w.prev;
    } else if (w.kind === "user.decrement") {
      const u = store.users.get(w.userId);
      if (u) u.credits = w.prev;
    }
  }
}

function buildStubClient(store: Store): PrismaClient {
  const client = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: async (fn: any) => {
      const writes: WriteOp[] = [];
      const ops = buildTxOps(store, writes);
      try {
        return await fn(ops);
      } catch (e) {
        rollback(store, writes);
        throw e;
      }
    },
  };
  return client as unknown as PrismaClient;
}

function seedStore(): Store {
  return {
    users: new Map<string, StoreUser>(),
    jobs: new Map<string, StoreJob>(),
    periodUsages: new Map<string, StorePeriodUsage>(),
    jobSeq: 0,
  };
}

function seedUser(
  store: Store,
  u: Omit<StoreUser, "credits"> & { credits?: number }
): void {
  store.users.set(u.id, { credits: 100, ...u });
}

function jobData(
  userId: string,
  overrides: Partial<JobCreateData> = {}
): JobCreateData {
  return {
    userId,
    prompt: "test prompt",
    preset: "sleep-story",
    // Prisma's JobStatus enum — the stub only stores it as a string, so a
    // literal is fine here without pulling in $Enums.
    status: "QUEUED" as JobCreateData["status"],
    durationSec: 300,
    title: "Test Title",
    language: "de",
    voiceGender: "female",
    voiceStyle: "soft",
    narrativeMode: null,
    scriptOverride: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// reserveAndCreateJob — behaviour tests
// ---------------------------------------------------------------------------

async function runReservationTests(): Promise<void> {

// (1) USER_NOT_FOUND
{
  const store = seedStore();
  const client = buildStubClient(store);
  const r = await reserveAndCreateJob(
    {
      userId: "missing-user",
      isAdmin: true,
      requestedMinutes: 10,
      jobData: jobData("missing-user"),
      now: insidePeriod,
    },
    client
  );
  check("USER_NOT_FOUND: ok=false", r.ok, false);
  if (!r.ok) check("USER_NOT_FOUND: error", r.error, "USER_NOT_FOUND");
  check("USER_NOT_FOUND: no Job created", store.jobs.size, 0);
  check("USER_NOT_FOUND: no PeriodUsage created", store.periodUsages.size, 0);
}

// (2) FREE — Job created untagged, no PeriodUsage row
{
  const store = seedStore();
  seedUser(store, {
    id: "u-free",
    plan: "FREE",
    planPeriodStart: null,
    planPeriodEnd: null,
  });
  const client = buildStubClient(store);
  const r = await reserveAndCreateJob(
    {
      userId: "u-free",
      isAdmin: true,
      requestedMinutes: 10,
      jobData: jobData("u-free"),
      now: insidePeriod,
    },
    client
  );
  check("FREE: ok=true", r.ok, true);
  if (r.ok) check("FREE: reservation=skipped_free", r.reservation, "skipped_free");
  check("FREE: no PeriodUsage row", store.periodUsages.size, 0);
  check("FREE: exactly one Job", store.jobs.size, 1);
  const job = Array.from(store.jobs.values())[0];
  check("FREE: Job.entitlementKind is null", job.entitlementKind, null);
  check("FREE: Job.reservedMinutes is null", job.reservedMinutes, null);
  check("FREE: Job.usageFinalizedAt still null", job.usageFinalizedAt, null);
  check("FREE: Job.usageReleasedAt still null", job.usageReleasedAt, null);
}

// (3) STARTER — first reservation creates PeriodUsage AND Job atomically
{
  const store = seedStore();
  seedUser(store, {
    id: "u-starter",
    plan: "STARTER",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
  });
  const client = buildStubClient(store);
  const r = await reserveAndCreateJob(
    {
      userId: "u-starter",
      isAdmin: true,
      requestedMinutes: 12,
      jobData: jobData("u-starter"),
      now: insidePeriod,
    },
    client
  );
  check("STARTER: ok=true", r.ok, true);
  if (r.ok) {
    check("STARTER: reservation=reserved", r.reservation, "reserved");
    if (r.reservation === "reserved") {
      check("STARTER: minutes=12", r.minutes, 12);
      check("STARTER: periodStart echoed", r.periodStart, periodStart);
    }
  }
  const pu = store.periodUsages.get(pukey("u-starter", periodStart));
  check("STARTER: PeriodUsage row exists", pu != null, true);
  check("STARTER: minutesReserved=12", pu?.minutesReserved, 12);
  check("STARTER: minutesUsed=0", pu?.minutesUsed, 0);
  check(
    "STARTER: periodEnd stored on new row",
    pu?.periodEnd?.toISOString(),
    periodEnd.toISOString()
  );
  check("STARTER: exactly one Job", store.jobs.size, 1);
  const job = Array.from(store.jobs.values())[0];
  check(
    "STARTER: Job.entitlementKind=PLAN_MINUTES",
    job.entitlementKind,
    "PLAN_MINUTES"
  );
  check("STARTER: Job.reservedMinutes=12", job.reservedMinutes, 12);
  check("STARTER: Job.usageFinalizedAt still null", job.usageFinalizedAt, null);
  check("STARTER: Job.usageReleasedAt still null", job.usageReleasedAt, null);
  check(
    "STARTER: Job.periodUsageId points at reserved row",
    job.periodUsageId,
    pukey("u-starter", periodStart)
  );
}

// (4) PREMIUM — first reservation creates PeriodUsage AND Job
{
  const store = seedStore();
  seedUser(store, {
    id: "u-premium",
    plan: "PREMIUM",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
  });
  const client = buildStubClient(store);
  const r = await reserveAndCreateJob(
    {
      userId: "u-premium",
      isAdmin: true,
      requestedMinutes: 45,
      jobData: jobData("u-premium"),
      now: insidePeriod,
    },
    client
  );
  check("PREMIUM: ok=true", r.ok, true);
  if (r.ok) check("PREMIUM: reservation=reserved", r.reservation, "reserved");
  const pu = store.periodUsages.get(pukey("u-premium", periodStart));
  check("PREMIUM: PeriodUsage row exists", pu != null, true);
  check("PREMIUM: minutesReserved=45", pu?.minutesReserved, 45);
  check("PREMIUM: minutesUsed=0", pu?.minutesUsed, 0);
  const job = Array.from(store.jobs.values())[0];
  check(
    "PREMIUM: Job.entitlementKind=PLAN_MINUTES",
    job.entitlementKind,
    "PLAN_MINUTES"
  );
  check("PREMIUM: Job.reservedMinutes=45", job.reservedMinutes, 45);
  check(
    "PREMIUM: Job.periodUsageId points at reserved row",
    job.periodUsageId,
    pukey("u-premium", periodStart)
  );
}

// (5) Existing PeriodUsage row is reused; second Job increments
{
  const store = seedStore();
  seedUser(store, {
    id: "u-reuse",
    plan: "STARTER",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
  });
  const client = buildStubClient(store);
  await reserveAndCreateJob(
    {
      userId: "u-reuse",
      isAdmin: true,
      requestedMinutes: 10,
      jobData: jobData("u-reuse"),
      now: insidePeriod,
    },
    client
  );
  await reserveAndCreateJob(
    {
      userId: "u-reuse",
      isAdmin: true,
      requestedMinutes: 7,
      jobData: jobData("u-reuse"),
      now: insidePeriod,
    },
    client
  );
  const pu = store.periodUsages.get(pukey("u-reuse", periodStart));
  check(
    "Reuse: only one PeriodUsage row exists",
    store.periodUsages.size,
    1
  );
  check("Reuse: minutesReserved=17 (10+7)", pu?.minutesReserved, 17);
  check("Reuse: minutesUsed still 0", pu?.minutesUsed, 0);
  check("Reuse: exactly two Jobs", store.jobs.size, 2);
  const jobs = Array.from(store.jobs.values());
  check("Reuse: job A reservedMinutes=10", jobs[0].reservedMinutes, 10);
  check("Reuse: job B reservedMinutes=7", jobs[1].reservedMinutes, 7);
  check(
    "Reuse: both jobs tagged PLAN_MINUTES",
    jobs.every((j) => j.entitlementKind === "PLAN_MINUTES"),
    true
  );
  const reuseKey = pukey("u-reuse", periodStart);
  check(
    "Reuse: both jobs share the same periodUsageId",
    jobs.every((j) => j.periodUsageId === reuseKey),
    true
  );
}

// (6) Expired paid plan → skipped_free branch, Job created untagged
{
  const store = seedStore();
  seedUser(store, {
    id: "u-expired",
    plan: "STARTER",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
  });
  const client = buildStubClient(store);
  const r = await reserveAndCreateJob(
    {
      userId: "u-expired",
      isAdmin: true,
      requestedMinutes: 15,
      jobData: jobData("u-expired"),
      now: pastPeriod,
    },
    client
  );
  check("Expired: reservation=skipped_free", r.ok && r.reservation, "skipped_free");
  check("Expired: no PeriodUsage", store.periodUsages.size, 0);
  const job = Array.from(store.jobs.values())[0];
  check("Expired: Job.entitlementKind still null", job.entitlementKind, null);
  check("Expired: Job.reservedMinutes still null", job.reservedMinutes, null);
}

// (7) Paid plan with null period → skipped_no_period, Job untagged
{
  const store = seedStore();
  seedUser(store, {
    id: "u-legacy",
    plan: "PREMIUM",
    planPeriodStart: null,
    planPeriodEnd: null,
  });
  const client = buildStubClient(store);
  const r = await reserveAndCreateJob(
    {
      userId: "u-legacy",
      isAdmin: true,
      requestedMinutes: 15,
      jobData: jobData("u-legacy"),
      now: insidePeriod,
    },
    client
  );
  check(
    "Legacy: reservation=skipped_no_period",
    r.ok && r.reservation,
    "skipped_no_period"
  );
  check("Legacy: no PeriodUsage", store.periodUsages.size, 0);
  const job = Array.from(store.jobs.values())[0];
  check("Legacy: Job.entitlementKind still null", job.entitlementKind, null);
}

// (8) Zero requested minutes → skipped_zero_minutes, Job untagged
{
  const store = seedStore();
  seedUser(store, {
    id: "u-zero",
    plan: "STARTER",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
  });
  const client = buildStubClient(store);
  const r = await reserveAndCreateJob(
    {
      userId: "u-zero",
      isAdmin: true,
      requestedMinutes: 0,
      jobData: jobData("u-zero"),
      now: insidePeriod,
    },
    client
  );
  check(
    "Zero: reservation=skipped_zero_minutes",
    r.ok && r.reservation,
    "skipped_zero_minutes"
  );
  check("Zero: no PeriodUsage", store.periodUsages.size, 0);
  const job = Array.from(store.jobs.values())[0];
  check("Zero: Job.entitlementKind still null", job.entitlementKind, null);
}

// (9) Cross-user isolation — separate stores, no accidental sharing
{
  const store = seedStore();
  seedUser(store, {
    id: "u-x1",
    plan: "STARTER",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
  });
  seedUser(store, {
    id: "u-x2",
    plan: "PREMIUM",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
  });
  const client = buildStubClient(store);
  await reserveAndCreateJob(
    {
      userId: "u-x1",
      isAdmin: true,
      requestedMinutes: 8,
      jobData: jobData("u-x1"),
      now: insidePeriod,
    },
    client
  );
  await reserveAndCreateJob(
    {
      userId: "u-x2",
      isAdmin: true,
      requestedMinutes: 6,
      jobData: jobData("u-x2"),
      now: insidePeriod,
    },
    client
  );
  check("Cross-user: two PeriodUsage rows", store.periodUsages.size, 2);
  const p1 = store.periodUsages.get(pukey("u-x1", periodStart));
  const p2 = store.periodUsages.get(pukey("u-x2", periodStart));
  check("Cross-user: u-x1 minutesReserved=8", p1?.minutesReserved, 8);
  check("Cross-user: u-x2 minutesReserved=6", p2?.minutesReserved, 6);
}

// ---------------------------------------------------------------------------
// Allowance enforcement — RP-010 Phase 3A
// ---------------------------------------------------------------------------

// (10) STARTER 79 + 1 → allowed (exactly at cap)
{
  const store = seedStore();
  seedUser(store, {
    id: "u-s79",
    plan: "STARTER",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
  });
  store.periodUsages.set(pukey("u-s79", periodStart), {
    userId: "u-s79",
    periodStart,
    periodEnd,
    minutesReserved: 79,
    minutesUsed: 0,
  });
  const client = buildStubClient(store);
  const r = await reserveAndCreateJob(
    {
      userId: "u-s79",
      isAdmin: true,
      requestedMinutes: 1,
      jobData: jobData("u-s79"),
      now: insidePeriod,
    },
    client
  );
  check("STARTER 79+1: ok=true", r.ok, true);
  if (r.ok) check("STARTER 79+1: reservation=reserved", r.reservation, "reserved");
  const pu = store.periodUsages.get(pukey("u-s79", periodStart));
  check("STARTER 79+1: minutesReserved=80", pu?.minutesReserved, 80);
  check("STARTER 79+1: one Job created", store.jobs.size, 1);
  const job = Array.from(store.jobs.values())[0];
  check(
    "STARTER 79+1: Job tagged PLAN_MINUTES",
    job.entitlementKind,
    "PLAN_MINUTES"
  );
}

// (11) STARTER 79 + 2 → rejected (would overshoot cap by 1)
{
  const store = seedStore();
  seedUser(store, {
    id: "u-s79r",
    plan: "STARTER",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
  });
  store.periodUsages.set(pukey("u-s79r", periodStart), {
    userId: "u-s79r",
    periodStart,
    periodEnd,
    minutesReserved: 79,
    minutesUsed: 0,
  });
  const client = buildStubClient(store);
  const r = await reserveAndCreateJob(
    {
      userId: "u-s79r",
      isAdmin: true,
      requestedMinutes: 2,
      jobData: jobData("u-s79r"),
      now: insidePeriod,
    },
    client
  );
  check("STARTER 79+2: ok=false", r.ok, false);
  if (!r.ok)
    check("STARTER 79+2: error=INSUFFICIENT_MINUTES", r.error, "INSUFFICIENT_MINUTES");
  const pu = store.periodUsages.get(pukey("u-s79r", periodStart));
  check(
    "STARTER 79+2: minutesReserved unchanged at 79",
    pu?.minutesReserved,
    79
  );
  check("STARTER 79+2: no Job created (rollback)", store.jobs.size, 0);
  check("STARTER 79+2: minutesUsed still 0", pu?.minutesUsed, 0);
}

// (12) PREMIUM 199 + 1 → allowed
{
  const store = seedStore();
  seedUser(store, {
    id: "u-p199",
    plan: "PREMIUM",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
  });
  store.periodUsages.set(pukey("u-p199", periodStart), {
    userId: "u-p199",
    periodStart,
    periodEnd,
    minutesReserved: 199,
    minutesUsed: 0,
  });
  const client = buildStubClient(store);
  const r = await reserveAndCreateJob(
    {
      userId: "u-p199",
      isAdmin: true,
      requestedMinutes: 1,
      jobData: jobData("u-p199"),
      now: insidePeriod,
    },
    client
  );
  check("PREMIUM 199+1: ok=true", r.ok, true);
  if (r.ok) check("PREMIUM 199+1: reservation=reserved", r.reservation, "reserved");
  const pu = store.periodUsages.get(pukey("u-p199", periodStart));
  check("PREMIUM 199+1: minutesReserved=200", pu?.minutesReserved, 200);
  const job = Array.from(store.jobs.values())[0];
  check(
    "PREMIUM 199+1: Job tagged PLAN_MINUTES",
    job.entitlementKind,
    "PLAN_MINUTES"
  );
}

// (13) PREMIUM 199 + 2 → rejected
{
  const store = seedStore();
  seedUser(store, {
    id: "u-p199r",
    plan: "PREMIUM",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
  });
  store.periodUsages.set(pukey("u-p199r", periodStart), {
    userId: "u-p199r",
    periodStart,
    periodEnd,
    minutesReserved: 199,
    minutesUsed: 0,
  });
  const client = buildStubClient(store);
  const r = await reserveAndCreateJob(
    {
      userId: "u-p199r",
      isAdmin: true,
      requestedMinutes: 2,
      jobData: jobData("u-p199r"),
      now: insidePeriod,
    },
    client
  );
  check("PREMIUM 199+2: ok=false", r.ok, false);
  if (!r.ok)
    check(
      "PREMIUM 199+2: error=INSUFFICIENT_MINUTES",
      r.error,
      "INSUFFICIENT_MINUTES"
    );
  const pu = store.periodUsages.get(pukey("u-p199r", periodStart));
  check(
    "PREMIUM 199+2: minutesReserved unchanged at 199",
    pu?.minutesReserved,
    199
  );
  check("PREMIUM 199+2: no Job created (rollback)", store.jobs.size, 0);
}

// (14) STARTER first reservation exceeding allowance → rejected
{
  const store = seedStore();
  seedUser(store, {
    id: "u-s-huge",
    plan: "STARTER",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
  });
  const client = buildStubClient(store);
  const r = await reserveAndCreateJob(
    {
      userId: "u-s-huge",
      isAdmin: true,
      requestedMinutes: 81,
      jobData: jobData("u-s-huge"),
      now: insidePeriod,
    },
    client
  );
  check("STARTER 0+81: ok=false", r.ok, false);
  if (!r.ok)
    check("STARTER 0+81: error=INSUFFICIENT_MINUTES", r.error, "INSUFFICIENT_MINUTES");
  check("STARTER 0+81: no PeriodUsage created", store.periodUsages.size, 0);
  check("STARTER 0+81: no Job created", store.jobs.size, 0);
}

// (15) PREMIUM first reservation exceeding allowance → rejected
{
  const store = seedStore();
  seedUser(store, {
    id: "u-p-huge",
    plan: "PREMIUM",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
  });
  const client = buildStubClient(store);
  const r = await reserveAndCreateJob(
    {
      userId: "u-p-huge",
      isAdmin: true,
      requestedMinutes: 201,
      jobData: jobData("u-p-huge"),
      now: insidePeriod,
    },
    client
  );
  check("PREMIUM 0+201: ok=false", r.ok, false);
  if (!r.ok)
    check("PREMIUM 0+201: error=INSUFFICIENT_MINUTES", r.error, "INSUFFICIENT_MINUTES");
  check("PREMIUM 0+201: no PeriodUsage created", store.periodUsages.size, 0);
  check("PREMIUM 0+201: no Job created", store.jobs.size, 0);
}

// (16) STARTER at exact cap (80+1 rejected). Reservation must not touch
// PeriodUsage or the Job, must preserve minutesUsed at 0.
{
  const store = seedStore();
  seedUser(store, {
    id: "u-s80",
    plan: "STARTER",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
  });
  store.periodUsages.set(pukey("u-s80", periodStart), {
    userId: "u-s80",
    periodStart,
    periodEnd,
    minutesReserved: 80,
    minutesUsed: 0,
  });
  const client = buildStubClient(store);
  const r = await reserveAndCreateJob(
    {
      userId: "u-s80",
      isAdmin: true,
      requestedMinutes: 1,
      jobData: jobData("u-s80"),
      now: insidePeriod,
    },
    client
  );
  check("STARTER 80+1: ok=false", r.ok, false);
  if (!r.ok)
    check("STARTER 80+1: error=INSUFFICIENT_MINUTES", r.error, "INSUFFICIENT_MINUTES");
  const pu = store.periodUsages.get(pukey("u-s80", periodStart));
  check("STARTER 80+1: minutesReserved unchanged", pu?.minutesReserved, 80);
  check("STARTER 80+1: minutesUsed still 0", pu?.minutesUsed, 0);
  check("STARTER 80+1: no Job created", store.jobs.size, 0);
}

// (17) Concurrent reservations near the cap cannot exceed allowance.
// Two PREMIUM reservations of 150 each against a pre-seeded PeriodUsage:
// one must succeed (raising the total to 150), the other must be rejected
// (150+150 would overshoot 200). The stub's updateMany models the
// row-level atomicity of Postgres READ COMMITTED.
{
  const store = seedStore();
  seedUser(store, {
    id: "u-conc",
    plan: "PREMIUM",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
  });
  store.periodUsages.set(pukey("u-conc", periodStart), {
    userId: "u-conc",
    periodStart,
    periodEnd,
    minutesReserved: 0,
    minutesUsed: 0,
  });
  const client = buildStubClient(store);
  const results = await Promise.all([
    reserveAndCreateJob(
      {
        userId: "u-conc",
        isAdmin: true,
        requestedMinutes: 150,
        jobData: jobData("u-conc"),
        now: insidePeriod,
      },
      client
    ),
    reserveAndCreateJob(
      {
        userId: "u-conc",
        isAdmin: true,
        requestedMinutes: 150,
        jobData: jobData("u-conc"),
        now: insidePeriod,
      },
      client
    ),
  ]);
  const okCount = results.filter((r) => r.ok).length;
  const rejectedCount = results.filter(
    (r) => !r.ok && r.error === "INSUFFICIENT_MINUTES"
  ).length;
  check("Concurrent 150+150: one succeeded", okCount, 1);
  check("Concurrent 150+150: one rejected", rejectedCount, 1);
  const pu = store.periodUsages.get(pukey("u-conc", periodStart));
  check(
    "Concurrent 150+150: minutesReserved never exceeds allowance",
    (pu?.minutesReserved ?? 0) <= 200,
    true
  );
  check(
    "Concurrent 150+150: minutesReserved is exactly 150",
    pu?.minutesReserved,
    150
  );
  check("Concurrent 150+150: only one Job created", store.jobs.size, 1);
}

// (18) Concurrent reservations that both fit — both must succeed and sum
// correctly. Guards against over-aggressive rejection.
{
  const store = seedStore();
  seedUser(store, {
    id: "u-both",
    plan: "PREMIUM",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
  });
  store.periodUsages.set(pukey("u-both", periodStart), {
    userId: "u-both",
    periodStart,
    periodEnd,
    minutesReserved: 0,
    minutesUsed: 0,
  });
  const client = buildStubClient(store);
  const results = await Promise.all([
    reserveAndCreateJob(
      {
        userId: "u-both",
        isAdmin: true,
        requestedMinutes: 90,
        jobData: jobData("u-both"),
        now: insidePeriod,
      },
      client
    ),
    reserveAndCreateJob(
      {
        userId: "u-both",
        isAdmin: true,
        requestedMinutes: 60,
        jobData: jobData("u-both"),
        now: insidePeriod,
      },
      client
    ),
  ]);
  check(
    "Concurrent 90+60 (fits): both succeeded",
    results.every((r) => r.ok),
    true
  );
  const pu = store.periodUsages.get(pukey("u-both", periodStart));
  check("Concurrent 90+60: minutesReserved=150", pu?.minutesReserved, 150);
  check("Concurrent 90+60: two Jobs created", store.jobs.size, 2);
}

// (19) Failed reservation must not leak side effects: transaction rollback
// undoes any partial write, so the final store must match the pre-call
// state exactly.
{
  const store = seedStore();
  seedUser(store, {
    id: "u-rb",
    plan: "STARTER",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
  });
  store.periodUsages.set(pukey("u-rb", periodStart), {
    userId: "u-rb",
    periodStart,
    periodEnd,
    minutesReserved: 75,
    minutesUsed: 0,
  });
  const before = {
    periodUsage: { ...store.periodUsages.get(pukey("u-rb", periodStart))! },
    jobs: store.jobs.size,
  };
  const client = buildStubClient(store);
  const r = await reserveAndCreateJob(
    {
      userId: "u-rb",
      isAdmin: true,
      requestedMinutes: 10,
      jobData: jobData("u-rb"),
      now: insidePeriod,
    },
    client
  );
  check("Rollback: ok=false", r.ok, false);
  const after = store.periodUsages.get(pukey("u-rb", periodStart));
  check(
    "Rollback: minutesReserved unchanged (75)",
    after?.minutesReserved,
    before.periodUsage.minutesReserved
  );
  check(
    "Rollback: minutesUsed unchanged (0)",
    after?.minutesUsed,
    before.periodUsage.minutesUsed
  );
  check("Rollback: jobs count unchanged", store.jobs.size, before.jobs);
  check("Rollback: no PLAN_MINUTES Jobs left", store.jobs.size, 0);
}

// ---------------------------------------------------------------------------
// Common transaction — credit debit + reservation + Job.create are atomic
// ---------------------------------------------------------------------------

// (20) NO_CREDITS: non-admin user with zero credits gets NO_CREDITS from the
// atomic credit gate. No reservation, no Job, credits stay at 0.
{
  const store = seedStore();
  seedUser(store, {
    id: "u-nc",
    plan: "STARTER",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
    credits: 0,
  });
  const client = buildStubClient(store);
  const r = await reserveAndCreateJob(
    {
      userId: "u-nc",
      isAdmin: false,
      requestedMinutes: 5,
      jobData: jobData("u-nc"),
      now: insidePeriod,
    },
    client
  );
  check("NO_CREDITS: ok=false", r.ok, false);
  if (!r.ok) check("NO_CREDITS: error=NO_CREDITS", r.error, "NO_CREDITS");
  check("NO_CREDITS: no Job created", store.jobs.size, 0);
  check("NO_CREDITS: no PeriodUsage created", store.periodUsages.size, 0);
  check("NO_CREDITS: credits still 0", store.users.get("u-nc")?.credits, 0);
}

// (21) INSUFFICIENT_MINUTES on paid user rolls the credit debit back.
// Pre-condition: user has 3 credits and STARTER at 79/80. Request 2 minutes.
// Expected: credits unchanged (3), minutesReserved unchanged (79), no Job.
{
  const store = seedStore();
  seedUser(store, {
    id: "u-imr",
    plan: "STARTER",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
    credits: 3,
  });
  store.periodUsages.set(pukey("u-imr", periodStart), {
    userId: "u-imr",
    periodStart,
    periodEnd,
    minutesReserved: 79,
    minutesUsed: 0,
  });
  const client = buildStubClient(store);
  const r = await reserveAndCreateJob(
    {
      userId: "u-imr",
      isAdmin: false,
      requestedMinutes: 2,
      jobData: jobData("u-imr"),
      now: insidePeriod,
    },
    client
  );
  check("INSUFFICIENT_MINUTES+credit rb: ok=false", r.ok, false);
  if (!r.ok)
    check(
      "INSUFFICIENT_MINUTES+credit rb: error=INSUFFICIENT_MINUTES",
      r.error,
      "INSUFFICIENT_MINUTES"
    );
  check(
    "INSUFFICIENT_MINUTES+credit rb: credits still 3",
    store.users.get("u-imr")?.credits,
    3
  );
  check(
    "INSUFFICIENT_MINUTES+credit rb: minutesReserved still 79",
    store.periodUsages.get(pukey("u-imr", periodStart))?.minutesReserved,
    79
  );
  check("INSUFFICIENT_MINUTES+credit rb: no Job", store.jobs.size, 0);
}

// (22) Happy path: non-admin STARTER debits exactly one credit, reserves,
// and creates one Job.
{
  const store = seedStore();
  seedUser(store, {
    id: "u-happy",
    plan: "STARTER",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
    credits: 5,
  });
  const client = buildStubClient(store);
  const r = await reserveAndCreateJob(
    {
      userId: "u-happy",
      isAdmin: false,
      requestedMinutes: 10,
      jobData: jobData("u-happy"),
      now: insidePeriod,
    },
    client
  );
  check("Happy: ok=true", r.ok, true);
  check("Happy: credits debited by 1", store.users.get("u-happy")?.credits, 4);
  const pu = store.periodUsages.get(pukey("u-happy", periodStart));
  check("Happy: minutesReserved=10", pu?.minutesReserved, 10);
  check("Happy: one Job", store.jobs.size, 1);
  const job = Array.from(store.jobs.values())[0];
  check("Happy: Job tagged PLAN_MINUTES", job.entitlementKind, "PLAN_MINUTES");
  check("Happy: Job.reservedMinutes=10", job.reservedMinutes, 10);
}

// (23) Job.create failure rolls credit + PeriodUsage back.
{
  const store = seedStore();
  seedUser(store, {
    id: "u-jce",
    plan: "STARTER",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
    credits: 5,
  });
  store.injectJobCreateErrorOnce = new Error("job create boom");
  const client = buildStubClient(store);
  let threw = false;
  try {
    await reserveAndCreateJob(
      {
        userId: "u-jce",
        isAdmin: false,
        requestedMinutes: 10,
        jobData: jobData("u-jce"),
        now: insidePeriod,
      },
      client
    );
  } catch {
    threw = true;
  }
  check("Job.create error: exception propagated", threw, true);
  check(
    "Job.create error: credits rolled back to 5",
    store.users.get("u-jce")?.credits,
    5
  );
  check(
    "Job.create error: no PeriodUsage",
    store.periodUsages.size,
    0
  );
  check("Job.create error: no Job", store.jobs.size, 0);
}

// (24) PeriodUsage update failure rolls credit back, no Job.
{
  const store = seedStore();
  seedUser(store, {
    id: "u-puue",
    plan: "STARTER",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
    credits: 5,
  });
  store.periodUsages.set(pukey("u-puue", periodStart), {
    userId: "u-puue",
    periodStart,
    periodEnd,
    minutesReserved: 10,
    minutesUsed: 0,
  });
  store.injectPeriodUsageUpdateErrorOnce = new Error("update boom");
  const client = buildStubClient(store);
  let threw = false;
  try {
    await reserveAndCreateJob(
      {
        userId: "u-puue",
        isAdmin: false,
        requestedMinutes: 5,
        jobData: jobData("u-puue"),
        now: insidePeriod,
      },
      client
    );
  } catch {
    threw = true;
  }
  check("PeriodUsage.update error: exception propagated", threw, true);
  check(
    "PeriodUsage.update error: credits rolled back to 5",
    store.users.get("u-puue")?.credits,
    5
  );
  check(
    "PeriodUsage.update error: minutesReserved unchanged (10)",
    store.periodUsages.get(pukey("u-puue", periodStart))?.minutesReserved,
    10
  );
  check("PeriodUsage.update error: no Job", store.jobs.size, 0);
}

// (25) FREE (non-admin) still requires and debits a credit — reservation is
// skipped but the shared credit debit still fires.
{
  const store = seedStore();
  seedUser(store, {
    id: "u-freec",
    plan: "FREE",
    planPeriodStart: null,
    planPeriodEnd: null,
    credits: 2,
  });
  const client = buildStubClient(store);
  const r = await reserveAndCreateJob(
    {
      userId: "u-freec",
      isAdmin: false,
      requestedMinutes: 10,
      jobData: jobData("u-freec"),
      now: insidePeriod,
    },
    client
  );
  check("FREE+credit: ok=true", r.ok, true);
  check("FREE+credit: credits debited to 1", store.users.get("u-freec")?.credits, 1);
  check("FREE+credit: no PeriodUsage", store.periodUsages.size, 0);
  check("FREE+credit: one Job created", store.jobs.size, 1);
  const job = Array.from(store.jobs.values())[0];
  check("FREE+credit: Job untagged", job.entitlementKind, null);
}

// ---------------------------------------------------------------------------
// First-PeriodUsage-row concurrency — bounded single retry on P2002
// ---------------------------------------------------------------------------

// (26) Two parallel first reservations that both fit. The loser hits P2002
// on the initial create; the outer layer retries exactly once and the
// retry finds the committed row, takes the atomic-increment path. Result:
// both succeed, one PeriodUsage row, correct sum, two Jobs, two credit
// debits (one each).
{
  const store = seedStore();
  seedUser(store, {
    id: "u-firstfit",
    plan: "PREMIUM",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
    credits: 5,
  });
  const client = buildStubClient(store);
  const results = await Promise.all([
    reserveAndCreateJob(
      {
        userId: "u-firstfit",
        isAdmin: false,
        requestedMinutes: 40,
        jobData: jobData("u-firstfit"),
        now: insidePeriod,
      },
      client
    ),
    reserveAndCreateJob(
      {
        userId: "u-firstfit",
        isAdmin: false,
        requestedMinutes: 30,
        jobData: jobData("u-firstfit"),
        now: insidePeriod,
      },
      client
    ),
  ]);
  check(
    "First-race fit: both succeeded",
    results.every((r) => r.ok),
    true
  );
  check(
    "First-race fit: exactly one PeriodUsage row",
    store.periodUsages.size,
    1
  );
  const pu = store.periodUsages.get(pukey("u-firstfit", periodStart));
  check("First-race fit: minutesReserved=70 (40+30)", pu?.minutesReserved, 70);
  check(
    "First-race fit: minutesUsed still 0",
    pu?.minutesUsed,
    0
  );
  check("First-race fit: exactly two Jobs", store.jobs.size, 2);
  check(
    "First-race fit: credits debited twice (5-2=3)",
    store.users.get("u-firstfit")?.credits,
    3
  );
  const jobs = Array.from(store.jobs.values());
  check(
    "First-race fit: both jobs PLAN_MINUTES",
    jobs.every((j) => j.entitlementKind === "PLAN_MINUTES"),
    true
  );
}

// (27) Two parallel first reservations where the second would push past the
// cap. Winner succeeds; loser retries, sees the committed row and gets
// INSUFFICIENT_MINUTES with a full rollback (its credit is restored).
{
  const store = seedStore();
  seedUser(store, {
    id: "u-firstover",
    plan: "PREMIUM",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
    credits: 5,
  });
  const client = buildStubClient(store);
  const results = await Promise.all([
    reserveAndCreateJob(
      {
        userId: "u-firstover",
        isAdmin: false,
        requestedMinutes: 150,
        jobData: jobData("u-firstover"),
        now: insidePeriod,
      },
      client
    ),
    reserveAndCreateJob(
      {
        userId: "u-firstover",
        isAdmin: false,
        requestedMinutes: 100,
        jobData: jobData("u-firstover"),
        now: insidePeriod,
      },
      client
    ),
  ]);
  const okCount = results.filter((r) => r.ok).length;
  const rejectedCount = results.filter(
    (r) => !r.ok && r.error === "INSUFFICIENT_MINUTES"
  ).length;
  check("First-race over: exactly one succeeded", okCount, 1);
  check("First-race over: exactly one rejected", rejectedCount, 1);
  const pu = store.periodUsages.get(pukey("u-firstover", periodStart));
  check(
    "First-race over: minutesReserved never exceeds allowance",
    (pu?.minutesReserved ?? 0) <= 200,
    true
  );
  check(
    "First-race over: total is the winner's amount only",
    pu?.minutesReserved === 150 || pu?.minutesReserved === 100,
    true
  );
  check("First-race over: exactly one Job", store.jobs.size, 1);
  // Loser's credit must be back — one debit committed, one rolled back.
  check(
    "First-race over: credits debited exactly once (5-1=4)",
    store.users.get("u-firstover")?.credits,
    4
  );
}

// (28) Simulated single P2002 on the first create. Verifies the retry path
// commits exactly one credit debit, exactly one reservation, exactly one Job.
{
  const store = seedStore();
  seedUser(store, {
    id: "u-p2002",
    plan: "STARTER",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
    credits: 5,
  });
  store.injectPeriodUsageCreateP2002Once = true;
  const client = buildStubClient(store);
  const r = await reserveAndCreateJob(
    {
      userId: "u-p2002",
      isAdmin: false,
      requestedMinutes: 5,
      jobData: jobData("u-p2002"),
      now: insidePeriod,
    },
    client
  );
  check("Retry: ok=true", r.ok, true);
  if (r.ok) check("Retry: reservation=reserved", r.reservation, "reserved");
  check("Retry: exactly one PeriodUsage row", store.periodUsages.size, 1);
  const pu = store.periodUsages.get(pukey("u-p2002", periodStart));
  // The injected phantom row seeded minutesReserved=0; the retry increments
  // by 5. Net minutesReserved is 5.
  check("Retry: minutesReserved=5", pu?.minutesReserved, 5);
  check("Retry: exactly one Job", store.jobs.size, 1);
  check("Retry: credits debited exactly once (5-1=4)", store.users.get("u-p2002")?.credits, 4);
  check(
    "Retry: injection hook consumed",
    store.injectPeriodUsageCreateP2002Once,
    false
  );
  const retryJob = Array.from(store.jobs.values())[0];
  check(
    "Retry: Job.periodUsageId points at reserved row after retry",
    retryJob.periodUsageId,
    pukey("u-p2002", periodStart)
  );
}

// (29) Persistent P2002 on create → controlled CONCURRENCY_CONFLICT.
// The retry also hits P2002; both transactions roll back completely so
// nothing is committed.
{
  const store = seedStore();
  seedUser(store, {
    id: "u-cc",
    plan: "STARTER",
    planPeriodStart: periodStart,
    planPeriodEnd: periodEnd,
    credits: 5,
  });
  store.injectPeriodUsageCreateP2002Always = true;
  const client = buildStubClient(store);
  const r = await reserveAndCreateJob(
    {
      userId: "u-cc",
      isAdmin: false,
      requestedMinutes: 5,
      jobData: jobData("u-cc"),
      now: insidePeriod,
    },
    client
  );
  check("Persistent P2002: ok=false", r.ok, false);
  if (!r.ok)
    check(
      "Persistent P2002: error=CONCURRENCY_CONFLICT",
      r.error,
      "CONCURRENCY_CONFLICT"
    );
  check(
    "Persistent P2002: no PeriodUsage row",
    store.periodUsages.size,
    0
  );
  check("Persistent P2002: no Job", store.jobs.size, 0);
  check(
    "Persistent P2002: credits fully restored (5)",
    store.users.get("u-cc")?.credits,
    5
  );
}

}

// ---------------------------------------------------------------------------

runReservationTests()
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
