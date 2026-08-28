// scripts/test-creative-engine-router.ts
//
// RP-011C.7D.1 / RP-011C.8J — Tests for the central Creative Engine Router
// (lib/creative-engine-router.ts). Verifies the production cutover's
// routing decision (all five presets, including narrative as of 8J, now
// resolve to Creative Intelligence), the exact-one-engine-per-request
// invariant, the writerMode:"provider" guard, input/output mapping,
// no-fallback failure behavior, and downstream (chunking/prosody)
// compatibility.
//
// No live OpenAI / ElevenLabs calls -- the Creative Intelligence and Legacy
// engines are both replaced with fakes via generateCreativeScript()'s
// test-only dependency-injection seam.
//
// Run with:  npx tsx scripts/test-creative-engine-router.ts

import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { enforceKidsSafety } from "../lib/script-builder";
import { splitToChunksSafe, getMaxCharsPerRequest, TTS_REQUEST_MAX_OVERSHOOT } from "../lib/audio/chunks";
import { applyV3Prosody } from "../lib/tts/prosody-v3";
import type { CreativePipelineResult } from "../lib/creative-intelligence/orchestration";

// This repo's convention (see scripts/run-narrative-benchmark.ts
// loadEnvironment()): .env then .env.local layered on top. Needed BEFORE
// lib/creative-engine-router.ts is loaded -- it re-exports
// lib/script-builder-openai.ts, which constructs a module-level OpenAI
// client on import (pre-existing pattern, out of this task's scope). No
// OpenAI call is actually made below; everything runs through fakes. This is
// why the router is imported dynamically inside main(), after dotenv.config()
// below has run, instead of as a static top-level import.
dotenv.config();
dotenv.config({ path: ".env.local", override: true });

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`[PASS] ${name}`);
    passed++;
  } else {
    console.log(`[FAIL] ${name}\n       expected=${e}\n       actual=  ${a}`);
    failed++;
  }
}

function checkTrue(name: string, condition: boolean): void {
  check(name, condition, true);
}

async function checkThrows(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    check(name, "did not throw", "threw");
  } catch {
    check(name, "threw", "threw");
  }
}

function fakePipelineResult(texts: string[]): CreativePipelineResult {
  return {
    generatedScenes: texts.map((text, i) => ({
      sceneId: `scene-${i}`,
      text,
      metadata: { createdAt: "2026-01-01T00:00:00.000Z", version: "test", writerMethod: "model-based" },
    })),
  } as unknown as CreativePipelineResult;
}

