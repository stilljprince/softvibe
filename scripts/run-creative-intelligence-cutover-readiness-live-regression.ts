// scripts/run-creative-intelligence-cutover-readiness-live-regression.ts
//
// RP-011C.7 -- Creative Intelligence Cutover-Readiness Live Regression.
//
// Live, LLM-backed regression for exactly three Creative Intelligence
// presets -- classic-asmr, meditation, kids-story -- covering the fixes
// from the immediately preceding implementation pass (perspective
// classification/propagation, meditation experience types + guided imagery,
// kids-story creative-direction/continuity, and the meditation evaluator
// correction). This is diagnostic only: it does not change any production
// routing and does not modify lib/creative-intelligence/** (read-only).
//
// Calls runCreativePipeline() directly (the same, unmodified entry point
// scripts/narrative-benchmark/adapters/creative-intelligence.ts already
// wraps) instead of going through that adapter, because this run needs the
// full per-stage inspection chain (intent -> story blueprint -> scene
// blueprints -> guidance -> per-scene generated text -> evaluation) that the
// adapter's joined-text BenchmarkResult does not expose. writerMode:
// "provider" is the pipeline's existing opt-in provider-backed writer --
// this script constructs no OpenAI client of its own.
//
// No ElevenLabs/TTS/audio calls anywhere in this file or its imports.
//
// Usage:
//   npx tsx scripts/run-creative-intelligence-cutover-readiness-live-regression.ts --mock
//   CONFIRM_LIVE_BENCHMARK=true npx tsx scripts/run-creative-intelligence-cutover-readiness-live-regression.ts --live
//   ... --live --cases=med-morning-presence,kids-mina-scarf

import fs from "node:fs";
import path from "node:path";

import { runCreativePipeline } from "../lib/creative-intelligence/orchestration";
import type { CreativePipelineResult, WriterMode } from "../lib/creative-intelligence/orchestration";
import type { CreativePreset } from "../lib/creative-intelligence/core/constants";
import type { BenchmarkMode } from "./narrative-benchmark/runners/types";
import { loadEnvironment, enforceLiveModeGuards } from "./run-narrative-benchmark";

type Case = {
  id: string;
  preset: CreativePreset;
  durationMinutes: number;
  prompt: string;
  expectedQualities: string[];
  perspectiveRequested?: "first" | "second" | "third";
};

