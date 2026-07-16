// scripts/test-entitlement-resolver.ts
//
// Offline unit tests for the RP-010 Phase 2B-1 Entitlement Resolver.
// Exercises the pure-function core (calculateResolvedEntitlements) only —
// does NOT connect to the database. Run with:
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
//
// Missing-User is exercised via the DB-facing resolver signature only
// (return shape asserted at compile time — no live DB call here).

import {
  calculateResolvedEntitlements,
  type ResolveEntitlementsResult,
  type ResolverInput,
} from "../lib/entitlement/resolver";
import { PROBE_LIFETIME_LIMIT } from "../lib/entitlement/plan";

type Case = {
  name: string;
  input: ResolverInput;
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
];

let passed = 0;
let failed = 0;

for (const c of cases) {
  const r = calculateResolvedEntitlements(c.input);
  const checks: Array<[string, unknown, unknown]> = [
    ["plan", r.plan, c.input.plan],
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
