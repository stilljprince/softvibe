// scripts/test-creative-intelligence-asmr-scenario-routing-validation.ts
//
// RP-011C.8.8.4H -- ASMR Scenario Routing Validation Benchmark.
//
// Validates the RP-011C.8.8.4G ASMR Scenario Routing Calibration
// (classifyAsmrMode() in lib/creative-intelligence/intent/classifiers.ts)
// against the 5 benchmark prompts specified for this task, plus regression
// checks confirming asmrMode stays undefined for non-ASMR presets.
//
// This is a validation-only script. It makes no changes to any
// implementation file -- it only exercises extractCreativeIntent().
//
// Run with:
//   npx tsx scripts/test-creative-intelligence-asmr-scenario-routing-validation.ts

import { extractCreativeIntent } from "../lib/creative-intelligence";
import type { ClassicAsmrMode, CreativePreset } from "../lib/creative-intelligence";

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

// ===========================================================================
// SECTION 1 -- The 5 benchmark cases
// ===========================================================================

console.log("\n=== SECTION 1: Benchmark cases ===\n");

type Case = {
  id: string;
  prompt: string;
  expectedPreset: CreativePreset;
  expectedAsmrMode: ClassicAsmrMode;
};

const CASES: Case[] = [
  {
    id: "Case 1 -- Pure presence",
    prompt: "Create a gentle whisper ASMR experience with a calm voice and soft spoken presence.",
    expectedPreset: "classic-asmr",
    expectedAsmrMode: "presence",
  },
  {
    id: "Case 2 -- Companion scenario",
    prompt: "Create an ASMR experience where a close friend helps me after a difficult day.",
    expectedPreset: "classic-asmr",
    expectedAsmrMode: "story",
  },
  {
    id: "Case 3 -- Personal attention scenario",
    prompt: "Create a gentle ASMR personal attention session where someone takes care of me after an exhausting day.",
    expectedPreset: "classic-asmr",
    expectedAsmrMode: "story",
  },
  {
    id: "Case 4 -- Librarian scenario",
    prompt: "Create an ASMR librarian roleplay where a kind librarian talks with me and reads me a few pages from a favorite book.",
    expectedPreset: "classic-asmr",
    expectedAsmrMode: "story",
  },
  {
    id: "Case 5 -- Mystery/thriller boundary",
    prompt: "Tell me a mysterious thriller story in an ASMR voice, like someone is quietly telling me a secret by candlelight.",
    expectedPreset: "classic-asmr",
    expectedAsmrMode: "story",
  },
];

for (const c of CASES) {
  const intent = extractCreativeIntent({ prompt: c.prompt });
  console.log(
    `${c.id}\n  prompt: "${c.prompt}"\n  preset=${intent.preset} asmrMode=${intent.asmrMode ?? "(n/a)"} creativeDirection=${
      intent.creativeDirection ? "present" : "absent"
    }`
  );
  check(`${c.id}: preset is ${c.expectedPreset}`, intent.preset, c.expectedPreset);
  check(`${c.id}: asmrMode is ${c.expectedAsmrMode}`, intent.asmrMode, c.expectedAsmrMode);
  console.log("");
}

// ===========================================================================
// SECTION 2 -- Regression: non-ASMR presets never receive asmrMode
// ===========================================================================

console.log("=== SECTION 2: Regression -- non-ASMR presets unaffected ===\n");

const OTHER_PRESET_CASES: Array<{ prompt: string; preset: CreativePreset }> = [
  { prompt: "Tell me a story about a friend who helps a traveler.", preset: "narrative" },
  { prompt: "Guided meditation with a calm companion voice.", preset: "meditation" },
  { prompt: "A sleep story where a friend reads to me before bed.", preset: "sleep-story" },
  { prompt: "A kids story where a friend helps after a difficult day.", preset: "kids-story" },
];

for (const c of OTHER_PRESET_CASES) {
  const intent = extractCreativeIntent({ prompt: c.prompt, presetHint: c.preset });
  console.log(`"${c.prompt}" (preset=${c.preset}) -> asmrMode=${intent.asmrMode ?? "(n/a)"}`);
  check(`"${c.prompt}": preset stays "${c.preset}"`, intent.preset, c.preset);
  const undefinedAsmrMode: ClassicAsmrMode | undefined = undefined;
  check(`"${c.prompt}": asmrMode is undefined for preset "${c.preset}"`, intent.asmrMode, undefinedAsmrMode);
}

// ===========================================================================
// Summary
// ===========================================================================

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
