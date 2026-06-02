// scripts/test-duration-metrics.ts
// Smoke test for lib/duration-metrics — the observability helper that backs
// the [DURATION-SUMMARY] line emitted by /api/jobs/[id]/complete.
// Run with: npx tsx scripts/test-duration-metrics.ts

import {
  countWords,
  driftPercent,
  effectiveWps,
  logDurationSummary,
} from "../lib/duration-metrics";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertClose(actual: number | null, expected: number, label: string, eps = 0.01) {
  if (actual === null || Math.abs(actual - expected) > eps) {
    throw new Error(`${label}: expected ~${expected}, got ${actual}`);
  }
}

function captureStdout<T>(fn: () => T): { result: T; lines: string[] } {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    const result = fn();
    return { result, lines };
  } finally {
    console.log = original;
  }
}

type Case = { name: string; run: () => void };

const cases: Case[] = [
  {
    name: "countWords: counts whitespace-separated tokens",
    run: () => {
      assertEqual(countWords("hello world"), 2, "two words");
      assertEqual(countWords("  multiple   spaces\tand\nnewlines  "), 4, "weird whitespace");
      assertEqual(countWords(""), 0, "empty string");
      assertEqual(countWords("   "), 0, "whitespace only");
      assertEqual(countWords("single"), 1, "single word");
    },
  },
  {
    name: "driftPercent: positive when actual > requested",
    run: () => {
      assertClose(driftPercent(300, 360), 20, "300 → 360 = +20%");
    },
  },
  {
    name: "driftPercent: negative when actual < requested",
    run: () => {
      assertClose(driftPercent(300, 270), -10, "300 → 270 = -10%");
    },
  },
  {
    name: "driftPercent: zero when equal",
    run: () => {
      assertClose(driftPercent(300, 300), 0, "300 → 300 = 0%");
    },
  },
  {
    name: "driftPercent: null when requested is missing or invalid",
    run: () => {
      assertEqual(driftPercent(null, 100), null, "null requested");
      assertEqual(driftPercent(undefined, 100), null, "undefined requested");
      assertEqual(driftPercent(0, 100), null, "zero requested");
      assertEqual(driftPercent(-5, 100), null, "negative requested");
    },
  },
  {
    name: "driftPercent: null when actual is missing or invalid",
    run: () => {
      assertEqual(driftPercent(300, null), null, "null actual");
      assertEqual(driftPercent(300, undefined), null, "undefined actual");
      assertEqual(driftPercent(300, 0), null, "zero actual");
      assertEqual(driftPercent(300, NaN), null, "NaN actual");
    },
  },
  {
    name: "effectiveWps: words/seconds",
    run: () => {
      assertClose(effectiveWps(900, 300), 3.0, "900w / 300s = 3.0 wps");
      assertClose(effectiveWps(420, 280), 1.5, "420w / 280s = 1.5 wps");
    },
  },
  {
    name: "effectiveWps: null when actual is missing or zero",
    run: () => {
      assertEqual(effectiveWps(900, null), null, "null actual");
      assertEqual(effectiveWps(900, 0), null, "zero actual");
      assertEqual(effectiveWps(900, undefined), null, "undefined actual");
    },
  },
  {
    name: "logDurationSummary: emits one [DURATION-SUMMARY] line with all fields",
    run: () => {
      const { lines } = captureStdout(() =>
        logDurationSummary({
          jobId: "job_abc",
          preset: "sleep-story",
          requestedSec: 900,
          actualSec: 1080,
          wordCount: 2700,
        })
      );
      assertEqual(lines.length, 1, "single log line");
      const line = lines[0];
      if (!line.startsWith("[DURATION-SUMMARY]")) {
        throw new Error(`line should start with [DURATION-SUMMARY], got: ${line}`);
      }
      for (const tok of [
        "jobId=job_abc",
        "preset=sleep-story",
        "requestedSec=900",
        "actualSec=1080",
        "driftPercent=20.0",
        "wordCount=2700",
        "effectiveWps=2.50",
      ]) {
        if (!line.includes(tok)) {
          throw new Error(`expected token "${tok}" in: ${line}`);
        }
      }
    },
  },
  {
    name: "logDurationSummary: uses '?' placeholders when values are missing",
    run: () => {
      const { lines } = captureStdout(() =>
        logDurationSummary({
          jobId: "job_xyz",
          preset: "classic-asmr",
          requestedSec: null,
          actualSec: null,
          wordCount: 0,
        })
      );
      const line = lines[0];
      for (const tok of [
        "requestedSec=?",
        "actualSec=?",
        "driftPercent=?",
        "wordCount=0",
        "effectiveWps=?",
      ]) {
        if (!line.includes(tok)) {
          throw new Error(`expected token "${tok}" in: ${line}`);
        }
      }
    },
  },
  {
    name: "logDurationSummary: works for all four presets",
    run: () => {
      for (const preset of ["classic-asmr", "sleep-story", "meditation", "kids-story"]) {
        const { lines } = captureStdout(() =>
          logDurationSummary({
            jobId: "j",
            preset,
            requestedSec: 300,
            actualSec: 282,
            wordCount: 600,
          })
        );
        if (!lines[0].includes(`preset=${preset}`)) {
          throw new Error(`preset=${preset} missing in: ${lines[0]}`);
        }
      }
    },
  },
];

let passed = 0;
let failed = 0;
const failures: string[] = [];

for (const c of cases) {
  try {
    c.run();
    passed++;
    console.log(`PASS  ${c.name}`);
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${c.name}: ${msg}`);
    console.log(`FAIL  ${c.name} — ${msg}`);
  }
}

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
