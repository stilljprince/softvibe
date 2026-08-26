// scripts/test-creative-intelligence-asmr-tension-and-perspective-fix.ts
//
// RP-011C.7 -- Targeted ASMR Cutover Readiness Fix. Deterministic tests for
// the two confirmed live cutover-readiness regression gaps:
//
//   1. Tension-aware ASMR story branch (asmrMode "story" + explicit
//      mystery/thriller/suspense intent routes to a distinct scene/
//      planning/guidance template that allows a real clue, complication,
//      escalation, and reveal).
//   2. Listener-as-first-person-experiencer perspective semantics (a
//      listener who explicitly makes themselves the scene's "I" gets that
//      reflected in characterGuidance, instead of a separate persona-I
//      still addressing them as "you").
//
// Deterministic and mock-writer only -- no live provider calls. Covers the
// six cases (A-F) specified for this task's deterministic test pass.
//
// Run with:
//   npx tsx scripts/test-creative-intelligence-asmr-tension-and-perspective-fix.ts

import {
  buildCreativeContext,
  buildGenerationGuidance,
  buildSceneBlueprints,
  buildStoryBlueprint,
  evaluateNarrative,
  extractCreativeIntent,
  CreativeKnowledgeRegistry,
  initializeCreativeKnowledge,
} from "../lib/creative-intelligence";
import { runCreativePipeline } from "../lib/creative-intelligence/orchestration";
import type { CreativeIntent } from "../lib/creative-intelligence";

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

function checkTrue(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`[PASS] ${name}`);
    passed++;
  } else {
    console.log(`[FAIL] ${name}${detail ? `\n       ${detail}` : ""}`);
    failed++;
  }
}

const registry = new CreativeKnowledgeRegistry();
initializeCreativeKnowledge(registry);

function buildPipelineArtifacts(prompt: string) {
  const intent = extractCreativeIntent({ prompt });
  const context = buildCreativeContext({ rawInput: { prompt }, intent, registry });
  const blueprint = buildStoryBlueprint({ intent, context });
  const scenes = buildSceneBlueprints({ intent, context, blueprint });
  const guidance = buildGenerationGuidance({ scenes, blueprint, context, intent });
  return { intent, context, blueprint, scenes, guidance };
}

// ===========================================================================
// SECTION 1 -- Tension routing (Cases A-D)
// ===========================================================================

console.log("\n=== SECTION 1: Tension-aware ASMR story routing ===\n");

type TensionCase = {
  id: string;
  prompt: string;
  expectTension: boolean;
  expectFirstNarrativeFunction: string;
};

const TENSION_CASES: TensionCase[] = [
  {
    id: "Case A -- Librarian roleplay (control, tension must NOT activate)",
    prompt:
      "Create an ASMR librarian roleplay where a kind librarian talks with me and reads me a few pages from a favorite book.",
    expectTension: false,
    expectFirstNarrativeFunction: "Scenario introduction",
  },
  {
    id: "Case B -- Close friend companion (control, tension must NOT activate)",
    prompt: "Create an ASMR experience where a close friend sits with me after a difficult day and quietly keeps me company.",
    expectTension: false,
    expectFirstNarrativeFunction: "Scenario introduction",
  },
  {
    id: "Case C -- Mystery/thriller story (tension MUST activate)",
    prompt:
      "Tell me a mysterious thriller story in an ASMR voice, like someone is quietly telling me a secret by candlelight.",
    expectTension: true,
    expectFirstNarrativeFunction: "Scenario and mystery setup",
  },
  {
    id: "Case D -- Generic secret phrasing without story intent (tension must NOT activate)",
    prompt:
      "Create a gentle ASMR personal attention session where someone takes care of me and shares a soft secret before I fall asleep.",
    expectTension: false,
    expectFirstNarrativeFunction: "Scenario introduction",
  },
];

