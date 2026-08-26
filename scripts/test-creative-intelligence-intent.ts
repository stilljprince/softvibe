// scripts/test-creative-intelligence-intent.ts
//
// RP-011C.7.22 — Isolated tests for the Creative Intent Extraction Layer
// (lib/creative-intelligence/intent/**). Nothing here touches the active
// generation pipeline, calls a provider, or hits the database.
//
// Run with:  npx tsx scripts/test-creative-intelligence-intent.ts

import fs from "node:fs";
import path from "node:path";
import { extractCreativeIntent } from "../lib/creative-intelligence";

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

// ─── 1. Basic extraction works (sleep story about a forest) ───────────

{
  const intent = extractCreativeIntent({ prompt: "a sleep story about a forest" });

  check("preset is inferred from 'sleep story' in the prompt", intent.preset, "sleep-story");
  checkTrue(
    "emotional direction includes a calming register",
    (intent.emotionalDirection ?? []).includes("calm")
  );
  checkTrue("experience string is non-empty", typeof intent.experience === "string" && intent.experience.length > 0);
}

// ─── 2. Narrative transformation request ───────────────────────────────

{
  const intent = extractCreativeIntent({
    prompt: "A story about a man who leaves his childhood bedroom and builds his own company.",
  });

  check("preset defaults to narrative with no hint", intent.preset, "narrative");
  check("storyScale is transformation", intent.storyScale, "transformation");
  checkTrue("themes include independence", (intent.themes ?? []).includes("independence"));
  checkTrue("themes include growth", (intent.themes ?? []).includes("growth"));
  check("requiredElements matches the transformation scale", intent.requiredElements, [
    "personal_change",
    "progression",
  ]);
}

// ─── 3. Kids story request ──────────────────────────────────────────────

{
  const intent = extractCreativeIntent({
    prompt: "a story for kids about a brave little turtle",
    presetHint: "kids-story",
  });

  check("audience is child", intent.audience, "child");
  checkTrue(
    "constraints include the age-safety constraint",
    (intent.constraints ?? []).some((c) => c.startsWith("age-safe"))
  );
  checkTrue(
    "requiredElements include kids-story safety elements",
    (intent.requiredElements ?? []).includes("positive_resolution") &&
      (intent.requiredElements ?? []).includes("age_safe_language")
  );
}

// ─── 4. Different presets produce different intents ────────────────────

{
  const prompt = "a calm evening experience";
  const presets = ["classic-asmr", "sleep-story", "meditation", "kids-story", "narrative"] as const;
  const intents = presets.map((presetHint) => extractCreativeIntent({ prompt, presetHint }));

  checkTrue(
    "each preset resolves to itself via presetHint",
    intents.every((intent, i) => intent.preset === presets[i])
  );

  const genres = new Set(intents.map((intent) => intent.genre));
  checkTrue("presets produce distinct genres", genres.size === presets.length);
}

// ─── 5. Extractor does not create scenes or prose ───────────────────────

{
  const intent = extractCreativeIntent({ prompt: "a meditation about the ocean at dawn" });
  const forbiddenKeys = ["scenes", "chapters", "dialogue", "prose", "plotBeats", "beats"];
  const offending = forbiddenKeys.filter((key) => key in (intent as Record<string, unknown>));
  check("CreativeIntent has no scene/prose/plot fields", offending, []);
  checkTrue("experience is a short description, not a generated script", intent.experience.length < 200);
}

// ─── 6. No imports from active pipeline or knowledge registry ──────────

{
  const forbiddenPaths = [
    "app/api/jobs",
    "lib/narrative",
    "lib/story-supervisor.ts",
    "lib/script-builder.ts",
    "lib/script-builder-openai.ts",
    "lib/tts",
    "lib/audio",
    "app/generate",
    "openai",
    "elevenlabs",
    "../knowledge/registry",
  ];

  const intentDir = path.join(process.cwd(), "lib/creative-intelligence/intent");
  const intentFiles = fs
    .readdirSync(intentDir)
    .filter((f) => /\.ts$/.test(f))
    .map((f) => path.join(intentDir, f));

  const offending: string[] = [];
  for (const file of intentFiles) {
    const content = fs.readFileSync(file, "utf8").toLowerCase();
    for (const forbidden of forbiddenPaths) {
      if (content.includes(forbidden.toLowerCase())) offending.push(`${path.relative(process.cwd(), file)} -> ${forbidden}`);
    }
  }
  check("no intent/ file references a pipeline path, provider, or the knowledge registry", offending, []);
}

