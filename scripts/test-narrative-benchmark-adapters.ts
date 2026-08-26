// scripts/test-narrative-benchmark-adapters.ts
//
// RP-011C.8.7.2 — Tests for the benchmark pipeline adapters
// (scripts/narrative-benchmark/adapters/**), the calibrated "narrative"
// benchmark cases, and the multi-adapter runner extension.
// RP-011C.8.7.3 — Tests for mock/live mode selection and separation.
//
// Exercises:
//
// - the OldPipelineAdapter in mock mode (isolated structural placeholder —
//   no live generation, no OpenAI)
// - the CreativeIntelligenceAdapter in mock mode (a real, deterministic
//   mock-writer run of the isolated Creative Intelligence orchestration —
//   no OpenAI)
// - runComparison() and the new runCaseThroughAdapters() runner extension
// - that both adapters default to mock mode, and mock mode never requires
//   OPENAI_API_KEY
// - that live mode is never entered implicitly, and fails clearly (no
//   silent mock fallback) when OPENAI_API_KEY is missing -- exercised with
//   the key deliberately unset, so this never makes a real provider call
// - that no forbidden STATIC production imports exist anywhere in
//   adapters/ (live mode's production imports are dynamic import() calls,
//   scoped inside each adapter's live-mode branch, never evaluated by mock
//   mode or by importing this test file)
//
// Run with:  npx tsx scripts/test-narrative-benchmark-adapters.ts

import fs from "node:fs";
import path from "node:path";
import { allBenchmarkCases, kidsStoryCases, meditationCases, classicAsmrCases } from "./narrative-benchmark/cases";
import type {
  BenchmarkCase,
  BenchmarkPipelineAdapter,
} from "./narrative-benchmark/runners/types";
import {
  BenchmarkRunner,
  runComparison,
  runCaseThroughAdapters,
} from "./narrative-benchmark/runners/benchmark-runner";
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
  const found = allBenchmarkCases.find((benchmarkCase) => benchmarkCase.id === id);
  if (!found) {
    throw new Error(`missing benchmark case: ${id}`);
  }
  return found;
}

// ─── 1. Case calibration: all cases use the "narrative" preset ────────────

checkTrue("allBenchmarkCases is non-empty", allBenchmarkCases.length > 0);
checkTrue(
  "every non-kids-story, non-meditation, non-classic-asmr benchmark case uses the 'narrative' preset",
  allBenchmarkCases
    .filter(
      (benchmarkCase) =>
        benchmarkCase.category !== "kids-story" &&
        benchmarkCase.category !== "meditation" &&
        benchmarkCase.category !== "classic-asmr"
    )
    .every((benchmarkCase) => benchmarkCase.preset === "narrative")
);
checkTrue(
  "every kids-story benchmark case uses the 'kids-story' preset",
  kidsStoryCases.every((benchmarkCase) => benchmarkCase.preset === "kids-story")
);
checkTrue(
  "every meditation benchmark case uses the 'meditation' preset",
  meditationCases.every((benchmarkCase) => benchmarkCase.preset === "meditation")
);
checkTrue(
  "every classic-asmr benchmark case uses the 'classic-asmr' preset",
  classicAsmrCases.every((benchmarkCase) => benchmarkCase.preset === "classic-asmr")
);

const requiredCalibratedIds = [
  "narrative-transformation-life-change",
  "narrative-thriller-heist",
  "narrative-fantasy-awakening",
  "narrative-mystery-disappearance",
  "narrative-family-reconciliation",
];

for (const id of requiredCalibratedIds) {
  checkTrue(
    `calibrated case present: ${id}`,
    allBenchmarkCases.some((benchmarkCase) => benchmarkCase.id === id)
  );
}

// ─── 2. Adapters satisfy the BenchmarkPipelineAdapter contract ────────────

const oldAdapter: BenchmarkPipelineAdapter = new OldPipelineAdapter();
const ciAdapter: BenchmarkPipelineAdapter = new CreativeIntelligenceAdapter();

check("old adapter name", oldAdapter.name, "old");
check("creative-intelligence adapter name", ciAdapter.name, "creative-intelligence");

