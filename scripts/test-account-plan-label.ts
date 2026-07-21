// scripts/test-account-plan-label.ts
//
// Offline unit tests for RP-004C — verifies that the shared visible plan
// label is sourced from the resolved-entitlement snapshot, not from a
// Stripe Price ID. Exercises the pure helper labelFromEntitlementPlan and
// its composition with resolveEffectivePlan so that a historical paid
// Stripe subscription whose billing period has elapsed renders as "Free".
//
// Run with:
//
//   npx tsx scripts/test-account-plan-label.ts

import {
  labelFromEntitlementPlan,
  resolveVisiblePlanStatus,
} from "../lib/entitlement-view";
import { resolveEffectivePlan } from "../lib/entitlement/resolver";

let passed = 0;
let failed = 0;

function assertEq(actual: unknown, expected: unknown, label: string): void {
  if (actual === expected) {
    passed += 1;
    console.log(`  ok  ${label}`);
    return;
  }
  failed += 1;
  console.error(
    `  FAIL ${label}\n    expected: ${String(expected)}\n    actual:   ${String(actual)}`
  );
}

// ── labelFromEntitlementPlan — direct mapping ────────────────────────────
console.log("labelFromEntitlementPlan");
assertEq(labelFromEntitlementPlan("FREE"), "Free", "FREE → Free");
assertEq(labelFromEntitlementPlan("STARTER"), "Starter", "STARTER → Starter");
assertEq(labelFromEntitlementPlan("PREMIUM"), "Premium", "PREMIUM → Premium");

// ── Composition with resolveEffectivePlan ────────────────────────────────
// Establishes the RP-004C acceptance rule: the visible plan label must
// follow the *effective* plan, so a paid subscription whose billing period
// has elapsed shows "Free" regardless of the persisted paid User.plan.
console.log("resolveEffectivePlan → labelFromEntitlementPlan");

const periodEnd = new Date("2026-08-01T00:00:00.000Z");
const insidePeriod = new Date("2026-07-15T00:00:00.000Z");
const afterPeriod = new Date("2026-09-01T00:00:00.000Z");

assertEq(
  labelFromEntitlementPlan(resolveEffectivePlan("FREE", null, insidePeriod)),
  "Free",
  "FREE user (no Stripe sub) renders as Free"
);
assertEq(
  labelFromEntitlementPlan(resolveEffectivePlan("STARTER", periodEnd, insidePeriod)),
  "Starter",
  "STARTER inside billing period renders as Starter"
);
assertEq(
  labelFromEntitlementPlan(resolveEffectivePlan("PREMIUM", periodEnd, insidePeriod)),
  "Premium",
  "PREMIUM inside billing period renders as Premium"
);
assertEq(
  labelFromEntitlementPlan(resolveEffectivePlan("STARTER", periodEnd, afterPeriod)),
  "Free",
  "historical STARTER with elapsed billing period renders as Free, not Starter"
);
assertEq(
  labelFromEntitlementPlan(resolveEffectivePlan("PREMIUM", periodEnd, afterPeriod)),
  "Free",
  "historical PREMIUM with elapsed billing period renders as Free, not Premium"
);
assertEq(
  labelFromEntitlementPlan(resolveEffectivePlan("STARTER", null, insidePeriod)),
  "Starter",
  "legacy STARTER without period boundaries still renders as Starter"
);
assertEq(
  labelFromEntitlementPlan(resolveEffectivePlan("PREMIUM", null, afterPeriod)),
  "Premium",
  "legacy PREMIUM without period boundaries still renders as Premium"
);

// ── resolveVisiblePlanStatus — Stripe status gated by effective plan ─────
// Establishes the RP-004C follow-up rule: the Stripe status decoration
// (aktiv / gekündigt / inaktiv) may only accompany the visible plan label
// when the effective entitlement plan is STARTER or PREMIUM. A FREE plan
// must never render an "aktiv / gekündigt / inaktiv" suffix, even when
// Stripe still reports the subscription as active.
console.log("resolveVisiblePlanStatus");

assertEq(
  resolveVisiblePlanStatus("STARTER", "aktiv"),
  "aktiv",
  "STARTER + Stripe active renders as aktiv"
);
assertEq(
  resolveVisiblePlanStatus("PREMIUM", "aktiv"),
  "aktiv",
  "PREMIUM + Stripe active renders as aktiv"
);
assertEq(
  resolveVisiblePlanStatus("STARTER", "gekündigt"),
  "gekündigt",
  "STARTER + Stripe canceled renders as gekündigt"
);
assertEq(
  resolveVisiblePlanStatus("PREMIUM", "inaktiv"),
  "inaktiv",
  "PREMIUM + Stripe past_due renders as inaktiv"
);
// The concrete edge case flagged in the RP-004C completion report: an
// effective FREE plan combined with a still-active Stripe subscription
// must NOT surface a status decoration at all.
assertEq(
  resolveVisiblePlanStatus("FREE", "aktiv"),
  null,
  "FREE effective plan + Stripe active → no visible status (no 'Free · aktiv')"
);
assertEq(
  resolveVisiblePlanStatus("FREE", "gekündigt"),
  null,
  "FREE effective plan + Stripe canceled → no visible status"
);
assertEq(
  resolveVisiblePlanStatus("FREE", "inaktiv"),
  null,
  "FREE effective plan + Stripe past_due → no visible status"
);
assertEq(
  resolveVisiblePlanStatus("FREE", null),
  null,
  "FREE effective plan without Stripe status stays null"
);
assertEq(
  resolveVisiblePlanStatus("STARTER", null),
  null,
  "STARTER without Stripe status stays null"
);

// End-to-end composition covering the exact production edge case: a paid
// subscription whose billing period has elapsed resolves to FREE, and even
// though Stripe still labels it aktiv, the visible pill must render as a
// plain "Free" without decoration.
console.log("elapsed-period edge case (FREE + Stripe aktiv)");
const effectivePlan = resolveEffectivePlan("STARTER", periodEnd, afterPeriod);
assertEq(effectivePlan, "FREE", "elapsed STARTER → effective FREE");
assertEq(
  labelFromEntitlementPlan(effectivePlan),
  "Free",
  "elapsed STARTER → label 'Free'"
);
assertEq(
  resolveVisiblePlanStatus(effectivePlan, "aktiv"),
  null,
  "elapsed STARTER with Stripe aktiv → no visible status suffix"
);

console.log("\n──────────────────────────────────────────────");
console.log(`Passed: ${passed}   Failed: ${failed}`);
if (failed > 0) process.exit(1);
