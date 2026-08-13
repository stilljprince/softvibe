// scripts/test-tts-payload-guard.ts
//
// Local smoke tests for the RP-011C.2 Post-Prosody TTS Payload Guard:
//   - ensureTtsPayloadWithinLimit() / getPostProsodyMaxChars() in lib/audio/chunks.ts
//   - speakWithPayloadGuard() in lib/tts/elevenlabs.ts
//
// No network calls — elevenlabs.speak() is monkey-patched with a synthetic
// stand-in before speakWithPayloadGuard() is exercised. Run offline:
//
//   npx tsx scripts/test-tts-payload-guard.ts

import {
  ensureTtsPayloadWithinLimit,
  getPostProsodyMaxChars,
  TTS_REQUEST_MAX_OVERSHOOT,
} from "../lib/audio/chunks";
import { elevenlabs, speakWithPayloadGuard } from "../lib/tts/elevenlabs";
import type { TTSSpeakInput, TTSSpeakResult } from "../lib/tts/adapter";

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

function assertTrue(cond: boolean, label: string) {
  assertEq(cond, true, label);
}

// ---------------------------------------------------------------------------
// Test 1 — getPostProsodyMaxChars() default fallback is 4000.
// ---------------------------------------------------------------------------
{
  const original = process.env.TTS_POST_PROSODY_MAX_CHARS;
  delete process.env.TTS_POST_PROSODY_MAX_CHARS;
  assertEq(getPostProsodyMaxChars(), 4000, "1. default fallback is 4000");
  if (original !== undefined) process.env.TTS_POST_PROSODY_MAX_CHARS = original;
}

// ---------------------------------------------------------------------------
// Test 2 — a valid env override is respected; an invalid one falls back.
// ---------------------------------------------------------------------------
{
  const original = process.env.TTS_POST_PROSODY_MAX_CHARS;
  process.env.TTS_POST_PROSODY_MAX_CHARS = "3500";
  assertEq(getPostProsodyMaxChars(), 3500, "2a. valid env override respected");
  process.env.TTS_POST_PROSODY_MAX_CHARS = "not-a-number";
  assertEq(getPostProsodyMaxChars(), 4000, "2b. invalid env override falls back to 4000");
  if (original === undefined) delete process.env.TTS_POST_PROSODY_MAX_CHARS;
  else process.env.TTS_POST_PROSODY_MAX_CHARS = original;
}

// ---------------------------------------------------------------------------
// Test 3 — ensureTtsPayloadWithinLimit: empty input -> [].
// ---------------------------------------------------------------------------
{
  assertEq(ensureTtsPayloadWithinLimit(""), [], "3. empty input returns []");
  assertEq(ensureTtsPayloadWithinLimit("   \n  "), [], "3b. whitespace-only input returns []");
}

// ---------------------------------------------------------------------------
// Test 4 — ensureTtsPayloadWithinLimit: payload under limit stays unchanged.
// ---------------------------------------------------------------------------
{
  const text = "[whispers] a calm sentence. ".repeat(50); // well under 4000 chars
  const out = ensureTtsPayloadWithinLimit(text, 4000);
  assertEq(out.length, 1, "4a. payload under limit stays a single piece");
  assertEq(out[0], text.trim(), "4b. payload under limit is byte-identical (trimmed)");
}

// ---------------------------------------------------------------------------
// Test 5 — ensureTtsPayloadWithinLimit: payload over limit is split, no
// piece exceeds the strict TTS overshoot ceiling, no text lost or duplicated.
// ---------------------------------------------------------------------------
{
  // Simulates post-prosody text: [tag] markers inserted before sentences.
  const sentence = "[softly] This is a calm tagged sentence for testing. ";
  const text = sentence.repeat(150); // ~7700 chars, well past a 4000 guard
  const maxLen = 4000;
  const out = ensureTtsPayloadWithinLimit(text, maxLen);
  const maxAllowed = Math.floor(maxLen * TTS_REQUEST_MAX_OVERSHOOT);

  assertTrue(out.length > 1, "5a. payload over limit is split into multiple pieces");
  assertTrue(
    out.every((p) => p.length <= maxAllowed),
    "5b. no piece exceeds maxLen * TTS_REQUEST_MAX_OVERSHOOT"
  );

  const rejoined = out.join(" ").replace(/\s+/g, " ").trim();
  const originalNormalized = text.replace(/\s+/g, " ").trim();
  assertEq(rejoined, originalNormalized, "5c. no text lost or duplicated across pieces");
}

