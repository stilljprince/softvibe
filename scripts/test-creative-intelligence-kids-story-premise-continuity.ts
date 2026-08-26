// scripts/test-creative-intelligence-kids-story-premise-continuity.ts
//
// RP-011C.8.11 -- Kids Story Cross-Scene Premise & Character Continuity.
//
// Root cause: intent/classifiers.ts classifyCreativeDirection() excluded
// kids-story entirely, so a named character/premise the user actually asked
// for (e.g. "a story about a fox named Mia") was discarded before Planning
// ever saw it -- every scene's SceneBlueprint only ever referenced the
// generic PROTAGONIST_ROLE_BY_PRESET label ("a child protagonist"), and the
// pre-existing previousScenesText continuity mechanism (writer/writer.ts,
// writer/prompts.ts, see test-creative-intelligence-writer-scene-continuity.ts)
// had nothing concrete to be continuous *with* in the first place. This
// suite locks in the fix: kids-story now preserves creativeDirection like
// every other included preset, and every scene's writer prompt -- not just
// the first -- carries both the original premise (USER CREATIVE DIRECTION,
// repeated verbatim every scene) and the STORY SO FAR text from every
// earlier scene, including across a controlled scene/location change.
//
// Nothing here calls a provider for real, hits the database, or touches the
// active generation pipeline.
//
// Run with:  npx tsx scripts/test-creative-intelligence-kids-story-premise-continuity.ts

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
const createdAt = "2026-01-01T00:00:00.000Z";

function contextFor(intent: CreativeIntent, prompt: string): CreativeContext {
  return buildCreativeContext({ rawInput: { prompt }, intent, registry, createdAt });
}
function blueprintFor(intent: CreativeIntent, context: CreativeContext): StoryBlueprint {
  return buildStoryBlueprint({ intent, context, createdAt });
}
function scenesFor(intent: CreativeIntent, context: CreativeContext, blueprint: StoryBlueprint): SceneBlueprint[] {
  return buildSceneBlueprints({ intent, context, blueprint, createdAt });
}
function guidanceFor(
  scenes: SceneBlueprint[],
  blueprint: StoryBlueprint,
  context: CreativeContext,
  intent: CreativeIntent
): GenerationGuidance[] {
  return buildGenerationGuidance({ scenes, blueprint, context, intent, createdAt });
}

const PROMPT =
  "A kids story about a young fox named Mia who is nervous about her first day at Willowbrook Forest School, with her best friend Oli the owl helping her.";

const intent = extractCreativeIntent({ prompt: PROMPT });
const context = contextFor(intent, PROMPT);
const blueprint = blueprintFor(intent, context);
const scenes = scenesFor(intent, context, blueprint);
const guidance = guidanceFor(scenes, blueprint, context, intent);

// ─── 1. Intent extraction preserves the named premise ────────────────────

check("kids-story preset is inferred", intent.preset, "kids-story");
check("creativeDirection preserves the prompt verbatim", intent.creativeDirection, PROMPT);
check("scene count is unchanged (5 consolidated scenes)", scenes.length, 5);

// ─── 2. Every scene's writer prompt carries the same premise ────────────
// (this is the fix for scene 1 having nothing concrete to establish, and
// every later scene re-asserting the same premise regardless of what
// previousScenesText says -- so a scene/location change never resets it)

const scenePromptsWithNoHistory = scenes.map((scene, i) =>
  buildWriterUserPrompt({ scene, guidance: guidance[i], blueprint, context, intent })
);

checkTrue(
  "every scene's prompt includes USER CREATIVE DIRECTION",
  scenePromptsWithNoHistory.every((p) => p.includes("USER CREATIVE DIRECTION"))
);
checkTrue(
  "every scene's prompt includes the named premise verbatim",
  scenePromptsWithNoHistory.every((p) => p.includes(PROMPT))
);
checkTrue(
  "every scene's prompt includes the kids-story continuity reinforcement line",
  scenePromptsWithNoHistory.every((p) =>
    /keep the same named character\(s\), setting, and premise consistent across every scene/i.test(p)
  )
);

const allIdentical = scenePromptsWithNoHistory
  .map((p) => p.match(/USER CREATIVE DIRECTION:[\s\S]*?(?=\n\n[A-Z])/)?.[0])
  .every((section, i, arr) => section !== undefined && section === arr[0]);
checkTrue("the USER CREATIVE DIRECTION section is byte-identical across every scene", allIdentical);

// ─── 3. Full sequential run: previousScenesText chains, premise persists,
//        and a controlled scene/location change never resets it ──────────
//
// Scene 3's step ("Face a small challenge together") is where the story
// naturally could drift to a new place/situation. The mock provider below
// writes distinguishable text per scene (including one that names a new
// specific location, "the old oak clearing") so we can confirm scene 4/5
// keep both the original premise AND the location the story moved to.

function makeMockProvider(): CreativeTextProvider {
  let call = 0;
  const sceneTexts = [
    "Mia the fox trots through Willowbrook Forest School's gate, tail low, with Oli the owl perched on her shoulder.",
    "Mia and Oli meet a cheerful squirrel named Pip who shows them the acorn-counting game everyone plays at recess.",
    "In the old oak clearing, Mia worries she'll get the count wrong, but Oli reminds her it's all right to try, and Pip cheers her on.",
    "Back near the schoolhouse steps, Mia and Oli and Pip laugh about the acorn game, Mia's worry now gone.",
    "Curled up together near the schoolhouse, Mia, Oli, and Pip settle in, sleepy and glad to be friends.",
  ];
  return {
    async generateText() {
      const text = sceneTexts[call] ?? sceneTexts[sceneTexts.length - 1];
      call += 1;
      return text;
    },
  };
}

async function run(): Promise<void> {
  const provider = makeMockProvider();
  const generated = await writeStoryWithProvider({ scenes, guidance, blueprint, context, intent, provider, createdAt });

  check("writeStoryWithProvider produces one scene per planned scene", generated.length, scenes.length);

  const combined = generated.map((g) => g.text).join("\n");
  checkTrue("the named protagonist (Mia) appears in the generated story", combined.includes("Mia"));
  checkTrue("the named companion (Oli) appears in the generated story", combined.includes("Oli"));
  checkTrue(
    "a controlled location change (the old oak clearing) is present without erasing the earlier setting",
    combined.includes("old oak clearing") && combined.includes("Willowbrook")
  );
  checkTrue(
    "the story returns near the original setting after the location change (no story reset)",
    generated[3].text.includes("schoolhouse") && generated[4].text.includes("schoolhouse")
  );

  // Rebuild scene 4's actual prompt (as writeStoryWithProvider would have
  // sent it) to confirm it carried both the original premise AND the
  // location-changed previousScenesText forward together.
  const priorTexts = generated.slice(0, 3).map((g) => g.text);
  const scene4Prompt = buildWriterUserPrompt({
    scene: scenes[3],
    guidance: guidance[3],
    blueprint,
    context,
    intent,
    previousScenesText: priorTexts,
  });
  checkTrue("scene 4 prompt still includes the original named premise", scene4Prompt.includes(PROMPT));
  checkTrue("scene 4 prompt includes the STORY SO FAR section", scene4Prompt.includes("STORY SO FAR"));
  checkTrue(
    "scene 4 prompt's STORY SO FAR includes the location-changed scene 3 text",
    scene4Prompt.includes("old oak clearing")
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
