// scripts/test-creative-intelligence-asmr-creative-direction-validation.ts
//
// RP-011C.8.8.4B — ASMR Creative Direction Validation.
//
// RP-011C.8.8.4A introduced CreativeIntent.creativeDirection?: string so the
// Writer Layer can honor an explicit user creative request even when the
// deterministic preset/asmrMode/theme classifiers would otherwise discard
// it. This script validates whether that fix actually solves the previously
// identified problem: specific ASMR creative requests (a librarian roleplay,
// a companion scenario, a personal-attention framing, a story-in-ASMR-voice
// request) being detected as classic-asmr/story but having their actual
// creative content lost before it reaches the Writer.
//
// This is a validation and benchmark file only:
//   - It makes no changes to intent/, planning/, scenes/, guidance/,
//     evaluation/, or writer/.
//   - It only exercises the existing extractCreativeIntent(), the writer
//     prompt builder (buildWriterUserPrompt), and runCreativePipeline()
//     surfaces (writerMode: "mock" by default -- no OpenAI calls, no
//     production route).
//   - Section 3 (live generation) is opt-in only, gated identically to
//     scripts/test-creative-intelligence-asmr-mode-benchmark.ts's --live
//     flag.
//   - It does not fix any failures it finds -- it only reports them.
//
// Run with:
//   npx tsx scripts/test-creative-intelligence-asmr-creative-direction-validation.ts
//   CONFIRM_LIVE_BENCHMARK=true npx tsx scripts/test-creative-intelligence-asmr-creative-direction-validation.ts --live

import {
  extractCreativeIntent,
  buildCreativeContext,
  buildStoryBlueprint,
  buildSceneBlueprints,
  buildGenerationGuidance,
  buildWriterUserPrompt,
  CreativeKnowledgeRegistry,
  initializeCreativeKnowledge,
} from "../lib/creative-intelligence";
import type { ClassicAsmrMode, CreativeIntent, CreativePreset } from "../lib/creative-intelligence";
import { runCreativePipeline } from "../lib/creative-intelligence/orchestration";
import { loadEnvironment, enforceLiveModeGuards } from "./run-narrative-benchmark";

let passed = 0;
let failed = 0;
let findings = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const equal = JSON.stringify(actual) === JSON.stringify(expected);
  if (equal) {
    console.log(`[PASS] ${name}`);
    passed++;
  } else {
    console.log(`[FAIL] ${name}\n       expected=${JSON.stringify(expected)}\n       actual=  ${JSON.stringify(actual)}`);
    failed++;
  }
}

function checkTrue(name: string, condition: boolean): void {
  check(name, condition, true);
}

// Deliberately non-blocking: records a real, reproducible gap so it lands in
// the final report without asserting the run failed. Distinguishes "the
// feature is broken" (check/checkTrue, exit code 1) from "the feature has a
// known limitation to report" (this task's explicit ask).
function reportFinding(name: string, detail: string): void {
  console.log(`[FINDING] ${name}\n          ${detail}`);
  findings++;
}

type ValidationCase = {
  id: string;
  prompt: string;
  expectedPreset: CreativePreset;
  expectedAsmrMode: ClassicAsmrMode;
  expectedCreativeDirectionPreserved: boolean;
  // Loose keyword signals used only for the optional live-output pass
  // (Section 3) -- an observational check, not a hard correctness assertion,
  // since live LLM output is not deterministic.
  expectedConceptKeywords: string[];
  note: string;
};

