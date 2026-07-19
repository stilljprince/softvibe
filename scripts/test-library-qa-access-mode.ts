// scripts/test-library-qa-access-mode.ts
//
// RP-004E1 browser-QA — focused offline tests for:
//
//   * lib/library/qa-audio-storage.ts
//   * lib/entitlement/library-effective-access.ts
//   * The effective-access hook on lib/entitlement/library-audio-access.ts
//
// The suite is intentionally hermetic:
//
//   * Storage tests point the QA reader at a scratch directory instead
//     of touching the real `.storage/qa-library/`.
//   * Resolver + audio-access tests run against an in-memory Prisma
//     stub — no database, no network, no real S3 call.
//   * Every non-write assertion also verifies the stub was never asked
//     to mutate a table, so "system separation" invariants remain
//     provable in CI.
//
// Run:
//   npx tsx scripts/test-library-qa-access-mode.ts

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Plan, PrismaClient } from "@prisma/client";
import {
  isQaLibraryAudioKey,
  resolveQaLibraryAudioPath,
  statQaLibraryAudio,
  QA_LIBRARY_AUDIO_KEY_PREFIX,
} from "../lib/library/qa-audio-storage";
import {
  resolveLibraryEffectiveAccess,
  isLibraryQaModeEnabled,
  defaultLibraryModeFor,
  LIBRARY_QA_MODE_ENV_FLAG,
  type LibraryEffectiveAccess,
} from "../lib/entitlement/library-effective-access";
import { resolveLibraryAudioAccess } from "../lib/entitlement/library-audio-access";

// ─── Assertion runner ────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const equal = actual === expected;
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

// ─── QA storage helper tests ─────────────────────────────────────────────

function testQaStorageHelper(): void {
  console.log("\n── QA storage helper ──────────────────────────────────────");

  // key shape validation
  check(
    "accepts canonical QA key",
    isQaLibraryAudioKey(".storage/qa-library/rain_soft_diffuse.mp3"),
    true
  );
  check(
    "rejects prefix alone (no filename)",
    isQaLibraryAudioKey(".storage/qa-library/"),
    false
  );
  check(
    "rejects prefix without trailing slash",
    isQaLibraryAudioKey(".storage/qa-library"),
    false
  );
  check(
    "rejects traversal segment",
    isQaLibraryAudioKey(".storage/qa-library/../etc/passwd"),
    false
  );
  check(
    "rejects double-dot in subpath",
    isQaLibraryAudioKey(".storage/qa-library/sub/../etc"),
    false
  );
  check(
    "rejects NUL byte",
    isQaLibraryAudioKey(".storage/qa-library/rain\0.mp3"),
    false
  );
  check(
    "rejects backslash",
    isQaLibraryAudioKey(".storage/qa-library/sub\\rain.mp3"),
    false
  );
  check(
    "rejects absolute-looking key",
    isQaLibraryAudioKey("/.storage/qa-library/rain.mp3"),
    false
  );
  check(
    "rejects unrelated key",
    isQaLibraryAudioKey("public/audio/soundbeds/rain.mp3"),
    false
  );

  // path resolution — dev + prod behaviour
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sv-qa-test-"));
  fs.mkdirSync(path.join(tmpRoot, QA_LIBRARY_AUDIO_KEY_PREFIX), {
    recursive: true,
  });
  const testFile = path.join(
    tmpRoot,
    QA_LIBRARY_AUDIO_KEY_PREFIX,
    "sample.mp3"
  );
  fs.writeFileSync(testFile, "abcde");

  const okDev = resolveQaLibraryAudioPath(
    ".storage/qa-library/sample.mp3",
    { cwd: tmpRoot, env: { NODE_ENV: "development" } }
  );
  check("dev resolution ok", okDev.ok, true);
  if (okDev.ok) {
    check("dev absPath ends with sample.mp3", okDev.absPath, testFile);
  }

  const prodResult = resolveQaLibraryAudioPath(
    ".storage/qa-library/sample.mp3",
    { cwd: tmpRoot, env: { NODE_ENV: "production" } }
  );
  check("prod resolution refused", prodResult.ok, false);
  if (!prodResult.ok) {
    check(
      "prod refusal reason",
      prodResult.error,
      "PRODUCTION_DISABLED"
    );
  }

  const traversal = resolveQaLibraryAudioPath(
    ".storage/qa-library/../etc/passwd",
    { cwd: tmpRoot, env: { NODE_ENV: "development" } }
  );
  check("traversal refused", traversal.ok, false);
  if (!traversal.ok) {
    check("traversal reason", traversal.error, "INVALID_KEY");
  }

  // Test that even a legally-shaped key still gets confirmed by
  // `path.resolve` to stay inside the QA root. Any input that
  // `isQaLibraryAudioKey` accepts must resolve inside the root; a
  // failure here would indicate a bug in the containment code.
  const outsidePreserved = resolveQaLibraryAudioPath(
    ".storage/qa-library/deep/sub/rain.mp3",
    { cwd: tmpRoot, env: { NODE_ENV: "development" } }
  );
  check("deep subpath ok", outsidePreserved.ok, true);
  if (outsidePreserved.ok) {
    check(
      "deep subpath inside root",
      outsidePreserved.absPath.startsWith(
        path.join(tmpRoot, QA_LIBRARY_AUDIO_KEY_PREFIX)
      ),
      true
    );
  }

  // Missing file → statQaLibraryAudio null
  return (async () => {
    const missing = await statQaLibraryAudio(
      ".storage/qa-library/does-not-exist.mp3",
      { cwd: tmpRoot, env: { NODE_ENV: "development" } }
    );
    check("missing file returns null", missing, null);

    const present = await statQaLibraryAudio(
      ".storage/qa-library/sample.mp3",
      { cwd: tmpRoot, env: { NODE_ENV: "development" } }
    );
    check("present file has size", present?.size, 5);

    // Cleanup
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  })() as unknown as void;
}

