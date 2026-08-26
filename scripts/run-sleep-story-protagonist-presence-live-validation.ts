// scripts/run-sleep-story-protagonist-presence-live-validation.ts
//
// RP-011C.8.10V.5 -- Sleep Story Protagonist Presence Live Validation.
//
// RP-011C.8.10U (docs/sleep-story-end-to-end-quality-final-rebenchmark-report.md)
// found that RP-011C.8.10R1's "do not replace a named figure with a generic
// traveler" instruction stopped substitution, but the Writer overcorrected
// the other way: in 4 of 7 cases it removed an established figure entirely,
// producing agentless passive prose ("A cup was taken down from a shelf") or
// bodyless description ("the hands", "the walking") instead of keeping the
// figure the creative direction named. RP-011C.8.10V
// (scripts/test-creative-intelligence-sleep-story-protagonist-presence-calibration.ts)
// added a Writer-prompt instruction, verified only at the prompt-text level,
// telling the Writer not to remove or abstract an established figure. This
// script is the first live check of whether the model actually obeys that
// instruction, and whether it does so without reintroducing the
// traveler/companion bias R1 fixed or forcing a protagonist into
// environment-only scenarios.
//
// This script is benchmark-only: it does not modify any production file,
// does not implement any fix, and reuses the existing, unmodified
// scripts/narrative-benchmark/** adapters/runner, following the shape of
// scripts/run-sleep-story-protagonist-calibration-live-validation.ts
// (RP-011C.8.10R1.5). Like that script, this one only exercises the
// CreativeIntelligenceAdapter -- no old-pipeline comparison.
//
// Run with:
//   npx tsx scripts/run-sleep-story-protagonist-presence-live-validation.ts --dry-run
//   CONFIRM_LIVE_BENCHMARK=true npx tsx scripts/run-sleep-story-protagonist-presence-live-validation.ts --live

import fs from "node:fs";
import path from "node:path";

import type { BenchmarkCase, BenchmarkMode, BenchmarkResult } from "./narrative-benchmark/runners/types";
import { runCaseThroughAdapters } from "./narrative-benchmark/runners/benchmark-runner";
import { CreativeIntelligenceAdapter } from "./narrative-benchmark/adapters/creative-intelligence";
import { loadEnvironment, enforceLiveModeGuards } from "./run-narrative-benchmark";

const BENCHMARK_CASES: BenchmarkCase[] = [
  {
    id: "protagonist-presence-01-train-conductor",
    category: "sleep-story-protagonist-presence-live-validation",
    prompt: "A cozy sleep story about a train conductor traveling through snowy mountains.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: [
      "train conductor remains the sustained protagonist",
      "no passive/object-centered disappearance",
      "no generic traveler replacement",
    ],
  },
  {
    id: "protagonist-presence-02-lighthouse-keeper",
    category: "sleep-story-protagonist-presence-live-validation",
    prompt:
      "A calming bedtime story about a lighthouse keeper watching over the coast during a quiet night.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: [
      "lighthouse keeper remains the sustained protagonist",
      "no passive/object-centered disappearance",
      "no invented traveler",
    ],
  },
  {
    id: "protagonist-presence-03-old-gardener",
    category: "sleep-story-protagonist-presence-live-validation",
    prompt: "A gentle sleep story about an old gardener caring for a quiet magical garden.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: [
      "gardener remains the sustained protagonist",
      "garden remains central",
      "no passive/object-centered disappearance",
    ],
  },
  {
    id: "protagonist-presence-04-valley-under-stars",
    category: "sleep-story-protagonist-presence-live-validation",
    prompt: "A peaceful bedtime story about walking through a quiet valley beneath the stars.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: [
      "environment remains central",
      "no forced protagonist introduction",
      "no traveler-bias reintroduction",
    ],
  },
  {
    id: "protagonist-presence-05-ocean",
    category: "sleep-story-protagonist-presence-live-validation",
    prompt: "A gentle sleep story about drifting along a peaceful ocean under moonlight.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: [
      "environment remains central",
      "no forced protagonist introduction",
      "no traveler-bias reintroduction",
    ],
  },
  {
    id: "protagonist-presence-06-generic",
    category: "sleep-story-protagonist-presence-live-validation",
    prompt: "A relaxing sleep story to help me fall asleep.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: [
      "generic Sleep Story defaults allowed",
      "no forced companion",
      "default bias regression check",
    ],
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
      "[run-sleep-story-protagonist-presence-live-validation] failed:",
      err instanceof Error ? err.message : err
    );
    process.exit(1);
  });
}

async function run(mode: BenchmarkMode): Promise<void> {
  const adapters = [new CreativeIntelligenceAdapter(mode)];

  const outRoot = "benchmark-output";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runRoot = path.join(outRoot, `sleep-story-protagonist-presence-live-validation-${timestamp}`);

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
    console.log(`[run-sleep-story-protagonist-presence-live-validation] running case "${benchmarkCase.id}"...`);
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

  console.log(`\n[run-sleep-story-protagonist-presence-live-validation] done -- output written to ${runRoot}`);
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
