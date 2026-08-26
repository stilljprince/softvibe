// scripts/narrative-benchmark/adapters/creative-intelligence.ts
//
// RP-011C.8.7.2 — Creative Intelligence benchmark adapter.
// RP-011C.8.7.3 — Live execution mode.
//
// Wraps the isolated Creative Intelligence orchestration pipeline
// (lib/creative-intelligence/orchestration) so it can be exercised through
// the same BenchmarkPipelineAdapter contract as the old pipeline adapter.
// lib/creative-intelligence is not wired into the active generation
// pipeline (see its README.md), so calling it here does not touch any
// production route.
//
// Three modes, selected explicitly per adapter instance:
//
//   mock (default) -- writerMode: "mock", the orchestration layer's
//     deterministic, non-LLM writer stage. Running this adapter never calls
//     OpenAI.
//
//   dry-run (RP-011C.8.7.3A) -- validates the same preset/param mapping the
//     live path would use, as a pure, synchronous check. Never calls
//     runCreativePipeline(), never imports the writer factory, so this
//     adapter's dry-run safety guarantee does not depend on
//     orchestration/writer-adapter.ts or writer/factory.ts internals --
//     createCreativeTextProvider() cannot be reached from this branch at
//     all.
//
//   live -- writerMode: "provider", the orchestration layer's existing
//     opt-in provider-backed writer. This adapter does not construct a
//     CreativeTextProvider or call OpenAI itself -- it only selects the
//     existing writerMode option, and runCreativePipeline()/writer-adapter.ts
//     resolve the real provider via the existing writer/factory.ts. No
//     OpenAI logic is duplicated here.
//
// Live mode never falls back to mock silently: the underlying
// createOpenAICreativeTextProvider() throws a clear error if
// OPENAI_API_KEY is not configured, the first time it is called.

import { runCreativePipeline } from "../../../lib/creative-intelligence/orchestration";
import type { WriterMode } from "../../../lib/creative-intelligence/orchestration";
import type { CreativePreset } from "../../../lib/creative-intelligence/core/constants";
import type {
  BenchmarkCase,
  BenchmarkMode,
  BenchmarkPreset,
  BenchmarkPipelineAdapter,
  BenchmarkResult,
} from "../runners/types";

export const CREATIVE_INTELLIGENCE_PIPELINE_NAME = "creative-intelligence";

function toCreativePreset(preset: BenchmarkPreset): CreativePreset {
  return preset === "asmr" ? "classic-asmr" : preset;
}

function toWriterMode(mode: BenchmarkMode): WriterMode {
  return mode === "live" ? "provider" : "mock";
}

export class CreativeIntelligenceAdapter implements BenchmarkPipelineAdapter {
  readonly name = CREATIVE_INTELLIGENCE_PIPELINE_NAME;

  constructor(private readonly mode: BenchmarkMode = "mock") {}

  async run(benchmarkCase: BenchmarkCase): Promise<BenchmarkResult> {
    if (this.mode === "dry-run") {
      return this.runDryRun(benchmarkCase);
    }

    const writerMode = toWriterMode(this.mode);

    const startedAt = Date.now();
    const result = await runCreativePipeline(
      {
        prompt: benchmarkCase.prompt,
        preset: toCreativePreset(benchmarkCase.preset),
        durationMinutes: benchmarkCase.durationMinutes,
      },
      { writerMode }
    );
    const finishedAt = Date.now();

    const output = result.generatedScenes.map((scene) => scene.text).join("\n\n");

    return {
      caseId: benchmarkCase.id,
      pipelineName: this.name,
      output,
      metadata: {
        pipeline: this.name,
        preset: benchmarkCase.preset,
        durationMinutes: benchmarkCase.durationMinutes,
        version: result.metadata.version,
        sceneCount: result.scenes.length,
        evaluation: result.evaluation,
        // Surfaces the already-computed CreativeIntent (extractCreativeIntent(),
        // via runCreativePipeline()) so benchmark reports can inspect whether
        // asmrMode/creativeDirection were classified and preserved, without
        // duplicating any intent-classification logic here.
        intent: result.intent,
        mode: this.mode,
        writerMode,
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date(finishedAt).toISOString(),
        durationMs: finishedAt - startedAt,
      },
    };
  }

  // Validates the same preset/param mapping the live path would use, as a
  // pure, synchronous check. Never calls runCreativePipeline() and never
  // imports the writer factory, so createCreativeTextProvider() cannot be
  // reached from this branch regardless of orchestration internals.
  private runDryRun(benchmarkCase: BenchmarkCase): BenchmarkResult {
    const creativePreset = toCreativePreset(benchmarkCase.preset);
    const issues: string[] = [];
    if (!benchmarkCase.prompt.trim()) issues.push("prompt is empty");
    if (!(benchmarkCase.durationMinutes > 0)) issues.push("durationMinutes must be > 0");
    if (issues.length > 0) {
      throw new Error(`CreativeIntelligenceAdapter dry-run validation failed: ${issues.join("; ")}`);
    }

    return {
      caseId: benchmarkCase.id,
      pipelineName: this.name,
      output: `[creative-intelligence dry-run :: ${benchmarkCase.id}] preset=${creativePreset} durationMinutes=${benchmarkCase.durationMinutes}`,
      metadata: {
        pipeline: this.name,
        preset: benchmarkCase.preset,
        creativePreset,
        durationMinutes: benchmarkCase.durationMinutes,
        mode: "dry-run",
        dryRun: true,
        note:
          "Dry-run validation only -- no runCreativePipeline() call, no provider, no OpenAI call.",
      },
    };
  }
}
