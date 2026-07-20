// scripts/test-header-entitlement-label.ts
//
// Offline unit tests for RP-004B — verifies that the shared plan-aware
// entitlement label produced by the header pill:
//
//   * Admin → "∞ Custom Minutes"
//   * FREE  → "N Freie Generierung(en)" based on probes.remaining
//   * Paid  → "N Custom Minutes" based on monthlyMinutes.remaining
//   * missing snapshot (loading / error / unknown plan) → null
//
// This test is intentionally decoupled from the DOM and from the Prisma
// runtime — it exercises the pure display-mapping function that lives
// alongside the React component (renderEntitlementLabel).
//
// Run with:
//
//   npx tsx scripts/test-header-entitlement-label.ts

import { renderEntitlementLabel } from "../app/components/HeaderCredits";
import type { EntitlementsView } from "../lib/entitlement-view";

let failed = 0;
let passed = 0;

function assertEq(actual: unknown, expected: unknown, label: string) {
  if (actual === expected) {
    passed += 1;
    console.log(`  ok  ${label}`);
    return;
  }
  failed += 1;
  console.error(`  FAIL ${label}\n    expected: ${String(expected)}\n    actual:   ${String(actual)}`);
}

function freeEnt(remaining: number, lifetimeLimit = 2): EntitlementsView {
  return {
    plan: "FREE",
    monthlyMinutes: { allowance: 0, used: 0, reserved: 0, remaining: 0 },
    probes: {
      lifetimeLimit,
      used: Math.max(0, lifetimeLimit - remaining),
      remaining,
      canUse: remaining > 0,
    },
    library: { hasDirectAccess: false },
  };
}

function paidEnt(
  plan: "STARTER" | "PREMIUM",
  allowance: number,
  remaining: number,
): EntitlementsView {
  return {
    plan,
    monthlyMinutes: {
      allowance,
      used: Math.max(0, allowance - remaining),
      reserved: 0,
      remaining,
    },
    probes: { lifetimeLimit: 2, used: 0, remaining: 0, canUse: false },
    library: { hasDirectAccess: true },
  };
}

// ── Admin ────────────────────────────────────────────────────────────────
console.log("Admin display");
assertEq(
  renderEntitlementLabel({ isAdmin: true, hasSubscription: false, entitlements: null }),
  "∞ Custom Minutes",
  "admin without paid subscription → unlimited label",
);
assertEq(
  renderEntitlementLabel({ isAdmin: true, hasSubscription: true, entitlements: paidEnt("PREMIUM", 200, 200) }),
  "∞ Custom Minutes",
  "admin overrides any resolved plan",
);

// ── FREE probe states ─────────────────────────────────────────────────────
console.log("FREE probe states");
assertEq(
  renderEntitlementLabel({ isAdmin: false, hasSubscription: false, entitlements: freeEnt(2) }),
  "2 Freie Generierungen",
  "FREE with two probes remaining",
);
assertEq(
  renderEntitlementLabel({ isAdmin: false, hasSubscription: false, entitlements: freeEnt(1) }),
  "1 Freie Generierung",
  "FREE with one probe remaining uses singular form",
);
assertEq(
  renderEntitlementLabel({ isAdmin: false, hasSubscription: false, entitlements: freeEnt(0) }),
  "0 Freie Generierungen",
  "FREE with zero probes still renders the entitlement, never Credits",
);

// ── STARTER / PREMIUM Custom Minutes ──────────────────────────────────────
console.log("STARTER / PREMIUM display");
assertEq(
  renderEntitlementLabel({ isAdmin: false, hasSubscription: true, entitlements: paidEnt("STARTER", 80, 80) }),
  "80 Custom Minutes",
  "STARTER full allowance",
);
assertEq(
  renderEntitlementLabel({ isAdmin: false, hasSubscription: true, entitlements: paidEnt("STARTER", 80, 62) }),
  "62 Custom Minutes",
  "STARTER partially consumed",
);
assertEq(
  renderEntitlementLabel({ isAdmin: false, hasSubscription: true, entitlements: paidEnt("PREMIUM", 200, 145) }),
  "145 Custom Minutes",
  "PREMIUM partially consumed",
);
assertEq(
  renderEntitlementLabel({ isAdmin: false, hasSubscription: true, entitlements: paidEnt("PREMIUM", 200, 0) }),
  "0 Custom Minutes",
  "PREMIUM with zero minutes still renders the entitlement, never Credits",
);

// ── Missing / degraded snapshots ─────────────────────────────────────────
console.log("Loading / error / unknown states");
assertEq(
  renderEntitlementLabel({ isAdmin: false, hasSubscription: false, entitlements: null }),
  null,
  "missing entitlement snapshot renders nothing rather than a Credits fallback",
);
assertEq(
  renderEntitlementLabel({ isAdmin: false, hasSubscription: true, entitlements: null }),
  null,
  "paid user with missing snapshot renders nothing rather than Credits/User.credits",
);

// ── Clamping ─────────────────────────────────────────────────────────────
console.log("Defensive clamping");
{
  const negativeProbes: EntitlementsView = {
    plan: "FREE",
    monthlyMinutes: { allowance: 0, used: 0, reserved: 0, remaining: 0 },
    probes: { lifetimeLimit: 2, used: 3, remaining: -1, canUse: false },
    library: { hasDirectAccess: false },
  };
  assertEq(
    renderEntitlementLabel({ isAdmin: false, hasSubscription: false, entitlements: negativeProbes }),
    "0 Freie Generierungen",
    "negative probes.remaining clamps to zero",
  );

  const negativeMinutes: EntitlementsView = {
    plan: "STARTER",
    monthlyMinutes: { allowance: 80, used: 90, reserved: 0, remaining: -10 },
    probes: { lifetimeLimit: 2, used: 0, remaining: 0, canUse: false },
    library: { hasDirectAccess: true },
  };
  assertEq(
    renderEntitlementLabel({ isAdmin: false, hasSubscription: true, entitlements: negativeMinutes }),
    "0 Custom Minutes",
    "negative monthlyMinutes.remaining clamps to zero",
  );
}

console.log("\n──────────────────────────────────────────────");
console.log(`Passed: ${passed}   Failed: ${failed}`);
if (failed > 0) process.exit(1);
