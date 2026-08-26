// scripts/test-creative-intelligence-asmr-mode-benchmark.ts
//
// RP-011C.8.8.3P — Classic ASMR Mode End-to-End Benchmark & Quality Review.
//
// Validates, end-to-end from a raw user prompt (no presetHint), that classic
// ASMR intent is correctly separated between:
//
//   A) classic-asmr + presence  (RP-011C.8.8.3I/J-N)
//   B) classic-asmr + story     (RP-011C.8.8.3I/J-N/O)
//   C) boundary cases that mix ASMR wording with another preset's own
//      keywords, or use neither preset's exact keywords at all
//
// This is a benchmark/test file only. It makes no changes to intent/,
// planning/, scenes/, guidance/, evaluation/, or writer/ -- it only exercises
// the existing extractCreativeIntent() and runCreativePipeline() surfaces
// (writerMode: "mock" by default, no OpenAI calls, no production route).
//
// Three sections:
//   1. Intent classification straight from raw prompt text (extractCreativeIntent).
//   2. Generated structure + safety for presence/story, with preset forced to
//      "classic-asmr" so structural validation is isolated from any
//      preset-classification gap surfaced in section 1 (see section 1's
//      "KNOWN DEFECT" cases below).
//   3. Boundary cases: classification as detected naturally, then forced
//      through classic-asmr to confirm the safety invariant holds regardless
//      of which preset a boundary prompt lands in.
//   4. Optional live pass (writerMode: "provider") -- opt-in only, gated
//      exactly like scripts/run-narrative-benchmark.ts's --live flag.
//
// Run with:
//   npx tsx scripts/test-creative-intelligence-asmr-mode-benchmark.ts
//   CONFIRM_LIVE_BENCHMARK=true npx tsx scripts/test-creative-intelligence-asmr-mode-benchmark.ts --live

import { extractCreativeIntent } from "../lib/creative-intelligence";
import type { ClassicAsmrMode, CreativePreset } from "../lib/creative-intelligence";
import { runCreativePipeline } from "../lib/creative-intelligence/orchestration";
import { loadEnvironment, enforceLiveModeGuards } from "./run-narrative-benchmark";

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const equal = JSON.stringify(actual) === JSON.stringify(expected);
  if (equal) {
    console.log(`[PASS] ${name}`);
    passed++;
  } else {
    console.log(
      `[FAIL] ${name}\n       expected=${JSON.stringify(expected)}\n       actual=  ${JSON.stringify(actual)}`
    );
    failed++;
  }
}

function checkTrue(name: string, condition: boolean): void {
  check(name, condition, true);
}

function checkKnownDefect(name: string, actual: unknown, expected: unknown): void {
  const equal = JSON.stringify(actual) === JSON.stringify(expected);
  if (equal) {
    console.log(`[PASS] ${name}`);
    passed++;
  } else {
    console.log(
      `[KNOWN DEFECT] ${name}\n       expected=${JSON.stringify(expected)}\n       actual=  ${JSON.stringify(actual)}`
    );
    failed++;
  }
}

// Independent of evaluation/evaluator.ts's ASMR_FORCED_OUTCOME_PHRASES /
// ASMR_EXTERNAL_TRIGGER_PHRASES lists (deliberately not imported -- those
// are private to evaluator.ts) so this benchmark is a second, differently-
// worded check on the same two safety invariants, not a re-assertion of the
// evaluator's own fixture data.
const FORCED_OUTCOME_PATTERN =
  /guarantee[sd]?\s+(relaxation|to\s+(give you tingles|make you (fall asleep|relax)))|will\s+definitely\s+feel|will\s+feel\s+tingles|instantly\s+relax|always\s+works|forced\s+to\s+feel/i;

const EXTERNAL_TRIGGER_PATTERN =
  /tapping|scratching|crinkl|brushing sound|pen (on|against|tip on) paper|typing sound|clicking sound|sound of (tapping|scratching|writing)/i;

type BenchmarkCategory = "presence" | "story" | "boundary";

