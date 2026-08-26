// scripts/run-sleep-story-protagonist-calibration-live-validation.ts
//
// RP-011C.8.10R1.5 -- Sleep Story Protagonist Calibration Live Validation.
//
// RP-011C.8.10R1 added a Writer-prompt instruction (see
// scripts/test-creative-intelligence-sleep-story-scenario-aware-defaults.ts)
// telling the Writer, for any sleep-story prompt with an explicit scenario,
// to (a) keep a user-named central figure as the protagonist instead of
// replacing them with an invented generic figure, and (b) not introduce a
// traveler/companion/host/welcome ritual unless it fits the prompt. That
// change was verified only at the prompt-text level (a deterministic,
// non-LLM unit suite asserting the instruction string is present in the
// Writer's user prompt). It has never been checked against real model
// output -- this script is the first live check of whether the model
// actually obeys that instruction.
//
// RP-011C.8.10Q (docs/sleep-story-end-to-end-quality-rebenchmark-report.md)
// found that for prompts with NO named central figure (valley, train,
// coastline), the Creative Intelligence pipeline produced an anonymous
// "the traveler" protagonist in 4 of 5 cases -- flagged as a residual,
// out-of-scope-for-that-task observation ("protagonist is now anonymous
// rather than mistemplated"). That benchmark never tested a prompt that
// names a role (train conductor, lighthouse keeper, gardener), so this is
// also the first live test of the named-figure case.
//
// This script is benchmark-only: it does not modify any production file,
// does not implement any fix, and reuses the existing, unmodified
// scripts/narrative-benchmark/** adapters/runner exactly as
// scripts/run-sleep-story-end-to-end-quality-rebenchmark.ts (RP-011C.8.10Q)
// did. Unlike that script, this one only exercises the
// CreativeIntelligenceAdapter -- this task is scoped to Creative
// Intelligence output only, not an old-pipeline comparison.
//
// Run with:
//   npx tsx scripts/run-sleep-story-protagonist-calibration-live-validation.ts --dry-run
//   CONFIRM_LIVE_BENCHMARK=true npx tsx scripts/run-sleep-story-protagonist-calibration-live-validation.ts --live

import fs from "node:fs";
import path from "node:path";

import type { BenchmarkCase, BenchmarkMode, BenchmarkResult } from "./narrative-benchmark/runners/types";
import { runCaseThroughAdapters } from "./narrative-benchmark/runners/benchmark-runner";
import { CreativeIntelligenceAdapter } from "./narrative-benchmark/adapters/creative-intelligence";
import { loadEnvironment, enforceLiveModeGuards } from "./run-narrative-benchmark";

const BENCHMARK_CASES: BenchmarkCase[] = [
  {
    id: "protagonist-calib-01-train-conductor",
    category: "sleep-story-protagonist-calibration-live-validation",
    prompt: "A cozy bedtime story about a train conductor traveling through snowy mountains.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: ["train conductor remains central", "no generic traveler replacement"],
  },
  {
    id: "protagonist-calib-02-lighthouse-keeper",
    category: "sleep-story-protagonist-calibration-live-validation",
    prompt: "A gentle bedtime story about a lighthouse keeper watching over a quiet coastline.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: ["lighthouse keeper remains central", "no invented traveler"],
  },
  {
    id: "protagonist-calib-03-old-gardener",
    category: "sleep-story-protagonist-calibration-live-validation",
    prompt: "A peaceful bedtime story about an old gardener caring for a magical garden.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: ["gardener remains central", "garden remains central"],
  },
  {
    id: "protagonist-calib-04-valley-under-stars",
    category: "sleep-story-protagonist-calibration-live-validation",
    prompt: "A bedtime story about walking through a peaceful valley under the stars.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: ["environment remains central", "no unnecessary protagonist introduction"],
  },
  {
    id: "protagonist-calib-05-snowy-train-journey",
    category: "sleep-story-protagonist-calibration-live-validation",
    prompt: "A calming bedtime story about a slow train journey through snowy mountains.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: ["train journey remains central", "no default traveler pattern"],
  },
  {
    id: "protagonist-calib-06-generic-sleep-story",
    category: "sleep-story-protagonist-calibration-live-validation",
    prompt: "A relaxing bedtime story to help me fall asleep.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: ["no forced traveler", "no forced companion", "generic Sleep Story defaults allowed"],
  },
  {
    id: "protagonist-calib-07-cottage",
    category: "sleep-story-protagonist-calibration-live-validation",
    prompt: "A cozy bedtime story about a small cottage in the woods with warm lights.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: ["cottage preserved", "no issue if a character appears naturally"],
  },
  {
    id: "protagonist-calib-08-ocean-journey",
    category: "sleep-story-protagonist-calibration-live-validation",
    prompt: "A calming bedtime story about traveling along a peaceful coastline while listening to the waves.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: ["ocean/coast remains central", "no forced traveler character"],
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
      "[run-sleep-story-protagonist-calibration-live-validation] failed:",
      err instanceof Error ? err.message : err
    );
    process.exit(1);
  });
}

async function run(mode: BenchmarkMode): Promise<void> {
  const adapters = [new CreativeIntelligenceAdapter(mode)];

  const outRoot = "benchmark-output";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runRoot = path.join(outRoot, `sleep-story-protagonist-calibration-live-validation-${timestamp}`);

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
    console.log(`[run-sleep-story-protagonist-calibration-live-validation] running case "${benchmarkCase.id}"...`);
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
      fs.writeFileSync(path.join(caseDir, "creative-intelligence.txt"), result.output, "utf8");

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
        creativeDirection: intent?.creativeDirection,
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

  console.log(`\n[run-sleep-story-protagonist-calibration-live-validation] done -- output written to ${runRoot}`);
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
