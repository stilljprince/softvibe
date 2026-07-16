// scripts/test-release.ts
//
// Offline tests for the RP-010 Phase 3C Minute Release module.
// Exercises releasePlanMinuteReservation through an in-memory Prisma stub
// that mirrors the transactional and Compare-And-Set semantics of the real
// Postgres path: mutations only commit if the interactive transaction
// callback returns without throwing.
//
// Run with:
//
//   npx tsx scripts/test-release.ts
//
// Covers (numbering follows the Phase 3C task spec):
//
//   Successful release
//     (1) PLAN_MINUTES Job with 10 reserved minutes
//         → PeriodUsage.minutesReserved −10, minutesUsed unchanged,
//           Job.usageReleasedAt set, Job.usageFinalizedAt still null,
//           status FAILED, error persisted
//     (2) Reserved minutes (not actual audio duration) is authoritative
//     (3) STARTER and PREMIUM behave identically w.r.t. the release
//
//   Idempotency
//     (4) Second release call — no second decrement, timestamp preserved
//     (5) Two concurrent release calls — exactly one releases,
//         PeriodUsage moved once
//
//   Finalization-vs-release
//     (6) Already-finalized Job — release refused
//     (7) Parallel finalize and release — exactly one wins,
//         never both timestamps set
//
//   Invalid states
//     (8) Job without reservedMinutes — controlled error, no write
//     (9) Job without periodUsageId — controlled error, no write
//    (10) Missing PeriodUsage row — full rollback
//    (11) minutesReserved < Job.reservedMinutes — controlled underflow,
//         no negative counter, full rollback
//    (12) Injected Job update failure — PeriodUsage change rolls back
//    (13) Injected PeriodUsage update failure — Job stays unreleased
//    (14) Unknown Job id — JOB_NOT_FOUND, no writes anywhere
//
//   Period switch
//    (15) User is now in a new billing period — release still targets
//         the *originally* reserved PeriodUsage row
//
//   Non-plan Jobs
//    (16) Job without PLAN_MINUTES — failure flow works, no PeriodUsage
//         mutation, no usageReleasedAt

import { releasePlanMinuteReservation } from "../lib/entitlement/release";
import { finalizePlanMinuteUsage } from "../lib/entitlement/finalization";
import type { PrismaClient, EntitlementKind } from "@prisma/client";

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
// In-memory Prisma stub
// ---------------------------------------------------------------------------
//
// Models only the surface releasePlanMinuteReservation touches (and, for the
// finalize-vs-release race test, finalizePlanMinuteUsage as well):
//   * $transaction(async (tx) => …) with rollback-on-throw
//   * job.findUnique
//   * job.update
//   * job.updateMany (the CAS claim)
//   * periodUsage.findUnique
//   * periodUsage.updateMany (numeric-bound minutesReserved decrement)
//
// Rollback support is implemented by capturing every mutation into a
// per-transaction WriteLog and unwinding on throw. This mirrors the
// atomic semantics the production Postgres path relies on.

type StoreJob = {
  id: string;
  userId: string;
  status: string;
  resultUrl: string | null;
  durationSec: number | null;
  title: string;
  prompt: string;
  preset: string | null;
  createdAt: Date;
  entitlementKind: EntitlementKind | null;
  reservedMinutes: number | null;
  periodUsageId: string | null;
  usageFinalizedAt: Date | null;
  usageReleasedAt: Date | null;
  error: string | null;
  // RP-010 Phase 3C atomicity fields — the release helper reads both and,
  // when refundCreditIfEligible is set, claims creditRefundedAt inside the
  // same transaction as the FAILED / minute-release writes.
  ttsStartedAt: Date | null;
  creditRefundedAt: Date | null;
};

type StorePeriodUsage = {
  id: string;
  userId: string;
  periodStart: Date;
  periodEnd: Date;
  minutesReserved: number;
  minutesUsed: number;
};

type StoreUser = {
  id: string;
  credits: number;
};

type Store = {
  jobs: Map<string, StoreJob>;
  periodUsages: Map<string, StorePeriodUsage>;
  users: Map<string, StoreUser>;
  // Injection hooks. Each is consumed on the next matching call.
  injectJobUpdateManyErrorOnce?: Error;
  injectJobUpdateErrorOnce?: Error;
  injectPeriodUsageUpdateErrorOnce?: Error;
  injectUserUpdateErrorOnce?: Error;
};

type WriteOp =
  | { kind: "job.set"; jobId: string; prev: StoreJob }
  | { kind: "pu.set"; puId: string; prev: StorePeriodUsage }
  | { kind: "user.set"; userId: string; prev: StoreUser };

