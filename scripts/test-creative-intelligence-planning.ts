// scripts/test-creative-intelligence-planning.ts
//
// RP-011C.7.23 — Isolated tests for the Story Blueprint / Narrative
// Planning Layer (lib/creative-intelligence/planning/**). Nothing here
// touches the active generation pipeline, calls a provider, or hits the
// database.
//
// Run with:  npx tsx scripts/test-creative-intelligence-planning.ts

import fs from "node:fs";
import path from "node:path";
import {
  CreativeKnowledgeRegistry,
  initializeCreativeKnowledge,
  buildCreativeContext,
  buildStoryBlueprint,
} from "../lib/creative-intelligence";
import type { CreativeContext, CreativeIntent, StoryBlueprint } from "../lib/creative-intelligence";

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

const sleepStoryVignetteIntent: CreativeIntent = { ...sleepStoryIntent, storyScale: "vignette" };
const sleepStoryArcIntent: CreativeIntent = { ...sleepStoryIntent, storyScale: "arc" };
const sleepStoryTransformationIntent: CreativeIntent = { ...sleepStoryIntent, storyScale: "transformation" };

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

const meditationShortIntent: CreativeIntent = {
  preset: "meditation",
  experience: "a guided meditation for calm and centering",
  audience: "general",
  durationMinutes: 5,
  constraints: [],
  storyScale: "vignette",
  emotionalDirection: ["calm"],
};

const meditationIntent: CreativeIntent = {
  preset: "meditation",
  experience: "a guided meditation for calm and centering",
  audience: "general",
  durationMinutes: 15,
  constraints: [],
  storyScale: "gentle_journey",
  emotionalDirection: ["calm"],
};

const meditationLongIntent: CreativeIntent = {
  preset: "meditation",
  experience: "a guided meditation for calm and centering",
  audience: "general",
  durationMinutes: 40,
  constraints: [],
  storyScale: "transformation",
  emotionalDirection: ["calm"],
};

// ─── 1. Basic blueprint creation works ─────────────────────────────────

{
  const blueprint = blueprintFor(narrativeArcIntent);

  checkTrue("blueprint.intent is passed through unchanged", blueprint.intent === narrativeArcIntent);
  checkTrue("blueprint.premise.storyPromise matches intent.experience", blueprint.premise.storyPromise === narrativeArcIntent.experience);
  checkTrue("blueprint.themes matches intent.themes", JSON.stringify(blueprint.themes) === JSON.stringify(narrativeArcIntent.themes));
  checkTrue("blueprint.metadata.version is a non-empty string", typeof blueprint.metadata.version === "string" && blueprint.metadata.version.length > 0);
  check("blueprint.metadata.createdAt uses the provided override", blueprint.metadata.createdAt, "2026-01-01T00:00:00.000Z");
  check("blueprint.metadata.builderMethod is deterministic-template", blueprint.metadata.builderMethod, "deterministic-template");
}

// ─── 2. Transformation story creates progression / starting / ending ──

{
  const blueprint = blueprintFor(transformationIntent);

  check(
    "transformation trajectory.progression matches the expected structural beats",
    blueprint.trajectory.progression,
    ["starting limitation", "attempted change", "obstacles", "new equilibrium"]
  );
  check("transformation trajectory.startingPoint is the first beat", blueprint.trajectory.startingPoint, "starting limitation");
  check("transformation trajectory.endingState is the last beat", blueprint.trajectory.endingState, "new equilibrium");
  checkTrue("transformation trajectory.turningPoints is non-empty", blueprint.trajectory.turningPoints.length > 0);
  checkTrue(
    "transformation blueprint does not shrink premise to a tiny event (structureGuidance carries the full progression)",
    blueprint.structureGuidance.requiredMovements.includes("new equilibrium")
  );
}

// ─── 3. Sleep story creates appropriate non-plot planning ──────────────

{
  const blueprint = blueprintFor(sleepStoryIntent);

  check("sleep-story trajectory.progression is a comfort/safety journey, not plot beats", blueprint.trajectory.progression, [
    "settling in",
    "gentle movement",
    "deepening calm",
    "safe arrival",
  ]);
  check("sleep-story has no turning points (non-plot preset)", blueprint.trajectory.turningPoints, []);
  checkTrue(
    "sleep-story protagonist.role is a dedicated in-world figure, not 'the listener'",
    blueprint.protagonist.role !== "the listener" && blueprint.protagonist.role.toLowerCase().includes("traveler")
  );
  checkTrue(
    "sleep-story protagonist does not center the listener's own restlessness (that's meditation/classic-asmr's model)",
    !blueprint.protagonist.desire.toLowerCase().includes("settle into calm") &&
      !blueprint.protagonist.internalConflict.toLowerCase().includes("restlessness")
  );
  checkTrue(
    "sleep-story emotionalArc ends in rest, not drama",
    blueprint.emotionalArc.end.toLowerCase().includes("asleep")
  );
}

