// lib/creative-engine-router.ts
//
// RP-011C.7D.1 — Central Creative Engine Router.
//
// Every script-generation request routes to EXACTLY ONE creative engine:
// Legacy (buildScriptOpenAI) or Creative Intelligence (runCreativePipeline).
// Never both in the same request:
//   - no Creative Intelligence -> Legacy Writer/Copy Editor
//   - no Legacy Plan -> Creative Intelligence Writer
//   - no silent Legacy retry on a Creative Intelligence failure
//
// This is the single place the preset -> engine decision lives. Both
// production entry points (app/api/jobs/[id]/complete,
// app/api/jobs/[id]/script-preview) call generateCreativeScript() instead of
// each re-implementing the preset switch, so they can never disagree about
// which engine a given preset uses.

import { buildScriptOpenAI } from "@/lib/script-builder-openai";
import type { ScriptPreset } from "@/lib/script-builder";
import { runCreativePipeline } from "@/lib/creative-intelligence/orchestration";
import type { CreativePreset } from "@/lib/creative-intelligence/core/constants";

export type CreativeEngine = "legacy" | "creative-intelligence";

// RP-011C.8J narrative cutover: all five production presets now route to
// Creative Intelligence. Single source of truth — no duplicated preset
// switches anywhere else.
const CREATIVE_ENGINE_ROUTING: Record<ScriptPreset, CreativeEngine> = {
  "classic-asmr": "creative-intelligence",
  "sleep-story": "creative-intelligence",
  meditation: "creative-intelligence",
  "kids-story": "creative-intelligence",
  narrative: "creative-intelligence",
};

// ScriptPreset (lib/script-builder.ts) and Creative Intelligence's
// CreativePreset (lib/creative-intelligence/core/constants.ts) happen to
// share the same literal union today. Kept as an explicit mapping rather
// than an implicit cast so a future divergence between the two vocabularies
// fails a type-check here instead of silently misrouting a preset's hint.
const CI_PRESET_HINT: Record<ScriptPreset, CreativePreset> = {
  "classic-asmr": "classic-asmr",
  "sleep-story": "sleep-story",
  meditation: "meditation",
  "kids-story": "kids-story",
  narrative: "narrative",
};

export function engineForPreset(preset: ScriptPreset): CreativeEngine {
  return CREATIVE_ENGINE_ROUTING[preset];
}

export type GenerateCreativeScriptInput = {
  preset: ScriptPreset;
  userPrompt: string;
  targetDurationSec?: number;
  // Relevant to the Legacy branch only (classic-asmr word-target
  // calibration); Creative Intelligence does not read it.
  voiceStyle?: "soft" | "whisper" | null;
  // Legacy narrative submode. Relevant to the Legacy branch only; Creative
  // Intelligence does not read it. No production preset currently routes to
  // Legacy, but the field stays wired for the (typed) Legacy branch below.
  narrativeMode?: "story" | "quiet-knowledge" | null;
  language: "de" | "en";
  preferenceContext?: string;
};

export type GenerateCreativeScriptResult = { finalText: string };

// Production writer mode for the Creative Intelligence branch. Deliberately
// NOT left to runCreativePipeline()'s "mock" default -- an accidental mock
// output in production is not acceptable. Asserted at call time so a future
// edit that weakens this constant fails loudly instead of silently shipping
// placeholder text.
const PRODUCTION_CI_WRITER_MODE = "provider" as const;

function assertProviderWriterMode(mode: string): void {
  if (mode !== "provider") {
    throw new Error(
      `[creative-engine-router] Refusing Creative Intelligence production call with writerMode="${mode}" -- production must use "provider".`
    );
  }
}

function durationSecToMinutes(targetDurationSec?: number): number | undefined {
  return typeof targetDurationSec === "number" ? targetDurationSec / 60 : undefined;
}

// Injectable seams for tests only (scripts/test-creative-engine-router.ts).
// Both default to the real implementations, so neither production call site
// (app/api/jobs/[id]/complete, app/api/jobs/[id]/script-preview) passes a
// second argument and production behavior is unaffected. This is what makes
// the "exactly one engine per call" and "CI failure -> no Legacy fallback"
// invariants verifiable with spies instead of live provider/OpenAI calls.
export type GenerateCreativeScriptDeps = {
  runCreativeIntelligencePipeline?: typeof runCreativePipeline;
  runLegacyScriptBuilder?: typeof buildScriptOpenAI;
};

async function runViaCreativeIntelligence(
  input: GenerateCreativeScriptInput,
  runPipeline: typeof runCreativePipeline
): Promise<GenerateCreativeScriptResult> {
  assertProviderWriterMode(PRODUCTION_CI_WRITER_MODE);

  const result = await runPipeline(
    {
      prompt: input.userPrompt,
      preset: CI_PRESET_HINT[input.preset],
      durationMinutes: durationSecToMinutes(input.targetDurationSec),
      language: input.language,
      preferenceContext: input.preferenceContext,
    },
    { writerMode: PRODUCTION_CI_WRITER_MODE }
  );

  const finalText = result.generatedScenes
    .map((scene) => scene.text.trim())
    .filter(Boolean)
    .join("\n\n");

  if (!finalText) {
    throw new Error(
      "[creative-engine-router] Creative Intelligence pipeline returned no generated scenes"
    );
  }

  return { finalText };
}

async function runViaLegacy(
  input: GenerateCreativeScriptInput,
  runLegacyBuilder: typeof buildScriptOpenAI
): Promise<GenerateCreativeScriptResult> {
  return runLegacyBuilder({
    preset: input.preset,
    userPrompt: input.userPrompt,
    targetDurationSec: input.targetDurationSec,
    voiceStyle: input.voiceStyle,
    narrativeMode: input.narrativeMode ?? null,
    language: input.language,
    preferenceContext: input.preferenceContext,
  });
}

// Central Creative Engine Router (RP-011C.7D.1). Exactly one engine runs per
// call. No try/CI/catch/fallback-to-Legacy here or in either caller -- a
// Creative Intelligence error propagates to the caller's existing
// failure/recovery path unchanged.
export async function generateCreativeScript(
  input: GenerateCreativeScriptInput,
  deps: GenerateCreativeScriptDeps = {}
): Promise<GenerateCreativeScriptResult> {
  const runPipeline = deps.runCreativeIntelligencePipeline ?? runCreativePipeline;
  const runLegacyBuilder = deps.runLegacyScriptBuilder ?? buildScriptOpenAI;

  const engine = engineForPreset(input.preset);
  if (engine === "legacy") {
    return runViaLegacy(input, runLegacyBuilder);
  }
  return runViaCreativeIntelligence(input, runPipeline);
}
