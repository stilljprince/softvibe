// scripts/test-creative-intelligence-sleep-story-scenario-aware-defaults.ts
//
// RP-011C.8.10P — Sleep Story Scenario-Aware Defaults. Regression coverage
// for the `hasExplicitScenario` signal (core/types.ts CreativeIntent) and
// the four call sites that branch on it: planning/blueprint-builder.ts
// (resolveSleepStoryProtagonist), scenes/planner.ts + scenes/templates.ts
// (SLEEP_STORY_EXPLICIT_SCENARIO_SCENE_STEPS), guidance/builder.ts
// (resolveWritingFocus, resolveCharacterGuidance), and writer/prompts.ts
// (the USER CREATIVE DIRECTION priority line).
//
// docs/sleep-story-default-bias-calibration-review.md (RP-011C.8.10O) found
// Sleep Story stacks unconditional traveler/companion/arrival defaults
// across planning, scenes, and guidance regardless of what the user asked
// for. This suite locks in that those defaults are now conditional on
// whether the user supplied a concrete creativeDirection, while leaving the
// generic sleep-story request (no concrete scenario) and every other preset
// unaffected.
//
// Nothing here touches the active generation pipeline, calls a provider, or
// hits the database.
//
// Run with:  npx tsx scripts/test-creative-intelligence-sleep-story-scenario-aware-defaults.ts

