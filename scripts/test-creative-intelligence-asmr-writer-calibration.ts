// scripts/test-creative-intelligence-asmr-writer-calibration.ts
//
// RP-011C.8.8.3F — Isolated tests validating the Writer Layer
// (lib/creative-intelligence/writer/**) for classic ASMR, and locking in
// the classic-asmr-only prompt-label calibration this validation pass made
// (mirrors the meditation calibration in RP-011C.8.8.2F --
// scripts/test-creative-intelligence-meditation-writer-calibration.ts).
//
// Nothing here touches the active generation pipeline, calls a provider, or
// hits the database. No scripts are generated -- only the prompt text the
// Writer Layer would send to a provider is inspected.
//
// Run with:  npx tsx scripts/test-creative-intelligence-asmr-writer-calibration.ts

import {
  CreativeKnowledgeRegistry,
  initializeCreativeKnowledge,
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

const classicAsmrIntent: CreativeIntent = {
  preset: "classic-asmr",
  experience: "a slow, sensory-focused ASMR session",
  audience: "adult",
  durationMinutes: 15,
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

const meditationIntent: CreativeIntent = {
  preset: "meditation",
  experience: "a guided meditation for centering attention",
  audience: "adult",
  durationMinutes: 12,
  constraints: [],
};

// ─── 1. Sensory-experience identity: the prompt must present ASMR as a ────
//        sensory experience, not a story with characters ──────────────────

{
  const prompts = userPromptsFor(classicAsmrIntent);
  const systemPrompt = buildWriterSystemPrompt(classicAsmrIntent);

  checkTrue(
    "classic-asmr user prompt never uses the 'STORY DESIGN' section title",
    prompts.every((p) => !p.includes("STORY DESIGN")),
  );
  checkTrue(
    "classic-asmr user prompt never labels a field 'Story promise'",
    prompts.every((p) => !p.includes("Story promise")),
  );
  checkTrue(
    "classic-asmr user prompt never labels a field 'Narrative function'",
    prompts.every((p) => !p.includes("Narrative function")),
  );
  checkTrue(
    "classic-asmr user prompt uses a sensory-appropriate design section title instead",
    prompts.every((p) => p.includes("SENSORY DESIGN")),
  );
  checkTrue(
    "classic-asmr system prompt describes the preset emphasis in sensory, not narrative, terms",
    /sensory presence|gentle rhythm|personal closeness|no forced response/i.test(systemPrompt),
  );
  checkTrue(
    "classic-asmr system prompt never claims plot/character-driven emphasis",
    !/plot progression|character development/i.test(systemPrompt),
  );
}

// ─── 2. Listener perspective: no 'Characters involved' line, and the ──────
//        listener is addressed as a direct recipient, not a story character ─

{
  const prompts = userPromptsFor(classicAsmrIntent);
  const guidance = guidanceFor(classicAsmrIntent);

  checkTrue(
    "classic-asmr user prompt never presents the listener as 'Characters involved'",
    prompts.every((p) => !p.includes("Characters involved")),
  );
  checkTrue(
    "classic-asmr GenerationGuidance's characterGuidance addresses the listener directly, not staged dialogue",
    guidance.every((g) => /addressed directly|no fictional characters/i.test(g.characterGuidance)),
  );
  checkTrue(
    "classic-asmr user prompt still carries that direct-address guidance to the Writer",
    prompts.every((p) => /addressed directly|no fictional characters/i.test(p)),
  );
}

// ─── 3. Scene instructions: the five sensory-progression concepts reach ───
//        the Writer under the new 'Segment focus' label ────────────────────

{
  const prompts = userPromptsFor(classicAsmrIntent);
  const combined = prompts.join("\n---\n");

  checkTrue("classic-asmr prompts collectively use 'Segment focus'", /Segment focus:/.test(combined));
  checkTrue(
    "classic-asmr scene order matches the five-step sensory progression",
    scenesFor(classicAsmrIntent)
      .map((s) => s.narrativeFunction)
      .join(" -> ")
      .includes(
        ["Sensory introduction", "Gentle interaction", "Rhythmic repetition", "Sensory variation", "Continued comfort"].join(
          " -> ",
        ),
      ),
  );
  checkTrue("classic-asmr prompts collectively mention sensory introduction", /[Ss]ensory introduction/.test(combined));
  checkTrue("classic-asmr prompts collectively mention gentle interaction", /[Gg]entle interaction/.test(combined));
  checkTrue("classic-asmr prompts collectively mention rhythmic repetition", /[Rr]hythmic repetition/.test(combined));
  checkTrue("classic-asmr prompts collectively mention sensory variation", /[Ss]ensory variation/.test(combined));
  checkTrue("classic-asmr prompts collectively mention continued comfort", /[Cc]ontinued comfort/.test(combined));
}

// ─── 4. ASMR guidance principles reach the Writer: sensory focus, safe ────
//        personal address, gentle rhythm, no forced response ───────────────

{
  const prompts = userPromptsFor(classicAsmrIntent);
  const combined = prompts.join("\n---\n");

  checkTrue(
    "classic-asmr prompts collectively call for sensory-grounded description",
    /concrete sensory detail|sensory presence/i.test(combined),
  );
  checkTrue(
    "classic-asmr prompts collectively call for safe, personal address expecting nothing in return",
    /personal address|expects nothing in return|no expectation of a response/i.test(combined),
  );
  checkTrue(
    "classic-asmr prompts collectively call for slow, gentle rhythm",
    /slow|gently repetitive|unhurried/i.test(combined),
  );
  checkTrue(
    "classic-asmr prompts collectively instruct the Writer to avoid guaranteed-response claims",
    /guaranteed relaxation|tingling|emotional outcome/i.test(combined),
  );
}

// ─── 5. Writer output text (deterministic path) is still driven by the ────
//        guidance actually resolved for classic-asmr, not a generic template ─

{
  const scenes = scenesFor(classicAsmrIntent);
  const guidance = guidanceFor(classicAsmrIntent);
  const context = contextFor(classicAsmrIntent);
  const blueprint = blueprintFor(classicAsmrIntent);

  const generated = writeScene({
    scene: scenes[1],
    guidance: guidance[1],
    blueprint,
    context,
    intent: classicAsmrIntent,
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  checkTrue(
    "classic-asmr writeScene() output reflects the classic-asmr-specific writingFocus",
    generated.text.includes(guidance[1].writingFocus),
  );
  checkTrue(
    "classic-asmr writeScene() output reflects the classic-asmr-specific characterGuidance",
    generated.text.includes(guidance[1].characterGuidance),
  );
}

// ─── 6. Regression: narrative-coded prompt labels are unchanged for every ──
//        other preset (narrative, kids-story, sleep-story, meditation) ─────

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
    checkTrue(`${intent.preset}: user prompt never uses 'SENSORY DESIGN'`, prompts.every((p) => !p.includes("SENSORY DESIGN")));
  }

  const meditationPrompts = userPromptsFor(meditationIntent);
  checkTrue(
    "meditation user prompt still uses 'PRACTICE DESIGN', unaffected by the classic-asmr calibration",
    meditationPrompts.every((p) => p.includes("PRACTICE DESIGN")),
  );
  checkTrue(
    "meditation user prompt never uses 'SENSORY DESIGN'",
    meditationPrompts.every((p) => !p.includes("SENSORY DESIGN")),
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

// ─── 8. RP-011C.8.8.3O — Classic ASMR story mode Writer Layer calibration ──
//
// Writer must stay aware of intent.asmrMode: presence keeps exactly the
// prompt it always had (validated in section 1 above), while story mode's
// system prompt now names what story mode actually allows -- scenario,
// persona, gentle narrative movement -- instead of sharing presence's
// sensory-only emphasis line. Neither mode may take on Narrative's
// "STORY DESIGN" / "Story promise" / "Narrative function" / "Characters
// involved" vocabulary: classic-asmr story mode is ASMR delivery + story
// content, not the Narrative preset with an ASMR voice.

const classicAsmrStoryIntent: CreativeIntent = {
  ...classicAsmrIntent,
  asmrMode: "story",
};

const classicAsmrPresenceIntent: CreativeIntent = {
  ...classicAsmrIntent,
  asmrMode: "presence",
};

// 1. classic-asmr presence prompt is unchanged by the story-mode addition.

{
  const implicitPresenceSystem = buildWriterSystemPrompt(classicAsmrIntent);
  const explicitPresenceSystem = buildWriterSystemPrompt(classicAsmrPresenceIntent);
  check(
    "classic-asmr with no asmrMode produces the same system prompt as explicit asmrMode: presence",
    implicitPresenceSystem,
    explicitPresenceSystem,
  );
  checkTrue(
    "classic-asmr presence system prompt keeps its original sensory-only emphasis line",
    implicitPresenceSystem.includes("Preset emphasis: sensory presence, gentle rhythm, personal closeness, no forced response."),
  );
  checkTrue(
    "classic-asmr presence system prompt never mentions scenario, persona, or narrative movement",
    !/scenario|\bpersona\b|narrative movement/i.test(implicitPresenceSystem),
  );

  const presencePrompts = userPromptsFor(classicAsmrPresenceIntent);
  checkTrue(
    "classic-asmr presence user prompts still use 'SENSORY DESIGN' and 'Segment focus'",
    presencePrompts.every((p) => p.includes("SENSORY DESIGN") && p.includes("Segment focus:")),
  );
  checkTrue(
    "classic-asmr presence user prompts still never present a persona to the listener",
    presencePrompts.every((p) => /no fictional characters, dialogue partners, or narrated persona/i.test(p)),
  );
}

// 2. classic-asmr story prompt differs appropriately from presence's.

{
  const presenceSystem = buildWriterSystemPrompt(classicAsmrPresenceIntent);
  const storySystem = buildWriterSystemPrompt(classicAsmrStoryIntent);

  checkTrue("classic-asmr story system prompt differs from presence's", storySystem !== presenceSystem);
  checkTrue(
    "classic-asmr story system prompt still describes writing the same 'segment' unit for the same preset",
    storySystem.includes(`You write the segment text for a "classic-asmr" experience.`),
  );
  checkTrue(
    "classic-asmr story system prompt names scenario/persona/narrative-movement emphasis",
    /scenario/i.test(storySystem) && /persona/i.test(storySystem) && /narrative movement/i.test(storySystem),
  );
  checkTrue(
    "classic-asmr story system prompt still names personal closeness and no forced response",
    /personal closeness/i.test(storySystem) && /no forced response/i.test(storySystem),
  );

  const storyPrompts = userPromptsFor(classicAsmrStoryIntent);
  checkTrue(
    "classic-asmr story user prompt never switches to 'STORY DESIGN'",
    storyPrompts.every((p) => !p.includes("STORY DESIGN") && p.includes("SENSORY DESIGN")),
  );
  checkTrue(
    "classic-asmr story user prompt never switches to 'Story promise' or 'Narrative function'",
    storyPrompts.every((p) => !p.includes("Story promise") && !p.includes("Narrative function")),
  );
  checkTrue(
    "classic-asmr story user prompt never presents the listener as 'Characters involved'",
    storyPrompts.every((p) => !p.includes("Characters involved")),
  );
}

// 3. classic-asmr story prompt allows persona, roleplay, dialogue, and scenario framing.

{
  const storyPrompts = userPromptsFor(classicAsmrStoryIntent);
  const combined = storyPrompts.join("\n---\n");

  checkTrue(
    "classic-asmr story prompts collectively allow a gentle in-scene persona addressed to the listener",
    /gentle in-scene persona addressed directly to them/i.test(combined),
  );
  checkTrue(
    "classic-asmr story prompts collectively allow low-stakes dialogue with the persona",
    /low-stakes dialogue with the persona|low-stakes; never plot-advancing exchange/i.test(combined),
  );
  checkTrue(
    "classic-asmr story prompts collectively allow scenario/persona framing as an ordinary element",
    /gentle scenario and persona framing/i.test(combined),
  );
  checkTrue(
    "classic-asmr story prompts collectively describe gentle narrative/scene movement",
    /narrative sensory movement|scene move gently through its persona and setting/i.test(combined),
  );
  checkTrue(
    "classic-asmr story scene order follows the five-step scenario progression",
    scenesFor(classicAsmrStoryIntent)
      .map((s) => s.narrativeFunction)
      .join(" -> ") ===
      ["Scenario introduction", "Persona framing", "Gentle interaction", "Narrative sensory movement", "Continued comfort"].join(
        " -> ",
      ),
  );
}

// 4. classic-asmr story prompt still carries the ASMR-identity constraints:
//    voice-first sensory grounding, no forced response, no plot/climax.

{
  const storyPrompts = userPromptsFor(classicAsmrStoryIntent);
  const combined = storyPrompts.join("\n---\n");

  checkTrue(
    "classic-asmr story prompts still ground description in voice-based sensory detail",
    /voice, closeness, atmosphere|sensory attention is anchored in the voice itself/i.test(combined),
  );
  checkTrue(
    "classic-asmr story prompts still rule out guaranteed relaxation/tingling/emotional-outcome claims",
    /guaranteed relaxation, tingling, or emotional outcome/i.test(combined),
  );
  checkTrue(
    "classic-asmr story prompts still rule out a turning point, climax, or resolution",
    /never building toward a turning point, climax, or resolution/i.test(combined),
  );
  checkTrue(
    "classic-asmr story prompts still rule out a character arc, conflict, or plot for the persona",
    /not to carry a character arc, conflict, or plot/i.test(combined),
  );
  checkTrue(
    "classic-asmr story prompts still rule out external sound/object triggers",
    /Generating new external-trigger devices for a story or roleplay premise instead of keeping the voice as the sensory source/i.test(
      combined,
    ),
  );
}

// 5. Non-ASMR presets are unaffected by the story-mode template addition.

{
  for (const intent of [narrativeArcIntent, kidsStoryIntent, sleepStoryIntent, meditationIntent]) {
    const system = buildWriterSystemPrompt(intent);
    checkTrue(
      `${intent.preset}: system prompt unaffected by classic-asmr story-mode calibration`,
      !/scenario and persona|gentle narrative movement/i.test(system),
    );
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