const CASES: ValidationCase[] = [
  {
    id: "1-librarian-roleplay",
    prompt: "Create an ASMR librarian roleplay where you softly read me a few pages from your favorite book.",
    expectedPreset: "classic-asmr",
    expectedAsmrMode: "story",
    expectedCreativeDirectionPreserved: true,
    expectedConceptKeywords: ["librar", "book", "read"],
    note: "Roleplay + 'read me' trip classifyAsmrMode's story signals, so creativeDirection should be preserved.",
  },
  {
    id: "2-close-friend-companion",
    prompt: "Create an ASMR experience where a close friend helps me calm down after a stressful day.",
    expectedPreset: "classic-asmr",
    expectedAsmrMode: "story",
    expectedCreativeDirectionPreserved: true,
    expectedConceptKeywords: ["friend", "companion"],
    note: "RP-011C.8.8.4G: companion-scenario framing ('friend') now trips classifyAsmrMode's scenario signal directly, so this routes to the scenario-capable 'story' branch (not just 'presence' with creativeDirection preserved on the side, as under RP-011C.8.8.4C).",
  },
  {
    id: "3-personal-attention-session",
    prompt: "Create a gentle ASMR personal attention session because I had a difficult day.",
    expectedPreset: "classic-asmr",
    expectedAsmrMode: "story",
    expectedCreativeDirectionPreserved: true,
    expectedConceptKeywords: ["personal attention"],
    note: "RP-011C.8.8.4G: 'personal attention' now trips classifyAsmrMode's scenario signal directly, so this routes to the scenario-capable 'story' branch (not just 'presence' with creativeDirection preserved on the side, as under RP-011C.8.8.4C).",
  },
  {
    id: "4-mystery-thriller-in-asmr-voice",
    prompt: "Tell me a mysterious thriller story in an ASMR voice.",
    expectedPreset: "classic-asmr",
    expectedAsmrMode: "story",
    expectedCreativeDirectionPreserved: true,
    expectedConceptKeywords: ["mystery", "thriller"],
    note: "'story' keyword trips classifyAsmrMode's story signal, so creativeDirection should be preserved.",
  },
];

const registry = new CreativeKnowledgeRegistry();
initializeCreativeKnowledge(registry);

type CaseArtifacts = {
  intent: CreativeIntent;
  userPrompts: string[];
};

function buildArtifacts(prompt: string): CaseArtifacts {
  const intent = extractCreativeIntent({ prompt });
  const context = buildCreativeContext({ rawInput: { prompt }, intent, registry, createdAt: "2026-01-01T00:00:00.000Z" });
  const blueprint = buildStoryBlueprint({ intent, context, createdAt: "2026-01-01T00:00:00.000Z" });
  const scenes = buildSceneBlueprints({ intent, context, blueprint, createdAt: "2026-01-01T00:00:00.000Z" });
  const guidance = buildGenerationGuidance({ scenes, blueprint, context, intent, createdAt: "2026-01-01T00:00:00.000Z" });
  const userPrompts = scenes.map((scene) => {
    const sceneGuidance = guidance.find((g) => g.sceneId === scene.id)!;
    return buildWriterUserPrompt({ scene, guidance: sceneGuidance, blueprint, context, intent });
  });
  return { intent, userPrompts };
}

