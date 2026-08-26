// scripts/run-rp011c-7d2-gate-a-preview-routing-validation.ts
//
// RP-011C.7D.2 -- Gate A: Controlled Runtime Validation of the Creative
// Engine Router (lib/creative-engine-router.ts) for the five production
// presets, mirroring exactly what app/api/jobs/[id]/script-preview/route.ts
// does after job lookup:
//   generateCreativeScript() -> (kids: enforceKidsSafety()) -> finalText
//
// This is diagnostic-only. It calls the SAME generateCreativeScript() import
// both production entry points use, via its existing test-only
// dependency-injection seam (GenerateCreativeScriptDeps) so the actual engine
// choice (legacy vs creative-intelligence) can be observed without adding any
// production logging. Both injected deps wrap the REAL implementations
// (runCreativePipeline / buildScriptOpenAI) unchanged -- writerMode stays
// "provider" (enforced by the router itself) -- so every case is a genuine
// live provider call, not a mock.
//
// Does NOT touch the DB, NextAuth, ElevenLabs, chunking, or persistence --
// those are exercised by Gate B. Does NOT create/modify any Job row --
// there is no scriptOverride persistence step here (script-preview's DB
// write is out of scope per the explicit HTTP-auth-boundary constraint for
// this validation).
//
// Usage:
//   CONFIRM_LIVE_BENCHMARK=true npx tsx scripts/run-rp011c-7d2-gate-a-preview-routing-validation.ts

import { loadEnvironment, enforceLiveModeGuards } from "./run-narrative-benchmark";
import type {
  GenerateCreativeScriptDeps,
  GenerateCreativeScriptInput,
} from "../lib/creative-engine-router";

// Same reason as scripts/test-creative-engine-router.ts: lib/creative-engine-router.ts
// re-exports lib/script-builder-openai.ts, which constructs a module-level OpenAI
// client on import. dotenv must run first, so these are dynamic imports inside
// main() rather than static top-level imports.

type CaseDef = {
  preset: GenerateCreativeScriptInput["preset"];
  prompt: string;
  language: "de" | "en";
  expectedEngine: "legacy" | "creative-intelligence";
};

const CASES: CaseDef[] = [
  {
    preset: "classic-asmr",
    prompt: "Create a short gentle ASMR whisper experience focused on the voice.",
    language: "en",
    expectedEngine: "creative-intelligence",
  },
  {
    preset: "meditation",
    prompt: "Create a short calming meditation focused on natural breathing.",
    language: "en",
    expectedEngine: "creative-intelligence",
  },
  {
    preset: "kids-story",
    prompt: "Tell a short warm children's story about Mina the fox finding a lost blue scarf.",
    language: "en",
    expectedEngine: "creative-intelligence",
  },
  {
    // German case doubles as the German-language CI runtime check.
    preset: "sleep-story",
    prompt: "Erzähle eine kurze Einschlafgeschichte über eine ruhige Nachtzugfahrt durch die Landschaft.",
    language: "de",
    expectedEngine: "creative-intelligence",
  },
  {
    preset: "narrative",
    prompt: "Write a short mystery story about a locked room and a missing letter.",
    language: "en",
    expectedEngine: "legacy",
  },
];

type CaseResult = {
  preset: string;
  expectedEngine: string;
  observedEngine: string | null;
  engineMatch: boolean;
  ciCalled: boolean;
  legacyCalled: boolean;
  singleEngineOnly: boolean;
  finalTextPresent: boolean;
  finalTextChars: number;
  language: string;
  looksGerman: boolean | null;
  kidsSafetyRan: boolean | null;
  kidsSafetySafe: boolean | null;
  error: string | null;
};

// Heuristic only -- diagnostic language sanity check, not a translation QA
// pass. Looks for common German function words/diacritics.
function looksGerman(text: string): boolean {
  const sample = text.slice(0, 2000);
  const germanMarkers = /[äöüßÄÖÜ]|\b(und|der|die|das|nicht|eine|ist|sich|mit|auf)\b/i;
  return germanMarkers.test(sample);
}

