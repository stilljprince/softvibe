// scripts/test-creative-intelligence-duration-budget.ts
//
// RP-011C.8.10T — Regression coverage for the Creative Intelligence
// duration-budget helper (lib/creative-intelligence/guidance/duration-
// budget.ts) and its threading into GenerationGuidance / the Writer prompt.
// Nothing here touches the active generation pipeline, calls a provider, or
// hits the database.
//
// Run with:  npx tsx scripts/test-creative-intelligence-duration-budget.ts

import {
  CreativeKnowledgeRegistry,
  initializeCreativeKnowledge,
  buildCreativeContext,
  buildStoryBlueprint,
  buildSceneBlueprints,
  buildGenerationGuidance,
  buildWriterUserPrompt,
  resolveWordBudget,
  PRESET_WORDS_PER_MINUTE,
} from "../lib/creative-intelligence";
import type {
  CreativeContext,
  CreativeIntent,
  GenerationGuidance,
  SceneBlueprint,
  StoryBlueprint,
} from "../lib/creative-intelligence";

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
const CREATED_AT = "2026-01-01T00:00:00.000Z";

function contextFor(intent: CreativeIntent, prompt = "test"): CreativeContext {
  return buildCreativeContext({ rawInput: { prompt }, intent, registry, createdAt: CREATED_AT });
}

function blueprintFor(intent: CreativeIntent, prompt = "test"): StoryBlueprint {
  return buildStoryBlueprint({ intent, context: contextFor(intent, prompt), createdAt: CREATED_AT });
}

function scenesFor(intent: CreativeIntent, prompt = "test"): SceneBlueprint[] {
  const context = contextFor(intent, prompt);
  const blueprint = blueprintFor(intent, prompt);
  return buildSceneBlueprints({ intent, context, blueprint, createdAt: CREATED_AT });
}

function guidanceFor(intent: CreativeIntent, prompt = "test"): GenerationGuidance[] {
  const context = contextFor(intent, prompt);
  const blueprint = blueprintFor(intent, prompt);
  const scenes = buildSceneBlueprints({ intent, context, blueprint, createdAt: CREATED_AT });
  return buildGenerationGuidance({ scenes, blueprint, context, intent, createdAt: CREATED_AT });
}

const narrativeIntent: CreativeIntent = {
  preset: "narrative",
  experience: "an immersive narrative built around the listener's request",
  audience: "adult",
  durationMinutes: 20,
  constraints: [],
  storyScale: "arc",
  themes: ["courage"],
};

const sleepStory30MinIntent: CreativeIntent = {
  preset: "sleep-story",
  experience: "a relaxing bedtime story to help the listener fall asleep",
  audience: "adult",
  durationMinutes: 30,
  constraints: [],
  storyScale: "gentle_journey",
  emotionalDirection: ["calm", "safe"],
};

const meditationIntent: CreativeIntent = {
  preset: "meditation",
  experience: "a guided meditation for centering attention",
  audience: "adult",
  durationMinutes: 12,
  constraints: [],
};

const kidsStoryIntent: CreativeIntent = {
  preset: "kids-story",
  experience: "a gentle, age-safe bedtime story for children",
  audience: "child",
  durationMinutes: 8,
  constraints: ["age-safe: avoid violence, horror, and existential themes"],
  storyScale: "gentle_journey",
  themes: ["friendship"],
  requiredElements: ["gentle_pacing", "safe_resolution", "positive_resolution", "age_safe_language"],
};

const classicAsmrIntent: CreativeIntent = {
  preset: "classic-asmr",
  experience: "a slow, sensory-focused ASMR session",
  audience: "adult",
  durationMinutes: 15,
  constraints: [],
};

const noDurationIntent: CreativeIntent = {
  preset: "narrative",
  experience: "an immersive narrative built around the listener's request",
  audience: "adult",
  constraints: [],
  storyScale: "arc",
};

const allDurationIntents = [
  narrativeIntent,
  sleepStory30MinIntent,
  meditationIntent,
  kidsStoryIntent,
  classicAsmrIntent,
];

// ─── 1. resolveWordBudget: correct total + per-scene calculation ───────

