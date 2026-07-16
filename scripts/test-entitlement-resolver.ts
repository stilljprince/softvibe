// scripts/test-entitlement-resolver.ts
//
// Offline unit tests for the RP-010 Phase 2B-1 / 2B-2 Entitlement Resolver.
// Exercises the pure-function core (calculateResolvedEntitlements and
// resolveEffectivePlan) only — does NOT connect to the database. Run with:
//
//   npx tsx scripts/test-entitlement-resolver.ts
//
// Covers:
//   * Free with no PeriodUsage → allowance 0, remaining 0
//   * Starter with no PeriodUsage → allowance 80, remaining 80
//   * Premium with no PeriodUsage → allowance 200, remaining 200
//   * Starter with used and reserved minutes
//   * Premium at the exact limit
//   * Over-limit / stale data clamps remaining to zero
//   * Probe count: zero / one / two / over-limit clamped
//   * Paid plans have canUse = false for probes
//   * Direct Library access: FREE=false, STARTER=true, PREMIUM=true
//   * FREE ignores stale PeriodUsage minutes
//   * Phase 2B-2: effective-plan resolution against planPeriodEnd
//       - Paid plan with future planPeriodEnd → stays paid
//       - Paid plan with elapsed planPeriodEnd → effective FREE
//       - Paid plan with planPeriodEnd === null → stays paid (deferred)
//       - Effective FREE zeros minutes, disables library, enables probe
//       - Deterministic against the supplied `now` value
//
// Missing-User is exercised via the DB-facing resolver signature only
// (return shape asserted at compile time — no live DB call here).

import {
  calculateResolvedEntitlements,
  resolveEffectivePlan,
  type ResolveEntitlementsResult,
  type ResolverInput,
} from "../lib/entitlement/resolver";
import { PROBE_LIFETIME_LIMIT } from "../lib/entitlement/plan";

type Case = {
  name: string;
  input: ResolverInput;
  /**
   * Optional wall-clock override. When omitted the test uses `defaultNow`
   * (well before every fixture's planPeriodEnd), so all pre-existing tests
   * remain deterministic regardless of when they run.
   */
  now?: Date;
  /**
   * Expected effective plan reported by the resolver. Optional — when
   * omitted the effective plan is expected to equal `input.plan`.
   */
  effectivePlan?: ResolverInput["plan"];
  expect: {
    allowance: number;
    used: number;
    reserved: number;
    remaining: number;
    probeUsed: number;
    probeRemaining: number;
    canUseProbe: boolean;
    directLibraryAccess: boolean;
    periodStart: Date | null;
    periodEnd: Date | null;
  };
};

const nowStart = new Date("2026-07-01T00:00:00.000Z");
const nowEnd = new Date("2026-08-01T00:00:00.000Z");
// Deterministic reference time used by every fixture that does not set
// its own `now`. Sits inside the [nowStart, nowEnd] period so paid plans
// with planPeriodEnd = nowEnd remain paid.
const defaultNow = new Date("2026-07-15T00:00:00.000Z");
// Reference time used by expired-plan fixtures. Chosen to sit past nowEnd
// so any planPeriodEnd = nowEnd has clearly elapsed.
const laterNow = new Date("2026-09-01T00:00:00.000Z");

