// scripts/test-creative-intelligence-asmr-planning-calibration.ts
//
// RP-011C.8.8.3B — Isolated tests for the Classic ASMR planning calibration
// (lib/creative-intelligence/planning/**). Verifies classic-asmr gets its
// own structural identity (sensory attention, comfort, rhythm) and does not
// inherit narrative, meditation, or sleep-story planning assumptions.
// Nothing here touches the active generation pipeline, calls a provider, or
// hits the database.
//
// Run with:  npx tsx scripts/test-creative-intelligence-asmr-planning-calibration.ts

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

const classicAsmrShortIntent: CreativeIntent = {
  preset: "classic-asmr",
  experience: "a slow, sensory-focused ASMR session",
  audience: "adult",
  durationMinutes: 5,
  constraints: [],
  storyScale: "vignette",
  emotionalDirection: ["calm"],
};

const classicAsmrIntent: CreativeIntent = {
  preset: "classic-asmr",
  experience: "a slow, sensory-focused ASMR session",
  audience: "adult",
  durationMinutes: 15,
  constraints: [],
  storyScale: "gentle_journey",
  emotionalDirection: ["calm"],
};

const classicAsmrArcIntent: CreativeIntent = { ...classicAsmrIntent, storyScale: "arc" };

const classicAsmrLongIntent: CreativeIntent = {
  preset: "classic-asmr",
  experience: "a slow, sensory-focused ASMR session",
  audience: "adult",
  durationMinutes: 40,
  constraints: [],
  storyScale: "transformation",
  emotionalDirection: ["calm"],
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
  experience: "a guided meditation for calm and centering",
  audience: "general",
  durationMinutes: 15,
  constraints: [],
  storyScale: "gentle_journey",
  emotionalDirection: ["calm"],
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

// ─── 1. Classic ASMR plans as a sensory-attention progression, not a story ─

{
  const blueprint = blueprintFor(classicAsmrIntent);

  check(
    "classic-asmr trajectory.progression is a sensory/comfort progression, not generic story beats",
    blueprint.trajectory.progression,
    ["comfort establishment", "sensory introduction", "rhythmic immersion", "gentle continuation"]
  );
  check("classic-asmr trajectory.startingPoint is comfort establishment", blueprint.trajectory.startingPoint, "comfort establishment");
  check("classic-asmr trajectory.endingState is gentle continuation", blueprint.trajectory.endingState, "gentle continuation");
  check("classic-asmr has no turning points (non-plot preset)", blueprint.trajectory.turningPoints, []);
  checkTrue("classic-asmr protagonist.role is the listener", blueprint.protagonist.role === "the listener");
  checkTrue(
    "classic-asmr blueprint has no story conflict/character-change language leaking in",
    !JSON.stringify(blueprint.trajectory).toLowerCase().includes("resolution") &&
      !JSON.stringify(blueprint.trajectory).toLowerCase().includes("turning point") &&
      !JSON.stringify(blueprint.trajectory).toLowerCase().includes("obstacle")
  );
}

// ─── 2. Classic ASMR progression adapts to duration via storyScale ─────────

{
  const short = blueprintFor(classicAsmrShortIntent);
  const long = blueprintFor(classicAsmrLongIntent);

  check(
    "short (vignette) classic-asmr gets a simple comfort/sensory progression",
    short.trajectory.progression,
    ["comfort establishment", "sensory introduction", "gentle continuation"]
  );
  check(
    "long (transformation) classic-asmr extends rhythmic immersion, not escalation",
    long.trajectory.progression,
    [
      "comfort establishment",
      "sensory introduction",
      "rhythmic immersion",
      "sensory deepening",
      "continued rhythmic immersion",
      "gentle continuation",
    ]
  );
  checkTrue(
    "long classic-asmr progression has more phases than short classic-asmr progression",
    long.trajectory.progression.length > short.trajectory.progression.length
  );
  checkTrue(
    "even the longest classic-asmr progression avoids escalation/climax vocabulary",
    !JSON.stringify(long.trajectory).toLowerCase().includes("climax") &&
      !JSON.stringify(long.trajectory).toLowerCase().includes("payoff")
  );
}

// ─── 3. Classic ASMR arc/transformation scales still get no turning points ─

{
  const arcBlueprint = blueprintFor(classicAsmrArcIntent);
  const longBlueprint = blueprintFor(classicAsmrLongIntent);

  check("classic-asmr arc scale has no turning points", arcBlueprint.trajectory.turningPoints, []);
  check("classic-asmr transformation scale has no turning points", longBlueprint.trajectory.turningPoints, []);
}

// ─── 4. Classic ASMR protagonist describes sensory attention, not sleep-story's wind-down or meditation's practice ─

{
  const asmrBlueprint = blueprintFor(classicAsmrIntent);
  const sleepBlueprint = blueprintFor(sleepStoryIntent);
  const meditationBlueprint = blueprintFor(meditationIntent);

  checkTrue(
    "classic-asmr protagonist.desire differs from sleep-story's generic wind-down framing",
    asmrBlueprint.protagonist.desire !== sleepBlueprint.protagonist.desire
  );
  checkTrue(
    "classic-asmr protagonist.internalConflict differs from sleep-story's generic wind-down framing",
    asmrBlueprint.protagonist.internalConflict !== sleepBlueprint.protagonist.internalConflict
  );
  checkTrue(
    "classic-asmr protagonist fields reference sensory attention",
    /sensory|sound|texture|closeness|notice/i.test(
      asmrBlueprint.protagonist.desire + asmrBlueprint.protagonist.need + asmrBlueprint.protagonist.internalConflict
    )
  );
  checkTrue(
    "classic-asmr protagonist does not read as sleep-story's 'wish to rest' framing",
    !asmrBlueprint.protagonist.internalConflict.toLowerCase().includes("wish to rest")
  );
  checkTrue(
    "classic-asmr protagonist does not read as a practice (meditation's framing)",
    !/practice|awareness/i.test(asmrBlueprint.protagonist.desire + asmrBlueprint.protagonist.externalGoal)
  );
  checkTrue(
    "classic-asmr protagonist is not identical to meditation's protagonist",
    asmrBlueprint.protagonist.desire !== meditationBlueprint.protagonist.desire &&
      asmrBlueprint.protagonist.need !== meditationBlueprint.protagonist.need
  );
  checkTrue(
    "classic-asmr protagonist does not carry a character-arc externalGoal",
    !/story's ending state|reach the story/i.test(asmrBlueprint.protagonist.externalGoal)
  );
}

// ─── 5. Narrative / kids-story / meditation / sleep-story planning is unaffected ─

{
  const narrative = blueprintFor(narrativeArcIntent);
  const kidsStory = blueprintFor(kidsStoryIntent);
  const meditation = blueprintFor(meditationIntent);
  const sleepStory = blueprintFor(sleepStoryIntent);

  check("narrative planning is unchanged by classic-asmr calibration", narrative.trajectory.progression, [
    "starting point",
    "discovery",
    "turning point",
    "resolution",
  ]);
  check("kids-story planning is unchanged by classic-asmr calibration", kidsStory.trajectory.progression, [
    "gentle introduction",
    "safe environment",
    "light adventure",
    "small challenge",
    "emotional learning moment",
    "calm resolution",
    "soft sleepy ending",
  ]);
  check("meditation planning is unchanged by classic-asmr calibration", meditation.trajectory.progression, [
    "arrival",
    "attention settling",
    "practice deepening",
    "gentle return",
  ]);
  check("sleep-story planning is unchanged by classic-asmr calibration", sleepStory.trajectory.progression, [
    "settling in",
    "gentle movement",
    "deepening calm",
    "safe arrival",
  ]);
  checkTrue(
    "narrative protagonist still uses the original plot-driven phrasing",
    narrative.protagonist.desire.startsWith("to move through")
  );
}

// ─── 6. Blueprint fields stay short structural labels, not prose ──────────

{
  const blueprint = blueprintFor(classicAsmrLongIntent);

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
      for (const [k, v] of Object.entries(value)) walk(v, keyPath ? `${keyPath}.${k}` : k);
    }
  }

  walk(blueprint, "blueprint");
  check("no classic-asmr blueprint field reads as generated prose/dialogue", offenders, []);
}

// ─── 7. No pipeline wiring introduced by this calibration ─────────────────

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
}

// ─── Summary ─────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
