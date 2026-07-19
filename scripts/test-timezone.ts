// scripts/test-timezone.ts
//
// RP-004E1 — Offline tests for lib/entitlement/timezone.ts.
// Exercises isValidIanaTimezone and localDayBoundsUtc, including the
// null / invalid fallback path, ordinary 24 h days in a fixed-offset
// timezone, and DST spring / autumn transitions in Europe/Berlin.
//
// Run with:  npx tsx scripts/test-timezone.ts

import {
  isValidIanaTimezone,
  localDayBoundsUtc,
} from "../lib/entitlement/timezone";

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

// ─── isValidIanaTimezone ─────────────────────────────────────────────

check("valid IANA: Europe/Berlin accepted", isValidIanaTimezone("Europe/Berlin"), true);
check("valid IANA: America/New_York accepted", isValidIanaTimezone("America/New_York"), true);
check("valid IANA: Asia/Kolkata accepted", isValidIanaTimezone("Asia/Kolkata"), true);
check("valid IANA: UTC accepted", isValidIanaTimezone("UTC"), true);

check("invalid: raw offset +02:00 rejected", isValidIanaTimezone("+02:00"), false);
check("invalid: raw offset -0500 rejected", isValidIanaTimezone("-0500"), false);
check("invalid: UTC+2 rejected", isValidIanaTimezone("UTC+2"), false);
check("invalid: GMT alias rejected", isValidIanaTimezone("GMT"), false);
check("invalid: abbreviation CET rejected", isValidIanaTimezone("CET"), false);
check("invalid: empty rejected", isValidIanaTimezone(""), false);
check("invalid: whitespace rejected", isValidIanaTimezone("   "), false);
check("invalid: number rejected", isValidIanaTimezone(42), false);
check("invalid: null rejected", isValidIanaTimezone(null), false);
check("invalid: undefined rejected", isValidIanaTimezone(undefined), false);
check("invalid: garbage/Foo rejected", isValidIanaTimezone("Foo/Bar"), false);
// Over-length prevents pathological Intl calls.
check(
  "invalid: too-long rejected",
  isValidIanaTimezone("A/" + "a".repeat(200)),
  false
);

// ─── localDayBoundsUtc: UTC fallback ─────────────────────────────────

{
  const now = new Date("2026-07-15T14:37:11.512Z");
  const b = localDayBoundsUtc(now, null);
  check(
    "null tz: start is UTC midnight preceding now",
    b.start.toISOString(),
    "2026-07-15T00:00:00.000Z"
  );
  check(
    "null tz: end is UTC midnight next day",
    b.end.toISOString(),
    "2026-07-16T00:00:00.000Z"
  );
}

{
  const now = new Date("2026-07-15T14:37:11.512Z");
  const b = localDayBoundsUtc(now, "not-a-valid-timezone");
  check(
    "invalid tz: falls back to UTC start",
    b.start.toISOString(),
    "2026-07-15T00:00:00.000Z"
  );
  check(
    "invalid tz: falls back to UTC end",
    b.end.toISOString(),
    "2026-07-16T00:00:00.000Z"
  );
}

{
  // UTC boundary: 23:59:59.999 UTC still resolves to the same UTC day.
  const now = new Date("2026-07-15T23:59:59.999Z");
  const b = localDayBoundsUtc(now, null);
  check(
    "null tz: 23:59:59.999Z resolves to same UTC day start",
    b.start.toISOString(),
    "2026-07-15T00:00:00.000Z"
  );
}

// ─── localDayBoundsUtc: Europe/Berlin ─────────────────────────────────

{
  // Ordinary summer day. Europe/Berlin is UTC+2 (CEST) in July 2026,
  // so local midnight on 2026-07-15 == 2026-07-14T22:00:00Z.
  const now = new Date("2026-07-15T10:00:00.000Z"); // 12:00 local
  const b = localDayBoundsUtc(now, "Europe/Berlin");
  check(
    "Europe/Berlin summer: start = 2026-07-14T22:00:00Z",
    b.start.toISOString(),
    "2026-07-14T22:00:00.000Z"
  );
  check(
    "Europe/Berlin summer: end = 2026-07-15T22:00:00Z",
    b.end.toISOString(),
    "2026-07-15T22:00:00.000Z"
  );
  const hours = (b.end.getTime() - b.start.getTime()) / (60 * 60 * 1000);
  check("Europe/Berlin ordinary day is 24h", hours, 24);
}

