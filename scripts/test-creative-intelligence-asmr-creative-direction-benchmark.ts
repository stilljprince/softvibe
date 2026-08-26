// scripts/test-creative-intelligence-asmr-creative-direction-benchmark.ts
//
// RP-011C.8.8.4D — ASMR Creative Direction Quality Benchmark.
//
// Runs the 5 RP-011C.8.8.4D ASMR prompts (scripts/narrative-benchmark/cases/
// asmr-creative-direction.ts) through both the old narrative pipeline
// (OldPipelineAdapter) and the Creative Intelligence pipeline
// (CreativeIntelligenceAdapter), and reports, per case: generated text, word
// count, character count, pipeline metadata, and (for Creative Intelligence)
// the classified CreativeIntent -- so the two pipelines can be compared on
// prompt fidelity, ASMR identity, creative specificity, genre control, and
// whether the user's specific scenario survives into generated output.
//
// This is a benchmark-only script. It does not modify lib/creative-intelligence,
// lib/narrative, lib/script-builder*, lib/tts, app/**, or any database file --
// it only calls the existing, unmodified adapters in
// scripts/narrative-benchmark/adapters/ through their public run() contract.
//
// Three modes, identical semantics/guards to scripts/run-narrative-benchmark.ts
// (loadEnvironment/enforceLiveModeGuards are imported directly from there, not
// reimplemented):
//
//   mock (default) -- no OpenAI calls. Old pipeline returns a structural
//     placeholder; Creative Intelligence returns its deterministic mock
//     Writer output. Useful for exercising this script and the intent
//     classification comparison, but NEITHER pipeline's mock output is real
//     generated prose -- mock mode alone cannot answer this benchmark's
//     actual question ("do real outputs improve?").
//
//   dry-run -- validates case/adapter wiring without ever importing a
//     production generation module or touching OpenAI.
//
//   live -- runs real generation on both pipelines. Requires
//     CONFIRM_LIVE_BENCHMARK=true and OPENAI_API_KEY, exactly like
//     run-narrative-benchmark.ts. This is the only mode that produces the
//     real-output comparison this benchmark exists to make, and it makes
//     billed OpenAI calls (5 cases x 2 pipelines = 10 calls).
//
// Run with:
//   npx tsx scripts/test-creative-intelligence-asmr-creative-direction-benchmark.ts
//   npx tsx scripts/test-creative-intelligence-asmr-creative-direction-benchmark.ts --dry-run
//   CONFIRM_LIVE_BENCHMARK=true npx tsx scripts/test-creative-intelligence-asmr-creative-direction-benchmark.ts --live

import fs from "node:fs";
import path from "node:path";

import { asmrCreativeDirectionCases } from "./narrative-benchmark/cases/asmr-creative-direction";
import type { BenchmarkMode, BenchmarkResult } from "./narrative-benchmark/runners/types";
import { runCaseThroughAdapters } from "./narrative-benchmark/runners/benchmark-runner";
import { OldPipelineAdapter } from "./narrative-benchmark/adapters/old-pipeline";
import { CreativeIntelligenceAdapter } from "./narrative-benchmark/adapters/creative-intelligence";
import { loadEnvironment, enforceLiveModeGuards } from "./run-narrative-benchmark";

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

type CaseReport = {
  caseId: string;
  prompt: string;
  results: Array<{
    pipelineName: string;
    wordCount: number;
    charCount: number;
    metadata: Record<string, unknown>;
    intent: unknown;
  }>;
};

function parseMode(): BenchmarkMode {
  if (process.argv.includes("--live")) return "live";
  if (process.argv.includes("--dry-run")) return "dry-run";
  return "mock";
}

async function main(): Promise<void> {
  loadEnvironment();

  const mode = parseMode();
  enforceLiveModeGuards(mode);

  console.log(
    `[asmr-creative-direction-benchmark] mode=${mode} cases=${asmrCreativeDirectionCases.length}`
  );

  const adapters = [new OldPipelineAdapter(mode), new CreativeIntelligenceAdapter(mode)];

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runRoot = path.join("benchmark-output", "asmr-creative-direction", timestamp);

  const caseReports: CaseReport[] = [];

  for (const benchmarkCase of asmrCreativeDirectionCases) {
    console.log(`\n[asmr-creative-direction-benchmark] running case "${benchmarkCase.id}"...`);

    let results: BenchmarkResult[];
    try {
      results = await runCaseThroughAdapters(benchmarkCase, adapters);
    } catch (err) {
      console.error(
        `[asmr-creative-direction-benchmark] case "${benchmarkCase.id}" failed:`,
        err instanceof Error ? err.message : err
      );
      throw err;
    }

    const caseDir = path.join(runRoot, benchmarkCase.id);
    fs.mkdirSync(caseDir, { recursive: true });

    const caseReport: CaseReport = { caseId: benchmarkCase.id, prompt: benchmarkCase.prompt, results: [] };

    for (const result of results) {
      const outputFileName = result.pipelineName === "old" ? "old.txt" : "creative-intelligence.txt";
      fs.writeFileSync(path.join(caseDir, outputFileName), result.output, "utf8");

      const wc = wordCount(result.output);
      const cc = result.output.length;
      const intent = (result.metadata as Record<string, unknown>).intent ?? null;

      console.log(
        `  - ${result.pipelineName.padEnd(20)} words=${wc.toString().padEnd(6)} chars=${cc}`
      );

      caseReport.results.push({
        pipelineName: result.pipelineName,
        wordCount: wc,
        charCount: cc,
        metadata: result.metadata,
        intent,
      });
    }

    fs.writeFileSync(
      path.join(caseDir, "report.json"),
      JSON.stringify(caseReport, null, 2),
      "utf8"
    );
    caseReports.push(caseReport);
  }

  fs.writeFileSync(
    path.join(runRoot, "summary.json"),
    JSON.stringify({ mode, generatedAt: timestamp, cases: caseReports }, null, 2),
    "utf8"
  );

  console.log(`\n[asmr-creative-direction-benchmark] done -- output written to ${runRoot}`);
  console.log(`\n${"caseId".padEnd(48)}${"pipeline".padEnd(22)}${"words".padEnd(8)}chars`);
  for (const report of caseReports) {
    for (const r of report.results) {
      console.log(
        `${report.caseId.padEnd(48)}${r.pipelineName.padEnd(22)}${r.wordCount.toString().padEnd(8)}${r.charCount}`
      );
    }
  }

  if (mode !== "live") {
    console.log(
      `\n[asmr-creative-direction-benchmark] NOTE: mode="${mode}" does not produce real generated prose for either ` +
        `pipeline (old-pipeline mock is a structural placeholder; Creative Intelligence mock is deterministic ` +
        `placeholder text). Word/char counts and intent classification above are still meaningful, but a real ` +
        `prompt-fidelity / creative-specificity comparison requires --live.`
    );
  }
}

main().catch((err) => {
  console.error(
    "[test-creative-intelligence-asmr-creative-direction-benchmark] failed:",
    err instanceof Error ? err.message : err
  );
  process.exit(1);
});
