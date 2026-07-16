// scripts/test-probe-restoration.ts
//
// Offline tests for the RP-010 Phase 4A-2 Probe Restoration module
// (lib/entitlement/probe-restoration.ts). Exercises restoreProbeOnTerminalFailure
// through an in-memory Prisma stub. Run with:
//
//   npx tsx scripts/test-probe-restoration.ts
//
// Covers (RP-010 Phase 4A-2 required cases):
//   * Happy path — PROBE Job counter 2 → 1, probeRestoredAt set, FAILED
//     persisted; counter 1 → 0 also allowed; restoration is independent
//     of ttsStartedAt (fires before AND after TTS).
//   * Idempotency — a second restoration call preserves counter and
//     timestamp; parallel restoration calls collapse to exactly one
//     decrement.
//   * Successful jobs — DONE probe jobs are refused with ALREADY_COMPLETED
//     and the counter is untouched; a probe that reaches DONE via the
//     success path stays permanently spent (no probeRestoredAt written).
//   * Invalid states — non-PROBE Jobs refused; missing Job → JOB_NOT_FOUND;
//     counter at 0 → PROBE_COUNTER_UNDERFLOW with a full rollback; missing
//     user → USER_NOT_FOUND with a full rollback.
//   * Rollback — user-counter write failure rolls the Job CAS back
//     (probeRestoredAt stays null); Job CAS failure leaves the counter
//     untouched.
//   * Separation — restoration never mutates credits, PeriodUsage,
//     LibraryUnlock, reservedMinutes, periodUsageId, usageFinalizedAt,
//     usageReleasedAt, or creditRefundedAt.

import {
  restoreProbeOnTerminalFailure,
} from "../lib/entitlement/probe-restoration";
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

