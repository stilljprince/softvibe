// scripts/test-finalization.ts
//
// Offline tests for the RP-010 Phase 3B Minute Finalization module.
// Exercises finalizePlanMinuteUsage through an in-memory Prisma stub that
// mirrors the transactional and Compare-And-Set semantics of the real
// Postgres path: mutations only commit if the interactive transaction
// callback returns without throwing.
//
// Run with:
//
//   npx tsx scripts/test-finalization.ts
//
// Covers (numbering follows the Phase 3B task spec):
//
//   Successful finalization
//     (1) PLAN_MINUTES Job with 10 reserved minutes
//         → PeriodUsage.minutesReserved −10, minutesUsed +10,
//           Job.usageFinalizedAt set, Job.usageReleasedAt still null
//     (2) Reserved minutes (not actual audio duration) is authoritative
//     (3) STARTER and PREMIUM behave identically w.r.t. the transfer
//
//   Idempotency
//     (4) Second finalize call — no increment, no decrement,
//         usageFinalizedAt timestamp preserved
//     (5) Two concurrent finalize calls — exactly one finalizes,
//         PeriodUsage moved once
//
//   Invalid states
//     (6) Already-released Job — no finalize
//     (7) Job without reservedMinutes — controlled error, no write
//     (8) Job without periodUsageId — controlled error, no write
//     (9) Missing PeriodUsage row — full rollback
//    (10) minutesReserved < Job.reservedMinutes — controlled underflow,
//         no negative counter, full rollback
//    (11) Job update failure — PeriodUsage change rolls back
//    (12) PeriodUsage update failure — Job stays unfinalized
//
//   Period switch
//    (13) User is now in a new billing period — finalize still targets
//         the *originally* reserved PeriodUsage row
//
//   Non-plan Jobs
//    (14) Job without PLAN_MINUTES — success flow works, no PeriodUsage
//         mutation, no usageFinalizedAt
//
//   JOB_NOT_FOUND coverage
//    (15) Unknown Job id — controlled error, no writes anywhere

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
// Models only the surface finalizePlanMinuteUsage touches:
//   * $transaction(async (tx) => …) with rollback-on-throw
//   * job.findUnique
//   * job.update
//   * job.updateMany (the CAS claim)
//   * periodUsage.findUnique
//   * periodUsage.updateMany (numeric-bound reserved/used transfer)
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
  jobs: Map<string, StoreJob>;
  periodUsages: Map<string, StorePeriodUsage>;
  // Injection hooks. Each is consumed on the next matching call.
  injectJobUpdateManyErrorOnce?: Error;
  injectJobUpdateErrorOnce?: Error;
  injectPeriodUsageUpdateErrorOnce?: Error;
};

type WriteOp =
  | { kind: "job.set"; jobId: string; prev: StoreJob }
  | { kind: "pu.set"; puId: string; prev: StorePeriodUsage };