async function main() {
  const { generateCreativeScript, engineForPreset } = await import("../lib/creative-engine-router");

  // ─── A. Preset routing test ────────────────────────────────────────────
  // RP-011C.8J: all five production presets now route to Creative
  // Intelligence. No productive preset remains routed to Legacy.
  check("classic-asmr routes to CI", engineForPreset("classic-asmr"), "creative-intelligence");
  check("meditation routes to CI", engineForPreset("meditation"), "creative-intelligence");
  check("kids-story routes to CI", engineForPreset("kids-story"), "creative-intelligence");
  check("sleep-story routes to CI", engineForPreset("sleep-story"), "creative-intelligence");
  check("narrative routes to CI", engineForPreset("narrative"), "creative-intelligence");

  // ─── B. Exact-one-engine invariant ──────────────────────────────────────
  for (const preset of ["classic-asmr", "sleep-story", "meditation", "kids-story", "narrative"] as const) {
    let ciCalls = 0;
    let legacyCalls = 0;
    await generateCreativeScript(
      {
        preset,
        userPrompt: "test prompt",
        targetDurationSec: 300,
        language: "de",
      },
      {
        runCreativeIntelligencePipeline: async (req, opts) => {
          ciCalls++;
          return fakePipelineResult(["scene text"]);
        },
        runLegacyScriptBuilder: async () => {
          legacyCalls++;
          return { finalText: "legacy text" };
        },
      }
    );
    check(`${preset}: CI called exactly once`, ciCalls, 1);
    check(`${preset}: Legacy called zero times`, legacyCalls, 0);
  }

  // ─── C. Provider mode guard ─────────────────────────────────────────────
  {
    let capturedWriterMode: string | undefined;
    await generateCreativeScript(
      { preset: "meditation", userPrompt: "test prompt", language: "de" },
      {
        runCreativeIntelligencePipeline: async (req, opts) => {
          capturedWriterMode = opts?.writerMode;
          return fakePipelineResult(["scene text"]);
        },
      }
    );
    check("CI branch sets writerMode explicitly to 'provider'", capturedWriterMode, "provider");
  }

  // ─── D. Input mapping ───────────────────────────────────────────────────
  {
    let capturedRequest: unknown;
    await generateCreativeScript(
      {
        preset: "sleep-story",
        userPrompt: "a calm walk on the beach",
        targetDurationSec: 600,
        language: "en",
        preferenceContext: "USER PREFERENCE CONTEXT block",
      },
      {
        runCreativeIntelligencePipeline: async (req) => {
          capturedRequest = req;
          return fakePipelineResult(["scene text"]);
        },
      }
    );
    check("CI input: preset mapped to presetHint 'sleep-story'", (capturedRequest as { preset: string }).preset, "sleep-story");
    check("CI input: prompt passed through", (capturedRequest as { prompt: string }).prompt, "a calm walk on the beach");
    check("CI input: durationSec 600 -> durationMinutes 10", (capturedRequest as { durationMinutes: number }).durationMinutes, 10);
    check("CI input: language passed through structurally", (capturedRequest as { language: string }).language, "en");
    check(
      "CI input: preferenceContext passed through structurally",
      (capturedRequest as { preferenceContext: string }).preferenceContext,
      "USER PREFERENCE CONTEXT block"
    );
  }

  // RP-011C.8J: narrative now routes to Creative Intelligence, so its input
  // mapping is verified through the same CI branch as the other four
  // presets (not through runLegacyScriptBuilder, which narrative no longer
  // reaches in production).
  {
    let capturedRequest: unknown;
    await generateCreativeScript(
      {
        preset: "narrative",
        userPrompt: "a quiet knowledge piece about the sea",
        targetDurationSec: 120,
        voiceStyle: "whisper",
        narrativeMode: "quiet-knowledge",
        language: "de",
        preferenceContext: "prefs",
      },
      {
        runCreativeIntelligencePipeline: async (req) => {
          capturedRequest = req;
          return fakePipelineResult(["scene text"]);
        },
      }
    );
    check("CI input: narrative preset mapped to presetHint 'narrative'", (capturedRequest as { preset: string }).preset, "narrative");
    check("CI input: narrative prompt passed through", (capturedRequest as { prompt: string }).prompt, "a quiet knowledge piece about the sea");
    check("CI input: narrative durationSec 120 -> durationMinutes 2", (capturedRequest as { durationMinutes: number }).durationMinutes, 2);
    check("CI input: narrative language passed through structurally", (capturedRequest as { language: string }).language, "de");
    check(
      "CI input: narrative preferenceContext passed through structurally",
      (capturedRequest as { preferenceContext: string }).preferenceContext,
      "prefs"
    );
  }

  // ─── E. Final text join / empty scenes ──────────────────────────────────
  {
    const result = await generateCreativeScript(
      { preset: "classic-asmr", userPrompt: "p", language: "de" },
      {
        runCreativeIntelligencePipeline: async () =>
          fakePipelineResult(["  First scene.  ", "Second scene.", "  "]),
      }
    );
    check("Multiple scenes join with a blank-line separator", result.finalText, "First scene.\n\nSecond scene.");
  }

  await checkThrows("Empty generatedScenes throws", () =>
    generateCreativeScript(
      { preset: "classic-asmr", userPrompt: "p", language: "de" },
      { runCreativeIntelligencePipeline: async () => fakePipelineResult(["", "   "]) }
    )
  );

  // ─── F. Kids flow: CI finalText -> enforceKidsSafety ───────────────────
  {
    const result = await generateCreativeScript(
      { preset: "kids-story", userPrompt: "a gentle bedtime story", language: "de" },
      {
        runCreativeIntelligencePipeline: async () =>
          fakePipelineResult(["Once upon a time, a small rabbit found a new friend in the meadow."]),
      }
    );
    const safe = enforceKidsSafety(result.finalText, { strict: false });
    checkTrue("Kids-safe CI output passes enforceKidsSafety", safe.safe);
    checkTrue("enforceKidsSafety returns non-empty text for safe input", safe.text.trim().length > 0);
  }

  // ─── G. Preview/Complete parity ─────────────────────────────────────────
  {
    const completeSrc = fs.readFileSync(
      path.join(__dirname, "..", "app", "api", "jobs", "[id]", "complete", "route.ts"),
      "utf8"
    );
    const previewSrc = fs.readFileSync(
      path.join(__dirname, "..", "app", "api", "jobs", "[id]", "script-preview", "route.ts"),
      "utf8"
    );
    checkTrue(
      "complete route imports generateCreativeScript from the central router",
      /from ["']@\/lib\/creative-engine-router["']/.test(completeSrc) && /generateCreativeScript/.test(completeSrc)
    );
    checkTrue(
      "script-preview route imports generateCreativeScript from the central router",
      /from ["']@\/lib\/creative-engine-router["']/.test(previewSrc) && /generateCreativeScript/.test(previewSrc)
    );
    checkTrue(
      "complete route no longer imports buildScriptOpenAI directly",
      !/import\s*\{[^}]*buildScriptOpenAI/.test(completeSrc)
    );
    checkTrue(
      "script-preview route no longer imports buildScriptOpenAI directly",
      !/import\s*\{[^}]*buildScriptOpenAI/.test(previewSrc)
    );
  }

  // ─── H. CI failure -> no Legacy fallback ────────────────────────────────
  {
    let legacyCalls = 0;
    await checkThrows("CI failure propagates (does not resolve)", () =>
      generateCreativeScript(
        { preset: "meditation", userPrompt: "p", language: "de" },
        {
          runCreativeIntelligencePipeline: async () => {
            throw new Error("simulated CI failure");
          },
          runLegacyScriptBuilder: async () => {
            legacyCalls++;
            return { finalText: "legacy text" };
          },
        }
      )
    );
    check("CI failure never falls back to Legacy", legacyCalls, 0);
  }

  // ─── I. Narrative cutover regression (RP-011C.8J): CI result used
  // verbatim, Legacy never touched ────────────────────────────────────────
  {
    let legacyCalls = 0;
    let capturedRequest: unknown;
    const result = await generateCreativeScript(
      {
        preset: "narrative",
        userPrompt: "a longform story",
        targetDurationSec: 2700,
        voiceStyle: "soft",
        narrativeMode: "story",
        language: "en",
      },
      {
        runCreativeIntelligencePipeline: async (req) => {
          capturedRequest = req;
          return fakePipelineResult(["narrative CI scene text"]);
        },
        runLegacyScriptBuilder: async () => {
          legacyCalls++;
          return { finalText: "should not be used" };
        },
      }
    );
    check("Narrative uses CI result verbatim", result.finalText, "narrative CI scene text");
    check("Narrative never touches Legacy", legacyCalls, 0);
    check(
      "Narrative CI call keeps full arg shape (no dropped fields)",
      capturedRequest,
      {
        prompt: "a longform story",
        preset: "narrative",
        durationMinutes: 45,
        language: "en",
      }
    );
  }

  // ─── J. Downstream compatibility: chunking + prosody accept CI output ──
  {
    const result = await generateCreativeScript(
      { preset: "sleep-story", userPrompt: "p", language: "de" },
      {
        runCreativeIntelligencePipeline: async () =>
          fakePipelineResult([
            "Chapter one text. ".repeat(50),
            "Chapter two text. ".repeat(50),
          ]),
      }
    );
    let threw = false;
    try {
      const chunks = splitToChunksSafe(result.finalText, getMaxCharsPerRequest(), TTS_REQUEST_MAX_OVERSHOOT);
      checkTrue("splitToChunksSafe produces at least one chunk", chunks.length > 0);
      const prosodyOut = applyV3Prosody({ preset: "sleep-story", text: chunks[0], seed: "test-job" });
      checkTrue("applyV3Prosody returns non-empty text", prosodyOut.trim().length > 0);
    } catch {
      threw = true;
    }
    checkTrue("CI finalText flows through chunking + prosody without throwing", !threw);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
