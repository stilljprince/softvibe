// scripts/test-chunks.ts
//
// Local smoke tests for splitToChunksSafe — covers the conservative
// mini-tail post-pass added to lib/audio/chunks.ts. Runs offline:
//
//   npx tsx scripts/test-chunks.ts
//
// Cases (per task spec):
//   1. tiny final chunk merged (Case A)
//   2. tiny final chunk cannot merge because of limit (Case B)
//   3. normal final chunk unchanged
//   4. paragraph boundaries preserved through the merge join

import {
  splitToChunksSafe,
  getMaxCharsPerRequest,
  TTS_REQUEST_MAX_OVERSHOOT,
} from "../lib/audio/chunks";

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
// Test 1 — mini-tail MERGED when merging stays within maxLen.
//
// We engineer an input where the previous chunk ends up well below maxLen
// (the splitter cuts at an early paragraph break and trim() drops trailing
// whitespace), so the small tail can be safely folded back in.
// ---------------------------------------------------------------------------
{
  const maxLen = 600;
  const text =
    "A".repeat(300) +
    "\n".repeat(250) + // many newlines — trimmed at the cut boundary
    "B".repeat(220);

  // After the split:
  //   parts = ["A"*300 (300 chars), "B"*220 (220 chars)]
  // tail = 220, threshold = 240, prev + 2 + tail = 522 <= 600 -> MERGE.
  const out = splitToChunksSafe(text, maxLen, 1.2, 200, 240);
  assertEq(
    out,
    ["A".repeat(300) + "\n\n" + "B".repeat(220)],
    "1. tiny final chunk merged when within maxLen (Case A)"
  );
}

// ---------------------------------------------------------------------------
// Test 2 — mini-tail LEFT ALONE when merging would exceed maxLen.
//
// Realistic 2-chunk shape: paragraph break sits right before the limit, so
// the first chunk is near maxLen and the tail cannot be merged safely.
// ---------------------------------------------------------------------------
{
  const maxLen = 1000;
  const text = "A".repeat(900) + "\n\n" + "B".repeat(200);

  // parts = ["A"*900, "B"*200]
  // tail = 200, threshold = 400 -> mini-tail, BUT prev + 2 + tail = 1102 > 1000.
  // Should NOT merge.
  const out = splitToChunksSafe(text, maxLen, 1.2, 200, 400);
  assertEq(
    out,
    ["A".repeat(900), "B".repeat(200)],
    "2. tiny final chunk NOT merged because merge would exceed maxLen (Case B)"
  );
}

// ---------------------------------------------------------------------------
// Test 3 — normal-sized final chunk: post-pass does nothing.
// ---------------------------------------------------------------------------
{
  const maxLen = 1000;
  const text = "A".repeat(900) + "\n\n" + "B".repeat(800);

  // parts = ["A"*900, "B"*800]
  // tail = 800, threshold = 400 -> NOT a mini-tail. Untouched.
  const out = splitToChunksSafe(text, maxLen, 1.2, 200, 400);
  assertEq(
    out,
    ["A".repeat(900), "B".repeat(800)],
    "3. normal-sized final chunk unchanged"
  );
}

// ---------------------------------------------------------------------------
// Test 4 — paragraph boundaries preserved through the merge join.
//
// When the post-pass merges, the join uses "\n\n" (a paragraph boundary),
// matching the existing tiny-chunk merge behavior. Sentences are never
// redistributed across chunks.
// ---------------------------------------------------------------------------
{
  const maxLen = 50;
  const text = "Para one." + "\n".repeat(250) + "Para two ends here.";

  // After the split:
  //   parts = ["Para one." (9 chars), "Para two ends here." (19 chars)]
  // tail = 19, threshold = 30 -> mini-tail. prev + 2 + tail = 30 <= 50 -> MERGE.
  // Verify the join is exactly "\n\n" (paragraph boundary preserved).
  const out = splitToChunksSafe(text, maxLen, 1.2, 5, 30);
  assertEq(
    out,
    ["Para one.\n\nPara two ends here."],
    "4. paragraph boundaries preserved (merge join is \\n\\n)"
  );
}

// ---------------------------------------------------------------------------
// Test 5 — getMaxCharsPerRequest() default fallback is 3100 (RP-011C.2
// follow-up: 3500 was reduced further after runtime QA showed the post-
// prosody guard was still triggering too often on normal large chunks).
// ---------------------------------------------------------------------------
{
  const original = process.env.ELEVENLABS_MAX_CHARS_PER_REQUEST;
  delete process.env.ELEVENLABS_MAX_CHARS_PER_REQUEST;
  assertEq(getMaxCharsPerRequest(), 3100, "5. default fallback is 3100");
  if (original !== undefined) process.env.ELEVENLABS_MAX_CHARS_PER_REQUEST = original;
}

