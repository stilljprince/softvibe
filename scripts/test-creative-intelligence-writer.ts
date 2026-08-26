// scripts/test-creative-intelligence-writer.ts
//
// RP-011C.7.26 — Isolated tests for the Narrative Writer Layer
// (lib/creative-intelligence/writer/**). Nothing here touches the active
// generation pipeline, calls a provider, or hits the database.
//
// Run with:  npx tsx scripts/test-creative-intelligence-writer.ts

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
} from "../lib/creative-intelligence";
import type {
  CreativeContext,
  CreativeIntent,
  GeneratedScene,
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

function storyFor(intent: CreativeIntent, prompt = "test"): GeneratedScene[] {
  const context = contextFor(intent, prompt);
  const blueprint = blueprintFor(intent, prompt);
  const scenes = buildSceneBlueprints({ intent, context, blueprint, createdAt: "2026-01-01T00:00:00.000Z" });
  const guidance = buildGenerationGuidance({ scenes, blueprint, context, intent, createdAt: "2026-01-01T00:00:00.000Z" });
  return writeStory({ scenes, guidance, blueprint, context, intent, createdAt: "2026-01-01T00:00:00.000Z" });
}

const narrativeArcIntent: CreativeIntent = {
  preset: "narrative",
  experience: "an immersive narrative built around the listener's request",
  audience: "adult",
  durationMinutes: 20,
  constraints: [],
  storyScale: "arc",
  themes: ["courage"],
};

const transformationIntent: CreativeIntent = {
  preset: "narrative",
  experience: "a story about rebuilding a life through independence",
  audience: "adult",
  durationMinutes: 25,
  constraints: [],
  storyScale: "transformation",
  themes: ["independence"],
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

const allIntents = [
  narrativeArcIntent,
  transformationIntent,
  sleepStoryIntent,
  meditationIntent,
  kidsStoryIntent,
  classicAsmrIntent,
];

// ─── 1. Writer contract can be used ────────────────────────────────────

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

  checkTrue("writeScene() returns a value", generated !== undefined && generated !== null);
  check("writeScene() output sceneId matches the input scene", generated.sceneId, scenes[0].id);
}

// ─── 2. Scene Blueprint is accepted ────────────────────────────────────

{
  for (const intent of allIntents) {
    const scenes = scenesFor(intent);
    const generated = storyFor(intent);

    check(
      `${intent.preset}: writeStory sceneIds match SceneBlueprint[] ids, in order`,
      generated.map((g) => g.sceneId),
      scenes.map((s) => s.id)
    );
  }
}

// ─── 3. Generation Guidance is accepted and actually used ──────────────

{
  const scenes = scenesFor(narrativeArcIntent);
  const guidance = guidanceFor(narrativeArcIntent);
  const context = contextFor(narrativeArcIntent);
  const blueprint = blueprintFor(narrativeArcIntent);

  const baseline = writeScene({
    scene: scenes[0],
    guidance: guidance[0],
    blueprint,
    context,
    intent: narrativeArcIntent,
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  const alteredGuidance: GenerationGuidance = {
    ...guidance[0],
    writingFocus: "A deliberately distinct writing focus marker for this test",
  };
  const altered = writeScene({
    scene: scenes[0],
    guidance: alteredGuidance,
    blueprint,
    context,
    intent: narrativeArcIntent,
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  checkTrue("changing guidance.writingFocus changes the writer output", baseline.text !== altered.text);
  checkTrue(
    "writer output text incorporates the guidance's writingFocus",
    altered.text.includes("A deliberately distinct writing focus marker for this test")
  );
}

// ─── 4. Output matches the GeneratedScene contract ─────────────────────

{
  for (const intent of allIntents) {
    const generated = storyFor(intent);
    checkTrue(`${intent.preset}: writeStory returns a non-empty array`, generated.length > 0);
    checkTrue(
      `${intent.preset}: every GeneratedScene has the full contract shape`,
      generated.every(
        (g) =>
          typeof g.sceneId === "string" &&
          typeof g.text === "string" &&
          g.text.length > 0 &&
          typeof g.metadata?.createdAt === "string" &&
          typeof g.metadata?.version === "string" &&
          typeof g.metadata?.writerMethod === "string"
      )
    );
  }

  const generated = storyFor(narrativeArcIntent);
  check("metadata.createdAt uses the provided override", generated[0].metadata.createdAt, "2026-01-01T00:00:00.000Z");
  check("metadata.writerMethod is deterministic-template", generated[0].metadata.writerMethod, "deterministic-template");
}

// ─── 5/6/7/8. No pipeline imports, no provider calls, no DB dependency ──

{
  const forbiddenPipelinePaths = [
    "app/api/jobs",
    "lib/narrative",
    "lib/story-supervisor.ts",
    "lib/script-builder.ts",
    "lib/script-builder-openai.ts",
    "lib/tts",
    "lib/audio",
    "app/generate",
  ];

  const writerDir = path.join(process.cwd(), "lib/creative-intelligence/writer");
  const writerFiles = fs
    .readdirSync(writerDir)
    .filter((f) => /\.ts$/.test(f))
    .map((f) => path.join(writerDir, f));

  const offending: string[] = [];
  for (const file of writerFiles) {
    const content = fs.readFileSync(file, "utf8");
    for (const forbidden of forbiddenPipelinePaths) {
      if (content.includes(forbidden)) offending.push(`${path.relative(process.cwd(), file)} -> ${forbidden}`);
    }
    if (/from\s+["']openai["']/.test(content) || /from\s+["']elevenlabs["']/.test(content)) {
      offending.push(`${path.relative(process.cwd(), file)} -> provider import`);
    }
    if (/from\s+["'].*prisma.*["']/.test(content) || /@prisma\/client/.test(content)) {
      offending.push(`${path.relative(process.cwd(), file)} -> database import`);
    }
    if (/\bopenai\./i.test(content) || /\belevenlabs\./i.test(content)) {
      offending.push(`${path.relative(process.cwd(), file)} -> provider call`);
    }
  }
  check("no writer/ file references a pipeline path, provider SDK, or database import", offending, []);
}

// ─── 9. All presets can be processed structurally ──────────────────────

{
  for (const intent of allIntents) {
    const scenes = scenesFor(intent);
    const generated = storyFor(intent);

    check(`${intent.preset}: one GeneratedScene per SceneBlueprint`, generated.length, scenes.length);
    checkTrue(
      `${intent.preset}: every scene's text references its own scene id`,
      generated.every((g) => g.text.includes(g.sceneId))
    );
    checkTrue(
      `${intent.preset}: every scene's text references the preset`,
      generated.every((g) => g.text.includes(intent.preset))
    );
  }
}

// ─── 10. No mutation, no mock story generation, no pipeline wiring ──────

{
  const context = contextFor(narrativeArcIntent);
  const blueprint = blueprintFor(narrativeArcIntent);
  const scenes = scenesFor(narrativeArcIntent);
  const guidance = guidanceFor(narrativeArcIntent);
  const contextSnapshot = JSON.stringify(context);
  const blueprintSnapshot = JSON.stringify(blueprint);
  const scenesSnapshot = JSON.stringify(scenes);
  const guidanceSnapshot = JSON.stringify(guidance);

  writeStory({ scenes, guidance, blueprint, context, intent: narrativeArcIntent, createdAt: "2026-01-01T00:00:00.000Z" });

  check("writeStory does not mutate the CreativeContext it is given", JSON.stringify(context), contextSnapshot);
  check("writeStory does not mutate the StoryBlueprint it is given", JSON.stringify(blueprint), blueprintSnapshot);
  check("writeStory does not mutate the SceneBlueprint[] it is given", JSON.stringify(scenes), scenesSnapshot);
  check("writeStory does not mutate the GenerationGuidance[] it is given", JSON.stringify(guidance), guidanceSnapshot);

  // No large hand-written example story text baked into the writer source
  // -- only short structural label strings (templates.ts) and a
  // line-based composition function (writer.ts).
  const writerDir = path.join(process.cwd(), "lib/creative-intelligence/writer");
  const longStringOffenders: string[] = [];
  for (const file of fs.readdirSync(writerDir).filter((f) => /\.ts$/.test(f))) {
    const content = fs.readFileSync(path.join(writerDir, file), "utf8");
    const codeOnly = content
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    // Only real string-literal syntax: a quote/backtick, then content with
    // no unescaped same-quote character, then the matching close quote --
    // avoids false-matching English apostrophes/backticks inside comments.
    for (const match of codeOnly.matchAll(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`/g)) {
      const literal = match[0].slice(1, -1);
      if (literal.length >= 200) longStringOffenders.push(`${file}: string literal of ${literal.length} chars`);
    }
  }
  check("no writer/ source file contains a long hand-written string literal (mock story text)", longStringOffenders, []);

  function collectFiles(target: string): string[] {
    const abs = path.join(process.cwd(), target);
    if (!fs.existsSync(abs)) return [];
    const stat = fs.statSync(abs);
    if (stat.isFile()) return [abs];
    const results: string[] = [];
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const entryPath = path.join(abs, entry.name);
      if (entry.isDirectory()) {
        results.push(...collectFiles(path.relative(process.cwd(), entryPath)));
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        results.push(entryPath);
      }
    }
    return results;
  }

  const forbiddenPipelinePaths = [
    "app/api/jobs",
    "lib/narrative",
    "lib/story-supervisor.ts",
    "lib/script-builder.ts",
    "lib/script-builder-openai.ts",
    "lib/tts",
    "lib/audio",
    "app/generate",
  ];
  const offendingPipelineFiles: string[] = [];
  for (const target of forbiddenPipelinePaths) {
    for (const file of collectFiles(target)) {
      const content = fs.readFileSync(file, "utf8");
      if (content.includes("creative-intelligence")) {
        offendingPipelineFiles.push(path.relative(process.cwd(), file));
      }
    }
  }
  check("no existing pipeline file imports lib/creative-intelligence", offendingPipelineFiles, []);
}

// ─── Summary ─────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
