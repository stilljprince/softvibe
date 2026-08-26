// scripts/run-sleep-story-creative-direction-quality-benchmark.ts
//
// RP-011C.8.10M -- Sleep Story Creative Direction Quality Benchmark.
//
// Validates whether the RP-011C.8.10L fix (Creative Intelligence's sleep-story
// intent now populates `creativeDirection` verbatim from the user's prompt,
// via classifyCreativeDirection() in lib/creative-intelligence/intent/
// classifiers.ts) actually improves generated output quality -- i.e. whether
// the Writer follows the preserved scenario instead of collapsing every
// prompt into the same generic cottage/traveler/companion template found by
// RP-011C.8.10J.
//
// This is a benchmark/review-only script. It does not add cases to the
// shared cases/index.ts registry and does not modify any adapter, classifier,
// writer prompt/template, or other production file. It reuses the existing,
// unmodified benchmark harness (scripts/narrative-benchmark/**) exactly as
// run-sleep-story-end-to-end-quality-benchmark.ts (RP-011C.8.10J) did.
//
// Prompt wording is exact and must not be edited -- this benchmark's premise
// depends on these being the literal 5 prompts specified for RP-011C.8.10M.
//
// Run with:
//   npx tsx scripts/run-sleep-story-creative-direction-quality-benchmark.ts --dry-run
//   CONFIRM_LIVE_BENCHMARK=true npx tsx scripts/run-sleep-story-creative-direction-quality-benchmark.ts --live

import fs from "node:fs";
import path from "node:path";

import type { BenchmarkCase, BenchmarkMode, BenchmarkResult } from "./narrative-benchmark/runners/types";
import { runCaseThroughAdapters } from "./narrative-benchmark/runners/benchmark-runner";
import { OldPipelineAdapter } from "./narrative-benchmark/adapters/old-pipeline";
import { CreativeIntelligenceAdapter } from "./narrative-benchmark/adapters/creative-intelligence";
import { loadEnvironment, enforceLiveModeGuards } from "./run-narrative-benchmark";

const BENCHMARK_CASES: BenchmarkCase[] = [
  {
    id: "sleep-story-cd-01-cozy-cottage",
    category: "sleep-story-creative-direction-quality-benchmark",
    prompt:
      "A cozy bedtime story about a small cottage in the woods, with warm lights, tea, and a peaceful evening.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: ["setting preservation", "cozy atmosphere", "Sleep Story identity"],
  },
  {
    id: "sleep-story-cd-02-valley-under-stars",
    category: "sleep-story-creative-direction-quality-benchmark",
    prompt: "A bedtime story about walking through a peaceful valley under the stars.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: [
      "valley setting preserved",
      "walking journey preserved",
      "stars/night atmosphere preserved",
    ],
  },
  {
    id: "sleep-story-cd-03-snowy-mountain-train",
    category: "sleep-story-creative-direction-quality-benchmark",
    prompt: "A cozy bedtime story about a slow train journey through snowy mountains.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: [
      "train journey preserved",
      "snowy mountain environment preserved",
      "no urgency/travel danger introduced",
    ],
  },
  {
    id: "sleep-story-cd-04-fantasy-village",
    category: "sleep-story-creative-direction-quality-benchmark",
    prompt:
      "A gentle bedtime story about discovering a quiet magical village where friendly people welcome the traveler.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: ["fantasy atmosphere preserved", "companions as warmth", "no adventure escalation"],
  },
  {
    id: "sleep-story-cd-05-ocean-journey",
    category: "sleep-story-creative-direction-quality-benchmark",
    prompt: "A calming bedtime story about traveling along a peaceful coastline while listening to the waves.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: ["coastal environment preserved", "sensory atmosphere", "sleep-compatible pacing"],
  },
];

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

// Rough spoken-word estimate at ~150 words/minute, matching the pacing
// assumption used elsewhere in the sleep-story / ASMR benchmark scripts.
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
      "[run-sleep-story-creative-direction-quality-benchmark] failed:",
      err instanceof Error ? err.message : err
    );
    process.exit(1);
  });
}

async function run(mode: BenchmarkMode): Promise<void> {
  const adapters = [new OldPipelineAdapter(mode), new CreativeIntelligenceAdapter(mode)];

  const outRoot = "benchmark-output";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runRoot = path.join(outRoot, `sleep-story-creative-direction-quality-benchmark-${timestamp}`);

  const summaryRows: Array<{
    caseId: string;
    pipeline: string;
    preset: unknown;
    creativeDirectionPresent: boolean;
    creativeDirectionMatchesPrompt: boolean;
    storyScale: unknown;
    wordCount: number;
    characterCount: number;
    estimatedMinutes: number;
    targetMinutes: number;
  }> = [];

  for (const benchmarkCase of BENCHMARK_CASES) {
    console.log(`[run-sleep-story-creative-direction-quality-benchmark] running case "${benchmarkCase.id}"...`);
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
        | { preset?: unknown; creativeDirection?: unknown; storyScale?: unknown }
        | undefined;

      const preset = intent?.preset ?? (result.metadata as Record<string, unknown>).preset;
      const creativeDirectionPresent = intent ? intent.creativeDirection !== undefined : false;
      const creativeDirectionMatchesPrompt =
        typeof intent?.creativeDirection === "string" && intent.creativeDirection === benchmarkCase.prompt.trim();
      const storyScale = intent?.storyScale;
      const wc = wordCount(result.output);
      const cc = result.output.length;
      const estMinutes = estimatedDurationMinutes(wc);

      summaryRows.push({
        caseId: benchmarkCase.id,
        pipeline: result.pipelineName,
        preset,
        creativeDirectionPresent,
        creativeDirectionMatchesPrompt,
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
        creativeDirectionMatchesPrompt,
        storyScale,
        wordCount: wc,
        characterCount: cc,
        estimatedMinutes: estMinutes,
        rawMetadata: result.metadata,
      });
    }

    fs.writeFileSync(path.join(caseDir, "metadata.json"), JSON.stringify(caseMetadata, null, 2), "utf8");
  }

  console.log(`\n[run-sleep-story-creative-direction-quality-benchmark] done -- output written to ${runRoot}`);
  console.log(
    `\n${"caseId".padEnd(38)}${"pipeline".padEnd(22)}${"preset".padEnd(14)}${"cd?".padEnd(6)}${"cd=prompt?".padEnd(
      12
    )}${"scale".padEnd(18)}${"words".padEnd(8)}${"chars".padEnd(8)}${"est.min".padEnd(9)}target`
  );
  for (const row of summaryRows) {
    console.log(
      `${row.caseId.padEnd(38)}${row.pipeline.padEnd(22)}${String(row.preset).padEnd(14)}${String(
        row.creativeDirectionPresent
      ).padEnd(6)}${String(row.creativeDirectionMatchesPrompt).padEnd(12)}${String(row.storyScale).padEnd(
        18
      )}${String(row.wordCount).padEnd(8)}${String(row.characterCount).padEnd(8)}${String(row.estimatedMinutes).padEnd(
        9
      )}${row.targetMinutes}`
    );
  }
}

main();
