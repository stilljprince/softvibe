// scripts/run-sleep-story-end-to-end-quality-rebenchmark.ts
//
// RP-011C.8.10Q -- Sleep Story End-to-End Quality Rebenchmark.
//
// Re-runs the RP-011C.8.10J/M-style live comparison of the old pipeline vs.
// the Creative Intelligence pipeline for the sleep-story preset, after
// RP-011C.8.10P (scenario-aware defaults, gated on the `hasExplicitScenario`
// signal -- see docs/sleep-story-default-bias-calibration-review.md and
// scripts/test-creative-intelligence-sleep-story-scenario-aware-defaults.ts).
//
// Purpose: validate whether the traveler/companion/arrival/cottage/"There
// you are" default-bias pattern found in RP-011C.8.10M has been reduced now
// that Sleep Story's unconditional defaults are gated on whether the user
// supplied a concrete scenario.
//
// Reuses the existing benchmark harness (scripts/narrative-benchmark/**)
// unmodified -- this file only supplies its own case list and a metadata
// summary, following the same shape as
// run-sleep-story-end-to-end-quality-benchmark.ts (RP-011C.8.10J). It does
// not add cases to the shared cases/index.ts registry and does not touch
// any adapter, classifier, writer prompt, guidance, or template.
//
// Prompt wording is exact and must not be edited -- this benchmark's premise
// depends on these being the literal 5 prompts specified for RP-011C.8.10Q.
//
// This script does not modify any implementation file. It only calls the
// existing, unmodified OldPipelineAdapter / CreativeIntelligenceAdapter live
// paths and writes output under benchmark-output/, never to a database.
//
// Run with:
//   npx tsx scripts/run-sleep-story-end-to-end-quality-rebenchmark.ts --dry-run
//   CONFIRM_LIVE_BENCHMARK=true npx tsx scripts/run-sleep-story-end-to-end-quality-rebenchmark.ts --live

import fs from "node:fs";
import path from "node:path";

import type { BenchmarkCase, BenchmarkMode, BenchmarkResult } from "./narrative-benchmark/runners/types";
import { runCaseThroughAdapters } from "./narrative-benchmark/runners/benchmark-runner";
import { OldPipelineAdapter } from "./narrative-benchmark/adapters/old-pipeline";
import { CreativeIntelligenceAdapter } from "./narrative-benchmark/adapters/creative-intelligence";
import { loadEnvironment, enforceLiveModeGuards } from "./run-narrative-benchmark";

const BENCHMARK_CASES: BenchmarkCase[] = [
  {
    id: "sleep-story-rebench-01-cozy-cottage",
    category: "sleep-story-end-to-end-quality-rebenchmark",
    prompt:
      "A cozy bedtime story about a small cottage in the woods, with warm lights, tea, and a peaceful evening.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: ["cottage setting preserved", "cozy atmosphere", "companion allowed but not required"],
  },
  {
    id: "sleep-story-rebench-02-valley-under-stars",
    category: "sleep-story-end-to-end-quality-rebenchmark",
    prompt: "A bedtime story about walking through a peaceful valley under the stars.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: [
      "valley remains central",
      "walking journey remains central",
      "stars/night atmosphere preserved",
      "no forced cottage",
      "no unnecessary companion",
    ],
  },
  {
    id: "sleep-story-rebench-03-snowy-mountain-train",
    category: "sleep-story-end-to-end-quality-rebenchmark",
    prompt: "A cozy bedtime story about a slow train journey through snowy mountains.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: [
      "train remains central",
      "snowy mountains preserved",
      "no forced traveler + companion structure",
      "no danger/urgency",
    ],
  },
  {
    id: "sleep-story-rebench-04-fantasy-village",
    category: "sleep-story-end-to-end-quality-rebenchmark",
    prompt:
      "A gentle bedtime story about discovering a quiet magical village where friendly people welcome the traveler.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: ["fantasy village preserved", "welcoming characters allowed", "no escalation/adventure structure"],
  },
  {
    id: "sleep-story-rebench-05-ocean-journey",
    category: "sleep-story-end-to-end-quality-rebenchmark",
    prompt: "A calming bedtime story about traveling along a peaceful coastline while listening to the waves.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: ["coastline remains central", "ocean atmosphere preserved", "no forced cottage/host pattern"],
  },
];

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

// Rough spoken-word estimate at ~150 words/minute, matching the pacing
// assumption used elsewhere in the ASMR/sleep-story benchmark scripts.
function estimatedDurationMinutes(words: number): number {
  return Math.round((words / 150) * 10) / 10;
}