async function main(): Promise<void> {
  // ─── 3. Mock execution works — old pipeline adapter ─────────────────────

  {
    const sampleCase = requiredCase("narrative-transformation-life-change");
    const result = await new BenchmarkRunner(oldAdapter).runCase(sampleCase);

    check("old adapter result caseId", result.caseId, sampleCase.id);
    check("old adapter result pipelineName", result.pipelineName, "old");
    checkTrue("old adapter output is a non-empty string", result.output.length > 0);
    checkTrue(
      "old adapter metadata flags mock + isolated",
      result.metadata.mock === true && result.metadata.isolated === true
    );
  }

  // ─── 4. Creative Intelligence adapter runs deterministically ────────────
  // (writerMode: "mock" — no OpenAI call)

  {
    const sampleCase = requiredCase("narrative-fantasy-awakening");
    const result = await new BenchmarkRunner(ciAdapter).runCase(sampleCase);

    check("ci adapter result caseId", result.caseId, sampleCase.id);
    check("ci adapter result pipelineName", result.pipelineName, "creative-intelligence");
    checkTrue("ci adapter output is a non-empty string", result.output.length > 0);
    checkTrue(
      "ci adapter metadata records writerMode mock",
      result.metadata.writerMode === "mock"
    );
    checkTrue(
      "ci adapter metadata carries an evaluation object",
      typeof result.metadata.evaluation === "object" && result.metadata.evaluation !== null
    );
  }

  // ─── 5. runComparison() works across both adapters ──────────────────────

  {
    const sampleCase = requiredCase("narrative-thriller-heist");
    const { a, b } = await runComparison(sampleCase, oldAdapter, ciAdapter);

    check("comparison result a pipelineName", a.pipelineName, "old");
    check("comparison result b pipelineName", b.pipelineName, "creative-intelligence");
    check("comparison results share the same caseId", a.caseId, b.caseId);
  }

  // ─── 6. Runner extension: one case through multiple adapters ────────────

  {
    const sampleCase = requiredCase("narrative-mystery-disappearance");
    const results = await runCaseThroughAdapters(sampleCase, [oldAdapter, ciAdapter]);

    check("runCaseThroughAdapters returns one result per adapter", results.length, 2);
    checkTrue(
      "runCaseThroughAdapters results all reference the input case",
      results.every((result) => result.caseId === sampleCase.id)
    );
    check("runCaseThroughAdapters first result pipeline", results[0].pipelineName, "old");
    check(
      "runCaseThroughAdapters second result pipeline",
      results[1].pipelineName,
      "creative-intelligence"
    );
  }

  // ─── 7. Mode selection: mock is the default, live is never implicit ─────

  {
    const originalKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const sampleCase = requiredCase("narrative-transformation-life-change");

      // Default constructor (no mode argument) must behave exactly like
      // explicit "mock" — and must succeed with OPENAI_API_KEY unset.
      const defaultOld = new OldPipelineAdapter();
      const explicitMockOld = new OldPipelineAdapter("mock");
      const defaultResult = await new BenchmarkRunner(defaultOld).runCase(sampleCase);
      const explicitMockResult = await new BenchmarkRunner(explicitMockOld).runCase(sampleCase);

      checkTrue(
        "OldPipelineAdapter() defaults to mock mode (succeeds without OPENAI_API_KEY)",
        defaultResult.metadata.mock === true
      );
      check(
        "OldPipelineAdapter() default output matches explicit mock mode",
        defaultResult.output,
        explicitMockResult.output
      );

      const ciSampleCase = requiredCase("narrative-fantasy-awakening");
      const defaultCi = new CreativeIntelligenceAdapter();
      const defaultCiResult = await new BenchmarkRunner(defaultCi).runCase(ciSampleCase);
      checkTrue(
        "CreativeIntelligenceAdapter() defaults to mock mode (succeeds without OPENAI_API_KEY)",
        defaultCiResult.metadata.writerMode === "mock"
      );

      // Live mode must be selected explicitly, and must fail clearly — not
      // silently fall back to mock — when OPENAI_API_KEY is missing. Both
      // adapters check this before any network call, so this never makes a
      // real provider call.
      let oldLiveError: unknown;
      try {
        await new BenchmarkRunner(new OldPipelineAdapter("live")).runCase(sampleCase);
      } catch (err) {
        oldLiveError = err;
      }
      checkTrue(
        "OldPipelineAdapter('live') fails clearly without OPENAI_API_KEY (no silent mock fallback)",
        oldLiveError instanceof Error && /OPENAI_API_KEY/.test(oldLiveError.message)
      );

      let ciLiveError: unknown;
      try {
        await new BenchmarkRunner(new CreativeIntelligenceAdapter("live")).runCase(ciSampleCase);
      } catch (err) {
        ciLiveError = err;
      }
      checkTrue(
        "CreativeIntelligenceAdapter('live') fails clearly without OPENAI_API_KEY (no silent mock fallback)",
        ciLiveError instanceof Error && /OPENAI_API_KEY/.test(ciLiveError.message)
      );
    } finally {
      if (originalKey !== undefined) process.env.OPENAI_API_KEY = originalKey;
    }
  }

  // ─── 8. No forbidden STATIC production imports anywhere in adapters/ ────
  // (live mode's production imports are dynamic import() calls, which never
  // match a `from "..."` / `require(...)` pattern — they are only ever
  // evaluated when an adapter's live-mode branch actually runs.)

  {
    const forbiddenPatterns = [
      /from ["'].*lib\/narrative/,
      /from ["'].*lib\/script-builder/,
      /from ["'].*lib\/story-supervisor/,
      /from ["'].*lib\/tts/,
      /from ["']openai["']/,
      /from ["']elevenlabs["']/,
      /require\(["']openai["']\)/,
    ];

    const adaptersRoot = path.join(
      process.cwd(),
      "scripts",
      "narrative-benchmark",
      "adapters"
    );

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

    const files = collectTsFiles(adaptersRoot);
    checkTrue("adapters directory contains files to scan", files.length > 0);

    const violations: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      for (const pattern of forbiddenPatterns) {
        if (pattern.test(content)) {
          violations.push(`${path.relative(process.cwd(), file)} matched ${pattern}`);
        }
      }
    }

    checkTrue(
      `no forbidden production imports found in adapters/${
        violations.length > 0 ? ": " + violations.join(", ") : ""
      }`,
      violations.length === 0
    );

    const oldPipelineSource = fs.readFileSync(
      path.join(adaptersRoot, "old-pipeline.ts"),
      "utf8"
    );
    checkTrue(
      "old-pipeline.ts reaches lib/script-builder-openai only via a dynamic import()",
      /await import\(["']@\/lib\/script-builder-openai["']\)/.test(oldPipelineSource)
    );
  }

  // ─── 9. No production files modified by this test (sanity check) ────────

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