// ---------------------------------------------------------------------------
// Test 6 — a valid env override is still respected.
// ---------------------------------------------------------------------------
{
  const original = process.env.ELEVENLABS_MAX_CHARS_PER_REQUEST;
  process.env.ELEVENLABS_MAX_CHARS_PER_REQUEST = "3200";
  assertEq(getMaxCharsPerRequest(), 3200, "6. valid env override respected");
  if (original === undefined) delete process.env.ELEVENLABS_MAX_CHARS_PER_REQUEST;
  else process.env.ELEVENLABS_MAX_CHARS_PER_REQUEST = original;
}

// ---------------------------------------------------------------------------
// Test 7 — an invalid env override falls back safely to 3100.
// ---------------------------------------------------------------------------
{
  const original = process.env.ELEVENLABS_MAX_CHARS_PER_REQUEST;
  process.env.ELEVENLABS_MAX_CHARS_PER_REQUEST = "not-a-number";
  assertEq(getMaxCharsPerRequest(), 3100, "7. invalid env override falls back to 3100");
  if (original === undefined) delete process.env.ELEVENLABS_MAX_CHARS_PER_REQUEST;
  else process.env.ELEVENLABS_MAX_CHARS_PER_REQUEST = original;
}

// ---------------------------------------------------------------------------
// Test 8 — a text just under the 3100 default stays a single chunk.
// ---------------------------------------------------------------------------
{
  const original = process.env.ELEVENLABS_MAX_CHARS_PER_REQUEST;
  delete process.env.ELEVENLABS_MAX_CHARS_PER_REQUEST;
  const text = "A".repeat(3099);
  const out = splitToChunksSafe(text);
  assertEq(out.length, 1, "8. text just under 3100 stays a single chunk");
  if (original !== undefined) process.env.ELEVENLABS_MAX_CHARS_PER_REQUEST = original;
}

// ---------------------------------------------------------------------------
// Test 9 — a text over 3100 splits at a safe sentence boundary, no chunk
// exceeds maxLen * maxOvershoot, and no text is lost or duplicated.
// ---------------------------------------------------------------------------
{
  const original = process.env.ELEVENLABS_MAX_CHARS_PER_REQUEST;
  delete process.env.ELEVENLABS_MAX_CHARS_PER_REQUEST;
  const sentence = "This is a calm sentence for testing. ";
  const text = sentence.repeat(200); // ~7600 chars, well past the 3100 default
  const out = splitToChunksSafe(text);
  const maxAllowed = Math.floor(3100 * 1.2);
  const allWithinOvershoot = out.every((c) => c.length <= maxAllowed);
  assertEq(out.length > 1, true, "9a. text over 3100 is split into multiple chunks");
  assertEq(allWithinOvershoot, true, "9b. no chunk exceeds maxLen * maxOvershoot");
  const rejoined = out.join(" ").replace(/\s+/g, " ").trim();
  const originalNormalized = text.replace(/\s+/g, " ").trim();
  assertEq(rejoined, originalNormalized, "9c. no text lost or duplicated across chunks");
  if (original !== undefined) process.env.ELEVENLABS_MAX_CHARS_PER_REQUEST = original;
}

// ---------------------------------------------------------------------------
// Test 10 — mini-tail behavior remains stable at the 3100 scale (tiny final
// chunk merges back when merging still respects the 3100 limit).
// ---------------------------------------------------------------------------
{
  const maxLen = 3100;
  const text = "A".repeat(2700) + "\n\n" + "B".repeat(300);
  // Combined length (3002) is already <= maxLen(3100), so this returns as a
  // single chunk unchanged; tail = 300 < threshold(1240) and
  // prev + 2 + tail = 3002 <= 3100 -> would MERGE even if it had split.
  const out = splitToChunksSafe(text, maxLen);
  assertEq(
    out,
    ["A".repeat(2700) + "\n\n" + "B".repeat(300)],
    "10. mini-tail merge behavior stable at 3100 scale"
  );
}