function snap(job: StoreJob): StoreJob {
  return { ...job };
}
function snapPu(pu: StorePeriodUsage): StorePeriodUsage {
  return { ...pu };
}
function snapUser(u: StoreUser): StoreUser {
  return { ...u };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTxOps(store: Store, writes: WriteOp[]) {
  return {
    job: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where, select: _select }: any) => {
        const j = store.jobs.get(where.id);
        if (!j) return null;
        return { ...j };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: async ({ where, data, select: _select }: any) => {
        if (store.injectJobUpdateErrorOnce) {
          const err = store.injectJobUpdateErrorOnce;
          store.injectJobUpdateErrorOnce = undefined;
          throw err;
        }
        const j = store.jobs.get(where.id);
        if (!j) throw new Error("job not found (stub)");
        writes.push({ kind: "job.set", jobId: j.id, prev: snap(j) });
        if (data.status !== undefined) j.status = data.status;
        if (data.resultUrl !== undefined) j.resultUrl = data.resultUrl;
        if (data.error !== undefined) j.error = data.error;
        if (data.usageFinalizedAt !== undefined)
          j.usageFinalizedAt = data.usageFinalizedAt;
        if (data.usageReleasedAt !== undefined)
          j.usageReleasedAt = data.usageReleasedAt;
        return { ...j };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateMany: async ({ where, data }: any) => {
        if (store.injectJobUpdateManyErrorOnce) {
          const err = store.injectJobUpdateManyErrorOnce;
          store.injectJobUpdateManyErrorOnce = undefined;
          throw err;
        }
        const j = store.jobs.get(where.id);
        if (!j) return { count: 0 };
        // WHERE guard — mirrors the CAS-claim in release.ts / finalization.ts.
        if (where.entitlementKind && j.entitlementKind !== where.entitlementKind) {
          return { count: 0 };
        }
        if (where.usageFinalizedAt === null && j.usageFinalizedAt !== null) {
          return { count: 0 };
        }
        if (where.usageReleasedAt === null && j.usageReleasedAt !== null) {
          return { count: 0 };
        }
        if (where.creditRefundedAt === null && j.creditRefundedAt !== null) {
          return { count: 0 };
        }
        if (where.ttsStartedAt === null && j.ttsStartedAt !== null) {
          return { count: 0 };
        }
        if (
          where.reservedMinutes &&
          typeof where.reservedMinutes.gt === "number" &&
          (j.reservedMinutes ?? 0) <= where.reservedMinutes.gt
        ) {
          return { count: 0 };
        }
        if (
          where.periodUsageId !== undefined &&
          j.periodUsageId !== where.periodUsageId
        ) {
          return { count: 0 };
        }
        writes.push({ kind: "job.set", jobId: j.id, prev: snap(j) });
        if (data.status !== undefined) j.status = data.status;
        if (data.resultUrl !== undefined) j.resultUrl = data.resultUrl;
        if (data.error !== undefined) j.error = data.error;
        if (data.usageFinalizedAt !== undefined)
          j.usageFinalizedAt = data.usageFinalizedAt;
        if (data.usageReleasedAt !== undefined)
          j.usageReleasedAt = data.usageReleasedAt;
        if (data.creditRefundedAt !== undefined)
          j.creditRefundedAt = data.creditRefundedAt;
        return { count: 1 };
      },
    },
    user: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: async ({ where, data }: any) => {
        if (store.injectUserUpdateErrorOnce) {
          const err = store.injectUserUpdateErrorOnce;
          store.injectUserUpdateErrorOnce = undefined;
          throw err;
        }
        const u = store.users.get(where.id);
        if (!u) throw new Error("user not found (stub)");
        writes.push({ kind: "user.set", userId: u.id, prev: snapUser(u) });
        if (data.credits) {
          if ("increment" in data.credits) {
            u.credits += data.credits.increment;
          } else if ("decrement" in data.credits) {
            u.credits -= data.credits.decrement;
          }
        }
        return { ...u };
      },
    },
    periodUsage: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        const pu = store.periodUsages.get(where.id);
        if (!pu) return null;
        return { ...pu };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateMany: async ({ where, data }: any) => {
        if (store.injectPeriodUsageUpdateErrorOnce) {
          const err = store.injectPeriodUsageUpdateErrorOnce;
          store.injectPeriodUsageUpdateErrorOnce = undefined;
          throw err;
        }
        const pu = store.periodUsages.get(where.id);
        if (!pu) return { count: 0 };
        // Numeric-bound guard — mirrors "minutesReserved >= amount" in
        // release.ts. Prevents negative counters at the DB layer.
        if (
          where.minutesReserved &&
          typeof where.minutesReserved.gte === "number" &&
          pu.minutesReserved < where.minutesReserved.gte
        ) {
          return { count: 0 };
        }
        writes.push({ kind: "pu.set", puId: pu.id, prev: snapPu(pu) });
        if (data.minutesReserved) {
          if ("decrement" in data.minutesReserved) {
            pu.minutesReserved -= data.minutesReserved.decrement;
          } else if ("increment" in data.minutesReserved) {
            pu.minutesReserved += data.minutesReserved.increment;
          }
        }
        if (data.minutesUsed) {
          if ("increment" in data.minutesUsed) {
            pu.minutesUsed += data.minutesUsed.increment;
          } else if ("decrement" in data.minutesUsed) {
            pu.minutesUsed -= data.minutesUsed.decrement;
          }
        }
        return { count: 1 };
      },
    },
  };
}

