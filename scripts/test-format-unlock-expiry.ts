// scripts/test-format-unlock-expiry.ts
//
// RP-004E1 — Offline tests for app/library/format-unlock-expiry.ts.
//
// Locks the contract shared by the small card hint and the newly-added
// session-detail popup block:
//
//   * A valid future `unlockExpiresAt` renders "Freigeschaltet bis HH:MM
//     Uhr" in the caller-supplied IANA timezone (with a browser
//     fallback when the zone is missing or unknown).
//   * Missing, unparseable, and expired inputs return null — matching
//     the CEO's rule that an expired unlock must not render the block.
//   * Whole minutes only; no seconds and no per-second countdown noise.
//
// Run with:  npx tsx scripts/test-format-unlock-expiry.ts

import { formatUnlockExpiryHint } from "../app/library/format-unlock-expiry";

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

// A stable future instant we can format deterministically:
// 2026-07-19T20:36:00Z == 22:36 in Europe/Berlin (CEST, UTC+2).
const FUTURE_ISO = "2026-07-19T20:36:00.000Z";
const PAST_ISO = "2020-01-01T00:00:00.000Z";

// ─── Timezone-aware happy path ────────────────────────────────────────

check(
  "Europe/Berlin: renders 22:36 Uhr",
  formatUnlockExpiryHint(FUTURE_ISO, "Europe/Berlin"),
  "Freigeschaltet bis 22:36 Uhr"
);

check(
  "UTC: renders 20:36 Uhr",
  formatUnlockExpiryHint(FUTURE_ISO, "UTC"),
  "Freigeschaltet bis 20:36 Uhr"
);

check(
  "America/New_York summer: renders 16:36 Uhr",
  formatUnlockExpiryHint(FUTURE_ISO, "America/New_York"),
  "Freigeschaltet bis 16:36 Uhr"
);

check(
  "Asia/Kolkata: renders 02:06 Uhr",
  formatUnlockExpiryHint(FUTURE_ISO, "Asia/Kolkata"),
  "Freigeschaltet bis 02:06 Uhr"
);

// ─── Nullish inputs — block must not render ───────────────────────────

check(
  "null iso returns null (no unlock: block not rendered)",
  formatUnlockExpiryHint(null, "Europe/Berlin"),
  null
);

check(
  "unparseable iso returns null",
  formatUnlockExpiryHint("not-a-date", "Europe/Berlin"),
  null
);

check(
  "past iso returns null (expired unlock: block not rendered)",
  formatUnlockExpiryHint(PAST_ISO, "Europe/Berlin"),
  null
);

// A boundary exactly at `now` is treated as expired (`<= 0`).
check(
  "iso equal to now returns null",
  formatUnlockExpiryHint(new Date().toISOString(), "Europe/Berlin"),
  null
);

// ─── Timezone fallbacks — degrade to browser default, never crash ────

// An empty timezone string falls through to the browser default. The
// node runtime uses the process TZ; we just verify a non-null output
// with the expected prefix and shape.
{
  const s = formatUnlockExpiryHint(FUTURE_ISO, "");
  check(
    "empty timezone: returns a non-null formatted string",
    typeof s === "string" && s.startsWith("Freigeschaltet bis ") && s.endsWith(" Uhr"),
    true
  );
}

{
  const s = formatUnlockExpiryHint(FUTURE_ISO, null);
  check(
    "null timezone: returns a non-null formatted string",
    typeof s === "string" && s.startsWith("Freigeschaltet bis ") && s.endsWith(" Uhr"),
    true
  );
}

{
  const s = formatUnlockExpiryHint(FUTURE_ISO, undefined);
  check(
    "undefined timezone: returns a non-null formatted string",
    typeof s === "string" && s.startsWith("Freigeschaltet bis ") && s.endsWith(" Uhr"),
    true
  );
}

{
  const s = formatUnlockExpiryHint(FUTURE_ISO, "Not/A_Zone");
  check(
    "invalid timezone: falls back cleanly to browser default",
    typeof s === "string" && s.startsWith("Freigeschaltet bis ") && s.endsWith(" Uhr"),
    true
  );
}

// ─── Whole-minute rendering (no seconds) ─────────────────────────────

check(
  "seconds are truncated to whole minutes (Europe/Berlin)",
  formatUnlockExpiryHint("2026-07-19T20:36:47.900Z", "Europe/Berlin"),
  "Freigeschaltet bis 22:36 Uhr"
);

// ─── Summary ─────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