// ---------------------------------------------------------------------------
// Test 6 — reproduces the real production incident shape: a 4488-char
// post-prosody chunk (measured in QA) must be split under a 4000 guard.
// ---------------------------------------------------------------------------
{
  const tag = "[whispers] ";
  const filler = (tag + "Soft close whispers drift gently through the quiet room. ").repeat(70);
  const text = filler.slice(0, 4488);
  assertEq(text.length, 4488, "6a. reproduction text is exactly 4488 chars");

  const out = ensureTtsPayloadWithinLimit(text, 4000);
  const maxAllowed = Math.floor(4000 * TTS_REQUEST_MAX_OVERSHOOT);
  assertTrue(out.length > 1, "6b. 4488-char post-prosody payload is split under a 4000 guard");
  assertTrue(
    out.every((p) => p.length <= maxAllowed),
    "6c. no split piece exceeds the guard's strict overshoot ceiling"
  );
}

// ---------------------------------------------------------------------------
// speakWithPayloadGuard() — monkey-patch elevenlabs.speak() (no network).
// ---------------------------------------------------------------------------
type Call = { text: string };
let calls: Call[] = [];
const originalSpeak = elevenlabs.speak.bind(elevenlabs);

function installFakeSpeak() {
  calls = [];
  elevenlabs.speak = async (input: TTSSpeakInput): Promise<TTSSpeakResult> => {
    calls.push({ text: input.text });
    // Encode the piece length in the fake audio so buffers are distinguishable.
    return {
      audio: new Uint8Array(Buffer.from(`AUDIO(len=${input.text.length})`)),
      contentType: "audio/mpeg",
      requestId: `req-${calls.length}`,
    };
  };
}

function restoreSpeak() {
  elevenlabs.speak = originalSpeak;
}

async function runAsyncTests() {
// ---------------------------------------------------------------------------
// Test 7 — under limit: exactly one underlying speak() call, text unchanged.
// ---------------------------------------------------------------------------
{
  installFakeSpeak();
  const text = "[calm] a short meditation line. ".repeat(20); // under 4000 chars
  const result = await speakWithPayloadGuard({ text, voiceId: "v", modelId: "eleven_v3" });
  assertEq(calls.length, 1, "7a. under limit issues exactly one ElevenLabs request");
  assertEq(calls[0].text, text, "7b. under limit forwards text unchanged (not even trimmed)");
  assertTrue(result.audio.length > 0, "7c. under limit returns non-empty audio");
  restoreSpeak();
}

// ---------------------------------------------------------------------------
// Test 8 — over limit: multiple ordered speak() calls, each within the
// guard's overshoot ceiling, concatenated audio matches concatenated pieces,
// no text lost or duplicated.
// ---------------------------------------------------------------------------
{
  installFakeSpeak();
  const sentence = "[whispers] Soft close whispers drift through the quiet room. ";
  const text = sentence.repeat(120); // well past 4000 chars
  const maxLen = 4000;

  const original = process.env.TTS_POST_PROSODY_MAX_CHARS;
  process.env.TTS_POST_PROSODY_MAX_CHARS = String(maxLen);

  const result = await speakWithPayloadGuard({ text, voiceId: "v", modelId: "eleven_v3" });

  if (original === undefined) delete process.env.TTS_POST_PROSODY_MAX_CHARS;
  else process.env.TTS_POST_PROSODY_MAX_CHARS = original;

  const maxAllowed = Math.floor(maxLen * TTS_REQUEST_MAX_OVERSHOOT);
  assertTrue(calls.length > 1, "8a. over limit issues multiple ElevenLabs requests");
  assertTrue(
    calls.every((c) => c.text.length <= maxAllowed),
    "8b. every sub-request stays within the guard's overshoot ceiling"
  );

  const rejoinedCalls = calls.map((c) => c.text).join(" ").replace(/\s+/g, " ").trim();
  const originalNormalized = text.replace(/\s+/g, " ").trim();
  assertEq(rejoinedCalls, originalNormalized, "8c. no text lost or duplicated across sub-requests");

  const expectedAudio = Buffer.concat(
    calls.map((c) => Buffer.from(`AUDIO(len=${c.text.length})`))
  );
  assertEq(
    Buffer.from(result.audio).equals(expectedAudio),
    true,
    "8d. returned audio is the exact concatenation of every sub-request's audio, in order"
  );
  restoreSpeak();
}
}

runAsyncTests().then(() => {
  if (failed > 0) {
    console.error(`\n${failed} test(s) failed.`);
    process.exit(1);
  } else {
    console.log(`\nAll ${passed} test(s) passed.`);
  }
});
