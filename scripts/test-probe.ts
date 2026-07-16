// scripts/test-probe.ts
//
// Offline tests for the RP-010 Phase 4A Free Probe Enforcement module
// (lib/entitlement/probe.ts). Exercises the pure duration guard, the pure
// path helper, and the transactional claimProbeAndCreateJob function
// through an in-memory Prisma stub. Run with:
//
//   npx tsx scripts/test-probe.ts
//
// Covers (RP-010 Phase 4A required cases):
//   * Duration guard — 300 / 480 allowed, 299 / 481 rejected, null / NaN /
//     Infinity / negative all controlled-rejected.
//   * Free happy path — first claim ok, counter goes 0→1; second claim ok,
//     counter 1→2; third claim PROBE_LIMIT_REACHED with no writes; a
//     pre-existing counter above the limit is controlled-rejected with no
//     "correcting" write.
//   * Plan separation — STARTER + PREMIUM refused as NOT_FREE_PLAN;
//     expired paid → effective FREE → allowed on probe path; paid with null
//     period follows resolveEffectivePlan (kept paid → NOT_FREE_PLAN).
//   * Atomicity — Job.create failure rolls the counter back; counter-write
//     failure creates no Job; a successful claim increments exactly once
//     and creates exactly one Job.
//   * Race conditions — two parallel claims at counter 0 both succeed and
//     end at 2 with two jobs; three parallel claims at counter 0 keep at
//     most two successes, counter never overshoots 2; two parallel claims
//     at counter 1 keep exactly one success.
//   * Separation — a probe claim never touches credits, never creates a
//     PeriodUsage row, never creates a LibraryUnlock row; the Job it
//     creates has entitlementKind=PROBE, reservedMinutes=null,
//     periodUsageId=null, usageFinalizedAt=null, usageReleasedAt=null.

import {
  claimProbeAndCreateJob,
  isOnProbePath,
  isValidProbeDuration,
  PROBE_MAX_DURATION_SEC,
  PROBE_MIN_DURATION_SEC,
  type ProbeJobCreateData,
} from "../lib/entitlement/probe";
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

check("isValidProbeDuration: 300 → true", isValidProbeDuration(300), true);
check("isValidProbeDuration: 480 → true", isValidProbeDuration(480), true);
check("isValidProbeDuration: 400 → true", isValidProbeDuration(400), true);
check("isValidProbeDuration: 299 → false", isValidProbeDuration(299), false);
check("isValidProbeDuration: 481 → false", isValidProbeDuration(481), false);
check("isValidProbeDuration: 0 → false", isValidProbeDuration(0), false);
check("isValidProbeDuration: -60 → false", isValidProbeDuration(-60), false);
check("isValidProbeDuration: null → false", isValidProbeDuration(null), false);
check(
  "isValidProbeDuration: undefined → false",
  isValidProbeDuration(undefined),
  false
);
check("isValidProbeDuration: NaN → false", isValidProbeDuration(NaN), false);
check(
  "isValidProbeDuration: +Infinity → false",
  isValidProbeDuration(Infinity),
  false
);
check(
  "isValidProbeDuration: -Infinity → false",
  isValidProbeDuration(-Infinity),
  false
);
check(
  "PROBE_MIN_DURATION_SEC = 300",
  PROBE_MIN_DURATION_SEC,
  300
);
check(
  "PROBE_MAX_DURATION_SEC = 480",
  PROBE_MAX_DURATION_SEC,
  480
);

const periodStart = new Date("2026-07-01T00:00:00.000Z");
const periodEnd = new Date("2026-08-01T00:00:00.000Z");
const insidePeriod = new Date("2026-07-15T00:00:00.000Z");
const pastPeriod = new Date("2026-09-01T00:00:00.000Z");

check("isOnProbePath: FREE → true", isOnProbePath("FREE", null, insidePeriod), true);
check(
  "isOnProbePath: FREE with stale period → true",
  isOnProbePath("FREE", periodEnd, insidePeriod),
  true
);
check(
  "isOnProbePath: STARTER active → false",
  isOnProbePath("STARTER", periodEnd, insidePeriod),
  false
);
check(
  "isOnProbePath: PREMIUM active → false",
  isOnProbePath("PREMIUM", periodEnd, insidePeriod),
  false
);
check(
  "isOnProbePath: STARTER expired → true (effective FREE)",
  isOnProbePath("STARTER", periodEnd, pastPeriod),
  true
);
check(
  "isOnProbePath: PREMIUM expired → true (effective FREE)",
  isOnProbePath("PREMIUM", periodEnd, pastPeriod),
  true
);
check(
  "isOnProbePath: PREMIUM with null period → false (kept paid)",
  isOnProbePath("PREMIUM", null, insidePeriod),
  false
);

