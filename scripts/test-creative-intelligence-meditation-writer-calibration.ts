// scripts/test-creative-intelligence-meditation-writer-calibration.ts
//
// RP-011C.8.8.2F — Isolated tests validating whether the existing Writer
// Layer (lib/creative-intelligence/writer/**) can produce meditation-
// appropriate output using the existing architecture, and locking in the
// meditation-only prompt-label calibration this validation pass made.
//
// Nothing here touches the active generation pipeline, calls a provider, or
// hits the database.
//
// Run with:  npx tsx scripts/test-creative-intelligence-meditation-writer-calibration.ts

import {
  CreativeKnowledgeRegistry,
  initializeCreativeKnowledge,
  buildCreativeContext,
  buildStoryBlueprint,
  buildSceneBlueprints,
  buildGenerationGuidance,
  buildWriterPrompt,
  buildWriterUserPrompt,
  writeScene,
} from "../lib/creative-intelligence";
import type {
  CreativeContext,
  CreativeIntent,
  GenerationGuidance,
  SceneBlueprint,
  StoryBlueprint,
} from "../lib/creative-intelligence";

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

function contextFor(intent: CreativeIntent, prompt = "test"): CreativeContext {
  return buildCreativeContext({ rawInput: { prompt }, intent, registry, createdAt: "2026-01-01T00:00:00.000Z" });
}

function blueprintFor(intent: CreativeIntent, prompt = "test"): StoryBlueprint {
  return buildStoryBlueprint({ intent, context: contextFor(intent, prompt), createdAt: "2026-01-01T00:00:00.000Z" });
}

function scenesFor(intent: CreativeIntent, prompt = "test"): SceneBlueprint[] {
  const context = contextFor(intent, prompt);
  const blueprint = blueprintFor(intent, prompt);
  return buildSceneBlueprints({ intent, context, blueprint, createdAt: "2026-01-01T00:00:00.000Z" });
}

function guidanceFor(intent: CreativeIntent, prompt = "test"): GenerationGuidance[] {
  const context = contextFor(intent, prompt);
  const blueprint = blueprintFor(intent, prompt);
  const scenes = buildSceneBlueprints({ intent, context, blueprint, createdAt: "2026-01-01T00:00:00.000Z" });
  return buildGenerationGuidance({ scenes, blueprint, context, intent, createdAt: "2026-01-01T00:00:00.000Z" });
}

function userPromptsFor(intent: CreativeIntent, prompt = "test"): string[] {
  const context = contextFor(intent, prompt);
  const blueprint = blueprintFor(intent, prompt);
  const scenes = scenesFor(intent, prompt);
  const guidance = guidanceFor(intent, prompt);
  return scenes.map((scene) => {
    const sceneGuidance = guidance.find((g) => g.sceneId === scene.id)!;
    return buildWriterUserPrompt({ scene, guidance: sceneGuidance, blueprint, context, intent });
  });
}

const meditationIntent: CreativeIntent = {
  preset: "meditation",
  experience: "a guided meditation for centering attention",
  audience: "adult",
  durationMinutes: 12,
  constraints: [],
};

const narrativeArcIntent: CreativeIntent = {
  preset: "narrative",
  experience: "an immersive narrative built around the listener's request",
  audience: "adult",
  durationMinutes: 20,
  constraints: [],
  storyScale: "arc",
  themes: ["courage"],
};

const kidsStoryIntent: CreativeIntent = {
  preset: "kids-story",
  experience: "a gentle, age-safe bedtime story for children",
  audience: "child",
  durationMinutes: 8,
  constraints: ["age-safe: avoid violence, horror, and existential themes"],
  storyScale: "gentle_journey",
  themes: ["friendship"],
  requiredElements: ["gentle_pacing", "safe_resolution", "positive_resolution", "age_safe_language"],
};

