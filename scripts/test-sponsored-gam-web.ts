// scripts/test-sponsored-gam-web.ts
//
// F-003 Slice 1 — Offline tests for lib/entitlement/sponsored-gam-web.ts.
//
// Exercises startGamWebSponsoredEvent / completeGamWebSponsoredEvent and
// their interaction with the real (not stubbed) claimLibrarySessionUnlock,
// via an in-memory Prisma stub — same pattern as
// scripts/test-sponsored-simulated.ts, extended to cover the
// GAM-Web-specific matrix (provider validation, mode gating, cross-event
// isolation from the simulated provider).
//
// Run with:  npx tsx scripts/test-sponsored-gam-web.ts

import {
  startGamWebSponsoredEvent,
  completeGamWebSponsoredEvent,
  getSponsoredGamWebMode,
  isSponsoredGamWebEnabled,
  GAM_WEB_EVENT_LIFETIME_SECONDS,
} from "../lib/entitlement/sponsored-gam-web";
import { initRewardedSlot } from "../lib/ads/google-ad-manager-rewarded";
import type { Plan, PrismaClient } from "@prisma/client";
import type { LibraryEffectiveAccess } from "../lib/entitlement/library-effective-access";

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

// ─── Mode gating ──────────────────────────────────────────────────────

check("mode: undefined -> disabled", getSponsoredGamWebMode({}), "disabled");
check("mode: '' -> disabled", getSponsoredGamWebMode({ SPONSORED_GAM_WEB_MODE: "" }), "disabled");
check("mode: 'nonsense' -> disabled", getSponsoredGamWebMode({ SPONSORED_GAM_WEB_MODE: "nonsense" }), "disabled");
check("mode: 'test' -> test", getSponsoredGamWebMode({ SPONSORED_GAM_WEB_MODE: "test" }), "test");
check("mode: 'TEST' case-insensitive -> test", getSponsoredGamWebMode({ SPONSORED_GAM_WEB_MODE: "TEST" }), "test");
check("mode: 'live' -> live", getSponsoredGamWebMode({ SPONSORED_GAM_WEB_MODE: "live" }), "live");
check("enabled: disabled mode is false", isSponsoredGamWebEnabled({}), false);
check("enabled: test mode is true", isSponsoredGamWebEnabled({ SPONSORED_GAM_WEB_MODE: "test" }), true);
check("enabled: live mode is true", isSponsoredGamWebEnabled({ SPONSORED_GAM_WEB_MODE: "live" }), true);
check("lifetime seconds matches existing 300s model", GAM_WEB_EVENT_LIFETIME_SECONDS, 300);