async function main(): Promise<void> {
console.log("\n=== SECTION 1: extractCreativeIntent (preset, asmrMode, creativeDirection) ===\n");

const caseArtifacts = new Map<string, CaseArtifacts>();

for (const c of CASES) {
  const artifacts = buildArtifacts(c.prompt);
  caseArtifacts.set(c.id, artifacts);
  const { intent } = artifacts;

  console.log(`[${c.id}] "${c.prompt}"`);
  console.log(`    preset=${intent.preset}  asmrMode=${intent.asmrMode ?? "(n/a)"}  creativeDirection=${intent.creativeDirection ? "preserved" : "absent"}`);
  console.log(`    note: ${c.note}`);

  check(`${c.id}: preset classifies as "${c.expectedPreset}"`, intent.preset, c.expectedPreset);
  check(`${c.id}: asmrMode classifies as "${c.expectedAsmrMode}"`, intent.asmrMode, c.expectedAsmrMode);

  if (c.expectedCreativeDirectionPreserved) {
    check(`${c.id}: creativeDirection is preserved verbatim`, intent.creativeDirection, c.prompt);
  } else {
    checkTrue(`${c.id}: creativeDirection is absent (expected, given asmrMode)`, intent.creativeDirection === undefined);
    reportFinding(
      `${c.id}: creative direction lost despite an explicit creative request`,
      `Prompt describes a specific scenario ("${c.prompt}") but classifyAsmrMode() resolves asmrMode to "presence" (no story/roleplay/persona keyword present), so classifyCreativeDirection()'s isAsmrStory gate never fires and the scenario is discarded before reaching the Writer. This reproduces the original RP-011C.8.8.4 problem for any ASMR request framed as an "experience"/"session" rather than an explicit story/roleplay.`
    );
  }
  console.log();
}

// ===========================================================================
// SECTION 2 -- Writer prompt inspection: does "USER CREATIVE DIRECTION"
// appear in the actual prompt text sent to the Writer, and does it carry the
// original user wording? (buildWriterUserPrompt only -- no provider call.)
// ===========================================================================

console.log("\n=== SECTION 2: Writer prompt (buildWriterUserPrompt) ===\n");

for (const c of CASES) {
  const { intent, userPrompts } = caseArtifacts.get(c.id)!;
  const combined = userPrompts.join("\n---\n");
  const hasSection = combined.includes("USER CREATIVE DIRECTION");
  const carriesOriginalPrompt = combined.includes(c.prompt);

  console.log(`[${c.id}] USER CREATIVE DIRECTION section present: ${hasSection}`);

  if (c.expectedCreativeDirectionPreserved) {
    checkTrue(`${c.id}: writer prompt includes the USER CREATIVE DIRECTION section`, hasSection);
    checkTrue(`${c.id}: writer prompt carries the original user prompt verbatim`, carriesOriginalPrompt);
    checkTrue(
      `${c.id}: writer prompt instructs the Writer to respect this direction faithfully`,
      combined.includes("Respect this direction faithfully")
    );
  } else {
    checkTrue(
      `${c.id}: writer prompt has no USER CREATIVE DIRECTION section (consistent with absent intent.creativeDirection)`,
      !hasSection
    );
    if (!hasSection) {
      reportFinding(
        `${c.id}: Writer never sees the user's specific scenario`,
        `Because intent.creativeDirection is undefined for this case, buildWriterUserPrompt() has no USER CREATIVE DIRECTION section to emit. The Writer only receives generic EXPERIENCE/SENSORY DESIGN fields (tone, themes, sensory scene steps) -- the "${c.expectedConceptKeywords.join("/")}"-shaped request from the prompt is not represented anywhere in what the model is asked to write.`
      );
    }
  }
  void intent;
  console.log();
}

// ===========================================================================
// SECTION 3 -- Optional live generation pass. Opt-in only, gated exactly
// like scripts/test-creative-intelligence-asmr-mode-benchmark.ts's --live
// flag. Observational only: logs whether the requested creative elements
// appear in the generated text. Not a hard pass/fail, since live LLM output
// is not deterministic -- reported as findings for the final report.
// ===========================================================================

console.log("\n=== SECTION 3: Live output quality (optional) ===\n");

const wantsLive = process.argv.includes("--live");

if (!wantsLive) {
  console.log("Skipping live pass: pass --live with CONFIRM_LIVE_BENCHMARK=true and OPENAI_API_KEY set to run against real generation.\n");
} else {
  loadEnvironment();
  enforceLiveModeGuards("live");

  for (const c of CASES) {
    console.log(`--- live: [${c.id}] "${c.prompt}" ---`);
    const result = await runCreativePipeline({ prompt: c.prompt, durationMinutes: 10 }, { writerMode: "provider" });
    const text = result.generatedScenes.map((s) => s.text).join("\n\n");
    console.log(text);

    const lowerText = text.toLowerCase();
    const matchedKeywords = c.expectedConceptKeywords.filter((kw) => lowerText.includes(kw.toLowerCase()));
    const allMatched = matchedKeywords.length === c.expectedConceptKeywords.length;

    console.log(
      `\n[OBSERVATION] ${c.id}: expected concept keywords [${c.expectedConceptKeywords.join(", ")}] -> matched [${matchedKeywords.join(", ") || "none"}]`
    );
    if (!allMatched) {
      reportFinding(
        `${c.id}: live output did not clearly reflect the requested concept`,
        `Expected concept keywords [${c.expectedConceptKeywords.join(", ")}] only partially or not at all present in generated text. intent.creativeDirection was ${
          result.intent.creativeDirection ? "preserved" : "absent"
        } for this run -- ${
          result.intent.creativeDirection
            ? "the Writer received the direction but did not clearly honor it in output"
            : "the Writer never received the direction, so this is the expected consequence of Section 1/2's finding, not a new one"
        }.`
      );
    }
    console.log();
  }
}

// ===========================================================================
// FINAL REPORT (RP-011C.8.8.4B acceptance criteria)
// ===========================================================================

console.log("\n=== FINAL REPORT ===\n");
console.log(`Cases tested: ${CASES.map((c) => c.id).join(", ")}`);
console.log(`\nIntent results:`);
for (const c of CASES) {
  const { intent } = caseArtifacts.get(c.id)!;
  console.log(
    `  - ${c.id}: preset=${intent.preset}, asmrMode=${intent.asmrMode}, creativeDirection=${intent.creativeDirection ? "preserved" : "absent"}`
  );
}
console.log(`\nWriter prompt results:`);
for (const c of CASES) {
  const { userPrompts } = caseArtifacts.get(c.id)!;
  const hasSection = userPrompts.join("\n---\n").includes("USER CREATIVE DIRECTION");
  console.log(`  - ${c.id}: USER CREATIVE DIRECTION section ${hasSection ? "present" : "absent"}`);
}
console.log(
  wantsLive
    ? `\nOutput quality observations: see Section 3 above (live pass ran).`
    : `\nOutput quality observations: not collected -- live pass skipped (rerun with --live, CONFIRM_LIVE_BENCHMARK=true, OPENAI_API_KEY set).`
);
console.log(
  `\nIs creativeDirection sufficient for MVP: YES, as of RP-011C.8.8.4G. classifyAsmrMode() now routes any classic-asmr prompt` +
    ` carrying a concrete scenario signal (companion, personal attention, role/persona framing, requested activity) to the` +
    ` scenario-capable 'story' branch directly, so classifyCreativeDirection()'s isAsmrStory gate covers all four cases here` +
    ` uniformly -- there is no longer a separate concrete-scenario carve-out independent of asmrMode.` +
    ` See scripts/test-creative-intelligence-asmr-creative-direction-trigger-calibration.ts for the dedicated regression suite.`
);
console.log(
  `\nLimitations identified (future work, not fixed by this task):` +
    `\n  1. There is currently no automated check that generated output actually honors a preserved creativeDirection -- only that the` +
    `\n     Writer prompt contains it. Whether the model complies is presently a live/manual read (Section 3 here), not a` +
    `\n     structural guarantee.` +
    `\n  2. creativeDirection preservation is preset-gated to classic-asmr story mode, narrative, and (as of RP-011C.8.10L)` +
    `\n     sleep-story (classifyCreativeDirection's isAsmrStory / isNarrative / isSleepStory checks) -- an explicit` +
    `\n     creative request embedded in a meditation or kids-story prompt is still out of scope for this mechanism.`
);

console.log(`\n${passed} passed, ${failed} failed, ${findings} findings logged`);
}

main()
  .then(() => {
    if (failed > 0) process.exit(1);
  })
  .catch((err) => {
    console.error("[test-creative-intelligence-asmr-creative-direction-validation] failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