const sleepStoryIntent: CreativeIntent = {
  preset: "sleep-story",
  experience: "a relaxing bedtime story to help the listener fall asleep",
  audience: "adult",
  durationMinutes: 30,
  constraints: [],
  storyScale: "gentle_journey",
  emotionalDirection: ["calm", "safe"],
};

const classicAsmrIntent: CreativeIntent = {
  preset: "classic-asmr",
  experience: "a slow, sensory-focused ASMR session",
  audience: "adult",
  durationMinutes: 15,
  constraints: [],
};

// ─── 1. Meditation identity: the prompt must not present itself to the ────
//        Writer as story/narrative design ─────────────────────────────────

{
  const prompts = userPromptsFor(meditationIntent);

  checkTrue(
    "meditation user prompt never uses the 'STORY DESIGN' section title",
    prompts.every((p) => !p.includes("STORY DESIGN")),
  );
  checkTrue(
    "meditation user prompt never labels a field 'Story promise'",
    prompts.every((p) => !p.includes("Story promise")),
  );
  checkTrue(
    "meditation user prompt never labels a field 'Narrative function'",
    prompts.every((p) => !p.includes("Narrative function")),
  );
  checkTrue(
    "meditation user prompt uses a practice-appropriate design section title instead",
    prompts.every((p) => p.includes("PRACTICE DESIGN")),
  );
}

// ─── 2. Listener perspective: no 'Characters involved' line, and the ──────
//        explicit no-fictional-characters guidance is still present ───────

{
  const prompts = userPromptsFor(meditationIntent);
  const guidance = guidanceFor(meditationIntent);

  checkTrue(
    "meditation user prompt never presents the listener as 'Characters involved'",
    prompts.every((p) => !p.includes("Characters involved")),
  );
  checkTrue(
    "meditation GenerationGuidance still explicitly rules out fictional characters / narrated persona",
    guidance.every((g) => /not a character in a story|no fictional characters/i.test(g.characterGuidance)),
  );
  checkTrue(
    "meditation user prompt still carries that explicit no-fictional-characters guidance to the Writer",
    prompts.every((p) => /not a character in a story/i.test(p)),
  );
}

// ─── 3. Guidance execution: breath awareness, body awareness, attention ───
//        progression, and gradual transitions reach the Writer prompt ─────

{
  const prompts = userPromptsFor(meditationIntent);
  const combined = prompts.join("\n---\n");

  checkTrue("meditation prompts collectively mention breath", /breath/i.test(combined));
  checkTrue("meditation prompts collectively mention the body", /\bbody\b/i.test(combined));
  checkTrue(
    "meditation prompts collectively mention attention anchoring/progression",
    /attention/i.test(combined),
  );
  checkTrue(
    "meditation prompts collectively call for gradual, unhurried transitions",
    /gradual|unhurried|spacious pauses/i.test(combined),
  );
  checkTrue(
    "meditation scene order matches the six-phase attention progression",
    scenesFor(meditationIntent)
      .map((s) => s.narrativeFunction)
      .join(" -> ")
      .includes(
        [
          "Arrival and settling",
          "Breath and attention anchoring",
          "Body awareness and relaxation",
          "Practice deepening",
          "Integration",
          "Gentle return",
        ].join(" -> "),
      ),
  );
}

// ─── 4. Style execution: calm, acceptance, non-judgment, safety reach the ──
//        Writer prompt; mystical/guaranteed-outcome/overly poetic language ─
//        is explicitly told to the Writer to avoid ─────────────────────────

{
  const prompts = userPromptsFor(meditationIntent);
  const combined = prompts.join("\n---\n");

  checkTrue("meditation prompts collectively call for acceptance", /acceptance/i.test(combined));
  checkTrue("meditation prompts collectively call for non-judgment", /non-judgment/i.test(combined));
  checkTrue(
    "meditation prompts collectively instruct the Writer to avoid mystical/poetic overreach",
    /mystical|poetic language/i.test(combined),
  );
  checkTrue(
    "meditation prompts collectively instruct the Writer to avoid guaranteed-outcome claims",
    /guaranteed outcome/i.test(combined),
  );
}