type AsmrModeBenchmarkCase = {
  id: string;
  category: BenchmarkCategory;
  prompt: string;
  durationMinutes: number;
  // Only set for the ticket's core (non-boundary) cases 1-4, which declare a
  // hard expected classification. Boundary cases 5-7 intentionally carry no
  // expected value -- they exist to observe/document actual behavior, not to
  // assert a single correct answer.
  expectedPreset?: CreativePreset;
  expectedAsmrMode?: ClassicAsmrMode;
  note?: string;
};

const CASES: AsmrModeBenchmarkCase[] = [
  {
    id: "1-gentle-whisper",
    category: "presence",
    prompt: "Make a calm ASMR session with gentle whispering.",
    durationMinutes: 12,
    expectedPreset: "classic-asmr",
    expectedAsmrMode: "presence",
  },
  {
    id: "2-soft-relax",
    category: "presence",
    prompt: "Speak softly and help me relax.",
    durationMinutes: 12,
    expectedPreset: "classic-asmr",
    expectedAsmrMode: "presence",
  },
  {
    id: "3-librarian-roleplay",
    category: "story",
    prompt: "Create an ASMR librarian roleplay where you softly read books to me.",
    durationMinutes: 12,
    expectedPreset: "classic-asmr",
    expectedAsmrMode: "story",
  },
  {
    id: "4-calm-companion-story",
    category: "story",
    prompt: "Be my calm companion and tell me a small story.",
    durationMinutes: 12,
    expectedPreset: "classic-asmr",
    expectedAsmrMode: "story",
  },
  {
    id: "5-sleep-story-asmr-voice",
    category: "boundary",
    prompt: "Tell me a sleep story with an ASMR voice.",
    durationMinutes: 12,
    note: "Dominant intent reads as a sleep story delivered in an ASMR-style voice, not a classic-asmr session.",
  },
  {
    id: "6-asmr-meditation",
    category: "boundary",
    prompt: "Create an ASMR meditation with a gentle voice.",
    durationMinutes: 12,
    note: "Dominant intent reads as a meditation delivered in an ASMR-style voice, not a classic-asmr session.",
  },
  {
    id: "7-calm-friend",
    category: "boundary",
    prompt: "Talk to me like a calm friend.",
    durationMinutes: 12,
    note: "No explicit ASMR/whisper/story keyword at all -- a genuinely ambiguous companion-style request.",
  },
];

async function main(): Promise<void> {
// ===========================================================================
// SECTION 1 -- Intent classification straight from raw prompt text (mock,
// deterministic, extractCreativeIntent only -- no pipeline, no writer).
// ===========================================================================

console.log("\n=== SECTION 1: Intent classification (raw prompt -> extractCreativeIntent) ===\n");

for (const c of CASES) {
  const intent = extractCreativeIntent({ prompt: c.prompt });
  console.log(`[${c.id}] (${c.category}) "${c.prompt}"`);
  console.log(`    preset=${intent.preset}  asmrMode=${intent.asmrMode ?? "(n/a)"}`);
  if (c.note) console.log(`    note: ${c.note}`);

  if (c.expectedPreset) {
    checkKnownDefect(`${c.id}: preset classifies as "${c.expectedPreset}"`, intent.preset, c.expectedPreset);
  }
  if (c.expectedAsmrMode) {
    checkKnownDefect(`${c.id}: asmrMode classifies as "${c.expectedAsmrMode}"`, intent.asmrMode, c.expectedAsmrMode);
  }
  console.log();
}

// ===========================================================================
// SECTION 2 -- Generated structure + safety for presence/story (cases 1-4),
// preset forced to "classic-asmr" via presetHint so structural validation is
// isolated from section 1's preset-classification gap. asmrMode is NOT
// forced -- it is still derived by extractCreativeIntent() from the prompt
// text inside runCreativePipeline(), so this also independently confirms the
// presence/story mode split (classifyAsmrMode) works correctly on every
// case's actual wording once preset is classic-asmr.
// ===========================================================================

console.log("\n=== SECTION 2: Generated structure + safety, preset forced to classic-asmr ===\n");

const PRESENCE_SCENE_STEPS = [
  "Sensory introduction",
  "Gentle interaction",
  "Rhythmic repetition",
  "Sensory variation",
  "Continued comfort",
];

const STORY_SCENE_STEPS = [
  "Scenario introduction",
  "Persona framing",
  "Gentle interaction",
  "Narrative sensory movement",
  "Continued comfort",
];

async function runForcedClassicAsmr(c: AsmrModeBenchmarkCase) {
  return runCreativePipeline(
    { prompt: c.prompt, preset: "classic-asmr", durationMinutes: c.durationMinutes },
    { writerMode: "mock" }
  );
}

function combinedGeneratedText(scenes: { text: string }[]): string {
  return scenes.map((s) => s.text).join("\n\n");
}

// The mock Writer Layer's deterministic placeholder text (writer.ts
// composePlaceholderText()) echoes scene.avoidPatterns verbatim on an
// "Avoid: ..." line to prove it consumed its guidance -- that line
// legitimately *names* forced-outcome/external-trigger anti-patterns
// ("...will definitely feel tingles...", "tapping, scratching...") without
// exhibiting them. Same exclusion evaluator.ts's textExcludingAvoidLines()
// applies before its own phrase-list checks; reapplied here so this
// benchmark's independent safety net doesn't flag guidance naming an
// anti-pattern as if it were committing it.
function textExcludingAvoidLine(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trim().toLowerCase().startsWith("avoid:"))
    .join("\n");
}