// ─── 3b. Sleep story progression is safe (no Narrative escalation) at every scale ─

{
  const NARRATIVE_ESCALATION_VOCAB = [
    "turning point",
    "obstacle",
    "resolution",
    "attempted change",
    "starting limitation",
    "breakthrough",
    "problem",
    "attempt",
    "deadline",
    "urgency",
  ];

  const scaleIntents: Array<[string, CreativeIntent]> = [
    ["vignette", sleepStoryVignetteIntent],
    ["gentle_journey", sleepStoryIntent],
    ["arc", sleepStoryArcIntent],
    ["transformation", sleepStoryTransformationIntent],
  ];

  for (const [scaleName, intent] of scaleIntents) {
    const blueprint = blueprintFor(intent);
    const progressionText = blueprint.trajectory.progression.join(" | ").toLowerCase();
    const requiredMovementsText = blueprint.structureGuidance.requiredMovements.join(" | ").toLowerCase();

    checkTrue(
      `sleep-story ${scaleName} progression avoids Narrative escalation vocabulary`,
      NARRATIVE_ESCALATION_VOCAB.every((term) => !progressionText.includes(term))
    );
    checkTrue(
      `sleep-story ${scaleName} structureGuidance.requiredMovements avoids Narrative escalation vocabulary`,
      NARRATIVE_ESCALATION_VOCAB.every((term) => !requiredMovementsText.includes(term))
    );
    check(`sleep-story ${scaleName} has no turning points (non-plot preset)`, blueprint.trajectory.turningPoints, []);
  }

  check(
    "sleep-story vignette progression matches the dedicated table",
    blueprintFor(sleepStoryVignetteIntent).trajectory.progression,
    ["settling in", "sensory exploration", "soft closure"]
  );
  check(
    "sleep-story arc progression matches the dedicated table",
    blueprintFor(sleepStoryArcIntent).trajectory.progression,
    ["settling in", "gentle movement", "peaceful discovery", "gradual settling", "soft closure"]
  );
  check(
    "sleep-story transformation progression matches the dedicated table",
    blueprintFor(sleepStoryTransformationIntent).trajectory.progression,
    [
      "settling in",
      "gentle movement",
      "peaceful discovery",
      "continued gentle wandering",
      "gradual settling",
      "soft closure",
    ]
  );
}

// ─── 4. Kids story creates appropriate audience-aware structure ────────

{
  const blueprint = blueprintFor(kidsStoryIntent);

  check(
    "kids-story trajectory.progression follows the fixed age-safe beat structure",
    blueprint.trajectory.progression,
    [
      "gentle introduction",
      "safe environment",
      "light adventure",
      "small challenge",
      "emotional learning moment",
      "calm resolution",
      "soft sleepy ending",
    ]
  );
  check("kids-story trajectory.endingState is the soft sleepy ending", blueprint.trajectory.endingState, "soft sleepy ending");
  checkTrue(
    "kids-story structureGuidance.requiredMovements includes positive_resolution (from intent.requiredElements)",
    blueprint.structureGuidance.requiredMovements.includes("positive_resolution")
  );
  checkTrue("kids-story protagonist.role names a child protagonist", blueprint.protagonist.role.includes("child"));
}

// ─── 5. Narrative request creates conflict/trajectory fields ───────────

{
  const blueprint = blueprintFor(narrativeArcIntent);

  checkTrue("narrative premise.coreConflict is non-empty", blueprint.premise.coreConflict.length > 0);
  checkTrue("narrative premise.centralQuestion is non-empty", blueprint.premise.centralQuestion.length > 0);
  checkTrue("narrative arc trajectory.turningPoints is non-empty", blueprint.trajectory.turningPoints.length > 0);
  checkTrue(
    "narrative turning points carry both description and consequence",
    blueprint.trajectory.turningPoints.every((tp) => tp.description.length > 0 && tp.consequence.length > 0)
  );
}

