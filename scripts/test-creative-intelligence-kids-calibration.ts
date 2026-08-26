// scripts/test-creative-intelligence-kids-calibration.ts
//
// RP-011C.8.8.1B — Isolated tests for the Kids Story planning / scene /
// guidance calibration (lib/creative-intelligence/planning|scenes|guidance).
// Verifies kids-story gets its own relationship-driven creative behavior
// without touching the active generation pipeline, calling a provider, or
// hitting the database.
//
// Run with:  npx tsx scripts/test-creative-intelligence-kids-calibration.ts

import fs from "node:fs";
import path from "node:path";
import {
  CreativeKnowledgeRegistry,
  initializeCreativeKnowledge,
  buildCreativeContext,
  buildStoryBlueprint,
  buildSceneBlueprints,
  buildGenerationGuidance,
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

const kidsStoryArcIntent: CreativeIntent = { ...kidsStoryIntent, storyScale: "arc" };
const kidsStoryTransformationIntent: CreativeIntent = { ...kidsStoryIntent, storyScale: "transformation" };

const narrativeArcIntent: CreativeIntent = {
  preset: "narrative",
  experience: "an immersive narrative built around the listener's request",
  audience: "adult",
  durationMinutes: 20,
  constraints: [],
  storyScale: "arc",
  themes: ["courage"],
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

const classicAsmrIntent: CreativeIntent = {
  preset: "classic-asmr",
  experience: "a slow, sensory-focused ASMR session",
  audience: "adult",
  durationMinutes: 15,
  constraints: [],
};

// ─── 1. Kids Story planning is relationship/discovery-driven, not a ────
//        smaller adult narrative ────────────────────────────────────────

{
  const kidsBlueprint = blueprintFor(kidsStoryIntent);
  const narrativeBlueprint = blueprintFor(narrativeArcIntent);

  checkTrue(
    "kids-story protagonist.desire differs from narrative's generic plot-driven framing",
    kidsBlueprint.protagonist.desire !== narrativeBlueprint.protagonist.desire
  );
  checkTrue(
    "kids-story protagonist.desire reflects discovery/connection, not generic plot movement",
    /explore|discover|connect|friend/i.test(kidsBlueprint.protagonist.desire)
  );
  checkTrue(
    "kids-story protagonist.need centers warmth/belonging, not 'an internal shift'",
    /warmth|belonging|reassurance/i.test(kidsBlueprint.protagonist.need)
  );
  checkTrue(
    "kids-story protagonist fields do not use adult-narrative escalation language",
    ![kidsBlueprint.protagonist.initialState, kidsBlueprint.protagonist.desire, kidsBlueprint.protagonist.need, kidsBlueprint.protagonist.internalConflict, kidsBlueprint.protagonist.externalGoal].some(
      (field) => /resist|limitation|internal shift/i.test(field)
    )
  );
}

// ─── 2. Kids Story turning points (arc/transformation) stay gentle ──────

{
  const arcBlueprint = blueprintFor(kidsStoryArcIntent);
  const transformationBlueprint = blueprintFor(kidsStoryTransformationIntent);

  checkTrue("kids-story arc has one turning point", arcBlueprint.trajectory.turningPoints.length === 1);
  checkTrue(
    "kids-story transformation has two turning points",
    transformationBlueprint.trajectory.turningPoints.length === 2
  );

  const allTurningPointText = [...arcBlueprint.trajectory.turningPoints, ...transformationBlueprint.trajectory.turningPoints]
    .flatMap((tp) => [tp.description, tp.consequence])
    .join(" ");
  checkTrue(
    "kids-story turning points avoid dramatic-escalation vocabulary (resistance/limitation)",
    !/resistance|limitation|can no longer hold/i.test(allTurningPointText)
  );
  checkTrue(
    "kids-story turning points use discovery/friendship/understanding vocabulary",
    /discover|friend|understand|together/i.test(allTurningPointText)
  );
}

// ─── 3. Kids Story scenes cover discovery, friendship, and cooperation ──

{
  const kidsScenes = scenesFor(kidsStoryIntent);
  const combined = kidsScenes
    .map((s) => [s.purpose, s.conflict, s.desiredChange, s.settingGuidance].join(" "))
    .join(" ");

  // RP-011C.8.8.1E calibration: fewer structural events, not fewer beats --
  // the 7-beat progression (planning/templates.ts KIDS_STORY_PROGRESSION)
  // is realized as 5 scenes, merging the two low-conflict establishing
  // beats and merging the challenge/emotional-learning beats so the
  // learning is enacted in the same shared moment instead of a separate
  // narrated "lesson" scene.
  check("kids-story realizes its 7-beat progression as 5 consolidated scenes (density calibration)", kidsScenes.length, 5);
  checkTrue("kids-story scenes mention discovery", /discover/i.test(combined));
  checkTrue("kids-story scenes mention a friend/connection", /friend/i.test(combined));
  checkTrue("kids-story scenes mention cooperation", /cooperation|together|help/i.test(combined));
  checkTrue(
    "kids-story scenes avoid action-driven / epic-fantasy vocabulary",
    !/battle|fight|danger|villain|epic|escalat/i.test(combined)
  );
  checkTrue(
    "kids-story scenes carry dialogue/interaction emphasis, not just narration",
    kidsScenes.some((s) => /dialogue|conversation|say to each other/i.test(s.settingGuidance))
  );
}

// ─── 4. Kids Story guidance centers child perspective, not adult plot ──

{
  const kidsGuidance = guidanceFor(kidsStoryIntent);
  const narrativeGuidance = guidanceFor(narrativeArcIntent);

  checkTrue(
    "kids-story writingFocus differs from narrative's writingFocus wording",
    kidsGuidance[0].writingFocus !== narrativeGuidance[0].writingFocus
  );
  checkTrue(
    "kids-story writingFocus references curiosity/connection, not plain 'choices and behavior'",
    kidsGuidance.every((g) => /curiosity|connection/i.test(g.writingFocus))
  );
  checkTrue(
    "kids-story characterGuidance explicitly avoids adult introspection",
    kidsGuidance.every((g) => /child/i.test(g.characterGuidance))
  );
  checkTrue(
    "kids-story guidance does not introduce a stated moral/lesson instruction beyond the existing style guidance",
    kidsGuidance.every((g) => !/state(d)? a moral|life lesson/i.test(g.writingFocus + g.characterGuidance))
  );

  // RP-011C.8.8.1E calibration: dialogue/interaction over narration and
  // decorative description, and no separately narrated emotional summary.
  checkTrue(
    "kids-story writingFocus favors dialogue/shared action over narration",
    kidsGuidance.every((g) => /dialogue|shared action/i.test(g.writingFocus))
  );
  checkTrue(
    "kids-story dialogueGuidance favors dialogue over narration",
    kidsGuidance.every((g) => /dialogue/i.test(g.dialogueGuidance) && /narration/i.test(g.dialogueGuidance))
  );
  checkTrue(
    "kids-story descriptionGuidance warns against decorative description that doesn't involve the character",
    kidsGuidance.every((g) => /decorative description/i.test(g.descriptionGuidance))
  );
  checkTrue(
    "kids-story styleGuidance shows emotional learning through action/dialogue, not narrated explanation",
    kidsGuidance.every((g) => /narrated explanation|stated moral/i.test(g.styleGuidance))
  );
  checkTrue(
    "kids-story allowedElements include playful misunderstandings between friends",
    kidsGuidance.every((g) => g.allowedElements.some((el) => /playful misunderstanding/i.test(el)))
  );
}

// ─── 5. Narrative / Sleep Story / Meditation / ASMR are unaffected ──────

{
  const narrativeBlueprint = blueprintFor(narrativeArcIntent);
  checkTrue(
    "narrative protagonist still uses the original plot-driven phrasing",
    narrativeBlueprint.protagonist.desire.startsWith("to move through")
  );
  checkTrue(
    "narrative turning points still use the original dramatic-escalation phrasing",
    narrativeBlueprint.trajectory.turningPoints[0].description === "the starting limitation can no longer hold as-is"
  );

  const sleepScenes = scenesFor(sleepStoryIntent);
  check(
    // Updated for RP-011C.8.10F's Sleep Story scene calibration -- see
    // scripts/test-creative-intelligence-scenes.ts section 13 for the full
    // calibration test coverage; this only guards that the kids-story-only
    // calibration above doesn't affect sleep-story.
    "sleep-story scene structure is unaffected by the kids-story calibration",
    sleepScenes.map((s) => s.relatedStoryProgression),
    ["arrival", "settling", "gentle exploration", "deeper immersion", "gradual rest"]
  );

  const meditationScenes = scenesFor(meditationIntent);
  // RP-011C.8.8.2C recalibrated meditation to 6 attention/awareness phases
  // (was 4) -- see scenes/templates.ts MEDITATION_SCENE_STEPS. Unrelated to
  // this file's kids-story calibration; asserted here only as a sibling-
  // preset regression guard.
  check("meditation scene count reflects its RP-011C.8.8.2C calibration", meditationScenes.length, 6);

  const asmrScenes = scenesFor(classicAsmrIntent);
  // classic-asmr's own count was later recalibrated by RP-011C.8.8.3C; this
  // check only guards against regressions from the kids-story calibration.
  check("classic-asmr scene count is unaffected by kids-story calibration", asmrScenes.length, 5);

  const narrativeGuidance = guidanceFor(narrativeArcIntent);
  checkTrue(
    "narrative characterGuidance still uses 'not plot convenience'",
    narrativeGuidance[0].characterGuidance.includes("not plot convenience")
  );
}

// ─── 6. No prose, no dialogue, no hardcoded stories/characters ─────────

{
  const MAX_LABEL_LENGTH = 220;
  const offenders: string[] = [];
  const namedCharacterPattern = /\b(Timmy|Sara|Lily|Max|Benny|Rosie|Sammy)\b/;

  function walk(value: unknown, keyPath: string): void {
    if (typeof value === "string") {
      if (value.length > MAX_LABEL_LENGTH) offenders.push(`${keyPath} (${value.length} chars, too long for structural guidance)`);
      if (value.includes("\n")) offenders.push(`${keyPath} (multi-line -- reads as prose, not guidance)`);
      const sentenceEnders = value.match(/[.!?](\s|$)/g) ?? [];
      if (sentenceEnders.length > 2) offenders.push(`${keyPath} (${sentenceEnders.length} sentences, reads as prose)`);
      if (namedCharacterPattern.test(value)) offenders.push(`${keyPath} (contains a hardcoded character name)`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${keyPath}[${i}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, keyPath ? `${keyPath}.${k}` : k);
    }
  }

  const kidsBlueprint = blueprintFor(kidsStoryIntent);
  const kidsScenes = scenesFor(kidsStoryIntent);
  const kidsGuidance = guidanceFor(kidsStoryIntent);
  walk(kidsBlueprint, "blueprint");
  kidsScenes.forEach((s) => walk(s, `scene.${s.id}`));
  kidsGuidance.forEach((g) => walk(g, `guidance.${g.sceneId}`));

  check("no kids-story blueprint/scene/guidance field reads as prose or hardcodes a character", offenders, []);
}

// ─── 7. No pipeline wiring introduced by this calibration ──────────────

{
  const forbiddenPipelinePaths = [
    "app/api/jobs",
    "lib/narrative",
    "lib/story-supervisor.ts",
    "lib/script-builder.ts",
    "lib/script-builder-openai.ts",
    "lib/tts",
    "lib/audio",
    "app/generate",
  ];

  const dirsToCheck = ["lib/creative-intelligence/planning", "lib/creative-intelligence/scenes", "lib/creative-intelligence/guidance"];
  const offending: string[] = [];
  for (const dir of dirsToCheck) {
    const abs = path.join(process.cwd(), dir);
    for (const f of fs.readdirSync(abs).filter((f) => /\.ts$/.test(f))) {
      const content = fs.readFileSync(path.join(abs, f), "utf8");
      for (const forbidden of forbiddenPipelinePaths) {
        if (content.includes(forbidden)) offending.push(`${dir}/${f} -> ${forbidden}`);
      }
    }
  }
  check("no planning/scenes/guidance file references a pipeline path", offending, []);
}

// ─── Summary ─────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
