// scripts/test-creative-intelligence-sleep-story-protagonist-presence-calibration.ts
//
// RP-011C.8.10V — Sleep Story Protagonist Presence Calibration.
//
// docs/sleep-story-end-to-end-quality-final-rebenchmark-report.md
// (RP-011C.8.10U) found that RP-011C.8.10R1's "do not replace a named
// figure with a generic traveler" instruction stopped substitution, but
// the Writer overcorrected the other way: it sometimes removed an
// established figure entirely, producing agentless passive prose ("A cup
// was taken down from a shelf") or bodyless description ("the hands",
// "the walking") instead of keeping the figure the creative direction
// named. This suite is presence/fidelity coverage, not general character
// quality scoring: it checks that (a) a figure the creative direction
// establishes still reaches the Writer prompt with an instruction not to
// remove or abstract it away, and (b) environment-only scenarios are not
// forced into having a protagonist. It deliberately does not score
// generated prose (no live provider calls) or add a generic
// character-development criterion -- both are out of scope for this
// calibration task.
//
// Nothing here touches the active generation pipeline, calls a provider, or
// hits the database.
//
// Run with:  npx tsx scripts/test-creative-intelligence-sleep-story-protagonist-presence-calibration.ts

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

function checkTrue(name: string, condition: boolean): void {
  if (condition) {
    console.log(`[PASS] ${name}`);
    passed++;
  } else {
    console.log(`[FAIL] ${name}`);
    failed++;
  }
}

const registry = new CreativeKnowledgeRegistry();
initializeCreativeKnowledge(registry);

function contextFor(intent: CreativeIntent, prompt: string): CreativeContext {
  return buildCreativeContext({ rawInput: { prompt }, intent, registry, createdAt: "2026-01-01T00:00:00.000Z" });
}

function blueprintFor(intent: CreativeIntent, prompt: string): StoryBlueprint {
  return buildStoryBlueprint({ intent, context: contextFor(intent, prompt), createdAt: "2026-01-01T00:00:00.000Z" });
}

function scenesFor(intent: CreativeIntent, prompt: string): SceneBlueprint[] {
  const context = contextFor(intent, prompt);
  const blueprint = blueprintFor(intent, prompt);
  return buildSceneBlueprints({ intent, context, blueprint, createdAt: "2026-01-01T00:00:00.000Z" });
}

function guidanceFor(intent: CreativeIntent, prompt: string): GenerationGuidance[] {
  const context = contextFor(intent, prompt);
  const blueprint = blueprintFor(intent, prompt);
  const scenes = buildSceneBlueprints({ intent, context, blueprint, createdAt: "2026-01-01T00:00:00.000Z" });
  return buildGenerationGuidance({ scenes, blueprint, context, intent, createdAt: "2026-01-01T00:00:00.000Z" });
}

function writerPromptsFor(prompt: string): { intent: CreativeIntent; blueprint: StoryBlueprint; combined: string } {
  const intent = extractCreativeIntent({ prompt });
  const context = contextFor(intent, prompt);
  const blueprint = blueprintFor(intent, prompt);
  const scenes = scenesFor(intent, prompt);
  const guidance = guidanceFor(intent, prompt);
  const combined = scenes
    .map((scene) => {
      const sceneGuidance = guidance.find((g) => g.sceneId === scene.id)!;
      return buildWriterUserPrompt({ scene, guidance: sceneGuidance, blueprint, context, intent });
    })
    .join("\n---\n");
  return { intent, blueprint, combined };
}

// ─── 1. Named-role scenarios: figure must reach the Writer with a ────────
//        "do not remove/abstract" instruction, alongside the existing
//        "do not substitute" instruction (RP-011C.8.10R1) ────────────────

const namedFigureCases = [
  { label: "train conductor", prompt: "A cozy sleep story about a train conductor traveling through snowy mountains", figure: "train conductor" },
  { label: "lighthouse keeper", prompt: "A calming bedtime story about a lighthouse keeper watching over the coast during a quiet night", figure: "lighthouse keeper" },
  { label: "old gardener", prompt: "A bedtime story about an old gardener caring for a magical garden", figure: "old gardener" },
];

for (const { label, prompt, figure } of namedFigureCases) {
  const { intent, combined } = writerPromptsFor(prompt);

  checkTrue(`${label}: resolves to sleep-story`, intent.preset === "sleep-story");
  checkTrue(`${label}: sets hasExplicitScenario`, intent.hasExplicitScenario === true);
  checkTrue(`${label}: the named figure reaches the writer prompt verbatim`, combined.includes(figure));

  // RP-011C.8.10R1 protection: still present, still passing.
  checkTrue(
    `${label}: writer prompt still tells the Writer not to substitute a generic figure (no regression of traveler-bias fix)`,
    /keep them as the protagonist -- do not replace them with an invented generic figure/i.test(combined)
  );

  // RP-011C.8.10V protection: the new removal/abstraction instruction.
  checkTrue(
    `${label}: writer prompt tells the Writer not to remove or abstract an established figure`,
    /keep that figure present throughout every scene -- do not remove them/i.test(combined) &&
      /do not abstract that figure into passive constructions/i.test(combined) &&
      /do not reduce that figure to disembodied description/i.test(combined)
  );

  // Reinforcement in guidance text (WRITING GUIDANCE section), not just the
  // creative-direction block.
  checkTrue(
    `${label}: writing focus guidance carries the "never dissolving... into passive or bodyless description" reinforcement`,
    /never dissolving an established figure into passive or bodyless description/i.test(combined)
  );
  checkTrue(
    `${label}: character guidance carries the "never removing or abstracting an established figure" reinforcement`,
    /never removing or abstracting an established figure into passive description/i.test(combined)
  );
}