// ─── In-memory Prisma stub ──────────────────────────────────────────
//
// Same shape as scripts/test-sponsored-simulated.ts's stub, extended
// with a `provider` field on events/unlocks so cross-provider isolation
// and PROVIDER_MISMATCH can be exercised without touching the real
// simulated module.

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
  provider: "SIMULATED_SOFTVIBE" | "GOOGLE_AD_MANAGER_WEB";
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
function makeOps(store: Store, releases: Array<() => void>) {
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
          if (where.provider && e.provider !== where.provider) continue;
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
    // Advisory lock — mirrors the pattern used by test-sponsored-simulated.
    // Production calls the lock via $executeRaw (pg_advisory_xact_lock
    // returns void, which $queryRaw cannot deserialize). Each
    // $transaction call below builds a FRESH `ops` object closed over
    // its own `localReleases` array (a function parameter, not shared
    // module state) — this is what keeps concurrent transactions from
    // racing on which release-callback list they push into.
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
      const ops = makeOps(store, localReleases);
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

function makeEffectiveAccess(
  mode: "FREE" | "STARTER" | "PREMIUM" | "ADMIN"
): LibraryEffectiveAccess {
  return {
    databasePlan: mode === "ADMIN" ? "FREE" : (mode as Plan),
    isAdmin: mode === "ADMIN",
    defaultMode: mode,
    qaOverride: null,
    effectiveMode: mode,
    qaFeatureAvailable: false,
    hasDirectAccess: mode !== "FREE",
    requiresSponsoredUnlockPath: mode === "FREE",
  };
}

const testEnv: Record<string, string | undefined> = { SPONSORED_GAM_WEB_MODE: "test" };
const disabledEnv: Record<string, string | undefined> = {};

// ─── Client GPT rewarded helper: bounded no-fill/stall timeout ────────
//
// initRewardedSlot must never wait forever for a rewardedSlotGranted /
// rewardedSlotClosed event that a no-fill or stalled script will never
// send (see lib/ads/google-ad-manager-rewarded.ts). Exercised against a
// minimal in-memory googletag stub — no real GPT script involved.

function installGoogletagStub(): { fireGranted: () => void; fireClosed: () => void } {
  const listeners: Record<string, Array<(e: unknown) => void>> = {
    rewardedSlotReady: [],
    rewardedSlotGranted: [],
    rewardedSlotClosed: [],
  };
  const slot = { addService: () => slot };
  const pubads = {
    addEventListener: (name: string, fn: (e: unknown) => void) => {
      listeners[name].push(fn);
    },
    removeEventListener: (name: string, fn: (e: unknown) => void) => {
      listeners[name] = listeners[name].filter((f) => f !== fn);
    },
  };
  const googletag = {
    apiReady: true,
    cmd: { push: (fn: () => void) => fn() },
    enums: { OutOfPageFormat: { REWARDED: "REWARDED" } },
    defineOutOfPageSlot: () => slot,
    pubads: () => pubads,
    enableServices: () => {},
    display: () => {},
    destroySlots: () => {},
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = { googletag };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).document = {
    querySelector: () => null,
    createElement: () => ({}),
    head: { appendChild: () => {} },
  };
  return {
    fireGranted: () => listeners.rewardedSlotGranted.forEach((fn) => fn({ slot })),
    fireClosed: () => listeners.rewardedSlotClosed.forEach((fn) => fn({ slot })),
  };
}

async function runAdsHelperTests(): Promise<void> {
  // (a) Neither granted nor closed ever fires (no-fill / stalled script)
  // -> the bounded timeout synthesises onClosed, never onGranted.
  {
    installGoogletagStub();
    let closedCalls = 0;
    let grantedCalls = 0;
    await initRewardedSlot(
      "/test/ad-unit",
      { onGranted: () => grantedCalls++, onClosed: () => closedCalls++ },
      30
    );
    await new Promise((r) => setTimeout(r, 80));
    check("ads: no-fill/stalled slot times out to onClosed", closedCalls, 1);
    check("ads: no-fill/stalled slot never grants", grantedCalls, 0);
  }

  // (b) A real grant arrives before the timeout -> no synthetic close
  // fires afterward, and onGranted fires exactly once.
  {
    const { fireGranted } = installGoogletagStub();
    let closedCalls = 0;
    let grantedCalls = 0;
    await initRewardedSlot(
      "/test/ad-unit",
      { onGranted: () => grantedCalls++, onClosed: () => closedCalls++ },
      30
    );
    fireGranted();
    await new Promise((r) => setTimeout(r, 80));
    check("ads: real grant suppresses the synthetic timeout close", closedCalls, 0);
    check("ads: real grant reaches the caller exactly once", grantedCalls, 1);
  }

  // (c) A real close-before-reward arrives before the timeout -> fires
  // onClosed exactly once, no duplicate from the timeout.
  {
    const { fireClosed } = installGoogletagStub();
    let closedCalls = 0;
    await initRewardedSlot("/test/ad-unit", { onClosed: () => closedCalls++ }, 30);
    fireClosed();
    await new Promise((r) => setTimeout(r, 80));
    check("ads: real close-before-reward fires onClosed exactly once", closedCalls, 1);
  }
}

async function runTests(): Promise<void> {
  await runAdsHelperTests();

// ─── Start: mode gating ───────────────────────────────────────────────

{
  const store = freshStore();
  seedUser(store, "u1");
  seedSession(store, "s1");
  const client = makeOps(store, []);
  const r = await startGamWebSponsoredEvent({ userId: "u1", librarySessionId: "s1", env: disabledEnv }, client);
  check("start: disabled mode returns PROVIDER_UNAVAILABLE", r.ok, false);
  if (!r.ok) check("start: disabled error code", r.error, "PROVIDER_UNAVAILABLE");
}

// ─── Start: unknown user / session / inactive ────────────────────────

{
  const store = freshStore();
  seedSession(store, "s1");
  const client = makeOps(store, []);
  const r = await startGamWebSponsoredEvent({ userId: "u1", librarySessionId: "s1", env: testEnv }, client);
  check("start: user not found", (r as { ok: false; error?: string }).error, "USER_NOT_FOUND");
}

{
  const store = freshStore();
  seedUser(store, "u1");
  const client = makeOps(store, []);
  const r = await startGamWebSponsoredEvent({ userId: "u1", librarySessionId: "s-missing", env: testEnv }, client);
  check("start: session not found", (r as { ok: false; error?: string }).error, "SESSION_NOT_FOUND");
}

{
  const store = freshStore();
  seedUser(store, "u1");
  seedSession(store, "s1", false);
  const client = makeOps(store, []);
  const r = await startGamWebSponsoredEvent({ userId: "u1", librarySessionId: "s1", env: testEnv }, client);
  check("start: inactive session rejected", (r as { ok: false; error?: string }).error, "SESSION_INACTIVE");
}

// ─── (4) Paid / admin direct access — no GAM event created ───────────

{
  const store = freshStore();
  seedUser(store, "u1", "STARTER");
  seedSession(store, "s1");
  const client = makeOps(store, []);
  const r = await startGamWebSponsoredEvent(
    { userId: "u1", librarySessionId: "s1", env: testEnv, now: new Date("2026-09-01T10:00:00Z") },
    client
  );
  check("start: paid outcome", (r as { outcome?: string }).outcome, "direct_plan_access");
  check("start: paid creates no event", store.events.size, 0);
  check("start: paid creates no unlock", store.unlocks.size, 0);
}

// ─── (5) Active unlock reused — no new GAM event ─────────────────────

{
  const store = freshStore();
  seedUser(store, "u1");
  seedSession(store, "s1");
  const now = new Date("2026-09-01T10:00:00Z");
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
  const client = makeOps(store, []);
  const r = await startGamWebSponsoredEvent({ userId: "u1", librarySessionId: "s1", env: testEnv, now }, client);
  check("start: active unlock outcome", (r as { outcome?: string }).outcome, "active_unlock");
  check("start: active unlock creates no event", store.events.size, 0);
}

// ─── (1)(3) Free + locked session -> GAM start available, provider tag ──

{
  const store = freshStore();
  seedUser(store, "u1");
  seedSession(store, "s1");
  const now = new Date("2026-09-01T10:00:00Z");
  const client = makeOps(store, []);
  const r = await startGamWebSponsoredEvent({ userId: "u1", librarySessionId: "s1", env: testEnv, now }, client);
  check("start: free locked session outcome", (r as { outcome?: string }).outcome, "event_created");
  const eventId = (r as { eventId?: string }).eventId!;
  const stored = store.events.get(eventId)!;
  check("start: event provider is GOOGLE_AD_MANAGER_WEB", stored.provider, "GOOGLE_AD_MANAGER_WEB");
  check("start: eligibleAt equals now (no artificial delay)", stored.eligibleAt.getTime(), now.getTime());
  check(
    "start: expiresAt is now + 300s",
    stored.expiresAt.getTime(),
    now.getTime() + GAM_WEB_EVENT_LIFETIME_SECONDS * 1000
  );
}

// ─── Start: reuse a still-valid PENDING event ─────────────────────────

{
  const store = freshStore();
  seedUser(store, "u1");
  seedSession(store, "s1");
  const now = new Date("2026-09-01T10:00:00Z");
  const client = makeOps(store, []);
  const first = await startGamWebSponsoredEvent({ userId: "u1", librarySessionId: "s1", env: testEnv, now }, client);
  const second = await startGamWebSponsoredEvent(
    { userId: "u1", librarySessionId: "s1", env: testEnv, now: new Date(now.getTime() + 5_000) },
    client
  );
  check("start: second call reuses pending event", (second as { outcome?: string }).outcome, "event_reused");
  check(
    "start: reused event id matches first",
    (second as { eventId?: string }).eventId,
    (first as { eventId?: string }).eventId
  );
  check("start: still exactly one event row", store.events.size, 1);
}

// ─── (2) successful test completion -> LibraryUnlock created ─────────

{
  const store = freshStore();
  seedUser(store, "u1");
  seedSession(store, "s1");
  const now = new Date("2026-09-01T10:00:00Z");
  const client = makeOps(store, []);
  const s = await startGamWebSponsoredEvent({ userId: "u1", librarySessionId: "s1", env: testEnv, now }, client);
  const eventId = (s as { eventId?: string }).eventId!;
  const c = await completeGamWebSponsoredEvent(
    { userId: "u1", eventId, env: testEnv, now: new Date(now.getTime() + 1_000) },
    client
  );
  check("complete: outcome created", (c as { outcome?: string }).outcome, "created");
  check("complete: unlock persisted", store.unlocks.size, 1);
  const stored = store.events.get(eventId)!;
  check("complete: event transitions to CONSUMED", stored.status, "CONSUMED");
}

// ─── (10) Session tampering: librarySessionId is server-derived ──────

{
  const store = freshStore();
  seedUser(store, "u1");
  seedSession(store, "s1");
  seedSession(store, "s2"); // a second, unrelated session
  const now = new Date("2026-09-01T10:00:00Z");
  const client = makeOps(store, []);
  const s = await startGamWebSponsoredEvent({ userId: "u1", librarySessionId: "s1", env: testEnv, now }, client);
  const eventId = (s as { eventId?: string }).eventId!;
  // completeGamWebSponsoredEvent's params type has no librarySessionId
  // field at all — there is nothing for a tampered client to pass. This
  // assertion documents that the persisted event's session always wins.
  const c = await completeGamWebSponsoredEvent({ userId: "u1", eventId, env: testEnv, now }, client);
  check(
    "complete: librarySessionId always derived from the event, never s2",
    (c as { librarySessionId?: string }).librarySessionId,
    "s1"
  );
}

// ─── (6) Duplicate complete is idempotent — no second unlock ──────────

{
  const store = freshStore();
  seedUser(store, "u1");
  seedSession(store, "s1");
  const now = new Date("2026-09-01T10:00:00Z");
  const client = makeOps(store, []);
  const s = await startGamWebSponsoredEvent({ userId: "u1", librarySessionId: "s1", env: testEnv, now }, client);
  const eventId = (s as { eventId?: string }).eventId!;
  const c1 = await completeGamWebSponsoredEvent({ userId: "u1", eventId, env: testEnv, now }, client);
  const c2 = await completeGamWebSponsoredEvent({ userId: "u1", eventId, env: testEnv, now }, client);
  check("duplicate complete: first outcome created", (c1 as { outcome?: string }).outcome, "created");
  check("duplicate complete: second outcome reused", (c2 as { outcome?: string }).outcome, "reused");
  check(
    "duplicate complete: same unlock id both times",
    (c2 as { unlockId?: string }).unlockId,
    (c1 as { unlockId?: string }).unlockId
  );
  check("duplicate complete: exactly one unlock row", store.unlocks.size, 1);
}

// ─── (7) Expired PENDING event is rejected ────────────────────────────

{
  const store = freshStore();
  seedUser(store, "u1");
  seedSession(store, "s1");
  const now = new Date("2026-09-01T10:00:00Z");
  const client = makeOps(store, []);
  const s = await startGamWebSponsoredEvent({ userId: "u1", librarySessionId: "s1", env: testEnv, now }, client);
  const eventId = (s as { eventId?: string }).eventId!;
  const later = new Date(now.getTime() + (GAM_WEB_EVENT_LIFETIME_SECONDS + 5) * 1000);
  const c = await completeGamWebSponsoredEvent({ userId: "u1", eventId, env: testEnv, now: later }, client);
  check("complete: expired event rejected", c.ok, false);
  if (!c.ok) check("complete: expired error code", c.error, "EVENT_EXPIRED");
  check("complete: no unlock created", store.unlocks.size, 0);
}

// ─── (8) Wrong authenticated user -> EVENT_WRONG_USER ─────────────────

{
  const store = freshStore();
  seedUser(store, "u1");
  seedUser(store, "attacker");
  seedSession(store, "s1");
  const now = new Date("2026-09-01T10:00:00Z");
  const client = makeOps(store, []);
  const s = await startGamWebSponsoredEvent({ userId: "u1", librarySessionId: "s1", env: testEnv, now }, client);
  const eventId = (s as { eventId?: string }).eventId!;
  const c = await completeGamWebSponsoredEvent({ userId: "attacker", eventId, env: testEnv, now }, client);
  check("complete: cross-user rejected", c.ok, false);
  if (!c.ok) check("complete: cross-user error code", c.error, "EVENT_WRONG_USER");
  check("complete: no unlock created for attacker", store.unlocks.size, 0);
}

// ─── (9) Provider mismatch: a SIMULATED_SOFTVIBE event id can never ───
// be completed through the GAM Web path.

{
  const store = freshStore();
  seedUser(store, "u1");
  seedSession(store, "s1");
  const now = new Date("2026-09-01T10:00:00Z");
  const simEventId = "event-sim-1";
  store.events.set(simEventId, {
    id: simEventId,
    userId: "u1",
    librarySessionId: "s1",
    provider: "SIMULATED_SOFTVIBE",
    status: "PENDING",
    providerEventId: "sim_abc123",
    createdAt: now,
    eligibleAt: now,
    expiresAt: new Date(now.getTime() + 300_000),
    completedAt: null,
    consumedAt: null,
    cancelledAt: null,
  });
  const client = makeOps(store, []);
  const c = await completeGamWebSponsoredEvent(
    { userId: "u1", eventId: simEventId, env: testEnv, now },
    client
  );
  check("complete: provider mismatch rejected", c.ok, false);
  if (!c.ok) check("complete: provider mismatch error code", c.error, "PROVIDER_MISMATCH");
}

// ─── Cross-provider isolation: a stale SIMULATED_SOFTWARE PENDING row ──
// for the same (user, session) is never reused or expired by the GAM
// Web start path.

{
  const store = freshStore();
  seedUser(store, "u1");
  seedSession(store, "s1");
  const now = new Date("2026-09-01T10:00:00Z");
  const simEventId = "event-sim-2";
  store.events.set(simEventId, {
    id: simEventId,
    userId: "u1",
    librarySessionId: "s1",
    provider: "SIMULATED_SOFTVIBE",
    status: "PENDING",
    providerEventId: "sim_def456",
    createdAt: now,
    eligibleAt: new Date(now.getTime() + 8_000),
    expiresAt: new Date(now.getTime() + 300_000),
    completedAt: null,
    consumedAt: null,
    cancelledAt: null,
  });
  const client = makeOps(store, []);
  const r = await startGamWebSponsoredEvent({ userId: "u1", librarySessionId: "s1", env: testEnv, now }, client);
  check("start: creates independent GAM event alongside stale sim event", (r as { outcome?: string }).outcome, "event_created");
  check("start: sim event untouched (still PENDING)", store.events.get(simEventId)!.status, "PENDING");
  check("start: two independent event rows now exist", store.events.size, 2);
}

// ─── (11) Daily 3-unlock limit reached -> blocked at START, before any ──
// ad is shown (read-only precheck), AND still enforced authoritatively
// at COMPLETE (the precheck never replaces the atomic claim check).

{
  const store = freshStore();
  seedUser(store, "u1");
  seedSession(store, "s1");
  seedSession(store, "s2");
  seedSession(store, "s3");
  seedSession(store, "s4");
  const client = makeOps(store, []);
  const day = new Date("2026-09-01T10:00:00Z");

  // 0/3, 1/3, 2/3 — GAM start allowed and completes normally each time.
  for (const sid of ["s1", "s2", "s3"]) {
    const s = await startGamWebSponsoredEvent({ userId: "u1", librarySessionId: sid, env: testEnv, now: day }, client);
    check(`daily-limit: start allowed for ${sid}`, (s as { outcome?: string }).outcome, "event_created");
    const eventId = (s as { eventId?: string }).eventId!;
    const c = await completeGamWebSponsoredEvent({ userId: "u1", eventId, env: testEnv, now: day }, client);
    check(`daily-limit: unlock ${sid} created`, (c as { outcome?: string }).outcome, "created");
  }
  check("daily-limit: three unlocks recorded", store.unlocks.size, 3);
  const eventsBeforeFourthStart = store.events.size;

  // 3/3, new locked session -> START itself rejects, before any event
  // is created and before any ad would be shown.
  const s4 = await startGamWebSponsoredEvent({ userId: "u1", librarySessionId: "s4", env: testEnv, now: day }, client);
  check("daily-limit: 4th start rejected pre-ad", s4.ok, false);
  if (!s4.ok) check("daily-limit: 4th start error code", s4.error, "DAILY_UNLOCK_LIMIT_REACHED");
  check("daily-limit: no new PENDING event created for the rejected start", store.events.size, eventsBeforeFourthStart);
  check("daily-limit: still exactly three unlocks", store.unlocks.size, 3);

  // 3/3, but the SAME session already holds an active 8h unlock ->
  // active_unlock reuse still works; the precheck must not sit ahead of
  // the active-unlock check.
  const reopen = await startGamWebSponsoredEvent({ userId: "u1", librarySessionId: "s1", env: testEnv, now: day }, client);
  check("daily-limit: active-unlock reuse still works at 3/3", (reopen as { outcome?: string }).outcome, "active_unlock");

  // 3/3, but a paid/admin effectiveAccess override still gets direct
  // access unconditionally — the precheck must never block a non-FREE
  // caller regardless of their FREE-plan historical count.
  for (const mode of ["STARTER", "PREMIUM", "ADMIN"] as const) {
    const r = await startGamWebSponsoredEvent(
      { userId: "u1", librarySessionId: "s4", env: testEnv, now: day, effectiveAccess: makeEffectiveAccess(mode) },
      client
    );
    check(`daily-limit: ${mode} bypasses precheck via direct_plan_access`, (r as { outcome?: string }).outcome, "direct_plan_access");
  }
  check("daily-limit: direct-access probes created no event", store.events.size, eventsBeforeFourthStart);

  // Race safety net: a start that observed count=2 (precheck passed)
  // races another tab's completion that pushes the count to 3 before
  // this one completes. The precheck cannot see that — it is read-only
  // UX, not a reservation — but the authoritative claim inside
  // completeGamWebSponsoredEvent must still block it.
  const raceEventId = "event-race-1";
  store.events.set(raceEventId, {
    id: raceEventId,
    userId: "u1",
    librarySessionId: "s4",
    provider: "GOOGLE_AD_MANAGER_WEB",
    status: "PENDING",
    providerEventId: "gam_race_1",
    createdAt: day,
    eligibleAt: day,
    expiresAt: new Date(day.getTime() + 300_000),
    completedAt: null,
    consumedAt: null,
    cancelledAt: null,
  });
  const raceComplete = await completeGamWebSponsoredEvent(
    { userId: "u1", eventId: raceEventId, env: testEnv, now: day },
    client
  );
  check("daily-limit: authoritative complete still enforces the limit despite a stale PENDING event", raceComplete.ok, false);
  if (!raceComplete.ok) check("daily-limit: race complete error code", raceComplete.error, "DAILY_UNLOCK_LIMIT_REACHED");
  check("daily-limit: race attempt created no extra unlock", store.unlocks.size, 3);
}

// ─── (12) Concurrent duplicate completion -> at most one effective unlock ──

{
  const store = freshStore();
  seedUser(store, "u1");
  seedSession(store, "s1");
  const now = new Date("2026-09-01T10:00:00Z");
  const client = makeOps(store, []);
  const s = await startGamWebSponsoredEvent({ userId: "u1", librarySessionId: "s1", env: testEnv, now }, client);
  const eventId = (s as { eventId?: string }).eventId!;
  const [r1, r2] = await Promise.all([
    completeGamWebSponsoredEvent({ userId: "u1", eventId, env: testEnv, now }, client),
    completeGamWebSponsoredEvent({ userId: "u1", eventId, env: testEnv, now }, client),
  ]);
  const outcomes = [r1, r2].map((r) => (r as { outcome?: string }).outcome).sort();
  assertTruthy("concurrent complete: both calls succeeded", r1.ok && r2.ok);
  check("concurrent complete: outcomes are created+reused", outcomes.join(","), "created,reused");
  check("concurrent complete: exactly one unlock row", store.unlocks.size, 1);
}

// ─── (16) GAM test mode uses the GAM provider event + GAM complete path ──
// (already implied by every test above using testEnv / GOOGLE_AD_MANAGER_WEB,
// asserted explicitly here for the acceptance-criteria matrix.)

{
  const store = freshStore();
  seedUser(store, "u1");
  seedSession(store, "s1");
  const now = new Date("2026-09-01T10:00:00Z");
  const client = makeOps(store, []);
  const s = await startGamWebSponsoredEvent({ userId: "u1", librarySessionId: "s1", env: testEnv, now }, client);
  const eventId = (s as { eventId?: string }).eventId!;
  const stored = store.events.get(eventId)!;
  check("test mode: event provider is GAM Web, not simulated", stored.provider, "GOOGLE_AD_MANAGER_WEB");
  check("test mode: providerEventId carries the gam_ prefix", stored.providerEventId.startsWith("gam_"), true);
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
