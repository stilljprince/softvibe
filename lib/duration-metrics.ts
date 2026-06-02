// lib/duration-metrics.ts
//
// Observability helpers for the Duration Drift investigation.
//
// Goal: collect clean, uniform data on requested-vs-actual generation duration
// across ALL presets (classic-asmr, sleep-story, meditation, kids-story) so we
// can later recalibrate WPS without guessing. This file deliberately holds no
// business logic — it only counts, computes, and logs.

import { addDebugLog } from "@/lib/debug-log";

/** Counts whitespace-separated, non-empty word tokens. */
export function countWords(text: string): number {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Signed drift between actual and requested duration as a percentage of the
 * requested value: positive means *longer than requested*, negative means
 * *shorter*. Returns null if requested is missing or non-positive (drift is
 * not meaningful without a target).
 */
export function driftPercent(
  requestedSec: number | null | undefined,
  actualSec: number | null | undefined
): number | null {
  if (typeof requestedSec !== "number" || !Number.isFinite(requestedSec) || requestedSec <= 0) return null;
  if (typeof actualSec !== "number" || !Number.isFinite(actualSec) || actualSec <= 0) return null;
  return ((actualSec - requestedSec) / requestedSec) * 100;
}

/**
 * Effective words-per-second for a rendered audio. Returns null when actual
 * duration is unavailable (e.g. music-metadata parse failed) so callers can
 * distinguish "no data" from "0 wps".
 */
export function effectiveWps(
  wordCount: number,
  actualSec: number | null | undefined
): number | null {
  if (typeof actualSec !== "number" || !Number.isFinite(actualSec) || actualSec <= 0) return null;
  return wordCount / actualSec;
}

export type DurationSummaryInput = {
  jobId: string;
  preset: string;
  requestedSec: number | null | undefined;
  actualSec: number | null | undefined;
  wordCount: number;
  /** Optional pass-through for the in-memory debug log. */
  userId?: string | null;
  reqId?: string | null;
};

/**
 * Emits a single grep-friendly `[DURATION-SUMMARY]` line to stdout AND records
 * the same payload in the in-memory debug log. Always safe to call: missing
 * inputs surface as `?` in the log line and `null` in the structured data.
 */
export function logDurationSummary(input: DurationSummaryInput): void {
  const { jobId, preset, requestedSec, actualSec, wordCount, userId, reqId } = input;

  const drift = driftPercent(requestedSec, actualSec);
  const wps = effectiveWps(wordCount, actualSec);

  const fmt = (n: number | null | undefined, digits = 2) =>
    typeof n === "number" && Number.isFinite(n) ? n.toFixed(digits) : "?";
  const fmtInt = (n: number | null | undefined) =>
    typeof n === "number" && Number.isFinite(n) ? String(Math.round(n)) : "?";

  // Single, greppable line. Stable field order so log scrapers can split on `=`.
  const line =
    `[DURATION-SUMMARY] jobId=${jobId} preset=${preset} ` +
    `requestedSec=${fmtInt(requestedSec)} actualSec=${fmtInt(actualSec)} ` +
    `driftPercent=${fmt(drift, 1)} wordCount=${wordCount} effectiveWps=${fmt(wps, 2)}`;

  console.log(line);

  addDebugLog({
    ts: new Date().toISOString(),
    level: "info",
    route: "duration-metrics",
    userId: userId ?? null,
    message: "DURATION-SUMMARY",
    data: {
      jobId,
      preset,
      requestedSec: typeof requestedSec === "number" ? requestedSec : null,
      actualSec: typeof actualSec === "number" ? actualSec : null,
      driftPercent: drift,
      wordCount,
      effectiveWps: wps,
    },
    reqId: reqId ?? null,
  });
}