function rollback(store: Store, writes: WriteOp[]): void {
  // Unwind in reverse order so nested claim/transfer sequences unwind
  // cleanly. Each entry restored to its pre-mutation snapshot.
  for (let i = writes.length - 1; i >= 0; i--) {
    const w = writes[i];
    if (w.kind === "job.set") {
      store.jobs.set(w.jobId, w.prev);
    } else if (w.kind === "pu.set") {
      store.periodUsages.set(w.puId, w.prev);
    } else if (w.kind === "user.set") {
      store.users.set(w.userId, w.prev);
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
    jobs: new Map<string, StoreJob>(),
    periodUsages: new Map<string, StorePeriodUsage>(),
    users: new Map<string, StoreUser>(),
  };
}

function makeUser(
  store: Store,
  overrides: { id: string; credits?: number }
): StoreUser {
  const u: StoreUser = {
    id: overrides.id,
    credits: overrides.credits ?? 0,
  };
  store.users.set(u.id, u);
  return u;
}

const now0 = new Date("2026-07-15T12:00:00.000Z");
const period1Start = new Date("2026-07-01T00:00:00.000Z");
const period1End = new Date("2026-08-01T00:00:00.000Z");
const period2Start = new Date("2026-08-01T00:00:00.000Z");
const period2End = new Date("2026-09-01T00:00:00.000Z");

function makePeriodUsage(
  store: Store,
  overrides: Partial<StorePeriodUsage> & { id: string; userId: string }
): StorePeriodUsage {
  const pu: StorePeriodUsage = {
    id: overrides.id,
    userId: overrides.userId,
    periodStart: overrides.periodStart ?? period1Start,
    periodEnd: overrides.periodEnd ?? period1End,
    minutesReserved: overrides.minutesReserved ?? 0,
    minutesUsed: overrides.minutesUsed ?? 0,
  };
  store.periodUsages.set(pu.id, pu);
  return pu;
}

function makeJob(
  store: Store,
  overrides: Partial<StoreJob> & { id: string; userId: string }
): StoreJob {
  const j: StoreJob = {
    id: overrides.id,
    userId: overrides.userId,
    status: overrides.status ?? "PROCESSING",
    resultUrl: overrides.resultUrl ?? null,
    durationSec: overrides.durationSec ?? 600,
    title: overrides.title ?? "Test Job",
    prompt: overrides.prompt ?? "Some prompt",
    preset: overrides.preset ?? "sleep-story",
    createdAt: overrides.createdAt ?? now0,
    entitlementKind: overrides.entitlementKind ?? null,
    reservedMinutes: overrides.reservedMinutes ?? null,
    periodUsageId: overrides.periodUsageId ?? null,
    usageFinalizedAt: overrides.usageFinalizedAt ?? null,
    usageReleasedAt: overrides.usageReleasedAt ?? null,
    error: overrides.error ?? null,
    ttsStartedAt: overrides.ttsStartedAt ?? null,
    creditRefundedAt: overrides.creditRefundedAt ?? null,
  };
  store.jobs.set(j.id, j);
  return j;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests(): Promise<void> {

// (1) Happy path: PLAN_MINUTES Job with 10 reserved minutes on a
// pre-seeded PeriodUsage of (reserved=35, used=10) — spec's canonical
// example — must land at reserved=25, used=10 (unchanged).
// usageReleasedAt set, usageFinalizedAt still null, Job status=FAILED,
// error persisted.
{
  const store = seedStore();
  makePeriodUsage(store, {
    id: "pu-1",
    userId: "u1",
    minutesReserved: 35,
    minutesUsed: 10,
  });
  makeJob(store, {
    id: "job-1",
    userId: "u1",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 10,
    periodUsageId: "pu-1",
  });
  const client = buildStubClient(store);
  const t = new Date("2026-07-15T12:34:56.000Z");
  const r = await releasePlanMinuteReservation(
    { jobId: "job-1", error: "boom", now: t },
    client
  );
  check("Happy: ok=true", r.ok, true);
  if (r.ok) {
    check("Happy: outcome=released", r.outcome, "released");
    check("Happy: job.status=FAILED", r.job.status, "FAILED");
    check("Happy: job.error persisted", r.job.error, "boom");
    check(
      "Happy: job.usageReleasedAt returned",
      r.job.usageReleasedAt?.getTime(),
      t.getTime()
    );
    check("Happy: job.usageFinalizedAt still null", r.job.usageFinalizedAt, null);
  }
  const pu = store.periodUsages.get("pu-1");
  check("Happy: minutesReserved 35 → 25", pu?.minutesReserved, 25);
  check("Happy: minutesUsed unchanged at 10", pu?.minutesUsed, 10);
  const j = store.jobs.get("job-1");
  check("Happy: usageReleasedAt set", j?.usageReleasedAt?.getTime(), t.getTime());
  check("Happy: usageFinalizedAt still null", j?.usageFinalizedAt, null);
  check("Happy: job.status persisted as FAILED", j?.status, "FAILED");
  check("Happy: job.error persisted", j?.error, "boom");
}

// (2) Reserved minutes (not actual audio duration) is authoritative.
// A 20-minute reserved Job returns 20 regardless of any other value
// the caller might submit. The release function does not accept a
// duration parameter — this test asserts the API surface itself.
{
  const store = seedStore();
  makePeriodUsage(store, {
    id: "pu-2",
    userId: "u2",
    minutesReserved: 25,
    minutesUsed: 3,
  });
  makeJob(store, {
    id: "job-2",
    userId: "u2",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 20,
    periodUsageId: "pu-2",
    // Even though the audio actually rendered at 5 seconds:
    durationSec: 5,
  });
  const client = buildStubClient(store);
  await releasePlanMinuteReservation(
    { jobId: "job-2", error: null },
    client
  );
  const pu = store.periodUsages.get("pu-2");
  check(
    "Reserved-minutes authoritative: minutesReserved 25 → 5 (−20, not −1 from 5s)",
    pu?.minutesReserved,
    5
  );
  check(
    "Reserved-minutes authoritative: minutesUsed unchanged (never touched)",
    pu?.minutesUsed,
    3
  );
}

// (3) STARTER and PREMIUM behave identically w.r.t. the release. The
// release function is plan-agnostic; the test seeds two PeriodUsage
// rows with different totals and verifies both give back their Job's
// reservedMinutes cleanly with minutesUsed left untouched.
{
  const store = seedStore();
  makePeriodUsage(store, {
    id: "pu-s",
    userId: "us",
    minutesReserved: 80,
    minutesUsed: 5,
  });
  makePeriodUsage(store, {
    id: "pu-p",
    userId: "up",
    minutesReserved: 200,
    minutesUsed: 12,
  });
  makeJob(store, {
    id: "job-s",
    userId: "us",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 12,
    periodUsageId: "pu-s",
  });
  makeJob(store, {
    id: "job-p",
    userId: "up",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 45,
    periodUsageId: "pu-p",
  });
  const client = buildStubClient(store);
  await releasePlanMinuteReservation({ jobId: "job-s", error: "s-fail" }, client);
  await releasePlanMinuteReservation({ jobId: "job-p", error: "p-fail" }, client);
  const pus = store.periodUsages.get("pu-s");
  const pup = store.periodUsages.get("pu-p");
  check("STARTER release: reserved 80 → 68", pus?.minutesReserved, 68);
  check("STARTER release: used unchanged at 5", pus?.minutesUsed, 5);
  check("PREMIUM release: reserved 200 → 155", pup?.minutesReserved, 155);
  check("PREMIUM release: used unchanged at 12", pup?.minutesUsed, 12);
}

// (4) Idempotency: second release is a no-op — no second decrement,
// usageReleasedAt timestamp preserved (not overwritten by later call).
{
  const store = seedStore();
  makePeriodUsage(store, {
    id: "pu-4",
    userId: "u4",
    minutesReserved: 15,
    minutesUsed: 0,
  });
  makeJob(store, {
    id: "job-4",
    userId: "u4",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 5,
    periodUsageId: "pu-4",
  });
  const client = buildStubClient(store);
  const t1 = new Date("2026-07-15T13:00:00.000Z");
  const t2 = new Date("2026-07-15T14:00:00.000Z");
  const r1 = await releasePlanMinuteReservation(
    { jobId: "job-4", error: "first", now: t1 },
    client
  );
  const r2 = await releasePlanMinuteReservation(
    { jobId: "job-4", error: "second", now: t2 },
    client
  );
  check("Idempotent: first ok=true", r1.ok, true);
  check("Idempotent: second ok=true", r2.ok, true);
  if (r2.ok) {
    check("Idempotent: second outcome=already_released", r2.outcome, "already_released");
  }
  const pu = store.periodUsages.get("pu-4");
  check("Idempotent: minutesReserved=10 (only released once)", pu?.minutesReserved, 10);
  check("Idempotent: minutesUsed unchanged at 0", pu?.minutesUsed, 0);
  const j = store.jobs.get("job-4");
  check(
    "Idempotent: usageReleasedAt still t1 (not overwritten by t2)",
    j?.usageReleasedAt?.getTime(),
    t1.getTime()
  );
  check(
    "Idempotent: error still 'first' (second call did not overwrite)",
    j?.error,
    "first"
  );
}

// (5) Concurrent release: only one wins the CAS claim; usage moves once.
{
  const store = seedStore();
  makePeriodUsage(store, {
    id: "pu-5",
    userId: "u5",
    minutesReserved: 30,
    minutesUsed: 4,
  });
  makeJob(store, {
    id: "job-5",
    userId: "u5",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 10,
    periodUsageId: "pu-5",
  });
  const client = buildStubClient(store);
  const [r1, r2] = await Promise.all([
    releasePlanMinuteReservation(
      { jobId: "job-5", error: "A" },
      client
    ),
    releasePlanMinuteReservation(
      { jobId: "job-5", error: "B" },
      client
    ),
  ]);
  check("Concurrent: both ok=true", r1.ok && r2.ok, true);
  const releasedCount =
    (r1.ok && r1.outcome === "released" ? 1 : 0) +
    (r2.ok && r2.outcome === "released" ? 1 : 0);
  const idempotentCount =
    (r1.ok && r1.outcome === "already_released" ? 1 : 0) +
    (r2.ok && r2.outcome === "already_released" ? 1 : 0);
  check("Concurrent: exactly one release won", releasedCount, 1);
  check("Concurrent: exactly one no-op response", idempotentCount, 1);
  const pu = store.periodUsages.get("pu-5");
  check("Concurrent: minutesReserved 30 → 20 (single release)", pu?.minutesReserved, 20);
  check("Concurrent: minutesUsed unchanged at 4", pu?.minutesUsed, 4);
}

// (6) Already-finalized Job — release must refuse.
{
  const store = seedStore();
  makePeriodUsage(store, {
    id: "pu-6",
    userId: "u6",
    minutesReserved: 5,
    minutesUsed: 5,
  });
  const preFinal = new Date("2026-07-15T10:00:00.000Z");
  makeJob(store, {
    id: "job-6",
    userId: "u6",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 5,
    periodUsageId: "pu-6",
    usageFinalizedAt: preFinal,
    status: "DONE",
  });
  const client = buildStubClient(store);
  const r = await releasePlanMinuteReservation(
    { jobId: "job-6", error: "should-not-happen" },
    client
  );
  check("Finalized: ok=false", r.ok, false);
  if (!r.ok) check("Finalized: error=ALREADY_FINALIZED", r.error, "ALREADY_FINALIZED");
  const pu = store.periodUsages.get("pu-6");
  check("Finalized: minutesReserved unchanged (5)", pu?.minutesReserved, 5);
  check("Finalized: minutesUsed unchanged (5)", pu?.minutesUsed, 5);
  const j = store.jobs.get("job-6");
  check("Finalized: usageReleasedAt still null", j?.usageReleasedAt, null);
  check(
    "Finalized: usageFinalizedAt preserved",
    j?.usageFinalizedAt?.getTime(),
    preFinal.getTime()
  );
  check("Finalized: status still DONE", j?.status, "DONE");
}

// (7) Parallel finalize and release — exactly one wins, never both
// timestamps set. Runs finalizePlanMinuteUsage and
// releasePlanMinuteReservation concurrently on the same Job.
{
  const store = seedStore();
  makePeriodUsage(store, {
    id: "pu-7",
    userId: "u7",
    minutesReserved: 12,
    minutesUsed: 0,
  });
  makeJob(store, {
    id: "job-7",
    userId: "u7",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 6,
    periodUsageId: "pu-7",
  });
  const client = buildStubClient(store);
  const [finRes, relRes] = await Promise.all([
    finalizePlanMinuteUsage(
      { jobId: "job-7", finalJobData: { resultUrl: "/audio/7" } },
      client
    ),
    releasePlanMinuteReservation({ jobId: "job-7", error: "race" }, client),
  ]);
  const j = store.jobs.get("job-7");
  const bothSet = !!j?.usageFinalizedAt && !!j?.usageReleasedAt;
  check("Race: never both timestamps set", bothSet, false);
  const eitherSet = !!j?.usageFinalizedAt || !!j?.usageReleasedAt;
  check("Race: at least one timestamp set", eitherSet, true);
  // Exactly one operation succeeded in moving usage.
  const finalizedOk = finRes.ok && finRes.outcome === "finalized";
  const releasedOk = relRes.ok && relRes.outcome === "released";
  const successCount = (finalizedOk ? 1 : 0) + (releasedOk ? 1 : 0);
  check("Race: exactly one authoritative success", successCount, 1);
  const pu = store.periodUsages.get("pu-7");
  if (finalizedOk) {
    check("Race (finalize won): reserved 12 → 6", pu?.minutesReserved, 6);
    check("Race (finalize won): used 0 → 6", pu?.minutesUsed, 6);
    check("Race (finalize won): status=DONE", j?.status, "DONE");
  } else if (releasedOk) {
    check("Race (release won): reserved 12 → 6", pu?.minutesReserved, 6);
    check("Race (release won): used unchanged at 0", pu?.minutesUsed, 0);
    check("Race (release won): status=FAILED", j?.status, "FAILED");
  }
}

// (8) PLAN_MINUTES tagged Job with reservedMinutes = null (structural bug).
// Controlled error, no write.
{
  const store = seedStore();
  makePeriodUsage(store, {
    id: "pu-8",
    userId: "u8",
    minutesReserved: 10,
    minutesUsed: 0,
  });
  makeJob(store, {
    id: "job-8",
    userId: "u8",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: null,
    periodUsageId: "pu-8",
  });
  const client = buildStubClient(store);
  const r = await releasePlanMinuteReservation(
    { jobId: "job-8", error: "x" },
    client
  );
  check("Missing reservedMinutes: ok=false", r.ok, false);
  if (!r.ok)
    check(
      "Missing reservedMinutes: error=MISSING_RESERVATION",
      r.error,
      "MISSING_RESERVATION"
    );
  const pu = store.periodUsages.get("pu-8");
  check("Missing reservedMinutes: minutesReserved unchanged", pu?.minutesReserved, 10);
  const j = store.jobs.get("job-8");
  check("Missing reservedMinutes: not FAILED", j?.status, "PROCESSING");
  check("Missing reservedMinutes: usageReleasedAt still null", j?.usageReleasedAt, null);
}

// (9) PLAN_MINUTES tagged Job with periodUsageId = null.
// Controlled error, no write.
{
  const store = seedStore();
  makePeriodUsage(store, {
    id: "pu-9",
    userId: "u9",
    minutesReserved: 10,
    minutesUsed: 0,
  });
  makeJob(store, {
    id: "job-9",
    userId: "u9",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 5,
    periodUsageId: null,
  });
  const client = buildStubClient(store);
  const r = await releasePlanMinuteReservation(
    { jobId: "job-9", error: "y" },
    client
  );
  check("Missing periodUsageId: ok=false", r.ok, false);
  if (!r.ok)
    check(
      "Missing periodUsageId: error=MISSING_RESERVATION",
      r.error,
      "MISSING_RESERVATION"
    );
  const j = store.jobs.get("job-9");
  check("Missing periodUsageId: not FAILED", j?.status, "PROCESSING");
  check("Missing periodUsageId: usageReleasedAt still null", j?.usageReleasedAt, null);
  const pu = store.periodUsages.get("pu-9");
  check("Missing periodUsageId: minutesReserved unchanged", pu?.minutesReserved, 10);
}

// (10) PeriodUsage row missing (deleted or never existed) — rollback.
// The Job.updateMany CAS claim runs first and would set FAILED +
// usageReleasedAt; the PeriodUsage.updateMany then reports zero rows;
// a findUnique proves the row is missing → PERIOD_USAGE_NOT_FOUND and
// the whole tx rolls back so the Job is NOT marked FAILED.
{
  const store = seedStore();
  makeJob(store, {
    id: "job-10",
    userId: "u10",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 5,
    periodUsageId: "pu-missing",
  });
  const client = buildStubClient(store);
  const r = await releasePlanMinuteReservation(
    { jobId: "job-10", error: "z" },
    client
  );
  check("PU missing: ok=false", r.ok, false);
  if (!r.ok)
    check("PU missing: error=PERIOD_USAGE_NOT_FOUND", r.error, "PERIOD_USAGE_NOT_FOUND");
  const j = store.jobs.get("job-10");
  check("PU missing: job status still PROCESSING", j?.status, "PROCESSING");
  check("PU missing: usageReleasedAt still null", j?.usageReleasedAt, null);
  check("PU missing: error still null (rollback)", j?.error, null);
}

// (11) minutesReserved < Job.reservedMinutes — underflow guard fires,
// full rollback, no negative counter.
{
  const store = seedStore();
  makePeriodUsage(store, {
    id: "pu-11",
    userId: "u11",
    minutesReserved: 3,
    minutesUsed: 12,
  });
  makeJob(store, {
    id: "job-11",
    userId: "u11",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 5,
    periodUsageId: "pu-11",
  });
  const client = buildStubClient(store);
  const r = await releasePlanMinuteReservation(
    { jobId: "job-11", error: "under" },
    client
  );
  check("Underflow: ok=false", r.ok, false);
  if (!r.ok)
    check(
      "Underflow: error=RESERVED_MINUTES_UNDERFLOW",
      r.error,
      "RESERVED_MINUTES_UNDERFLOW"
    );
  const pu = store.periodUsages.get("pu-11");
  check("Underflow: minutesReserved unchanged at 3", pu?.minutesReserved, 3);
  check("Underflow: minutesUsed unchanged at 12", pu?.minutesUsed, 12);
  check(
    "Underflow: no negative counter",
    (pu?.minutesReserved ?? 0) >= 0,
    true
  );
  const j = store.jobs.get("job-11");
  check("Underflow: job status still PROCESSING", j?.status, "PROCESSING");
  check("Underflow: usageReleasedAt still null", j?.usageReleasedAt, null);
}

// (12) Injected Job.updateMany (CAS-claim) failure on the PLAN_MINUTES
// path. Any PeriodUsage change must not commit because the Job claim
// happens first and errors out — the outer transaction rolls back and
// nothing is written.
{
  const store = seedStore();
  makePeriodUsage(store, {
    id: "pu-12",
    userId: "u12",
    minutesReserved: 10,
    minutesUsed: 0,
  });
  makeJob(store, {
    id: "job-12",
    userId: "u12",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 3,
    periodUsageId: "pu-12",
  });
  store.injectJobUpdateManyErrorOnce = new Error("job claim boom");
  const client = buildStubClient(store);
  let threw = false;
  try {
    await releasePlanMinuteReservation(
      { jobId: "job-12", error: "x" },
      client
    );
  } catch {
    threw = true;
  }
  check("Injected CAS-claim fail: exception propagated", threw, true);
  const pu = store.periodUsages.get("pu-12");
  check("Injected CAS-claim fail: minutesReserved unchanged", pu?.minutesReserved, 10);
  const j = store.jobs.get("job-12");
  check("Injected CAS-claim fail: not FAILED", j?.status, "PROCESSING");
  check("Injected CAS-claim fail: usageReleasedAt still null", j?.usageReleasedAt, null);
}

// (13) Injected PeriodUsage.updateMany failure — Job claim already
// committed writes in the tx buffer; on the throw the whole tx rolls
// back so the Job stays unreleased.
{
  const store = seedStore();
  makePeriodUsage(store, {
    id: "pu-13",
    userId: "u13",
    minutesReserved: 10,
    minutesUsed: 0,
  });
  makeJob(store, {
    id: "job-13",
    userId: "u13",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 4,
    periodUsageId: "pu-13",
  });
  store.injectPeriodUsageUpdateErrorOnce = new Error("pu update boom");
  const client = buildStubClient(store);
  let threw = false;
  try {
    await releasePlanMinuteReservation(
      { jobId: "job-13", error: "y" },
      client
    );
  } catch {
    threw = true;
  }
  check("Injected pu.updateMany fail: exception propagated", threw, true);
  const pu = store.periodUsages.get("pu-13");
  check("Injected pu.updateMany fail: minutesReserved unchanged", pu?.minutesReserved, 10);
  check("Injected pu.updateMany fail: minutesUsed unchanged", pu?.minutesUsed, 0);
  const j = store.jobs.get("job-13");
  check("Injected pu.updateMany fail: not FAILED", j?.status, "PROCESSING");
  check(
    "Injected pu.updateMany fail: usageReleasedAt still null",
    j?.usageReleasedAt,
    null
  );
  check("Injected pu.updateMany fail: error still null", j?.error, null);
}

// (14) Unknown Job id → JOB_NOT_FOUND, no writes anywhere.
{
  const store = seedStore();
  const client = buildStubClient(store);
  const r = await releasePlanMinuteReservation(
    { jobId: "does-not-exist", error: "x" },
    client
  );
  check("Unknown job: ok=false", r.ok, false);
  if (!r.ok) check("Unknown job: error=JOB_NOT_FOUND", r.error, "JOB_NOT_FOUND");
  check("Unknown job: no jobs created", store.jobs.size, 0);
  check("Unknown job: no PeriodUsage rows created", store.periodUsages.size, 0);
}

// (15) Billing period switch. Reservation belongs to period 1; user has
// since rolled over into period 2. Release must still target the
// *originally* reserved PeriodUsage row (period 1), not the current one.
{
  const store = seedStore();
  makePeriodUsage(store, {
    id: "pu-15-old",
    userId: "u15",
    periodStart: period1Start,
    periodEnd: period1End,
    minutesReserved: 20,
    minutesUsed: 5,
  });
  makePeriodUsage(store, {
    id: "pu-15-new",
    userId: "u15",
    periodStart: period2Start,
    periodEnd: period2End,
    minutesReserved: 0,
    minutesUsed: 0,
  });
  makeJob(store, {
    id: "job-15",
    userId: "u15",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 8,
    periodUsageId: "pu-15-old",
  });
  const client = buildStubClient(store);
  const r = await releasePlanMinuteReservation(
    { jobId: "job-15", error: "period-switch" },
    client
  );
  check("Period switch: ok=true", r.ok, true);
  const puOld = store.periodUsages.get("pu-15-old");
  const puNew = store.periodUsages.get("pu-15-new");
  check("Period switch: old row minutesReserved 20 → 12", puOld?.minutesReserved, 12);
  check("Period switch: old row minutesUsed unchanged at 5", puOld?.minutesUsed, 5);
  check("Period switch: new row minutesReserved untouched", puNew?.minutesReserved, 0);
  check("Period switch: new row minutesUsed untouched", puNew?.minutesUsed, 0);
}

// (16) Non-PLAN_MINUTES Job. Failure flow works: Job persisted as FAILED,
// but no PeriodUsage row is touched (there isn't one) and usageReleasedAt
// remains null. Legacy / FREE / admin / untagged behaviour.
{
  const store = seedStore();
  makeJob(store, {
    id: "job-16",
    userId: "u16",
    entitlementKind: null,
    reservedMinutes: null,
    periodUsageId: null,
  });
  const client = buildStubClient(store);
  const r = await releasePlanMinuteReservation(
    { jobId: "job-16", error: "no-plan" },
    client
  );
  check("Non-plan: ok=true", r.ok, true);
  if (r.ok) {
    check("Non-plan: outcome=no_reservation", r.outcome, "no_reservation");
    check("Non-plan: job.status=FAILED", r.job.status, "FAILED");
    check("Non-plan: job.error persisted", r.job.error, "no-plan");
  }
  const j = store.jobs.get("job-16");
  check("Non-plan: status FAILED persisted", j?.status, "FAILED");
  check("Non-plan: error persisted", j?.error, "no-plan");
  check("Non-plan: usageReleasedAt still null", j?.usageReleasedAt, null);
  check("Non-plan: no PeriodUsage rows created", store.periodUsages.size, 0);
}

// (17) Injected Job.update failure inside the non-PLAN_MINUTES branch.
// The single Job.update throws; the tx rolls back so the Job stays
// PROCESSING (not FAILED).
{
  const store = seedStore();
  makeJob(store, {
    id: "job-17",
    userId: "u17",
    entitlementKind: null,
    reservedMinutes: null,
    periodUsageId: null,
  });
  store.injectJobUpdateErrorOnce = new Error("job update boom");
  const client = buildStubClient(store);
  let threw = false;
  try {
    await releasePlanMinuteReservation(
      { jobId: "job-17", error: "boom" },
      client
    );
  } catch {
    threw = true;
  }
  check("Non-plan injected update fail: exception propagated", threw, true);
  const j = store.jobs.get("job-17");
  check("Non-plan injected update fail: status not FAILED", j?.status, "PROCESSING");
  check("Non-plan injected update fail: error still null", j?.error, null);
}

// ─────────────────────────────────────────────────────────────────────────
// RP-010 Phase 3C atomicity: FAILED + minute release + credit refund
// must commit as a single Prisma transaction. These tests exercise the
// refundCreditIfEligible option added to the release helper.
// ─────────────────────────────────────────────────────────────────────────

// (18) Complete-error before TTS. PLAN_MINUTES Job with 6 reserved minutes,
// ttsStartedAt IS NULL, creditRefundedAt IS NULL. The single helper call
// must: FAIL the job, decrement PeriodUsage.minutesReserved by 6, set
// usageReleasedAt, set creditRefundedAt, and increment User.credits by 1
// — all in the same transaction.
{
  const store = seedStore();
  makeUser(store, { id: "u18", credits: 2 });
  makePeriodUsage(store, {
    id: "pu-18",
    userId: "u18",
    minutesReserved: 20,
    minutesUsed: 4,
  });
  makeJob(store, {
    id: "job-18",
    userId: "u18",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 6,
    periodUsageId: "pu-18",
    ttsStartedAt: null,
    creditRefundedAt: null,
  });
  const client = buildStubClient(store);
  const t = new Date("2026-07-15T15:00:00.000Z");
  const r = await releasePlanMinuteReservation(
    { jobId: "job-18", error: "empty script", now: t, refundCreditIfEligible: true },
    client
  );
  check("Atomic pre-TTS: ok=true", r.ok, true);
  if (r.ok) {
    check("Atomic pre-TTS: outcome=released", r.outcome, "released");
    check("Atomic pre-TTS: creditRefunded=true", r.creditRefunded, true);
  }
  const pu = store.periodUsages.get("pu-18");
  check("Atomic pre-TTS: minutesReserved 20 → 14", pu?.minutesReserved, 14);
  check("Atomic pre-TTS: minutesUsed unchanged at 4", pu?.minutesUsed, 4);
  const j = store.jobs.get("job-18");
  check("Atomic pre-TTS: job.status=FAILED", j?.status, "FAILED");
  check("Atomic pre-TTS: usageReleasedAt set", j?.usageReleasedAt?.getTime(), t.getTime());
  check("Atomic pre-TTS: creditRefundedAt set", j?.creditRefundedAt?.getTime(), t.getTime());
  const u = store.users.get("u18");
  check("Atomic pre-TTS: User.credits 2 → 3 (refund applied)", u?.credits, 3);
}

// (19) Complete-error after TTS. PLAN_MINUTES Job with ttsStartedAt set.
// Minutes must still be released (audio was requested but the render
// failed); credit must NOT be refunded (compute cost was already
// incurred). creditRefundedAt stays null.
{
  const store = seedStore();
  makeUser(store, { id: "u19", credits: 1 });
  makePeriodUsage(store, {
    id: "pu-19",
    userId: "u19",
    minutesReserved: 15,
    minutesUsed: 0,
  });
  const ttsAt = new Date("2026-07-15T14:59:00.000Z");
  makeJob(store, {
    id: "job-19",
    userId: "u19",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 8,
    periodUsageId: "pu-19",
    ttsStartedAt: ttsAt,
    creditRefundedAt: null,
  });
  const client = buildStubClient(store);
  const r = await releasePlanMinuteReservation(
    { jobId: "job-19", error: "tts store failed", refundCreditIfEligible: true },
    client
  );
  check("Atomic post-TTS: ok=true", r.ok, true);
  if (r.ok) {
    check("Atomic post-TTS: outcome=released", r.outcome, "released");
    check("Atomic post-TTS: creditRefunded=false (TTS started)", r.creditRefunded, false);
  }
  const pu = store.periodUsages.get("pu-19");
  check("Atomic post-TTS: minutes released 15 → 7", pu?.minutesReserved, 7);
  const j = store.jobs.get("job-19");
  check("Atomic post-TTS: status=FAILED", j?.status, "FAILED");
  check("Atomic post-TTS: creditRefundedAt still null", j?.creditRefundedAt, null);
  const u = store.users.get("u19");
  check("Atomic post-TTS: User.credits unchanged at 1", u?.credits, 1);
}

// (20) Stale recovery, PLAN_MINUTES, pre-TTS. Same guarantees as (18)
// but exercised through the same helper call (the stale-recovery route
// now delegates the whole write bundle to the helper). No partial
// state — the job is FAILED with credit AND minutes returned, or none
// of the three fields moved.
{
  const store = seedStore();
  makeUser(store, { id: "u20", credits: 5 });
  makePeriodUsage(store, {
    id: "pu-20",
    userId: "u20",
    minutesReserved: 25,
    minutesUsed: 10,
  });
  makeJob(store, {
    id: "job-20",
    userId: "u20",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 12,
    periodUsageId: "pu-20",
    ttsStartedAt: null,
    creditRefundedAt: null,
  });
  const client = buildStubClient(store);
  const t = new Date("2026-07-16T09:00:00.000Z");
  const r = await releasePlanMinuteReservation(
    {
      jobId: "job-20",
      error: "Generation timed out. Please try again.",
      now: t,
      refundCreditIfEligible: true,
    },
    client
  );
  check("Stale pre-TTS: ok=true", r.ok, true);
  if (r.ok) {
    check("Stale pre-TTS: creditRefunded=true", r.creditRefunded, true);
  }
  const pu = store.periodUsages.get("pu-20");
  check("Stale pre-TTS: minutes 25 → 13", pu?.minutesReserved, 13);
  check("Stale pre-TTS: minutesUsed unchanged at 10", pu?.minutesUsed, 10);
  const j = store.jobs.get("job-20");
  check("Stale pre-TTS: status=FAILED", j?.status, "FAILED");
  check("Stale pre-TTS: usageReleasedAt set", j?.usageReleasedAt?.getTime(), t.getTime());
  check("Stale pre-TTS: creditRefundedAt set", j?.creditRefundedAt?.getTime(), t.getTime());
  const u = store.users.get("u20");
  check("Stale pre-TTS: User.credits 5 → 6", u?.credits, 6);
}

// (21) Stale recovery, PLAN_MINUTES, post-TTS. Minutes released but no
// credit refund.
{
  const store = seedStore();
  makeUser(store, { id: "u21", credits: 3 });
  makePeriodUsage(store, {
    id: "pu-21",
    userId: "u21",
    minutesReserved: 30,
    minutesUsed: 0,
  });
  const ttsAt = new Date("2026-07-16T08:00:00.000Z");
  makeJob(store, {
    id: "job-21",
    userId: "u21",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 15,
    periodUsageId: "pu-21",
    ttsStartedAt: ttsAt,
    creditRefundedAt: null,
  });
  const client = buildStubClient(store);
  const r = await releasePlanMinuteReservation(
    {
      jobId: "job-21",
      error: "stale",
      refundCreditIfEligible: true,
    },
    client
  );
  check("Stale post-TTS: ok=true", r.ok, true);
  if (r.ok) {
    check("Stale post-TTS: creditRefunded=false", r.creditRefunded, false);
  }
  const pu = store.periodUsages.get("pu-21");
  check("Stale post-TTS: minutes 30 → 15", pu?.minutesReserved, 15);
  const j = store.jobs.get("job-21");
  check("Stale post-TTS: status=FAILED", j?.status, "FAILED");
  check("Stale post-TTS: creditRefundedAt still null", j?.creditRefundedAt, null);
  const u = store.users.get("u21");
  check("Stale post-TTS: User.credits unchanged at 3", u?.credits, 3);
}

// (22) Repeated request. Second identical release call must be a no-op:
// no second decrement, no second credit refund, timestamps preserved.
{
  const store = seedStore();
  makeUser(store, { id: "u22", credits: 0 });
  makePeriodUsage(store, {
    id: "pu-22",
    userId: "u22",
    minutesReserved: 10,
    minutesUsed: 2,
  });
  makeJob(store, {
    id: "job-22",
    userId: "u22",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 4,
    periodUsageId: "pu-22",
  });
  const client = buildStubClient(store);
  const t1 = new Date("2026-07-15T20:00:00.000Z");
  const t2 = new Date("2026-07-15T20:30:00.000Z");
  const r1 = await releasePlanMinuteReservation(
    { jobId: "job-22", error: "first", now: t1, refundCreditIfEligible: true },
    client
  );
  const r2 = await releasePlanMinuteReservation(
    { jobId: "job-22", error: "second", now: t2, refundCreditIfEligible: true },
    client
  );
  check("Repeated: first ok=true", r1.ok, true);
  check("Repeated: second ok=true", r2.ok, true);
  if (r1.ok) check("Repeated: first creditRefunded=true", r1.creditRefunded, true);
  if (r2.ok) {
    check("Repeated: second outcome=already_released", r2.outcome, "already_released");
    check("Repeated: second creditRefunded=false", r2.creditRefunded, false);
  }
  const pu = store.periodUsages.get("pu-22");
  check("Repeated: minutes 10 → 6 (single release)", pu?.minutesReserved, 6);
  check("Repeated: minutesUsed unchanged at 2", pu?.minutesUsed, 2);
  const j = store.jobs.get("job-22");
  check(
    "Repeated: usageReleasedAt preserved at t1",
    j?.usageReleasedAt?.getTime(),
    t1.getTime()
  );
  check(
    "Repeated: creditRefundedAt preserved at t1",
    j?.creditRefundedAt?.getTime(),
    t1.getTime()
  );
  check("Repeated: error preserved as 'first'", j?.error, "first");
  const u = store.users.get("u22");
  check("Repeated: User.credits +1 exactly once", u?.credits, 1);
}

// (23) Parallel releases with credit refund. Exactly one call must
// perform the minute release AND the credit refund; the other must
// see the already_released idempotent branch.
{
  const store = seedStore();
  makeUser(store, { id: "u23", credits: 0 });
  makePeriodUsage(store, {
    id: "pu-23",
    userId: "u23",
    minutesReserved: 18,
    minutesUsed: 1,
  });
  makeJob(store, {
    id: "job-23",
    userId: "u23",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 7,
    periodUsageId: "pu-23",
  });
  const client = buildStubClient(store);
  const [r1, r2] = await Promise.all([
    releasePlanMinuteReservation(
      { jobId: "job-23", error: "A", refundCreditIfEligible: true },
      client
    ),
    releasePlanMinuteReservation(
      { jobId: "job-23", error: "B", refundCreditIfEligible: true },
      client
    ),
  ]);
  check("Parallel+refund: both ok=true", r1.ok && r2.ok, true);
  const releasedCount =
    (r1.ok && r1.outcome === "released" ? 1 : 0) +
    (r2.ok && r2.outcome === "released" ? 1 : 0);
  const refundedCount =
    (r1.ok && r1.creditRefunded ? 1 : 0) +
    (r2.ok && r2.creditRefunded ? 1 : 0);
  check("Parallel+refund: exactly one release", releasedCount, 1);
  check("Parallel+refund: exactly one credit refund", refundedCount, 1);
  const pu = store.periodUsages.get("pu-23");
  check("Parallel+refund: minutes 18 → 11 (single release)", pu?.minutesReserved, 11);
  const u = store.users.get("u23");
  check("Parallel+refund: User.credits 0 → 1 (single refund)", u?.credits, 1);
}

// (24) Rollback simulation: injected PeriodUsage.updateMany failure
// AFTER the Job CAS claim (which sets FAILED, usageReleasedAt) and
// BEFORE the credit-refund claim. The whole tx must roll back: the Job
// stays PROCESSING, no minute release, no credit refund, User.credits
// unchanged.
{
  const store = seedStore();
  makeUser(store, { id: "u24", credits: 4 });
  makePeriodUsage(store, {
    id: "pu-24",
    userId: "u24",
    minutesReserved: 10,
    minutesUsed: 0,
  });
  makeJob(store, {
    id: "job-24",
    userId: "u24",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 3,
    periodUsageId: "pu-24",
  });
  store.injectPeriodUsageUpdateErrorOnce = new Error("pu update boom");
  const client = buildStubClient(store);
  let threw = false;
  try {
    await releasePlanMinuteReservation(
      { jobId: "job-24", error: "x", refundCreditIfEligible: true },
      client
    );
  } catch {
    threw = true;
  }
  check("Rollback PU-fail: exception propagated", threw, true);
  const pu = store.periodUsages.get("pu-24");
  check("Rollback PU-fail: minutes unchanged at 10", pu?.minutesReserved, 10);
  const j = store.jobs.get("job-24");
  check("Rollback PU-fail: status still PROCESSING", j?.status, "PROCESSING");
  check("Rollback PU-fail: usageReleasedAt still null", j?.usageReleasedAt, null);
  check("Rollback PU-fail: creditRefundedAt still null", j?.creditRefundedAt, null);
  check("Rollback PU-fail: error still null", j?.error, null);
  const u = store.users.get("u24");
  check("Rollback PU-fail: User.credits unchanged at 4", u?.credits, 4);
}

// (25) Rollback simulation: injected User.update failure during the
// credit-refund step. Job.updateMany (FAILED + usageReleasedAt),
// PeriodUsage.updateMany (minute release) and the refund-claim
// Job.updateMany all already ran — but the User.credits increment
// throws. The whole tx must roll back so no field moves.
{
  const store = seedStore();
  makeUser(store, { id: "u25", credits: 7 });
  makePeriodUsage(store, {
    id: "pu-25",
    userId: "u25",
    minutesReserved: 12,
    minutesUsed: 3,
  });
  makeJob(store, {
    id: "job-25",
    userId: "u25",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 5,
    periodUsageId: "pu-25",
  });
  store.injectUserUpdateErrorOnce = new Error("user update boom");
  const client = buildStubClient(store);
  let threw = false;
  try {
    await releasePlanMinuteReservation(
      { jobId: "job-25", error: "y", refundCreditIfEligible: true },
      client
    );
  } catch {
    threw = true;
  }
  check("Rollback User-fail: exception propagated", threw, true);
  const pu = store.periodUsages.get("pu-25");
  check("Rollback User-fail: minutesReserved unchanged at 12", pu?.minutesReserved, 12);
  check("Rollback User-fail: minutesUsed unchanged at 3", pu?.minutesUsed, 3);
  const j = store.jobs.get("job-25");
  check("Rollback User-fail: status still PROCESSING", j?.status, "PROCESSING");
  check("Rollback User-fail: usageReleasedAt still null", j?.usageReleasedAt, null);
  check("Rollback User-fail: creditRefundedAt still null", j?.creditRefundedAt, null);
  check("Rollback User-fail: error still null", j?.error, null);
  const u = store.users.get("u25");
  check("Rollback User-fail: User.credits unchanged at 7", u?.credits, 7);
}

// (26) Rollback simulation: injected Job.updateMany (CAS claim) failure.
// Nothing has committed yet, so nothing to unwind — but critically, no
// credit-refund claim runs either (the CAS-fail short-circuits before
// the refund step). User.credits stays put.
{
  const store = seedStore();
  makeUser(store, { id: "u26", credits: 9 });
  makePeriodUsage(store, {
    id: "pu-26",
    userId: "u26",
    minutesReserved: 10,
    minutesUsed: 0,
  });
  makeJob(store, {
    id: "job-26",
    userId: "u26",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 3,
    periodUsageId: "pu-26",
  });
  store.injectJobUpdateManyErrorOnce = new Error("job claim boom");
  const client = buildStubClient(store);
  let threw = false;
  try {
    await releasePlanMinuteReservation(
      { jobId: "job-26", error: "z", refundCreditIfEligible: true },
      client
    );
  } catch {
    threw = true;
  }
  check("Rollback CAS-fail+refund: exception propagated", threw, true);
  const pu = store.periodUsages.get("pu-26");
  check("Rollback CAS-fail+refund: minutes unchanged", pu?.minutesReserved, 10);
  const j = store.jobs.get("job-26");
  check("Rollback CAS-fail+refund: status still PROCESSING", j?.status, "PROCESSING");
  check("Rollback CAS-fail+refund: creditRefundedAt still null", j?.creditRefundedAt, null);
  const u = store.users.get("u26");
  check("Rollback CAS-fail+refund: User.credits unchanged at 9", u?.credits, 9);
}

// (27) Rollback simulation: underflow. Reserved bucket has less than
// Job.reservedMinutes — PeriodUsage.updateMany returns count = 0, the
// helper throws RESERVED_MINUTES_UNDERFLOW, and the whole tx rolls
// back including the credit refund step which had not yet run.
{
  const store = seedStore();
  makeUser(store, { id: "u27", credits: 2 });
  makePeriodUsage(store, {
    id: "pu-27",
    userId: "u27",
    minutesReserved: 2,
    minutesUsed: 40,
  });
  makeJob(store, {
    id: "job-27",
    userId: "u27",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 10,
    periodUsageId: "pu-27",
  });
  const client = buildStubClient(store);
  const r = await releasePlanMinuteReservation(
    { jobId: "job-27", error: "under+refund", refundCreditIfEligible: true },
    client
  );
  check("Rollback underflow+refund: ok=false", r.ok, false);
  if (!r.ok)
    check(
      "Rollback underflow+refund: error=RESERVED_MINUTES_UNDERFLOW",
      r.error,
      "RESERVED_MINUTES_UNDERFLOW"
    );
  const pu = store.periodUsages.get("pu-27");
  check("Rollback underflow+refund: minutes unchanged at 2", pu?.minutesReserved, 2);
  check("Rollback underflow+refund: minutesUsed unchanged at 40", pu?.minutesUsed, 40);
  check(
    "Rollback underflow+refund: no negative counter",
    (pu?.minutesReserved ?? 0) >= 0,
    true
  );
  const j = store.jobs.get("job-27");
  check("Rollback underflow+refund: status still PROCESSING", j?.status, "PROCESSING");
  check("Rollback underflow+refund: creditRefundedAt still null", j?.creditRefundedAt, null);
  check("Rollback underflow+refund: usageReleasedAt still null", j?.usageReleasedAt, null);
  const u = store.users.get("u27");
  check("Rollback underflow+refund: User.credits unchanged at 2", u?.credits, 2);
}

// (28) Non-plan Job with refundCreditIfEligible=true. Legacy / FREE /
// untagged path still writes FAILED as before, but now also folds the
// credit refund into the same tx (matches the ex-tryRefundCredit
// behaviour, atomically). PeriodUsage is untouched (there isn't one).
{
  const store = seedStore();
  makeUser(store, { id: "u28", credits: 5 });
  makeJob(store, {
    id: "job-28",
    userId: "u28",
    entitlementKind: null,
    reservedMinutes: null,
    periodUsageId: null,
    ttsStartedAt: null,
    creditRefundedAt: null,
  });
  const client = buildStubClient(store);
  const r = await releasePlanMinuteReservation(
    { jobId: "job-28", error: "legacy fail", refundCreditIfEligible: true },
    client
  );
  check("Non-plan+refund: ok=true", r.ok, true);
  if (r.ok) {
    check("Non-plan+refund: outcome=no_reservation", r.outcome, "no_reservation");
    check("Non-plan+refund: creditRefunded=true", r.creditRefunded, true);
  }
  const j = store.jobs.get("job-28");
  check("Non-plan+refund: status FAILED", j?.status, "FAILED");
  check("Non-plan+refund: creditRefundedAt set", !!j?.creditRefundedAt, true);
  const u = store.users.get("u28");
  check("Non-plan+refund: User.credits 5 → 6", u?.credits, 6);
  check("Non-plan+refund: no PeriodUsage rows created", store.periodUsages.size, 0);
}

// (29) Non-plan Job WITHOUT refundCreditIfEligible (e.g. /fail route
// which doesn't refund by policy). Legacy behaviour: FAILED write only,
// no credit change.
{
  const store = seedStore();
  makeUser(store, { id: "u29", credits: 5 });
  makeJob(store, {
    id: "job-29",
    userId: "u29",
    entitlementKind: null,
    reservedMinutes: null,
    periodUsageId: null,
  });
  const client = buildStubClient(store);
  const r = await releasePlanMinuteReservation(
    { jobId: "job-29", error: "manual fail" },
    client
  );
  check("Non-plan no-refund: ok=true", r.ok, true);
  if (r.ok) {
    check("Non-plan no-refund: outcome=no_reservation", r.outcome, "no_reservation");
    check("Non-plan no-refund: creditRefunded=false", r.creditRefunded, false);
  }
  const j = store.jobs.get("job-29");
  check("Non-plan no-refund: status FAILED", j?.status, "FAILED");
  check("Non-plan no-refund: creditRefundedAt still null", j?.creditRefundedAt, null);
  const u = store.users.get("u29");
  check("Non-plan no-refund: User.credits unchanged at 5", u?.credits, 5);
}

// (30) Admin path: refundCreditIfEligible=false even for PLAN_MINUTES.
// Minutes must still be released (the reservation exists regardless of
// admin), but the credit balance must stay untouched — admins are
// never debited at job creation.
{
  const store = seedStore();
  makeUser(store, { id: "u30-admin", credits: 100 });
  makePeriodUsage(store, {
    id: "pu-30",
    userId: "u30-admin",
    minutesReserved: 20,
    minutesUsed: 0,
  });
  makeJob(store, {
    id: "job-30",
    userId: "u30-admin",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 8,
    periodUsageId: "pu-30",
  });
  const client = buildStubClient(store);
  const r = await releasePlanMinuteReservation(
    { jobId: "job-30", error: "admin fail", refundCreditIfEligible: false },
    client
  );
  check("Admin path: ok=true", r.ok, true);
  if (r.ok) {
    check("Admin path: outcome=released", r.outcome, "released");
    check("Admin path: creditRefunded=false", r.creditRefunded, false);
  }
  const pu = store.periodUsages.get("pu-30");
  check("Admin path: minutes released 20 → 12", pu?.minutesReserved, 12);
  const j = store.jobs.get("job-30");
  check("Admin path: creditRefundedAt still null", j?.creditRefundedAt, null);
  const u = store.users.get("u30-admin");
  check("Admin path: User.credits untouched at 100", u?.credits, 100);
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
