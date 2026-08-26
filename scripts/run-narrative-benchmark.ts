// scripts/run-narrative-benchmark.ts
//
// RP-011C.8.7.3 — Live benchmark runner.
// RP-011C.8.7.3A — Live benchmark safety hardening.
//
// Runs calibrated narrative benchmark cases (scripts/narrative-benchmark/
// cases/narrative.ts) through the old pipeline and/or Creative Intelligence
// pipeline adapters, in mock (default), dry-run, or live mode, and writes
// generated output + metadata to disk.
//
// Three execution modes, and no implicit escalation between them:
//
//   mock (default) -- never touches OpenAI, needs no API key. The only
//     mode this script (or any test) ever runs without an explicit flag.
//
//   dry-run -- validates arguments, environment handling, and adapter
//     selection along the same path live mode uses, but never constructs
//     an LLM provider and never calls OpenAI (see adapters/old-pipeline.ts
//     and adapters/creative-intelligence.ts dry-run branches, which are
//     pure/synchronous and do not import production generation modules).
//
//   live -- requires CONFIRM_LIVE_BENCHMARK=true *and* OPENAI_API_KEY.
//     Both are checked before any adapter is asked to run, and neither
//     check silently falls back to a safer mode -- an invalid live
//     invocation fails clearly and exits non-zero.
//
// Environment loading is guarded against a specific footgun: dotenv's
// .env.local load uses override:true (so .env.local wins over .env, this
// repo's convention), which would otherwise silently overwrite a value the
// invoking shell explicitly set -- including an intentionally empty
// `OPENAI_API_KEY=` used to test the missing-key guard above. See
// loadEnvironment() below.
//
// This script only affects isolated benchmark tooling: it does not modify,
// and its adapters do not modify, any production file (app/**, lib/narrative/**,
// lib/script-builder*.ts, lib/story-supervisor.ts, lib/tts/**). Output is
// written under benchmark-output/, never to a database.
//
// Usage:
//   npx tsx scripts/run-narrative-benchmark.ts
//   npx tsx scripts/run-narrative-benchmark.ts --dry-run --live-check
//   CONFIRM_LIVE_BENCHMARK=true npx tsx scripts/run-narrative-benchmark.ts --live
//   npx tsx scripts/run-narrative-benchmark.ts --adapters=old --out=my-output

import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { allBenchmarkCases, narrativeCases } from "./narrative-benchmark/cases";
import type { BenchmarkCase, BenchmarkMode } from "./narrative-benchmark/runners/types";
import { runCaseThroughAdapters } from "./narrative-benchmark/runners/benchmark-runner";
import type { BenchmarkPipelineAdapter } from "./narrative-benchmark/runners/types";
import { OldPipelineAdapter } from "./narrative-benchmark/adapters/old-pipeline";
import { CreativeIntelligenceAdapter } from "./narrative-benchmark/adapters/creative-intelligence";
import { serializeOutputText, serializeMetadata } from "./narrative-benchmark/output/serializer";

// Loads .env then layers .env.local on top (.env.local wins, this repo's
// convention -- same precedence Next.js itself uses), while preserving any
// value the invoking shell explicitly set for OPENAI_API_KEY -- including
// an empty string. Without this, `OPENAI_API_KEY= npx tsx ... --live`
// (intended to test the missing-key guard) would have that empty value
// silently replaced by whatever real key .env.local contains, because
// dotenv's override:true does not distinguish "unset" from "explicitly
// set to empty". This function must run before any live-mode check reads
// process.env.OPENAI_API_KEY.
export function loadEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  const shellSetOpenAIKey = Object.prototype.hasOwnProperty.call(env, "OPENAI_API_KEY");
  const shellOpenAIKey = env.OPENAI_API_KEY;

  dotenv.config();
  dotenv.config({ path: ".env.local", override: true });

  if (shellSetOpenAIKey) {
    env.OPENAI_API_KEY = shellOpenAIKey;
  }
}

type AdapterName = "old" | "creative-intelligence";

type CliArgs = {
  mode: BenchmarkMode;
  caseIds: string[] | null; // null = all calibrated narrative cases
  adapterNames: AdapterName[];
  outRoot: string;
};

function printUsage(): void {
  console.log(`
Usage: npx tsx scripts/run-narrative-benchmark.ts [options]

Options:
  --mode=mock|dry-run|live   Execution mode (default: mock, never calls OpenAI)
  --live                     Shorthand for --mode=live
  --dry-run                  Shorthand for --mode=dry-run
  --cases=id1,id2            Comma-separated case ids (default: all calibrated narrative cases)
  --adapters=old,creative-intelligence   Comma-separated adapters to run (default: both)
  --out=<dir>                Output root directory (default: benchmark-output)
  --help                     Show this message

mock (default) never calls OpenAI and needs no API key.

dry-run validates arguments, environment, and adapter selection along the
live path, but never constructs an LLM provider and never calls OpenAI.

live requires both CONFIRM_LIVE_BENCHMARK=true and OPENAI_API_KEY (read
from .env / .env.local). It must be selected explicitly with --mode=live
or --live, and fails clearly -- never falling back to mock or dry-run --
if either requirement is missing.

Example:
  CONFIRM_LIVE_BENCHMARK=true npx tsx scripts/run-narrative-benchmark.ts --live
`);
}

