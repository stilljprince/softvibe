// scripts/test-creative-intelligence-sleep-story-writer-calibration.ts
//
// RP-011C.8.10I — Isolated tests validating the Writer Layer
// (lib/creative-intelligence/writer/**) for sleep-story, and locking in the
// sleep-story-only emphasis calibration this validation pass made (mirrors
// the meditation calibration in RP-011C.8.8.2F --
// scripts/test-creative-intelligence-meditation-writer-calibration.ts -- and
// the classic-asmr calibration in RP-011C.8.8.3F --
// scripts/test-creative-intelligence-asmr-writer-calibration.ts).
//
// Unlike meditation/classic-asmr, Sleep Story genuinely is a story about a
// protagonist and companions, so this calibration does NOT touch
// designSectionTitle/promiseLabel/functionLabel/charactersLabel -- those
// stay "STORY DESIGN"/"Story promise"/"Narrative function"/"Characters
// involved", same as narrative and kids-story. Only the writer template's
// emphasis line, which never went through the Sleep Story identity
// calibration applied everywhere else (knowledge/planning/scenes/guidance/
// evaluation), needed it.
//
// Nothing here touches the active generation pipeline, calls a provider, or
// hits the database. No scripts are generated -- only the prompt text the
// Writer Layer would send to a provider is inspected.
//
// Run with:  npx tsx scripts/test-creative-intelligence-sleep-story-writer-calibration.ts

