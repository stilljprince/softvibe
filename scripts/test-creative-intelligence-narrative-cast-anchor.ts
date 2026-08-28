// scripts/test-creative-intelligence-narrative-cast-anchor.ts
//
// RP-011C.8D -- Narrative Pre-Cutover Minimal Capability Patch: Cast
// Identity Anchor. Regression coverage for the narrative-only writer
// instruction that stops two explicitly different user-requested characters
// from being accidentally merged into one person over a long story (the
// failure mode found in the RP-011C.8B longform legacy-vs-CI benchmark),
// without freezing relationship state (trust, betrayal, alliance, romance,
// hostility, and similar shifts must remain fully expressible).
//
// Nothing here calls a provider for real, hits the database, or touches the
// active generation pipeline.
//
// Run with:  npx tsx scripts/test-creative-intelligence-narrative-cast-anchor.ts

import {
  CreativeKnowledgeRegistry,
  initializeCreativeKnowledge,
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

function promptFor(intent: CreativeIntent, prompt = "test"): string {
  const context = contextFor(intent, prompt);
  const blueprint = blueprintFor(intent, prompt);
  const scenes = scenesFor(intent, prompt);
  const guidance = guidanceFor(intent, prompt);
  return buildWriterUserPrompt({ scene: scenes[0], guidance: guidance[0], blueprint, context, intent });
}

const twoCharacterDirection =
  "The story follows Mara, a former locksmith, and her estranged brother Daniel, a city inspector who suspects her of a crime he must now investigate.";

const threeCharacterDirection =
  "The story follows Mara, a former locksmith; her estranged brother Daniel, a city inspector; and Rosa, an old friend of Mara's who now works for Daniel.";

function narrativeIntentWithDirection(creativeDirection: string): CreativeIntent {
  return {
    preset: "narrative",
    experience: "an immersive narrative built around the listener's request",
    audience: "adult",
    durationMinutes: 25,
    constraints: [],
    storyScale: "arc",
    themes: ["trust", "betrayal"],
    creativeDirection,
  };
}

function otherPresetIntentWithDirection(
  preset: "sleep-story" | "meditation" | "classic-asmr",
  creativeDirection: string
): CreativeIntent {
  const base: Record<typeof preset, CreativeIntent> = {
    "sleep-story": {
      preset: "sleep-story",
      experience: "a relaxing bedtime story to help the listener fall asleep",
      audience: "adult",
      durationMinutes: 25,
      constraints: [],
      storyScale: "gentle_journey",
      emotionalDirection: ["calm", "safe"],
      creativeDirection,
      hasExplicitScenario: true,
    },
    meditation: {
      preset: "meditation",
      experience: "a guided meditation for centering attention",
      audience: "adult",
      durationMinutes: 25,
      constraints: [],
      creativeDirection,
    },
    "classic-asmr": {
      preset: "classic-asmr",
      experience: "a slow, sensory-focused ASMR session",
      audience: "adult",
      durationMinutes: 25,
      constraints: [],
      creativeDirection,
    },
  } as Record<typeof preset, CreativeIntent>;
  return base[preset];
}

const kidsStoryIntent: CreativeIntent = {
  preset: "kids-story",
  experience: "a gentle, age-safe bedtime story for children",
  audience: "child",
  durationMinutes: 8,
  constraints: ["age-safe: avoid violence, horror, and existential themes"],
  storyScale: "gentle_journey",
  themes: ["friendship"],
  requiredElements: ["gentle_pacing", "safe_resolution", "positive_resolution", "age_safe_language"],
  creativeDirection: "A story about a rabbit named Pip and a fox named Otto who become friends.",
};

// ─── 1. narrative + two explicit characters: Cast Anchor appears ─────────

{
  const intent = narrativeIntentWithDirection(twoCharacterDirection);
  const prompt = promptFor(intent);

  checkTrue(
    "narrative + two-character creative direction: Cast Anchor instruction appears in the writer prompt",
    /keep each of them recognizable as a separate individual/i.test(prompt)
  );
  checkTrue("Cast Anchor instructs against merging distinct figures", /do not merge two explicitly different figures into one/i.test(prompt));
}

// ─── 2. narrative + three characters: instruction stays generic, no fixed relationship state ──

{
  const intent = narrativeIntentWithDirection(threeCharacterDirection);
  const prompt = promptFor(intent);

  checkTrue(
    "narrative + three-character creative direction: Cast Anchor still appears",
    /keep each of them recognizable as a separate individual/i.test(prompt)
  );
  checkTrue(
    "Cast Anchor text is a single generic instruction, not per-character/relationship-specific rules",
    prompt.match(/do not merge two explicitly different figures into one\./gi)?.length === 1
  );
  checkTrue(
    "Cast Anchor does not assert any specific fixed relationship (e.g. 'must remain allies')",
    !/must (remain|stay) (allies|enemies|friends|partners)/i.test(prompt)
  );
}

// ─── 3. Prompt never says relationships must stay unchanged ─────────────

for (const direction of [twoCharacterDirection, threeCharacterDirection]) {
  const intent = narrativeIntentWithDirection(direction);
  const prompt = promptFor(intent);

  checkTrue(
    `narrative Cast Anchor prompt (direction: "${direction.slice(0, 24)}...") never states relationships must remain unchanged`,
    !/relationships? (must|should) remain unchanged/i.test(prompt) && !/keep relationships? consistent/i.test(prompt)
  );
}

// ─── 4. Relationship evolution stays explicitly allowed ──────────────────

{
  const intent = narrativeIntentWithDirection(twoCharacterDirection);
  const prompt = promptFor(intent);

  checkTrue(
    "Cast Anchor explicitly allows relationship evolution (trust/betrayal/alliance/romance/hostility/reconciliation)",
    /trust, betrayal, alliance, romance, hostility, reconciliation/i.test(prompt)
  );
  checkTrue(
    "Cast Anchor explicitly allows departure, death, and new arrivals",
    /departure, death, and new arrivals/i.test(prompt)
  );
  checkTrue(
    "Cast Anchor explicitly frames identity continuity as distinct from frozen relationship state",
    /preserve identity, not fixed relationships/i.test(prompt)
  );
}

// ─── 5. kids-story's existing character-continuity rule is unchanged ─────

{
  const prompt = promptFor(kidsStoryIntent);
  checkTrue(
    "kids-story keeps its pre-existing character-continuity instruction",
    prompt.includes(
      "Keep the same named character(s), setting, and premise consistent across every scene -- do not introduce different characters, a different place, or an unrelated new premise partway through."
    )
  );
  checkTrue(
    "kids-story does not receive narrative's Cast Anchor instruction",
    !/keep each of them recognizable as a separate individual/i.test(prompt)
  );
}

// ─── 6. sleep-story / meditation / classic-asmr do NOT receive the Cast Anchor ──

{
  const sleepStoryIntent = otherPresetIntentWithDirection("sleep-story", twoCharacterDirection);
  const meditationIntent = otherPresetIntentWithDirection("meditation", twoCharacterDirection);
  const classicAsmrIntent = otherPresetIntentWithDirection("classic-asmr", twoCharacterDirection);

  for (const intent of [sleepStoryIntent, meditationIntent, classicAsmrIntent]) {
    const prompt = promptFor(intent);
    checkTrue(
      `${intent.preset}: does not receive narrative's Cast Anchor instruction even with a two-character creative direction`,
      !/keep each of them recognizable as a separate individual/i.test(prompt) &&
        !/do not merge two explicitly different figures into one/i.test(prompt)
    );
  }
}

// ─── 7. narrative without creativeDirection: no Cast Anchor (nothing to anchor) ──

{
  const intent: CreativeIntent = {
    preset: "narrative",
    experience: "an immersive narrative built around the listener's request",
    audience: "adult",
    durationMinutes: 25,
    constraints: [],
    storyScale: "arc",
    themes: ["courage"],
  };
  const prompt = promptFor(intent);
  checkTrue(
    "narrative without creativeDirection: no USER CREATIVE DIRECTION section, so no Cast Anchor either",
    !prompt.includes("USER CREATIVE DIRECTION") && !/keep each of them recognizable as a separate individual/i.test(prompt)
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
