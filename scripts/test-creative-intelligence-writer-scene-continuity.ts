// scripts/test-creative-intelligence-writer-scene-continuity.ts
//
// RP-011C.8.10R2 -- Sleep Story Focus & Character Continuity.
//
// RP-011C.8.10R1 stopped the Writer from replacing a user-named central
// figure (a train conductor, a lighthouse keeper) with a generic invented
// one ("the traveler"). Live validation confirmed that fix holds scene by
// scene when each scene is inspected in isolation. What it did not cover:
// writeStoryWithProvider() calls the Writer once per scene, independently,
// with no visibility into what an earlier scene actually wrote -- so a
// character/setting/focus introduced in scene 1 has nothing concrete to
// anchor scene 3 to beyond the (short, abstract) user creative direction
// repeated at every scene. This suite locks in the fix: writeStoryWithProvider()
// now threads each scene's already-generated text forward as continuity
// context (WriteSceneWithProviderParams.previousScenesText -- see
// writer/types.ts, writer/writer.ts, writer/prompts.ts), and every writer
// prompt after the first one reflects it.
//
// This is deliberately not a character-extraction system: previousScenesText
// is raw, already-generated scene text, passed straight through with no
// parsing. Nothing here touches planning, scenes, guidance, persistent
// storage, or any preset-specific branching.
//
// Nothing here calls a provider for real, hits the database, or touches the
// active generation pipeline.
//
// Run with:  npx tsx scripts/test-creative-intelligence-writer-scene-continuity.ts