async function runCase(
  def: CaseDef,
  generateCreativeScript: (
    input: GenerateCreativeScriptInput,
    deps?: GenerateCreativeScriptDeps
  ) => Promise<{ finalText: string }>,
  runCreativePipeline: typeof import("../lib/creative-intelligence/orchestration").runCreativePipeline,
  buildScriptOpenAI: typeof import("../lib/script-builder-openai").buildScriptOpenAI,
  enforceKidsSafety: typeof import("../lib/script-builder").enforceKidsSafety
): Promise<CaseResult> {
  let ciCalled = false;
  let legacyCalled = false;

  const deps: GenerateCreativeScriptDeps = {
    runCreativeIntelligencePipeline: (input, opts) => {
      ciCalled = true;
      return runCreativePipeline(input, opts);
    },
    runLegacyScriptBuilder: (input) => {
      legacyCalled = true;
      return buildScriptOpenAI(input);
    },
  };

  const result: CaseResult = {
    preset: def.preset,
    expectedEngine: def.expectedEngine,
    observedEngine: null,
    engineMatch: false,
    ciCalled: false,
    legacyCalled: false,
    singleEngineOnly: false,
    finalTextPresent: false,
    finalTextChars: 0,
    language: def.language,
    looksGerman: null,
    kidsSafetyRan: null,
    kidsSafetySafe: null,
    error: null,
  };

  try {
    const out = await generateCreativeScript(
      {
        preset: def.preset,
        userPrompt: def.prompt,
        targetDurationSec: 120,
        voiceStyle: "soft",
        narrativeMode: def.preset === "narrative" ? "story" : null,
        language: def.language,
      },
      deps
    );

    let finalText = (out?.finalText ?? "").trim();

    if (def.preset === "kids-story") {
      const safeResult = enforceKidsSafety(finalText, { strict: false });
      result.kidsSafetyRan = true;
      result.kidsSafetySafe = safeResult.safe;
      finalText = safeResult.text;
    }

    result.observedEngine = ciCalled ? "creative-intelligence" : legacyCalled ? "legacy" : null;
    result.ciCalled = ciCalled;
    result.legacyCalled = legacyCalled;
    result.singleEngineOnly = ciCalled !== legacyCalled; // exactly one true
    result.engineMatch = result.observedEngine === def.expectedEngine;
    result.finalTextPresent = finalText.length > 0;
    result.finalTextChars = finalText.length;
    if (def.language === "de" && result.finalTextPresent) {
      result.looksGerman = looksGerman(finalText);
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    result.observedEngine = ciCalled ? "creative-intelligence" : legacyCalled ? "legacy" : null;
    result.ciCalled = ciCalled;
    result.legacyCalled = legacyCalled;
    result.singleEngineOnly = ciCalled !== legacyCalled;
  }

  return result;
}

async function main(): Promise<void> {
  loadEnvironment();
  enforceLiveModeGuards("live");

  const { generateCreativeScript } = await import("../lib/creative-engine-router");
  const { runCreativePipeline } = await import("../lib/creative-intelligence/orchestration");
  const { buildScriptOpenAI } = await import("../lib/script-builder-openai");
  const { enforceKidsSafety } = await import("../lib/script-builder");

  const results: CaseResult[] = [];
  for (const def of CASES) {
    console.log(`\n[gate-a] running preset=${def.preset} language=${def.language} ...`);
    const r = await runCase(
      def,
      generateCreativeScript,
      runCreativePipeline,
      buildScriptOpenAI,
      enforceKidsSafety
    );
    results.push(r);
    console.log(
      `[gate-a] preset=${r.preset} engine=${r.observedEngine} expected=${r.expectedEngine} ` +
        `singleEngineOnly=${r.singleEngineOnly} finalTextChars=${r.finalTextChars} ` +
        `kidsSafety=${r.kidsSafetyRan ?? "n/a"}/${r.kidsSafetySafe ?? "n/a"} ` +
        `looksGerman=${r.looksGerman ?? "n/a"} error=${r.error ?? "none"}`
    );
  }

  console.log("\n\n================ GATE A SUMMARY ================");
  let allPass = true;
  for (const r of results) {
    const pass =
      !r.error &&
      r.engineMatch &&
      r.singleEngineOnly &&
      r.finalTextPresent &&
      (r.preset !== "kids-story" || r.kidsSafetyRan === true) &&
      (r.looksGerman === null || r.looksGerman === true);
    if (!pass) allPass = false;
    console.log(
      `${pass ? "PASS" : "FAIL"} | preset=${r.preset.padEnd(12)} engine=${(r.observedEngine ?? "none").padEnd(20)} ` +
        `expected=${r.expectedEngine.padEnd(20)} finalTextChars=${r.finalTextChars} ` +
        `singleEngineOnly=${r.singleEngineOnly} error=${r.error ?? "-"}`
    );
  }
  console.log(`\nGate A overall: ${allPass ? "PASS" : "FAIL"}`);
  console.log("==================================================\n");

  if (!allPass) process.exit(1);
}

main().catch((e) => {
  console.error("[gate-a] fatal error", e);
  process.exit(1);
});