for (const c of TENSION_CASES) {
  const { intent, scenes } = buildPipelineArtifacts(c.prompt);
  console.log(`${c.id}\n  prompt: "${c.prompt}"\n  asmrMode=${intent.asmrMode} asmrNarrativeTension=${intent.asmrNarrativeTension}`);
  check(`${c.id}: preset is classic-asmr`, intent.preset, "classic-asmr");
  check(`${c.id}: asmrMode is "story"`, intent.asmrMode, "story");
  check(`${c.id}: asmrNarrativeTension is ${c.expectTension}`, Boolean(intent.asmrNarrativeTension), c.expectTension);
  check(
    `${c.id}: first scene narrativeFunction is "${c.expectFirstNarrativeFunction}"`,
    scenes[0]?.narrativeFunction,
    c.expectFirstNarrativeFunction
  );
  if (c.expectTension) {
    const labels = scenes.map((s) => `${s.narrativeFunction} ${s.relatedStoryProgression}`.toLowerCase());
    checkTrue(
      `${c.id}: scenes include a complication/clue stage`,
      labels.some((l) => /clue|complication/.test(l)),
      `labels=${JSON.stringify(labels)}`
    );
    checkTrue(
      `${c.id}: scenes include a reveal/payoff stage`,
      labels.some((l) => /reveal/.test(l)),
      `labels=${JSON.stringify(labels)}`
    );
  }
  console.log("");
}

// ===========================================================================
// SECTION 2 -- Perspective semantics (Cases E-F)
// ===========================================================================

console.log("=== SECTION 2: Listener-as-first-person-experiencer perspective ===\n");

const CASE_E_PROMPT = "Tell a mysterious ASMR thriller from my perspective, as if I am the one uncovering the secret by candlelight.";
const CASE_F_PROMPT = "Create an ASMR librarian roleplay where you are a kind librarian who softly talks with me and reads a few pages from a favorite book.";

{
  const { intent, guidance } = buildPipelineArtifacts(CASE_E_PROMPT);
  console.log(`Case E -- Listener-as-first-person thriller\n  prompt: "${CASE_E_PROMPT}"`);
  check("Case E: preset is classic-asmr", intent.preset, "classic-asmr");
  check("Case E: asmrMode is \"story\"", intent.asmrMode, "story");
  check("Case E: asmrNarrativeTension is true", Boolean(intent.asmrNarrativeTension), true);
  check("Case E: perspective is \"first\"", intent.perspective, "first");
  check("Case E: listenerIsExperiencer is true", Boolean(intent.listenerIsExperiencer), true);

  const characterGuidance = guidance[0]?.characterGuidance ?? "";
  checkTrue(
    "Case E: characterGuidance makes the listener the first-person \"I\"",
    /listener writes and experiences the scene as themselves, in first person/i.test(characterGuidance),
    `characterGuidance="${characterGuidance}"`
  );
  checkTrue(
    "Case E: characterGuidance does NOT keep a separate persona-I addressing the listener as \"you\"",
    !/the listener is guided by a gentle in-scene persona addressed directly to them/i.test(characterGuidance),
    `characterGuidance="${characterGuidance}"`
  );
  console.log("");
}

{
  const { intent, guidance } = buildPipelineArtifacts(CASE_F_PROMPT);
  console.log(`Case F -- Persona-first-person control\n  prompt: "${CASE_F_PROMPT}"`);
  check("Case F: preset is classic-asmr", intent.preset, "classic-asmr");
  check("Case F: asmrMode is \"story\"", intent.asmrMode, "story");
  check("Case F: asmrNarrativeTension is false", Boolean(intent.asmrNarrativeTension), false);
  const undefinedListenerFlag: boolean | undefined = undefined;
  check("Case F: listenerIsExperiencer is unset (no explicit role claim)", intent.listenerIsExperiencer, undefinedListenerFlag);

  const characterGuidance = guidance[0]?.characterGuidance ?? "";
  checkTrue(
    "Case F: characterGuidance keeps persona-I / listener-you (unaffected regression)",
    /the listener is guided by a gentle in-scene persona addressed directly to them/i.test(characterGuidance),
    `characterGuidance="${characterGuidance}"`
  );
  console.log("");
}

// ===========================================================================
// SECTION 3 -- Evaluator: narrative_tension_fulfillment
// ===========================================================================

console.log("=== SECTION 3: Evaluator narrative_tension_fulfillment ===\n");

async function runMockPipeline(prompt: string) {
  return runCreativePipeline({ prompt, preset: "classic-asmr" }, { writerMode: "mock" });
}

