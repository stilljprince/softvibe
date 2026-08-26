// scripts/test-creative-intelligence-generation.ts
//
// RP-011C.8.6 — Isolated tests for the Creative Intelligence Orchestration
// Layer's writer-mode selection (lib/creative-intelligence/orchestration/
// writer-adapter.ts, writer/factory.ts, and the writerMode/provider
// additions to orchestration/types.ts + pipeline.ts). Every "provider"-mode
// test here uses a mocked CreativeTextProvider -- nothing in this file
// makes a real OpenAI call, touches the active generation pipeline, or
// hits the database.
//
// Run with:  npx tsx scripts/test-creative-intelligence-generation.ts

import fs from "node:fs";
import path from "node:path";
import { runCreativePipeline, writeStoryForPipeline } from "../lib/creative-intelligence/orchestration";
import type { CreativePipelineRequest } from "../lib/creative-intelligence/orchestration";
import {
  CreativeKnowledgeRegistry,
  initializeCreativeKnowledge,
  buildCreativeContext,
  buildStoryBlueprint,
  buildSceneBlueprints,
  buildGenerationGuidance,
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

const FIXED_CREATED_AT = "2026-01-01T00:00:00.000Z";

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

const registry = new CreativeKnowledgeRegistry();
initializeCreativeKnowledge(registry);

function contextFor(intent: CreativeIntent, prompt = "test"): CreativeContext {
  return buildCreativeContext({ rawInput: { prompt }, intent, registry, createdAt: FIXED_CREATED_AT });
}

function blueprintFor(intent: CreativeIntent, prompt = "test"): StoryBlueprint {
  return buildStoryBlueprint({ intent, context: contextFor(intent, prompt), createdAt: FIXED_CREATED_AT });
}

function scenesFor(intent: CreativeIntent, prompt = "test"): SceneBlueprint[] {
  const context = contextFor(intent, prompt);
  const blueprint = blueprintFor(intent, prompt);
  return buildSceneBlueprints({ intent, context, blueprint, createdAt: FIXED_CREATED_AT });
}

function guidanceFor(intent: CreativeIntent, prompt = "test"): GenerationGuidance[] {
  const context = contextFor(intent, prompt);
  const blueprint = blueprintFor(intent, prompt);
  const scenes = buildSceneBlueprints({ intent, context, blueprint, createdAt: FIXED_CREATED_AT });
  return buildGenerationGuidance({ scenes, blueprint, context, intent, createdAt: FIXED_CREATED_AT });
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

function run(request: CreativePipelineRequest, options: Parameters<typeof runCreativePipeline>[1] = {}) {
  return runCreativePipeline(request, { createdAt: FIXED_CREATED_AT, ...options });
}

const narrativeRequest: CreativePipelineRequest = {
  prompt:
    "A young man leaves his childhood bedroom and builds a small business while struggling with confidence.",
  preset: "narrative",
  durationMinutes: 45,
};

async function main() {
  // ─── 1. Mock pipeline flow (default, and explicit) ──────────────────────

  {
    const defaultResult = await run(narrativeRequest);
    checkTrue(
      "runCreativePipeline defaults to mock writer mode",
      defaultResult.generatedScenes.every((g) => g.metadata.writerMethod === "deterministic-template")
    );

    const explicitMockResult = await run(narrativeRequest, { writerMode: "mock" });
    check(
      "explicit writerMode: mock produces the same generatedScenes as the default",
      JSON.stringify(explicitMockResult.generatedScenes),
      JSON.stringify(defaultResult.generatedScenes)
    );
  }

  // ─── 2. Provider adapter with mocked provider ────────────────────────────

  {
    const scenes = scenesFor(narrativeArcIntent);
    const guidance = guidanceFor(narrativeArcIntent);
    const context = contextFor(narrativeArcIntent);
    const blueprint = blueprintFor(narrativeArcIntent);
    const provider = new MockProvider("Adapter-mocked scene text.");

    const mockModeResult = await writeStoryForPipeline({
      scenes,
      guidance,
      blueprint,
      context,
      intent: narrativeArcIntent,
      createdAt: FIXED_CREATED_AT,
      writerMode: "mock",
      provider,
    });
    check("writer-adapter in mock mode never calls the injected provider", provider.calls.length, 0);
    checkTrue(
      "writer-adapter in mock mode returns deterministic-template output",
      mockModeResult.every((g) => g.metadata.writerMethod === "deterministic-template")
    );

    const providerModeResult = await writeStoryForPipeline({
      scenes,
      guidance,
      blueprint,
      context,
      intent: narrativeArcIntent,
      createdAt: FIXED_CREATED_AT,
      writerMode: "provider",
      provider,
    });
    check("writer-adapter in provider mode calls the injected provider once per scene", provider.calls.length, scenes.length);
    checkTrue(
      "writer-adapter in provider mode returns model-based output",
      providerModeResult.every((g) => g.metadata.writerMethod === "model-based")
    );
    checkTrue(
      "writer-adapter in provider mode returns the injected provider's text",
      providerModeResult.every((g) => g.text === "Adapter-mocked scene text.")
    );
  }

  // ─── 3. Provider mode returns generated text (through the full pipeline) ─

  {
    const provider = new MockProvider("Pipeline-level generated prose.");
    const result = await run(narrativeRequest, { writerMode: "provider", provider });

    checkTrue(
      "provider mode through the full pipeline produces one GeneratedScene per scene",
      result.generatedScenes.length === result.scenes.length
    );
    checkTrue(
      "provider mode through the full pipeline marks every scene model-based",
      result.generatedScenes.every((g) => g.metadata.writerMethod === "model-based")
    );
    checkTrue(
      "provider mode through the full pipeline carries the provider's generated text",
      result.generatedScenes.every((g) => g.text === "Pipeline-level generated prose.")
    );
    check(
      "provider mode through the full pipeline calls the provider once per scene",
      provider.calls.length,
      result.scenes.length
    );
  }

  // ─── 4. Evaluation receives generated output ─────────────────────────────

  {
    const provider = new MockProvider("Text the Evaluation Layer should see.");
    const result = await run(narrativeRequest, { writerMode: "provider", provider });

    checkTrue(
      "evaluation stage ran against the provider-backed generatedScenes (criteria were scored)",
      result.evaluation.criteriaResults.length > 0
    );
    checkTrue(
      "evaluation output is present alongside model-based generatedScenes",
      result.evaluation !== undefined && result.generatedScenes.every((g) => g.metadata.writerMethod === "model-based")
    );
  }

  // ─── 5. No forbidden imports ──────────────────────────────────────────────

  {
    const forbiddenPipelinePaths = [
      "app/api/jobs",
      "app/generate",
      "lib/narrative",
      "lib/story-supervisor.ts",
      "lib/script-builder.ts",
      "lib/script-builder-openai.ts",
      "lib/script-builder-narrative.ts",
      "lib/script-builder-narrative-story.ts",
      "lib/script-builder-narrative-quiet-knowledge.ts",
      "lib/tts",
      "lib/audio",
    ];

    const orchestrationDir = path.join(process.cwd(), "lib/creative-intelligence/orchestration");
    const orchestrationFiles = fs
      .readdirSync(orchestrationDir)
      .filter((f) => /\.ts$/.test(f))
      .map((f) => path.join(orchestrationDir, f));

    const offending: string[] = [];
    for (const file of orchestrationFiles) {
      const codeOnly = fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
      for (const forbidden of forbiddenPipelinePaths) {
        if (codeOnly.includes(forbidden)) offending.push(`${path.relative(process.cwd(), file)} -> ${forbidden}`);
      }
    }
    check("no orchestration/ file references an active pipeline path", offending, []);

    const offendingProviderLeak: string[] = [];
    for (const file of orchestrationFiles) {
      if (path.basename(file) === "writer-adapter.ts") continue;
      const content = fs.readFileSync(file, "utf8");
      if (/from\s+["']openai["']/.test(content) || /createOpenAICreativeTextProvider/.test(content)) {
        offendingProviderLeak.push(`${path.relative(process.cwd(), file)} -> provider construction leak`);
      }
    }
    check(
      "no orchestration/ file other than writer-adapter.ts constructs a provider directly",
      offendingProviderLeak,
      []
    );

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

    const offendingPipelineFiles: string[] = [];
    for (const target of forbiddenPipelinePaths) {
      for (const file of collectFiles(target)) {
        const content = fs.readFileSync(file, "utf8");
        if (content.includes("creative-intelligence")) {
          offendingPipelineFiles.push(path.relative(process.cwd(), file));
        }
      }
    }
    check(
      "no existing pipeline file imports lib/creative-intelligence (orchestration stays unwired)",
      offendingPipelineFiles,
      []
    );
  }

  // ─── 6. No production pipeline changes ───────────────────────────────────
  // Static check, not a git diff (this repo may carry unrelated dirty state
  // from other in-progress work) -- confirms none of the forbidden
  // production files reference anything this task added.

  {
    const forbiddenFiles = [
      "app/api/jobs",
      "app/generate",
      "lib/script-builder.ts",
      "lib/narrative",
      "lib/story-supervisor.ts",
      "lib/tts",
    ];

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

    const newSymbols = ["writer-adapter", "writeStoryForPipeline", "createCreativeTextProvider", "writerMode"];
    const offending: string[] = [];
    for (const target of forbiddenFiles) {
      for (const file of collectFiles(target)) {
        const content = fs.readFileSync(file, "utf8");
        if (newSymbols.some((symbol) => content.includes(symbol))) {
          offending.push(path.relative(process.cwd(), file));
        }
      }
    }
    check(
      "no forbidden production file (app/api/jobs, app/generate, lib/script-builder.ts, lib/narrative, lib/story-supervisor.ts, lib/tts) references this task's new writer-mode selection code",
      offending,
      []
    );
  }

  // ─── No mutation of upstream inputs, and no cross-run shared state ───────

  {
    const requestSnapshot = JSON.stringify(narrativeRequest);
    const provider = new MockProvider("Immutability check text.");
    await run(narrativeRequest, { writerMode: "provider", provider });
    check(
      "runCreativePipeline in provider mode does not mutate the request it is given",
      JSON.stringify(narrativeRequest),
      requestSnapshot
    );
  }

  // ─── Summary ──────────────────────────────────────────────────────────────

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
