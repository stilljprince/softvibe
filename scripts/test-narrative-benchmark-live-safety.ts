// scripts/test-narrative-benchmark-live-safety.ts
//
// RP-011C.8.7.3A — Live Benchmark Safety Hardening tests.
//
// Verifies the safety layer added on top of RP-011C.8.7.3's live mode:
//
// - mock mode never requires OPENAI_API_KEY and never creates a provider
// - dry-run mode validates the live path (preset mapping, adapter
//   selection) but structurally cannot create a provider or call OpenAI
//   (verified by source inspection of the dry-run branches, not just
//   observed behavior)
// - live mode fails clearly, before any adapter runs, when
//   CONFIRM_LIVE_BENCHMARK is not "true"
// - live mode fails clearly when CONFIRM_LIVE_BENCHMARK=true but
//   OPENAI_API_KEY is not configured
// - the specific bug this task exists to fix: a shell-provided
//   `OPENAI_API_KEY=` (explicitly empty, e.g. to test the guard above)
//   is no longer silently overwritten by a real key in .env.local
//
// These tests spawn the actual CLI (scripts/run-narrative-benchmark.ts)
// as a subprocess for every guard check, the same way the original bug was
// discovered -- so a regression in dotenv/env-loading order would be
// caught here, not just in isolated unit logic. None of these
// invocations can reach a real OpenAI call: mock/dry-run never construct
// a provider, and every live-mode invocation here is deliberately missing
// at least one required guard, so the process must exit before any
// adapter is asked to run.
//
// Run with:  npx tsx scripts/test-narrative-benchmark-live-safety.ts

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

const TSX_BIN = path.join(process.cwd(), "node_modules", ".bin", "tsx");
const RUNNER_PATH = path.join(process.cwd(), "scripts", "run-narrative-benchmark.ts");
const SAMPLE_CASE = "narrative-transformation-life-change";

type Invocation = {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

function runCli(args: string[], envOverrides: Record<string, string | undefined>, outRoot: string): Invocation {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  const result = spawnSync(
    TSX_BIN,
    [RUNNER_PATH, `--cases=${SAMPLE_CASE}`, `--out=${outRoot}`, ...args],
    { env, encoding: "utf8", timeout: 20_000 }
  );

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    timedOut: result.signal === "SIGTERM" && result.status === null,
  };
}