// ---------------------------------------------------------------------------
// Test 11 — TTS-strict overshoot regression (RP-011C.2 follow-up, adapted to
// the new 3100 target).
//
// Reproduces the real production incident shape: no paragraph/sentence/
// clause boundary before maxLen, and the next sentence end lands ~3172
// chars in — inside the default's ~3720 extension window but past the
// strict TTS window (~3162). Default overshoot must still reach the late
// sentence end; TTS-strict overshoot must reject it and fall back to a
// word boundary.
// ---------------------------------------------------------------------------
{
  const maxLen = 3100;
  const filler = "lorem ".repeat(700); // 4200 chars, no punctuation at all
  const lateSentence = "This sentence finally ends here. ";
  // Padding after the sentence end must stay >= minChunkLen (200) or the
  // tiny-trailing-chunk merge would silently undo the split we're testing.
  const tailPadding = "and more gentle words follow along quietly ".repeat(6);
  const text = filler.slice(0, 3140) + lateSentence + tailPadding;

  const defaultOut = splitToChunksSafe(text, maxLen);
  assertEq(
    defaultOut[0].length > maxLen &&
      defaultOut[0].length <= Math.floor(maxLen * 1.2),
    true,
    "11a. default overshoot (1.2) still reaches the late sentence end (~3172 chars)"
  );

  const strictOut = splitToChunksSafe(text, maxLen, TTS_REQUEST_MAX_OVERSHOOT);
  assertEq(
    strictOut[0].length <= Math.floor(maxLen * TTS_REQUEST_MAX_OVERSHOOT),
    true,
    "11b. TTS-strict overshoot rejects the late sentence end, chunk stays <= ~3162"
  );
  assertEq(
    strictOut[0].length <= maxLen,
    true,
    "11c. TTS-strict overshoot falls back to a word boundary at/under maxLen"
  );

  const rejoined = strictOut.join(" ").replace(/\s+/g, " ").trim();
  const originalNormalized = text.replace(/\s+/g, " ").trim();
  assertEq(
    rejoined,
    originalNormalized,
    "11d. no text lost or duplicated under TTS-strict overshoot"
  );
}

// ---------------------------------------------------------------------------
// Test 12 — TTS-strict overshoot ceiling holds under the same repeated-
// sentence stress case as Test 9 (default behavior), just with the tighter
// TTS-specific overshoot. Sentence boundaries are still preferred; the
// chunk just can't grow anywhere near the old ~4400-4800 range.
// ---------------------------------------------------------------------------
{
  const sentence = "This is a calm sentence for testing. ";
  const text = sentence.repeat(200); // ~7600 chars, well past the 3100 default
  const maxLen = 3100;
  const out = splitToChunksSafe(text, maxLen, TTS_REQUEST_MAX_OVERSHOOT);
  const maxAllowed = Math.floor(maxLen * TTS_REQUEST_MAX_OVERSHOOT);
  const allWithinStrictOvershoot = out.every((c) => c.length <= maxAllowed);
  assertEq(out.length > 1, true, "12a. text over 3100 is still split into multiple chunks");
  assertEq(
    allWithinStrictOvershoot,
    true,
    "12b. no chunk exceeds maxLen * TTS_REQUEST_MAX_OVERSHOOT (~3162)"
  );
  const rejoined = out.join(" ").replace(/\s+/g, " ").trim();
  const originalNormalized = text.replace(/\s+/g, " ").trim();
  assertEq(
    rejoined,
    originalNormalized,
    "12c. no text lost or duplicated under TTS-strict overshoot"
  );
}

// ---------------------------------------------------------------------------
// Test 13 — Narrative-shaped finalText (RP-011C.3): a longer multi-paragraph
// narrative merges from several internal segments into one flowing text
// (as the narrative pipeline already does before this point). Verifies the
// generic chunker — now also used for narrative — splits above 3100 chars,
// respects the strict TTS overshoot, preserves paragraph/sentence boundaries,
// and loses/duplicates no text on rejoin.
// ---------------------------------------------------------------------------
{
  const original = process.env.ELEVENLABS_MAX_CHARS_PER_REQUEST;
  delete process.env.ELEVENLABS_MAX_CHARS_PER_REQUEST;

  const paragraph =
    "The old lighthouse keeper walked slowly along the quiet shore, listening " +
    "to the gentle rhythm of the waves. Every evening he told himself the same " +
    "calm story about the sea, and every evening the story felt a little " +
    "different, softer, kinder, more like a lullaby than a memory.\n\n";
  const text = paragraph.repeat(20); // well past the 3100 default

  const maxLen = getMaxCharsPerRequest();
  const out = splitToChunksSafe(text, maxLen, TTS_REQUEST_MAX_OVERSHOOT);
  const maxAllowed = Math.floor(maxLen * TTS_REQUEST_MAX_OVERSHOOT);

  assertEq(out.length > 1, true, "13a. narrative-shaped finalText over 3100 is split into multiple chunks");
  assertEq(
    out.every((c) => c.length <= maxAllowed),
    true,
    "13b. every narrative chunk respects the strict TTS overshoot ceiling"
  );
  const rejoined = out.join(" ").replace(/\s+/g, " ").trim();
  const originalNormalized = text.replace(/\s+/g, " ").trim();
  assertEq(rejoined, originalNormalized, "13c. narrative rejoin has no text loss or duplication");

  if (original !== undefined) process.env.ELEVENLABS_MAX_CHARS_PER_REQUEST = original;
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
} else {
  console.log(`\nAll ${passed} test(s) passed.`);
}
