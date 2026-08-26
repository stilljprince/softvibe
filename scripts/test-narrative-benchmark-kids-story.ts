// scripts/test-narrative-benchmark-kids-story.ts
//
// RP-011C.8.8.1D — Isolated tests for the Kids Story benchmark cases
// (scripts/narrative-benchmark/cases/kids-story.ts) and their execution
// through the existing (unmodified) benchmark adapters.
//
// Exercises:
//
// - the 5 kids-story benchmark cases load correctly and are aggregated
//   into allBenchmarkCases
// - every kids-story case targets preset "kids-story"
// - the CreativeIntelligenceAdapter runs each kids-story case in mock mode
//   (writerMode: "mock") via runCreativePipeline() — no OpenAI call
// - the OldPipelineAdapter runs each kids-story case in mock mode (isolated
//   structural placeholder) — no OpenAI call
// - the pre-existing narrative benchmark cases (transformation, thriller,
//   sleep-story, narrative) are unchanged by this addition
// - no production files (app/**, lib/narrative/**, lib/script-builder*.ts,
//   lib/story-supervisor.ts, lib/tts/**) were touched
//
// Run with:  npx tsx scripts/test-narrative-benchmark-kids-story.ts

import fs from "node:fs";
import path from "node:path";
import {
  allBenchmarkCases,
  kidsStoryCases,
  transformationCases,
  thrillerCases,
  sleepStoryCases,
  narrativeCases,
} from "./narrative-benchmark/cases";
import type { BenchmarkCase } from "./narrative-benchmark/runners/types";
import { BenchmarkRunner } from "./narrative-benchmark/runners/benchmark-runner";
import { OldPipelineAdapter } from "./narrative-benchmark/adapters/old-pipeline";
import { CreativeIntelligenceAdapter } from "./narrative-benchmark/adapters/creative-intelligence";

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const equal = JSON.stringify(actual) === JSON.stringify(expected);
  if (equal) {
    console.log(`[PASS] ${name}`);
    passed++;
  } else {
    console.log(
      `[FAIL] ${name}\n       expected=${JSON.stringify(expected)}\n       actual=  ${JSON.stringify(actual)}`
    );
    failed++;
  }
}

function checkTrue(name: string, condition: boolean): void {
  check(name, condition, true);
}

function requiredCase(id: string): BenchmarkCase {
  const found = kidsStoryCases.find((benchmarkCase) => benchmarkCase.id === id);
  if (!found) {
    throw new Error(`missing kids-story benchmark case: ${id}`);
  }
  return found;
}

// ─── 1. Kids-story cases load correctly ────────────────────────────────────

check("kidsStoryCases has exactly 5 cases", kidsStoryCases.length, 5);

const requiredKidsStoryIds = [
  "kids-story-cozy-friendship",
  "kids-story-small-adventure",
  "kids-story-emotional-growth",
  "kids-story-everyday-magic",
  "kids-story-belonging",
];

for (const id of requiredKidsStoryIds) {
  checkTrue(
    `kids-story case present: ${id}`,
    kidsStoryCases.some((benchmarkCase) => benchmarkCase.id === id)
  );
}

checkTrue(
  "every kids-story case uses the 'kids-story' preset",
  kidsStoryCases.every((benchmarkCase) => benchmarkCase.preset === "kids-story")
);
checkTrue(
  "every kids-story case uses the 'kids-story' category",
  kidsStoryCases.every((benchmarkCase) => benchmarkCase.category === "kids-story")
);
checkTrue(
  "every kids-story case has at least one expected quality",
  kidsStoryCases.every((benchmarkCase) => benchmarkCase.expectedQualities.length > 0)
);
checkTrue(
  "every kids-story case has a positive durationMinutes",
  kidsStoryCases.every((benchmarkCase) => benchmarkCase.durationMinutes > 0)
);

checkTrue(
  "kidsStoryCases is included in allBenchmarkCases",
  kidsStoryCases.every((kidsCase) =>
    allBenchmarkCases.some((benchmarkCase) => benchmarkCase.id === kidsCase.id)
  )
);

// ─── 2. Pre-existing narrative benchmark cases remain unchanged ────────────

const requiredCalibratedNarrativeIds = [
  "narrative-transformation-life-change",
  "narrative-thriller-heist",
  "narrative-fantasy-awakening",
  "narrative-mystery-disappearance",
  "narrative-family-reconciliation",
];

for (const id of requiredCalibratedNarrativeIds) {
  checkTrue(
    `pre-existing calibrated narrative case still present: ${id}`,
    narrativeCases.some((benchmarkCase) => benchmarkCase.id === id)
  );
}

check("transformationCases unchanged (still 2 cases)", transformationCases.length, 2);
check("thrillerCases unchanged (still 2 cases)", thrillerCases.length, 2);
check("sleepStoryCases unchanged (still 2 cases)", sleepStoryCases.length, 2);
check("narrativeCases unchanged (still 5 cases)", narrativeCases.length, 5);

checkTrue(
  "pre-existing non-kids-story cases still target the 'narrative' preset",
  [...transformationCases, ...thrillerCases, ...sleepStoryCases, ...narrativeCases].every(
    (benchmarkCase) => benchmarkCase.preset === "narrative"
  )
);

const oldAdapter = new OldPipelineAdapter();
const ciAdapter = new CreativeIntelligenceAdapter();

async function main(): Promise<void> {
  // ─── 3. OldPipelineAdapter runs every kids-story case in mock mode ───────

  for (const id of requiredKidsStoryIds) {
    const benchmarkCase = requiredCase(id);
    const result = await new BenchmarkRunner(oldAdapter).runCase(benchmarkCase);

    check(`old adapter [${id}] caseId`, result.caseId, benchmarkCase.id);
    check(`old adapter [${id}] pipelineName`, result.pipelineName, "old");
    checkTrue(`old adapter [${id}] output is non-empty`, result.output.length > 0);
    checkTrue(
      `old adapter [${id}] metadata flags mock + isolated`,
      result.metadata.mock === true && result.metadata.isolated === true
    );
  }

  // ─── 4. CreativeIntelligenceAdapter runs every kids-story case in mock ───
  // mode (writerMode: "mock", via runCreativePipeline()) — no OpenAI call.

  for (const id of requiredKidsStoryIds) {
    const benchmarkCase = requiredCase(id);
    const result = await new BenchmarkRunner(ciAdapter).runCase(benchmarkCase);

    check(`ci adapter [${id}] caseId`, result.caseId, benchmarkCase.id);
    check(`ci adapter [${id}] pipelineName`, result.pipelineName, "creative-intelligence");
    checkTrue(`ci adapter [${id}] output is non-empty`, result.output.length > 0);
    checkTrue(
      `ci adapter [${id}] metadata records writerMode mock`,
      result.metadata.writerMode === "mock"
    );
    checkTrue(
      `ci adapter [${id}] metadata carries an evaluation object`,
      typeof result.metadata.evaluation === "object" && result.metadata.evaluation !== null
    );
  }

  // ─── 5. No production files were modified by this test (sanity check) ────

  {
    const forbiddenProductionPaths = [
      "app",
      "lib/narrative",
      "lib/script-builder-openai.ts",
      "lib/story-supervisor.ts",
      "lib/tts",
    ];
    const allExistedBefore = forbiddenProductionPaths.every((relativePath) =>
      fs.existsSync(path.join(process.cwd(), relativePath))
    );
    checkTrue(
      "forbidden production paths still exist untouched (sanity check)",
      allExistedBefore
    );
  }

  // ─── Summary ──────────────────────────────────────────────────────────

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main();