const cases: Case[] = [
  {
    name: "FREE, no PeriodUsage, zero probes",
    input: {
      plan: "FREE",
      planPeriodStart: null,
      planPeriodEnd: null,
      probeGenerationsUsed: 0,
      periodUsage: null,
    },
    expect: {
      allowance: 0,
      used: 0,
      reserved: 0,
      remaining: 0,
      probeUsed: 0,
      probeRemaining: 2,
      canUseProbe: true,
      directLibraryAccess: false,
      periodStart: null,
      periodEnd: null,
    },
  },
  {
    name: "FREE, one probe used",
    input: {
      plan: "FREE",
      planPeriodStart: null,
      planPeriodEnd: null,
      probeGenerationsUsed: 1,
      periodUsage: null,
    },
    expect: {
      allowance: 0,
      used: 0,
      reserved: 0,
      remaining: 0,
      probeUsed: 1,
      probeRemaining: 1,
      canUseProbe: true,
      directLibraryAccess: false,
      periodStart: null,
      periodEnd: null,
    },
  },
  {
    name: "FREE, two probes used → canUse false",
    input: {
      plan: "FREE",
      planPeriodStart: null,
      planPeriodEnd: null,
      probeGenerationsUsed: 2,
      periodUsage: null,
    },
    expect: {
      allowance: 0,
      used: 0,
      reserved: 0,
      remaining: 0,
      probeUsed: 2,
      probeRemaining: 0,
      canUseProbe: false,
      directLibraryAccess: false,
      periodStart: null,
      periodEnd: null,
    },
  },
  {
    name: "FREE, three probes used (stale/invalid) → clamped to 0 remaining",
    input: {
      plan: "FREE",
      planPeriodStart: null,
      planPeriodEnd: null,
      probeGenerationsUsed: 3,
      periodUsage: null,
    },
    expect: {
      allowance: 0,
      used: 0,
      reserved: 0,
      remaining: 0,
      probeUsed: 3,
      probeRemaining: 0,
      canUseProbe: false,
      directLibraryAccess: false,
      periodStart: null,
      periodEnd: null,
    },
  },
  {
    name: "FREE ignores stale PeriodUsage minutes",
    input: {
      plan: "FREE",
      planPeriodStart: nowStart,
      planPeriodEnd: nowEnd,
      probeGenerationsUsed: 0,
      periodUsage: { minutesUsed: 50, minutesReserved: 10 },
    },
    expect: {
      allowance: 0,
      used: 0,
      reserved: 0,
      remaining: 0,
      probeUsed: 0,
      probeRemaining: 2,
      canUseProbe: true,
      directLibraryAccess: false,
      periodStart: nowStart,
      periodEnd: nowEnd,
    },
  },
  {
    name: "STARTER, no PeriodUsage → full allowance remaining",
    input: {
      plan: "STARTER",
      planPeriodStart: nowStart,
      planPeriodEnd: nowEnd,
      probeGenerationsUsed: 0,
      periodUsage: null,
    },
    expect: {
      allowance: 80,
      used: 0,
      reserved: 0,
      remaining: 80,
      probeUsed: 0,
      probeRemaining: 2,
      canUseProbe: false, // paid plan
      directLibraryAccess: true,
      periodStart: nowStart,
      periodEnd: nowEnd,
    },
  },
  {
    name: "STARTER, used 30 reserved 10 → remaining 40",
    input: {
      plan: "STARTER",
      planPeriodStart: nowStart,
      planPeriodEnd: nowEnd,
      probeGenerationsUsed: 0,
      periodUsage: { minutesUsed: 30, minutesReserved: 10 },
    },
    expect: {
      allowance: 80,
      used: 30,
      reserved: 10,
      remaining: 40,
      probeUsed: 0,
      probeRemaining: 2,
      canUseProbe: false,
      directLibraryAccess: true,
      periodStart: nowStart,
      periodEnd: nowEnd,
    },
  },
  {
    name: "PREMIUM, no PeriodUsage → 200 remaining",
    input: {
      plan: "PREMIUM",
      planPeriodStart: nowStart,
      planPeriodEnd: nowEnd,
      probeGenerationsUsed: 0,
      periodUsage: null,
    },
    expect: {
      allowance: 200,
      used: 0,
      reserved: 0,
      remaining: 200,
      probeUsed: 0,
      probeRemaining: 2,
      canUseProbe: false,
      directLibraryAccess: true,
      periodStart: nowStart,
      periodEnd: nowEnd,
    },
  },
  {
    name: "PREMIUM at exact limit → remaining 0",
    input: {
      plan: "PREMIUM",
      planPeriodStart: nowStart,
      planPeriodEnd: nowEnd,
      probeGenerationsUsed: 0,
      periodUsage: { minutesUsed: 200, minutesReserved: 0 },
    },
    expect: {
      allowance: 200,
      used: 200,
      reserved: 0,
      remaining: 0,
      probeUsed: 0,
      probeRemaining: 2,
      canUseProbe: false,
      directLibraryAccess: true,
      periodStart: nowStart,
      periodEnd: nowEnd,
    },
  },
  {
    name: "PREMIUM over-limit (used + reserved > allowance) → clamped to 0",
    input: {
      plan: "PREMIUM",
      planPeriodStart: nowStart,
      planPeriodEnd: nowEnd,
      probeGenerationsUsed: 0,
      periodUsage: { minutesUsed: 180, minutesReserved: 40 },
    },
    expect: {
      allowance: 200,
      used: 180,
      reserved: 40,
      remaining: 0,
      probeUsed: 0,
      probeRemaining: 2,
      canUseProbe: false,
      directLibraryAccess: true,
      periodStart: nowStart,
      periodEnd: nowEnd,
    },
  },
  {
    name: "STARTER with negative stale minutes → clamped to 0",
    input: {
      plan: "STARTER",
      planPeriodStart: nowStart,
      planPeriodEnd: nowEnd,
      probeGenerationsUsed: 0,
      periodUsage: { minutesUsed: -5, minutesReserved: -3 },
    },
    expect: {
      allowance: 80,
      used: 0,
      reserved: 0,
      remaining: 80,
      probeUsed: 0,
      probeRemaining: 2,
      canUseProbe: false,
      directLibraryAccess: true,
      periodStart: nowStart,
      periodEnd: nowEnd,
    },
  },

  // ------------------------------------------------------------------
  // RP-010 Phase 2B-2: effective plan against planPeriodEnd (Option C)
  // ------------------------------------------------------------------

  // (1) STARTER with future planPeriodEnd stays STARTER.
  {
    name: "STARTER, planPeriodEnd in the future → stays STARTER",
    input: {
      plan: "STARTER",
      planPeriodStart: nowStart,
      planPeriodEnd: nowEnd,
      probeGenerationsUsed: 0,
      periodUsage: { minutesUsed: 5, minutesReserved: 5 },
    },
    now: defaultNow,
    effectivePlan: "STARTER",
    expect: {
      allowance: 80,
      used: 5,
      reserved: 5,
      remaining: 70,
      probeUsed: 0,
      probeRemaining: 2,
      canUseProbe: false,
      directLibraryAccess: true,
      periodStart: nowStart,
      periodEnd: nowEnd,
    },
  },

  // (2) PREMIUM with future planPeriodEnd stays PREMIUM.
  {
    name: "PREMIUM, planPeriodEnd in the future → stays PREMIUM",
    input: {
      plan: "PREMIUM",
      planPeriodStart: nowStart,
      planPeriodEnd: nowEnd,
      probeGenerationsUsed: 0,
      periodUsage: { minutesUsed: 12, minutesReserved: 3 },
    },
    now: defaultNow,
    effectivePlan: "PREMIUM",
    expect: {
      allowance: 200,
      used: 12,
      reserved: 3,
      remaining: 185,
      probeUsed: 0,
      probeRemaining: 2,
      canUseProbe: false,
      directLibraryAccess: true,
      periodStart: nowStart,
      periodEnd: nowEnd,
    },
  },

  // (3) STARTER with planPeriodEnd exactly at now → effective FREE.
  //     Rule: planPeriodEnd <= now expires the paid plan.
  {
    name: "STARTER, planPeriodEnd exactly at now → effective FREE",
    input: {
      plan: "STARTER",
      planPeriodStart: nowStart,
      planPeriodEnd: nowEnd,
      probeGenerationsUsed: 0,
      periodUsage: { minutesUsed: 60, minutesReserved: 10 },
    },
    now: nowEnd,
    effectivePlan: "FREE",
    expect: {
      allowance: 0,
      used: 0,
      reserved: 0,
      remaining: 0,
      probeUsed: 0,
      probeRemaining: 2,
      canUseProbe: true,
      directLibraryAccess: false,
      periodStart: nowStart,
      periodEnd: nowEnd,
    },
  },

  // (4) PREMIUM with elapsed planPeriodEnd → effective FREE.
  {
    name: "PREMIUM, planPeriodEnd in the past → effective FREE",
    input: {
      plan: "PREMIUM",
      planPeriodStart: nowStart,
      planPeriodEnd: nowEnd,
      probeGenerationsUsed: 0,
      periodUsage: { minutesUsed: 150, minutesReserved: 20 },
    },
    now: laterNow,
    effectivePlan: "FREE",
    expect: {
      allowance: 0,
      used: 0,
      reserved: 0,
      remaining: 0,
      probeUsed: 0,
      probeRemaining: 2,
      canUseProbe: true,
      directLibraryAccess: false,
      periodStart: nowStart,
      periodEnd: nowEnd,
    },
  },

  // (5) Expired paid plan: monthly numbers all collapse to zero and
  //     direct Library access is lost — proves the effective plan drives
  //     every numeric field, not just the reported plan label.
  {
    name: "STARTER expired → allowance/used/reserved/remaining all 0, no lib access",
    input: {
      plan: "STARTER",
      planPeriodStart: nowStart,
      planPeriodEnd: nowEnd,
      probeGenerationsUsed: 0,
      // Stale PeriodUsage from the previous paid period must be ignored.
      periodUsage: { minutesUsed: 80, minutesReserved: 0 },
    },
    now: laterNow,
    effectivePlan: "FREE",
    expect: {
      allowance: 0,
      used: 0,
      reserved: 0,
      remaining: 0,
      probeUsed: 0,
      probeRemaining: 2,
      canUseProbe: true,
      directLibraryAccess: false,
      periodStart: nowStart,
      periodEnd: nowEnd,
    },
  },

  // (6) Expired paid plan: Probe canUse follows effective FREE, gated
  //     only by the remaining lifetime probe quota.
  {
    name: "PREMIUM expired, one probe already used → canUse true (1 left)",
    input: {
      plan: "PREMIUM",
      planPeriodStart: nowStart,
      planPeriodEnd: nowEnd,
      probeGenerationsUsed: 1,
      periodUsage: null,
    },
    now: laterNow,
    effectivePlan: "FREE",
    expect: {
      allowance: 0,
      used: 0,
      reserved: 0,
      remaining: 0,
      probeUsed: 1,
      probeRemaining: 1,
      canUseProbe: true,
      directLibraryAccess: false,
      periodStart: nowStart,
      periodEnd: nowEnd,
    },
  },
  {
    name: "PREMIUM expired, probe quota exhausted → canUse false",
    input: {
      plan: "PREMIUM",
      planPeriodStart: nowStart,
      planPeriodEnd: nowEnd,
      probeGenerationsUsed: 2,
      periodUsage: null,
    },
    now: laterNow,
    effectivePlan: "FREE",
    expect: {
      allowance: 0,
      used: 0,
      reserved: 0,
      remaining: 0,
      probeUsed: 2,
      probeRemaining: 0,
      canUseProbe: false,
      directLibraryAccess: false,
      periodStart: nowStart,
      periodEnd: nowEnd,
    },
  },

  // (7) Persisted FREE with a bogus future planPeriodEnd stays FREE.
  //     The effective-plan rule must never upgrade a FREE user.
  {
    name: "FREE with future planPeriodEnd → stays FREE",
    input: {
      plan: "FREE",
      planPeriodStart: nowStart,
      planPeriodEnd: nowEnd,
      probeGenerationsUsed: 0,
      periodUsage: null,
    },
    now: defaultNow,
    effectivePlan: "FREE",
    expect: {
      allowance: 0,
      used: 0,
      reserved: 0,
      remaining: 0,
      probeUsed: 0,
      probeRemaining: 2,
      canUseProbe: true,
      directLibraryAccess: false,
      periodStart: nowStart,
      periodEnd: nowEnd,
    },
  },

  // (8) Paid plan without any planPeriodEnd stays paid for now.
  //     Rationale: legacy demo / test accounts that predate Stripe sync
  //     may still be missing period boundaries. See resolveEffectivePlan.
  {
    name: "STARTER, planPeriodEnd === null → stays STARTER (legacy)",
    input: {
      plan: "STARTER",
      planPeriodStart: null,
      planPeriodEnd: null,
      probeGenerationsUsed: 0,
      periodUsage: null,
    },
    now: defaultNow,
    effectivePlan: "STARTER",
    expect: {
      allowance: 80,
      used: 0,
      reserved: 0,
      remaining: 80,
      probeUsed: 0,
      probeRemaining: 2,
      canUseProbe: false,
      directLibraryAccess: true,
      periodStart: null,
      periodEnd: null,
    },
  },
  {
    name: "PREMIUM, planPeriodEnd === null → stays PREMIUM (legacy)",
    input: {
      plan: "PREMIUM",
      planPeriodStart: null,
      planPeriodEnd: null,
      probeGenerationsUsed: 0,
      periodUsage: { minutesUsed: 20, minutesReserved: 0 },
    },
    now: defaultNow,
    effectivePlan: "PREMIUM",
    expect: {
      allowance: 200,
      used: 20,
      reserved: 0,
      remaining: 180,
      probeUsed: 0,
      probeRemaining: 2,
      canUseProbe: false,
      directLibraryAccess: true,
      periodStart: null,
      periodEnd: null,
    },
  },
];

