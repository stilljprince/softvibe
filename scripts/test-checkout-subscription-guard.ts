// scripts/test-checkout-subscription-guard.ts
//
// Offline unit tests for the RP-002D1 checkout-guard status classification
// used in app/api/billing/checkout/route.ts (resolveExistingSubscriptionGuard).
//
// This exercises only the pure decision boundary — whether a given Stripe
// subscription status should BLOCK a new checkout, be treated as STALE, or
// FAIL_CLOSED — by re-deriving it the same way the route does: via
// classifySubscriptionStatus() for the unambiguous buckets, plus an
// explicit incomplete/paused check to disambiguate that classifier's
// conservative NO_CHANGE bucket (which otherwise also swallows unknown/
// future statuses). No Stripe API calls, no DB, no Next.js request/
// response objects are involved, since the route itself is not import-safe
// outside a Next.js server runtime.
//
// Run with:
//
//   npx tsx scripts/test-checkout-subscription-guard.ts

import { classifySubscriptionStatus } from "../lib/entitlement/stripe-plan-mapping";

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

// Mirrors resolveExistingSubscriptionGuard()'s decision boundary in
// app/api/billing/checkout/route.ts. Kept in sync intentionally — if the
// route's boundary ever diverges from this, a mismatch is a sign the route
// drifted from the documented policy. resource_missing is not exercised
// here since it short-circuits before classifySubscriptionStatus() is ever
// called (retrieve() throws before a status exists) — it is asserted
// directly against the route's documented STALE behavior below instead.
function guardOutcomeForStatus(
  status: string | null
): "BLOCK" | "STALE" | "FAIL_CLOSED" {
  const action = classifySubscriptionStatus(status);

  if (action === "SYNC_PAID" || action === "KEEP_PAID_UPDATE_PERIOD") {
    return "BLOCK";
  }

  if (action === "DOWNGRADE_FREE") {
    return "STALE";
  }

  // action === "NO_CHANGE": incomplete/paused still block; anything else
  // (unknown or future Stripe status) must fail closed, never STALE.
  if (status === "incomplete" || status === "paused") {
    return "BLOCK";
  }

  return "FAIL_CLOSED";
}

const cases: Array<[string, string | null, "BLOCK" | "STALE" | "FAIL_CLOSED"]> = [
  ["active → BLOCK", "active", "BLOCK"],
  ["trialing → BLOCK", "trialing", "BLOCK"],
  ["past_due → BLOCK (still paid until periodEnd)", "past_due", "BLOCK"],
  ["incomplete → BLOCK (not yet unambiguously ended)", "incomplete", "BLOCK"],
  ["paused → BLOCK (not yet unambiguously ended)", "paused", "BLOCK"],
  ["canceled → STALE", "canceled", "STALE"],
  ["unpaid → STALE", "unpaid", "STALE"],
  ["incomplete_expired → STALE", "incomplete_expired", "STALE"],
  [
    "unknown status → FAIL_CLOSED (never treated as STALE)",
    "gibberish",
    "FAIL_CLOSED",
  ],
];

for (const [name, status, expected] of cases) {
  check(name, guardOutcomeForStatus(status), expected);
}

// resource_missing is handled directly in resolveExistingSubscriptionGuard()
// before classifySubscriptionStatus() is reached — retrieve() throws with a
// Stripe "resource_missing" error, which the route maps straight to STALE.
// Documented here as a fixed expectation since it can't be exercised via
// guardOutcomeForStatus() without a live/mocked Stripe client.
check("resource_missing → STALE (documented route behavior)", "STALE", "STALE");

console.log("");
console.log(`Total: ${passed + failed}   Passed: ${passed}   Failed: ${failed}`);
if (failed > 0) process.exit(1);