function checkSafetyInvariants(label: string, text: string, violations: string[]): void {
  const contentText = textExcludingAvoidLine(text);
  checkTrue(`${label}: no evaluation violations`, violations.length === 0);
  checkTrue(`${label}: no forced-outcome / guaranteed-relaxation language`, !FORCED_OUTCOME_PATTERN.test(contentText));
  checkTrue(`${label}: no external trigger-sound assumptions (tapping/scratching/etc.)`, !EXTERNAL_TRIGGER_PATTERN.test(contentText));
}

for (const c of CASES.filter((c) => c.category === "presence" || c.category === "story")) {
  const result = await runForcedClassicAsmr(c);
  const text = combinedGeneratedText(result.generatedScenes);
  const narrativeFunctions = result.scenes.map((s) => s.narrativeFunction);

  console.log(`[${c.id}] forced classic-asmr -> asmrMode=${result.intent.asmrMode}`);

  check(`${c.id}: asmrMode derives correctly from prompt once preset is classic-asmr`, result.intent.asmrMode, c.expectedAsmrMode);

  if (c.expectedAsmrMode === "presence") {
    check(`${c.id}: presence scene steps match the 5-step sensory progression`, narrativeFunctions, PRESENCE_SCENE_STEPS);
    checkTrue(
      `${c.id}: presence guidance never introduces a persona`,
      result.guidance.every((g) => /no fictional characters, dialogue partners, or narrated persona/i.test(g.characterGuidance))
    );
    checkTrue(
      `${c.id}: presence generated text never introduces a persona/scenario (only names their absence)`,
      !/gentle in-scene persona addressed directly|gentle scenario and persona framing/i.test(text)
    );
  } else if (c.expectedAsmrMode === "story") {
    check(`${c.id}: story scene steps match the 5-step scenario progression`, narrativeFunctions, STORY_SCENE_STEPS);
    checkTrue(
      `${c.id}: story guidance introduces a gentle in-scene persona`,
      result.guidance.every((g) => /gentle in-scene persona addressed directly/i.test(g.characterGuidance))
    );
    checkTrue(
      `${c.id}: story guidance allows gentle, low-stakes dialogue with the persona`,
      result.guidance.every((g) => /persona/i.test(g.dialogueGuidance) && /low-stakes/i.test(g.dialogueGuidance))
    );
    checkTrue(
      `${c.id}: story guidance still forbids a character arc, conflict, or plot for the persona`,
      result.guidance.every((g) => /not to carry a character arc, conflict, or plot/i.test(g.characterGuidance))
    );
    checkTrue(
      `${c.id}: story pacing still forbids a turning point, climax, or resolution`,
      result.guidance.every((g) => /never building toward a turning point, climax, or resolution/i.test(g.pacingGuidance))
    );
  }

  checkSafetyInvariants(c.id, text, result.evaluation.violations);

  const criticalCriteria = ["sensory_presence", "gentle_rhythm", "safe_personal_address", "no_forced_response"];
  for (const criterionId of criticalCriteria) {
    const criterionResult = result.evaluation.criteriaResults.find((r) => r.criterionId === criterionId);
    checkTrue(`${c.id}: evaluation criterion "${criterionId}" is present and passes`, criterionResult?.passed === true);
  }

  console.log();
}

