// scripts/narrative-benchmark/adapters/old-pipeline.ts
//
// RP-011C.8.7.2 — Old Narrative Pipeline benchmark adapter.
// RP-011C.8.7.3 — Live execution mode.
//
// Represents the pre-Creative-Intelligence narrative generation path
// (lib/script-builder-openai.ts, which itself dispatches into
// lib/narrative/orchestrator.ts for long-form durations) in the benchmark
// comparison.
//
// Three modes, selected explicitly per adapter instance:
//
//   mock (default) -- isolated structural placeholder derived only from the
//     BenchmarkCase itself. No production imports, no OpenAI calls. Exists
//     to exercise the BenchmarkPipelineAdapter contract and the comparison
//     runner end-to-end.
//
//   dry-run (RP-011C.8.7.3A) -- validates the same case shape/preset
//     mapping the live path would use, but never imports
//     lib/script-builder-openai.ts (not even dynamically) and never
//     touches OpenAI. This is a pure, synchronous check, so its safety
//     guarantee does not depend on anything downstream of this file.
//
//   live -- executes the real existing Narrative generation path via
//     buildScriptOpenAI(). The production module is loaded with a dynamic
//     import() (rather than a static import) so it is only ever pulled into
//     the module graph when live mode is actually exercised -- mock mode,
//     dry-run mode, and everything that only ever runs those modes (tests,
//     default CLI usage), never touches lib/script-builder-openai.ts or
//     OpenAI at all. This file does not modify that production module in
//     any way; it only calls its existing, unmodified public entry point.
//
// Live mode never falls back to mock silently: buildScriptOpenAI() itself
// throws a clear error if OPENAI_API_KEY is not configured.

import type {
  BenchmarkCase,
  BenchmarkMode,
  BenchmarkPipelineAdapter,
  BenchmarkPreset,
  BenchmarkResult,
} from "../runners/types";

export const OLD_PIPELINE_NAME = "old";

function buildPlaceholderOutput(benchmarkCase: BenchmarkCase): string {
  return [
    `[old-pipeline placeholder :: ${benchmarkCase.id}]`,
    `preset=${benchmarkCase.preset} durationMinutes=${benchmarkCase.durationMinutes}`,
    benchmarkCase.prompt,
  ].join("\n");
}

// BenchmarkPreset and ScriptPreset (lib/script-builder.ts) share every value
// except "asmr", which the production script builder calls "classic-asmr".
function toScriptPreset(
  preset: BenchmarkPreset
): "classic-asmr" | "sleep-story" | "meditation" | "kids-story" | "narrative" {
  return preset === "asmr" ? "classic-asmr" : preset;
}

export class OldPipelineAdapter implements BenchmarkPipelineAdapter {
  readonly name = OLD_PIPELINE_NAME;

  constructor(private readonly mode: BenchmarkMode = "mock") {}

  async run(benchmarkCase: BenchmarkCase): Promise<BenchmarkResult> {
    if (this.mode === "mock") {
      return this.runMock(benchmarkCase);
    }
    if (this.mode === "dry-run") {
      return this.runDryRun(benchmarkCase);
    }
    return this.runLive(benchmarkCase);
  }

  private async runMock(benchmarkCase: BenchmarkCase): Promise<BenchmarkResult> {
    return {
      caseId: benchmarkCase.id,
      pipelineName: this.name,
      output: buildPlaceholderOutput(benchmarkCase),
      metadata: {
        pipeline: this.name,
        preset: benchmarkCase.preset,
        durationMinutes: benchmarkCase.durationMinutes,
        mode: "mock",
        mock: true,
        isolated: true,
        note:
          "Structural placeholder only — no live narrative generation or OpenAI calls in this mode.",
      },
    };
  }

  // Validates the same inputs the live path consumes (preset mapping,
  // prompt, duration) without importing lib/script-builder-openai.ts or
  // constructing anything OpenAI-related, so this can never call OpenAI
  // regardless of that module's internals.
  private async runDryRun(benchmarkCase: BenchmarkCase): Promise<BenchmarkResult> {
    const scriptPreset = toScriptPreset(benchmarkCase.preset);
    const issues: string[] = [];
    if (!benchmarkCase.prompt.trim()) issues.push("prompt is empty");
    if (!(benchmarkCase.durationMinutes > 0)) issues.push("durationMinutes must be > 0");
    if (issues.length > 0) {
      throw new Error(`OldPipelineAdapter dry-run validation failed: ${issues.join("; ")}`);
    }

    return {
      caseId: benchmarkCase.id,
      pipelineName: this.name,
      output: buildPlaceholderOutput(benchmarkCase),
      metadata: {
        pipeline: this.name,
        preset: benchmarkCase.preset,
        scriptPreset,
        durationMinutes: benchmarkCase.durationMinutes,
        mode: "dry-run",
        dryRun: true,
        note:
          "Dry-run validation only -- no lib/script-builder-openai.ts import, no OpenAI call.",
      },
    };
  }

  private async runLive(benchmarkCase: BenchmarkCase): Promise<BenchmarkResult> {
    const { buildScriptOpenAI } = await import("@/lib/script-builder-openai");

    const startedAt = Date.now();
    const startedAtIso = new Date(startedAt).toISOString();
    const { finalText } = await buildScriptOpenAI({
      preset: toScriptPreset(benchmarkCase.preset),
      userPrompt: benchmarkCase.prompt,
      targetDurationSec: benchmarkCase.durationMinutes * 60,
      language: "en",
    });
    const finishedAt = Date.now();
    const durationMs = finishedAt - startedAt;

    return {
      caseId: benchmarkCase.id,
      pipelineName: this.name,
      output: finalText,
      metadata: {
        pipeline: this.name,
        preset: benchmarkCase.preset,
        durationMinutes: benchmarkCase.durationMinutes,
        mode: "live",
        mock: false,
        startedAt: startedAtIso,
        finishedAt: new Date(finishedAt).toISOString(),
        durationMs,
      },
    };
  }
}