{
  // Ordinary winter day. Europe/Berlin is UTC+1 (CET) in January 2026,
  // so local midnight on 2026-01-15 == 2026-01-14T23:00:00Z.
  const now = new Date("2026-01-15T10:00:00.000Z"); // 11:00 local
  const b = localDayBoundsUtc(now, "Europe/Berlin");
  check(
    "Europe/Berlin winter: start = 2026-01-14T23:00:00Z",
    b.start.toISOString(),
    "2026-01-14T23:00:00.000Z"
  );
  check(
    "Europe/Berlin winter: end = 2026-01-15T23:00:00Z",
    b.end.toISOString(),
    "2026-01-15T23:00:00.000Z"
  );
}

{
  // DST spring forward (Europe/Berlin): 2026-03-29 the local clock jumps
  // from 02:00 to 03:00. Local calendar day is only 23 h long.
  // Local midnight on 2026-03-29 is 2026-03-28T23:00Z (CET, UTC+1).
  // Local midnight on 2026-03-30 is 2026-03-29T22:00Z (CEST, UTC+2).
  const now = new Date("2026-03-29T09:00:00.000Z");
  const b = localDayBoundsUtc(now, "Europe/Berlin");
  check(
    "Berlin DST spring: start = 2026-03-28T23:00:00Z",
    b.start.toISOString(),
    "2026-03-28T23:00:00.000Z"
  );
  check(
    "Berlin DST spring: end = 2026-03-29T22:00:00Z",
    b.end.toISOString(),
    "2026-03-29T22:00:00.000Z"
  );
  const hours = (b.end.getTime() - b.start.getTime()) / (60 * 60 * 1000);
  check("Berlin DST spring day is 23h", hours, 23);
}

{
  // DST fall back (Europe/Berlin): 2026-10-25 the local clock jumps
  // from 03:00 back to 02:00. Local calendar day is 25 h long.
  // Local midnight on 2026-10-25 is 2026-10-24T22:00Z (CEST, UTC+2).
  // Local midnight on 2026-10-26 is 2026-10-25T23:00Z (CET, UTC+1).
  const now = new Date("2026-10-25T09:00:00.000Z");
  const b = localDayBoundsUtc(now, "Europe/Berlin");
  check(
    "Berlin DST autumn: start = 2026-10-24T22:00:00Z",
    b.start.toISOString(),
    "2026-10-24T22:00:00.000Z"
  );
  check(
    "Berlin DST autumn: end = 2026-10-25T23:00:00Z",
    b.end.toISOString(),
    "2026-10-25T23:00:00.000Z"
  );
  const hours = (b.end.getTime() - b.start.getTime()) / (60 * 60 * 1000);
  check("Berlin DST autumn day is 25h", hours, 25);
}

{
  // A moment just after local midnight — still in the same local day.
  // 2026-07-15 00:15 CEST = 2026-07-14T22:15Z. Same local day range.
  const now = new Date("2026-07-14T22:15:00.000Z");
  const b = localDayBoundsUtc(now, "Europe/Berlin");
  check(
    "Berlin: just past midnight resolves to that same local day",
    b.start.toISOString(),
    "2026-07-14T22:00:00.000Z"
  );
}

{
  // A moment just before local midnight — still in the *previous* local day.
  // 2026-07-14 23:45 CEST = 2026-07-14T21:45Z. Local day is 2026-07-14.
  const now = new Date("2026-07-14T21:45:00.000Z");
  const b = localDayBoundsUtc(now, "Europe/Berlin");
  check(
    "Berlin: just before midnight resolves to previous local day",
    b.start.toISOString(),
    "2026-07-13T22:00:00.000Z"
  );
  check(
    "Berlin: previous local day ends at same-day midnight",
    b.end.toISOString(),
    "2026-07-14T22:00:00.000Z"
  );
}

// ─── Summary ─────────────────────────────────────────────────────────

console.log("");
console.log(`Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
