// scripts/run-sleep-story-end-to-end-quality-benchmark.ts
//
// RP-011C.8.10J -- Sleep Story End-to-End Quality Benchmark.
//
// Live, human-review-only comparison of the old pipeline vs. the Creative
// Intelligence pipeline for the sleep-story preset, after the completed
// calibration series:
//   RP-011C.8.10C -- Knowledge Foundation
//   RP-011C.8.10E -- Planning Calibration
//   RP-011C.8.10F -- Scene Calibration
//   RP-011C.8.10G -- Guidance Calibration
//   RP-011C.8.10H -- Evaluation Calibration
//   RP-011C.8.10I -- Writer Calibration
//
// Reuses the existing benchmark harness (scripts/narrative-benchmark/**)
// unmodified -- this file only supplies its own case list and a metadata
// summary, following the same shape as run-asmr-final-quality-regression.ts.
// It does not add cases to the shared cases/index.ts registry and does not
// touch any adapter, classifier, writer prompt, guidance, or template.
//
// Prompt wording is exact and must not be edited -- this benchmark's premise
// depends on these being the literal 5 prompts specified for RP-011C.8.10J.
//
// This script does not modify any implementation file. It only calls the
// existing, unmodified OldPipelineAdapter / CreativeIntelligenceAdapter live
// paths and writes output under benchmark-output/, never to a database.
//
// Run with:
//   npx tsx scripts/run-sleep-story-end-to-end-quality-benchmark.ts --dry-run
//   CONFIRM_LIVE_BENCHMARK=true npx tsx scripts/run-sleep-story-end-to-end-quality-benchmark.ts --live

import fs from "node:fs";
import path from "node:path";

import type { BenchmarkCase, BenchmarkMode, BenchmarkResult } from "./narrative-benchmark/runners/types";
import { runCaseThroughAdapters } from "./narrative-benchmark/runners/benchmark-runner";
import { OldPipelineAdapter } from "./narrative-benchmark/adapters/old-pipeline";
import { CreativeIntelligenceAdapter } from "./narrative-benchmark/adapters/creative-intelligence";
import { loadEnvironment, enforceLiveModeGuards } from "./run-narrative-benchmark";

const BENCHMARK_CASES: BenchmarkCase[] = [
  {
    id: "sleep-story-e2e-01-cozy-familiar-place",
    category: "sleep-story-end-to-end-quality-benchmark",
    prompt:
      "A peaceful bedtime story about arriving at a cozy cottage in the forest, exploring the warm rooms and slowly settling in for the night.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: [
      "rest-worthy setting",
      "sensory atmosphere",
      "non-demanding movement",
    ],
  },
  {
    id: "sleep-story-e2e-02-gentle-companion",
    category: "sleep-story-end-to-end-quality-benchmark",
    prompt:
      "A bedtime story where the listener follows a kind traveler who shares a quiet evening journey and discovers a welcoming place to rest.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: ["companion warmth", "no dependency", "no conflict"],
  },
  {
    id: "sleep-story-e2e-03-nature-exploration",
    category: "sleep-story-end-to-end-quality-benchmark",
    prompt:
      "A sleep story about slowly walking through a peaceful valley at dusk, noticing gentle details of nature before resting beneath the stars.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: ["movement without urgency", "sensory calm", "sleep transition"],
  },
  {
    id: "sleep-story-e2e-04-soft-fantasy-world",
    category: "sleep-story-end-to-end-quality-benchmark",
    prompt:
      "A magical bedtime story about visiting a quiet village where friendly characters welcome the traveler and prepare a peaceful place to sleep.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: ["fantasy without adventure pressure", "worldbuilding", "character warmth"],
  },
  {
    id: "sleep-story-e2e-05-classic-bedtime-story",
    category: "sleep-story-end-to-end-quality-benchmark",
    prompt:
      "Write a traditional bedtime story with a gentle journey, comforting characters, and a quiet ending that helps the listener fall asleep.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: [
      "overall Sleep Story identity",
      "ending quality",
      "absence of Narrative escalation",
    ],
  },
];

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

// Rough spoken-word estimate at ~150 words/minute, matching the pacing
// assumption used elsewhere in the ASMR benchmark scripts.
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
      "[run-sleep-story-end-to-end-quality-benchmark] failed:",
      err instanceof Error ? err.message : err
    );
    process.exit(1);
  });
}

async function run(mode: BenchmarkMode): Promise<void> {
  const adapters = [new OldPipelineAdapter(mode), new CreativeIntelligenceAdapter(mode)];

  const outRoot = "benchmark-output";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runRoot = path.join(outRoot, `sleep-story-end-to-end-quality-benchmark-${timestamp}`);

  const summaryRows: Array<{
    caseId: string;
    pipeline: string;
    preset: unknown;
    creativeDirectionPresent: boolean;
    wordCount: number;
    characterCount: number;
    estimatedMinutes: number;
    targetMinutes: number;
  }> = [];

  for (const benchmarkCase of BENCHMARK_CASES) {
    console.log(`[run-sleep-story-end-to-end-quality-benchmark] running case "${benchmarkCase.id}"...`);
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
        | { preset?: unknown; creativeDirection?: unknown }
        | undefined;

      const preset = intent?.preset ?? (result.metadata as Record<string, unknown>).preset;
      const creativeDirectionPresent = intent ? intent.creativeDirection !== undefined : false;
      const wc = wordCount(result.output);
      const cc = result.output.length;
      const estMinutes = estimatedDurationMinutes(wc);

      summaryRows.push({
        caseId: benchmarkCase.id,
        pipeline: result.pipelineName,
        preset,
        creativeDirectionPresent,
        wordCount: wc,
        characterCount: cc,
        estimatedMinutes: estMinutes,
        targetMinutes: benchmarkCase.durationMinutes,
      });

      (caseMetadata.pipelines as unknown[]).push({
        pipelineName: result.pipelineName,
        preset,
        creativeDirectionPresent,
        wordCount: wc,
        characterCount: cc,
        estimatedMinutes: estMinutes,
        rawMetadata: result.metadata,
      });
    }

    fs.writeFileSync(path.join(caseDir, "metadata.json"), JSON.stringify(caseMetadata, null, 2), "utf8");
  }

  console.log(`\n[run-sleep-story-end-to-end-quality-benchmark] done -- output written to ${runRoot}`);
  console.log(
    `\n${"caseId".padEnd(46)}${"pipeline".padEnd(22)}${"preset".padEnd(16)}${"cd?".padEnd(6)}${"words".padEnd(
      8
    )}${"chars".padEnd(8)}${"est.min".padEnd(9)}target`
  );
  for (const row of summaryRows) {
    console.log(
      `${row.caseId.padEnd(46)}${row.pipeline.padEnd(22)}${String(row.preset).padEnd(16)}${String(
        row.creativeDirectionPresent
      ).padEnd(6)}${String(row.wordCount).padEnd(8)}${String(row.characterCount).padEnd(8)}${String(
        row.estimatedMinutes
      ).padEnd(9)}${row.targetMinutes}`
    );
  }
}

main();
