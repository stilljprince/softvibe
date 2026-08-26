// scripts/test-creative-intelligence-asmr-scenario-routing-calibration.ts
//
// RP-011C.8.8.4G — ASMR Scenario Routing Calibration.
//
// RP-011C.8.8.4F found that classifyAsmrMode() only routed a classic-asmr
// prompt to the scenario-capable "story" branch when a narrow story keyword
// ("story", "roleplay", "read me", ...) appeared -- a prompt describing a
// concrete scenario (a companion, a personal-attention framing, a named
// activity) with no such keyword stayed in "presence" mode even though the
// existing story branch was the correct fit.
//
// This regresses classifyAsmrMode()'s fix: it now also routes to "story"
// whenever the existing ASMR_SCENARIO_SIGNALS (companion / personal-
// attention / role-persona / activity signals, already used by
// classifyCreativeDirection()) are present. No new ASMR mode, no new
// templates -- this only proves the existing story branch is reachable via
// scenario wording, not just story wording.
//
// This is a regression-coverage file only. It makes no changes to
// planning/, scenes/, guidance/, knowledge/, evaluation/, writer/, app/, or
// lib/narrative/ -- it only exercises extractCreativeIntent().
//
// Run with:
//   npx tsx scripts/test-creative-intelligence-asmr-scenario-routing-calibration.ts

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

function checkTrue(name: string, condition: boolean): void {
  check(name, condition, true);
}

// ===========================================================================
// SECTION 1 -- Presence behavior unchanged. Pure delivery-style requests,
// with no persona/scenario/activity signal, must stay in "presence".
// ===========================================================================

console.log("\n=== SECTION 1: Presence unchanged (delivery-style requests only) ===\n");

const PRESENCE_PROMPTS = ["gentle whisper ASMR", "soft spoken ASMR", "calm whispering ASMR", "calm ASMR voice"];

for (const prompt of PRESENCE_PROMPTS) {
  const intent = extractCreativeIntent({ prompt });
  console.log(`"${prompt}" -> preset=${intent.preset} asmrMode=${intent.asmrMode ?? "(n/a)"}`);
  check(`"${prompt}": preset is classic-asmr`, intent.preset, "classic-asmr");
  check(`"${prompt}": asmrMode is presence`, intent.asmrMode, "presence");
}

// Emotional/relaxation language alone -- without a companion/persona/
// activity/scenario signal -- must not tip a prompt into scenario mode.
const PRESENCE_NOT_SCENARIO_PROMPTS = ["ASMR help me relax", "ASMR help me sleep", "calm whisper ASMR"];

for (const prompt of PRESENCE_NOT_SCENARIO_PROMPTS) {
  const intent = extractCreativeIntent({ prompt });
  console.log(`"${prompt}" -> preset=${intent.preset} asmrMode=${intent.asmrMode ?? "(n/a)"}`);
  checkTrue(
    `"${prompt}": emotional language alone does not trigger scenario mode`,
    intent.preset !== "classic-asmr" || intent.asmrMode === "presence"
  );
}

// ===========================================================================
// SECTION 2 -- Scenario routing. Concrete companion/persona/activity signals
// must route to the existing scenario-capable "story" branch, even with no
// story/roleplay keyword present.
// ===========================================================================

console.log("\n=== SECTION 2: Scenario routing (companion/persona/activity signals) ===\n");

const SCENARIO_PROMPTS = [
  "Create an ASMR personal attention experience where a close friend helps me after a difficult day.",
  "ASMR friend helps me after a difficult day",
  "ASMR personal attention session",
  "ASMR companion experience",
  "ASMR librarian roleplay",
  "ASMR someone reads to me",
  "ASMR roleplay",
];

for (const prompt of SCENARIO_PROMPTS) {
  const intent = extractCreativeIntent({ prompt });
  console.log(`"${prompt}" -> preset=${intent.preset} asmrMode=${intent.asmrMode ?? "(n/a)"}`);
  check(`"${prompt}": preset is classic-asmr`, intent.preset, "classic-asmr");
  check(`"${prompt}": asmrMode is story`, intent.asmrMode, "story");
}

// ===========================================================================
// SECTION 3 -- Other presets unaffected. asmrMode must stay undefined for
// every preset besides classic-asmr, scenario wording or not.
// ===========================================================================

console.log("\n=== SECTION 3: Other presets unaffected ===\n");

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