function freshOutRoot(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sv-benchmark-${label}-`));
}

async function main(): Promise<void> {
  // ─── 1. mock mode never requires OPENAI_API_KEY ──────────────────────────

  {
    const outRoot = freshOutRoot("mock");
    const result = runCli(["--adapters=old"], { OPENAI_API_KEY: undefined }, outRoot);

    check("mock mode (no OPENAI_API_KEY) exits 0", result.status, 0);
    checkTrue("mock mode does not mention OPENAI_API_KEY as an error", !/requires OPENAI_API_KEY/.test(result.stderr));
    checkTrue(
      "mock mode wrote output for the requested case",
      fs.existsSync(outRoot) && fs.readdirSync(outRoot).length > 0
    );
  }

  // ─── 2. dry-run mode validates without OPENAI_API_KEY or confirmation ───

  {
    const outRoot = freshOutRoot("dry-run");
    const result = runCli(
      ["--dry-run", "--adapters=old,creative-intelligence"],
      { OPENAI_API_KEY: undefined, CONFIRM_LIVE_BENCHMARK: undefined },
      outRoot
    );

    check("dry-run mode (no key, no confirmation) exits 0", result.status, 0);
    checkTrue("dry-run mode does not time out", !result.timedOut);

    const runDirs = fs.existsSync(outRoot) ? fs.readdirSync(outRoot) : [];
    checkTrue("dry-run mode wrote a run directory", runDirs.length > 0);
    if (runDirs.length > 0) {
      const metadataPath = path.join(outRoot, runDirs[0], SAMPLE_CASE, "metadata.json");
      checkTrue("dry-run metadata.json was written", fs.existsSync(metadataPath));
      if (fs.existsSync(metadataPath)) {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
        const modes = (metadata.pipelines ?? []).map((entry: any) => entry?.metadata?.mode);
        checkTrue(
          "dry-run metadata records mode 'dry-run' for every adapter",
          modes.length > 0 && modes.every((m: unknown) => m === "dry-run")
        );
      }
    }
  }

  // ─── 3. live mode fails without CONFIRM_LIVE_BENCHMARK ──────────────────

  {
    const outRoot = freshOutRoot("live-no-confirm");
    const result = runCli(
      ["--live"],
      { CONFIRM_LIVE_BENCHMARK: undefined, OPENAI_API_KEY: "sk-should-never-be-used" },
      outRoot
    );

    check("live mode without CONFIRM_LIVE_BENCHMARK exits non-zero", result.status === 0, false);
    checkTrue(
      "live mode without CONFIRM_LIVE_BENCHMARK reports the confirmation requirement",
      /CONFIRM_LIVE_BENCHMARK/.test(result.stderr)
    );
    checkTrue(
      "live mode without CONFIRM_LIVE_BENCHMARK wrote no output",
      !fs.existsSync(outRoot) || fs.readdirSync(outRoot).length === 0
    );
  }

  // ─── 4. live mode fails without OPENAI_API_KEY, even when confirmed ─────
  //
  // This is also the regression test for the original bug: it forces
  // OPENAI_API_KEY to an explicitly empty string (the exact guard-test
  // invocation from the bug report -- `OPENAI_API_KEY= ... --live`) rather
  // than merely deleting it from the child's env. Deleting it would let
  // this repo's real .env.local key load legitimately (that's correct
  // behavior, not the bug) and risk this test spawning a real live run.
  // Forcing an explicit empty string is the deterministic, environment-
  // independent way to simulate "no usable key" -- and before the fix,
  // dotenv's override:true .env.local load replaced that empty value with
  // a real key, silently defeating this exact guard test.

  {
    const outRoot = freshOutRoot("live-no-key");
    const result = runCli(
      ["--live"],
      { CONFIRM_LIVE_BENCHMARK: "true", OPENAI_API_KEY: "" },
      outRoot
    );

    check("live mode with confirmation but empty OPENAI_API_KEY= exits non-zero", result.status === 0, false);
    checkTrue(
      "live mode with empty OPENAI_API_KEY= reports the key requirement (not overridden by .env.local)",
      /requires OPENAI_API_KEY/.test(result.stderr)
    );
  }

  // ─── 5. Dry-run branches cannot reach provider/OpenAI code (source check) ─
  // Structural guarantee, not just observed behavior: this holds even if a
  // future change to runCreativePipeline/buildScriptOpenAI internals adds
  // a code path that would otherwise call OpenAI eagerly.

  {
    const ciSource = fs.readFileSync(
      path.join(process.cwd(), "scripts/narrative-benchmark/adapters/creative-intelligence.ts"),
      "utf8"
    );
    const ciDryRunBody = ciSource.slice(ciSource.indexOf("private runDryRun"));
    checkTrue(
      "CreativeIntelligenceAdapter.runDryRun never calls runCreativePipeline",
      !ciDryRunBody.includes("await runCreativePipeline(")
    );
    checkTrue(
      "CreativeIntelligenceAdapter.runDryRun never references createCreativeTextProvider",
      !ciDryRunBody.includes("createCreativeTextProvider")
    );

    const oldSource = fs.readFileSync(
      path.join(process.cwd(), "scripts/narrative-benchmark/adapters/old-pipeline.ts"),
      "utf8"
    );
    const oldDryRunBody = oldSource.slice(
      oldSource.indexOf("private async runDryRun"),
      oldSource.indexOf("private async runLive")
    );
    checkTrue(
      "OldPipelineAdapter.runDryRun never imports lib/script-builder-openai",
      !oldDryRunBody.includes("import(")
    );
  }

  // ─── 6. mock and dry-run BenchmarkMode values are structurally distinct ──
  // from "live" everywhere a mode gate could accidentally treat them alike.

  {
    const runnerSource = fs.readFileSync(
      path.join(process.cwd(), "scripts/run-narrative-benchmark.ts"),
      "utf8"
    );
    checkTrue(
      "enforceLiveModeGuards only gates the 'live' mode",
      /if \(mode !== "live"\) return;/.test(runnerSource)
    );
  }

  // ─── Summary ──────────────────────────────────────────────────────────

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main();