export function parseArgs(argv: string[]): CliArgs {
  let mode: BenchmarkMode = "mock";
  let caseIds: string[] | null = null;
  let adapterNames: AdapterName[] = ["old", "creative-intelligence"];
  let outRoot = "benchmark-output";

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg === "--live") {
      mode = "live";
    } else if (arg === "--dry-run") {
      mode = "dry-run";
    } else if (arg.startsWith("--mode=")) {
      const value = arg.slice("--mode=".length);
      if (value !== "mock" && value !== "dry-run" && value !== "live") {
        throw new Error(`Invalid --mode value: "${value}" (expected "mock", "dry-run", or "live")`);
      }
      mode = value;
    } else if (arg.startsWith("--cases=")) {
      caseIds = arg
        .slice("--cases=".length)
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
    } else if (arg.startsWith("--adapters=")) {
      const names = arg
        .slice("--adapters=".length)
        .split(",")
        .map((n) => n.trim());
      for (const name of names) {
        if (name !== "old" && name !== "creative-intelligence") {
          throw new Error(`Invalid --adapters value: "${name}"`);
        }
      }
      adapterNames = names as AdapterName[];
    } else if (arg.startsWith("--out=")) {
      outRoot = arg.slice("--out=".length);
    } else {
      throw new Error(`Unrecognized argument: "${arg}" (see --help)`);
    }
  }

  return { mode, caseIds, adapterNames, outRoot };
}

function resolveCases(caseIds: string[] | null): BenchmarkCase[] {
  if (!caseIds) return narrativeCases;
  return caseIds.map((id) => {
    const found = allBenchmarkCases.find((c) => c.id === id);
    if (!found) {
      throw new Error(`Unknown benchmark case id: "${id}"`);
    }
    return found;
  });
}

function buildAdapters(names: AdapterName[], mode: BenchmarkMode): BenchmarkPipelineAdapter[] {
  return names.map((name) =>
    name === "old" ? new OldPipelineAdapter(mode) : new CreativeIntelligenceAdapter(mode)
  );
}

// Validates live mode's two independent requirements -- explicit human
// confirmation, then API configuration -- before any adapter is built or
// run. Never falls back to a safer mode on failure; it exits the process.
// No-op for mock/dry-run, which have no such requirements.
export function enforceLiveModeGuards(mode: BenchmarkMode, env: NodeJS.ProcessEnv = process.env): void {
  if (mode !== "live") return;

  if (env.CONFIRM_LIVE_BENCHMARK !== "true") {
    console.error(
      "[run-narrative-benchmark] Live mode requires explicit confirmation. Re-run with " +
        "CONFIRM_LIVE_BENCHMARK=true, e.g.:\n" +
        "  CONFIRM_LIVE_BENCHMARK=true npx tsx scripts/run-narrative-benchmark.ts --live\n" +
        "Refusing to run live generation, and refusing to silently fall back to mock/dry-run."
    );
    process.exit(1);
  }

  if (!env.OPENAI_API_KEY) {
    console.error(
      "[run-narrative-benchmark] Live mode requires OPENAI_API_KEY, but it is not set " +
        "in the environment (.env / .env.local). Refusing to silently fall back to mock mode."
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  loadEnvironment();

  const args = parseArgs(process.argv.slice(2));

  enforceLiveModeGuards(args.mode);

  const cases = resolveCases(args.caseIds);
  const adapters = buildAdapters(args.adapterNames, args.mode);

  console.log(
    `[run-narrative-benchmark] mode=${args.mode} cases=${cases.length} adapters=${adapters
      .map((a) => a.name)
      .join(",")}`
  );

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runRoot = path.join(args.outRoot, timestamp);

  const summary: { caseId: string; pipeline: string; outputChars: number }[] = [];

  for (const benchmarkCase of cases) {
    console.log(`[run-narrative-benchmark] running case "${benchmarkCase.id}"...`);
    const results = await runCaseThroughAdapters(benchmarkCase, adapters);

    const caseDir = path.join(runRoot, benchmarkCase.id);
    fs.mkdirSync(caseDir, { recursive: true });

    for (const result of results) {
      const outputPath = path.join(caseDir, `${result.pipelineName}.txt`);
      fs.writeFileSync(outputPath, serializeOutputText(result), "utf8");
      summary.push({
        caseId: result.caseId,
        pipeline: result.pipelineName,
        outputChars: result.output.length,
      });
    }

    const metadataPath = path.join(caseDir, "metadata.json");
    fs.writeFileSync(metadataPath, serializeMetadata(benchmarkCase.id, results), "utf8");
  }

  console.log(`\n[run-narrative-benchmark] done -- output written to ${runRoot}`);
  console.log(`\n${"caseId".padEnd(42)}${"pipeline".padEnd(24)}chars`);
  for (const row of summary) {
    console.log(`${row.caseId.padEnd(42)}${row.pipeline.padEnd(24)}${row.outputChars}`);
  }
}

// Only run when executed directly (`npx tsx scripts/run-narrative-benchmark.ts`),
// never when imported -- e.g. by scripts/test-narrative-benchmark-live-safety.ts,
// which imports parseArgs/loadEnvironment/enforceLiveModeGuards for direct
// testing without triggering a real benchmark run on import.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error("[run-narrative-benchmark] failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