const CASES: Case[] = [
  // ---------------------------------------------------------------------
  // Meditation -- 5 live cases
  // ---------------------------------------------------------------------
  {
    id: "med-morning-presence",
    preset: "meditation",
    durationMinutes: 10,
    prompt:
      "Create a gentle morning presence meditation that helps me arrive in the new day without rushing. Help me notice the morning, become present, and transition calmly into what comes next.",
    expectedQualities: [
      "clear morning identity, not a generic sleep ending",
      "no obligatory full body scan",
      "gentle transition INTO the day",
    ],
  },
  {
    id: "med-self-compassion",
    preset: "meditation",
    durationMinutes: 10,
    prompt:
      "Create a self-compassion meditation for a moment when I am being very hard on myself after making a mistake. Help me meet what I feel with kindness without pretending it does not hurt.",
    expectedQualities: [
      "real work with feeling / self-criticism / kindness",
      "not just breath -> body scan -> wandering mind",
      "no toxic positivity",
      "no diagnosis/therapy claims",
    ],
  },
  {
    id: "med-evening-wind-down",
    preset: "meditation",
    durationMinutes: 10,
    prompt:
      "Create an evening wind-down meditation that helps me put the day down and become ready for rest.",
    expectedQualities: [
      "clear evening/end-of-day identity",
      "letting go",
      "no morning-style reactivation ending",
      "sleep may be gently invited",
    ],
  },
  {
    id: "med-guided-beach-visualization",
    preset: "meditation",
    durationMinutes: 10,
    prompt:
      "Guide me through a calming visualization where I imagine sitting on a quiet beach, feeling the air and listening to the waves. Please write this addressing me as you throughout.",
    expectedQualities: [
      "real guided imagery / visualization",
      "beach stays central",
      "sensory imagination",
      "does not fall back to a generic body scan",
      "no unnecessary story/plot structure",
    ],
    perspectiveRequested: "second",
  },
  {
    id: "med-plain-breath-control",
    preset: "meditation",
    durationMinutes: 8,
    prompt: "Guide me through a simple meditation focused only on noticing my natural breathing.",
    expectedQualities: [
      "plain and simple",
      "breath stays central",
      "no forced guided imagery",
      "no unnecessary story",
      "proves guided imagery has not become the default",
    ],
  },

  // ---------------------------------------------------------------------
  // Kids Story -- 3 live cases (continuity focus)
  // ---------------------------------------------------------------------
  {
    id: "kids-mina-scarf",
    preset: "kids-story",
    durationMinutes: 10,
    prompt:
      "Tell a warm children's story about Mina, a curious little fox who wants to return a lost blue scarf to its owner before sunset. Tell it in the third person, following Mina throughout.",
    expectedQualities: [
      "Mina stays the protagonist across scenes",
      "the lost blue scarf stays the central premise",
      "events build on each other, not independent mini-stories",
    ],
    perspectiveRequested: "third",
  },
  {
    id: "kids-leo-amira-garden",
    preset: "kids-story",
    durationMinutes: 10,
    prompt:
      "Tell a children's story about Leo and his best friend Amira building a tiny garden together, but they disagree about where to plant their first sunflower and have to find a kind solution.",
    expectedQualities: [
      "Leo + Amira stay the same characters",
      "the garden project stays intact",
      "small conflict develops causally",
      "relationship changes plausibly, no scene reset",
    ],
  },
  {
    id: "kids-nora-pip-kite",
    preset: "kids-story",
    durationMinutes: 10,
    prompt:
      "Tell a children's adventure about Nora and her little dog Pip searching for a missing red kite. They begin at home, follow clues through the park, and eventually reach the hill above town.",
    expectedQualities: [
      "deliberate location change home -> park -> hill works",
      "Nora/Pip/kite persist",
      "location change is not a story reset",
      "events reference what came before",
    ],
  },

  // ---------------------------------------------------------------------
  // ASMR -- 4 live cases
  // ---------------------------------------------------------------------
  {
    id: "asmr-pure-whisper-presence",
    preset: "classic-asmr",
    durationMinutes: 10,
    prompt:
      "Create a gentle ASMR whisper experience focused on the quiet sound, rhythm, and closeness of the voice itself.",
    expectedQualities: [
      "voice-first",
      "no forced roleplay",
      "no generic meditation body scan",
      "deliberate, varied repetition allowed",
    ],
  },
  {
    id: "asmr-close-friend-companion",
    preset: "classic-asmr",
    durationMinutes: 10,
    prompt:
      "Create an ASMR experience where a close friend sits with me after a difficult day and quietly keeps me company.",
    expectedQualities: [
      "clear companion situation",
      "personal closeness",
      "not generic motivational speech",
      "no forced emotional transformation",
    ],
  },
  {
    id: "asmr-librarian-roleplay",
    preset: "classic-asmr",
    durationMinutes: 10,
    prompt:
      "Create an ASMR librarian roleplay where you are a kind librarian who softly talks with me and reads a few pages from a favorite book.",
    expectedQualities: [
      "real librarian persona",
      "library setting",
      "actual reading / simulated book passage",
      "role stays consistent, not generic comfort drift",
    ],
  },
  {
    id: "asmr-thriller-candlelight",
    preset: "classic-asmr",
    durationMinutes: 12,
    prompt:
      "Tell me a mysterious thriller story in an ASMR voice, like someone is quietly telling me a secret by candlelight. Tell it from my perspective, as if I'm the one uncovering the secret.",
    expectedQualities: [
      "must actually deliver a mystery/thriller story",
      "must NOT be rewritten into generic comfort language",
      "ASMR delivery/voice preserved despite mystery/tension content",
    ],
    perspectiveRequested: "first",
  },
];

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