import {
  CreativeKnowledgeRegistry,
  initializeCreativeKnowledge,
  extractCreativeIntent,
  buildCreativeContext,
  buildStoryBlueprint,
  buildSceneBlueprints,
  buildGenerationGuidance,
  buildWriterUserPrompt,
  writeStoryWithProvider,
} from "../lib/creative-intelligence";
import type {
  CreativeContext,
  CreativeIntent,
  CreativeTextProvider,
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

// ─── 1. buildWriterUserPrompt: previousScenesText rendering ───────────────

{
  const prompt = "A gentle bedtime story about a lighthouse keeper watching over a quiet coastline";
  const intent = extractCreativeIntent({ prompt });
  const blueprint = blueprintFor(intent, prompt);
  const context = contextFor(intent, prompt);
  const scenes = scenesFor(intent, prompt);
  const guidance = guidanceFor(intent, prompt);

  const firstScenePrompt = buildWriterUserPrompt({
    scene: scenes[0],
    guidance: guidance[0],
    blueprint,
    context,
    intent,
  });
  checkTrue(
    "scene 1 (no previousScenesText) has no STORY SO FAR section",
    !firstScenePrompt.includes("STORY SO FAR")
  );

  const priorText = "A lighthouse keeper watches the ocean from the top of a tall white tower.";
  const secondScenePrompt = buildWriterUserPrompt({
    scene: scenes[1],
    guidance: guidance[1],
    blueprint,
    context,
    intent,
    previousScenesText: [priorText],
  });
  checkTrue("scene 2 (with previousScenesText) includes a STORY SO FAR section", secondScenePrompt.includes("STORY SO FAR"));
  checkTrue("scene 2 prompt includes the prior scene's exact text", secondScenePrompt.includes(priorText));
  checkTrue(
    "scene 2 prompt instructs the Writer to keep established elements and not introduce unrelated new ones",
    /keep every character, setting, and central focus already established/i.test(secondScenePrompt) &&
      /do not introduce a new unrelated character, place, or element/i.test(secondScenePrompt)
  );

  const thirdScenePrompt = buildWriterUserPrompt({
    scene: scenes[2],
    guidance: guidance[2],
    blueprint,
    context,
    intent,
    previousScenesText: [priorText, "The keeper lights the lamp as the fog rolls in."],
  });
  checkTrue(
    "scene 3 prompt carries forward every earlier scene's text, not just the immediately-preceding one",
    thirdScenePrompt.includes(priorText) && thirdScenePrompt.includes("The keeper lights the lamp as the fog rolls in.")
  );
}

// ─── 2. writeStoryWithProvider: sequential threading end to end ──────────
//
// A mock provider that just echoes back whatever STORY SO FAR text it was
// given (or "ORIGIN" for the first scene, which gets none) is enough to
// prove threading works without needing a real model call: if scene N's
// generated text contains everything scene N-1 handed it, continuity
// survives the whole chain by construction.

function makeEchoProvider(): CreativeTextProvider {
  return {
    async generateText(input) {
      const match = input.userPrompt.match(
        /STORY SO FAR[^\n]*:\nContinue naturally from this -- do not repeat it:\n([\s\S]*?)\nKeep every character/
      );
      const storySoFar = match ? match[1] : "ORIGIN";
      return `[[${storySoFar}]]`;
    },
  };
}

const REQUIRED_SCENARIOS: Array<{ id: string; prompt: string; anchor: string }> = [
  {
    id: "train-conductor",
    prompt: "A cozy bedtime story about a train conductor traveling through snowy mountains",
    anchor: "train conductor",
  },
  {
    id: "lighthouse-keeper",
    prompt: "A gentle bedtime story about a lighthouse keeper watching over a quiet coastline",
    anchor: "lighthouse keeper",
  },
  {
    id: "old-gardener",
    prompt: "A peaceful bedtime story about an old gardener caring for a magical garden",
    anchor: "old gardener",
  },
  {
    id: "valley-environment-only",
    prompt: "A bedtime story about walking through a peaceful valley under the stars",
    anchor: "valley",
  },
  {
    id: "ocean-journey",
    prompt: "A calming bedtime story about traveling along a peaceful coastline while listening to the waves",
    anchor: "coastline",
  },
];

async function run(): Promise<void> {
  for (const { id, prompt, anchor } of REQUIRED_SCENARIOS) {
    const intent = extractCreativeIntent({ prompt });
    const context = contextFor(intent, prompt);
    const blueprint = blueprintFor(intent, prompt);
    const scenes = scenesFor(intent, prompt);
    const guidance = guidanceFor(intent, prompt);

    const generated = await writeStoryWithProvider({
      scenes,
      guidance,
      blueprint,
      context,
      intent,
      provider: makeEchoProvider(),
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    checkTrue(`${id}: writer prompt reaches the anchor "${anchor}" verbatim`, prompt.includes(anchor));
    check(`${id}: writer produces one GeneratedScene per SceneBlueprint`, generated.length, scenes.length);
    checkTrue(`${id}: scene 1 has no continuity context (nothing precedes it)`, generated[0].text === "[[ORIGIN]]");

    for (let i = 1; i < generated.length; i++) {
      checkTrue(
        `${id}: scene ${i + 1} received every earlier scene's generated text as continuity context`,
        generated.slice(0, i).every((earlier) => generated[i].text.includes(earlier.text))
      );
    }
  }

  // Regression: other presets still run the same sequential writer without
  // errors, and their first scene is still unaffected (no continuity
  // context to carry when nothing precedes it).
  const otherPresetPrompts: CreativeIntent[] = [
    extractCreativeIntent({ prompt: "A story about a man who leaves his childhood bedroom and builds his own company." }),
    extractCreativeIntent({ prompt: "a meditation about the ocean at dawn" }),
    extractCreativeIntent({ prompt: "a story for kids about a brave little turtle", presetHint: "kids-story" }),
  ];

  for (const intent of otherPresetPrompts) {
    const context = contextFor(intent);
    const blueprint = blueprintFor(intent);
    const scenes = scenesFor(intent);
    const guidance = guidanceFor(intent);

    const generated = await writeStoryWithProvider({
      scenes,
      guidance,
      blueprint,
      context,
      intent,
      provider: makeEchoProvider(),
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    checkTrue(`${intent.preset}: sequential writer still completes without error`, generated.length === scenes.length);
    checkTrue(`${intent.preset}: first scene still has no continuity context`, generated[0].text === "[[ORIGIN]]");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
