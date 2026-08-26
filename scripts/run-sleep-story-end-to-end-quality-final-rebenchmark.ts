// scripts/run-sleep-story-end-to-end-quality-final-rebenchmark.ts
//
// RP-011C.8.10U -- Sleep Story Final End-to-End Quality Rebenchmark.
//
// Final live comparison of the old generation pipeline vs. the Creative
// Intelligence pipeline for the sleep-story preset, after the full
// RP-011C.8.10P -> RP-011C.8.10T calibration sequence (scenario-aware
// defaults, planning calibration, writer compliance, protagonist
// calibration, deterministic word budget). Follows the exact shape of
// run-sleep-story-end-to-end-quality-rebenchmark.ts (RP-011C.8.10Q) so the
// two runs stay directly comparable.
//
// Purpose: verify whether Sleep Story Creative Intelligence output is
// production-ready -- scenario fidelity, absence of the RP-011C.8.10M
// default-bias markers, named-protagonist preservation, cross-scene
// continuity, ending quality, ellipsis usage, and duration accuracy against
// the *current* word-budget assumption.
//
// Reuses the existing benchmark harness (scripts/narrative-benchmark/**)
// unmodified -- this file only supplies its own case list and a metadata
// summary. It does not add cases to the shared cases/index.ts registry and
// does not touch any adapter, classifier, writer prompt, guidance, or
// template.
//
// Prompt wording is exact and must not be edited -- this benchmark's premise
// depends on these being the literal 7 prompts specified for RP-011C.8.10U.
//
// This script does not modify any implementation file. It only calls the
// existing, unmodified OldPipelineAdapter / CreativeIntelligenceAdapter live
// paths and writes output under benchmark-output/, never to a database.
//
// Run with:
//   npx tsx scripts/run-sleep-story-end-to-end-quality-final-rebenchmark.ts --dry-run
//   CONFIRM_LIVE_BENCHMARK=true npx tsx scripts/run-sleep-story-end-to-end-quality-final-rebenchmark.ts --live

import fs from "node:fs";
import path from "node:path";

import type { BenchmarkCase, BenchmarkMode, BenchmarkResult } from "./narrative-benchmark/runners/types";
import { runCaseThroughAdapters } from "./narrative-benchmark/runners/benchmark-runner";
import { OldPipelineAdapter } from "./narrative-benchmark/adapters/old-pipeline";
import { CreativeIntelligenceAdapter } from "./narrative-benchmark/adapters/creative-intelligence";
import { loadEnvironment, enforceLiveModeGuards } from "./run-narrative-benchmark";

const BENCHMARK_CASES: BenchmarkCase[] = [
  {
    id: "sleep-story-final-01-cozy-cottage",
    category: "sleep-story-end-to-end-quality-final-rebenchmark",
    prompt:
      "A cozy bedtime story about a small cottage in the woods where someone spends a peaceful evening.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: [
      "cottage-in-the-woods setting preserved",
      "cozy, unhurried evening atmosphere",
      "a single figure spending the evening is fine; no companion required",
      "cottage/tea/hearth imagery is fidelity here, not template bias",
    ],
  },
  {
    id: "sleep-story-final-02-valley-under-stars",
    category: "sleep-story-end-to-end-quality-final-rebenchmark",
    prompt: "A peaceful bedtime story about walking through a quiet valley beneath the stars.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: [
      "valley remains central",
      "walking journey remains central",
      "stars/night-sky atmosphere preserved",
      "no forced cottage/hearth/tea interior",
      "no unnecessary companion",
    ],
  },
  {
    id: "sleep-story-final-03-train-conductor",
    category: "sleep-story-end-to-end-quality-final-rebenchmark",
    prompt: "A cozy sleep story about a train conductor traveling through snowy mountains.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: [
      "train journey remains central",
      "snowy mountains preserved",
      "named protagonist (train conductor role) plausible -- the conductor should stay the protagonist, not be replaced by a generic traveler",
      "no forced companion unless natural",
      "no danger/urgency",
    ],
  },
  {
    id: "sleep-story-final-04-lighthouse-keeper",
    category: "sleep-story-end-to-end-quality-final-rebenchmark",
    prompt:
      "A calming bedtime story about a lighthouse keeper watching over the coast during a quiet night.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: [
      "lighthouse and coast remain central",
      "keeper stays the protagonist, not replaced by a generic traveler",
      "solitude and quiet duty atmosphere preserved",
      "no forced companion",
      "no storm/rescue/danger escalation",
    ],
  },
  {
    id: "sleep-story-final-05-ocean-journey",
    category: "sleep-story-end-to-end-quality-final-rebenchmark",
    prompt: "A gentle sleep story about drifting along a peaceful ocean under moonlight.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: [
      "ocean/drifting remains central",
      "moonlight atmosphere preserved",
      "no forced cottage/host/arrival pattern",
      "no unnecessary companion",
    ],
  },
  {
    id: "sleep-story-final-06-generic-sleep-story",
    category: "sleep-story-end-to-end-quality-final-rebenchmark",
    prompt: "A relaxing sleep story to help me fall asleep.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: [
      "this is the generic/no-explicit-scenario control case -- used to check whether default bias reappears when there is no concrete scenario to anchor on",
      "a template default (traveler/cottage/arrival) is acceptable here since there is no user scenario to preserve",
      "an invented but coherent scenario of the model's own is equally acceptable",
      "what matters is that whatever happens here does NOT also appear in the six scenario-anchored cases",
    ],
  },
  {
    id: "sleep-story-final-07-fantasy-village",
    category: "sleep-story-end-to-end-quality-final-rebenchmark",
    prompt: "A bedtime story about a quiet magical village hidden between ancient trees.",
    preset: "sleep-story",
    durationMinutes: 20,
    expectedQualities: [
      "magical village preserved",
      "ancient-tree/forest setting preserved",
      "gentle magic without spectacle",
      "no escalation/adventure/quest structure",
      "no forced welcome-the-traveler ritual",
    ],
  },
];

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