function snap(job: StoreJob): StoreJob {
  return { ...job };
}
function snapPu(pu: StorePeriodUsage): StorePeriodUsage {
  return { ...pu };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTxOps(store: Store, writes: WriteOp[]) {
  return {
    job: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where, select: _select }: any) => {
        const j = store.jobs.get(where.id);
        if (!j) return null;
        // Return the full snapshot; the caller uses TypeScript projection.
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
        // WHERE guard — mirrors the CAS-claim in finalization.ts.
        if (where.entitlementKind && j.entitlementKind !== where.entitlementKind) {
          return { count: 0 };
        }
        if (where.usageFinalizedAt === null && j.usageFinalizedAt !== null) {
          return { count: 0 };
        }
        if (where.usageReleasedAt === null && j.usageReleasedAt !== null) {
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
        return { count: 1 };
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
        // finalization.ts. Prevents negative counters at the DB layer.
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
  };
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
// example — must land at reserved=25, used=20. usageFinalizedAt set,
// usageReleasedAt still null, Job status=DONE, resultUrl written.
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
  const r = await finalizePlanMinuteUsage(
    { jobId: "job-1", finalJobData: { resultUrl: "/audio/job-1" }, now: t },
    client
  );
  check("Happy: ok=true", r.ok, true);
  if (r.ok) {
    check("Happy: outcome=finalized", r.outcome, "finalized");
    check("Happy: job.status=DONE", r.job.status, "DONE");
    check("Happy: job.resultUrl set", r.job.resultUrl, "/audio/job-1");
  }
  const pu = store.periodUsages.get("pu-1");
  check("Happy: minutesReserved 35 → 25", pu?.minutesReserved, 25);
  check("Happy: minutesUsed 10 → 20", pu?.minutesUsed, 20);
  const j = store.jobs.get("job-1");
  check("Happy: usageFinalizedAt set", j?.usageFinalizedAt?.getTime(), t.getTime());
  check("Happy: usageReleasedAt still null", j?.usageReleasedAt, null);
  check("Happy: job.status persisted as DONE", j?.status, "DONE");
  check("Happy: job.resultUrl persisted", j?.resultUrl, "/audio/job-1");
  check("Happy: job.error cleared", j?.error, null);
}

// (2) Reserved minutes (not actual audio duration) is authoritative.
// A 20-minute reserved Job debits 20 regardless of any other value
// the caller might submit. The finalize function does not accept a
// duration parameter — this test asserts the API surface itself.
{
  const store = seedStore();
  makePeriodUsage(store, {
    id: "pu-2",
    userId: "u2",
    minutesReserved: 20,
    minutesUsed: 0,
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
  await finalizePlanMinuteUsage(
    { jobId: "job-2", finalJobData: { resultUrl: "/audio/job-2" } },
    client
  );
  const pu = store.periodUsages.get("pu-2");
  check(
    "Requested-minutes authoritative: minutesUsed=20 (not 1 from 5s)",
    pu?.minutesUsed,
    20
  );
  check(
    "Requested-minutes authoritative: minutesReserved=0",
    pu?.minutesReserved,
    0
  );
}

// (3) STARTER and PREMIUM behave identically w.r.t. the transfer. The
// finalization function is plan-agnostic; the test seeds two PeriodUsage
// rows with different allowances-adjacent totals and verifies both
// transfer their Job's reservedMinutes cleanly.
{
  const store = seedStore();
  makePeriodUsage(store, {
    id: "pu-s",
    userId: "us",
    minutesReserved: 80,
    minutesUsed: 0,
  });
  makePeriodUsage(store, {
    id: "pu-p",
    userId: "up",
    minutesReserved: 200,
    minutesUsed: 0,
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
  await finalizePlanMinuteUsage(
    { jobId: "job-s", finalJobData: { resultUrl: "/audio/s" } },
    client
  );
  await finalizePlanMinuteUsage(
    { jobId: "job-p", finalJobData: { resultUrl: "/audio/p" } },
    client
  );
  const pus = store.periodUsages.get("pu-s");
  const pup = store.periodUsages.get("pu-p");
  check("STARTER transfer: reserved 80 → 68", pus?.minutesReserved, 68);
  check("STARTER transfer: used 0 → 12", pus?.minutesUsed, 12);
  check("PREMIUM transfer: reserved 200 → 155", pup?.minutesReserved, 155);
  check("PREMIUM transfer: used 0 → 45", pup?.minutesUsed, 45);
}

// (4) Idempotency: second finalize is a no-op — no second increment/
// decrement, usageFinalizedAt timestamp preserved.
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
  const r1 = await finalizePlanMinuteUsage(
    { jobId: "job-4", finalJobData: { resultUrl: "/audio/4" }, now: t1 },
    client
  );
  const r2 = await finalizePlanMinuteUsage(
    { jobId: "job-4", finalJobData: { resultUrl: "/audio/4-new" }, now: t2 },
    client
  );
  check("Idempotent: first ok=true", r1.ok, true);
  check("Idempotent: second ok=true", r2.ok, true);
  if (r2.ok) {
    check("Idempotent: second outcome=already_finalized", r2.outcome, "already_finalized");
  }
  const pu = store.periodUsages.get("pu-4");
  check("Idempotent: minutesReserved=10 (only debited once)", pu?.minutesReserved, 10);
  check("Idempotent: minutesUsed=5 (only credited once)", pu?.minutesUsed, 5);
  const j = store.jobs.get("job-4");
  check(
    "Idempotent: usageFinalizedAt still t1 (not overwritten by t2)",
    j?.usageFinalizedAt?.getTime(),
    t1.getTime()
  );
  check(
    "Idempotent: resultUrl still t1 value (second call did not overwrite)",
    j?.resultUrl,
    "/audio/4"
  );
}

// (5) Concurrent finalize: only one wins the CAS claim; usage moves once.
{
  const store = seedStore();
  makePeriodUsage(store, {
    id: "pu-5",
    userId: "u5",
    minutesReserved: 30,
    minutesUsed: 0,
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
    finalizePlanMinuteUsage(
      { jobId: "job-5", finalJobData: { resultUrl: "/a/5-A" } },
      client
    ),
    finalizePlanMinuteUsage(
      { jobId: "job-5", finalJobData: { resultUrl: "/a/5-B" } },
      client
    ),
  ]);
  check("Concurrent: both ok=true", r1.ok && r2.ok, true);
  const finalizedCount =
    (r1.ok && r1.outcome === "finalized" ? 1 : 0) +
    (r2.ok && r2.outcome === "finalized" ? 1 : 0);
  const idempotentCount =
    (r1.ok && r1.outcome === "already_finalized" ? 1 : 0) +
    (r2.ok && r2.outcome === "already_finalized" ? 1 : 0);
  check("Concurrent: exactly one finalize won", finalizedCount, 1);
  check("Concurrent: exactly one no-op response", idempotentCount, 1);
  const pu = store.periodUsages.get("pu-5");
  check("Concurrent: minutesReserved 30 → 20 (single debit)", pu?.minutesReserved, 20);
  check("Concurrent: minutesUsed 0 → 10 (single credit)", pu?.minutesUsed, 10);
}

// (6) Already-released Job — finalize must refuse.
{
  const store = seedStore();
  makePeriodUsage(store, {
    id: "pu-6",
    userId: "u6",
    minutesReserved: 20,
    minutesUsed: 0,
  });
  const preRelease = new Date("2026-07-15T10:00:00.000Z");
  makeJob(store, {
    id: "job-6",
    userId: "u6",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 5,
    periodUsageId: "pu-6",
    usageReleasedAt: preRelease,
  });
  const client = buildStubClient(store);
  const r = await finalizePlanMinuteUsage(
    { jobId: "job-6", finalJobData: { resultUrl: "/audio/6" } },
    client
  );
  check("Released: ok=false", r.ok, false);
  if (!r.ok) check("Released: error=ALREADY_RELEASED", r.error, "ALREADY_RELEASED");
  const pu = store.periodUsages.get("pu-6");
  check("Released: minutesReserved unchanged (20)", pu?.minutesReserved, 20);
  check("Released: minutesUsed unchanged (0)", pu?.minutesUsed, 0);
  const j = store.jobs.get("job-6");
  check("Released: usageFinalizedAt still null", j?.usageFinalizedAt, null);
  check(
    "Released: usageReleasedAt preserved",
    j?.usageReleasedAt?.getTime(),
    preRelease.getTime()
  );
  check("Released: status not changed to DONE", j?.status, "PROCESSING");
}

// (7) PLAN_MINUTES tagged Job with reservedMinutes = null (structural bug).
// Controlled error, no write.
{
  const store = seedStore();
  makePeriodUsage(store, {
    id: "pu-7",
    userId: "u7",
    minutesReserved: 10,
    minutesUsed: 0,
  });
  makeJob(store, {
    id: "job-7",
    userId: "u7",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: null,
    periodUsageId: "pu-7",
  });
  const client = buildStubClient(store);
  const r = await finalizePlanMinuteUsage(
    { jobId: "job-7", finalJobData: { resultUrl: "/audio/7" } },
    client
  );
  check("Missing reservedMinutes: ok=false", r.ok, false);
  if (!r.ok)
    check(
      "Missing reservedMinutes: error=MISSING_RESERVATION",
      r.error,
      "MISSING_RESERVATION"
    );
  const pu = store.periodUsages.get("pu-7");
  check("Missing reservedMinutes: minutesReserved unchanged", pu?.minutesReserved, 10);
  const j = store.jobs.get("job-7");
  check("Missing reservedMinutes: not DONE", j?.status, "PROCESSING");
  check("Missing reservedMinutes: usageFinalizedAt still null", j?.usageFinalizedAt, null);
}

// (8) PLAN_MINUTES tagged Job with periodUsageId = null.
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
    reservedMinutes: 5,
    periodUsageId: null,
  });
  const client = buildStubClient(store);
  const r = await finalizePlanMinuteUsage(
    { jobId: "job-8", finalJobData: { resultUrl: "/audio/8" } },
    client
  );
  check("Missing periodUsageId: ok=false", r.ok, false);
  if (!r.ok)
    check(
      "Missing periodUsageId: error=MISSING_RESERVATION",
      r.error,
      "MISSING_RESERVATION"
    );
  const j = store.jobs.get("job-8");
  check("Missing periodUsageId: not DONE", j?.status, "PROCESSING");
  check("Missing periodUsageId: usageFinalizedAt still null", j?.usageFinalizedAt, null);
  const pu = store.periodUsages.get("pu-8");
  check("Missing periodUsageId: minutesReserved unchanged", pu?.minutesReserved, 10);
}

// (9) PeriodUsage row missing (deleted or never existed) — rollback.
// The Job.updateMany CAS claim runs first and would set DONE; the
// PeriodUsage.updateMany then reports zero rows; a findUnique proves
// the row is missing → PERIOD_USAGE_NOT_FOUND and the whole tx rolls
// back so the Job is NOT marked DONE.
{
  const store = seedStore();
  makeJob(store, {
    id: "job-9",
    userId: "u9",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 5,
    periodUsageId: "pu-missing",
  });
  const client = buildStubClient(store);
  const r = await finalizePlanMinuteUsage(
    { jobId: "job-9", finalJobData: { resultUrl: "/audio/9" } },
    client
  );
  check("PU missing: ok=false", r.ok, false);
  if (!r.ok)
    check("PU missing: error=PERIOD_USAGE_NOT_FOUND", r.error, "PERIOD_USAGE_NOT_FOUND");
  const j = store.jobs.get("job-9");
  check("PU missing: job status still PROCESSING", j?.status, "PROCESSING");
  check("PU missing: usageFinalizedAt still null", j?.usageFinalizedAt, null);
  check("PU missing: resultUrl still null (not persisted)", j?.resultUrl, null);
}

// (10) minutesReserved < Job.reservedMinutes — underflow guard fires,
// full rollback, no negative counter.
{
  const store = seedStore();
  makePeriodUsage(store, {
    id: "pu-10",
    userId: "u10",
    minutesReserved: 3,
    minutesUsed: 12,
  });
  makeJob(store, {
    id: "job-10",
    userId: "u10",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 5,
    periodUsageId: "pu-10",
  });
  const client = buildStubClient(store);
  const r = await finalizePlanMinuteUsage(
    { jobId: "job-10", finalJobData: { resultUrl: "/audio/10" } },
    client
  );
  check("Underflow: ok=false", r.ok, false);
  if (!r.ok)
    check(
      "Underflow: error=RESERVED_MINUTES_UNDERFLOW",
      r.error,
      "RESERVED_MINUTES_UNDERFLOW"
    );
  const pu = store.periodUsages.get("pu-10");
  check("Underflow: minutesReserved unchanged at 3", pu?.minutesReserved, 3);
  check("Underflow: minutesUsed unchanged at 12", pu?.minutesUsed, 12);
  check(
    "Underflow: no negative counter",
    (pu?.minutesReserved ?? 0) >= 0,
    true
  );
  const j = store.jobs.get("job-10");
  check("Underflow: job status still PROCESSING", j?.status, "PROCESSING");
  check("Underflow: usageFinalizedAt still null", j?.usageFinalizedAt, null);
}

// (11) Injected Job.update failure inside the non-PLAN_MINUTES branch
// rolls the DONE write back (there's no PeriodUsage change to unwind on
// that path, but the Job must not appear DONE either).
{
  const store = seedStore();
  makeJob(store, {
    id: "job-11",
    userId: "u11",
    entitlementKind: null,
    reservedMinutes: null,
    periodUsageId: null,
  });
  store.injectJobUpdateErrorOnce = new Error("job update boom");
  const client = buildStubClient(store);
  let threw = false;
  try {
    await finalizePlanMinuteUsage(
      { jobId: "job-11", finalJobData: { resultUrl: "/audio/11" } },
      client
    );
  } catch {
    threw = true;
  }
  check("Injected job.update fail: exception propagated", threw, true);
  const j = store.jobs.get("job-11");
  check("Injected job.update fail: status not DONE", j?.status, "PROCESSING");
  check("Injected job.update fail: resultUrl still null", j?.resultUrl, null);
}

// (11b) Injected Job.updateMany (CAS-claim) failure on the PLAN_MINUTES
// path. Any PeriodUsage change must not commit because the Job claim
// happens first and errors out — the outer transaction rolls back and
// nothing is written.
{
  const store = seedStore();
  makePeriodUsage(store, {
    id: "pu-11b",
    userId: "u11b",
    minutesReserved: 10,
    minutesUsed: 0,
  });
  makeJob(store, {
    id: "job-11b",
    userId: "u11b",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 3,
    periodUsageId: "pu-11b",
  });
  store.injectJobUpdateManyErrorOnce = new Error("job claim boom");
  const client = buildStubClient(store);
  let threw = false;
  try {
    await finalizePlanMinuteUsage(
      { jobId: "job-11b", finalJobData: { resultUrl: "/audio/11b" } },
      client
    );
  } catch {
    threw = true;
  }
  check("Injected CAS-claim fail: exception propagated", threw, true);
  const pu = store.periodUsages.get("pu-11b");
  check("Injected CAS-claim fail: minutesReserved unchanged", pu?.minutesReserved, 10);
  check("Injected CAS-claim fail: minutesUsed unchanged", pu?.minutesUsed, 0);
  const j = store.jobs.get("job-11b");
  check("Injected CAS-claim fail: not DONE", j?.status, "PROCESSING");
  check("Injected CAS-claim fail: usageFinalizedAt still null", j?.usageFinalizedAt, null);
}

// (12) Injected PeriodUsage.updateMany failure — Job claim already
// committed writes in the tx buffer; on the throw the whole tx rolls
// back so the Job stays unfinalized.
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
    reservedMinutes: 4,
    periodUsageId: "pu-12",
  });
  store.injectPeriodUsageUpdateErrorOnce = new Error("pu update boom");
  const client = buildStubClient(store);
  let threw = false;
  try {
    await finalizePlanMinuteUsage(
      { jobId: "job-12", finalJobData: { resultUrl: "/audio/12" } },
      client
    );
  } catch {
    threw = true;
  }
  check("Injected pu.updateMany fail: exception propagated", threw, true);
  const pu = store.periodUsages.get("pu-12");
  check("Injected pu.updateMany fail: minutesReserved unchanged", pu?.minutesReserved, 10);
  check("Injected pu.updateMany fail: minutesUsed unchanged", pu?.minutesUsed, 0);
  const j = store.jobs.get("job-12");
  check("Injected pu.updateMany fail: not DONE", j?.status, "PROCESSING");
  check(
    "Injected pu.updateMany fail: usageFinalizedAt still null",
    j?.usageFinalizedAt,
    null
  );
  check("Injected pu.updateMany fail: resultUrl still null", j?.resultUrl, null);
}