// ─── Effective-access + audio-access — in-memory Prisma stub ─────────────

type StoreUser = {
  id: string;
  plan: Plan;
  planPeriodEnd: Date | null;
  isAdmin: boolean;
  timezone: string | null;
};
type StoreSession = { id: string; isActive: boolean };
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
type Store = {
  users: Map<string, StoreUser>;
  sessions: Map<string, StoreSession>;
  chapters: Map<string, StoreChapter>;
  unlocks: Map<string, StoreUnlock>;
  callLog: string[];
};

function makeStore(): Store {
  return {
    users: new Map(),
    sessions: new Map(),
    chapters: new Map(),
    unlocks: new Map(),
    callLog: [],
  };
}

function forbid(method: string) {
  return async () => {
    throw new Error(`library-qa-access-mode test must not call ${method}`);
  };
}

function buildClient(store: Store): PrismaClient {
  const client = {
    user: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where, select }: any) => {
        store.callLog.push(`user.findUnique:${where.id}`);
        const u = store.users.get(where.id);
        if (!u) return null;
        // Return the fields the caller selected. `select` is a plain
        // object of truthy flags — we pattern-match the fields both
        // resolvers ask for.
        const out: Record<string, unknown> = {};
        if (select?.plan) out.plan = u.plan;
        if (select?.planPeriodEnd) out.planPeriodEnd = u.planPeriodEnd;
        if (select?.isAdmin) out.isAdmin = u.isAdmin;
        if (select?.timezone) out.timezone = u.timezone;
        return out;
      },
      create: forbid("user.create"),
      update: forbid("user.update"),
      updateMany: forbid("user.updateMany"),
    },
    librarySession: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        store.callLog.push(`librarySession.findUnique:${where.id}`);
        const s = store.sessions.get(where.id);
        return s ? { id: s.id, isActive: s.isActive } : null;
      },
      create: forbid("librarySession.create"),
      update: forbid("librarySession.update"),
    },
    librarySessionChapter: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        store.callLog.push(`librarySessionChapter.findUnique:${where.id}`);
        const c = store.chapters.get(where.id);
        return c
          ? {
              id: c.id,
              librarySessionId: c.librarySessionId,
              audioKey: c.audioKey,
            }
          : null;
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
          ) {
            continue;
          }
          if (where?.expiresAt?.gt) {
            const cutoff = where.expiresAt.gt as Date;
            if (!(u.expiresAt.getTime() > cutoff.getTime())) continue;
          }
          rows.push(u);
        }
        if (orderBy && orderBy.expiresAt === "desc") {
          rows.sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime());
        }
        return rows[0]
          ? { id: rows[0].id, expiresAt: rows[0].expiresAt }
          : null;
      },
      create: forbid("libraryUnlock.create"),
      update: forbid("libraryUnlock.update"),
      updateMany: forbid("libraryUnlock.updateMany"),
      delete: forbid("libraryUnlock.delete"),
      deleteMany: forbid("libraryUnlock.deleteMany"),
    },
    sponsoredUnlockEvent: {
      findUnique: forbid("sponsoredUnlockEvent.findUnique"),
      findFirst: forbid("sponsoredUnlockEvent.findFirst"),
      create: forbid("sponsoredUnlockEvent.create"),
      update: forbid("sponsoredUnlockEvent.update"),
      updateMany: forbid("sponsoredUnlockEvent.updateMany"),
    },
    periodUsage: {
      findUnique: forbid("periodUsage.findUnique"),
      findFirst: forbid("periodUsage.findFirst"),
      create: forbid("periodUsage.create"),
      update: forbid("periodUsage.update"),
    },
    job: {
      create: forbid("job.create"),
      update: forbid("job.update"),
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
    planPeriodEnd?: Date | null;
    isAdmin?: boolean;
    timezone?: string | null;
  }
): void {
  store.users.set(u.id, {
    id: u.id,
    plan: u.plan,
    planPeriodEnd: u.planPeriodEnd ?? null,
    isAdmin: u.isAdmin ?? false,
    timezone: u.timezone ?? null,
  });
}

