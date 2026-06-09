// scripts/test-narrative-prompts.ts
//
// Offline regression test for the Narrative preset's OpenAI prompt strategy.
// Runs without network or env vars:
//
//   npx tsx scripts/test-narrative-prompts.ts
//
// Verifies that:
//   - Narrative Story prompts do NOT carry ASMR or Meditation wording.
//   - Narrative Quiet Knowledge prompts do NOT carry ASMR, Meditation, or
//     Sleep-Story wording, and do NOT default to a podcast-host register.
//   - A missing / unknown narrativeMode resolves to "story".
//
// These guards are the contract that prevents Narrative outputs from
// silently inheriting meditation scaffolding (the original integration bug).

import { buildNarrativeOpenAIPrompts } from "../lib/script-builder-narrative";

type Case = {
  label: string;
  prompts: { system: string; user: string };
  forbidden: RegExp[];
  required?: RegExp[];
};

function check(c: Case): { passed: number; failed: number; details: string[] } {
  const haystack = `${c.prompts.system}\n${c.prompts.user}`;
  const details: string[] = [];
  let passed = 0;
  let failed = 0;

  for (const pat of c.forbidden) {
    if (pat.test(haystack)) {
      failed++;
      details.push(`  [FAIL] forbidden pattern matched: ${pat}`);
    } else {
      passed++;
    }
  }
  for (const pat of c.required ?? []) {
    if (pat.test(haystack)) {
      passed++;
    } else {
      failed++;
      details.push(`  [FAIL] required pattern missing: ${pat}`);
    }
  }
  return { passed, failed, details };
}

function run() {
  const totals = { passed: 0, failed: 0 };

  // 1) Story mode — German crime prompt
  const story = buildNarrativeOpenAIPrompts(
    {
      userPrompt: "Schreibe mir eine Krimigeschichte über einen Juwelenraub im Jahr 1938 in München.",
      outputLanguage: "German",
      wordTarget: 1800,
      targetDurationSec: 900,
    },
    "story",
  );

  if (story.resolvedMode !== "story") {
    console.error(`[FAIL] story mode resolved to "${story.resolvedMode}"`);
    totals.failed++;
  } else totals.passed++;

  const storyCheck = check({
    label: "Narrative Story (DE crime)",
    prompts: { system: story.system, user: story.user },
    forbidden: [
      // Scaffolding headers from buildScriptOpenAI's fallback cascade. These
      // strings only appear when narrative leaks into another preset's block.
      /CLASSIC ASMR MODE:/,
      /MEDITATION MODE:/,
      /SLEEP STORY MODE:/,
      // Inherited copy from the ASMR / meditation defaults
      /Positive Affirmations im ASMR-Stil/i,
      /Nur sehr sparsam Atemhinweise/i,
      // Sleep-story specific end-tag — story must NOT bake this in
      /End with:\s*"Good night\."/i,
      /End with:\s*"Gute Nacht\."/i,
    ],
    required: [
      // Story-specific signal
      /narrative\s*\/\s*story/i,
    ],
  });
  console.log(`[${storyCheck.failed === 0 ? "PASS" : "FAIL"}] Narrative Story — ${storyCheck.passed} ok, ${storyCheck.failed} fail`);
  storyCheck.details.forEach((d) => console.log(d));
  totals.passed += storyCheck.passed;
  totals.failed += storyCheck.failed;

  // 2) Quiet Knowledge mode — German factual prompt
  const qk = buildNarrativeOpenAIPrompts(
    {
      userPrompt: "Erzähle mir eine ruhige Wissensreise über das Leben im alten Rom.",
      outputLanguage: "German",
      wordTarget: 1800,
      targetDurationSec: 900,
    },
    "quiet-knowledge",
  );

  if (qk.resolvedMode !== "quiet-knowledge") {
    console.error(`[FAIL] quiet-knowledge mode resolved to "${qk.resolvedMode}"`);
    totals.failed++;
  } else totals.passed++;

  const qkCheck = check({
    label: "Narrative Quiet Knowledge (DE Roman life)",
    prompts: { system: qk.system, user: qk.user },
    forbidden: [
      // Scaffolding headers from buildScriptOpenAI's fallback cascade.
      /CLASSIC ASMR MODE:/,
      /MEDITATION MODE:/,
      /SLEEP STORY MODE:/,
      // Inherited copy from the ASMR / meditation defaults
      /Positive Affirmations im ASMR-Stil/i,
      /Nur sehr sparsam Atemhinweise/i,
      // Sleep-story end-tag — QK must never bake this in
      /End with:\s*"Good night\."/i,
      /End with:\s*"Gute Nacht\."/i,
    ],
    required: [
      /narrative\s*\/\s*quiet-knowledge/i,
    ],
  });
  console.log(`[${qkCheck.failed === 0 ? "PASS" : "FAIL"}] Narrative Quiet Knowledge — ${qkCheck.passed} ok, ${qkCheck.failed} fail`);
  qkCheck.details.forEach((d) => console.log(d));
  totals.passed += qkCheck.passed;
  totals.failed += qkCheck.failed;

  // 3) Missing / unknown narrativeMode defaults to story
  const fallback = buildNarrativeOpenAIPrompts(
    {
      userPrompt: "Ein ruhiger Abend.",
      outputLanguage: "German",
      wordTarget: 600,
      targetDurationSec: 300,
    },
    null,
  );
  if (fallback.resolvedMode === "story") {
    console.log(`[PASS] Missing narrativeMode → defaults to "story"`);
    totals.passed++;
  } else {
    console.log(`[FAIL] Missing narrativeMode resolved to "${fallback.resolvedMode}"`);
    totals.failed++;
  }

  const bogus = buildNarrativeOpenAIPrompts(
    {
      userPrompt: "Ein ruhiger Abend.",
      outputLanguage: "German",
      wordTarget: 600,
      targetDurationSec: 300,
    },
    // intentionally invalid value, cast through unknown to exercise the runtime guard
    "garbage" as unknown as null,
  );
  if (bogus.resolvedMode === "story") {
    console.log(`[PASS] Unknown narrativeMode → defaults to "story"`);
    totals.passed++;
  } else {
    console.log(`[FAIL] Unknown narrativeMode resolved to "${bogus.resolvedMode}"`);
    totals.failed++;
  }

  console.log("");
  console.log(`Total: ${totals.passed + totals.failed}   Passed: ${totals.passed}   Failed: ${totals.failed}`);
  if (totals.failed > 0) process.exit(1);
}

run();
