// scripts/test-stripe-plan-mapping.ts
//
// Offline unit tests for the RP-010 Phase 2B-2 Stripe plan-mapping and
// subscription-status helpers. Exercises only the pure helpers in
// lib/entitlement/stripe-plan-mapping.ts — no Stripe API calls, no DB.
//
// Run with:
//
//   npx tsx scripts/test-stripe-plan-mapping.ts
//
// Covers:
//   Plan mapping (Price ID + metadata fallback + unknown)
//   Billing-period extraction (defensive: missing / invalid values)
//   Subscription status classification (CEO Option C policy)

// --- Env fixture ----------------------------------------------------------
// The Price-ID mapper reads env at call time. Set fixtures BEFORE we call
// into the module.
process.env.STRIPE_PRICE_STARTER = "price_test_starter";
process.env.STRIPE_PRICE_PREMIUM = "price_test_premium";
process.env.STRIPE_PRICE_PRO = "price_test_legacy_pro";
process.env.STRIPE_PRICE_ULTRA = "price_test_legacy_ultra";

import type Stripe from "stripe";
import {
  mapStripePriceIdToPlan,
  mapMetadataPlanToPlan,
  classifySubscriptionStatus,
  derivePlanFromSubscription,
  extractBillingPeriod,
  type SubscriptionSyncAction,
} from "../lib/entitlement/stripe-plan-mapping";
import type { Plan } from "@prisma/client";

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

// --- Subscription mock builder --------------------------------------------
//
// Only the fields the mappers read are populated. We intentionally use `as
// unknown as Stripe.Subscription` casts so the tests do not have to fill
// dozens of unrelated required fields.

type MockItem = {
  price?: { id?: string | null } | null;
  current_period_start?: number | null;
  current_period_end?: number | null;
};

function mockSub(params: {
  status?: Stripe.Subscription.Status | string | null;
  metadataPlan?: string | null;
  items?: MockItem[] | null;
}): Stripe.Subscription {
  const { status, metadataPlan, items } = params;
  const raw = {
    status: status ?? null,
    metadata: metadataPlan == null ? {} : { plan: metadataPlan },
    items:
      items == null
        ? undefined
        : { data: items as unknown as Stripe.SubscriptionItem[] },
  };
  return raw as unknown as Stripe.Subscription;
}

// --------------------------------------------------------------------------
// 1) Plan-Mapping
// --------------------------------------------------------------------------

// 1. Starter Price-ID → STARTER
check(
  "price-id starter → STARTER",
  mapStripePriceIdToPlan("price_test_starter"),
  "STARTER" satisfies Plan
);

// 2. Premium Price-ID → PREMIUM
check(
  "price-id premium → PREMIUM",
  mapStripePriceIdToPlan("price_test_premium"),
  "PREMIUM" satisfies Plan
);

// 3. Legacy Pro Price-ID → PREMIUM
check(
  "price-id legacy pro → PREMIUM",
  mapStripePriceIdToPlan("price_test_legacy_pro"),
  "PREMIUM" satisfies Plan
);

// 4. Legacy Ultra Price-ID → PREMIUM
check(
  "price-id legacy ultra → PREMIUM",
  mapStripePriceIdToPlan("price_test_legacy_ultra"),
  "PREMIUM" satisfies Plan
);

// 5. Metadata starter → STARTER
check("metadata starter → STARTER", mapMetadataPlanToPlan("starter"), "STARTER");

// 6. Metadata premium → PREMIUM
check("metadata premium → PREMIUM", mapMetadataPlanToPlan("premium"), "PREMIUM");

// 7. Metadata pro → PREMIUM (legacy)
check("metadata pro → PREMIUM", mapMetadataPlanToPlan("pro"), "PREMIUM");

// 8. Metadata ultra → PREMIUM (legacy)
check("metadata ultra → PREMIUM", mapMetadataPlanToPlan("ultra"), "PREMIUM");

// 8b. Metadata is case-insensitive and trims whitespace.
check(
  "metadata '  Premium ' → PREMIUM (normalized)",
  mapMetadataPlanToPlan("  Premium "),
  "PREMIUM"
);

// 9. Unknown Price-ID + unknown metadata → null
check(
  "unknown price-id → null",
  mapStripePriceIdToPlan("price_totally_unknown"),
  null
);
check("null price-id → null", mapStripePriceIdToPlan(null), null);
check("empty price-id → null", mapStripePriceIdToPlan(""), null);
check(
  "unknown metadata → null",
  mapMetadataPlanToPlan("mega-super-plan"),
  null
);
check("null metadata → null", mapMetadataPlanToPlan(null), null);
check("empty metadata → null", mapMetadataPlanToPlan(""), null);

// Combined: derivePlanFromSubscription prefers price-id over metadata.
check(
  "derivePlan: price-id wins over metadata",
  derivePlanFromSubscription(
    mockSub({
      items: [{ price: { id: "price_test_starter" } }],
      metadataPlan: "premium",
    })
  ),
  "STARTER"
);
check(
  "derivePlan: falls back to metadata when price-id unmapped",
  derivePlanFromSubscription(
    mockSub({
      items: [{ price: { id: "price_unmapped" } }],
      metadataPlan: "premium",
    })
  ),
  "PREMIUM"
);
check(
  "derivePlan: null when both unmapped",
  derivePlanFromSubscription(
    mockSub({
      items: [{ price: { id: "price_unmapped" } }],
      metadataPlan: "nonsense",
    })
  ),
  null
);
check(
  "derivePlan: no items + no metadata → null",
  derivePlanFromSubscription(mockSub({ items: [], metadataPlan: null })),
  null
);