// (13) Billing period switch. Reservation belongs to period 1; user has
// since rolled over into period 2. Finalization must still target the
// *originally* reserved PeriodUsage row (period 1), not the current one.
{
  const store = seedStore();
  makePeriodUsage(store, {
    id: "pu-13-old",
    userId: "u13",
    periodStart: period1Start,
    periodEnd: period1End,
    minutesReserved: 20,
    minutesUsed: 5,
  });
  makePeriodUsage(store, {
    id: "pu-13-new",
    userId: "u13",
    periodStart: period2Start,
    periodEnd: period2End,
    minutesReserved: 0,
    minutesUsed: 0,
  });
  makeJob(store, {
    id: "job-13",
    userId: "u13",
    entitlementKind: "PLAN_MINUTES",
    reservedMinutes: 8,
    periodUsageId: "pu-13-old",
  });
  const client = buildStubClient(store);
  const r = await finalizePlanMinuteUsage(
    { jobId: "job-13", finalJobData: { resultUrl: "/audio/13" } },
    client
  );
  check("Period switch: ok=true", r.ok, true);
  const puOld = store.periodUsages.get("pu-13-old");
  const puNew = store.periodUsages.get("pu-13-new");
  check("Period switch: old row minutesReserved 20 → 12", puOld?.minutesReserved, 12);
  check("Period switch: old row minutesUsed 5 → 13", puOld?.minutesUsed, 13);
  check("Period switch: new row minutesReserved untouched", puNew?.minutesReserved, 0);
  check("Period switch: new row minutesUsed untouched", puNew?.minutesUsed, 0);
}