// ─── 6b. Meditation plans as attention/awareness progression, not story ─

{
  const blueprint = blueprintFor(meditationIntent);

  check(
    "meditation trajectory.progression is an attention/awareness progression, not generic story beats",
    blueprint.trajectory.progression,
    ["arrival", "attention settling", "practice deepening", "gentle return"]
  );
  check("meditation trajectory.startingPoint is arrival", blueprint.trajectory.startingPoint, "arrival");
  check("meditation trajectory.endingState is gentle return", blueprint.trajectory.endingState, "gentle return");
  check("meditation has no turning points (non-plot preset)", blueprint.trajectory.turningPoints, []);
  checkTrue(
    "meditation protagonist.desire/need describe inner state and practice purpose, not an external outcome",
    blueprint.protagonist.desire.includes("calm") && blueprint.protagonist.need.toLowerCase().includes("judgment")
  );
  checkTrue(
    "meditation protagonist does not read as a sleep/rest wind-down",
    !blueprint.protagonist.internalConflict.toLowerCase().includes("wish to rest")
  );
  checkTrue(
    "meditation blueprint has no story conflict/character-change language leaking in",
    !JSON.stringify(blueprint.trajectory).toLowerCase().includes("resolution") &&
      !JSON.stringify(blueprint.trajectory).toLowerCase().includes("turning point")
  );
}

// ─── 6c. Meditation progression adapts to duration via storyScale ──────

{
  const short = blueprintFor(meditationShortIntent);
  const long = blueprintFor(meditationLongIntent);

  check(
    "short (vignette) meditation gets a simple grounding progression",
    short.trajectory.progression,
    ["arrival", "attention settling", "gentle return"]
  );
  check(
    "long (transformation) meditation gets a deeper practice progression",
    long.trajectory.progression,
    ["arrival", "attention settling", "practice deepening", "deepening awareness", "integration", "gentle return"]
  );
  checkTrue(
    "long meditation progression is deeper (more phases) than short meditation progression",
    long.trajectory.progression.length > short.trajectory.progression.length
  );
}

// ─── 6d. Meditation planning does not affect other presets ─────────────

{
  const narrative = blueprintFor(narrativeArcIntent);
  const kidsStory = blueprintFor(kidsStoryIntent);
  const sleepStory = blueprintFor(sleepStoryIntent);

  check("narrative planning is unchanged by meditation calibration", narrative.trajectory.progression, [
    "starting point",
    "discovery",
    "turning point",
    "resolution",
  ]);
  check("kids-story planning is unchanged by meditation calibration", kidsStory.trajectory.progression, [
    "gentle introduction",
    "safe environment",
    "light adventure",
    "small challenge",
    "emotional learning moment",
    "calm resolution",
    "soft sleepy ending",
  ]);
  check("sleep-story planning is unchanged by meditation calibration", sleepStory.trajectory.progression, [
    "settling in",
    "gentle movement",
    "deepening calm",
    "safe arrival",
  ]);
}

// ─── 8. Classic ASMR story mode planning calibration (RP-011C.8.8.3K) ──

const classicAsmrPresenceIntent: CreativeIntent = {
  preset: "classic-asmr",
  experience: "a calming ASMR session focused on sensory presence",
  audience: "adult",
  durationMinutes: 15,
  constraints: [],
  storyScale: "gentle_journey",
  asmrMode: "presence",
};

const classicAsmrStoryIntent: CreativeIntent = {
  preset: "classic-asmr",
  experience: "a calming ASMR session with a gentle in-scene persona",
  audience: "adult",
  durationMinutes: 15,
  constraints: [],
  storyScale: "gentle_journey",
  asmrMode: "story",
};

{
  // 8a. classic-asmr + presence is unchanged by story mode support.
  const blueprint = blueprintFor(classicAsmrPresenceIntent);

  check(
    "classic-asmr presence trajectory.progression stays the sensory-only progression",
    blueprint.trajectory.progression,
    ["comfort establishment", "sensory introduction", "rhythmic immersion", "gentle continuation"]
  );
  check("classic-asmr presence has no turning points (no plot progression)", blueprint.trajectory.turningPoints, []);
  checkTrue("classic-asmr presence protagonist.role is exactly 'the listener'", blueprint.protagonist.role === "the listener");
  checkTrue(
    "classic-asmr presence protagonist carries no persona/scene framing",
    !blueprint.protagonist.role.toLowerCase().includes("scene") && !blueprint.protagonist.role.toLowerCase().includes("persona")
  );
}