// ─── 2. Environment-only scenarios: no forced protagonist ─────────────────
//        (RP-011C.8.10P/R1 behavior must hold: these still get the neutral
//        "story's own central figure or focus" pointer, not a literal
//        forced character, and never the hardcoded "gentle traveler")

const environmentOnlyCases = [
  { label: "valley under stars", prompt: "A peaceful bedtime story about walking through a quiet valley beneath the stars" },
  { label: "ocean journey", prompt: "A gentle sleep story about drifting along a peaceful ocean under moonlight" },
];

for (const { label, prompt } of environmentOnlyCases) {
  const { intent, blueprint, combined } = writerPromptsFor(prompt);

  checkTrue(`${label}: resolves to sleep-story`, intent.preset === "sleep-story");
  checkTrue(`${label}: sets hasExplicitScenario`, intent.hasExplicitScenario === true);

  checkTrue(
    `${label}: protagonist role is the neutral pointer, not a forced character or the hardcoded traveler`,
    blueprint.protagonist.role === "the story's own central figure or focus, exactly as the user's creative direction describes it"
  );
  checkTrue(
    `${label}: writer prompt does not hardcode "a gentle traveler"`,
    !/a gentle traveler the listener follows/i.test(combined)
  );
  checkTrue(
    `${label}: writer prompt still tells the Writer not to introduce an unrequested traveler/companion/host`,
    /Do not introduce a traveler, companion, host, welcome ritual/i.test(combined)
  );

  // The removal/abstraction instruction is scenario-fidelity text, not a
  // character mandate -- it still appears (it's gated on hasExplicitScenario,
  // not on whether a figure was detected), but it is conditional ("if the
  // creative direction establishes...") and must not be paired with any
  // fabricated figure requirement for a scenario that names none.
  checkTrue(
    `${label}: removal/abstraction instruction is present but conditional, not a mandate to invent a figure`,
    /If the creative direction establishes a person, role, or meaningful figure/i.test(combined)
  );
  checkTrue(
    `${label}: writer prompt never mandates companions for an environment-only scenario`,
    !/warm, welcoming world and companions/i.test(combined)
  );
}

// ─── 3. Generic sleep story: unaffected, defaults still apply ────────────

{
  const prompt = "A relaxing sleep story to help me fall asleep";
  const { intent, blueprint, combined } = writerPromptsFor(prompt);

  checkTrue("generic sleep story: resolves to sleep-story", intent.preset === "sleep-story");
  checkTrue(
    "generic sleep story: still produces a non-empty protagonist role",
    typeof blueprint.protagonist.role === "string" && blueprint.protagonist.role.length > 0
  );
  checkTrue(
    "generic sleep story: does not force the literal word traveler when hasExplicitScenario is false",
    intent.hasExplicitScenario ? true : !/traveler/i.test(blueprint.protagonist.role)
  );
  checkTrue(
    "generic sleep story: writer prompt does not add the RP-011C.8.10V removal/abstraction line when there is no creativeDirection to gate it on",
    intent.creativeDirection ? true : !combined.includes("USER CREATIVE DIRECTION")
  );
}

// ─── 4. Regression: other presets never receive the new sleep-story-only ──
//        removal/abstraction instruction ───────────────────────────────────

{
  const narrativeIntent = extractCreativeIntent({
    prompt: "A story about a man who leaves his childhood bedroom and builds his own company.",
  });
  const meditationIntent = extractCreativeIntent({ prompt: "a meditation about the ocean at dawn" });
  const classicAsmrIntent = extractCreativeIntent({ prompt: "ASMR librarian roleplay reading me a book" });

  for (const intent of [narrativeIntent, meditationIntent, classicAsmrIntent]) {
    const scenes = scenesFor(intent, "test");
    const guidance = guidanceFor(intent, "test");
    const context = contextFor(intent, "test");
    const blueprint = blueprintFor(intent, "test");
    const combined = scenes
      .map((scene) => {
        const sceneGuidance = guidance.find((g) => g.sceneId === scene.id)!;
        return buildWriterUserPrompt({ scene, guidance: sceneGuidance, blueprint, context, intent });
      })
      .join("\n---\n");
    checkTrue(
      `${intent.preset}: never receives the sleep-story-only removal/abstraction instruction`,
      !/keep that figure present throughout every scene -- do not remove them/i.test(combined)
    );
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
