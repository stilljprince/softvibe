// scripts/run-asmr-final-quality-regression.ts
//
// RP-011C.8.8.4K -- ASMR Final Quality Regression Check.
//
// Live, human-review-only comparison of the old pipeline vs. the Creative
// Intelligence pipeline, after:
//   RP-011C.8.8.4G -- Scenario Routing Calibration
//   RP-011C.8.8.4H -- Routing Validation
//   RP-011C.8.8.4J -- Atmospheric Scenario Signal Expansion
//
// Reuses the existing benchmark harness (scripts/narrative-benchmark/**)
// unmodified -- this file only supplies its own case list and a metadata
// summary. It does not add cases to the shared cases/index.ts registry and
// does not touch any adapter, classifier, writer prompt, guidance, or
// template.
//
// Prompt wording is exact and must not be edited -- this review's premise
// depends on these being the literal 4 prompts specified for
// RP-011C.8.8.4K.
//
// This script does not modify any implementation file. It only calls the
// existing, unmodified OldPipelineAdapter / CreativeIntelligenceAdapter live
// paths and writes output under benchmark-output/, never to a database.
//
// Run with:
//   CONFIRM_LIVE_BENCHMARK=true npx tsx scripts/run-asmr-final-quality-regression.ts

import fs from "node:fs";
import path from "node:path";

import type { BenchmarkCase, BenchmarkResult } from "./narrative-benchmark/runners/types";
import { runCaseThroughAdapters } from "./narrative-benchmark/runners/benchmark-runner";
import { OldPipelineAdapter } from "./narrative-benchmark/adapters/old-pipeline";
import { CreativeIntelligenceAdapter } from "./narrative-benchmark/adapters/creative-intelligence";
import { loadEnvironment, enforceLiveModeGuards } from "./run-narrative-benchmark";

const REVIEW_CASES: BenchmarkCase[] = [
  {
    id: "asmr-final-regression-01-pure-presence",
    category: "asmr-final-quality-regression",
    prompt: "Create a gentle ASMR whisper experience with a calm voice and soft spoken presence.",
    preset: "classic-asmr",
    durationMinutes: 12,
    expectedQualities: [
      "pure presence -- no fictional persona or scenario introduced",
      "voice/rhythm/proximity focus",
      "gentle, whispered, calm tone",
    ],
  },
  {
    id: "asmr-final-regression-02-companion-scenario",
    category: "asmr-final-quality-regression",
    prompt:
      "Create an ASMR experience where a close friend sits with me after a difficult day and talks with me softly.",
    preset: "classic-asmr",
    durationMinutes: 12,
    expectedQualities: [
      "friend/persona framing preserved",
      "interaction between friend and listener",
      "concrete situation (a difficult day), not generic affirmation-only writing",
    ],
  },
  {
    id: "asmr-final-regression-03-librarian-roleplay",
    category: "asmr-final-quality-regression",
    prompt:
      "Create an ASMR librarian roleplay where a kind librarian talks with me, recommends a book, and reads a few pages aloud.",
    preset: "classic-asmr",
    durationMinutes: 12,
    expectedQualities: [
      "librarian persona explicitly present",
      "books present as concrete content",
      "reading aloud as a concrete in-scene action",
      "interaction between librarian and listener",
    ],
  },
  {
    id: "asmr-final-regression-04-mystery-atmosphere",
    category: "asmr-final-quality-regression",
    prompt: "Create a mysterious ASMR experience where someone whispers a secret to me by candlelight.",
    preset: "classic-asmr",
    durationMinutes: 12,
    expectedQualities: [
      "mystery atmosphere preserved",
      "candlelight/secret framing carried through delivery",
      "whispered storytelling, not a pure relaxation script or generic sleep affirmations",
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
    console.error("[run-asmr-final-quality-regression] failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

async function run(): Promise<void> {
  const adapters = [new OldPipelineAdapter("live"), new CreativeIntelligenceAdapter("live")];

  const outRoot = "benchmark-output";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runRoot = path.join(outRoot, `asmr-final-quality-regression-${timestamp}`);

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
    console.log(`[run-asmr-final-quality-regression] running case "${benchmarkCase.id}"...`);
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

  console.log(`\n[run-asmr-final-quality-regression] done -- output written to ${runRoot}`);
  console.log(
    `\n${"caseId".padEnd(46)}${"pipeline".padEnd(22)}${"preset".padEnd(16)}${"asmrMode".padEnd(12)}${"cd?".padEnd(6)}${"words".padEnd(8)}chars`
  );
  for (const row of summaryRows) {
    console.log(
      `${row.caseId.padEnd(46)}${row.pipeline.padEnd(22)}${String(row.preset).padEnd(16)}${String(
        row.asmrMode
      ).padEnd(12)}${String(row.creativeDirectionPresent).padEnd(6)}${String(row.wordCount).padEnd(8)}${
        row.characterCount
      }`
    );
  }
}

main();
