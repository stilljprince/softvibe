// scripts/test-creative-intelligence-writer-provider.ts
//
// RP-011C.8.5 — Isolated tests for the Narrative Writer Layer's
// provider-backed capability (lib/creative-intelligence/writer/provider.ts,
// prompts.ts, and the writeSceneWithProvider()/writeStoryWithProvider()
// additions to writer.ts). Every test here uses a mocked
// CreativeTextProvider -- nothing in this file makes a real OpenAI call,
// touches the active generation pipeline, or hits the database.
//
// Run with:  npx tsx scripts/test-creative-intelligence-writer-provider.ts

import fs from "node:fs";
import path from "node:path";
import {
  CreativeKnowledgeRegistry,
  initializeCreativeKnowledge,
  buildCreativeContext,
  buildStoryBlueprint,
  buildSceneBlueprints,
  buildGenerationGuidance,
  writeScene,
  writeStory,
  writeSceneWithProvider,
  writeStoryWithProvider,
  buildWriterPrompt,
  buildWriterSystemPrompt,
  buildWriterUserPrompt,
  createOpenAICreativeTextProvider,
} from "../lib/creative-intelligence";
import type {
  CreativeContext,
  CreativeIntent,
  CreativeTextProvider,
  CreativeTextProviderInput,
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

const narrativeArcIntent: CreativeIntent = {
  preset: "narrative",
  experience: "an immersive narrative built around the listener's request",
  audience: "adult",
  durationMinutes: 20,
  constraints: ["no explicit violence"],
  storyScale: "arc",
  themes: ["courage"],
  tone: "warm and hopeful",
};

const sleepStoryIntent: CreativeIntent = {
  preset: "sleep-story",
  experience: "a relaxing bedtime story to help the listener fall asleep",
  audience: "adult",
  durationMinutes: 30,
  constraints: [],
  storyScale: "gentle_journey",
  emotionalDirection: ["calm", "safe"],
};

const allIntents = [narrativeArcIntent, sleepStoryIntent];

// A simple, fully deterministic mock provider -- records every call it
// receives so tests can assert on exactly what the Writer Layer sent it.
class MockProvider implements CreativeTextProvider {
  calls: CreativeTextProviderInput[] = [];
  private readonly responseText: string;

  constructor(responseText = "Mock generated text.") {
    this.responseText = responseText;
  }

  async generateText(input: CreativeTextProviderInput): Promise<string> {
    this.calls.push(input);
    return this.responseText;
  }
}

async function main(): Promise<void> {
  // ─── 1. Prompt builder receives all required upstream data ────────────

  {
    const scenes = scenesFor(narrativeArcIntent);
    const guidance = guidanceFor(narrativeArcIntent);
    const context = contextFor(narrativeArcIntent);
    const blueprint = blueprintFor(narrativeArcIntent);
    const scene = scenes[0];
    const sceneGuidance = guidance.find((g) => g.sceneId === scene.id)!;

    const prompt = buildWriterPrompt({
      scene,
      guidance: sceneGuidance,
      blueprint,
      context,
      intent: narrativeArcIntent,
    });

    checkTrue("buildWriterPrompt returns a systemPrompt and userPrompt", typeof prompt.systemPrompt === "string" && typeof prompt.userPrompt === "string");

    const system = buildWriterSystemPrompt(narrativeArcIntent);
    checkTrue("system prompt references the preset", system.includes(narrativeArcIntent.preset));

    const user = buildWriterUserPrompt({ scene, guidance: sceneGuidance, blueprint, context, intent: narrativeArcIntent });
    checkTrue("user prompt includes the CreativeIntent's experience", user.includes(narrativeArcIntent.experience));
    checkTrue("user prompt includes the CreativeIntent's tone", user.includes(narrativeArcIntent.tone!));
    checkTrue("user prompt includes the CreativeIntent's constraints", user.includes(narrativeArcIntent.constraints[0]));
    checkTrue("user prompt includes the StoryBlueprint's central question", user.includes(blueprint.premise.centralQuestion));
    checkTrue("user prompt includes the StoryBlueprint's core conflict", user.includes(blueprint.premise.coreConflict));
    checkTrue("user prompt includes the SceneBlueprint's purpose", user.includes(scene.purpose));
    checkTrue("user prompt includes the SceneBlueprint's desired change", user.includes(scene.desiredChange));
    checkTrue("user prompt includes the GenerationGuidance's writingFocus", user.includes(sceneGuidance.writingFocus));
    checkTrue("user prompt includes the GenerationGuidance's dialogueGuidance", user.includes(sceneGuidance.dialogueGuidance));
    if (context.guidance.generation.length > 0) {
      checkTrue(
        "user prompt includes the CreativeContext's generation-stage knowledge",
        user.includes(context.guidance.generation[0])
      );
    }
  }

  // ─── 1b. User creative direction is surfaced in the writer prompt (RP-011C.8.8.4A) ──

  {
    const intentWithDirection: CreativeIntent = {
      ...narrativeArcIntent,
      creativeDirection: "A close friend reads me a few pages from a favorite book, librarian roleplay style.",
    };

    const scenes = scenesFor(intentWithDirection);
    const guidance = guidanceFor(intentWithDirection);
    const context = contextFor(intentWithDirection);
    const blueprint = blueprintFor(intentWithDirection);
    const scene = scenes[0];
    const sceneGuidance = guidance.find((g) => g.sceneId === scene.id)!;

    const user = buildWriterUserPrompt({ scene, guidance: sceneGuidance, blueprint, context, intent: intentWithDirection });
    checkTrue(
      "user prompt surfaces intent.creativeDirection verbatim when present",
      user.includes(intentWithDirection.creativeDirection!)
    );
    checkTrue(
      "user prompt instructs the writer to respect the creative direction",
      /respect this direction/i.test(user)
    );

    const userWithout = buildWriterUserPrompt({ scene, guidance: sceneGuidance, blueprint, context, intent: narrativeArcIntent });
    checkTrue(
      "user prompt omits the creative direction section when intent.creativeDirection is unset",
      !/USER CREATIVE DIRECTION/.test(userWithout)
    );
  }

  // ─── 2/3. Writer calls the provider abstraction; provider is mockable ──

  {
    const scenes = scenesFor(narrativeArcIntent);
    const guidance = guidanceFor(narrativeArcIntent);
    const context = contextFor(narrativeArcIntent);
    const blueprint = blueprintFor(narrativeArcIntent);
    const provider = new MockProvider("A calm, generated opening scene.");

    const generated = await writeSceneWithProvider({
      scene: scenes[0],
      guidance: guidance.find((g) => g.sceneId === scenes[0].id)!,
      blueprint,
      context,
      intent: narrativeArcIntent,
      provider,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    check("provider.generateText was called exactly once", provider.calls.length, 1);
    check("writeSceneWithProvider returns the provider's text verbatim", generated.text, "A calm, generated opening scene.");
    check("writeSceneWithProvider output sceneId matches the input scene", generated.sceneId, scenes[0].id);
    check("writeSceneWithProvider sets writerMethod to model-based", generated.metadata.writerMethod, "model-based");
    check("writeSceneWithProvider respects the createdAt override", generated.metadata.createdAt, "2026-01-01T00:00:00.000Z");
  }

  {
    for (const intent of allIntents) {
      const scenes = scenesFor(intent);
      const guidance = guidanceFor(intent);
      const context = contextFor(intent);
      const blueprint = blueprintFor(intent);
      const provider = new MockProvider(`Generated text for ${intent.preset}.`);

      const generated = await writeStoryWithProvider({
        scenes,
        guidance,
        blueprint,
        context,
        intent,
        provider,
        createdAt: "2026-01-01T00:00:00.000Z",
      });

      check(`${intent.preset}: writeStoryWithProvider calls the provider once per scene`, provider.calls.length, scenes.length);
      check(
        `${intent.preset}: writeStoryWithProvider sceneIds match SceneBlueprint[] ids, in order`,
        generated.map((g) => g.sceneId),
        scenes.map((s) => s.id)
      );
      checkTrue(
        `${intent.preset}: every GeneratedScene is model-based`,
        generated.every((g) => g.metadata.writerMethod === "model-based")
      );
      checkTrue(
        `${intent.preset}: every GeneratedScene carries the provider's text`,
        generated.every((g) => g.text === `Generated text for ${intent.preset}.`)
      );
    }
  }

  {
    const scenes = scenesFor(narrativeArcIntent);
    const guidance = guidanceFor(narrativeArcIntent).filter((g) => g.sceneId !== scenes[0].id);
    const context = contextFor(narrativeArcIntent);
    const blueprint = blueprintFor(narrativeArcIntent);
    const provider = new MockProvider();

    let threw = false;
    try {
      await writeStoryWithProvider({ scenes, guidance, blueprint, context, intent: narrativeArcIntent, provider });
    } catch {
      threw = true;
    }
    checkTrue("writeStoryWithProvider throws when a scene has no matching GenerationGuidance", threw);
  }

  // ─── 5. No OpenAI call during tests unless explicitly mocked ───────────

  {
    const previousKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    let threwWithoutNetworkCall = false;
    try {
      await createOpenAICreativeTextProvider().generateText({ systemPrompt: "s", userPrompt: "u" });
    } catch (err) {
      threwWithoutNetworkCall = err instanceof Error && err.message.includes("OPENAI_API_KEY");
    }
    checkTrue(
      "createOpenAICreativeTextProvider fails fast on missing OPENAI_API_KEY instead of attempting a network call",
      threwWithoutNetworkCall
    );

    if (previousKey !== undefined) process.env.OPENAI_API_KEY = previousKey;

    // Original deterministic writer path never touches provider.ts at all.
    const scenes = scenesFor(narrativeArcIntent);
    const guidance = guidanceFor(narrativeArcIntent);
    const context = contextFor(narrativeArcIntent);
    const blueprint = blueprintFor(narrativeArcIntent);
    const deterministic = writeStory({ scenes, guidance, blueprint, context, intent: narrativeArcIntent });
    checkTrue(
      "writeStory (deterministic) still works with no OPENAI_API_KEY configured at all",
      deterministic.length === scenes.length
    );
  }

  // ─── 6. Existing writer contract (writeScene/writeStory) is untouched ──

  {
    const scenes = scenesFor(narrativeArcIntent);
    const guidance = guidanceFor(narrativeArcIntent);
    const context = contextFor(narrativeArcIntent);
    const blueprint = blueprintFor(narrativeArcIntent);

    const generated = writeScene({
      scene: scenes[0],
      guidance: guidance[0],
      blueprint,
      context,
      intent: narrativeArcIntent,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    check("writeScene() (unchanged) still returns deterministic-template output", generated.metadata.writerMethod, "deterministic-template");
  }

  // ─── 4. No direct provider dependency leaks into planning/scenes/guidance/evaluation ──
  // orchestration/ is intentionally excluded from the "no CreativeTextProvider
  // reference" rule as of RP-011C.8.6: writer-adapter.ts and types.ts are the
  // sanctioned seam for writer-mode selection (see
  // scripts/test-creative-intelligence-generation.ts), but even there,
  // provider *construction* must stay isolated to writer/factory.ts -- so
  // orchestration/ is still checked for direct OpenAI imports/calls below.

  {
    const scanDirs = [
      "lib/creative-intelligence/core",
      "lib/creative-intelligence/intent",
      "lib/creative-intelligence/context",
      "lib/creative-intelligence/knowledge",
      "lib/creative-intelligence/planning",
      "lib/creative-intelligence/scenes",
      "lib/creative-intelligence/guidance",
      "lib/creative-intelligence/evaluation",
      "lib/creative-intelligence/prototype",
    ];

    const offending: string[] = [];
    for (const dir of scanDirs) {
      const abs = path.join(process.cwd(), dir);
      if (!fs.existsSync(abs)) continue;
      for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        if (!entry.isFile() || !/\.ts$/.test(entry.name)) continue;
        const filePath = path.join(abs, entry.name);
        const content = fs.readFileSync(filePath, "utf8");
        if (/from\s+["']openai["']/.test(content) || /\bopenai\.responses\b/i.test(content)) {
          offending.push(`${path.relative(process.cwd(), filePath)} -> provider import/call`);
        }
        if (/CreativeTextProvider/.test(content)) {
          offending.push(`${path.relative(process.cwd(), filePath)} -> CreativeTextProvider reference`);
        }
      }
    }
    check("no planning/scenes/guidance/evaluation/prototype file depends on the provider abstraction", offending, []);

    const orchestrationDir = path.join(process.cwd(), "lib/creative-intelligence/orchestration");
    const offendingOrchestration: string[] = [];
    for (const entry of fs.readdirSync(orchestrationDir, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.ts$/.test(entry.name)) continue;
      const filePath = path.join(orchestrationDir, entry.name);
      const content = fs.readFileSync(filePath, "utf8");
      if (/from\s+["']openai["']/.test(content) || /\bopenai\.responses\b/i.test(content)) {
        offendingOrchestration.push(`${path.relative(process.cwd(), filePath)} -> provider import/call`);
      }
      if (/createOpenAICreativeTextProvider/.test(content)) {
        offendingOrchestration.push(`${path.relative(process.cwd(), filePath)} -> direct provider construction`);
      }
    }
    check(
      "no orchestration/ file imports OpenAI directly or constructs a provider outside writer/factory.ts",
      offendingOrchestration,
      []
    );
  }

  // ─── No mutation of upstream inputs by the provider-backed writer ──────

  {
    const scenes = scenesFor(narrativeArcIntent);
    const guidance = guidanceFor(narrativeArcIntent);
    const context = contextFor(narrativeArcIntent);
    const blueprint = blueprintFor(narrativeArcIntent);
    const contextSnapshot = JSON.stringify(context);
    const blueprintSnapshot = JSON.stringify(blueprint);
    const scenesSnapshot = JSON.stringify(scenes);
    const guidanceSnapshot = JSON.stringify(guidance);
    const provider = new MockProvider();

    await writeStoryWithProvider({ scenes, guidance, blueprint, context, intent: narrativeArcIntent, provider });

    check("writeStoryWithProvider does not mutate the CreativeContext it is given", JSON.stringify(context), contextSnapshot);
    check("writeStoryWithProvider does not mutate the StoryBlueprint it is given", JSON.stringify(blueprint), blueprintSnapshot);
    check("writeStoryWithProvider does not mutate the SceneBlueprint[] it is given", JSON.stringify(scenes), scenesSnapshot);
    check("writeStoryWithProvider does not mutate the GenerationGuidance[] it is given", JSON.stringify(guidance), guidanceSnapshot);
  }

  // ─── Summary ────────────────────────────────────────────────────────────

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