function parseMode(argv: string[]): BenchmarkMode {
  if (argv.includes("--live")) return "live";
  if (argv.includes("--dry-run")) return "dry-run";
  return "mock";
}

function main(): void {
  loadEnvironment();
  const mode = parseMode(process.argv.slice(2));
  enforceLiveModeGuards(mode);

  run(mode).catch((err) => {
    console.error(
      "[run-sleep-story-end-to-end-quality-rebenchmark] failed:",
      err instanceof Error ? err.message : err
    );
    process.exit(1);
  });
}

async function run(mode: BenchmarkMode): Promise<void> {
  const adapters = [new OldPipelineAdapter(mode), new CreativeIntelligenceAdapter(mode)];

  const outRoot = "benchmark-output";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runRoot = path.join(outRoot, `sleep-story-end-to-end-quality-rebenchmark-${timestamp}`);

  const summaryRows: Array<{
    caseId: string;
    pipeline: string;
    preset: unknown;
    creativeDirectionPresent: boolean;
    hasExplicitScenario: unknown;
    storyScale: unknown;
    wordCount: number;
    characterCount: number;
    estimatedMinutes: number;
    targetMinutes: number;
  }> = [];

  for (const benchmarkCase of BENCHMARK_CASES) {
    console.log(`[run-sleep-story-end-to-end-quality-rebenchmark] running case "${benchmarkCase.id}"...`);
    const results: BenchmarkResult[] = await runCaseThroughAdapters(benchmarkCase, adapters);

    const caseDir = path.join(runRoot, benchmarkCase.id);
    fs.mkdirSync(caseDir, { recursive: true });

    const caseMetadata: Record<string, unknown> = {
      caseId: benchmarkCase.id,
      prompt: benchmarkCase.prompt,
      expectedQualities: benchmarkCase.expectedQualities,
      targetDurationMinutes: benchmarkCase.durationMinutes,
      pipelines: [],
    };

    for (const result of results) {
      const fileName = result.pipelineName === "old" ? "old.txt" : "creative-intelligence.txt";
      fs.writeFileSync(path.join(caseDir, fileName), result.output, "utf8");

      const intent = (result.metadata as Record<string, unknown>).intent as
        | { preset?: unknown; creativeDirection?: unknown; hasExplicitScenario?: unknown; storyScale?: unknown }
        | undefined;

      const preset = intent?.preset ?? (result.metadata as Record<string, unknown>).preset;
      const creativeDirectionPresent = intent ? intent.creativeDirection !== undefined : false;
      const hasExplicitScenario = intent?.hasExplicitScenario;
      const storyScale = intent?.storyScale;
      const wc = wordCount(result.output);
      const cc = result.output.length;
      const estMinutes = estimatedDurationMinutes(wc);

      summaryRows.push({
        caseId: benchmarkCase.id,
        pipeline: result.pipelineName,
        preset,
        creativeDirectionPresent,
        hasExplicitScenario,
        storyScale,
        wordCount: wc,
        characterCount: cc,
        estimatedMinutes: estMinutes,
        targetMinutes: benchmarkCase.durationMinutes,
      });

      (caseMetadata.pipelines as unknown[]).push({
        pipelineName: result.pipelineName,
        preset,
        creativeDirectionPresent,
        hasExplicitScenario,
        storyScale,
        wordCount: wc,
        characterCount: cc,
        estimatedMinutes: estMinutes,
        rawMetadata: result.metadata,
      });
    }

    fs.writeFileSync(path.join(caseDir, "metadata.json"), JSON.stringify(caseMetadata, null, 2), "utf8");
  }

  console.log(`\n[run-sleep-story-end-to-end-quality-rebenchmark] done -- output written to ${runRoot}`);
  console.log(
    `\n${"caseId".padEnd(46)}${"pipeline".padEnd(22)}${"preset".padEnd(14)}${"cd?".padEnd(6)}${"expl?".padEnd(
      7
    )}${"scale".padEnd(16)}${"words".padEnd(8)}${"chars".padEnd(8)}${"est.min".padEnd(9)}target`
  );
  for (const row of summaryRows) {
    console.log(
      `${row.caseId.padEnd(46)}${row.pipeline.padEnd(22)}${String(row.preset).padEnd(14)}${String(
        row.creativeDirectionPresent
      ).padEnd(6)}${String(row.hasExplicitScenario).padEnd(7)}${String(row.storyScale).padEnd(16)}${String(
        row.wordCount
      ).padEnd(8)}${String(row.characterCount).padEnd(8)}${String(row.estimatedMinutes).padEnd(9)}${row.targetMinutes}`
    );
  }
}

main();
