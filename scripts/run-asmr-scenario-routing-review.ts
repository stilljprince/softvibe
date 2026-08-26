// scripts/run-asmr-scenario-routing-review.ts
//
// RP-011C.8.8.4I -- ASMR Scenario Routing Quality Review.
//
// Live, human-review-only comparison of the old pipeline vs. the Creative
// Intelligence pipeline (post RP-011C.8.8.4G ASMR Scenario Routing
// Calibration), using the 5 prompts specified for this task. Reuses the
// existing benchmark harness (scripts/narrative-benchmark/**) unmodified --
// this file only supplies its own case list and a metadata summary, it does
// not add cases to the shared cases/index.ts registry and does not touch
// any adapter, classifier, writer prompt, guidance, or template.
//
// Prompt wording is exact and must not be edited -- this review's premise
// depends on these being the literal 5 prompts specified for RP-011C.8.8.4I.
//
// This script does not modify any implementation file. It only calls the
// existing, unmodified OldPipelineAdapter / CreativeIntelligenceAdapter
// live paths and writes output under benchmark-output/, never to a
// database.
//
// Run with:
//   CONFIRM_LIVE_BENCHMARK=true npx tsx scripts/run-asmr-scenario-routing-review.ts

import fs from "node:fs";
import path from "node:path";

import type { BenchmarkCase, BenchmarkResult } from "./narrative-benchmark/runners/types";
import { runCaseThroughAdapters } from "./narrative-benchmark/runners/benchmark-runner";
import { OldPipelineAdapter } from "./narrative-benchmark/adapters/old-pipeline";
import { CreativeIntelligenceAdapter } from "./narrative-benchmark/adapters/creative-intelligence";
import { loadEnvironment, enforceLiveModeGuards } from "./run-narrative-benchmark";

const REVIEW_CASES: BenchmarkCase[] = [
  {
    id: "asmr-scenario-routing-01-pure-presence",
    category: "asmr-scenario-routing-review",
    prompt: "Create a gentle ASMR whisper experience with a calm voice and soft spoken presence.",
    preset: "classic-asmr",
    durationMinutes: 12,
    expectedQualities: [
      "pure presence -- no scenario, companion, or character introduced",
      "gentle, whispered vocal quality",
      "calm, steady tone",
    ],
  },
  {
    id: "asmr-scenario-routing-02-close-friend-companion",
    category: "asmr-scenario-routing-review",
    prompt:
      "Create an ASMR experience where a close friend sits with me after a difficult day and talks with me softly.",
    preset: "classic-asmr",
    durationMinutes: 12,
    expectedQualities: [
      "close-friend companion framing preserved, not diluted into generic comfort text",
      "acknowledgement of a difficult day",
      "soft, direct address from the friend to the listener",
    ],
  },
  {
    id: "asmr-scenario-routing-03-personal-attention",
    category: "asmr-scenario-routing-review",
    prompt:
      "Create a gentle ASMR personal attention session where someone takes care of me after a stressful day.",
    preset: "classic-asmr",
    durationMinutes: 12,
    expectedQualities: [
      "personal-attention / caretaking framing preserved from the prompt",
      "acknowledgement of a stressful day",
      "listener is the direct recipient of care",
    ],
  },
  {
    id: "asmr-scenario-routing-04-librarian-roleplay",
    category: "asmr-scenario-routing-review",
    prompt:
      "Create an ASMR librarian roleplay where a kind librarian talks with me, recommends a book, and reads a few pages aloud.",
    preset: "classic-asmr",
    durationMinutes: 12,
    expectedQualities: [
      "librarian persona explicitly present",
      "book recommendation as a concrete in-scene action",
      "reads pages aloud as a concrete in-scene action",
    ],
  },
  {
    id: "asmr-scenario-routing-05-mystery-candlelight",
    category: "asmr-scenario-routing-review",
    prompt: "Create a mysterious ASMR experience where someone whispers a secret to me by candlelight.",
    preset: "classic-asmr",
    durationMinutes: 12,
    expectedQualities: [
      "mystery/secret atmosphere preserved, not diluted into generic ASMR presence",
      "candlelit, whispered-secret framing carried through delivery",
      "ASMR vocal identity (soft, close, whispered) maintained alongside the atmosphere",
    ],
  },
];

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function main(): void {
  loadEnvironment();
  enforceLiveModeGuards("live");

  run().catch((err) => {
    console.error("[run-asmr-scenario-routing-review] failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

async function run(): Promise<void> {
  const adapters = [new OldPipelineAdapter("live"), new CreativeIntelligenceAdapter("live")];

  const outRoot = "benchmark-output";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runRoot = path.join(outRoot, `asmr-scenario-routing-review-${timestamp}`);

  const summaryRows: Array<{
    caseId: string;
    pipeline: string;
    preset: unknown;
    asmrMode: unknown;
    creativeDirectionPresent: boolean;
    wordCount: number;
    characterCount: number;
  }> = [];

  for (const benchmarkCase of REVIEW_CASES) {
    console.log(`[run-asmr-scenario-routing-review] running case "${benchmarkCase.id}"...`);
    const results: BenchmarkResult[] = await runCaseThroughAdapters(benchmarkCase, adapters);

    const caseDir = path.join(runRoot, benchmarkCase.id);
    fs.mkdirSync(caseDir, { recursive: true });

    const caseMetadata: Record<string, unknown> = { caseId: benchmarkCase.id, prompt: benchmarkCase.prompt, pipelines: [] };

    for (const result of results) {
      const fileName = result.pipelineName === "old" ? "old.txt" : "creative-intelligence.txt";
      fs.writeFileSync(path.join(caseDir, fileName), result.output, "utf8");

      const intent = (result.metadata as Record<string, unknown>).intent as
        | { preset?: unknown; asmrMode?: unknown; creativeDirection?: unknown }
        | undefined;

      const preset = intent?.preset ?? (result.metadata as Record<string, unknown>).preset;
      const asmrMode = intent?.asmrMode;
      const creativeDirectionPresent = intent ? intent.creativeDirection !== undefined : false;
      const wc = wordCount(result.output);
      const cc = result.output.length;

      summaryRows.push({
        caseId: benchmarkCase.id,
        pipeline: result.pipelineName,
        preset,
        asmrMode,
        creativeDirectionPresent,
        wordCount: wc,
        characterCount: cc,
      });

      (caseMetadata.pipelines as unknown[]).push({
        pipelineName: result.pipelineName,
        preset,
        asmrMode,
        creativeDirectionPresent,
        wordCount: wc,
        characterCount: cc,
        rawMetadata: result.metadata,
      });
    }

    fs.writeFileSync(path.join(caseDir, "metadata.json"), JSON.stringify(caseMetadata, null, 2), "utf8");
  }

  console.log(`\n[run-asmr-scenario-routing-review] done -- output written to ${runRoot}`);
  console.log(
    `\n${"caseId".padEnd(42)}${"pipeline".padEnd(22)}${"preset".padEnd(16)}${"asmrMode".padEnd(12)}${"cd?".padEnd(6)}${"words".padEnd(8)}chars`
  );
  for (const row of summaryRows) {
    console.log(
      `${row.caseId.padEnd(42)}${row.pipeline.padEnd(22)}${String(row.preset).padEnd(16)}${String(
        row.asmrMode
      ).padEnd(12)}${String(row.creativeDirectionPresent).padEnd(6)}${String(row.wordCount).padEnd(8)}${
        row.characterCount
      }`
    );
  }
}

main();
