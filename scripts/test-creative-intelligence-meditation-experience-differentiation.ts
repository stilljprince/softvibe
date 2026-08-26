// scripts/test-creative-intelligence-meditation-experience-differentiation.ts
//
// RP-011C.8.11 -- Meditation Experience Type Differentiation.
//
// Prior to this change every meditation request -- regardless of what was
// actually asked for -- planned through the same fixed six-phase structure
// (arrival -> breath anchor -> body awareness -> practice deepening ->
// integration -> gentle return, scenes/templates.ts MEDITATION_SCENE_STEPS),
// because intent/classifiers.ts had no sub-classification of the meditation
// experience type at all. This suite locks in the fix: classifyMeditation-
// ExperienceType() (intent/classifiers.ts) now distinguishes self-
// compassion, morning presence, evening wind-down, stress release, body
// relaxation, sleep-oriented, and guided-imagery requests from the plain
// breath/attention control case, and scenes/planner.ts selects a matching,
// distinct scene structure (scenes/templates.ts MEDITATION_SCENE_STEPS_BY_TYPE)
// for each. guided_imagery additionally gets its own guidance template
// (guidance/templates.ts MEDITATION_GUIDED_IMAGERY_GUIDANCE_TEMPLATE) since
// the generic meditation template forbids "fantasy-world imagery" outright.
//
// Nothing here calls a provider for real, hits the database, or touches the
// active generation pipeline.
//
// Run with:  npx tsx scripts/test-creative-intelligence-meditation-experience-differentiation.ts

import {
  CreativeKnowledgeRegistry,
  initializeCreativeKnowledge,
  extractCreativeIntent,
  buildCreativeContext,
  buildStoryBlueprint,
  buildSceneBlueprints,
  buildGenerationGuidance,
  writeStory,
  evaluateNarrative,
  buildWriterUserPrompt,
} from "../lib/creative-intelligence";
import type { CreativeIntent, MeditationExperienceType } from "../lib/creative-intelligence";

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

const registry = new CreativeKnowledgeRegistry();
initializeCreativeKnowledge(registry);
const createdAt = "2026-01-01T00:00:00.000Z";

function pipelineFor(prompt: string) {
  const intent = extractCreativeIntent({ prompt });
  const context = buildCreativeContext({ rawInput: { prompt }, intent, registry, createdAt });
  const blueprint = buildStoryBlueprint({ intent, context, createdAt });
  const scenes = buildSceneBlueprints({ intent, context, blueprint, createdAt });
  const guidance = buildGenerationGuidance({ scenes, blueprint, context, intent, createdAt });
  const generatedContent = writeStory({ scenes, guidance, blueprint, context, intent, createdAt });
  const evaluation = evaluateNarrative({ generatedContent, storyBlueprint: blueprint, scenes, guidance, context, intent, createdAt });
  return { intent, context, blueprint, scenes, guidance, generatedContent, evaluation };
}

type Case = {
  id: string;
  prompt: string;
  expectedType: MeditationExperienceType;
  narrativeFunctionMustInclude: string;
};

// ─── Required regression cases (CEO brief: Meditation Differentiation) ───

const CASES: Case[] = [
  {
    id: "morning-presence",
    prompt: "A morning meditation to help me start my day feeling present.",
    expectedType: "morning_presence",
    narrativeFunctionMustInclude: "waking",
  },
  {
    id: "self-compassion",
    prompt: "A self-compassion meditation to help me be kinder to myself.",
    expectedType: "self_compassion",
    narrativeFunctionMustInclude: "self-kindness",
  },
  {
    id: "evening-wind-down",
    prompt: "An evening meditation to wind down and let go of the day.",
    expectedType: "evening_wind_down",
    narrativeFunctionMustInclude: "releasing the day",
  },
  {
    id: "guided-beach-visualization",
    prompt: "A guided visualization meditation where I picture myself relaxing on a beach.",
    expectedType: "guided_imagery",
    narrativeFunctionMustInclude: "imagined space",
  },
  {
    id: "plain-breath-control",
    prompt: "A calming meditation to help me relax and breathe.",
    expectedType: "breath_presence",
    narrativeFunctionMustInclude: "breath and attention anchoring",
  },
];