async function evaluatorSection(): Promise<void> {
  // 3a: tension requested + correctly routed -> criterion passes.
  const tensionResult = await runMockPipeline(
    "Tell me a mysterious thriller story in an ASMR voice, like someone is quietly telling me a secret by candlelight."
  );
  const tensionCriterion = tensionResult.evaluation.criteriaResults.find(
    (r) => r.criterionId === "narrative_tension_fulfillment"
  );
  checkTrue(
    "3a: narrative_tension_fulfillment passes when tension was requested and correctly planned",
    tensionCriterion?.passed === true,
    `criterion=${JSON.stringify(tensionCriterion)}`
  );

  // 3b: no tension requested -> criterion is a no-op pass.
  const presenceResult = await runMockPipeline(
    "Create an ASMR librarian roleplay where a kind librarian talks with me and reads me a few pages from a favorite book."
  );
  const presenceCriterion = presenceResult.evaluation.criteriaResults.find(
    (r) => r.criterionId === "narrative_tension_fulfillment"
  );
  checkTrue(
    "3b: narrative_tension_fulfillment passes trivially when no tension was requested",
    presenceCriterion?.passed === true,
    `criterion=${JSON.stringify(presenceCriterion)}`
  );

  // 3c: regression proof -- simulate the ORIGINAL bug (tension requested by
  // the user, but scene planning used the old no-complication template,
  // e.g. because the routing fix regressed) and confirm the new criterion
  // catches it instead of silently scoring 1.0/"strong" like the live
  // regression run found.
  const prompt = "Tell me a mysterious thriller story in an ASMR voice, like someone is quietly telling me a secret by candlelight.";
  const baseIntent = extractCreativeIntent({ prompt });
  const context = buildCreativeContext({ rawInput: { prompt }, intent: baseIntent, registry });
  const blueprint = buildStoryBlueprint({ intent: baseIntent, context });
  // Force asmrNarrativeTension off for scene planning (simulating the
  // pre-fix routing), but keep it on for the intent the evaluator sees --
  // this reproduces exactly the "requested but not planned for" failure
  // mode the live regression exposed.
  const misroutedIntent: CreativeIntent = { ...baseIntent, asmrNarrativeTension: false };
  const misroutedScenes = buildSceneBlueprints({ intent: misroutedIntent, context, blueprint });
  const misroutedGuidance = buildGenerationGuidance({ scenes: misroutedScenes, blueprint, context, intent: misroutedIntent });
  const evaluationIntent: CreativeIntent = { ...baseIntent, asmrNarrativeTension: true };
  const regressionEvaluation = evaluateNarrative({
    generatedContent: misroutedScenes.map((s) => ({ sceneId: s.id, text: "placeholder text", metadata: { createdAt: "now", version: "1", writerMethod: "deterministic-template" as const } })),
    storyBlueprint: blueprint,
    scenes: misroutedScenes,
    guidance: misroutedGuidance,
    context,
    intent: evaluationIntent,
  });
  const regressionCriterion = regressionEvaluation.criteriaResults.find(
    (r) => r.criterionId === "narrative_tension_fulfillment"
  );
  checkTrue(
    "3c: narrative_tension_fulfillment FAILS when tension was requested but scenes used the no-complication template (regression proof)",
    regressionCriterion?.passed === false,
    `criterion=${JSON.stringify(regressionCriterion)}`
  );
}

// ===========================================================================
// SECTION 4 -- Regression: other presets/modes unaffected
// ===========================================================================

function regressionSection(): void {
  console.log("\n=== SECTION 4: Regression -- unrelated presets/modes unaffected ===\n");

  const presenceIntent = extractCreativeIntent({
    prompt: "Create a gentle ASMR whisper experience focused on the quiet sound, rhythm, and closeness of the voice itself.",
  });
  const undefinedTension: boolean | undefined = undefined;
  check("Pure presence: asmrNarrativeTension stays unset", presenceIntent.asmrNarrativeTension, undefinedTension);

  const meditationIntent = extractCreativeIntent({
    prompt: "Guide me through a calming visualization where I imagine sitting on a quiet beach.",
    presetHint: "meditation",
  });
  check("Meditation: asmrNarrativeTension stays unset", meditationIntent.asmrNarrativeTension, undefinedTension);

  const sleepStoryIntent = extractCreativeIntent({
    prompt: "Tell me a mysterious bedtime story about a quiet valley.",
    presetHint: "sleep-story",
  });
  check("Sleep Story: asmrMode stays unset even with mystery wording", sleepStoryIntent.asmrMode, undefined as never);
}

async function main(): Promise<void> {
  await evaluatorSection();
  regressionSection();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[test-creative-intelligence-asmr-tension-and-perspective-fix] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