import {
  CreativeKnowledgeRegistry,
  initializeCreativeKnowledge,
  extractCreativeIntent,
  buildCreativeContext,
  buildStoryBlueprint,
  buildSceneBlueprints,
  buildGenerationGuidance,
  buildWriterUserPrompt,
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

function contextFor(intent: CreativeIntent, prompt = "test"): CreativeContext {
  return buildCreativeContext({ rawInput: { prompt }, intent, registry, createdAt: "2026-01-01T00:00:00.000Z" });
}

function blueprintFor(intent: CreativeIntent, prompt = "test"): StoryBlueprint {
  return buildStoryBlueprint({ intent, context: contextFor(intent, prompt), createdAt: "2026-01-01T00:00:00.000Z" });
}

function scenesFor(intent: CreativeIntent, prompt = "test"): SceneBlueprint[] {
  const context = contextFor(intent, prompt);
  const blueprint = blueprintFor(intent, prompt);
  return buildSceneBlueprints({ intent, context, blueprint, createdAt: "2026-01-01T00:00:00.000Z" });
}

function guidanceFor(intent: CreativeIntent, prompt = "test"): GenerationGuidance[] {
  const context = contextFor(intent, prompt);
  const blueprint = blueprintFor(intent, prompt);
  const scenes = buildSceneBlueprints({ intent, context, blueprint, createdAt: "2026-01-01T00:00:00.000Z" });
  return buildGenerationGuidance({ scenes, blueprint, context, intent, createdAt: "2026-01-01T00:00:00.000Z" });
}

function userPromptsFor(intent: CreativeIntent, prompt = "test"): string[] {
  const context = contextFor(intent, prompt);
  const blueprint = blueprintFor(intent, prompt);
  const scenes = scenesFor(intent, prompt);
  const guidance = guidanceFor(intent, prompt);
  return scenes.map((scene) => {
    const sceneGuidance = guidance.find((g) => g.sceneId === scene.id)!;
    return buildWriterUserPrompt({ scene, guidance: sceneGuidance, blueprint, context, intent });
  });
}

// ─── 1. hasExplicitScenario signal (intent/classifiers.ts) ────────────────

{
  const valley = extractCreativeIntent({ prompt: "A bedtime story about walking through a peaceful valley under the stars" });
  check("sleep-story with a concrete scenario sets hasExplicitScenario", valley.hasExplicitScenario, true);

  const generic = extractCreativeIntent({ prompt: "A relaxing sleep story to help me fall asleep" });
  check(
    "generic sleep-story request still resolves to sleep-story",
    generic.preset,
    "sleep-story"
  );

  const meditation = extractCreativeIntent({ prompt: "a meditation about the ocean at dawn" });
  check("meditation never sets hasExplicitScenario", meditation.hasExplicitScenario, undefined);

  const narrative = extractCreativeIntent({
    prompt: "A story about a man who leaves his childhood bedroom and builds his own company.",
  });
  check(
    "narrative has creativeDirection but never sets hasExplicitScenario (sleep-story-only signal)",
    narrative.hasExplicitScenario,
    undefined
  );
  checkTrue("narrative creativeDirection is still preserved", typeof narrative.creativeDirection === "string");

  const asmrStory = extractCreativeIntent({ prompt: "ASMR librarian roleplay reading me a book" });
  check(
    "classic-asmr story mode has creativeDirection but never sets hasExplicitScenario",
    asmrStory.hasExplicitScenario,
    undefined
  );

  const kidsStory = extractCreativeIntent({ prompt: "a story for kids about a brave little turtle", presetHint: "kids-story" });
  check("kids-story never sets hasExplicitScenario", kidsStory.hasExplicitScenario, undefined);
}

// Manually-constructed intents (no creativeDirection/hasExplicitScenario)
// exercise the pre-existing generic-default code paths -- mirrors how the
// other creative-intelligence test suites build fixtures.
const genericSleepStoryIntent: CreativeIntent = {
  preset: "sleep-story",
  experience: "a relaxing bedtime story to help the listener fall asleep",
  audience: "adult",
  durationMinutes: 30,
  constraints: [],
  storyScale: "gentle_journey",
  emotionalDirection: ["calm", "safe"],
};

// ─── 2. Explicit-scenario cases end to end ─────────────────────────────────
//
// RP-011C.8.10R1 adds the train-conductor and old-gardener prompts below: a
// scenario that already names a central figure must still pass every
// anti-default assertion the no-named-figure scenarios (valley, coastline)
// pass -- this loop is deliberately shared so a named figure never
// reintroduces the old mandatory-traveler/companion/arrival shape.

const explicitScenarioPrompts = [
  "A bedtime story about walking through a peaceful valley under the stars",
  "A cozy bedtime story about a train through snowy mountains",
  "A calming bedtime story about a quiet coastline",
  "A bedtime story about a train conductor traveling through snowy mountains",
  "A bedtime story about an old gardener caring for a magical garden",
];

for (const prompt of explicitScenarioPrompts) {
  const intent = extractCreativeIntent({ prompt });
  const blueprint = blueprintFor(intent, prompt);
  const scenes = scenesFor(intent, prompt);
  const guidance = guidanceFor(intent, prompt);
  const prompts = userPromptsFor(intent, prompt);
  const combined = prompts.join("\n---\n");

  check(`"${prompt}" resolves to sleep-story`, intent.preset, "sleep-story");
  check(`"${prompt}" sets hasExplicitScenario`, intent.hasExplicitScenario, true);

  checkTrue(
    `"${prompt}": protagonist role does not hardcode "a gentle traveler the listener follows"`,
    blueprint.protagonist.role !== "a gentle traveler the listener follows"
  );
  checkTrue(
    `"${prompt}": protagonist.need does not mandate companions`,
    !/warm, welcoming world and companions/i.test(blueprint.protagonist.need)
  );
  checkTrue(
    `"${prompt}": protagonist.initialState does not mandate "arriving"`,
    !/^arriving in a peaceful place/i.test(blueprint.protagonist.initialState)
  );

  checkTrue(`"${prompt}": scene structure is still fixed at 5 scenes`, scenes.length === 5);
  checkTrue(
    `"${prompt}": opening scene is not the mandatory "Arrival"/"Welcome" pattern`,
    scenes[0].narrativeFunction !== "Arrival" && !/^Welcome /.test(scenes[0].purpose)
  );
  checkTrue(
    `"${prompt}": settling scene does not mandate "a companion or gentle host may offer quiet welcome"`,
    !/a companion or gentle host may offer quiet welcome/i.test(scenes[1].settingGuidance)
  );

  checkTrue(
    `"${prompt}": characterGuidance frames the story world's focus as optional, not "and any companions"`,
    guidance.every((g) => /story world's focus/i.test(g.characterGuidance) && /optional/i.test(g.characterGuidance))
  );
  checkTrue(
    `"${prompt}": writingFocus does not hardcode the fixed protagonist role`,
    guidance.every((g) => !g.writingFocus.includes(blueprint.protagonist.role) || g.writingFocus.includes("story world's focus"))
  );

  checkTrue(
    `"${prompt}": writer prompt carries the scenario verbatim`,
    combined.includes(prompt)
  );
  checkTrue(
    `"${prompt}": writer prompt states creative direction overrides the optional Sleep Story defaults`,
    /overrides the optional Sleep Story defaults/i.test(combined)
  );
  checkTrue(
    `"${prompt}": writer prompt tells the Writer not to introduce a traveler/companion/host/ritual unless it fits`,
    /Do not introduce a traveler, companion, host, welcome ritual/i.test(combined)
  );
  checkTrue(
    `"${prompt}": writer prompt tells the Writer to keep a named figure instead of substituting a generic one`,
    /keep them as the protagonist -- do not replace them with an invented generic figure/i.test(combined)
  );
}

// ─── 3. Scenario-specific focus survives (valley / train / coastline) ─────

{
  const valleyPrompt = "A bedtime story about walking through a peaceful valley under the stars";
  const valleyPrompts = userPromptsFor(extractCreativeIntent({ prompt: valleyPrompt }), valleyPrompt);
  checkTrue("valley scenario text reaches the writer prompt", valleyPrompts.join("\n").includes("valley"));

  const trainPrompt = "A cozy bedtime story about a train through snowy mountains";
  const trainPrompts = userPromptsFor(extractCreativeIntent({ prompt: trainPrompt }), trainPrompt);
  checkTrue("train scenario text reaches the writer prompt", trainPrompts.join("\n").includes("train"));

  const coastlinePrompt = "A calming bedtime story about a quiet coastline";
  const coastlinePrompts = userPromptsFor(extractCreativeIntent({ prompt: coastlinePrompt }), coastlinePrompt);
  checkTrue("coastline scenario text reaches the writer prompt", coastlinePrompts.join("\n").includes("coastline"));

  // RP-011C.8.10R1: a scenario that names a central figure (a train
  // conductor, an old gardener) must reach the Writer the same way a
  // figure-less scenario (valley, coastline) does above -- the calibration
  // adds a "don't substitute" instruction, it does not parse the figure out
  // into a separate field, so the only place this figure is guaranteed to
  // reach the Writer is the creative direction text itself.
  const conductorPrompt = "A bedtime story about a train conductor traveling through snowy mountains";
  const conductorPrompts = userPromptsFor(extractCreativeIntent({ prompt: conductorPrompt }), conductorPrompt);
  checkTrue(
    "train conductor scenario text reaches the writer prompt",
    conductorPrompts.join("\n").includes("train conductor")
  );

  const gardenerPrompt = "A bedtime story about an old gardener caring for a magical garden";
  const gardenerPrompts = userPromptsFor(extractCreativeIntent({ prompt: gardenerPrompt }), gardenerPrompt);
  checkTrue(
    "old gardener character text reaches the writer prompt",
    gardenerPrompts.join("\n").includes("old gardener")
  );
}

// ─── 4. Generic Sleep Story case: defaults may still apply ────────────────

{
  const genericPrompt = "A relaxing sleep story to help me fall asleep";
  const intent = extractCreativeIntent({ prompt: genericPrompt });
  const blueprint = blueprintFor(intent, genericPrompt);
  const scenes = scenesFor(intent, genericPrompt);
  const guidance = guidanceFor(intent, genericPrompt);

  checkTrue(
    "generic sleep-story request still produces a non-empty protagonist role",
    typeof blueprint.protagonist.role === "string" && blueprint.protagonist.role.length > 0
  );
  checkTrue("generic sleep-story request still produces a fixed 5-scene structure", scenes.length === 5);
  checkTrue(
    "generic sleep-story request still produces character guidance (world/character structure allowed)",
    guidance.every((g) => typeof g.characterGuidance === "string" && g.characterGuidance.length > 0)
  );
  checkTrue(
    "generic sleep-story request does not force the literal word traveler into the protagonist role",
    !/traveler/i.test(blueprint.protagonist.role)
  );
  checkTrue(
    "generic sleep-story request no longer offers 'a character, place, or atmosphere' as an enumerated menu",
    !/a character, place, or atmosphere/i.test(blueprint.protagonist.role)
  );
}

// ─── 5. No-creativeDirection sleep-story fixtures keep the original ───────
//        traveler/companion/arrival defaults (backward compatible) ─────────

{
  const blueprint = blueprintFor(genericSleepStoryIntent);
  check(
    "sleep-story intent without creativeDirection keeps the original protagonist role",
    blueprint.protagonist.role,
    "a gentle traveler the listener follows"
  );
  checkTrue(
    "sleep-story intent without creativeDirection keeps the original companions need",
    /warm, welcoming world and companions/i.test(blueprint.protagonist.need)
  );

  const scenes = scenesFor(genericSleepStoryIntent);
  check(
    "sleep-story intent without creativeDirection keeps the original 5-scene arrival-first structure",
    scenes.map((s) => s.narrativeFunction).join(" -> "),
    ["Arrival", "Settling", "Gentle exploration", "Deeper immersion", "Gradual rest"].join(" -> ")
  );

  const guidance = guidanceFor(genericSleepStoryIntent);
  checkTrue(
    "sleep-story intent without creativeDirection keeps the original 'and any companions' characterGuidance",
    guidance.every((g) => /and any companions offer quiet, familiar presence/i.test(g.characterGuidance))
  );

  const prompts = userPromptsFor(genericSleepStoryIntent);
  checkTrue(
    "sleep-story intent without creativeDirection never adds the new priority line (no creativeDirection to prioritize)",
    prompts.every((p) => !p.includes("USER CREATIVE DIRECTION"))
  );
}

// ─── 6. Regression: other presets unaffected ──────────────────────────────

{
  const narrativeIntent: CreativeIntent = extractCreativeIntent({
    prompt: "A story about a man who leaves his childhood bedroom and builds his own company.",
  });
  const classicAsmrIntent: CreativeIntent = extractCreativeIntent({ prompt: "ASMR librarian roleplay reading me a book" });
  const meditationIntent: CreativeIntent = extractCreativeIntent({ prompt: "a meditation about the ocean at dawn" });
  const kidsStoryIntent: CreativeIntent = extractCreativeIntent({
    prompt: "a story for kids about a brave little turtle",
    presetHint: "kids-story",
  });

  for (const intent of [narrativeIntent, classicAsmrIntent, meditationIntent, kidsStoryIntent]) {
    const blueprint = blueprintFor(intent);
    const scenes = scenesFor(intent);
    const guidance = guidanceFor(intent);
    checkTrue(`${intent.preset}: blueprint still builds successfully`, typeof blueprint.protagonist.role === "string");
    checkTrue(`${intent.preset}: scenes still build successfully`, scenes.length > 0);
    checkTrue(`${intent.preset}: guidance still builds successfully`, guidance.length === scenes.length);
  }

  checkTrue(
    "narrative writer prompt never adds the sleep-story-only priority line",
    userPromptsFor(narrativeIntent).every((p) => !/overrides the optional Sleep Story defaults/i.test(p))
  );
  checkTrue(
    "classic-asmr writer prompt never adds the sleep-story-only priority line",
    userPromptsFor(classicAsmrIntent).every((p) => !/overrides the optional Sleep Story defaults/i.test(p))
  );
}

// ─── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