import {
  CreativeKnowledgeRegistry,
  initializeCreativeKnowledge,
  extractCreativeIntent,
  buildCreativeContext,
  buildStoryBlueprint,
  buildSceneBlueprints,
  buildGenerationGuidance,
  buildWriterPrompt,
  buildWriterSystemPrompt,
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

const sleepStoryIntent: CreativeIntent = {
  preset: "sleep-story",
  experience: "a relaxing bedtime story to help the listener fall asleep",
  audience: "adult",
  durationMinutes: 30,
  constraints: [],
  storyScale: "gentle_journey",
  emotionalDirection: ["calm", "safe"],
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

const meditationIntent: CreativeIntent = {
  preset: "meditation",
  experience: "a guided meditation for centering attention",
  audience: "adult",
  durationMinutes: 12,
  constraints: [],
};

const classicAsmrIntent: CreativeIntent = {
  preset: "classic-asmr",
  experience: "a slow, sensory-focused ASMR session",
  audience: "adult",
  durationMinutes: 15,
  constraints: [],
};

// ─── 1. Sleep Story identity: dedicated writer emphasis reaches the ───────
//        system prompt, distinct from Meditation/classic-asmr/Narrative ───

{
  const systemPrompt = buildWriterSystemPrompt(sleepStoryIntent);

  checkTrue(
    "sleep-story system prompt names an external, in-world journey",
    /external, in-world journey/i.test(systemPrompt),
  );
  checkTrue(
    "sleep-story system prompt names gentle movement without urgency",
    /gentle movement without urgency/i.test(systemPrompt),
  );
  checkTrue(
    "sleep-story system prompt names peaceful curiosity over suspense",
    /peaceful curiosity, not suspense/i.test(systemPrompt),
  );
  checkTrue(
    "sleep-story system prompt names companions as warmth, not conflict",
    /companions as warmth, not conflict/i.test(systemPrompt),
  );
  checkTrue(
    "sleep-story system prompt names gradual transition toward sleep",
    /gradual transition toward sleep/i.test(systemPrompt),
  );
  checkTrue(
    "sleep-story system prompt names quiet, non-demanding endings",
    /quiet, non-demanding endings/i.test(systemPrompt),
  );
  checkTrue(
    "sleep-story system prompt never claims plot/character-driven emphasis",
    !/plot progression|character development/i.test(systemPrompt),
  );
}

// ─── 2. Story vocabulary is preserved: unlike Meditation/classic-asmr, ────
//        Sleep Story keeps 'STORY DESIGN' / 'Story promise' / 'Narrative ──
//        function' / 'Characters involved' -- it genuinely follows a ──────
//        protagonist and companions ────────────────────────────────────────

{
  const prompts = userPromptsFor(sleepStoryIntent);

  checkTrue("sleep-story user prompt still uses 'STORY DESIGN'", prompts.every((p) => p.includes("STORY DESIGN")));
  checkTrue("sleep-story user prompt still uses 'Story promise'", prompts.every((p) => p.includes("Story promise")));
  checkTrue(
    "sleep-story user prompt still uses 'Narrative function'",
    prompts.every((p) => p.includes("Narrative function")),
  );
  checkTrue(
    "sleep-story user prompt still uses 'Characters involved'",
    prompts.every((p) => p.includes("Characters involved")),
  );
  checkTrue("sleep-story user prompt never uses 'PRACTICE DESIGN'", prompts.every((p) => !p.includes("PRACTICE DESIGN")));
  checkTrue("sleep-story user prompt never uses 'SENSORY DESIGN'", prompts.every((p) => !p.includes("SENSORY DESIGN")));
}

// ─── 3. External-world framing: the protagonist follows an in-world ──────
//        journey, not an inward relaxation practice ────────────────────────

{
  const prompts = userPromptsFor(sleepStoryIntent);
  const combined = prompts.join("\n---\n");

  checkTrue(
    "sleep-story prompts collectively describe following a protagonist through the external world",
    /external world/i.test(combined),
  );
  checkTrue(
    "sleep-story prompts collectively call for gentle movement and peaceful curiosity",
    /gentle movement/i.test(combined) && /peaceful curiosity/i.test(combined),
  );
  checkTrue(
    "sleep-story prompts collectively rule out internal relaxation instruction",
    /not internal relaxation instruction/i.test(combined),
  );
  checkTrue(
    "sleep-story scene order matches the five-step arrival-to-rest progression",
    scenesFor(sleepStoryIntent)
      .map((s) => s.narrativeFunction)
      .join(" -> ") === ["Arrival", "Settling", "Gentle exploration", "Deeper immersion", "Gradual rest"].join(" -> "),
  );
}

// ─── 4. Writer prompt avoids Meditation instruction language ──────────────

{
  const prompts = userPromptsFor(sleepStoryIntent);
  const combined = prompts.join("\n---\n");

  checkTrue(
    "sleep-story prompts never instruct the Writer to speak like a meditation guide",
    !/guided language|breath and attention anchoring|invite the listener into|direct, gentle invitation to notice/i.test(
      combined,
    ),
  );
  checkTrue(
    "sleep-story prompts never use meditation's direct second-person practice framing",
    !/present-moment sensation|centered awareness|scattered attention/i.test(combined),
  );
  checkTrue(
    "sleep-story guidance explicitly rules out meditation-style companion behavior",
    guidanceFor(sleepStoryIntent).every((g) => !/guided-meditation voice/i.test(g.characterGuidance)),
  );
}

// ─── 5. Writer prompt avoids ASMR trigger language ─────────────────────────

{
  const prompts = userPromptsFor(sleepStoryIntent);
  const combined = prompts.join("\n---\n");

  checkTrue(
    "sleep-story prompts never use ASMR tingle/sensory-presence trigger language",
    !/tingle|sensory presence|no forced response/i.test(combined),
  );
  checkTrue(
    "sleep-story prompts only ever mention 'whisper' inside the explicit rule-out of ASMR whisper-trigger framing",
    prompts.every((p) => {
      const mentions = p.match(/whisper/gi) ?? [];
      return mentions.length === 0 || /never meditation-style breath\/body instruction or ASMR whisper-trigger framing/i.test(p);
    }),
  );
  checkTrue(
    "sleep-story prompts never use ASMR's 'Segment focus' or 'Sensory intention' labels",
    prompts.every((p) => !p.includes("Segment focus:") && !p.includes("Sensory intention:")),
  );
}

// ─── 6. Writer prompt avoids Narrative escalation framing ──────────────────

{
  const prompts = userPromptsFor(sleepStoryIntent);
  const combined = prompts.join("\n---\n");

  checkTrue(
    "sleep-story prompts never call for sustained tension or unresolved conflict",
    !/sustain tension|unresolved conflict|turning point/i.test(combined),
  );
  checkTrue(
    "sleep-story prompts collectively state every scene has no conflict to resolve",
    /None/.test(combined),
  );
  checkTrue(
    "sleep-story prompts collectively call for pacing that eases toward rest, not narrative escalation",
    /ease toward rest rather than escalating, building anticipation, or holding novelty back for later/i.test(combined),
  );
  checkTrue(
    "sleep-story avoidPatterns collectively rule out chases, danger, and suspense escalation",
    scenesFor(sleepStoryIntent).every((s) =>
      s.avoidPatterns.some((p) => /suspense escalation/i.test(p)) &&
      s.avoidPatterns.some((p) => /chases, pursuit/i.test(p)),
    ),
  );
}

// ─── 7. Writer output text (deterministic path) is still driven by the ────
//        guidance actually resolved for sleep-story, not a generic template ─

{
  const scenes = scenesFor(sleepStoryIntent);
  const guidance = guidanceFor(sleepStoryIntent);
  const context = contextFor(sleepStoryIntent);
  const blueprint = blueprintFor(sleepStoryIntent);

  const generated = writeScene({
    scene: scenes[1],
    guidance: guidance[1],
    blueprint,
    context,
    intent: sleepStoryIntent,
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  checkTrue(
    "sleep-story writeScene() output reflects the sleep-story-specific writingFocus",
    generated.text.includes(guidance[1].writingFocus),
  );
  checkTrue(
    "sleep-story writeScene() output reflects the sleep-story-specific characterGuidance",
    generated.text.includes(guidance[1].characterGuidance),
  );
  checkTrue(
    "sleep-story writeScene() output reflects the calibrated preset emphasis",
    /gentle movement without urgency/i.test(generated.text),
  );
}

// ─── 8. Regression: other presets are unaffected by the sleep-story-only ──
//        emphasis calibration ──────────────────────────────────────────────

{
  for (const intent of [narrativeArcIntent, kidsStoryIntent, meditationIntent, classicAsmrIntent]) {
    const system = buildWriterSystemPrompt(intent);
    checkTrue(
      `${intent.preset}: system prompt unaffected by the sleep-story emphasis calibration`,
      !/external, in-world journey|gentle movement without urgency|quiet, non-demanding endings/i.test(system),
    );
  }

  const meditationPrompts = userPromptsFor(meditationIntent);
  checkTrue(
    "meditation user prompt still uses 'PRACTICE DESIGN', unaffected by the sleep-story calibration",
    meditationPrompts.every((p) => p.includes("PRACTICE DESIGN")),
  );

  const asmrPrompts = userPromptsFor(classicAsmrIntent);
  checkTrue(
    "classic-asmr user prompt still uses 'SENSORY DESIGN', unaffected by the sleep-story calibration",
    asmrPrompts.every((p) => p.includes("SENSORY DESIGN")),
  );

  const narrativePrompts = userPromptsFor(narrativeArcIntent);
  checkTrue(
    "narrative user prompt still uses 'STORY DESIGN', unaffected by the sleep-story calibration",
    narrativePrompts.every((p) => p.includes("STORY DESIGN")),
  );
}

// ─── 9. Regression: full prompt builder contract unaffected for sleep-story ─

{
  const scenes = scenesFor(sleepStoryIntent);
  const guidance = guidanceFor(sleepStoryIntent);
  const context = contextFor(sleepStoryIntent);
  const blueprint = blueprintFor(sleepStoryIntent);
  const scene = scenes[0];
  const sceneGuidance = guidance.find((g) => g.sceneId === scene.id)!;

  const prompt = buildWriterPrompt({ scene, guidance: sceneGuidance, blueprint, context, intent: sleepStoryIntent });
  checkTrue(
    "sleep-story buildWriterPrompt still returns a systemPrompt and userPrompt",
    typeof prompt.systemPrompt === "string" && typeof prompt.userPrompt === "string",
  );
  checkTrue("sleep-story system prompt still references the preset", prompt.systemPrompt.includes("sleep-story"));
}

// ─── 10. Creative direction preservation (RP-011C.8.10L) ──────────────────
//
// Sleep Story now uses the same verbatim creativeDirection preservation
// mechanism as narrative and classic-asmr story mode, so a concrete user
// scenario (a valley walk under the stars, a snowy-mountain train ride)
// reaches the Writer instead of collapsing into the generic sleep-story
// template.

{
  const prompt = "A sleep story about walking through a peaceful valley under the stars";
  const intent = extractCreativeIntent({ prompt });

  check("sleep-story preset is inferred", intent.preset, "sleep-story");
  check("sleep-story creativeDirection preserves the prompt verbatim", intent.creativeDirection, prompt);

  const prompts = userPromptsFor(intent, prompt);
  const combined = prompts.join("\n---\n");

  checkTrue("sleep-story writer prompt includes the USER CREATIVE DIRECTION section", combined.includes("USER CREATIVE DIRECTION"));
  checkTrue("sleep-story writer prompt carries the original user prompt verbatim", combined.includes(prompt));
  checkTrue(
    "sleep-story writer prompt still instructs the Writer to respect the direction faithfully",
    combined.includes("Respect this direction faithfully"),
  );
  checkTrue("sleep-story writer prompt still uses 'STORY DESIGN' alongside the creative direction", prompts.every((p) => p.includes("STORY DESIGN")));
}

// ─── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
