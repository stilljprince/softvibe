// lib/entitlement/timezone.ts
//
// RP-004E1 — User-local calendar day arithmetic.
//
// This helper answers a single narrow question:
//
//   "Given `now` and an IANA timezone (or null), what is the UTC instant
//    range [startOfLocalDay, startOfNextLocalDay) that corresponds to the
//    user's current local calendar day?"
//
// It is deliberately small: no month/week arithmetic, no formatting, no
// clock skew handling beyond what `Intl.DateTimeFormat` already provides.
// Node 20+'s Intl runtime ships full IANA data, which is our production
// target — no additional dependency is introduced.
//
// Behaviour:
//
//   * `tz === null` (or unset): the range degrades to a pure UTC calendar
//     day, matching the previous behaviour of the Library-unlock daily
//     counter for users who never captured a timezone.
//   * Invalid IANA name: falls back to UTC. Validation of caller-provided
//     names is centralized in `isValidIanaTimezone` and enforced at the
//     capture route — this helper is defensive-in-depth.
//   * DST spring transition (23-hour local day): the boundary sits at the
//     next local midnight of the *calendar* day, so the range is 23
//     wall-clock hours. Explicit test coverage in
//     scripts/test-timezone-day.ts.
//   * DST autumn transition (25-hour local day): same shape, 25 wall-clock
//     hours. Explicit test coverage.
//
// The helper is intentionally pure: `now` is passed in, no `new Date()`
// happens inside. Callers that want real-time semantics simply pass
// `new Date()`.

/**
 * Return the ISO-3-letter calendar parts for `now` interpreted in `tz`.
 * `en-CA` gives us `YYYY-MM-DD` unambiguously and — being ASCII — cannot
 * be surprised by locale-specific numeral systems.
 */
function calendarPartsInTimezone(
  now: Date,
  tz: string
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  return { year, month, day };
}

/**
 * Return the UTC instant that corresponds to (year, month, day, 00:00:00)
 * as a wall clock reading in `tz`. Uses the two-step "guess then correct"
 * approach: we take `Date.UTC(y,m-1,d,0,0,0)` as a first guess, format it
 * back in `tz`, and shift by the difference between what `tz` shows and
 * what we wanted. Two iterations are enough — the DST offset is stable
 * within any given calendar day.
 *
 * Midnight is never itself a DST transition point in the IANA database as
 * of Node 20's ICU snapshot, so no "midnight-does-not-exist" special-case
 * fires in practice for the timezones served by SoftVibe today. If a
 * future zone did put its transition at midnight, the second iteration
 * would still land within the same calendar day.
 */
function utcInstantForLocalMidnight(
  year: number,
  month: number,
  day: number,
  tz: string
): Date {
  // First guess: pretend the tz has zero offset. This lands somewhere near
  // the actual midnight boundary — never off by more than a few hours.
  let ts = Date.UTC(year, month - 1, day, 0, 0, 0);
  for (let iter = 0; iter < 2; iter++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(ts));
    const shown = {
      year: Number(parts.find((p) => p.type === "year")?.value),
      month: Number(parts.find((p) => p.type === "month")?.value),
      day: Number(parts.find((p) => p.type === "day")?.value),
      hour: Number(parts.find((p) => p.type === "hour")?.value),
      minute: Number(parts.find((p) => p.type === "minute")?.value),
      second: Number(parts.find((p) => p.type === "second")?.value),
    };
    // `en-CA` with hour12=false emits "24" for midnight in some ICU
    // snapshots. Normalise back to 0 so arithmetic stays sane.
    if (shown.hour === 24) shown.hour = 0;
    const asWallUtc = Date.UTC(
      shown.year,
      shown.month - 1,
      shown.day,
      shown.hour,
      shown.minute,
      shown.second
    );
    const targetWallUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
    // tz's local wall clock is `asWallUtc`. We want it to read
    // `targetWallUtc`. Shift ts by the difference.
    const delta = targetWallUtc - asWallUtc;
    if (delta === 0) return new Date(ts);
    ts += delta;
  }
  return new Date(ts);
}

/**
 * Validate that `tz` is an IANA timezone name that this Node runtime's
 * `Intl` implementation recognises.
 *
 * Raw UTC offsets ("+02:00", "-0500", "UTC+2") are rejected: they encode
 * a moment-in-time offset, not a stable rule set, and would break the
 * "3 unlocks per local calendar day" contract across DST transitions.
 * `Intl.DateTimeFormat` accepts a handful of these; we reject them
 * explicitly via a positive-form regex: an IANA name must contain either
 * a "/" (region/city) or be one of the small set of legacy single-segment
 * names ("UTC", "GMT", "Zulu"). We only accept "UTC" from that set for
 * simplicity — a user actually located in a UTC zone is served fine, and
 * "GMT" would collide with tools that emit it as an offset alias.
 */
export function isValidIanaTimezone(input: unknown): input is string {
  if (typeof input !== "string") return false;
  const s = input.trim();
  if (s.length === 0 || s.length > 100) return false;
  // Positive-form allowlist: single-segment "UTC" or a two-plus-segment
  // "Area/Location" path. Anything else — including "+02:00", "UTC+2",
  // "GMT-5", "Zulu" — is rejected.
  if (s !== "UTC" && !/^[A-Za-z_]+(?:\/[A-Za-z_0-9+\-]+)+$/.test(s)) {
    return false;
  }
  try {
    // Constructing the formatter throws for unknown IANA names.
    new Intl.DateTimeFormat("en-CA", { timeZone: s });
    return true;
  } catch {
    return false;
  }
}

/**
 * Compute the [startOfLocalDay, startOfNextLocalDay) UTC-instant range
 * for `now` interpreted in `tz`.
 *
 * A `null` or invalid `tz` falls back to the UTC calendar day — the
 * range is exactly 24 hours starting from the UTC midnight preceding
 * `now`. This preserves the pre-RP-004E1 behaviour for users who have
 * not yet captured a timezone.
 *
 * DST-aware for valid timezones: the "next local day" boundary is the
 * next calendar-day midnight in `tz`, not `dayStart + 24h`. That makes
 * the range 23 h on spring-forward days and 25 h on autumn-back days.
 */
export function localDayBoundsUtc(
  now: Date,
  tz: string | null | undefined
): { start: Date; end: Date } {
  if (!tz || !isValidIanaTimezone(tz)) {
    // UTC fallback: mirrors the previous startOfUtcDay behaviour.
    const start = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        0,
        0,
        0,
        0
      )
    );
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start, end };
  }
  const today = calendarPartsInTimezone(now, tz);
  const start = utcInstantForLocalMidnight(
    today.year,
    today.month,
    today.day,
    tz
  );
  // Next calendar-day midnight. Use UTC arithmetic on the calendar to
  // roll over month/year boundaries safely, then convert back.
  const nextDayGuess = new Date(
    Date.UTC(today.year, today.month - 1, today.day + 1, 12, 0, 0)
  );
  const next = calendarPartsInTimezone(nextDayGuess, tz);
  const end = utcInstantForLocalMidnight(next.year, next.month, next.day, tz);
  return { start, end };
}
