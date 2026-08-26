// scripts/test-creative-intelligence-asmr-creative-direction-trigger-calibration.ts
//
// RP-011C.8.8.4C -- ASMR Creative Direction Trigger Calibration.
//
// RP-011C.8.8.4B found that classifyCreativeDirection() only preserved an
// explicit creative request when preset === "classic-asmr" && asmrMode ===
// "story", so companion and personal-attention ASMR "presence" scenarios lost
// user intent. This script exercises the fix: classifyCreativeDirection() now
// also preserves creativeDirection for classic-asmr prompts that contain a
// concrete scenario signal (companion, personal attention, role/persona
// framing, requested activity) regardless of asmrMode.
//
// Run with:
//   npx tsx scripts/test-creative-intelligence-asmr-creative-direction-trigger-calibration.ts

import { extractCreativeIntent } from "../lib/creative-intelligence";

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const equal = JSON.stringify(actual) === JSON.stringify(expected);
  if (equal) {
    console.log(`[PASS] ${name}`);
    passed++;
  } else {
    console.log(`[FAIL] ${name}\n       expected=${JSON.stringify(expected)}\n       actual=  ${JSON.stringify(actual)}`);
    failed++;
  }
}

type Case = {
  id: string;
  prompt: string;
  shouldPreserve: boolean;
};

const SHOULD_PRESERVE: Case[] = [
  { id: "1-librarian-roleplay", prompt: "ASMR librarian roleplay where you read books to me", shouldPreserve: true },
  {
    id: "2-close-friend-companion",
    prompt: "ASMR experience where a close friend helps me calm down after a stressful day",
    shouldPreserve: true,
  },
  {
    id: "3-personal-attention-session",
    prompt: "gentle ASMR personal attention session because I had a difficult day",
    shouldPreserve: true,
  },
  { id: "4-mystery-thriller-in-asmr-voice", prompt: "Tell me a mysterious thriller story in an ASMR voice", shouldPreserve: true },
];

const SHOULD_NOT_PRESERVE: Case[] = [
  { id: "5-gentle-whisper", prompt: "gentle whisper ASMR", shouldPreserve: false },
  { id: "6-soft-spoken-relaxing", prompt: "soft spoken relaxing ASMR", shouldPreserve: false },
];

const CASES: Case[] = [...SHOULD_PRESERVE, ...SHOULD_NOT_PRESERVE];

console.log("\n=== ASMR Creative Direction Trigger Calibration (RP-011C.8.8.4C) ===\n");

for (const c of CASES) {
  const intent = extractCreativeIntent({ prompt: c.prompt });
  console.log(`[${c.id}] "${c.prompt}"`);
  console.log(`    preset=${intent.preset}  asmrMode=${intent.asmrMode ?? "(n/a)"}  creativeDirection=${intent.creativeDirection ? "preserved" : "absent"}`);

  check(`${c.id}: preset classifies as "classic-asmr"`, intent.preset, "classic-asmr");

  if (c.shouldPreserve) {
    check(`${c.id}: creativeDirection is preserved verbatim`, intent.creativeDirection, c.prompt);
  } else {
    check(`${c.id}: creativeDirection is absent`, intent.creativeDirection, undefined);
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Regression: existing ASMR story and narrative behavior must be unchanged.
// ---------------------------------------------------------------------------

console.log("=== Regression: existing story/narrative behavior unchanged ===\n");

{
  const storyIntent = extractCreativeIntent({ prompt: "Tell me a story about a lighthouse keeper" });
  check("regression: narrative preset still preserves creativeDirection", storyIntent.creativeDirection, "Tell me a story about a lighthouse keeper");
}

{
  const presenceIntent = extractCreativeIntent({ prompt: "tapping and scratching sounds ASMR for deep relaxation" });
  check("regression: plain classic-asmr presence prompt with no scenario still has no creativeDirection", presenceIntent.creativeDirection, undefined);
}

{
  // RP-011C.8.11: meditation now preserves creativeDirection too (see
  // test-creative-intelligence-intent.ts section 9) -- this test's concern
  // is that ASMR-trigger-word classification stays unaffected by
  // meditation, not that meditation drops the user's explicit request.
  const meditationPrompt = "a calming breathing exercise meditation for anxiety";
  const meditationIntent = extractCreativeIntent({ prompt: meditationPrompt });
  check("regression: meditation preset preserves creativeDirection", meditationIntent.creativeDirection, meditationPrompt);
}

{
  // RP-011C.8.11: kids-story now preserves creativeDirection too (same
  // note as above) -- this test's concern is ASMR-trigger-word
  // classification, not kids-story's creativeDirection value.
  const kidsPrompt = "a kids story about a brave little fox";
  const kidsIntent = extractCreativeIntent({ prompt: kidsPrompt });
  check("regression: kids-story preset preserves creativeDirection", kidsIntent.creativeDirection, kidsPrompt);
}

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