// Sleep Story's spoken-word rate. Mirrors
// PRESET_WORDS_PER_MINUTE["sleep-story"] in
// lib/creative-intelligence/guidance/duration-budget.ts -- redeclared rather
// than imported, following the same "mirror, don't import" convention that
// module itself uses, so this benchmark script stays free of any
// lib/creative-intelligence dependency.
const SLEEP_STORY_WORDS_PER_MINUTE = 135;

// The rate the RP-011C.8.10J/Q scripts used. Kept only so this run's numbers
// can be compared back to those reports without recomputation.
const LEGACY_BENCHMARK_WORDS_PER_MINUTE = 150;

function estimatedDurationMinutes(words: number): number {
  return Math.round((words / SLEEP_STORY_WORDS_PER_MINUTE) * 10) / 10;
}

function legacyEstimatedDurationMinutes(words: number): number {
  return Math.round((words / LEGACY_BENCHMARK_WORDS_PER_MINUTE) * 10) / 10;
}

function overshootPercent(estimatedMinutes: number, targetMinutes: number): number {
  return Math.round(((estimatedMinutes - targetMinutes) / targetMinutes) * 1000) / 10;
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
      "[run-sleep-story-end-to-end-quality-final-rebenchmark] failed:",
      err instanceof Error ? err.message : err
    );
    process.exit(1);
  });
}

async function run(mode: BenchmarkMode): Promise<void> {
  const adapters = [new OldPipelineAdapter(mode), new CreativeIntelligenceAdapter(mode)];

  const outRoot = "benchmark-output";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runRoot = path.join(outRoot, `sleep-story-end-to-end-quality-final-rebenchmark-${timestamp}`);

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
    legacyEstimatedMinutes: number;
    overshootPercent: number;
    targetMinutes: number;
    durationMs: unknown;
  }> = [];

  for (const benchmarkCase of BENCHMARK_CASES) {
    console.log(`[run-sleep-story-end-to-end-quality-final-rebenchmark] running case "${benchmarkCase.id}"...`);
    const results: BenchmarkResult[] = await runCaseThroughAdapters(benchmarkCase, adapters);

    const caseDir = path.join(runRoot, benchmarkCase.id);
    fs.mkdirSync(caseDir, { recursive: true });

    const caseMetadata: Record<string, unknown> = {
      caseId: benchmarkCase.id,
      prompt: benchmarkCase.prompt,
      expectedQualities: benchmarkCase.expectedQualities,
      targetDurationMinutes: benchmarkCase.durationMinutes,
      wordsPerMinute: SLEEP_STORY_WORDS_PER_MINUTE,
      legacyWordsPerMinute: LEGACY_BENCHMARK_WORDS_PER_MINUTE,
      pipelines: [],
    };

    for (const result of results) {
      const fileName = result.pipelineName === "old" ? "old.txt" : "creative-intelligence.txt";
      fs.writeFileSync(path.join(caseDir, fileName), result.output, "utf8");

      const rawMetadata = result.metadata as Record<string, unknown>;
      const intent = rawMetadata.intent as
        | { preset?: unknown; creativeDirection?: unknown; hasExplicitScenario?: unknown; storyScale?: unknown }
        | undefined;

      const preset = intent?.preset ?? rawMetadata.preset;
      const creativeDirectionPresent = intent ? intent.creativeDirection !== undefined : false;
      const hasExplicitScenario = intent?.hasExplicitScenario;
      const storyScale = intent?.storyScale;
      const wc = wordCount(result.output);
      const cc = result.output.length;
      const estMinutes = estimatedDurationMinutes(wc);
      const legacyEstMinutes = legacyEstimatedDurationMinutes(wc);
      const overshoot = overshootPercent(estMinutes, benchmarkCase.durationMinutes);

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
        legacyEstimatedMinutes: legacyEstMinutes,
        overshootPercent: overshoot,
        targetMinutes: benchmarkCase.durationMinutes,
        durationMs: rawMetadata.durationMs,
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
        legacyEstimatedMinutes: legacyEstMinutes,
        overshootPercent: overshoot,
        rawMetadata: result.metadata,
      });
    }

    fs.writeFileSync(path.join(caseDir, "metadata.json"), JSON.stringify(caseMetadata, null, 2), "utf8");
  }

  console.log(`\n[run-sleep-story-end-to-end-quality-final-rebenchmark] done -- output written to ${runRoot}`);
  console.log(
    `\n${"caseId".padEnd(42)}${"pipeline".padEnd(24)}${"cd?".padEnd(6)}${"expl?".padEnd(7)}${"scale".padEnd(
      16
    )}${"words".padEnd(8)}${"est135".padEnd(8)}${"est150".padEnd(8)}${"over%".padEnd(8)}target`
  );
  for (const row of summaryRows) {
    console.log(
      `${row.caseId.padEnd(42)}${row.pipeline.padEnd(24)}${String(row.creativeDirectionPresent).padEnd(6)}${String(
        row.hasExplicitScenario
      ).padEnd(7)}${String(row.storyScale).padEnd(16)}${String(row.wordCount).padEnd(8)}${String(
        row.estimatedMinutes
      ).padEnd(8)}${String(row.legacyEstimatedMinutes).padEnd(8)}${String(row.overshootPercent).padEnd(8)}${
        row.targetMinutes
      }`
    );
  }
}

main();