function checkTruthy(name: string, actual: unknown): void {
  if (actual) {
    console.log(`[PASS] ${name}`);
    passed++;
  } else {
    console.log(`[FAIL] ${name}\n       expected truthy, got=${String(actual)}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// In-memory Prisma stub
// ---------------------------------------------------------------------------
//
// Mirrors scripts/test-probe.ts and scripts/test-release.ts:
//   - $transaction(async (tx) => …) runs against the store; a thrown error
//     rolls every write from the fn back via a per-tx WriteOp journal.
//   - Only the surface actually used by probe-restoration.ts is
//     implemented; the periodUsage / credit surfaces are preserved so we
//     can assert the module never touches them.

type StoreUser = {
  id: string;
  probeGenerationsUsed: number;
  credits: number;
};
type StoreJob = {
  id: string;
  userId: string;
  status: "QUEUED" | "PROCESSING" | "DONE" | "FAILED";
  entitlementKind: EntitlementKind | null;
  reservedMinutes: number | null;
  periodUsageId: string | null;
  usageFinalizedAt: Date | null;
  usageReleasedAt: Date | null;
  probeRestoredAt: Date | null;
  ttsStartedAt: Date | null;
  creditRefundedAt: Date | null;
  error: string | null;
};
type StorePeriodUsage = { id: string; minutesUsed: number; minutesReserved: number };
type StoreLibraryUnlock = { id: string; userId: string };

type Store = {
  users: Map<string, StoreUser>;
  jobs: Map<string, StoreJob>;
  periodUsages: Map<string, StorePeriodUsage>;
  libraryUnlocks: Map<string, StoreLibraryUnlock>;
  // Test injection hooks. Each is consumed on the next matching call.
  injectUserUpdateManyErrorOnce?: Error;
  injectJobUpdateManyErrorOnce?: Error;
};

type WriteOp =
  | {
      kind: "user.probeDecrement";
      userId: string;
      by: number;
      prev: number;
    }
  | {
      kind: "job.update";
      jobId: string;
      prev: {
        status: StoreJob["status"];
        error: string | null;
        probeRestoredAt: Date | null;
      };
    };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTxOps(store: Store, writes: WriteOp[]) {
  return {
    user: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where, select }: any) => {
        const u = store.users.get(where.id);
        if (!u) return null;
        const out = {} as Record<string, unknown>;
        if (!select || select.id) out.id = u.id;
        if (select?.probeGenerationsUsed) out.probeGenerationsUsed = u.probeGenerationsUsed;
        if (select?.credits) out.credits = u.credits;
        return out;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateMany: async ({ where, data }: any) => {
        if (store.injectUserUpdateManyErrorOnce) {
          const err = store.injectUserUpdateManyErrorOnce;
          store.injectUserUpdateManyErrorOnce = undefined;
          throw err;
        }
        const u = store.users.get(where.id);
        if (!u) return { count: 0 };
        // Numeric-bound guard on probeGenerationsUsed (gt: 0). Mirrors the
        // Postgres row-level atomicity of the underflow gate: two concurrent
        // callers at counter 1 never both see > 0.
        if (
          where.probeGenerationsUsed &&
          typeof where.probeGenerationsUsed.gt === "number" &&
          u.probeGenerationsUsed <= where.probeGenerationsUsed.gt
        ) {
          return { count: 0 };
        }
        const prev = u.probeGenerationsUsed;
        if (
          data.probeGenerationsUsed &&
          "decrement" in data.probeGenerationsUsed
        ) {
          u.probeGenerationsUsed -= data.probeGenerationsUsed.decrement;
          writes.push({
            kind: "user.probeDecrement",
            userId: u.id,
            by: data.probeGenerationsUsed.decrement,
            prev,
          });
        }
        return { count: 1 };
      },
    },
    job: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where, select }: any) => {
        const j = store.jobs.get(where.id);
        if (!j) return null;
        const out = {} as Record<string, unknown>;
        if (!select || select.id) out.id = j.id;
        if (select?.userId) out.userId = j.userId;
        if (select?.status) out.status = j.status;
        if (select?.entitlementKind) out.entitlementKind = j.entitlementKind;
        if (select?.probeRestoredAt) out.probeRestoredAt = j.probeRestoredAt;
        if (select?.error !== undefined) out.error = j.error;
        return out;
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
        // CAS guards used by restoreProbeOnTerminalFailure:
        //   entitlementKind = PROBE
        //   probeRestoredAt IS NULL
        //   status != DONE
        if (
          where.entitlementKind !== undefined &&
          j.entitlementKind !== where.entitlementKind
        ) {
          return { count: 0 };
        }
        if (where.probeRestoredAt === null && j.probeRestoredAt !== null) {
          return { count: 0 };
        }
        if (
          where.status &&
          typeof where.status === "object" &&
          "not" in where.status &&
          j.status === where.status.not
        ) {
          return { count: 0 };
        }
        // Snapshot for rollback
        writes.push({
          kind: "job.update",
          jobId: j.id,
          prev: {
            status: j.status,
            error: j.error,
            probeRestoredAt: j.probeRestoredAt,
          },
        });
        if (data.probeRestoredAt !== undefined) j.probeRestoredAt = data.probeRestoredAt;
        if (data.status !== undefined) j.status = data.status;
        if (data.error !== undefined) j.error = data.error;
        return { count: 1 };
      },
    },
    // periodUsage / libraryUnlock surfaces preserved for regression: a
    // future change that regresses separation will throw here rather
    // than silently succeeding.
    periodUsage: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async () => {
        throw new Error("probe-restoration must not read PeriodUsage");
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateMany: async () => {
        throw new Error("probe-restoration must not write PeriodUsage");
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: async () => {
        throw new Error("probe-restoration must not update PeriodUsage");
      },
    },
    libraryUnlock: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async () => {
        throw new Error("probe-restoration must not create LibraryUnlock");
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: async () => {
        throw new Error("probe-restoration must not update LibraryUnlock");
      },
    },
  };
}

function rollback(store: Store, writes: WriteOp[]): void {
  for (let i = writes.length - 1; i >= 0; i--) {
    const w = writes[i];
    if (w.kind === "user.probeDecrement") {
      const u = store.users.get(w.userId);
      if (u) u.probeGenerationsUsed = w.prev;
    } else if (w.kind === "job.update") {
      const j = store.jobs.get(w.jobId);
      if (j) {
        j.status = w.prev.status;
        j.error = w.prev.error;
        j.probeRestoredAt = w.prev.probeRestoredAt;
      }
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
    libraryUnlocks: new Map<string, StoreLibraryUnlock>(),
  };
}

function seedUser(
  store: Store,
  u: { id: string; probeGenerationsUsed?: number; credits?: number }
): void {
  store.users.set(u.id, {
    id: u.id,
    probeGenerationsUsed: u.probeGenerationsUsed ?? 0,
    credits: u.credits ?? 100,
  });
}

function seedJob(
  store: Store,
  j: {
    id: string;
    userId: string;
    status?: StoreJob["status"];
    entitlementKind?: EntitlementKind | null;
    reservedMinutes?: number | null;
    periodUsageId?: string | null;
    usageFinalizedAt?: Date | null;
    usageReleasedAt?: Date | null;
    probeRestoredAt?: Date | null;
    ttsStartedAt?: Date | null;
    creditRefundedAt?: Date | null;
    error?: string | null;
  }
): void {
  store.jobs.set(j.id, {
    id: j.id,
    userId: j.userId,
    status: j.status ?? "PROCESSING",
    entitlementKind:
      j.entitlementKind === undefined
        ? ("PROBE" as EntitlementKind)
        : j.entitlementKind,
    reservedMinutes: j.reservedMinutes ?? null,
    periodUsageId: j.periodUsageId ?? null,
    usageFinalizedAt: j.usageFinalizedAt ?? null,
    usageReleasedAt: j.usageReleasedAt ?? null,
    probeRestoredAt: j.probeRestoredAt ?? null,
    ttsStartedAt: j.ttsStartedAt ?? null,
    creditRefundedAt: j.creditRefundedAt ?? null,
    error: j.error ?? null,
  });
}

function snapshotJob(store: Store, id: string) {
  const j = store.jobs.get(id);
  if (!j) return null;
  return {
    status: j.status,
    error: j.error,
    probeRestoredAt: j.probeRestoredAt,
    reservedMinutes: j.reservedMinutes,
    periodUsageId: j.periodUsageId,
    usageFinalizedAt: j.usageFinalizedAt,
    usageReleasedAt: j.usageReleasedAt,
    creditRefundedAt: j.creditRefundedAt,
    ttsStartedAt: j.ttsStartedAt,
  };
}

// ---------------------------------------------------------------------------
// restoreProbeOnTerminalFailure — behaviour tests
// ---------------------------------------------------------------------------

async function runProbeRestorationTests(): Promise<void> {
  const now = new Date("2026-07-16T12:00:00.000Z");

  // ── Happy path ─────────────────────────────────────────────────────────

  // (1) Counter 2 → 1, probeRestoredAt set, status → FAILED
  {
    const store = seedStore();
    seedUser(store, { id: "u1", probeGenerationsUsed: 2, credits: 42 });
    seedJob(store, { id: "j1", userId: "u1", status: "PROCESSING" });
    const client = buildStubClient(store);
    const before = snapshotJob(store, "j1");
    const r = await restoreProbeOnTerminalFailure(
      { jobId: "j1", error: "TTS failed", now },
      client
    );
    check("Happy 2→1: ok=true", r.ok, true);
    if (r.ok) {
      check("Happy 2→1: outcome=restored", r.outcome, "restored");
      check("Happy 2→1: counterRestored=true", r.counterRestored, true);
      check("Happy 2→1: job.status=FAILED", r.job.status, "FAILED");
      check("Happy 2→1: job.error=TTS failed", r.job.error, "TTS failed");
      checkTruthy("Happy 2→1: job.probeRestoredAt set", r.job.probeRestoredAt);
    }
    check("Happy 2→1: counter=1 in store", store.users.get("u1")?.probeGenerationsUsed, 1);
    const after = snapshotJob(store, "j1")!;
    check("Happy 2→1: status=FAILED", after.status, "FAILED");
    check("Happy 2→1: probeRestoredAt=now", after.probeRestoredAt?.getTime(), now.getTime());
    check("Happy 2→1: credits untouched", store.users.get("u1")?.credits, 42);
    check("Happy 2→1: creditRefundedAt untouched", after.creditRefundedAt, before?.creditRefundedAt ?? null);
    check("Happy 2→1: usageFinalizedAt untouched", after.usageFinalizedAt, before?.usageFinalizedAt ?? null);
    check("Happy 2→1: usageReleasedAt untouched", after.usageReleasedAt, before?.usageReleasedAt ?? null);
    check("Happy 2→1: reservedMinutes untouched", after.reservedMinutes, before?.reservedMinutes ?? null);
    check("Happy 2→1: periodUsageId untouched", after.periodUsageId, before?.periodUsageId ?? null);
  }

  // (2) Counter 1 → 0 allowed
  {
    const store = seedStore();
    seedUser(store, { id: "u2", probeGenerationsUsed: 1 });
    seedJob(store, { id: "j2", userId: "u2" });
    const client = buildStubClient(store);
    const r = await restoreProbeOnTerminalFailure(
      { jobId: "j2", error: "safety", now },
      client
    );
    check("Happy 1→0: ok=true", r.ok, true);
    check("Happy 1→0: counter=0", store.users.get("u2")?.probeGenerationsUsed, 0);
    checkTruthy("Happy 1→0: probeRestoredAt set", store.jobs.get("j2")?.probeRestoredAt);
  }

  // (3a) Restoration BEFORE TTS starts
  {
    const store = seedStore();
    seedUser(store, { id: "u3a", probeGenerationsUsed: 2 });
    seedJob(store, { id: "j3a", userId: "u3a", ttsStartedAt: null });
    const client = buildStubClient(store);
    const r = await restoreProbeOnTerminalFailure(
      { jobId: "j3a", error: "script empty", now },
      client
    );
    check("Before TTS: ok=true", r.ok, true);
    check("Before TTS: counter=1", store.users.get("u3a")?.probeGenerationsUsed, 1);
  }

  // (3b) Restoration AFTER TTS starts (probe slots are only spent on DONE)
  {
    const store = seedStore();
    seedUser(store, { id: "u3b", probeGenerationsUsed: 2 });
    seedJob(store, {
      id: "j3b",
      userId: "u3b",
      ttsStartedAt: new Date("2026-07-16T11:59:00.000Z"),
    });
    const client = buildStubClient(store);
    const r = await restoreProbeOnTerminalFailure(
      { jobId: "j3b", error: "store audio failed", now },
      client
    );
    check("After TTS: ok=true", r.ok, true);
    check("After TTS: counter=1", store.users.get("u3b")?.probeGenerationsUsed, 1);
    check(
      "After TTS: ttsStartedAt preserved",
      store.jobs.get("j3b")?.ttsStartedAt?.getTime(),
      new Date("2026-07-16T11:59:00.000Z").getTime()
    );
  }

  // ── Idempotency ────────────────────────────────────────────────────────

  // (4) Second restoration call — counter unchanged, timestamp unchanged
  {
    const store = seedStore();
    seedUser(store, { id: "u4", probeGenerationsUsed: 2 });
    seedJob(store, { id: "j4", userId: "u4" });
    const client = buildStubClient(store);
    const r1 = await restoreProbeOnTerminalFailure(
      { jobId: "j4", error: "e", now },
      client
    );
    check("Idempotent: first ok=true", r1.ok, true);
    const firstTs = store.jobs.get("j4")?.probeRestoredAt;
    check("Idempotent: counter=1 after first", store.users.get("u4")?.probeGenerationsUsed, 1);

    const later = new Date("2026-07-16T13:00:00.000Z");
    const r2 = await restoreProbeOnTerminalFailure(
      { jobId: "j4", error: "different", now: later },
      client
    );
    check("Idempotent: second ok=true", r2.ok, true);
    if (r2.ok) {
      check("Idempotent: second outcome=already_restored", r2.outcome, "already_restored");
      check("Idempotent: second counterRestored=false", r2.counterRestored, false);
    }
    check(
      "Idempotent: counter unchanged (still 1)",
      store.users.get("u4")?.probeGenerationsUsed,
      1
    );
    check(
      "Idempotent: probeRestoredAt unchanged",
      store.jobs.get("j4")?.probeRestoredAt?.getTime(),
      firstTs?.getTime()
    );
    // status stays FAILED (already set by first call); error text NOT overwritten
    check("Idempotent: status still FAILED", store.jobs.get("j4")?.status, "FAILED");
    check("Idempotent: error preserved from first call", store.jobs.get("j4")?.error, "e");
  }

  // (5) Two parallel restoration calls — exactly one decrement.
  //
  // Note: the in-memory stub does not truly simulate DB row-level locking
  // across parallel Promises, but the same $transaction-per-call pattern
  // used by test-release.ts guarantees that the CAS on probeRestoredAt
  // observes the *first* commit before the second one runs, because each
  // $transaction runs its fn synchronously and rolls back on throw.
  // Running Promise.all on the two calls therefore models the guarantee
  // that at most one decrement is applied.
  {
    const store = seedStore();
    seedUser(store, { id: "u5", probeGenerationsUsed: 2 });
    seedJob(store, { id: "j5", userId: "u5" });
    const client = buildStubClient(store);
    const results = await Promise.all([
      restoreProbeOnTerminalFailure({ jobId: "j5", error: "a", now }, client),
      restoreProbeOnTerminalFailure({ jobId: "j5", error: "b", now }, client),
    ]);
    const okRestored = results.filter(
      (r) => r.ok && r.outcome === "restored"
    ).length;
    const okAlready = results.filter(
      (r) => r.ok && r.outcome === "already_restored"
    ).length;
    check("Parallel: exactly one restored", okRestored, 1);
    check("Parallel: exactly one already_restored", okAlready, 1);
    check(
      "Parallel: counter=1 (single decrement)",
      store.users.get("u5")?.probeGenerationsUsed,
      1
    );
  }

  // ── Successful jobs ───────────────────────────────────────────────────

  // (6) DONE probe — refused, counter unchanged.
  {
    const store = seedStore();
    seedUser(store, { id: "u6", probeGenerationsUsed: 2 });
    seedJob(store, { id: "j6", userId: "u6", status: "DONE" });
    const client = buildStubClient(store);
    const r = await restoreProbeOnTerminalFailure(
      { jobId: "j6", error: "e", now },
      client
    );
    check("DONE probe: ok=false", r.ok, false);
    if (!r.ok) check("DONE probe: error=ALREADY_COMPLETED", r.error, "ALREADY_COMPLETED");
    check(
      "DONE probe: counter unchanged (still 2)",
      store.users.get("u6")?.probeGenerationsUsed,
      2
    );
    check("DONE probe: status still DONE", store.jobs.get("j6")?.status, "DONE");
    check("DONE probe: probeRestoredAt still null", store.jobs.get("j6")?.probeRestoredAt, null);
  }

  // (7) Successful probe stays permanently spent — no probeRestoredAt.
  // (Simulates the post-finalize state.)
  {
    const store = seedStore();
    seedUser(store, { id: "u7", probeGenerationsUsed: 2 });
    seedJob(store, { id: "j7", userId: "u7", status: "DONE", probeRestoredAt: null });
    const client = buildStubClient(store);
    const r = await restoreProbeOnTerminalFailure(
      { jobId: "j7", error: "late-error", now },
      client
    );
    check("Success stays spent: ok=false", r.ok, false);
    if (!r.ok) check("Success stays spent: error=ALREADY_COMPLETED", r.error, "ALREADY_COMPLETED");
    check(
      "Success stays spent: counter still=2",
      store.users.get("u7")?.probeGenerationsUsed,
      2
    );
    check(
      "Success stays spent: probeRestoredAt still null",
      store.jobs.get("j7")?.probeRestoredAt,
      null
    );
  }

  // ── Invalid states ────────────────────────────────────────────────────

  // (8) Non-PROBE Job (PLAN_MINUTES) refused, counter unchanged.
  {
    const store = seedStore();
    seedUser(store, { id: "u8", probeGenerationsUsed: 2 });
    seedJob(store, {
      id: "j8",
      userId: "u8",
      entitlementKind: "PLAN_MINUTES" as EntitlementKind,
      reservedMinutes: 5,
      periodUsageId: "pu-1",
    });
    const client = buildStubClient(store);
    const r = await restoreProbeOnTerminalFailure(
      { jobId: "j8", error: "e", now },
      client
    );
    check("Non-PROBE (PLAN_MINUTES): ok=false", r.ok, false);
    if (!r.ok) check("Non-PROBE (PLAN_MINUTES): error=NOT_PROBE_JOB", r.error, "NOT_PROBE_JOB");
    check(
      "Non-PROBE: counter unchanged",
      store.users.get("u8")?.probeGenerationsUsed,
      2
    );
    check("Non-PROBE: reservedMinutes preserved", store.jobs.get("j8")?.reservedMinutes, 5);
    check("Non-PROBE: periodUsageId preserved", store.jobs.get("j8")?.periodUsageId, "pu-1");
    check("Non-PROBE: probeRestoredAt still null", store.jobs.get("j8")?.probeRestoredAt, null);
  }

  // (8b) Non-PROBE Job (null entitlementKind — legacy) refused.
  {
    const store = seedStore();
    seedUser(store, { id: "u8b", probeGenerationsUsed: 2 });
    seedJob(store, { id: "j8b", userId: "u8b", entitlementKind: null });
    const client = buildStubClient(store);
    const r = await restoreProbeOnTerminalFailure(
      { jobId: "j8b", error: "e", now },
      client
    );
    check("Non-PROBE (null): ok=false", r.ok, false);
    if (!r.ok) check("Non-PROBE (null): error=NOT_PROBE_JOB", r.error, "NOT_PROBE_JOB");
    check("Non-PROBE (null): counter unchanged", store.users.get("u8b")?.probeGenerationsUsed, 2);
  }

  // (9) Job missing.
  {
    const store = seedStore();
    seedUser(store, { id: "u9", probeGenerationsUsed: 2 });
    const client = buildStubClient(store);
    const r = await restoreProbeOnTerminalFailure(
      { jobId: "missing", error: "e", now },
      client
    );
    check("Missing job: ok=false", r.ok, false);
    if (!r.ok) check("Missing job: error=JOB_NOT_FOUND", r.error, "JOB_NOT_FOUND");
    check("Missing job: counter unchanged", store.users.get("u9")?.probeGenerationsUsed, 2);
  }

  // (10) Counter already 0 → PROBE_COUNTER_UNDERFLOW; full rollback.
  {
    const store = seedStore();
    seedUser(store, { id: "u10", probeGenerationsUsed: 0 });
    seedJob(store, { id: "j10", userId: "u10", status: "PROCESSING" });
    const client = buildStubClient(store);
    const before = snapshotJob(store, "j10");
    const r = await restoreProbeOnTerminalFailure(
      { jobId: "j10", error: "e", now },
      client
    );
    check("Underflow: ok=false", r.ok, false);
    if (!r.ok) check("Underflow: error=PROBE_COUNTER_UNDERFLOW", r.error, "PROBE_COUNTER_UNDERFLOW");
    check("Underflow: counter stays 0", store.users.get("u10")?.probeGenerationsUsed, 0);
    const after = snapshotJob(store, "j10")!;
    check("Underflow: status rolled back", after.status, before?.status ?? "PROCESSING");
    check("Underflow: probeRestoredAt rolled back to null", after.probeRestoredAt, null);
    check("Underflow: error rolled back", after.error, before?.error ?? null);
  }

  // (11) User missing → USER_NOT_FOUND; full rollback.
  {
    const store = seedStore();
    // Note: no seedUser
    seedJob(store, { id: "j11", userId: "u-missing", status: "PROCESSING" });
    const client = buildStubClient(store);
    const before = snapshotJob(store, "j11");
    const r = await restoreProbeOnTerminalFailure(
      { jobId: "j11", error: "e", now },
      client
    );
    check("User missing: ok=false", r.ok, false);
    if (!r.ok) check("User missing: error=USER_NOT_FOUND", r.error, "USER_NOT_FOUND");
    const after = snapshotJob(store, "j11")!;
    check("User missing: status rolled back", after.status, before?.status ?? "PROCESSING");
    check("User missing: probeRestoredAt rolled back to null", after.probeRestoredAt, null);
  }

  // ── Rollback ──────────────────────────────────────────────────────────

  // (12) User-counter write failure — Job stays unrestored (timestamp null).
  {
    const store = seedStore();
    seedUser(store, { id: "u12", probeGenerationsUsed: 2 });
    seedJob(store, { id: "j12", userId: "u12", status: "PROCESSING" });
    store.injectUserUpdateManyErrorOnce = new Error("user boom");
    const client = buildStubClient(store);
    let threw = false;
    try {
      await restoreProbeOnTerminalFailure(
        { jobId: "j12", error: "e", now },
        client
      );
    } catch {
      threw = true;
    }
    check("User-write fail: exception propagated", threw, true);
    check("User-write fail: counter unchanged", store.users.get("u12")?.probeGenerationsUsed, 2);
    check("User-write fail: probeRestoredAt=null", store.jobs.get("j12")?.probeRestoredAt, null);
    check("User-write fail: status=PROCESSING", store.jobs.get("j12")?.status, "PROCESSING");
  }

  // (13) Job CAS failure — counter unchanged.
  {
    const store = seedStore();
    seedUser(store, { id: "u13", probeGenerationsUsed: 2 });
    seedJob(store, { id: "j13", userId: "u13", status: "PROCESSING" });
    store.injectJobUpdateManyErrorOnce = new Error("job cas boom");
    const client = buildStubClient(store);
    let threw = false;
    try {
      await restoreProbeOnTerminalFailure(
        { jobId: "j13", error: "e", now },
        client
      );
    } catch {
      threw = true;
    }
    check("Job-CAS fail: exception propagated", threw, true);
    check("Job-CAS fail: counter unchanged", store.users.get("u13")?.probeGenerationsUsed, 2);
    check("Job-CAS fail: probeRestoredAt=null", store.jobs.get("j13")?.probeRestoredAt, null);
    check("Job-CAS fail: status=PROCESSING", store.jobs.get("j13")?.status, "PROCESSING");
  }

  // ── persistFailedStatus=false ────────────────────────────────────────

  // (14) With persistFailedStatus=false, status is left untouched but
  // counter is still restored.
  {
    const store = seedStore();
    seedUser(store, { id: "u14", probeGenerationsUsed: 2 });
    seedJob(store, { id: "j14", userId: "u14", status: "PROCESSING" });
    const client = buildStubClient(store);
    const r = await restoreProbeOnTerminalFailure(
      { jobId: "j14", persistFailedStatus: false, now },
      client
    );
    check("persistFailedStatus=false: ok=true", r.ok, true);
    check("persistFailedStatus=false: counter=1", store.users.get("u14")?.probeGenerationsUsed, 1);
    check(
      "persistFailedStatus=false: status untouched",
      store.jobs.get("j14")?.status,
      "PROCESSING"
    );
    checkTruthy(
      "persistFailedStatus=false: probeRestoredAt set",
      store.jobs.get("j14")?.probeRestoredAt
    );
  }

  // ── Separation ────────────────────────────────────────────────────────

  // (15) Restoration touches no credits, no PeriodUsage, no LibraryUnlock.
  // The stub throws if PeriodUsage / LibraryUnlock surfaces are ever hit,
  // so a passing run of test (1) already proves this. Redundant explicit
  // guard:
  {
    const store = seedStore();
    seedUser(store, { id: "u15", probeGenerationsUsed: 2, credits: 99 });
    seedJob(store, {
      id: "j15",
      userId: "u15",
      creditRefundedAt: new Date("2026-01-01"),
      reservedMinutes: null,
      periodUsageId: null,
      usageFinalizedAt: null,
      usageReleasedAt: null,
    });
    const client = buildStubClient(store);
    const r = await restoreProbeOnTerminalFailure(
      { jobId: "j15", error: "e", now },
      client
    );
    check("Separation: ok=true", r.ok, true);
    check("Separation: credits unchanged", store.users.get("u15")?.credits, 99);
    const j = store.jobs.get("j15")!;
    check("Separation: creditRefundedAt unchanged", j.creditRefundedAt?.getTime(), new Date("2026-01-01").getTime());
    check("Separation: reservedMinutes null", j.reservedMinutes, null);
    check("Separation: periodUsageId null", j.periodUsageId, null);
    check("Separation: usageFinalizedAt null", j.usageFinalizedAt, null);
    check("Separation: usageReleasedAt null", j.usageReleasedAt, null);
    check("Separation: PeriodUsage store empty", store.periodUsages.size, 0);
    check("Separation: LibraryUnlock store empty", store.libraryUnlocks.size, 0);
  }

  // ── Route/lifecycle integration proxies ─────────────────────────────
  //
  // The routes themselves are integration-tested manually / via smoke
  // tests. These offline cases exercise the exact call shapes each route
  // uses, so a regression in the helper's contract surfaces here.

  // (16) Complete-route error path (PROBE, before TTS): FAILED + restore
  // atomic, no PeriodUsage / credit writes.
  {
    const store = seedStore();
    seedUser(store, { id: "u16", probeGenerationsUsed: 2, credits: 5 });
    seedJob(store, { id: "j16", userId: "u16", ttsStartedAt: null });
    const client = buildStubClient(store);
    const r = await restoreProbeOnTerminalFailure(
      { jobId: "j16", error: "script empty", persistFailedStatus: true, now },
      client
    );
    check("Route:complete error: ok=true", r.ok, true);
    check("Route:complete error: counter=1", store.users.get("u16")?.probeGenerationsUsed, 1);
    check("Route:complete error: status=FAILED", store.jobs.get("j16")?.status, "FAILED");
    check("Route:complete error: credits untouched", store.users.get("u16")?.credits, 5);
  }

  // (17) Stale-recovery path (PROBE, PROCESSING for a long time).
  {
    const store = seedStore();
    seedUser(store, { id: "u17", probeGenerationsUsed: 2 });
    seedJob(store, {
      id: "j17",
      userId: "u17",
      status: "PROCESSING",
      ttsStartedAt: new Date("2026-07-16T11:00:00.000Z"),
    });
    const client = buildStubClient(store);
    const r = await restoreProbeOnTerminalFailure(
      { jobId: "j17", error: "Generation timed out. Please try again.", persistFailedStatus: true, now },
      client
    );
    check("Route:stale: ok=true", r.ok, true);
    check("Route:stale: counter=1", store.users.get("u17")?.probeGenerationsUsed, 1);
    check("Route:stale: status=FAILED", store.jobs.get("j17")?.status, "FAILED");
  }

  // (18) Manual /fail path (PROBE).
  {
    const store = seedStore();
    seedUser(store, { id: "u18", probeGenerationsUsed: 2 });
    seedJob(store, { id: "j18", userId: "u18", status: "PROCESSING" });
    const client = buildStubClient(store);
    const r = await restoreProbeOnTerminalFailure(
      { jobId: "j18", error: "Vom System / User manuell auf FAILED gesetzt.", persistFailedStatus: true, now },
      client
    );
    check("Route:manual-fail: ok=true", r.ok, true);
    check("Route:manual-fail: counter=1", store.users.get("u18")?.probeGenerationsUsed, 1);
    check("Route:manual-fail: status=FAILED", store.jobs.get("j18")?.status, "FAILED");
  }

  // (19) Repeated route-level invocation is a no-op.
  {
    const store = seedStore();
    seedUser(store, { id: "u19", probeGenerationsUsed: 2 });
    seedJob(store, { id: "j19", userId: "u19", status: "PROCESSING" });
    const client = buildStubClient(store);
    const r1 = await restoreProbeOnTerminalFailure(
      { jobId: "j19", error: "e", now },
      client
    );
    check("Repeat: first ok=true", r1.ok, true);
    if (r1.ok) check("Repeat: first outcome=restored", r1.outcome, "restored");
    const r2 = await restoreProbeOnTerminalFailure(
      { jobId: "j19", error: "e", now },
      client
    );
    check("Repeat: second ok=true", r2.ok, true);
    if (r2.ok) check("Repeat: second outcome=already_restored", r2.outcome, "already_restored");
    check(
      "Repeat: counter=1 (single decrement)",
      store.users.get("u19")?.probeGenerationsUsed,
      1
    );
  }
}

// ---------------------------------------------------------------------------

runProbeRestorationTests()
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
