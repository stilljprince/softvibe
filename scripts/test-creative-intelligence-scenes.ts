// scripts/test-creative-intelligence-scenes.ts
//
// RP-011C.7.24 — Isolated tests for the Scene Planning Layer
// (lib/creative-intelligence/scenes/**). Nothing here touches the active
// generation pipeline, calls a provider, or hits the database.
//
// Run with:  npx tsx scripts/test-creative-intelligence-scenes.ts

import fs from "node:fs";
import path from "node:path";
import {
  CreativeKnowledgeRegistry,
  initializeCreativeKnowledge,
  buildCreativeContext,
  buildStoryBlueprint,
  buildSceneBlueprints,
} from "../lib/creative-intelligence";
import type { CreativeContext, CreativeIntent, SceneBlueprint, StoryBlueprint } from "../lib/creative-intelligence";

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

const narrativeArcIntent: CreativeIntent = {
  preset: "narrative",
  experience: "an immersive narrative built around the listener's request",
  audience: "adult",
  durationMinutes: 20,
  constraints: [],
  storyScale: "arc",
  themes: ["courage"],
};

const transformationIntent: CreativeIntent = {
  preset: "narrative",
  experience: "a story about rebuilding a life through independence",
  audience: "adult",
  durationMinutes: 25,
  constraints: [],
  storyScale: "transformation",
  themes: ["independence"],
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

const classicAsmrIntent: CreativeIntent = {
  preset: "classic-asmr",
  experience: "a slow, sensory-focused ASMR session",
  audience: "adult",
  durationMinutes: 15,
  constraints: [],
};

const classicAsmrStoryIntent: CreativeIntent = {
  preset: "classic-asmr",
  experience: "a slow, sensory-focused ASMR session woven into a gentle story",
  audience: "adult",
  durationMinutes: 15,
  constraints: [],
  asmrMode: "story",
};

// ─── 1. Scene Blueprint can be created ─────────────────────────────────

{
  const scenes = scenesFor(narrativeArcIntent);

  checkTrue("scenesFor returns a non-empty array", scenes.length > 0);
  checkTrue(
    "every scene has the full SceneBlueprint shape",
    scenes.every(
      (s) =>
        typeof s.id === "string" &&
        typeof s.order === "number" &&
        typeof s.purpose === "string" &&
        typeof s.narrativeFunction === "string" &&
        typeof s.relatedStoryProgression === "string" &&
        Array.isArray(s.charactersInvolved) &&
        typeof s.emotionalState === "string" &&
        typeof s.conflict === "string" &&
        typeof s.desiredChange === "string" &&
        typeof s.settingGuidance === "string" &&
        Array.isArray(s.requiredElements) &&
        Array.isArray(s.avoidPatterns) &&
        typeof s.metadata?.createdAt === "string"
    )
  );
  check(
    "scene order is 1-based and sequential",
    scenes.map((s) => s.order),
    scenes.map((_, i) => i + 1)
  );
  check("metadata.createdAt uses the provided override", scenes[0].metadata.createdAt, "2026-01-01T00:00:00.000Z");
  check("metadata.plannerMethod is deterministic-template", scenes[0].metadata.plannerMethod, "deterministic-template");
}

// ─── 2. Transformation story creates multiple progression steps ───────

{
  const arcScenes = scenesFor(narrativeArcIntent);
  const transformationScenes = scenesFor(transformationIntent);

  checkTrue("arc story has more than one scene", arcScenes.length > 1);
  checkTrue("transformation story has more than one scene", transformationScenes.length > 1);
  checkTrue(
    "transformation story (2 turning points) has more scenes than arc story (1 turning point)",
    transformationScenes.length > arcScenes.length
  );
  check(
    "transformation scene count matches progression beats + turning points",
    transformationScenes.length,
    blueprintFor(transformationIntent).trajectory.progression.length +
      blueprintFor(transformationIntent).trajectory.turningPoints.length
  );
  checkTrue(
    "transformation scenes' relatedStoryProgression values are all distinct",
    new Set(transformationScenes.map((s) => s.relatedStoryProgression)).size === transformationScenes.length
  );
}

// ─── 3. Scene purpose is present ───────────────────────────────────────

{
  const allIntents = [narrativeArcIntent, transformationIntent, sleepStoryIntent, meditationIntent, kidsStoryIntent, classicAsmrIntent];
  const offenders: string[] = [];
  for (const intent of allIntents) {
    for (const scene of scenesFor(intent)) {
      if (!scene.purpose || scene.purpose.trim().length === 0) offenders.push(`${intent.preset}:${scene.id}`);
      if (!scene.narrativeFunction || scene.narrativeFunction.trim().length === 0) {
        offenders.push(`${intent.preset}:${scene.id}:narrativeFunction`);
      }
    }
  }
  check("every scene across every preset has a non-empty purpose and narrativeFunction", offenders, []);
}

// ─── 4 & 5. No finished prose, no dialogue ─────────────────────────────

{
  const allIntents = [narrativeArcIntent, transformationIntent, sleepStoryIntent, meditationIntent, kidsStoryIntent, classicAsmrIntent];
  const MAX_LABEL_LENGTH = 200;
  const offenders: string[] = [];

  function walk(value: unknown, keyPath: string): void {
    if (typeof value === "string") {
      if (value.length > MAX_LABEL_LENGTH) offenders.push(`${keyPath} (${value.length} chars, too long for structural guidance)`);
      if (value.includes('"') && /[.!?]"/.test(value)) offenders.push(`${keyPath} (looks like quoted dialogue)`);
      if (value.includes("\n")) offenders.push(`${keyPath} (multi-line -- reads as prose, not a structural label)`);
      // A scene blueprint field is a short instruction/label. More than
      // two sentences in one field starts to read as written prose rather
      // than planning guidance.
      const sentenceEnders = value.match(/[.!?](\s|$)/g) ?? [];
      if (sentenceEnders.length > 2) offenders.push(`${keyPath} (${sentenceEnders.length} sentences, reads as prose)`);
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

  for (const intent of allIntents) {
    for (const scene of scenesFor(intent)) walk(scene, `${intent.preset}.${scene.id}`);
  }
  check("no scene field reads as finished prose or dialogue", offenders, []);

  const dialoguePattern = /\b(said|asked|replied|whispered|shouted)\b[:,]?\s*"/i;
  const dialogueOffenders: string[] = [];
  for (const intent of allIntents) {
    for (const scene of scenesFor(intent)) {
      const combined = [scene.purpose, scene.conflict, scene.desiredChange, scene.settingGuidance].join(" ");
      if (dialoguePattern.test(combined)) dialogueOffenders.push(`${intent.preset}:${scene.id}`);
    }
  }
  check("no scene contains generated dialogue", dialogueOffenders, []);
}

// ─── 6. No direct pipeline integration exists ──────────────────────────

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

  const scenesDir = path.join(process.cwd(), "lib/creative-intelligence/scenes");
  const sceneFiles = fs
    .readdirSync(scenesDir)
    .filter((f) => /\.ts$/.test(f))
    .map((f) => path.join(scenesDir, f));

  const offending: string[] = [];
  for (const file of sceneFiles) {
    const content = fs.readFileSync(file, "utf8");
    for (const forbidden of forbiddenPipelinePaths) {
      if (content.includes(forbidden)) offending.push(`${path.relative(process.cwd(), file)} -> ${forbidden}`);
    }
    if (/from\s+["']openai["']/.test(content) || /from\s+["']elevenlabs["']/.test(content)) {
      offending.push(`${path.relative(process.cwd(), file)} -> provider import`);
    }
  }
  check("no scenes/ file references a pipeline path or provider SDK", offending, []);

  function collectFiles(target: string): string[] {
    const abs = path.join(process.cwd(), target);
    if (!fs.existsSync(abs)) return [];
    const stat = fs.statSync(abs);
    if (stat.isFile()) return [abs];
    const results: string[] = [];
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const entryPath = path.join(abs, entry.name);
      if (entry.isDirectory()) {
        results.push(...collectFiles(path.relative(process.cwd(), entryPath)));
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        results.push(entryPath);
      }
    }
    return results;
  }

  const offendingPipelineFiles: string[] = [];
  for (const target of forbiddenPipelinePaths) {
    for (const file of collectFiles(target)) {
      const content = fs.readFileSync(file, "utf8");
      if (content.includes("creative-intelligence")) {
        offendingPipelineFiles.push(path.relative(process.cwd(), file));
      }
    }
  }
  check("no existing pipeline file imports lib/creative-intelligence", offendingPipelineFiles, []);
}

// ─── 7. Knowledge guidance is considered ───────────────────────────────

{
  const scenes = scenesFor(transformationIntent);
  const context = contextFor(transformationIntent);
  const expectedAvoidPatterns = Array.from(
    new Set(context.knowledge.modules.flatMap((m) => m.antiPatterns ?? []))
  ).sort();

  checkTrue("applicable knowledge modules include at least one anti-pattern", expectedAvoidPatterns.length > 0);
  checkTrue(
    "every scene's avoidPatterns matches the anti-patterns of applicable knowledge modules",
    scenes.every((s) => JSON.stringify([...s.avoidPatterns].sort()) === JSON.stringify(expectedAvoidPatterns))
  );

  const kidsScenes = scenesFor(kidsStoryIntent);
  checkTrue(
    "kids-story scenes carry the intent's hard requiredElements (age-safety) on every scene",
    kidsScenes.every((s) => (kidsStoryIntent.requiredElements ?? []).every((el) => s.requiredElements.includes(el)))
  );
}

// ─── 8. Narrative and Sleep Story differ structurally ──────────────────

{
  const narrativeScenes = scenesFor(narrativeArcIntent);
  const sleepScenes = scenesFor(sleepStoryIntent);

  checkTrue(
    "narrative and sleep-story scene counts are independently derived (not forced to match)",
    // Both counts come from unrelated sources (narrative: progression beats
    // + turning points; sleep-story: RP-011C.8.10F's fixed 5-step template)
    // and coincidentally land on the same number at this arc-scale intent --
    // that's fine, this only guards against one preset's count being derived
    // from the other's.
    narrativeScenes.length !== sleepScenes.length || narrativeScenes.length === 5
  );
  checkTrue(
    "narrative and sleep-story use disjoint narrativeFunction vocabularies",
    !narrativeScenes.some((n) => sleepScenes.some((s) => s.narrativeFunction === n.narrativeFunction))
  );
  check(
    "sleep-story follows the arrival -> settling -> gentle exploration -> deeper immersion -> gradual rest structure",
    sleepScenes.map((s) => s.relatedStoryProgression),
    ["arrival", "settling", "gentle exploration", "deeper immersion", "gradual rest"]
  );
  checkTrue(
    "narrative scenes reference the story's protagonist role",
    narrativeScenes.every((s) => s.charactersInvolved.includes(blueprintFor(narrativeArcIntent).protagonist.role))
  );
  checkTrue(
    "sleep-story scenes reference the in-world traveler role the listener follows, not the listener's own state",
    sleepScenes.every((s) => s.charactersInvolved.includes(blueprintFor(sleepStoryIntent).protagonist.role))
  );

  const meditationScenes = scenesFor(meditationIntent);
  const kidsScenes = scenesFor(kidsStoryIntent);
  const asmrScenes = scenesFor(classicAsmrIntent);
  // RP-011C.8.8.2C calibration: 6 attention/awareness phases, not 4 -- see
  // scenes/templates.ts MEDITATION_SCENE_STEPS.
  check("meditation follows its own guided-practice structure", meditationScenes.length, 6);
  check(
    "meditation follows the arrival -> anchoring -> body awareness -> deepening -> integration -> return structure",
    meditationScenes.map((s) => s.relatedStoryProgression),
    [
      "arrival and settling",
      "breath and attention anchoring",
      "body awareness and relaxation",
      "practice deepening",
      "integration",
      "gentle return",
    ]
  );
  // RP-011C.8.8.1E calibration: the 7-beat progression is realized as 5
  // scenes (establishing beats merged; challenge + emotional-learning
  // beats merged) to reduce structural density -- see scenes/templates.ts.
  check("kids-story realizes its 7-beat progression as 5 consolidated scenes", kidsScenes.length, 5);
  // RP-011C.8.8.3C calibration: 5 sensory-comfort phases, not the earlier
  // 4-phase "settle/introduce/sustain/settle" shape -- see
  // scenes/templates.ts CLASSIC_ASMR_SCENE_STEPS.
  check("classic-asmr follows its own sensory-progression structure", asmrScenes.length, 5);

  const allFunctionSets = [narrativeScenes, sleepScenes, meditationScenes, kidsScenes, asmrScenes].map(
    (scenes) => new Set(scenes.map((s) => s.narrativeFunction))
  );
  checkTrue(
    "no preset reuses another preset's exact narrativeFunction set (not all presets treated as one story type)",
    allFunctionSets.every((set, i) =>
      allFunctionSets.every((other, j) => i === j || set.size !== other.size || ![...set].every((f) => other.has(f)))
    )
  );
}

// ─── 9. Meditation scene calibration (RP-011C.8.8.2C) ──────────────────

{
  const meditationScenes = scenesFor(meditationIntent);

  checkTrue(
    "meditation scenes involve only the listener, never a named/story character",
    meditationScenes.every((s) => s.charactersInvolved.length === 1 && s.charactersInvolved[0] === "the listener")
  );

  const storyVocabulary = /\b(character|protagonist|discover(y|s)?|plot|antagonist|villain|clue|mystery|conflict escalates)\b/i;
  const offenders: string[] = [];
  for (const scene of meditationScenes) {
    const combined = [scene.purpose, scene.narrativeFunction, scene.relatedStoryProgression, scene.conflict, scene.desiredChange, scene.settingGuidance].join(" ");
    if (storyVocabulary.test(combined)) offenders.push(`${scene.id}: ${combined}`);
  }
  checkTrue("meditation scenes carry no story/plot conflict vocabulary", offenders.length === 0);

  checkTrue(
    "meditation narrativeFunction values are attention/awareness phases, not plot beats",
    meditationScenes.every((s) =>
      [
        "Arrival and settling",
        "Breath and attention anchoring",
        "Body awareness and relaxation",
        "Practice deepening",
        "Integration",
        "Gentle return",
      ].includes(s.narrativeFunction)
    )
  );

  // Other presets must be unaffected by the meditation-only calibration.
  check(
    "narrative scene count is unchanged (progression beats + turning points)",
    scenesFor(narrativeArcIntent).length,
    blueprintFor(narrativeArcIntent).trajectory.progression.length + blueprintFor(narrativeArcIntent).trajectory.turningPoints.length
  );
  check(
    "kids-story still realizes its 7-beat progression as 5 consolidated scenes",
    scenesFor(kidsStoryIntent).length,
    5
  );
  check(
    "sleep-story still follows the arrival -> settling -> gentle exploration -> deeper immersion -> gradual rest structure",
    scenesFor(sleepStoryIntent).map((s) => s.relatedStoryProgression),
    ["arrival", "settling", "gentle exploration", "deeper immersion", "gradual rest"]
  );
  // classic-asmr's own count was later recalibrated by RP-011C.8.8.3C (see
  // section 10 below) -- this section only guards against regressions from
  // the meditation-specific calibration above.
  check("classic-asmr scene count reflects its own calibration, unaffected by meditation's", scenesFor(classicAsmrIntent).length, 5);
}

// ─── 10. Classic ASMR scene calibration (RP-011C.8.8.3C) ───────────────

{
  const asmrScenes = scenesFor(classicAsmrIntent);

  check(
    "classic-asmr follows the sensory introduction -> gentle interaction -> rhythmic repetition -> sensory variation -> continued comfort structure",
    asmrScenes.map((s) => s.relatedStoryProgression),
    ["sensory introduction", "gentle interaction", "rhythmic repetition", "sensory variation", "continued comfort"]
  );

  checkTrue(
    "classic-asmr scenes involve only the listener, never a named/story character",
    asmrScenes.every((s) => s.charactersInvolved.length === 1 && s.charactersInvolved[0] === "the listener")
  );

  const storyVocabulary = /\b(character|protagonist|discover(y|s)?|plot|antagonist|villain|clue|mystery|conflict escalates)\b/i;
  const meditationVocabulary = /\b(practice|breath|meditat\w*|integration|awareness)\b/i;
  const offenders: string[] = [];
  for (const scene of asmrScenes) {
    const combined = [scene.purpose, scene.narrativeFunction, scene.relatedStoryProgression, scene.conflict, scene.desiredChange, scene.settingGuidance].join(" ");
    if (storyVocabulary.test(combined)) offenders.push(`${scene.id} (story vocabulary): ${combined}`);
    if (meditationVocabulary.test(combined)) offenders.push(`${scene.id} (meditation vocabulary): ${combined}`);
  }
  checkTrue("classic-asmr scenes carry no story/plot or meditation-practice vocabulary", offenders.length === 0);

  checkTrue(
    "classic-asmr no longer forbids sensory variation (the earlier 'unchanging' sustain-immersion step is gone)",
    !asmrScenes.some((s) => /unchanging/i.test(s.settingGuidance))
  );
  checkTrue(
    "classic-asmr includes a dedicated sensory-variation scene",
    asmrScenes.some((s) => s.narrativeFunction === "Sensory variation")
  );
  checkTrue(
    "classic-asmr includes a dedicated gentle-interaction (personal, safe attention) scene",
    asmrScenes.some((s) => s.narrativeFunction === "Gentle interaction")
  );

  // Other presets must be unaffected by the classic-asmr-only calibration.
  check(
    "narrative scene count is unchanged (progression beats + turning points)",
    scenesFor(narrativeArcIntent).length,
    blueprintFor(narrativeArcIntent).trajectory.progression.length + blueprintFor(narrativeArcIntent).trajectory.turningPoints.length
  );
  check("kids-story still realizes its 7-beat progression as 5 consolidated scenes", scenesFor(kidsStoryIntent).length, 5);
  check(
    "sleep-story still follows the arrival -> settling -> gentle exploration -> deeper immersion -> gradual rest structure",
    scenesFor(sleepStoryIntent).map((s) => s.relatedStoryProgression),
    ["arrival", "settling", "gentle exploration", "deeper immersion", "gradual rest"]
  );
  check("meditation scene count is unchanged", scenesFor(meditationIntent).length, 6);
}

// ─── 11. Existing tests remain green (no regression in relied-upon output) ──

{
  // buildSceneBlueprints must not mutate the StoryBlueprint/CreativeContext
  // it is given -- the Story Blueprint layer's own tests assume those
  // stay stable.
  const context = contextFor(narrativeArcIntent);
  const blueprint = blueprintFor(narrativeArcIntent);
  const contextSnapshot = JSON.stringify(context);
  const blueprintSnapshot = JSON.stringify(blueprint);

  buildSceneBlueprints({ intent: narrativeArcIntent, context, blueprint, createdAt: "2026-01-01T00:00:00.000Z" });

  check("buildSceneBlueprints does not mutate the CreativeContext it is given", JSON.stringify(context), contextSnapshot);
  check("buildSceneBlueprints does not mutate the StoryBlueprint it is given", JSON.stringify(blueprint), blueprintSnapshot);
}

// ─── 12. Classic ASMR story-mode scene calibration (RP-011C.8.8.3L) ────

{
  const presenceScenes = scenesFor(classicAsmrIntent);
  const storyScenes = scenesFor(classicAsmrStoryIntent);

  // 1. Presence mode is byte-for-byte unchanged by adding story mode.
  check(
    "classic-asmr presence mode still follows the sensory introduction -> gentle interaction -> rhythmic repetition -> sensory variation -> continued comfort structure",
    presenceScenes.map((s) => s.relatedStoryProgression),
    ["sensory introduction", "gentle interaction", "rhythmic repetition", "sensory variation", "continued comfort"]
  );
  checkTrue(
    "classic-asmr presence scenes still involve only the listener",
    presenceScenes.every((s) => s.charactersInvolved.length === 1 && s.charactersInvolved[0] === "the listener")
  );
  check("classic-asmr presence scene count is unchanged", presenceScenes.length, 5);

  // 2. Story mode receives a distinct, story-aware set of scenes.
  check(
    "classic-asmr story mode follows the scenario introduction -> persona framing -> gentle interaction -> narrative sensory movement -> continued comfort structure",
    storyScenes.map((s) => s.relatedStoryProgression),
    ["scenario introduction", "persona framing", "gentle interaction", "narrative sensory movement", "continued comfort"]
  );
  check("classic-asmr story mode has its own fixed scene count", storyScenes.length, 5);
  checkTrue(
    "classic-asmr story mode is distinct from presence mode (different relatedStoryProgression sequence)",
    JSON.stringify(storyScenes.map((s) => s.relatedStoryProgression)) !== JSON.stringify(presenceScenes.map((s) => s.relatedStoryProgression))
  );
  checkTrue(
    "classic-asmr story scenes reference the story-mode protagonist framing (in-scene persona), not the bare listener",
    storyScenes.every((s) => s.charactersInvolved.includes(blueprintFor(classicAsmrStoryIntent).protagonist.role))
  );
  checkTrue(
    "classic-asmr story mode includes scenario/persona framing scenes",
    storyScenes.some((s) => s.narrativeFunction === "Scenario introduction") &&
      storyScenes.some((s) => s.narrativeFunction === "Persona framing")
  );
  checkTrue(
    "classic-asmr story mode includes a narrative sensory movement scene",
    storyScenes.some((s) => s.narrativeFunction === "Narrative sensory movement")
  );

  // No plot escalation or conflict/resolution structure, even in story mode:
  // classic-asmr stays out of PLOT_DRIVEN_PRESETS regardless of asmrMode.
  const escalationVocabulary = /\b(antagonist|villain|obstacle|twist|climax|resolution beat|conflict escalates|turning point)\b/i;
  const noConflictOffenders: string[] = [];
  for (const scene of storyScenes) {
    const combined = [scene.purpose, scene.narrativeFunction, scene.relatedStoryProgression, scene.conflict, scene.desiredChange, scene.settingGuidance].join(" ");
    if (escalationVocabulary.test(combined)) noConflictOffenders.push(`${scene.id}: ${combined}`);
  }
  checkTrue("classic-asmr story scenes carry no plot-escalation or conflict/resolution vocabulary", noConflictOffenders.length === 0);

  // 3. Other presets/modes are unaffected.
  check(
    "narrative scene count is unchanged (progression beats + turning points)",
    scenesFor(narrativeArcIntent).length,
    blueprintFor(narrativeArcIntent).trajectory.progression.length + blueprintFor(narrativeArcIntent).trajectory.turningPoints.length
  );
  check(
    "sleep-story still follows the arrival -> settling -> gentle exploration -> deeper immersion -> gradual rest structure",
    scenesFor(sleepStoryIntent).map((s) => s.relatedStoryProgression),
    ["arrival", "settling", "gentle exploration", "deeper immersion", "gradual rest"]
  );
  check("meditation scene count is unchanged", scenesFor(meditationIntent).length, 6);
  check("kids-story still realizes its 7-beat progression as 5 consolidated scenes", scenesFor(kidsStoryIntent).length, 5);
}

// ─── 13. Sleep Story scene calibration (RP-011C.8.10F) ─────────────────

{
  const sleepScenes = scenesFor(sleepStoryIntent);

  check("sleep-story has a fixed 5-scene structure", sleepScenes.length, 5);
  checkTrue(
    "sleep-story narrativeFunction values are the calibrated arrival/settling/exploration/immersion/rest phases",
    sleepScenes.every((s) =>
      ["Arrival", "Settling", "Gentle exploration", "Deeper immersion", "Gradual rest"].includes(s.narrativeFunction)
    )
  );

  // Narrative escalation machinery must never leak into Sleep Story scenes
  // (see docs/sleep-story-principle-library-v1.md Section 4 Anti-Pattern
  // Library, and knowledge/sleep-story/movement-without-urgency.ts).
  const escalationVocabulary =
    /\b(obstacle|problem|antagonist|villain|twist|climax|turning point|cliffhanger|suspense|urgency|deadline|chase|danger|threat|revelation|complication)\b/i;
  const escalationOffenders: string[] = [];
  for (const scene of sleepScenes) {
    const combined = [scene.purpose, scene.narrativeFunction, scene.relatedStoryProgression, scene.conflict, scene.desiredChange, scene.settingGuidance].join(" ");
    if (escalationVocabulary.test(combined)) escalationOffenders.push(`${scene.id}: ${combined}`);
  }
  checkTrue("sleep-story scenes carry no Narrative escalation vocabulary", escalationOffenders.length === 0);

  // The pre-calibration template framed every step as overcoming the
  // listener's own leftover wakeful/restless state (meditation's/classic-
  // asmr's inward-attention model, not Sleep Story's outward one -- see
  // Planning Calibration RP-011C.8.10E Gap 2). None of that language should
  // remain.
  const inwardAttentionVocabulary = /\b(wakeful tension|residual restlessness|intrusive thoughts)\b/i;
  const inwardOffenders: string[] = [];
  for (const scene of sleepScenes) {
    const combined = [scene.purpose, scene.conflict, scene.desiredChange].join(" ");
    if (inwardAttentionVocabulary.test(combined)) inwardOffenders.push(`${scene.id}: ${combined}`);
  }
  checkTrue("sleep-story scenes carry none of the pre-calibration inward-attention vocabulary", inwardOffenders.length === 0);

  checkTrue(
    "sleep-story scenes have no unresolved conflict -- every conflict field states an absence, never an obstacle to overcome",
    sleepScenes.every((s) => /^none\b/i.test(s.conflict))
  );

  checkTrue(
    "sleep-story includes a dedicated gentle-exploration/discovery scene (movement_without_urgency, episodic_meandering_structure)",
    sleepScenes.some((s) => s.narrativeFunction === "Gentle exploration")
  );
  checkTrue(
    "sleep-story scenes reference companions/welcome as warmth, not just the traveler alone",
    sleepScenes.some((s) => /companion/i.test(s.purpose) || /companion/i.test(s.settingGuidance))
  );

  checkTrue(
    "sleep-story scenes reference the in-world traveler role from Planning Calibration, not a bare 'the listener' role",
    sleepScenes.every(
      (s) => s.charactersInvolved.includes(blueprintFor(sleepStoryIntent).protagonist.role) && !s.charactersInvolved.includes("the listener")
    )
  );

  // Planning's own sleep-story progression labels (SLEEP_STORY_PROGRESSION_
  // BY_SCALE) and the scene layer's labels are independently defined
  // vocabularies, same as every other preset (meditation/classic-asmr scene
  // labels don't reuse PROGRESSION_BY_SCALE labels either) -- this only
  // guards that scenes don't accidentally inherit the generic PROGRESSION_
  // BY_SCALE's plot-shaped labels ("turning point", "obstacles").
  const plotShapedLabels = ["turning point", "obstacles", "starting limitation", "attempted change", "resolution"];
  checkTrue(
    "sleep-story relatedStoryProgression values contain none of the generic plot-driven progression labels",
    sleepScenes.every((s) => !plotShapedLabels.includes(s.relatedStoryProgression))
  );

  // Narrative must remain unaffected by this sleep-story-only calibration.
  check(
    "narrative scene count is unchanged (progression beats + turning points)",
    scenesFor(narrativeArcIntent).length,
    blueprintFor(narrativeArcIntent).trajectory.progression.length + blueprintFor(narrativeArcIntent).trajectory.turningPoints.length
  );
  check("meditation scene count is unchanged", scenesFor(meditationIntent).length, 6);
  check("kids-story still realizes its 7-beat progression as 5 consolidated scenes", scenesFor(kidsStoryIntent).length, 5);
  check("classic-asmr presence scene count is unchanged", scenesFor(classicAsmrIntent).length, 5);
  check("classic-asmr story mode scene count is unchanged", scenesFor(classicAsmrStoryIntent).length, 5);
}

// ─── Summary ─────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