{
  // 8b. classic-asmr + story receives story-aware planning.
  const blueprint = blueprintFor(classicAsmrStoryIntent);

  check(
    "classic-asmr story trajectory.progression is scene/persona-aware, not the presence progression",
    blueprint.trajectory.progression,
    ["comfort establishment", "scene and persona introduction", "narrative sensory movement", "gentle scene continuation"]
  );
  check("classic-asmr story still has no turning points (stays ASMR, not a plot-driven preset)", blueprint.trajectory.turningPoints, []);
  checkTrue(
    "classic-asmr story protagonist.role carries persona/scene framing",
    blueprint.protagonist.role.toLowerCase().includes("persona") && blueprint.protagonist.role.toLowerCase().includes("scene")
  );
  checkTrue(
    "classic-asmr story protagonist.externalGoal is still just staying present, no external win",
    blueprint.protagonist.externalGoal.includes("stay comfortably present")
  );
  checkTrue(
    "classic-asmr story emotionalArc is unchanged from classic-asmr's calm arc",
    blueprint.emotionalArc.end === "calm and settled"
  );
}

{
  // 8c. non-ASMR presets are unchanged by classic-asmr story mode support.
  const narrative = blueprintFor(narrativeArcIntent);
  const kidsStory = blueprintFor(kidsStoryIntent);
  const sleepStory = blueprintFor(sleepStoryIntent);
  const meditation = blueprintFor(meditationIntent);

  check("narrative planning is unchanged by classic-asmr story calibration", narrative.trajectory.progression, [
    "starting point",
    "discovery",
    "turning point",
    "resolution",
  ]);
  check("kids-story planning is unchanged by classic-asmr story calibration", kidsStory.trajectory.progression, [
    "gentle introduction",
    "safe environment",
    "light adventure",
    "small challenge",
    "emotional learning moment",
    "calm resolution",
    "soft sleepy ending",
  ]);
  check("sleep-story planning is unchanged by classic-asmr story calibration", sleepStory.trajectory.progression, [
    "settling in",
    "gentle movement",
    "deepening calm",
    "safe arrival",
  ]);
  check("meditation planning is unchanged by classic-asmr story calibration", meditation.trajectory.progression, [
    "arrival",
    "attention settling",
    "practice deepening",
    "gentle return",
  ]);
}

// ─── 6. Blueprint does not contain prose generation ────────────────────

{
  const blueprint = blueprintFor(transformationIntent);

  // Every leaf string in the blueprint should read as a short structural
  // label, not a written paragraph/scene/dialogue line.
  const MAX_LABEL_LENGTH = 160;
  const offenders: string[] = [];

  function walk(value: unknown, keyPath: string): void {
    if (typeof value === "string") {
      if (value.length > MAX_LABEL_LENGTH) offenders.push(`${keyPath} (${value.length} chars)`);
      if (/[.!?]\s+[A-Z]/.test(value)) offenders.push(`${keyPath} (multi-sentence)`);
      if (value.includes('"') || value.includes("\n")) offenders.push(`${keyPath} (looks like dialogue/prose)`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${keyPath}[${i}]`));
      return;
    }
    if (value && typeof value === "object") {
      // intent is the pass-through CreativeIntent; already covered by
      // intent's own tests, and its `experience` field is intentionally a
      // short one-line summary, not prose -- still walked, just not
      // exempted, since it must also pass the same bar.
      for (const [k, v] of Object.entries(value)) walk(v, keyPath ? `${keyPath}.${k}` : k);
    }
  }

  walk(blueprint, "blueprint");
  check("no blueprint field reads as generated prose/dialogue", offenders, []);
}

// ─── 7. No active pipeline imports exist ───────────────────────────────

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

  const planningDir = path.join(process.cwd(), "lib/creative-intelligence/planning");
  const planningFiles = fs
    .readdirSync(planningDir)
    .filter((f) => /\.ts$/.test(f))
    .map((f) => path.join(planningDir, f));

  const offending: string[] = [];
  for (const file of planningFiles) {
    const content = fs.readFileSync(file, "utf8");
    for (const forbidden of forbiddenPipelinePaths) {
      if (content.includes(forbidden)) offending.push(`${path.relative(process.cwd(), file)} -> ${forbidden}`);
    }
  }
  check("no planning/ file references a pipeline path", offending, []);

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

// ─── Summary ─────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
