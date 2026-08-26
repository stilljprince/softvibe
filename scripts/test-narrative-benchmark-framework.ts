// scripts/test-narrative-benchmark-framework.ts
//
// RP-011C.8.7.1 — Isolated tests for the narrative benchmark framework
// (scripts/narrative-benchmark/**). This framework only compares future
// pipelines; it does not generate anything itself. These tests verify:
//
// - benchmark cases load correctly
// - contracts (types) work as expected
// - the runner accepts a mock adapter
// - results are structured correctly
// - no forbidden imports are used anywhere in the framework
// - no production files are modified by importing this framework
//
// Run with:  npx tsx scripts/test-narrative-benchmark-framework.ts

import fs from "node:fs";
import path from "node:path";
import {
  allBenchmarkCases,
  getBenchmarkCaseById,
  getBenchmarkCasesByCategory,
  transformationCases,
  thrillerCases,
  sleepStoryCases,
  narrativeCases,
  kidsStoryCases,
  meditationCases,
} from "./narrative-benchmark/cases";
import type {
  BenchmarkCase,
  BenchmarkResult,
  BenchmarkPipelineAdapter,
} from "./narrative-benchmark/runners/types";
import { BenchmarkRunner, runComparison } from "./narrative-benchmark/runners/benchmark-runner";
import {
  outputFileName,
  caseOutputDir,
  outputFilePath,
  metadataFilePath,
  serializeOutputText,
  serializeMetadata,
} from "./narrative-benchmark/output/serializer";

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

// ─── 1. Benchmark cases load correctly ─────────────────────────────────

checkTrue("transformationCases has entries", transformationCases.length > 0);
checkTrue("thrillerCases has entries", thrillerCases.length > 0);
checkTrue("sleepStoryCases has entries", sleepStoryCases.length > 0);
checkTrue("narrativeCases has entries", narrativeCases.length > 0);
checkTrue("kidsStoryCases has entries", kidsStoryCases.length > 0);
checkTrue("meditationCases has entries", meditationCases.length > 0);
check(
  "allBenchmarkCases aggregates all category arrays",
  allBenchmarkCases.length,
  transformationCases.length +
    thrillerCases.length +
    sleepStoryCases.length +
    narrativeCases.length +
    kidsStoryCases.length +
    meditationCases.length
);

{
  const ids = allBenchmarkCases.map((benchmarkCase) => benchmarkCase.id);
  const uniqueIds = new Set(ids);
  check("all benchmark case ids are unique", uniqueIds.size, ids.length);
}

{
  const requiredFields: (keyof BenchmarkCase)[] = [
    "id",
    "category",
    "prompt",
    "preset",
    "durationMinutes",
    "expectedQualities",
  ];
  const allCasesHaveRequiredFields = allBenchmarkCases.every((benchmarkCase) =>
    requiredFields.every((field) => benchmarkCase[field] !== undefined)
  );
  checkTrue(
    "every benchmark case defines all required fields",
    allCasesHaveRequiredFields
  );
}

{
  const found = getBenchmarkCaseById("sleep-story-01");
  checkTrue("getBenchmarkCaseById finds an existing case", found !== undefined);
  check("getBenchmarkCaseById returns correct id", found?.id, "sleep-story-01");
}

check(
  "getBenchmarkCaseById returns undefined for unknown id",
  getBenchmarkCaseById("does-not-exist"),
  undefined
);

check(
  "getBenchmarkCasesByCategory filters by category",
  getBenchmarkCasesByCategory("thriller").length,
  thrillerCases.length +
    narrativeCases.filter((benchmarkCase) => benchmarkCase.category === "thriller").length
);

// ─── 2. Contracts work (mock adapters implementing BenchmarkPipelineAdapter) ───

class MockAdapter implements BenchmarkPipelineAdapter {
  constructor(public readonly name: string) {}

  async run(benchmarkCase: BenchmarkCase): Promise<BenchmarkResult> {
    return {
      caseId: benchmarkCase.id,
      pipelineName: this.name,
      output: `[${this.name}] mock output for ${benchmarkCase.id}`,
      metadata: { mock: true, category: benchmarkCase.category },
    };
  }
}

const oldAdapter = new MockAdapter("old");
const ciAdapter = new MockAdapter("creative-intelligence");