const WORDS_PER_MINUTE_ESTIMATE = 130;

function estimatedDurationMinutes(words: number): number {
  return Math.round((words / WORDS_PER_MINUTE_ESTIMATE) * 10) / 10;
}

function parseMode(argv: string[]): BenchmarkMode {
  if (argv.includes("--live")) return "live";
  return "mock";
}

function parseCaseIds(argv: string[]): string[] | null {
  const arg = argv.find((a) => a.startsWith("--cases="));
  if (!arg) return null;
  return arg
    .slice("--cases=".length)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolveCases(caseIds: string[] | null): Case[] {
  if (!caseIds) return CASES;
  return caseIds.map((id) => {
    const found = CASES.find((c) => c.id === id);
    if (!found) throw new Error(`Unknown case id: "${id}"`);
    return found;
  });
}

type CaseSummaryRow = {
  caseId: string;
  preset: string;
  asmrMode: unknown;
  meditationExperienceType: unknown;
  perspectiveRequested: string;
  perspectiveClassified: unknown;
  hasExplicitScenario: unknown;
  creativeDirectionPresent: boolean;
  sceneCount: number;
  wordCount: number;
  estimatedMinutes: number;
  targetMinutes: number;
  overallAssessment: unknown;
  overallScore: unknown;
  durationMs: number;
};

async function runCase(benchmarkCase: Case, mode: BenchmarkMode, runRoot: string): Promise<CaseSummaryRow> {
  const writerMode: WriterMode = mode === "live" ? "provider" : "mock";

  const startedAt = Date.now();
  const result: CreativePipelineResult = await runCreativePipeline(
    {
      prompt: benchmarkCase.prompt,
      preset: benchmarkCase.preset,
      durationMinutes: benchmarkCase.durationMinutes,
    },
    { writerMode }
  );
  const finishedAt = Date.now();

  const caseDir = path.join(runRoot, benchmarkCase.id);
  fs.mkdirSync(caseDir, { recursive: true });

  fs.writeFileSync(path.join(caseDir, "00-prompt.txt"), benchmarkCase.prompt, "utf8");
  fs.writeFileSync(path.join(caseDir, "01-intent.json"), JSON.stringify(result.intent, null, 2), "utf8");
  fs.writeFileSync(
    path.join(caseDir, "02-story-blueprint.json"),
    JSON.stringify(result.storyBlueprint, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    path.join(caseDir, "03-scene-blueprints.json"),
    JSON.stringify(result.scenes, null, 2),
    "utf8"
  );
  fs.writeFileSync(path.join(caseDir, "04-guidance.json"), JSON.stringify(result.guidance, null, 2), "utf8");

  const generatedScenesDetailed = result.generatedScenes.map((scene, index) => ({
    sceneId: scene.sceneId,
    order: result.scenes[index]?.order,
    purpose: result.scenes[index]?.purpose,
    narrativeFunction: result.scenes[index]?.narrativeFunction,
    wordCount: wordCount(scene.text),
    text: scene.text,
    metadata: scene.metadata,
  }));
  fs.writeFileSync(
    path.join(caseDir, "05-generated-scenes.json"),
    JSON.stringify(generatedScenesDetailed, null, 2),
    "utf8"
  );

  const fullText = result.generatedScenes.map((scene) => scene.text).join("\n\n");
  fs.writeFileSync(path.join(caseDir, "06-full-text.txt"), fullText, "utf8");

  fs.writeFileSync(path.join(caseDir, "07-evaluation.json"), JSON.stringify(result.evaluation, null, 2), "utf8");

  const wc = wordCount(fullText);
  const summary: CaseSummaryRow = {
    caseId: benchmarkCase.id,
    preset: result.intent.preset,
    asmrMode: result.intent.asmrMode,
    meditationExperienceType: result.intent.meditationExperienceType,
    perspectiveRequested: benchmarkCase.perspectiveRequested ?? "-",
    perspectiveClassified: result.intent.perspective,
    hasExplicitScenario: result.intent.hasExplicitScenario,
    creativeDirectionPresent: result.intent.creativeDirection !== undefined,
    sceneCount: result.scenes.length,
    wordCount: wc,
    estimatedMinutes: estimatedDurationMinutes(wc),
    targetMinutes: benchmarkCase.durationMinutes,
    overallAssessment: result.evaluation.overallAssessment,
    overallScore: result.evaluation.overallScore,
    durationMs: finishedAt - startedAt,
  };

  fs.writeFileSync(
    path.join(caseDir, "case-summary.json"),
    JSON.stringify(
      {
        ...summary,
        expectedQualities: benchmarkCase.expectedQualities,
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

  const cases = resolveCases(parseCaseIds(argv));

  console.log(
    `[cutover-readiness-live-regression] mode=${mode} cases=${cases.length} model=${
      process.env.OPENAI_CREATIVE_INTELLIGENCE_MODEL ?? "(default gpt-5.4)"
    }`
  );

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runRoot = path.join("benchmark-output", `cutover-readiness-live-regression-${timestamp}`);
  fs.mkdirSync(runRoot, { recursive: true });

  const summaryRows: CaseSummaryRow[] = [];
  for (const benchmarkCase of cases) {
    console.log(`[cutover-readiness-live-regression] running case "${benchmarkCase.id}"...`);
    try {
      const row = await runCase(benchmarkCase, mode, runRoot);
      summaryRows.push(row);
    } catch (err) {
      console.error(
        `[cutover-readiness-live-regression] case "${benchmarkCase.id}" failed:`,
        err instanceof Error ? err.message : err
      );
      summaryRows.push({
        caseId: benchmarkCase.id,
        preset: benchmarkCase.preset,
        asmrMode: undefined,
        meditationExperienceType: undefined,
        perspectiveRequested: benchmarkCase.perspectiveRequested ?? "-",
        perspectiveClassified: undefined,
        hasExplicitScenario: undefined,
        creativeDirectionPresent: false,
        sceneCount: 0,
        wordCount: 0,
        estimatedMinutes: 0,
        targetMinutes: benchmarkCase.durationMinutes,
        overallAssessment: "ERROR",
        overallScore: undefined,
        durationMs: 0,
      });
    }
  }

  fs.writeFileSync(path.join(runRoot, "run-summary.json"), JSON.stringify(summaryRows, null, 2), "utf8");

  console.log(`\n[cutover-readiness-live-regression] done -- output written to ${runRoot}`);
  console.log(
    `\n${"caseId".padEnd(30)}${"preset".padEnd(14)}${"asmr".padEnd(10)}${"medType".padEnd(18)}${"persp(req/got)".padEnd(
      16
    )}${"scenes".padEnd(8)}${"words".padEnd(8)}${"est.min".padEnd(9)}${"target".padEnd(8)}${"assess".padEnd(
      12
    )}score`
  );
  for (const row of summaryRows) {
    const persp = `${row.perspectiveRequested}/${row.perspectiveClassified ?? "-"}`;
    console.log(
      `${row.caseId.padEnd(30)}${String(row.preset).padEnd(14)}${String(row.asmrMode ?? "-").padEnd(10)}${String(
        row.meditationExperienceType ?? "-"
      ).padEnd(18)}${persp.padEnd(16)}${String(row.sceneCount).padEnd(8)}${String(row.wordCount).padEnd(
        8
      )}${String(row.estimatedMinutes).padEnd(9)}${String(row.targetMinutes).padEnd(8)}${String(
        row.overallAssessment
      ).padEnd(12)}${row.overallScore ?? "-"}`
    );
  }
}

main().catch((err) => {
  console.error(
    "[run-creative-intelligence-cutover-readiness-live-regression] failed:",
    err instanceof Error ? err.message : err
  );
  process.exit(1);
});
