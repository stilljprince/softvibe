// scripts/test-creative-intelligence-perspective.ts
//
// RP-011C.8.11 -- Shared Perspective Fidelity.
//
// Root cause: no classifier, field, or prompt line anywhere in
// lib/creative-intelligence tracked or surfaced the grammatical person
// (first/second/third) a user explicitly asked for -- an explicit "write
// this in first person" request was only ever visible to the Writer
// buried inside intent.creativeDirection (and only for the presets that
// even got creativeDirection at all). Nothing pauses first person
// unconditionally either -- no preset guidance template hardcodes "must be
// second person" -- so the gap was fidelity (the request wasn't reliably
// preserved), not suppression. This suite locks in the fix:
// intent/classifiers.ts classifyPerspective() detects an explicit request
// for a specific grammatical person, preset-independently, and
// writer/prompts.ts surfaces it as a single explicit, priority-taking line
// in every writer prompt when present.
//
// Nothing here calls a provider for real, hits the database, or touches the
// active generation pipeline.
//
// Run with:  npx tsx scripts/test-creative-intelligence-perspective.ts

import {
  CreativeKnowledgeRegistry,
  initializeCreativeKnowledge,
  extractCreativeIntent,
  buildCreativeContext,
  buildStoryBlueprint,
  buildSceneBlueprints,
  buildGenerationGuidance,
  buildWriterUserPrompt,
} from "../lib/creative-intelligence";
import type { CreativeIntent, CreativePerspective } from "../lib/creative-intelligence";

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

const registry = new CreativeKnowledgeRegistry();
initializeCreativeKnowledge(registry);
const createdAt = "2026-01-01T00:00:00.000Z";

function userPromptFor(prompt: string, intent: CreativeIntent): string {
  const context = buildCreativeContext({ rawInput: { prompt }, intent, registry, createdAt });
  const blueprint = buildStoryBlueprint({ intent, context, createdAt });
  const scenes = buildSceneBlueprints({ intent, context, blueprint, createdAt });
  const guidance = buildGenerationGuidance({ scenes, blueprint, context, intent, createdAt });
  return buildWriterUserPrompt({ scene: scenes[0], guidance: guidance[0], blueprint, context, intent });
}

type Case = { id: string; prompt: string; expected: CreativePerspective; expectedSnippet: string };

// ─── Required cases: first, second, and third person, across presets ────

const CASES: Case[] = [
  {
    id: "sleep-story-first-person",
    prompt: "A sleep story about walking through a quiet valley, written in the first person.",
    expected: "first",
    expectedSnippet: `first person ("I"/"me")`,
  },
  {
    id: "meditation-second-person",
    prompt: "A calming meditation about the breath, written in the second person.",
    expected: "second",
    expectedSnippet: `second person ("you")`,
  },
  {
    id: "kids-story-third-person",
    prompt: "A kids story about a brave little fox, written in the third person.",
    expected: "third",
    expectedSnippet: `third person ("he"/"she"/"they")`,
  },
];

for (const { id, prompt, expected, expectedSnippet } of CASES) {
  const intent = extractCreativeIntent({ prompt });
  check(`${id}: perspective classifies as "${expected}"`, intent.perspective, expected);

  const userPrompt = userPromptFor(prompt, intent);
  checkTrue(`${id}: writer prompt includes a Perspective line`, userPrompt.includes("Perspective:"));
  checkTrue(`${id}: writer prompt names the correct grammatical person`, userPrompt.includes(expectedSnippet));
  checkTrue(
    `${id}: writer prompt states the perspective takes priority over the preset default`,
    /overrid/i.test(userPrompt.match(/Perspective:.*$/m)?.[0] ?? "")
  );
}

// ─── No preset unconditionally forces a perspective ──────────────────────
// (control case: with no explicit request, perspective stays unset and no
// Perspective line is added -- confirms nothing defaults it silently)

const CONTROL_PROMPTS_BY_PRESET: Array<{ preset: string; prompt: string }> = [
  { preset: "sleep-story", prompt: "A cozy sleep story about a warm cottage in the woods." },
  { preset: "meditation", prompt: "A calming meditation about the breath." },
  { preset: "classic-asmr", prompt: "An ASMR session with gentle whispering." },
  { preset: "kids-story", prompt: "A kids story about a brave little fox." },
  { preset: "narrative", prompt: "A story about a man who leaves his childhood home." },
];

for (const { preset, prompt } of CONTROL_PROMPTS_BY_PRESET) {
  const intent = extractCreativeIntent({ prompt });
  check(`${preset} control: perspective is unset with no explicit request`, intent.perspective, undefined);
  const userPrompt = userPromptFor(prompt, intent);
  checkTrue(`${preset} control: writer prompt has no Perspective line`, !userPrompt.includes("Perspective:"));
}

// ─── First person is never structurally unreachable for any preset ──────

{
  const firstPersonPrompts = [
    "A guided meditation, written in the first person, from my point of view.",
    "An ASMR session, written in the first person.",
    "A kids story about a brave little fox, written in the first person.",
  ];
  for (const prompt of firstPersonPrompts) {
    const intent = extractCreativeIntent({ prompt });
    checkTrue(
      `first-person request is preserved regardless of preset ("${intent.preset}")`,
      intent.perspective === "first"
    );
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