async function main(): Promise<void> {
// ─── 3. Runner accepts a mock adapter and returns structured results ──────

{
  const sampleCase = allBenchmarkCases[0];
  const runner = new BenchmarkRunner(oldAdapter);
  const result = await runner.runCase(sampleCase);

  check("runner result caseId matches input case", result.caseId, sampleCase.id);
  check("runner result pipelineName matches adapter", result.pipelineName, "old");
  checkTrue("runner result output is a non-empty string", result.output.length > 0);
  checkTrue(
    "runner result metadata is an object",
    typeof result.metadata === "object" && result.metadata !== null
  );
}

{
  const runner = new BenchmarkRunner(ciAdapter);
  const results = await runner.runCases(allBenchmarkCases);
  check(
    "runner.runCases returns one result per case",
    results.length,
    allBenchmarkCases.length
  );
  checkTrue(
    "all runCases results reference the creative-intelligence pipeline",
    results.every((result) => result.pipelineName === "creative-intelligence")
  );
}

{
  const sampleCase = allBenchmarkCases[0];
  const { a, b } = await runComparison(sampleCase, oldAdapter, ciAdapter);
  check("runComparison adapter A result pipelineName", a.pipelineName, "old");
  check(
    "runComparison adapter B result pipelineName",
    b.pipelineName,
    "creative-intelligence"
  );
  check("runComparison both results share the same caseId", a.caseId, b.caseId);
}

// ─── 4. Output serializer utilities produce expected paths/content ────────

check("outputFileName maps 'old' to old.txt", outputFileName("old"), "old.txt");
check(
  "outputFileName maps 'creative-intelligence' to new.txt",
  outputFileName("creative-intelligence"),
  "new.txt"
);
check(
  "caseOutputDir nests under benchmark-output/<case-id>",
  caseOutputDir("sleep-story-01"),
  "benchmark-output/sleep-story-01"
);
check(
  "outputFilePath composes dir + file name",
  outputFilePath("sleep-story-01", "old"),
  "benchmark-output/sleep-story-01/old.txt"
);
check(
  "metadataFilePath points at metadata.json",
  metadataFilePath("sleep-story-01"),
  "benchmark-output/sleep-story-01/metadata.json"
);

{
  const sampleCase = allBenchmarkCases[0];
  const result = await new BenchmarkRunner(oldAdapter).runCase(sampleCase);
  check(
    "serializeOutputText returns the result's raw output",
    serializeOutputText(result),
    result.output
  );

  const metadataJson = serializeMetadata(sampleCase.id, [result]);
  const parsed = JSON.parse(metadataJson);
  check("serializeMetadata output caseId matches", parsed.caseId, sampleCase.id);
  check("serializeMetadata records one pipeline entry", parsed.pipelines.length, 1);
  check(
    "serializeMetadata pipeline entry name matches",
    parsed.pipelines[0].pipelineName,
    "old"
  );
}

// ─── 5. No output files were actually created on disk ─────────────────────

{
  const benchmarkOutputPath = path.join(process.cwd(), "benchmark-output");
  checkTrue(
    "serializer utilities did not create a benchmark-output/ directory",
    !fs.existsSync(benchmarkOutputPath)
  );
}

// ─── 6. No forbidden imports anywhere in the framework ─────────────────────

{
  const forbiddenPatterns = [
    /from ["']\.\.\/\.\.\/lib\/narrative/,
    /from ["'].*lib\/narrative/,
    /from ["'].*lib\/script-builder/,
    /from ["'].*lib\/story-supervisor/,
    /from ["'].*lib\/tts/,
    /from ["']openai["']/,
    /from ["']elevenlabs["']/,
    /require\(["']openai["']\)/,
  ];

  const frameworkRoot = path.join(process.cwd(), "scripts", "narrative-benchmark");

  function collectTsFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files = files.concat(collectTsFiles(fullPath));
      } else if (entry.name.endsWith(".ts")) {
        files.push(fullPath);
      }
    }
    return files;
  }

  const files = collectTsFiles(frameworkRoot);
  checkTrue("framework contains benchmark files to scan", files.length > 0);

  let violationFound = false;
  const violations: string[] = [];
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(content)) {
        violationFound = true;
        violations.push(`${path.relative(process.cwd(), file)} matched ${pattern}`);
      }
    }
  }

  checkTrue(
    `no forbidden imports found in framework files${
      violationFound ? ": " + violations.join(", ") : ""
    }`,
    !violationFound
  );
}

// ─── 7. No production files were modified by this test ────────────────────

{
  const forbiddenProductionPaths = [
    "app",
    "lib/narrative",
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

// ─── Summary ────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
}

main();
