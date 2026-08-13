// scripts/test-tts-timeout.ts
//
// Local smoke tests for getTtsTimeoutMs() (RP-011C.2). No network calls —
// only the env-driven timeout-resolution logic used before the ElevenLabs
// fetch. Run offline:
//
//   npx tsx scripts/test-tts-timeout.ts

import { getTtsTimeoutMs } from "../lib/tts/elevenlabs";

let passed = 0;
let failed = 0;

function assertEq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`PASS  ${label}`);
    passed++;
  } else {
    console.log(`FAIL  ${label}`);
    console.log(`  expected: ${e}`);
    console.log(`  actual:   ${a}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Test 1 — default fallback is 180000 when no env override is set.
// ---------------------------------------------------------------------------
{
  const original = process.env.TTS_TIMEOUT_MS;
  delete process.env.TTS_TIMEOUT_MS;
  assertEq(getTtsTimeoutMs(), 180000, "1. default fallback is 180000");
  if (original !== undefined) process.env.TTS_TIMEOUT_MS = original;
}

// ---------------------------------------------------------------------------
// Test 2 — a valid env override is respected.
// ---------------------------------------------------------------------------
{
  const original = process.env.TTS_TIMEOUT_MS;
  process.env.TTS_TIMEOUT_MS = "90000";
  assertEq(getTtsTimeoutMs(), 90000, "2. valid env override respected");
  if (original === undefined) delete process.env.TTS_TIMEOUT_MS;
  else process.env.TTS_TIMEOUT_MS = original;
}

// ---------------------------------------------------------------------------
// Test 3 — an invalid (non-numeric) env override falls back safely to 180000.
// ---------------------------------------------------------------------------
{
  const original = process.env.TTS_TIMEOUT_MS;
  process.env.TTS_TIMEOUT_MS = "not-a-number";
  assertEq(getTtsTimeoutMs(), 180000, "3. invalid env override falls back to 180000");
  if (original === undefined) delete process.env.TTS_TIMEOUT_MS;
  else process.env.TTS_TIMEOUT_MS = original;
}

// ---------------------------------------------------------------------------
// Test 4 — a zero or negative env override falls back safely to 180000.
// ---------------------------------------------------------------------------
{
  const original = process.env.TTS_TIMEOUT_MS;
  process.env.TTS_TIMEOUT_MS = "0";
  assertEq(getTtsTimeoutMs(), 180000, "4. zero env override falls back to 180000");
  process.env.TTS_TIMEOUT_MS = "-500";
  assertEq(getTtsTimeoutMs(), 180000, "4b. negative env override falls back to 180000");
  if (original === undefined) delete process.env.TTS_TIMEOUT_MS;
  else process.env.TTS_TIMEOUT_MS = original;
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
} else {
  console.log(`\nAll ${passed} test(s) passed.`);
}
