// scripts/run-asmr-tension-and-perspective-targeted-live-regression.ts
//
// RP-011C.7 -- Targeted ASMR Cutover Readiness Fix. Small, LIVE, OpenAI
// provider-backed regression for exactly the 4 cases specified for this
// task -- the two confirmed live cutover-readiness regression gaps
// (tension-aware ASMR story progression, listener-as-first-person
// perspective semantics) plus their two regression controls (librarian
// roleplay, pure presence). This is diagnostic only: it does not change any
// production routing and does not modify lib/creative-intelligence/**
// (read-only). No ElevenLabs/TTS/audio calls anywhere in this file or its
// imports.
//
// Distinct from scripts/run-creative-intelligence-cutover-readiness-live-
// regression.ts's broader asmr-thriller-candlelight case, which combines
// the mystery premise and the listener-as-first-person request into a
// single prompt -- this script keeps CASE 1 (mystery, no perspective ask)
// and CASE 2 (mystery + explicit listener-as-first-person) separate, per
// this task's spec, so each gap can be inspected independently.
//
// Usage:
//   npx tsx scripts/run-asmr-tension-and-perspective-targeted-live-regression.ts --mock
//   CONFIRM_LIVE_BENCHMARK=true npx tsx scripts/run-asmr-tension-and-perspective-targeted-live-regression.ts --live

import fs from "node:fs";
import path from "node:path";

import { runCreativePipeline } from "../lib/creative-intelligence/orchestration";
import type { CreativePipelineResult, WriterMode } from "../lib/creative-intelligence/orchestration";
import type { BenchmarkMode } from "./narrative-benchmark/runners/types";
import { loadEnvironment, enforceLiveModeGuards } from "./run-narrative-benchmark";

type Case = {
  id: string;
  prompt: string;
  passCriteria: string[];
  failCriteria: string[];
};

const CASES: Case[] = [
  {
    id: "case-1-thriller-mystery",
    prompt:
      "Tell me a mysterious thriller story in an ASMR voice, like someone is quietly telling me a secret by candlelight.",
    passCriteria: [
      "a real mystery premise",
      "at least one meaningful clue",
      "development/deepening",
      "controlled tension",
      "a reveal/payoff or clear narrative close",
      "ASMR delivery preserved",
    ],
    failCriteria: ["only candlelight + secret + comfort atmosphere, with no actual story movement"],
  },
  {
    id: "case-2-first-person-listener-thriller",
    prompt:
      "Tell a mysterious ASMR thriller from my perspective, as if I am the one uncovering the secret by candlelight.",
    passCriteria: [
      "the listener is genuinely the \"I\"",
      "the story is experienced through the listener's own perception",
      "no separate ASMR persona-I addressing the listener as \"you\" (unless additionally requested)",
      "real mystery progression",
    ],
    failCriteria: ["grammatically first-person but a separate persona still narrates to \"you\""],
  },
  {
    id: "case-3-librarian-regression-control",
    prompt:
      "Create an ASMR librarian roleplay where you are a kind librarian who softly talks with me and reads a few pages from a favorite book.",
    passCriteria: [
      "no thriller structure",
      "persona-I / listener-you stays correct",
      "library setting",
      "actual reading",
      "ASMR closeness preserved",
    ],
    failCriteria: ["thriller structure leaking in", "persona/listener roles collapsing"],
  },
  {
    id: "case-4-pure-presence-regression-control",
    prompt:
      "Create a gentle ASMR whisper experience focused on the quiet sound, rhythm and closeness of the voice itself.",
    passCriteria: ["no plot", "no tension branch", "voice-first", "deliberate repetition still possible"],
    failCriteria: ["any regression drift toward story/plot content"],
  },
];

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function parseMode(argv: string[]): BenchmarkMode {
  if (argv.includes("--live")) return "live";
  return "mock";
}

type CaseSummaryRow = {
  caseId: string;
  asmrMode: unknown;
  asmrNarrativeTension: unknown;
  perspective: unknown;
  listenerIsExperiencer: unknown;
  sceneCount: number;
  wordCount: number;
  overallAssessment: unknown;
  overallScore: unknown;
  narrativeTensionFulfillment: unknown;
  durationMs: number;
};