// ─── 7. Classic ASMR mode (RP-011C.8.8.3I) ──────────────────────────────

{
  const intent = extractCreativeIntent({ prompt: "ASMR whisper" });
  check("presence-only ASMR prompt resolves to classic-asmr", intent.preset, "classic-asmr");
  check("no story signal defaults asmrMode to presence", intent.asmrMode, "presence");
}

{
  const intent = extractCreativeIntent({ prompt: "Tell me a story in ASMR voice" });
  check("explicit story request resolves to classic-asmr", intent.preset, "classic-asmr");
  check("explicit story signal sets asmrMode to story", intent.asmrMode, "story");
}

{
  const intent = extractCreativeIntent({ prompt: "ASMR librarian roleplay" });
  check("roleplay ASMR prompt resolves to classic-asmr", intent.preset, "classic-asmr");
  check("roleplay signal sets asmrMode to story", intent.asmrMode, "story");
}

{
  const intent = extractCreativeIntent({ prompt: "a sleep story about a forest" });
  check("asmrMode is unset for non-classic-asmr presets", intent.asmrMode, undefined);
}

// ─── 8. Creative direction preservation (RP-011C.8.8.4A) ────────────────

{
  const intent = extractCreativeIntent({ prompt: "ASMR whisper" });
  check("simple ASMR presence request does not create unnecessary creativeDirection", intent.creativeDirection, undefined);
}

{
  const prompt = "Create an ASMR librarian roleplay where a close friend reads me a few pages from a favorite book.";
  const intent = extractCreativeIntent({ prompt });
  check("ASMR roleplay/story request preserves creative direction", intent.creativeDirection, prompt);
}

{
  const prompt = "A story about a man who leaves his childhood bedroom and builds his own company.";
  const intent = extractCreativeIntent({ prompt });
  check("narrative preset preserves creative direction", intent.creativeDirection, prompt);
}

{
  // RP-011C.8.11: meditation and kids-story now preserve creativeDirection
  // too (same verbatim-preservation mechanism as narrative/sleep-story/
  // classic-asmr-story above) -- a specific meditation experience (e.g. "a
  // guided beach visualization") or a named kids-story premise/character
  // has somewhere to go now instead of being discarded before Planning.
  const meditationPrompt = "a meditation about the ocean at dawn";
  const kidsStoryPrompt = "a story for kids about a brave little turtle";
  const meditation = extractCreativeIntent({ prompt: meditationPrompt });
  const kidsStory = extractCreativeIntent({ prompt: kidsStoryPrompt, presetHint: "kids-story" });

  check("meditation preset preserves creative direction", meditation.creativeDirection, meditationPrompt);
  check("kids-story preset preserves creative direction", kidsStory.creativeDirection, kidsStoryPrompt);
}

// ─── 10. Sleep Story creative direction preservation (RP-011C.8.10L) ────
//
// RP-011C.8.10J's end-to-end benchmark found that concrete sleep-story
// scenarios (a valley walk under the stars, a train through snowy
// mountains) were discarded before reaching the Writer, which then fell
// back to generic sleep-story defaults regardless of what was asked for.
// Sleep-story now uses the same verbatim preservation mechanism as
// narrative and classic-asmr story mode.

{
  const prompts = [
    "A cozy sleep story about a warm cottage in the woods during a snowstorm",
    "A sleep story about walking through a peaceful valley under the stars",
    "A sleep story set in a quiet fantasy village where everyone is getting ready for bed",
    "A cozy bedtime story about a train journey through snowy mountains",
    "A sleep story about drifting along a calm coastline as the tide comes in",
  ];

  for (const prompt of prompts) {
    const intent = extractCreativeIntent({ prompt });
    check(`sleep-story preset is inferred for "${prompt}"`, intent.preset, "sleep-story");
    check(`sleep-story creativeDirection matches prompt verbatim: "${prompt}"`, intent.creativeDirection, prompt);
  }
}

// ─── 9. Existing tests still pass ───────────────────────────────────────
// (run separately: npx tsx scripts/test-creative-intelligence-knowledge.ts
//  and npx tsx scripts/test-creative-intelligence-context.ts)

// ─── Summary ─────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