// --------------------------------------------------------------------------
// 2) Periodenextraktion
// --------------------------------------------------------------------------

// 10. Valid start + end → correct Dates
{
  const startSec = 1_752_000_000; // 2025-07-08T20:00:00Z
  const endSec = 1_754_678_400; // 2025-08-08T18:40:00Z
  const { start, end } = extractBillingPeriod(
    mockSub({
      items: [
        { current_period_start: startSec, current_period_end: endSec },
      ],
    })
  );
  check("period: valid start", start, new Date(startSec * 1000));
  check("period: valid end", end, new Date(endSec * 1000));
}

// 11. Missing subscription item → both null
{
  const { start, end } = extractBillingPeriod(mockSub({ items: [] }));
  check("period: no items → start null", start, null);
  check("period: no items → end null", end, null);
}

// 11b. Items root missing entirely → both null (still no throw)
{
  const { start, end } = extractBillingPeriod(mockSub({ items: null }));
  check("period: items root missing → start null", start, null);
  check("period: items root missing → end null", end, null);
}

// 12. Missing start → start null, end still valid
{
  const endSec = 1_800_000_000;
  const { start, end } = extractBillingPeriod(
    mockSub({
      items: [{ current_period_start: null, current_period_end: endSec }],
    })
  );
  check("period: missing start → null", start, null);
  check("period: missing start does not break end", end, new Date(endSec * 1000));
}

// 13. Missing end → end null, start still valid
{
  const startSec = 1_700_000_000;
  const { start, end } = extractBillingPeriod(
    mockSub({
      items: [{ current_period_start: startSec, current_period_end: null }],
    })
  );
  check(
    "period: missing end does not break start",
    start,
    new Date(startSec * 1000)
  );
  check("period: missing end → null", end, null);
}

// 14. Non-finite / non-numeric values → null, no exception
{
  const { start, end } = extractBillingPeriod(
    mockSub({
      items: [
        {
          current_period_start: Number.NaN,
          current_period_end: Number.POSITIVE_INFINITY,
        },
      ],
    })
  );
  check("period: NaN start → null", start, null);
  check("period: Infinity end → null", end, null);
}

// --------------------------------------------------------------------------
// 3) Subscription-Status-Klassifikation (CEO Option C)
// --------------------------------------------------------------------------

const statusCases: Array<[string, string | null, SubscriptionSyncAction]> = [
  // 15. active → SYNC_PAID
  ["status active → SYNC_PAID", "active", "SYNC_PAID"],
  // 16. trialing → SYNC_PAID
  ["status trialing → SYNC_PAID", "trialing", "SYNC_PAID"],
  // 17. past_due → KEEP_PAID_UPDATE_PERIOD (Option C: keep paid until periodEnd)
  ["status past_due → KEEP_PAID_UPDATE_PERIOD", "past_due", "KEEP_PAID_UPDATE_PERIOD"],
  // 18. unpaid → DOWNGRADE_FREE
  ["status unpaid → DOWNGRADE_FREE", "unpaid", "DOWNGRADE_FREE"],
  // 19. incomplete_expired → DOWNGRADE_FREE
  [
    "status incomplete_expired → DOWNGRADE_FREE",
    "incomplete_expired",
    "DOWNGRADE_FREE",
  ],
  // 20. canceled → DOWNGRADE_FREE
  ["status canceled → DOWNGRADE_FREE", "canceled", "DOWNGRADE_FREE"],
  // 21. incomplete → NO_CHANGE
  ["status incomplete → NO_CHANGE", "incomplete", "NO_CHANGE"],
  // 22. unknown / future value → NO_CHANGE
  [
    "unknown status 'gibberish' → NO_CHANGE (conservative)",
    "gibberish",
    "NO_CHANGE",
  ],
  ["null status → NO_CHANGE (conservative)", null, "NO_CHANGE"],
  // 23. paused → NO_CHANGE (conservative; Stripe Status includes 'paused'
  //     in @stripe/stripe-node 2025-10-29.clover typings)
  ["status paused → NO_CHANGE", "paused", "NO_CHANGE"],
];

for (const [name, input, expected] of statusCases) {
  check(name, classifySubscriptionStatus(input), expected);
}

// Compile-time proof that "paused" is in fact modeled in the Stripe type
// union we ship against. If Stripe removes it in a future upgrade, the
// following assignment fails to compile and forces us to revisit the
// classification.
const _pausedStatusIsInStripeUnion: Stripe.Subscription.Status = "paused";
void _pausedStatusIsInStripeUnion;

// --------------------------------------------------------------------------

console.log("");
console.log(`Total: ${passed + failed}   Passed: ${passed}   Failed: ${failed}`);
if (failed > 0) process.exit(1);