async function runCase(benchmarkCase: Case, mode: BenchmarkMode, runRoot: string): Promise<CaseSummaryRow> {
  const writerMode: WriterMode = mode === "live" ? "provider" : "mock";

  const startedAt = Date.now();
  const result: CreativePipelineResult = await runCreativePipeline(
    { prompt: benchmarkCase.prompt, preset: "classic-asmr", durationMinutes: 10 },
    { writerMode }
  );
  const finishedAt = Date.now();

  const caseDir = path.join(runRoot, benchmarkCase.id);
  fs.mkdirSync(caseDir, { recursive: true });

  fs.writeFileSync(path.join(caseDir, "00-prompt.txt"), benchmarkCase.prompt, "utf8");
  fs.writeFileSync(path.join(caseDir, "01-intent.json"), JSON.stringify(result.intent, null, 2), "utf8");
  fs.writeFileSync(path.join(caseDir, "02-story-blueprint.json"), JSON.stringify(result.storyBlueprint, null, 2), "utf8");
  fs.writeFileSync(path.join(caseDir, "03-scene-blueprints.json"), JSON.stringify(result.scenes, null, 2), "utf8");
  fs.writeFileSync(path.join(caseDir, "04-guidance.json"), JSON.stringify(result.guidance, null, 2), "utf8");

  const generatedScenesDetailed = result.generatedScenes.map((scene, index) => ({
    sceneId: scene.sceneId,
    order: result.scenes[index]?.order,
    narrativeFunction: result.scenes[index]?.narrativeFunction,
    wordCount: wordCount(scene.text),
    text: scene.text,
    metadata: scene.metadata,
  }));
  fs.writeFileSync(path.join(caseDir, "05-generated-scenes.json"), JSON.stringify(generatedScenesDetailed, null, 2), "utf8");

  const fullText = result.generatedScenes.map((scene) => scene.text).join("\n\n");
  fs.writeFileSync(path.join(caseDir, "06-full-text.txt"), fullText, "utf8");

  fs.writeFileSync(path.join(caseDir, "07-evaluation.json"), JSON.stringify(result.evaluation, null, 2), "utf8");

  const narrativeTensionFulfillment = result.evaluation.criteriaResults.find(
    (r) => r.criterionId === "narrative_tension_fulfillment"
  );

  const summary: CaseSummaryRow = {
    caseId: benchmarkCase.id,
    asmrMode: result.intent.asmrMode,
    asmrNarrativeTension: result.intent.asmrNarrativeTension,
    perspective: result.intent.perspective,
    listenerIsExperiencer: result.intent.listenerIsExperiencer,
    sceneCount: result.scenes.length,
    wordCount: wordCount(fullText),
    overallAssessment: result.evaluation.overallAssessment,
    overallScore: result.evaluation.overallScore,
    narrativeTensionFulfillment: narrativeTensionFulfillment?.passed,
    durationMs: finishedAt - startedAt,
  };

  fs.writeFileSync(
    path.join(caseDir, "summary.json"),
    JSON.stringify(
      {
        ...summary,
        passCriteria: benchmarkCase.passCriteria,
        failCriteria: benchmarkCase.failCriteria,
        writerMode,
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date(finishedAt).toISOString(),
      },
      null,
      2
    ),
    "utf8"
  );

  return summary;
}

async function main(): Promise<void> {
  loadEnvironment();
  const argv = process.argv.slice(2);
  const mode = parseMode(argv);
  enforceLiveModeGuards(mode);

  console.log(
    `[asmr-tension-and-perspective-targeted-live-regression] mode=${mode} cases=${CASES.length} model=${
      process.env.OPENAI_CREATIVE_INTELLIGENCE_MODEL ?? "(default)"
    }`
  );

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runRoot = path.join("benchmark-output", `asmr-tension-and-perspective-targeted-live-regression-${timestamp}`);
  fs.mkdirSync(runRoot, { recursive: true });

  const summaryRows: CaseSummaryRow[] = [];
  for (const benchmarkCase of CASES) {
    console.log(`[asmr-tension-and-perspective-targeted-live-regression] running case "${benchmarkCase.id}"...`);
    try {
      const row = await runCase(benchmarkCase, mode, runRoot);
      summaryRows.push(row);
    } catch (err) {
      console.error(
        `[asmr-tension-and-perspective-targeted-live-regression] case "${benchmarkCase.id}" failed:`,
        err instanceof Error ? err.message : err
      );
      summaryRows.push({
        caseId: benchmarkCase.id,
        asmrMode: undefined,
        asmrNarrativeTension: undefined,
        perspective: undefined,
        listenerIsExperiencer: undefined,
        sceneCount: 0,
        wordCount: 0,
        overallAssessment: "ERROR",
        overallScore: undefined,
        narrativeTensionFulfillment: undefined,
        durationMs: 0,
      });
    }
  }

  fs.writeFileSync(path.join(runRoot, "run-summary.json"), JSON.stringify(summaryRows, null, 2), "utf8");

  console.log(`\n[asmr-tension-and-perspective-targeted-live-regression] done -- output written to ${runRoot}`);
  console.log(
    `\n${"caseId".padEnd(38)}${"tension".padEnd(10)}${"persp".padEnd(8)}${"listenerExp".padEnd(14)}${"scenes".padEnd(
      8
    )}${"words".padEnd(8)}${"tensionCrit".padEnd(13)}${"assess".padEnd(12)}score`
  );
  for (const row of summaryRows) {
    console.log(
      `${row.caseId.padEnd(38)}${String(row.asmrNarrativeTension ?? "-").padEnd(10)}${String(row.perspective ?? "-").padEnd(
        8
      )}${String(row.listenerIsExperiencer ?? "-").padEnd(14)}${String(row.sceneCount).padEnd(8)}${String(
        row.wordCount
      ).padEnd(8)}${String(row.narrativeTensionFulfillment ?? "-").padEnd(13)}${String(row.overallAssessment).padEnd(
        12
      )}${row.overallScore ?? "-"}`
    );
  }
}

main().catch((err) => {
  console.error(
    "[run-asmr-tension-and-perspective-targeted-live-regression] failed:",
    err instanceof Error ? err.message : err
  );
  process.exit(1);
});