// (14) Non-PLAN_MINUTES Job. Success flow works: Job persisted as DONE,
// but no PeriodUsage row is touched (there isn't one) and
// usageFinalizedAt remains null. Legacy / FREE / admin behaviour.
{
  const store = seedStore();
  makeJob(store, {
    id: "job-14",
    userId: "u14",
    entitlementKind: null,
    reservedMinutes: null,
    periodUsageId: null,
  });
  const client = buildStubClient(store);
  const r = await finalizePlanMinuteUsage(
    { jobId: "job-14", finalJobData: { resultUrl: "/audio/14" } },
    client
  );
  check("Non-plan: ok=true", r.ok, true);
  if (r.ok) {
    check("Non-plan: outcome=no_reservation", r.outcome, "no_reservation");
    check("Non-plan: job.status=DONE", r.job.status, "DONE");
    check("Non-plan: job.resultUrl set", r.job.resultUrl, "/audio/14");
  }
  const j = store.jobs.get("job-14");
  check("Non-plan: status DONE persisted", j?.status, "DONE");
  check("Non-plan: usageFinalizedAt still null", j?.usageFinalizedAt, null);
  check("Non-plan: no PeriodUsage rows created", store.periodUsages.size, 0);
}

// (15) Unknown Job id → JOB_NOT_FOUND, no writes anywhere.
{
  const store = seedStore();
  const client = buildStubClient(store);
  const r = await finalizePlanMinuteUsage(
    { jobId: "does-not-exist", finalJobData: { resultUrl: "/x" } },
    client
  );
  check("Unknown job: ok=false", r.ok, false);
  if (!r.ok) check("Unknown job: error=JOB_NOT_FOUND", r.error, "JOB_NOT_FOUND");
  check("Unknown job: no jobs created", store.jobs.size, 0);
  check("Unknown job: no PeriodUsage rows created", store.periodUsages.size, 0);
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