{
  check(
    "resolveWordBudget: sleep-story 30 minutes uses the 135 wpm figure",
    resolveWordBudget(sleepStory30MinIntent, 5),
    { totalWords: 30 * 135, wordsPerScene: Math.round((30 * 135) / 5) }
  );
  check(
    "resolveWordBudget: classic-asmr uses the 115 wpm figure",
    resolveWordBudget(classicAsmrIntent, 4),
    { totalWords: Math.round(15 * 115), wordsPerScene: Math.round(Math.round(15 * 115) / 4) }
  );
  check(
    "resolveWordBudget: meditation uses the 120 wpm figure",
    resolveWordBudget(meditationIntent, 3),
    { totalWords: 12 * 120, wordsPerScene: Math.round((12 * 120) / 3) }
  );
  check(
    "resolveWordBudget: narrative uses the 120 wpm figure",
    resolveWordBudget(narrativeIntent, 6),
    { totalWords: 20 * 120, wordsPerScene: Math.round((20 * 120) / 6) }
  );
  check(
    "resolveWordBudget: kids-story uses the 120 wpm figure",
    resolveWordBudget(kidsStoryIntent, 7),
    { totalWords: 8 * 120, wordsPerScene: Math.round((8 * 120) / 7) }
  );
  check(
    "resolveWordBudget: returns undefined when durationMinutes is not set",
    resolveWordBudget(noDurationIntent, 5),
    undefined
  );
  check(
    "resolveWordBudget: returns undefined when there are no scenes",
    resolveWordBudget(sleepStory30MinIntent, 0),
    undefined
  );
  checkTrue(
    "PRESET_WORDS_PER_MINUTE matches production script-builder.ts precedent",
    PRESET_WORDS_PER_MINUTE["classic-asmr"] === 115 &&
      PRESET_WORDS_PER_MINUTE["sleep-story"] === 135 &&
      PRESET_WORDS_PER_MINUTE["kids-story"] === 120 &&
      PRESET_WORDS_PER_MINUTE["meditation"] === 120 &&
      PRESET_WORDS_PER_MINUTE["narrative"] === 120
  );
}

// ─── 2. GenerationGuidance carries a correct per-scene targetWordCount ──

for (const intent of allDurationIntents) {
  const scenes = scenesFor(intent);
  const guidance = guidanceFor(intent);
  const expectedBudget = resolveWordBudget(intent, scenes.length);

  checkTrue(`${intent.preset}: word budget is resolvable for a duration-bearing intent`, expectedBudget !== undefined);
  checkTrue(
    `${intent.preset}: every scene's guidance carries the same per-scene targetWordCount`,
    guidance.every((g) => g.targetWordCount === expectedBudget?.wordsPerScene)
  );
  checkTrue(`${intent.preset}: targetWordCount is a positive integer`, guidance.every((g) => Number.isInteger(g.targetWordCount) && (g.targetWordCount ?? 0) > 0));
}

// ─── 3. No duration on the intent -> no length guidance ────────────────

{
  const guidance = guidanceFor(noDurationIntent);
  checkTrue(
    "no durationMinutes on the intent leaves targetWordCount undefined for every scene",
    guidance.every((g) => g.targetWordCount === undefined)
  );
}

// ─── 4. Writer prompt surfaces the per-scene length target ─────────────

for (const intent of allDurationIntents) {
  const context = contextFor(intent);
  const blueprint = blueprintFor(intent);
  const scenes = scenesFor(intent);
  const guidance = guidanceFor(intent);

  const prompt = buildWriterUserPrompt({ scene: scenes[0], guidance: guidance[0], blueprint, context, intent });
  const expectedWords = guidance[0].targetWordCount;

  checkTrue(
    `${intent.preset}: writer prompt states the per-scene length target`,
    prompt.includes(`Length target for this scene: approximately ${expectedWords} words`)
  );
}

{
  const context = contextFor(noDurationIntent);
  const blueprint = blueprintFor(noDurationIntent);
  const scenes = scenesFor(noDurationIntent);
  const guidance = guidanceFor(noDurationIntent);

  const prompt = buildWriterUserPrompt({ scene: scenes[0], guidance: guidance[0], blueprint, context, intent: noDurationIntent });

  checkTrue(
    "writer prompt omits length target guidance when no duration was requested",
    !prompt.includes("Length target for this scene")
  );
}

// ─── 5. Sleep Story 30 minutes: end-to-end sanity on scale ─────────────

{
  const scenes = scenesFor(sleepStory30MinIntent);
  const guidance = guidanceFor(sleepStory30MinIntent);
  const budget = resolveWordBudget(sleepStory30MinIntent, scenes.length)!;

  check("sleep-story 30 min: total word budget is 30 * 135", budget.totalWords, 30 * 135);
  checkTrue(
    "sleep-story 30 min: per-scene targets sum to roughly the total budget",
    Math.abs(guidance.reduce((sum, g) => sum + (g.targetWordCount ?? 0), 0) - budget.totalWords) <= scenes.length
  );
}

// ─── 6. No regression: existing GenerationGuidance shape is preserved ──

{
  const guidance = guidanceFor(narrativeIntent);
  checkTrue(
    "every guidance entry still has the full pre-existing GenerationGuidance shape",
    guidance.every(
      (g) =>
        typeof g.sceneId === "string" &&
        typeof g.writingFocus === "string" &&
        typeof g.narrativeIntent === "string" &&
        typeof g.emotionalApproach === "string" &&
        typeof g.characterGuidance === "string" &&
        typeof g.dialogueGuidance === "string" &&
        typeof g.pacingGuidance === "string" &&
        typeof g.descriptionGuidance === "string" &&
        Array.isArray(g.allowedElements) &&
        Array.isArray(g.avoidPatterns) &&
        typeof g.styleGuidance === "string" &&
        typeof g.metadata?.createdAt === "string"
    )
  );
}

// ─── Summary ─────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