for (const { id, prompt, expectedType, narrativeFunctionMustInclude } of CASES) {
  const { intent, scenes, guidance, generatedContent, evaluation } = pipelineFor(prompt);

  check(`${id}: preset classifies as meditation`, intent.preset, "meditation");
  check(`${id}: meditationExperienceType classifies as "${expectedType}"`, intent.meditationExperienceType, expectedType);
  check(`${id}: creativeDirection preserves the prompt verbatim`, intent.creativeDirection, prompt);

  const narrativeFunctions = scenes.map((s) => s.narrativeFunction.toLowerCase());
  checkTrue(
    `${id}: scene structure includes a phase referencing "${narrativeFunctionMustInclude}"`,
    narrativeFunctions.some((f) => f.includes(narrativeFunctionMustInclude))
  );

  // attention_progression must still pass: arrival, a focus/anchor stage,
  // and a gentle return, in order -- regardless of which type-specific
  // structure was selected (evaluation/evaluator.ts).
  const attentionProgression = evaluation.criteriaResults.find((r) => r.criterionId === "attention_progression");
  checkTrue(`${id}: attention_progression criterion still passes`, attentionProgression?.passed === true);

  // Generic Writing focus text differentiates automatically through
  // scene.narrativeFunction (guidance/builder.ts resolveWritingFocus).
  checkTrue(
    `${id}: writingFocus reflects the type-specific phase, not a generic placeholder`,
    guidance.some((g) => g.writingFocus.toLowerCase().includes(narrativeFunctionMustInclude))
  );

  checkTrue(`${id}: writeStory still produces one GeneratedScene per planned scene`, generatedContent.length === scenes.length);
}

// ─── guided_imagery gets its own guidance template, not the generic ban ──

{
  const prompt = "A guided visualization meditation where I picture myself relaxing on a beach.";
  const { intent, guidance } = pipelineFor(prompt);
  check("guided-imagery: meditationExperienceType is guided_imagery", intent.meditationExperienceType, "guided_imagery");
  checkTrue(
    "guided-imagery: descriptionGuidance no longer forbids fantasy-world imagery outright",
    guidance.every((g) => !/avoid.*fantasy-world imagery/i.test(g.descriptionGuidance))
  );
  checkTrue(
    "guided-imagery: descriptionGuidance now describes the imagined space's sensory detail",
    guidance.every((g) => /imagined space/i.test(g.descriptionGuidance))
  );
  checkTrue(
    "guided-imagery: styleGuidance still rules out a story/plot/characters within the space",
    guidance.every((g) => /not a story|not.*plot|characters within it/i.test(g.styleGuidance) || /never.*fantasy world/i.test(g.descriptionGuidance))
  );
}

// ─── Control case: plain breath meditation is unaffected ────────────────

{
  const prompt = "A calming meditation to help me relax and breathe.";
  const { intent, scenes, guidance } = pipelineFor(prompt);
  check("control: meditationExperienceType defaults to breath_presence", intent.meditationExperienceType, "breath_presence");
  check("control: scene count is unchanged (6 phases)", scenes.length, 6);
  checkTrue(
    "control: descriptionGuidance still avoids fantasy-world imagery (unchanged default template)",
    guidance.every((g) => /avoid.*fantasy-world imagery/i.test(g.descriptionGuidance))
  );
  const narrativeFunctions = scenes.map((s) => s.narrativeFunction);
  check("control: narrativeFunctions match the pre-existing fixed six-phase structure", narrativeFunctions, [
    "Arrival and settling",
    "Breath and attention anchoring",
    "Body awareness and relaxation",
    "Practice deepening",
    "Integration",
    "Gentle return",
  ]);
}

// ─── Writer prompt: explicit creative direction is visible to the Writer ─

{
  const prompt = "A self-compassion meditation to help me be kinder to myself.";
  const { intent, blueprint, context, scenes, guidance } = pipelineFor(prompt);
  const userPrompt = buildWriterUserPrompt({ scene: scenes[0], guidance: guidance[0], blueprint, context, intent });
  checkTrue("self-compassion: writer prompt includes USER CREATIVE DIRECTION section", userPrompt.includes("USER CREATIVE DIRECTION"));
  checkTrue("self-compassion: writer prompt includes the prompt verbatim", userPrompt.includes(prompt));
}

// ─── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