function seedSession(store: Store, id: string, isActive = true): void {
  store.sessions.set(id, { id, isActive });
}

function seedChapter(
  store: Store,
  c: { id: string; librarySessionId: string; audioKey?: string }
): void {
  store.chapters.set(c.id, {
    id: c.id,
    librarySessionId: c.librarySessionId,
    audioKey:
      c.audioKey ?? `library/${c.librarySessionId}/${c.id}.mp3`,
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

// ─── Effective-access resolver tests ─────────────────────────────────────

async function testEffectiveAccess(): Promise<void> {
  console.log("\n── Effective access resolver ──────────────────────────────");

  // env flag: production forbids the feature even when explicitly on
  check(
    "prod env disables feature",
    isLibraryQaModeEnabled({
      NODE_ENV: "production",
      [LIBRARY_QA_MODE_ENV_FLAG]: "true",
    }),
    false
  );
  check(
    "dev + flag on enables feature",
    isLibraryQaModeEnabled({
      NODE_ENV: "development",
      [LIBRARY_QA_MODE_ENV_FLAG]: "true",
    }),
    true
  );
  check(
    "dev + flag missing disables feature",
    isLibraryQaModeEnabled({ NODE_ENV: "development" }),
    false
  );

  // defaultLibraryModeFor branches
  const now = new Date("2026-07-15T12:00:00.000Z");
  check(
    "admin default is ADMIN even if DB plan FREE",
    defaultLibraryModeFor("FREE", null, true, now),
    "ADMIN"
  );
  check(
    "non-admin FREE default is FREE",
    defaultLibraryModeFor("FREE", null, false, now),
    "FREE"
  );
  check(
    "non-admin STARTER default is STARTER",
    defaultLibraryModeFor(
      "STARTER",
      new Date("2026-08-01T00:00:00.000Z"),
      false,
      now
    ),
    "STARTER"
  );
  check(
    "non-admin expired PREMIUM falls to FREE",
    defaultLibraryModeFor(
      "PREMIUM",
      new Date("2026-06-01T00:00:00.000Z"),
      false,
      now
    ),
    "FREE"
  );

  // 1) Real admin defaults ADMIN — cookie ignored when feature disabled
  {
    const store = makeStore();
    const client = buildClient(store);
    seedUser(store, { id: "u-admin", plan: "FREE", isAdmin: true });
    const res = await resolveLibraryEffectiveAccess(
      {
        userId: "u-admin",
        qaModeCookie: "STARTER",
        now,
        env: { NODE_ENV: "development" }, // flag missing
      },
      client
    );
    check("admin no-flag ok=true", res.ok, true);
    if (res.ok) {
      check("admin no-flag defaultMode", res.access.defaultMode, "ADMIN");
      check("admin no-flag effectiveMode", res.access.effectiveMode, "ADMIN");
      check("admin no-flag qaOverride null", res.access.qaOverride, null);
      check(
        "admin no-flag feature unavailable",
        res.access.qaFeatureAvailable,
        false
      );
    }
  }

  // 2) Real admin + feature enabled + STARTER cookie → effective STARTER
  {
    const store = makeStore();
    const client = buildClient(store);
    seedUser(store, { id: "u-admin", plan: "FREE", isAdmin: true });
    const res = await resolveLibraryEffectiveAccess(
      {
        userId: "u-admin",
        qaModeCookie: "STARTER",
        now,
        env: {
          NODE_ENV: "development",
          [LIBRARY_QA_MODE_ENV_FLAG]: "true",
        },
      },
      client
    );
    check("admin+flag+cookie ok=true", res.ok, true);
    if (res.ok) {
      check("admin+flag defaultMode", res.access.defaultMode, "ADMIN");
      check(
        "admin+flag effectiveMode STARTER",
        res.access.effectiveMode,
        "STARTER"
      );
      check("admin+flag override STARTER", res.access.qaOverride, "STARTER");
      check("admin+flag hasDirectAccess", res.access.hasDirectAccess, true);
    }
  }

  // 3) Real admin + feature enabled + FREE cookie
  {
    const store = makeStore();
    const client = buildClient(store);
    seedUser(store, { id: "u-admin", plan: "PREMIUM", isAdmin: true });
    const res = await resolveLibraryEffectiveAccess(
      {
        userId: "u-admin",
        qaModeCookie: "FREE",
        now,
        env: {
          NODE_ENV: "development",
          [LIBRARY_QA_MODE_ENV_FLAG]: "true",
        },
      },
      client
    );
    if (res.ok) {
      check("admin+FREE override effective FREE", res.access.effectiveMode, "FREE");
      check(
        "admin+FREE requires sponsored",
        res.access.requiresSponsoredUnlockPath,
        true
      );
      check(
        "admin+FREE databasePlan still PREMIUM",
        res.access.databasePlan,
        "PREMIUM"
      );
    }
  }

  // 4) Non-admin cannot select — cookie silently ignored even with flag on
  {
    const store = makeStore();
    const client = buildClient(store);
    seedUser(store, { id: "u-free", plan: "FREE", isAdmin: false });
    const res = await resolveLibraryEffectiveAccess(
      {
        userId: "u-free",
        qaModeCookie: "ADMIN",
        now,
        env: {
          NODE_ENV: "development",
          [LIBRARY_QA_MODE_ENV_FLAG]: "true",
        },
      },
      client
    );
    if (res.ok) {
      check("non-admin cookie ignored — mode FREE", res.access.effectiveMode, "FREE");
      check("non-admin qaOverride null", res.access.qaOverride, null);
    }
  }

  // 5) Feature disabled — admin cookie ignored
  {
    const store = makeStore();
    const client = buildClient(store);
    seedUser(store, { id: "u-admin", plan: "FREE", isAdmin: true });
    const res = await resolveLibraryEffectiveAccess(
      {
        userId: "u-admin",
        qaModeCookie: "STARTER",
        now,
        env: { NODE_ENV: "development" }, // flag missing
      },
      client
    );
    if (res.ok) {
      check(
        "feature disabled — override ignored",
        res.access.qaOverride,
        null
      );
      check(
        "feature disabled — effective is admin default",
        res.access.effectiveMode,
        "ADMIN"
      );
    }
  }

  // 6) Production disables regardless of flag
  {
    const store = makeStore();
    const client = buildClient(store);
    seedUser(store, { id: "u-admin", plan: "FREE", isAdmin: true });
    const res = await resolveLibraryEffectiveAccess(
      {
        userId: "u-admin",
        qaModeCookie: "STARTER",
        now,
        env: {
          NODE_ENV: "production",
          [LIBRARY_QA_MODE_ENV_FLAG]: "true",
        },
      },
      client
    );
    if (res.ok) {
      check(
        "production — feature unavailable",
        res.access.qaFeatureAvailable,
        false
      );
      check(
        "production — override ignored",
        res.access.qaOverride,
        null
      );
      check(
        "production — admin defaults ADMIN",
        res.access.effectiveMode,
        "ADMIN"
      );
    }
  }

  // 7) Invalid cookie value silently ignored
  {
    const store = makeStore();
    const client = buildClient(store);
    seedUser(store, { id: "u-admin", plan: "FREE", isAdmin: true });
    const res = await resolveLibraryEffectiveAccess(
      {
        userId: "u-admin",
        qaModeCookie: "SUPERADMIN",
        now,
        env: {
          NODE_ENV: "development",
          [LIBRARY_QA_MODE_ENV_FLAG]: "true",
        },
      },
      client
    );
    if (res.ok) {
      check("invalid cookie ignored", res.access.qaOverride, null);
      check(
        "invalid cookie effective admin",
        res.access.effectiveMode,
        "ADMIN"
      );
    }
  }

  // 8) Unauthenticated
  {
    const store = makeStore();
    const client = buildClient(store);
    const res = await resolveLibraryEffectiveAccess(
      {
        userId: null,
        qaModeCookie: "ADMIN",
        now,
        env: {
          NODE_ENV: "development",
          [LIBRARY_QA_MODE_ENV_FLAG]: "true",
        },
      },
      client
    );
    check("no user → auth required", res.ok, false);
    if (!res.ok) {
      check("no user error", res.error, "AUTH_REQUIRED");
    }
    // No DB read for unauthenticated caller.
    check("no user — no DB call", store.callLog.length, 0);
  }
}

// ─── Audio-access + effective mode integration ───────────────────────────

async function testAudioAccessWithEffectiveMode(): Promise<void> {
  console.log(
    "\n── Audio access × effective mode ──────────────────────────────"
  );

  const now = new Date("2026-07-15T12:00:00.000Z");

  // Baseline: real FREE user, no unlock → UNLOCK_REQUIRED
  {
    const store = makeStore();
    const client = buildClient(store);
    seedUser(store, { id: "u", plan: "FREE", isAdmin: false });
    seedSession(store, "s");
    seedChapter(store, { id: "c", librarySessionId: "s" });
    const res = await resolveLibraryAudioAccess(
      { userId: "u", librarySessionChapterId: "c", now },
      client
    );
    check("FREE no unlock — refused", res.ok, false);
    if (!res.ok) check("FREE no unlock error", res.error, "UNLOCK_REQUIRED");
  }

  // ADMIN override bypasses unlock even when DB plan is FREE
  {
    const store = makeStore();
    const client = buildClient(store);
    seedUser(store, { id: "u", plan: "FREE", isAdmin: true });
    seedSession(store, "s");
    seedChapter(store, { id: "c", librarySessionId: "s" });
    const eff: LibraryEffectiveAccess = {
      databasePlan: "FREE",
      isAdmin: true,
      defaultMode: "ADMIN",
      qaOverride: null,
      effectiveMode: "ADMIN",
      qaFeatureAvailable: true,
      hasDirectAccess: true,
      requiresSponsoredUnlockPath: false,
    };
    const res = await resolveLibraryAudioAccess(
      {
        userId: "u",
        librarySessionChapterId: "c",
        effectiveAccess: eff,
        now,
      },
      client
    );
    check("ADMIN override — ok=true", res.ok, true);
    if (res.ok) {
      check(
        "ADMIN override — direct plan outcome",
        res.outcome,
        "allowed_direct_plan"
      );
    }
    // No unlock query happened.
    check(
      "ADMIN override — no unlock call",
      store.callLog.some((s) => s.startsWith("libraryUnlock.findFirst")),
      false
    );
  }

  // FREE QA override on an admin still enforces the unlock gate
  {
    const store = makeStore();
    const client = buildClient(store);
    seedUser(store, { id: "u", plan: "PREMIUM", isAdmin: true });
    seedSession(store, "s");
    seedChapter(store, { id: "c", librarySessionId: "s" });
    const eff: LibraryEffectiveAccess = {
      databasePlan: "PREMIUM",
      isAdmin: true,
      defaultMode: "ADMIN",
      qaOverride: "FREE",
      effectiveMode: "FREE",
      qaFeatureAvailable: true,
      hasDirectAccess: false,
      requiresSponsoredUnlockPath: true,
    };
    const res = await resolveLibraryAudioAccess(
      {
        userId: "u",
        librarySessionChapterId: "c",
        effectiveAccess: eff,
        now,
      },
      client
    );
    check("FREE override — no unlock refused", res.ok, false);
    if (!res.ok) {
      check(
        "FREE override — UNLOCK_REQUIRED",
        res.error,
        "UNLOCK_REQUIRED"
      );
    }
  }

  // FREE override + active unlock → allowed_active_unlock (expiry visible)
  {
    const store = makeStore();
    const client = buildClient(store);
    seedUser(store, { id: "u", plan: "PREMIUM", isAdmin: true });
    seedSession(store, "s");
    seedChapter(store, { id: "c", librarySessionId: "s" });
    const expiresAt = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    seedUnlock(store, { userId: "u", librarySessionId: "s", expiresAt });
    const eff: LibraryEffectiveAccess = {
      databasePlan: "PREMIUM",
      isAdmin: true,
      defaultMode: "ADMIN",
      qaOverride: "FREE",
      effectiveMode: "FREE",
      qaFeatureAvailable: true,
      hasDirectAccess: false,
      requiresSponsoredUnlockPath: true,
    };
    const res = await resolveLibraryAudioAccess(
      {
        userId: "u",
        librarySessionChapterId: "c",
        effectiveAccess: eff,
        now,
      },
      client
    );
    check("FREE override + unlock — ok=true", res.ok, true);
    if (res.ok) {
      check(
        "FREE override + unlock — outcome",
        res.outcome,
        "allowed_active_unlock"
      );
      if (res.outcome === "allowed_active_unlock") {
        check(
          "FREE override + unlock — expiry present",
          res.unlockExpiresAt.getTime(),
          expiresAt.getTime()
        );
      }
    }
  }

  // STARTER override on a FREE-DB admin also bypasses unlock
  {
    const store = makeStore();
    const client = buildClient(store);
    seedUser(store, { id: "u", plan: "FREE", isAdmin: true });
    seedSession(store, "s");
    seedChapter(store, { id: "c", librarySessionId: "s" });
    const eff: LibraryEffectiveAccess = {
      databasePlan: "FREE",
      isAdmin: true,
      defaultMode: "ADMIN",
      qaOverride: "STARTER",
      effectiveMode: "STARTER",
      qaFeatureAvailable: true,
      hasDirectAccess: true,
      requiresSponsoredUnlockPath: false,
    };
    const res = await resolveLibraryAudioAccess(
      {
        userId: "u",
        librarySessionChapterId: "c",
        effectiveAccess: eff,
        now,
      },
      client
    );
    check("STARTER override — ok=true", res.ok, true);
    if (res.ok) {
      check(
        "STARTER override — direct plan outcome",
        res.outcome,
        "allowed_direct_plan"
      );
    }
  }
}

// ─── Runner ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await Promise.resolve(testQaStorageHelper());
  await testEffectiveAccess();
  await testAudioAccessWithEffectiveMode();

  console.log("\n─── Summary ────────────────────────────────────────────────");
  console.log(`  passed: ${passed}`);
  console.log(`  failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("test suite crashed:", err);
  process.exit(1);
});