let passed = 0;
let failed = 0;

for (const c of cases) {
  const now = c.now ?? defaultNow;
  const r = calculateResolvedEntitlements(c.input, now);
  const expectedPlan = c.effectivePlan ?? c.input.plan;
  const checks: Array<[string, unknown, unknown]> = [
    ["plan (effective)", r.plan, expectedPlan],
    ["allowance", r.monthlyMinutes.allowance, c.expect.allowance],
    ["used", r.monthlyMinutes.used, c.expect.used],
    ["reserved", r.monthlyMinutes.reserved, c.expect.reserved],
    ["remaining", r.monthlyMinutes.remaining, c.expect.remaining],
    ["periodStart", r.billingPeriod.start, c.expect.periodStart],
    ["periodEnd", r.billingPeriod.end, c.expect.periodEnd],
    ["probes.lifetimeLimit", r.probes.lifetimeLimit, PROBE_LIFETIME_LIMIT],
    ["probes.used", r.probes.used, c.expect.probeUsed],
    ["probes.remaining", r.probes.remaining, c.expect.probeRemaining],
    ["probes.canUse", r.probes.canUse, c.expect.canUseProbe],
    ["library.hasDirectAccess", r.library.hasDirectAccess, c.expect.directLibraryAccess],
  ];

  const fails = checks.filter(([, actual, expected]) => {
    if (actual instanceof Date && expected instanceof Date) {
      return actual.getTime() !== expected.getTime();
    }
    return actual !== expected;
  });

  if (fails.length === 0) {
    console.log(`[PASS] ${c.name}`);
    passed++;
  } else {
    console.log(`[FAIL] ${c.name}`);
    for (const [field, actual, expected] of fails) {
      console.log(`       ${field}: expected=${String(expected)} actual=${String(actual)}`);
    }
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Direct unit tests for resolveEffectivePlan
// ---------------------------------------------------------------------------

function checkEffective(
  name: string,
  actual: unknown,
  expected: unknown
): void {
  if (actual === expected) {
    console.log(`[PASS] ${name}`);
    passed++;
  } else {
    console.log(
      `[FAIL] ${name}\n       expected=${String(expected)}\n       actual=  ${String(actual)}`
    );
    failed++;
  }
}

checkEffective(
  "resolveEffectivePlan: FREE with null period stays FREE",
  resolveEffectivePlan("FREE", null, defaultNow),
  "FREE"
);
checkEffective(
  "resolveEffectivePlan: FREE with future period stays FREE",
  resolveEffectivePlan("FREE", nowEnd, defaultNow),
  "FREE"
);
checkEffective(
  "resolveEffectivePlan: FREE with past period stays FREE",
  resolveEffectivePlan("FREE", nowEnd, laterNow),
  "FREE"
);
checkEffective(
  "resolveEffectivePlan: STARTER with future period stays STARTER",
  resolveEffectivePlan("STARTER", nowEnd, defaultNow),
  "STARTER"
);
checkEffective(
  "resolveEffectivePlan: PREMIUM with future period stays PREMIUM",
  resolveEffectivePlan("PREMIUM", nowEnd, defaultNow),
  "PREMIUM"
);
checkEffective(
  "resolveEffectivePlan: STARTER at exact planPeriodEnd → FREE",
  resolveEffectivePlan("STARTER", nowEnd, nowEnd),
  "FREE"
);
checkEffective(
  "resolveEffectivePlan: PREMIUM past planPeriodEnd → FREE",
  resolveEffectivePlan("PREMIUM", nowEnd, laterNow),
  "FREE"
);
checkEffective(
  "resolveEffectivePlan: STARTER with null period stays STARTER (legacy)",
  resolveEffectivePlan("STARTER", null, defaultNow),
  "STARTER"
);
checkEffective(
  "resolveEffectivePlan: PREMIUM with null period stays PREMIUM (legacy)",
  resolveEffectivePlan("PREMIUM", null, laterNow),
  "PREMIUM"
);

// (9) Determinism: identical inputs and identical `now` produce identical
// outputs; and toggling `now` across the boundary flips the effective plan
// exactly at planPeriodEnd — proving `now` is the only clock the resolver
// consults.
{
  const input: ResolverInput = {
    plan: "STARTER",
    planPeriodStart: nowStart,
    planPeriodEnd: nowEnd,
    probeGenerationsUsed: 0,
    periodUsage: { minutesUsed: 10, minutesReserved: 5 },
  };
  const a = calculateResolvedEntitlements(input, defaultNow);
  const b = calculateResolvedEntitlements(input, defaultNow);
  checkEffective(
    "determinism: same input + same now → same plan",
    JSON.stringify({
      p: a.plan,
      m: a.monthlyMinutes,
      pr: a.probes,
      l: a.library,
    }),
    JSON.stringify({
      p: b.plan,
      m: b.monthlyMinutes,
      pr: b.probes,
      l: b.library,
    })
  );

  // One millisecond before planPeriodEnd → still paid.
  const justBefore = new Date(nowEnd.getTime() - 1);
  checkEffective(
    "determinism: 1 ms before periodEnd → STARTER",
    calculateResolvedEntitlements(input, justBefore).plan,
    "STARTER"
  );
  // Exactly at planPeriodEnd → FREE.
  checkEffective(
    "determinism: exactly at periodEnd → FREE",
    calculateResolvedEntitlements(input, nowEnd).plan,
    "FREE"
  );
  // One millisecond after planPeriodEnd → FREE.
  const justAfter = new Date(nowEnd.getTime() + 1);
  checkEffective(
    "determinism: 1 ms after periodEnd → FREE",
    calculateResolvedEntitlements(input, justAfter).plan,
    "FREE"
  );
}

// Compile-time / structural assertions for the DB-facing signature.
// (We do not call the DB here; we only prove the discriminated union shape.)
function assertResultShape(r: ResolveEntitlementsResult): void {
  if (r.ok) {
    // Access every documented field to guarantee they exist on the type.
    void r.data.plan;
    void r.data.monthlyMinutes.allowance;
    void r.data.monthlyMinutes.used;
    void r.data.monthlyMinutes.reserved;
    void r.data.monthlyMinutes.remaining;
    void r.data.billingPeriod.start;
    void r.data.billingPeriod.end;
    void r.data.probes.lifetimeLimit;
    void r.data.probes.used;
    void r.data.probes.remaining;
    void r.data.probes.canUse;
    void r.data.library.hasDirectAccess;
  } else {
    if (r.error !== "USER_NOT_FOUND") {
      throw new Error(`unexpected error variant: ${r.error}`);
    }
  }
}
void assertResultShape;

console.log("");
console.log(`Total: ${passed + failed}   Passed: ${passed}   Failed: ${failed}`);
if (failed > 0) process.exit(1);
