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

import { splitToChunksSafe } from "../lib/audio/chunks";

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
// Sanity — default-param call still works and a natural mini-tail is left
// alone when it cannot be safely merged.
// ---------------------------------------------------------------------------
{
  const text =
    "S1. " + "X".repeat(2300) + "\n\n" + "Y".repeat(700);

  // Default maxLen = 2500. paraPos ≈ 2304. parts = [2304, 700].
  // tail = 700 < 1000 (threshold) -> mini-tail. combined = 3006 > 2500.
  // Leave alone -> 2 chunks.
  const out = splitToChunksSafe(text);
  assertEq(out.length, 2, "sanity: default-param natural mini-tail preserved");
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
} else {
  console.log(`\nAll ${passed} test(s) passed.`);
}
