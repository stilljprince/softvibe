// scripts/test-creative-intelligence-asmr-atmospheric-scenario-calibration.ts
//
// RP-011C.8.8.4J -- ASMR Scenario Signal Expansion.
//
// RP-011C.8.8.4G/4H taught classifyAsmrMode() to route a classic-asmr prompt
// to "story" when a concrete companion/persona/activity signal was present,
// even with no story/roleplay keyword. That still missed atmospheric
// scenario requests -- a mystery, a secret, candlelight, a hidden or
// magical setting -- which describe a scenario/atmosphere the ASMR voice is
// narrating within, not a person/persona and not a bare sensory-presence
// request. Example:
//
//   "Create a mysterious ASMR experience where someone whispers a secret to
//   me by candlelight."
//
// previously classified as classic-asmr + presence; should be
// classic-asmr + story.
//
// This regresses the ASMR_ATMOSPHERIC_SCENARIO_SIGNALS addition to
// ASMR_SCENARIO_SIGNALS in classifiers.ts: it only fires once preset ===
// "classic-asmr" is already established (classifyAsmrMode's own guard), so
// a plain "write a mysterious story" prompt -- with no ASMR preset keyword
// -- stays "narrative" and is untouched by this change.
//
// This is a regression-coverage file only. It makes no changes to
// planning/, scenes/, guidance/, knowledge/, evaluation/, writer/, app/, or
// lib/narrative/ -- it only exercises extractCreativeIntent().
//
// Run with:
//   npx tsx scripts/test-creative-intelligence-asmr-atmospheric-scenario-calibration.ts

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
// SECTION 1 -- Presence unchanged. Pure delivery-style requests, with no
// persona/scenario/activity/atmospheric signal, must stay in "presence".
// ===========================================================================

console.log("\n=== SECTION 1: Presence unchanged (delivery-style requests only) ===\n");

const PRESENCE_PROMPTS = ["gentle whisper ASMR with soft spoken presence", "calm ASMR voice", "soft spoken ASMR"];

for (const prompt of PRESENCE_PROMPTS) {
  const intent = extractCreativeIntent({ prompt });
  console.log(`"${prompt}" -> preset=${intent.preset} asmrMode=${intent.asmrMode ?? "(n/a)"}`);
  check(`"${prompt}": preset is classic-asmr`, intent.preset, "classic-asmr");
  check(`"${prompt}": asmrMode is presence`, intent.asmrMode, "presence");
}

// ===========================================================================
// SECTION 2 -- Existing scenario routing (companion/persona/activity)
// remains correct after adding the atmospheric signal set.
// ===========================================================================

console.log("\n=== SECTION 2: Existing scenario routing unchanged ===\n");

const EXISTING_SCENARIO_PROMPTS = [
  "ASMR friend helps me after a difficult day",
  "ASMR personal attention session",
  "ASMR librarian roleplay",
];

for (const prompt of EXISTING_SCENARIO_PROMPTS) {
  const intent = extractCreativeIntent({ prompt });
  console.log(`"${prompt}" -> preset=${intent.preset} asmrMode=${intent.asmrMode ?? "(n/a)"}`);
  check(`"${prompt}": preset is classic-asmr`, intent.preset, "classic-asmr");
  check(`"${prompt}": asmrMode is story`, intent.asmrMode, "story");
}

// ===========================================================================
// SECTION 3 -- New atmospheric scenario signals route to "story" even with
// no companion/persona/activity/story keyword present.
// ===========================================================================

console.log("\n=== SECTION 3: New atmospheric scenario routing ===\n");

const ATMOSPHERIC_SCENARIO_PROMPTS = [
  "Create a mysterious ASMR experience where someone whispers a secret to me by candlelight.",
  "hidden story whispered in ASMR voice",
  "ASMR ancient temple exploration with whispered narration",
  "magical ASMR adventure with a whispered journey through a secret garden",
  "ASMR detective mystery whispered close to the mic",
];

for (const prompt of ATMOSPHERIC_SCENARIO_PROMPTS) {
  const intent = extractCreativeIntent({ prompt });
  console.log(`"${prompt}" -> preset=${intent.preset} asmrMode=${intent.asmrMode ?? "(n/a)"}`);
  check(`"${prompt}": preset is classic-asmr`, intent.preset, "classic-asmr");
  check(`"${prompt}": asmrMode is story`, intent.asmrMode, "story");
}

// ===========================================================================
// SECTION 4 -- Generic atmospheric words alone, with no ASMR preset
// keyword, must not force story/ASMR routing.
// ===========================================================================

console.log("\n=== SECTION 4: Atmospheric words alone do not imply ASMR ===\n");

const NON_ASMR_ATMOSPHERIC_PROMPTS: Array<{ prompt: string; preset: CreativePreset }> = [
  { prompt: "write a mysterious story", preset: "narrative" },
  { prompt: "tell me an adventure story about a hidden ancient city", preset: "narrative" },
  { prompt: "a magical journey meditation", preset: "meditation" },
];

for (const c of NON_ASMR_ATMOSPHERIC_PROMPTS) {
  const intent = extractCreativeIntent({ prompt: c.prompt });
  console.log(`"${c.prompt}" -> preset=${intent.preset} asmrMode=${intent.asmrMode ?? "(n/a)"}`);
  check(`"${c.prompt}": preset stays "${c.preset}"`, intent.preset, c.preset);
  const undefinedAsmrMode: ClassicAsmrMode | undefined = undefined;
  check(`"${c.prompt}": asmrMode is undefined for preset "${c.preset}"`, intent.asmrMode, undefinedAsmrMode);
}

// ===========================================================================
// SECTION 5 -- Other presets remain unaffected even under an explicit
// classic-asmr presetHint override check from the earlier calibration.
// ===========================================================================

console.log("\n=== SECTION 5: Other presets unaffected (presetHint override) ===\n");

const OTHER_PRESET_CASES: Array<{ prompt: string; preset: CreativePreset }> = [
  { prompt: "Tell me a mysterious story about a hidden secret.", preset: "narrative" },
  { prompt: "Guided meditation on a magical journey inward.", preset: "meditation" },
  { prompt: "A sleep story about an ancient hidden adventure.", preset: "sleep-story" },
  { prompt: "A kids story about a magical secret adventure.", preset: "kids-story" },
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