// ---------------------------------------------------------------------------
// In-memory Prisma stub
// ---------------------------------------------------------------------------
//
// Mirrors the pattern used by scripts/test-reservation.ts but scoped to the
// probe module's surface:
//   - $transaction(async (tx) => …)  — runs against the store; a thrown
//     error rolls every write from the fn back.
//   - user.findUnique   (id, plan, planPeriodEnd, probeGenerationsUsed)
//   - user.updateMany   (atomic conditional increment on probeGenerationsUsed
//                        with a `lt` bound)
//   - job.create        (records the Job with its entitlement fields)
//   - periodUsage.*     (surface preserved so tests can assert probe never
//                        touches PeriodUsage; the module itself never calls
//                        these)
//
// The store also tracks credits (never mutated by the probe path) so we can
// assert the separation invariant.

type StoreUser = {
  id: string;
  plan: Plan;
  planPeriodStart: Date | null;
  planPeriodEnd: Date | null;
  probeGenerationsUsed: number;
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
  periodUsages: Map<string, StorePeriodUsage>;
  jobSeq: number;
  // Test injection hooks. Each is consumed on the next matching call.
  injectJobCreateErrorOnce?: Error;
  injectUserUpdateErrorOnce?: Error;
};

type WriteOp =
  | { kind: "job.create"; jobId: string }
  | {
      kind: "user.probeIncrement";
      userId: string;
      by: number;
      prev: number;
    };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTxOps(store: Store, writes: WriteOp[]) {
  return {
    user: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        const u = store.users.get(where.id);
        if (!u) return null;
        return {
          id: u.id,
          plan: u.plan,
          planPeriodStart: u.planPeriodStart,
          planPeriodEnd: u.planPeriodEnd,
          probeGenerationsUsed: u.probeGenerationsUsed,
          credits: u.credits,
        };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateMany: async ({ where, data }: any) => {
        if (store.injectUserUpdateErrorOnce) {
          const err = store.injectUserUpdateErrorOnce;
          store.injectUserUpdateErrorOnce = undefined;
          throw err;
        }
        const u = store.users.get(where.id);
        if (!u) return { count: 0 };
        // Numeric-bound predicate on probeGenerationsUsed. Mirrors Postgres
        // row-level atomicity for the probe lifetime gate: a single
        // read-check-write in one tick so two concurrent callers never both
        // see a stale value.
        if (
          where.probeGenerationsUsed &&
          typeof where.probeGenerationsUsed.lt === "number" &&
          u.probeGenerationsUsed >= where.probeGenerationsUsed.lt
        ) {
          return { count: 0 };
        }
        const prev = u.probeGenerationsUsed;
        if (
          data.probeGenerationsUsed &&
          "increment" in data.probeGenerationsUsed
        ) {
          u.probeGenerationsUsed += data.probeGenerationsUsed.increment;
          writes.push({
            kind: "user.probeIncrement",
            userId: u.id,
            by: data.probeGenerationsUsed.increment,
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
    // periodUsage surface — should never be called by the probe module.
    // If the module ever regresses and touches it, at least the tests
    // observe that (via store.periodUsages.size) rather than silently
    // succeeding.
    periodUsage: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async () => null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateMany: async () => ({ count: 0 }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async () => {
        throw new Error("probe path must not touch PeriodUsage");
      },
    },
  };
}

function rollback(store: Store, writes: WriteOp[]): void {
  for (let i = writes.length - 1; i >= 0; i--) {
    const w = writes[i];
    if (w.kind === "job.create") {
      store.jobs.delete(w.jobId);
    } else if (w.kind === "user.probeIncrement") {
      const u = store.users.get(w.userId);
      if (u) u.probeGenerationsUsed = w.prev;
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

function jobData(
  userId: string,
  overrides: Partial<ProbeJobCreateData> = {}
): ProbeJobCreateData {
  return {
    userId,
    prompt: "test probe prompt",
    preset: "sleep-story",
    // Prisma's JobStatus enum — the stub stores it as a string, so a literal
    // is fine here without pulling in $Enums.
    status: "QUEUED" as ProbeJobCreateData["status"],
    durationSec: 360,
    title: "Test Probe Title",
    language: "de",
    voiceGender: "female",
    voiceStyle: "soft",
    narrativeMode: null,
    scriptOverride: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// claimProbeAndCreateJob — behaviour tests
// ---------------------------------------------------------------------------

async function runProbeTests(): Promise<void> {

  // (1) USER_NOT_FOUND
  {
    const store = seedStore();
    const client = buildStubClient(store);
    const r = await claimProbeAndCreateJob(
      {
        userId: "missing-user",
        durationSec: 360,
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

  // (2) FREE happy path 0 → 1
  {
    const store = seedStore();
    seedUser(store, {
      id: "u-free-0",
      plan: "FREE",
      probeGenerationsUsed: 0,
    });
    const before = store.users.get("u-free-0")!;
    const beforeCredits = before.credits;
    const client = buildStubClient(store);
    const r = await claimProbeAndCreateJob(
      {
        userId: "u-free-0",
        durationSec: 360,
        jobData: jobData("u-free-0"),
        now: insidePeriod,
      },
      client
    );
    check("Free 0→1: ok=true", r.ok, true);
    if (r.ok) check("Free 0→1: probeGenerationsUsed=1", r.probeGenerationsUsed, 1);
    const u = store.users.get("u-free-0")!;
    check("Free 0→1: counter=1 in store", u.probeGenerationsUsed, 1);
    check("Free 0→1: exactly one Job", store.jobs.size, 1);
    const job = Array.from(store.jobs.values())[0];
    check("Free 0→1: Job.entitlementKind=PROBE", job.entitlementKind, "PROBE");
    check("Free 0→1: Job.reservedMinutes=null", job.reservedMinutes, null);
    check("Free 0→1: Job.periodUsageId=null", job.periodUsageId, null);
    check(
      "Free 0→1: Job.usageFinalizedAt=null",
      job.usageFinalizedAt,
      null
    );
    check("Free 0→1: Job.usageReleasedAt=null", job.usageReleasedAt, null);
    check(
      "Free 0→1: credits untouched",
      store.users.get("u-free-0")?.credits,
      beforeCredits
    );
    check("Free 0→1: no PeriodUsage created", store.periodUsages.size, 0);
  }

  // (3) FREE happy path 1 → 2
  {
    const store = seedStore();
    seedUser(store, {
      id: "u-free-1",
      plan: "FREE",
      probeGenerationsUsed: 1,
    });
    const client = buildStubClient(store);
    const r = await claimProbeAndCreateJob(
      {
        userId: "u-free-1",
        durationSec: 480,
        jobData: jobData("u-free-1"),
        now: insidePeriod,
      },
      client
    );
    check("Free 1→2: ok=true", r.ok, true);
    if (r.ok) check("Free 1→2: probeGenerationsUsed=2", r.probeGenerationsUsed, 2);
    check(
      "Free 1→2: counter=2 in store",
      store.users.get("u-free-1")?.probeGenerationsUsed,
      2
    );
    check("Free 1→2: exactly one Job", store.jobs.size, 1);
  }

  // (4) FREE at limit — third attempt rejected
  {
    const store = seedStore();
    seedUser(store, {
      id: "u-free-2",
      plan: "FREE",
      probeGenerationsUsed: 2,
    });
    const client = buildStubClient(store);
    const r = await claimProbeAndCreateJob(
      {
        userId: "u-free-2",
        durationSec: 360,
        jobData: jobData("u-free-2"),
        now: insidePeriod,
      },
      client
    );
    check("Free 2→…: ok=false", r.ok, false);
    if (!r.ok)
      check("Free 2→…: error=PROBE_LIMIT_REACHED", r.error, "PROBE_LIMIT_REACHED");
    check(
      "Free 2→…: counter unchanged (2)",
      store.users.get("u-free-2")?.probeGenerationsUsed,
      2
    );
    check("Free 2→…: no Job created", store.jobs.size, 0);
  }

  // (5) FREE with pre-existing counter > 2 (should never happen in prod, but
  // the module must refuse deterministically without a "correcting" write).
  {
    const store = seedStore();
    seedUser(store, {
      id: "u-free-3",
      plan: "FREE",
      probeGenerationsUsed: 3,
    });
    const client = buildStubClient(store);
    const r = await claimProbeAndCreateJob(
      {
        userId: "u-free-3",
        durationSec: 360,
        jobData: jobData("u-free-3"),
        now: insidePeriod,
      },
      client
    );
    check("Free >2: ok=false", r.ok, false);
    if (!r.ok)
      check("Free >2: error=PROBE_LIMIT_REACHED", r.error, "PROBE_LIMIT_REACHED");
    check(
      "Free >2: counter unchanged at 3 (no correcting write)",
      store.users.get("u-free-3")?.probeGenerationsUsed,
      3
    );
    check("Free >2: no Job created", store.jobs.size, 0);
  }

  // ---------------------------------------------------------------------------
  // Duration enforcement
  // ---------------------------------------------------------------------------

  // (6) 300 s allowed
  {
    const store = seedStore();
    seedUser(store, { id: "u-d300", plan: "FREE", probeGenerationsUsed: 0 });
    const client = buildStubClient(store);
    const r = await claimProbeAndCreateJob(
      {
        userId: "u-d300",
        durationSec: 300,
        jobData: jobData("u-d300", { durationSec: 300 }),
        now: insidePeriod,
      },
      client
    );
    check("Duration 300: ok=true", r.ok, true);
    check("Duration 300: counter=1", store.users.get("u-d300")?.probeGenerationsUsed, 1);
    check("Duration 300: one Job", store.jobs.size, 1);
  }

  // (7) 480 s allowed
  {
    const store = seedStore();
    seedUser(store, { id: "u-d480", plan: "FREE", probeGenerationsUsed: 0 });
    const client = buildStubClient(store);
    const r = await claimProbeAndCreateJob(
      {
        userId: "u-d480",
        durationSec: 480,
        jobData: jobData("u-d480", { durationSec: 480 }),
        now: insidePeriod,
      },
      client
    );
    check("Duration 480: ok=true", r.ok, true);
    check("Duration 480: counter=1", store.users.get("u-d480")?.probeGenerationsUsed, 1);
    check("Duration 480: one Job", store.jobs.size, 1);
  }

  // (8) 299 s rejected — below lower bound
  {
    const store = seedStore();
    seedUser(store, { id: "u-d299", plan: "FREE", probeGenerationsUsed: 0 });
    const client = buildStubClient(store);
    const r = await claimProbeAndCreateJob(
      {
        userId: "u-d299",
        durationSec: 299,
        jobData: jobData("u-d299", { durationSec: 299 }),
        now: insidePeriod,
      },
      client
    );
    check("Duration 299: ok=false", r.ok, false);
    if (!r.ok)
      check("Duration 299: error=INVALID_PROBE_DURATION", r.error, "INVALID_PROBE_DURATION");
    check(
      "Duration 299: counter unchanged (0)",
      store.users.get("u-d299")?.probeGenerationsUsed,
      0
    );
    check("Duration 299: no Job", store.jobs.size, 0);
  }

  // (9) 481 s rejected — above upper bound
  {
    const store = seedStore();
    seedUser(store, { id: "u-d481", plan: "FREE", probeGenerationsUsed: 0 });
    const client = buildStubClient(store);
    const r = await claimProbeAndCreateJob(
      {
        userId: "u-d481",
        durationSec: 481,
        jobData: jobData("u-d481", { durationSec: 481 }),
        now: insidePeriod,
      },
      client
    );
    check("Duration 481: ok=false", r.ok, false);
    if (!r.ok)
      check("Duration 481: error=INVALID_PROBE_DURATION", r.error, "INVALID_PROBE_DURATION");
    check("Duration 481: counter unchanged", store.users.get("u-d481")?.probeGenerationsUsed, 0);
    check("Duration 481: no Job", store.jobs.size, 0);
  }

  // (10) null / NaN / Infinity / negative
  {
    const store = seedStore();
    seedUser(store, { id: "u-dbad", plan: "FREE", probeGenerationsUsed: 0 });
    const client = buildStubClient(store);
    for (const [label, dur] of [
      ["null", null],
      ["NaN", NaN],
      ["+Infinity", Infinity],
      ["-Infinity", -Infinity],
      ["negative", -300],
      ["zero", 0],
    ] as const) {
      const r = await claimProbeAndCreateJob(
        {
          userId: "u-dbad",
          durationSec: dur as number | null,
          jobData: jobData("u-dbad", { durationSec: dur as number | null }),
          now: insidePeriod,
        },
        client
      );
      check(`Duration ${label}: ok=false`, r.ok, false);
      if (!r.ok)
        check(
          `Duration ${label}: error=INVALID_PROBE_DURATION`,
          r.error,
          "INVALID_PROBE_DURATION"
        );
    }
    check(
      "Duration bad: counter unchanged (0) after 6 attempts",
      store.users.get("u-dbad")?.probeGenerationsUsed,
      0
    );
    check("Duration bad: no Job created", store.jobs.size, 0);
  }

  // ---------------------------------------------------------------------------
  // Plan separation
  // ---------------------------------------------------------------------------

  // (11) STARTER active — refused
  {
    const store = seedStore();
    seedUser(store, {
      id: "u-starter",
      plan: "STARTER",
      planPeriodStart: periodStart,
      planPeriodEnd: periodEnd,
      probeGenerationsUsed: 0,
    });
    const client = buildStubClient(store);
    const r = await claimProbeAndCreateJob(
      {
        userId: "u-starter",
        durationSec: 360,
        jobData: jobData("u-starter"),
        now: insidePeriod,
      },
      client
    );
    check("STARTER: ok=false", r.ok, false);
    if (!r.ok) check("STARTER: error=NOT_FREE_PLAN", r.error, "NOT_FREE_PLAN");
    check(
      "STARTER: counter untouched",
      store.users.get("u-starter")?.probeGenerationsUsed,
      0
    );
    check("STARTER: no Job", store.jobs.size, 0);
  }

  // (12) PREMIUM active — refused
  {
    const store = seedStore();
    seedUser(store, {
      id: "u-premium",
      plan: "PREMIUM",
      planPeriodStart: periodStart,
      planPeriodEnd: periodEnd,
      probeGenerationsUsed: 0,
    });
    const client = buildStubClient(store);
    const r = await claimProbeAndCreateJob(
      {
        userId: "u-premium",
        durationSec: 360,
        jobData: jobData("u-premium"),
        now: insidePeriod,
      },
      client
    );
    check("PREMIUM: ok=false", r.ok, false);
    if (!r.ok) check("PREMIUM: error=NOT_FREE_PLAN", r.error, "NOT_FREE_PLAN");
    check(
      "PREMIUM: counter untouched",
      store.users.get("u-premium")?.probeGenerationsUsed,
      0
    );
    check("PREMIUM: no Job", store.jobs.size, 0);
  }

  // (13) Expired paid plan → effective FREE → probe path allowed
  {
    const store = seedStore();
    seedUser(store, {
      id: "u-expired",
      plan: "STARTER",
      planPeriodStart: periodStart,
      planPeriodEnd: periodEnd,
      probeGenerationsUsed: 0,
    });
    const client = buildStubClient(store);
    const r = await claimProbeAndCreateJob(
      {
        userId: "u-expired",
        durationSec: 360,
        jobData: jobData("u-expired"),
        now: pastPeriod,
      },
      client
    );
    check("Expired paid: ok=true", r.ok, true);
    check(
      "Expired paid: counter=1",
      store.users.get("u-expired")?.probeGenerationsUsed,
      1
    );
    check("Expired paid: one Job", store.jobs.size, 1);
    const job = Array.from(store.jobs.values())[0];
    check("Expired paid: Job.entitlementKind=PROBE", job.entitlementKind, "PROBE");
  }

  // (14) Paid with null period — kept paid by resolveEffectivePlan
  {
    const store = seedStore();
    seedUser(store, {
      id: "u-legacy",
      plan: "PREMIUM",
      planPeriodStart: null,
      planPeriodEnd: null,
      probeGenerationsUsed: 0,
    });
    const client = buildStubClient(store);
    const r = await claimProbeAndCreateJob(
      {
        userId: "u-legacy",
        durationSec: 360,
        jobData: jobData("u-legacy"),
        now: insidePeriod,
      },
      client
    );
    check("Legacy paid (null period): ok=false", r.ok, false);
    if (!r.ok)
      check("Legacy paid (null period): error=NOT_FREE_PLAN", r.error, "NOT_FREE_PLAN");
    check(
      "Legacy paid (null period): counter untouched",
      store.users.get("u-legacy")?.probeGenerationsUsed,
      0
    );
    check("Legacy paid (null period): no Job", store.jobs.size, 0);
  }

  // ---------------------------------------------------------------------------
  // Atomicity
  // ---------------------------------------------------------------------------

  // (15) Job.create failure — counter rollback, no Job.
  {
    const store = seedStore();
    seedUser(store, { id: "u-jce", plan: "FREE", probeGenerationsUsed: 0 });
    store.injectJobCreateErrorOnce = new Error("job create boom");
    const client = buildStubClient(store);
    let threw = false;
    try {
      await claimProbeAndCreateJob(
        {
          userId: "u-jce",
          durationSec: 360,
          jobData: jobData("u-jce"),
          now: insidePeriod,
        },
        client
      );
    } catch {
      threw = true;
    }
    check("Job.create failure: exception propagated", threw, true);
    check(
      "Job.create failure: counter rolled back to 0",
      store.users.get("u-jce")?.probeGenerationsUsed,
      0
    );
    check("Job.create failure: no Job", store.jobs.size, 0);
  }

  // (16) Counter update failure — no Job.
  {
    const store = seedStore();
    seedUser(store, { id: "u-uue", plan: "FREE", probeGenerationsUsed: 0 });
    store.injectUserUpdateErrorOnce = new Error("counter update boom");
    const client = buildStubClient(store);
    let threw = false;
    try {
      await claimProbeAndCreateJob(
        {
          userId: "u-uue",
          durationSec: 360,
          jobData: jobData("u-uue"),
          now: insidePeriod,
        },
        client
      );
    } catch {
      threw = true;
    }
    check("Counter update failure: exception propagated", threw, true);
    check(
      "Counter update failure: counter stays at 0",
      store.users.get("u-uue")?.probeGenerationsUsed,
      0
    );
    check("Counter update failure: no Job", store.jobs.size, 0);
  }

  // (17) Successful claim: exactly one increment + exactly one Job.
  // (Serves as a redundant guard against silent double-writes.)
  {
    const store = seedStore();
    seedUser(store, { id: "u-once", plan: "FREE", probeGenerationsUsed: 0 });
    const client = buildStubClient(store);
    const r = await claimProbeAndCreateJob(
      {
        userId: "u-once",
        durationSec: 360,
        jobData: jobData("u-once"),
        now: insidePeriod,
      },
      client
    );
    check("Single claim: ok=true", r.ok, true);
    check(
      "Single claim: counter=1 (exactly one increment)",
      store.users.get("u-once")?.probeGenerationsUsed,
      1
    );
    check("Single claim: exactly one Job", store.jobs.size, 1);
  }

  // ---------------------------------------------------------------------------
  // Race conditions
  // ---------------------------------------------------------------------------

  // (18) Two parallel claims at counter 0 — both succeed, end at 2.
  {
    const store = seedStore();
    seedUser(store, { id: "u-race2", plan: "FREE", probeGenerationsUsed: 0 });
    const client = buildStubClient(store);
    const results = await Promise.all([
      claimProbeAndCreateJob(
        {
          userId: "u-race2",
          durationSec: 360,
          jobData: jobData("u-race2"),
          now: insidePeriod,
        },
        client
      ),
      claimProbeAndCreateJob(
        {
          userId: "u-race2",
          durationSec: 360,
          jobData: jobData("u-race2"),
          now: insidePeriod,
        },
        client
      ),
    ]);
    check(
      "Race 0×2: both succeeded",
      results.every((r) => r.ok),
      true
    );
    check(
      "Race 0×2: counter=2",
      store.users.get("u-race2")?.probeGenerationsUsed,
      2
    );
    check("Race 0×2: exactly two Jobs", store.jobs.size, 2);
    const jobs = Array.from(store.jobs.values());
    check(
      "Race 0×2: both jobs tagged PROBE",
      jobs.every((j) => j.entitlementKind === "PROBE"),
      true
    );
  }

  // (19) Three parallel claims at counter 0 — at most two succeed, no overflow.
  {
    const store = seedStore();
    seedUser(store, { id: "u-race3", plan: "FREE", probeGenerationsUsed: 0 });
    const client = buildStubClient(store);
    const results = await Promise.all([
      claimProbeAndCreateJob(
        {
          userId: "u-race3",
          durationSec: 360,
          jobData: jobData("u-race3"),
          now: insidePeriod,
        },
        client
      ),
      claimProbeAndCreateJob(
        {
          userId: "u-race3",
          durationSec: 360,
          jobData: jobData("u-race3"),
          now: insidePeriod,
        },
        client
      ),
      claimProbeAndCreateJob(
        {
          userId: "u-race3",
          durationSec: 360,
          jobData: jobData("u-race3"),
          now: insidePeriod,
        },
        client
      ),
    ]);
    const okCount = results.filter((r) => r.ok).length;
    const rejectedCount = results.filter(
      (r) => !r.ok && r.error === "PROBE_LIMIT_REACHED"
    ).length;
    check("Race 0×3: exactly two succeeded", okCount, 2);
    check("Race 0×3: exactly one rejected as PROBE_LIMIT_REACHED", rejectedCount, 1);
    check(
      "Race 0×3: counter=2 (never overshoots)",
      store.users.get("u-race3")?.probeGenerationsUsed,
      2
    );
    check("Race 0×3: exactly two Jobs", store.jobs.size, 2);
  }

  // (20) Two parallel claims at counter 1 — exactly one succeeds.
  {
    const store = seedStore();
    seedUser(store, { id: "u-race1", plan: "FREE", probeGenerationsUsed: 1 });
    const client = buildStubClient(store);
    const results = await Promise.all([
      claimProbeAndCreateJob(
        {
          userId: "u-race1",
          durationSec: 360,
          jobData: jobData("u-race1"),
          now: insidePeriod,
        },
        client
      ),
      claimProbeAndCreateJob(
        {
          userId: "u-race1",
          durationSec: 360,
          jobData: jobData("u-race1"),
          now: insidePeriod,
        },
        client
      ),
    ]);
    const okCount = results.filter((r) => r.ok).length;
    const rejectedCount = results.filter(
      (r) => !r.ok && r.error === "PROBE_LIMIT_REACHED"
    ).length;
    check("Race 1×2: exactly one succeeded", okCount, 1);
    check("Race 1×2: exactly one rejected", rejectedCount, 1);
    check(
      "Race 1×2: counter=2 (never overshoots)",
      store.users.get("u-race1")?.probeGenerationsUsed,
      2
    );
    check("Race 1×2: exactly one Job", store.jobs.size, 1);
  }

  // ---------------------------------------------------------------------------
  // Separation from credits / PeriodUsage
  // ---------------------------------------------------------------------------

  // (21) Probe claim never touches credits or PeriodUsage.
  {
    const store = seedStore();
    seedUser(store, {
      id: "u-sep",
      plan: "FREE",
      probeGenerationsUsed: 0,
      credits: 7,
    });
    const client = buildStubClient(store);
    const r = await claimProbeAndCreateJob(
      {
        userId: "u-sep",
        durationSec: 360,
        jobData: jobData("u-sep"),
        now: insidePeriod,
      },
      client
    );
    check("Separation: ok=true", r.ok, true);
    check(
      "Separation: credits unchanged (still 7)",
      store.users.get("u-sep")?.credits,
      7
    );
    check("Separation: PeriodUsage store empty", store.periodUsages.size, 0);
    const job = Array.from(store.jobs.values())[0];
    check("Separation: reservedMinutes=null", job.reservedMinutes, null);
    check("Separation: periodUsageId=null", job.periodUsageId, null);
    check("Separation: entitlementKind=PROBE", job.entitlementKind, "PROBE");
  }

  // (22) Cross-user isolation: two Free users, each with their own counter.
  {
    const store = seedStore();
    seedUser(store, { id: "u-a", plan: "FREE", probeGenerationsUsed: 0 });
    seedUser(store, { id: "u-b", plan: "FREE", probeGenerationsUsed: 1 });
    const client = buildStubClient(store);
    await claimProbeAndCreateJob(
      {
        userId: "u-a",
        durationSec: 360,
        jobData: jobData("u-a"),
        now: insidePeriod,
      },
      client
    );
    await claimProbeAndCreateJob(
      {
        userId: "u-b",
        durationSec: 360,
        jobData: jobData("u-b"),
        now: insidePeriod,
      },
      client
    );
    check("Cross-user: u-a counter=1", store.users.get("u-a")?.probeGenerationsUsed, 1);
    check("Cross-user: u-b counter=2", store.users.get("u-b")?.probeGenerationsUsed, 2);
    check("Cross-user: two Jobs total", store.jobs.size, 2);
  }
}

// ---------------------------------------------------------------------------

runProbeTests()
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