// ===========================================================================
// SECTION 3 -- Boundary cases (5-7): log natural classification, then force
// classic-asmr to confirm the safety invariant holds regardless of which
// preset a boundary prompt is routed to. No hard preset/asmrMode assertion --
// these are documented for review, not a single "correct" answer.
// ===========================================================================

console.log("\n=== SECTION 3: Boundary cases -- natural classification + forced classic-asmr safety check ===\n");

for (const c of CASES.filter((c) => c.category === "boundary")) {
  const natural = extractCreativeIntent({ prompt: c.prompt });
  console.log(`[${c.id}] natural classification: preset=${natural.preset} asmrMode=${natural.asmrMode ?? "(n/a)"}`);

  const naturalResult = await runCreativePipeline({ prompt: c.prompt, durationMinutes: c.durationMinutes }, { writerMode: "mock" });
  const naturalText = combinedGeneratedText(naturalResult.generatedScenes);
  checkSafetyInvariants(`${c.id} (natural preset=${natural.preset})`, naturalText, naturalResult.evaluation.violations);

  const forced = await runForcedClassicAsmr(c);
  const forcedText = combinedGeneratedText(forced.generatedScenes);
  console.log(`    forced classic-asmr -> asmrMode=${forced.intent.asmrMode}`);
  checkSafetyInvariants(`${c.id} (forced classic-asmr)`, forcedText, forced.evaluation.violations);

  console.log();
}

// ===========================================================================
// SECTION 4 -- Optional live pass. Opt-in only: requires --live plus the same
// CONFIRM_LIVE_BENCHMARK=true / OPENAI_API_KEY guard run-narrative-benchmark.ts
// enforces for its own --live flag (imported directly, not reimplemented).
// ===========================================================================

console.log("\n=== SECTION 4: Live benchmark (optional) ===\n");

const wantsLive = process.argv.includes("--live");

if (!wantsLive) {
  console.log("Skipping live benchmark: pass --live with CONFIRM_LIVE_BENCHMARK=true and OPENAI_API_KEY set to run against real generation.\n");
} else {
  loadEnvironment();
  enforceLiveModeGuards("live");

  const liveCases = CASES.filter((c) => ["1-gentle-whisper", "3-librarian-roleplay", "5-sleep-story-asmr-voice"].includes(c.id));

  for (const c of liveCases) {
    console.log(`--- live: [${c.id}] "${c.prompt}" ---`);
    const result = await runCreativePipeline(
      { prompt: c.prompt, preset: "classic-asmr", durationMinutes: c.durationMinutes },
      { writerMode: "provider" }
    );
    const text = combinedGeneratedText(result.generatedScenes);
    console.log(`asmrMode=${result.intent.asmrMode}`);
    console.log(text);
    console.log(`\nevaluation.overallAssessment=${result.evaluation.overallAssessment} violations=${result.evaluation.violations.length}`);
    checkSafetyInvariants(`live ${c.id}`, text, result.evaluation.violations);
    console.log();
  }
}

// ===========================================================================
// Summary
// ===========================================================================

console.log(`\n${passed} passed, ${failed} failed`);
}

main()
  .then(() => {
    if (failed > 0) process.exit(1);
  })
  .catch((err) => {
    console.error("[test-creative-intelligence-asmr-mode-benchmark] failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