// ─── 5. Writer output text (deterministic path) is still driven by the ────
//        guidance actually resolved for meditation, not a generic template ─

{
  const scenes = scenesFor(meditationIntent);
  const guidance = guidanceFor(meditationIntent);
  const context = contextFor(meditationIntent);
  const blueprint = blueprintFor(meditationIntent);

  const generated = writeScene({
    scene: scenes[1],
    guidance: guidance[1],
    blueprint,
    context,
    intent: meditationIntent,
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  checkTrue(
    "meditation writeScene() output reflects the meditation-specific writingFocus",
    generated.text.includes(guidance[1].writingFocus),
  );
  checkTrue(
    "meditation writeScene() output reflects the meditation-specific characterGuidance",
    generated.text.includes(guidance[1].characterGuidance),
  );
}

// ─── 6. Regression: narrative-coded prompt labels are unchanged for every ──
//        preset that keeps them (sleep-story, kids-story, narrative) --────
//        classic-asmr is calibrated separately (RP-011C.8.8.3F, see ────────
//        scripts/test-creative-intelligence-asmr-writer-calibration.ts) ────
//        and is intentionally excluded from this group ─────────────────────

{
  for (const intent of [narrativeArcIntent, kidsStoryIntent, sleepStoryIntent]) {
    const prompts = userPromptsFor(intent);
    checkTrue(`${intent.preset}: user prompt still uses 'STORY DESIGN'`, prompts.every((p) => p.includes("STORY DESIGN")));
    checkTrue(`${intent.preset}: user prompt still uses 'Story promise'`, prompts.every((p) => p.includes("Story promise")));
    checkTrue(
      `${intent.preset}: user prompt still uses 'Narrative function'`,
      prompts.every((p) => p.includes("Narrative function")),
    );
    checkTrue(
      `${intent.preset}: user prompt still uses 'Characters involved'`,
      prompts.every((p) => p.includes("Characters involved")),
    );
    checkTrue(`${intent.preset}: user prompt never uses 'PRACTICE DESIGN'`, prompts.every((p) => !p.includes("PRACTICE DESIGN")));
  }

  // classic-asmr no longer belongs to the story-vocabulary group post-3F --
  // confirm the old labels are gone rather than merely unchecked.
  const asmrPrompts = userPromptsFor(classicAsmrIntent);
  checkTrue("classic-asmr user prompt no longer uses 'STORY DESIGN'", asmrPrompts.every((p) => !p.includes("STORY DESIGN")));
  checkTrue("classic-asmr user prompt no longer uses 'Story promise'", asmrPrompts.every((p) => !p.includes("Story promise")));
  checkTrue(
    "classic-asmr user prompt no longer uses 'Narrative function'",
    asmrPrompts.every((p) => !p.includes("Narrative function")),
  );
  checkTrue(
    "classic-asmr user prompt no longer uses 'Characters involved'",
    asmrPrompts.every((p) => !p.includes("Characters involved")),
  );
}

// ─── 7. Regression: full prompt builder contract unaffected for narrative ──

{
  const scenes = scenesFor(narrativeArcIntent);
  const guidance = guidanceFor(narrativeArcIntent);
  const context = contextFor(narrativeArcIntent);
  const blueprint = blueprintFor(narrativeArcIntent);
  const scene = scenes[0];
  const sceneGuidance = guidance.find((g) => g.sceneId === scene.id)!;

  const prompt = buildWriterPrompt({ scene, guidance: sceneGuidance, blueprint, context, intent: narrativeArcIntent });
  checkTrue(
    "narrative buildWriterPrompt still returns a systemPrompt and userPrompt",
    typeof prompt.systemPrompt === "string" && typeof prompt.userPrompt === "string",
  );
  checkTrue("narrative system prompt still references the preset", prompt.systemPrompt.includes("narrative"));
}

// ─── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
