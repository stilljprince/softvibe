// scripts/test-creative-intelligence-knowledge.ts
//
// RP-011C.7.20 — Isolated tests for the Creative Intelligence Knowledge
// Module + Registry foundation (lib/creative-intelligence/knowledge/**).
// Nothing here touches the active generation pipeline, calls a provider,
// or hits the database.
//
// Run with:  npx tsx scripts/test-creative-intelligence-knowledge.ts

import fs from "node:fs";
import path from "node:path";
import {
  ACTIVE_KNOWLEDGE_MODULES,
  CreativeKnowledgeRegistry,
  initializeCreativeKnowledge,
  validateKnowledgeModule,
} from "../lib/creative-intelligence";
import type { KnowledgeModule } from "../lib/creative-intelligence";

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

// ─── 1. All twelve active modules validate successfully ───────────────

checkTrue(
  "exactly thirty-three active knowledge modules are defined",
  ACTIVE_KNOWLEDGE_MODULES.length === 33
);

for (const knowledgeModule of ACTIVE_KNOWLEDGE_MODULES) {
  const result = validateKnowledgeModule(knowledgeModule);
  checkTrue(`module "${knowledgeModule.id}" validates successfully`, result.valid === true);
}

// ─── 2. Initialization registers exactly the intended active modules ──

{
  const registry = new CreativeKnowledgeRegistry();
  initializeCreativeKnowledge(registry);
  const ids = registry.getAll().map((m) => m.id).sort();
  const expectedIds = [
    "ambient_sensory_calm",
    "avoid_ai_writing_patterns",
    "body_awareness",
    "breath_awareness",
    "calming_repetition",
    "character_wants_needs",
    "child_perspective",
    "comfort_baseline_and_belonging",
    "companions_as_warmth",
    "emotional_safety",
    "episodic_meandering_structure",
    "friendship_and_belonging",
    "gentle_rhythm",
    "gentle_visualization",
    "gentle_wonder",
    "guided_presence",
    "intimate_safe_address",
    "meditation_emotional_safety",
    "movement_without_urgency",
    "no_forced_response",
    "non_judgmental_language",
    "peaceful_non_demanding_endings",
    "premise_fulfillment",
    "rest_worthy_setting",
    "scene_has_purpose",
    "sensory_detail_balance",
    "sensory_presence",
    "sleep_transition_arc",
    "small_stakes_big_feelings",
    "story_is_change",
    "trust_the_reader",
    "voice_first_identity",
    "warm_dialogue",
  ];
  check("initializeCreativeKnowledge registers exactly the thirty-three approved modules", ids, expectedIds);
}

// ─── 3. Duplicate module IDs are rejected ──────────────────────────────

{
  const registry = new CreativeKnowledgeRegistry();
  const [first] = ACTIVE_KNOWLEDGE_MODULES;
  registry.register(first);
  let threw = false;
  try {
    registry.register(first);
  } catch {
    threw = true;
  }
  checkTrue("registering a duplicate module id throws", threw);
}

// ─── 4/5. Global module returned for narrative and sleep-story ────────

{
  const registry = new CreativeKnowledgeRegistry();
  initializeCreativeKnowledge(registry);

  const narrativeGeneration = registry.queryApplicableModules({
    preset: "narrative",
    stage: "generation",
  });
  checkTrue(
    "global module (trust_the_reader) is returned for narrative",
    narrativeGeneration.some((m) => m.id === "trust_the_reader")
  );

  const sleepStoryGeneration = registry.queryApplicableModules({
    preset: "sleep-story",
    stage: "generation",
  });
  checkTrue(
    "global module (trust_the_reader) is returned for sleep-story",
    sleepStoryGeneration.some((m) => m.id === "trust_the_reader")
  );

  // ─── 6/7. premise_fulfillment is narrative-only ──────────────────────

  const narrativePlanning = registry.queryApplicableModules({
    preset: "narrative",
    stage: "planning",
  });
  checkTrue(
    "premise_fulfillment is returned for narrative",
    narrativePlanning.some((m) => m.id === "premise_fulfillment")
  );

  const sleepStoryPlanning = registry.queryApplicableModules({
    preset: "sleep-story",
    stage: "planning",
  });
  checkTrue(
    "premise_fulfillment is NOT returned for sleep-story",
    !sleepStoryPlanning.some((m) => m.id === "premise_fulfillment")
  );

  // ─── 8. Usage-stage filtering ─────────────────────────────────────────

  const narrativeEditing = registry.queryApplicableModules({
    preset: "narrative",
    stage: "editing",
  });
  checkTrue(
    "editing stage includes trust_the_reader",
    narrativeEditing.some((m) => m.id === "trust_the_reader")
  );
  checkTrue(
    "editing stage excludes story_is_change (not applicable to editing)",
    !narrativeEditing.some((m) => m.id === "story_is_change")
  );

  // ─── 9. Category filtering ─────────────────────────────────────────

  const characterOnly = registry.queryApplicableModules({
    preset: "narrative",
    stage: "planning",
    category: "character",
  });
  check(
    "category filter narrows to character_wants_needs only",
    characterOnly.map((m) => m.id),
    ["character_wants_needs"]
  );

  // ─── 10. Priority ordering: CRITICAL -> HIGH -> MEDIUM -> LOW ────────

  const order = narrativePlanning.map((m) => m.priority);
  let monotonic = true;
  const rank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  for (let i = 1; i < order.length; i++) {
    if (rank[order[i]] < rank[order[i - 1]]) monotonic = false;
  }
  checkTrue("query results are ordered CRITICAL -> HIGH -> MEDIUM -> LOW", monotonic);
  check(
    "narrative/planning result order is deterministic",
    narrativePlanning.map((m) => m.id),
    ["character_wants_needs", "premise_fulfillment", "story_is_change", "scene_has_purpose"]
  );
}

// ─── 10b. Kids Story modules are scoped correctly ──────────────────────

{
  const registry = new CreativeKnowledgeRegistry();
  initializeCreativeKnowledge(registry);

  const kidsStoryIds = [
    "child_perspective",
    "gentle_wonder",
    "small_stakes_big_feelings",
    "friendship_and_belonging",
    "warm_dialogue",
    "emotional_safety",
  ];

  const kidsStoryPlanning = registry.queryApplicableModules({
    preset: "kids-story",
    stage: "planning",
  });
  for (const id of kidsStoryIds) {
    if (id === "warm_dialogue") continue; // not applicable to planning
    checkTrue(
      `kids-story receives "${id}" at planning`,
      kidsStoryPlanning.some((m) => m.id === id)
    );
  }

  const kidsStoryGeneration = registry.queryApplicableModules({
    preset: "kids-story",
    stage: "generation",
  });
  for (const id of kidsStoryIds) {
    checkTrue(
      `kids-story receives "${id}" at generation`,
      kidsStoryGeneration.some((m) => m.id === id)
    );
  }

  const narrativeGeneration = registry.queryApplicableModules({
    preset: "narrative",
    stage: "generation",
  });
  for (const id of kidsStoryIds) {
    checkTrue(
      `narrative preset does NOT receive kids-story module "${id}"`,
      !narrativeGeneration.some((m) => m.id === id)
    );
  }

  // Global modules still reach kids-story alongside its own modules.
  checkTrue(
    "kids-story also receives the global trust_the_reader module",
    kidsStoryGeneration.some((m) => m.id === "trust_the_reader")
  );
}

// ─── 10c. Meditation modules are scoped correctly ──────────────────────

{
  const registry = new CreativeKnowledgeRegistry();
  initializeCreativeKnowledge(registry);

  const meditationIds = [
    "guided_presence",
    "breath_awareness",
    "body_awareness",
    "non_judgmental_language",
    "meditation_emotional_safety",
    "gentle_visualization",
  ];

  const meditationPlanning = registry.queryApplicableModules({
    preset: "meditation",
    stage: "planning",
  });
  for (const id of meditationIds) {
    if (id === "non_judgmental_language") continue; // not applicable to planning
    checkTrue(
      `meditation receives "${id}" at planning`,
      meditationPlanning.some((m) => m.id === id)
    );
  }

  const meditationGeneration = registry.queryApplicableModules({
    preset: "meditation",
    stage: "generation",
  });
  for (const id of meditationIds) {
    checkTrue(
      `meditation receives "${id}" at generation`,
      meditationGeneration.some((m) => m.id === id)
    );
  }

  const narrativeGeneration = registry.queryApplicableModules({
    preset: "narrative",
    stage: "generation",
  });
  for (const id of meditationIds) {
    checkTrue(
      `narrative preset does NOT receive meditation module "${id}"`,
      !narrativeGeneration.some((m) => m.id === id)
    );
  }

  const kidsStoryGenerationForMeditationCheck = registry.queryApplicableModules({
    preset: "kids-story",
    stage: "generation",
  });
  for (const id of meditationIds) {
    checkTrue(
      `kids-story preset does NOT receive meditation module "${id}"`,
      !kidsStoryGenerationForMeditationCheck.some((m) => m.id === id)
    );
  }

  const sleepStoryGenerationForMeditationCheck = registry.queryApplicableModules({
    preset: "sleep-story",
    stage: "generation",
  });
  for (const id of meditationIds) {
    checkTrue(
      `sleep-story preset does NOT receive meditation module "${id}"`,
      !sleepStoryGenerationForMeditationCheck.some((m) => m.id === id)
    );
  }

  // Global modules still reach meditation alongside its own modules.
  checkTrue(
    "meditation also receives the global trust_the_reader module",
    meditationGeneration.some((m) => m.id === "trust_the_reader")
  );

  // kids-story's own emotional_safety module must remain distinct from
  // meditation's meditation_emotional_safety module (no id collision).
  checkTrue(
    "kids-story emotional_safety and meditation_emotional_safety are distinct modules",
    kidsStoryGenerationForMeditationCheck.some((m) => m.id === "emotional_safety") &&
      !kidsStoryGenerationForMeditationCheck.some((m) => m.id === "meditation_emotional_safety")
  );
}

// ─── 10d. Classic ASMR modules are scoped correctly ────────────────────

{
  const registry = new CreativeKnowledgeRegistry();
  initializeCreativeKnowledge(registry);

  const classicAsmrIds = [
    "sensory_presence",
    "gentle_rhythm",
    "intimate_safe_address",
    "sensory_detail_balance",
    "calming_repetition",
    "no_forced_response",
    "voice_first_identity",
  ];

  // sensory_presence and gentle_rhythm are now presence-only (RP-011C.8.8.3J)
  // -- pass asmrMode: "presence" so this scoping check still exercises them.
  const classicAsmrPlanning = registry.queryApplicableModules({
    preset: "classic-asmr",
    stage: "planning",
    asmrMode: "presence",
  });
  for (const id of classicAsmrIds) {
    // not applicable to planning -- language/prose-level devices only
    if (id === "intimate_safe_address" || id === "calming_repetition") continue;
    checkTrue(
      `classic-asmr receives "${id}" at planning`,
      classicAsmrPlanning.some((m) => m.id === id)
    );
  }

  const classicAsmrGeneration = registry.queryApplicableModules({
    preset: "classic-asmr",
    stage: "generation",
    asmrMode: "presence",
  });
  for (const id of classicAsmrIds) {
    checkTrue(
      `classic-asmr receives "${id}" at generation`,
      classicAsmrGeneration.some((m) => m.id === id)
    );
  }

  const narrativeGenerationForAsmrCheck = registry.queryApplicableModules({
    preset: "narrative",
    stage: "generation",
  });
  for (const id of classicAsmrIds) {
    checkTrue(
      `narrative preset does NOT receive classic-asmr module "${id}"`,
      !narrativeGenerationForAsmrCheck.some((m) => m.id === id)
    );
  }

  const meditationGenerationForAsmrCheck = registry.queryApplicableModules({
    preset: "meditation",
    stage: "generation",
  });
  for (const id of classicAsmrIds) {
    checkTrue(
      `meditation preset does NOT receive classic-asmr module "${id}"`,
      !meditationGenerationForAsmrCheck.some((m) => m.id === id)
    );
  }

  const sleepStoryGenerationForAsmrCheck = registry.queryApplicableModules({
    preset: "sleep-story",
    stage: "generation",
  });
  for (const id of classicAsmrIds) {
    checkTrue(
      `sleep-story preset does NOT receive classic-asmr module "${id}"`,
      !sleepStoryGenerationForAsmrCheck.some((m) => m.id === id)
    );
  }

  const kidsStoryGenerationForAsmrCheck = registry.queryApplicableModules({
    preset: "kids-story",
    stage: "generation",
  });
  for (const id of classicAsmrIds) {
    checkTrue(
      `kids-story preset does NOT receive classic-asmr module "${id}"`,
      !kidsStoryGenerationForAsmrCheck.some((m) => m.id === id)
    );
  }

  // Global modules still reach classic-asmr alongside its own modules.
  checkTrue(
    "classic-asmr also receives the global trust_the_reader module",
    classicAsmrGeneration.some((m) => m.id === "trust_the_reader")
  );
}

// ─── 10e. Classic ASMR knowledge is asmrMode-aware (RP-011C.8.8.3J) ────

{
  const registry = new CreativeKnowledgeRegistry();
  initializeCreativeKnowledge(registry);

  const presenceOnlyIds = ["sensory_presence", "gentle_rhythm"];
  const bothModeIds = ["intimate_safe_address", "no_forced_response", "voice_first_identity"];

  // 1. classic-asmr + presence receives the presence-only restrictions.
  const presenceGeneration = registry.queryApplicableModules({
    preset: "classic-asmr",
    stage: "generation",
    asmrMode: "presence",
  });
  for (const id of presenceOnlyIds) {
    checkTrue(
      `classic-asmr + presence receives presence-only module "${id}"`,
      presenceGeneration.some((m) => m.id === id)
    );
  }

  // 2. classic-asmr + story does NOT receive the presence-only narrative
  // bans, but still keeps voice-first identity, safe address, and no
  // forced outcomes.
  const storyGeneration = registry.queryApplicableModules({
    preset: "classic-asmr",
    stage: "generation",
    asmrMode: "story",
  });
  for (const id of presenceOnlyIds) {
    checkTrue(
      `classic-asmr + story does NOT receive presence-only module "${id}"`,
      !storyGeneration.some((m) => m.id === id)
    );
  }
  for (const id of bothModeIds) {
    checkTrue(
      `classic-asmr + story still receives "${id}"`,
      storyGeneration.some((m) => m.id === id)
    );
  }

  // 3. A classic-asmr query with no asmrMode specified excludes the
  // presence-only modules (they require an explicit mode match) while
  // still returning the mode-agnostic ones.
  const noModeGeneration = registry.queryApplicableModules({
    preset: "classic-asmr",
    stage: "generation",
  });
  for (const id of presenceOnlyIds) {
    checkTrue(
      `classic-asmr with no asmrMode excludes presence-only module "${id}"`,
      !noModeGeneration.some((m) => m.id === id)
    );
  }
  for (const id of bothModeIds) {
    checkTrue(
      `classic-asmr with no asmrMode still receives "${id}"`,
      noModeGeneration.some((m) => m.id === id)
    );
  }

  // 4. Other presets are unaffected by asmrMode filtering -- none of their
  // modules declare appliesTo.asmrModes, so passing (or omitting) asmrMode
  // makes no difference to their results.
  for (const preset of ["narrative", "sleep-story", "meditation", "kids-story"] as const) {
    const withoutMode = registry.queryApplicableModules({ preset, stage: "generation" });
    const withPresenceMode = registry.queryApplicableModules({
      preset,
      stage: "generation",
      asmrMode: "presence",
    });
    check(
      `${preset} results are unchanged by an (irrelevant) asmrMode filter`,
      withPresenceMode.map((m) => m.id),
      withoutMode.map((m) => m.id)
    );
  }
}

// ─── 10f. Sleep Story modules are scoped correctly (RP-011C.8.10C) ─────

{
  const registry = new CreativeKnowledgeRegistry();
  initializeCreativeKnowledge(registry);

  const sleepStoryIds = [
    "movement_without_urgency",
    "comfort_baseline_and_belonging",
    "sleep_transition_arc",
    "peaceful_non_demanding_endings",
    "rest_worthy_setting",
    "companions_as_warmth",
    "episodic_meandering_structure",
    "ambient_sensory_calm",
  ];

  const sleepStoryPlanning = registry.queryApplicableModules({
    preset: "sleep-story",
    stage: "planning",
  });
  for (const id of sleepStoryIds) {
    // not applicable to planning -- generation/evaluation-only devices
    if (id === "peaceful_non_demanding_endings" || id === "ambient_sensory_calm") continue;
    checkTrue(
      `sleep-story receives "${id}" at planning`,
      sleepStoryPlanning.some((m) => m.id === id)
    );
  }

  const sleepStoryGeneration = registry.queryApplicableModules({
    preset: "sleep-story",
    stage: "generation",
  });
  for (const id of sleepStoryIds) {
    checkTrue(
      `sleep-story receives "${id}" at generation`,
      sleepStoryGeneration.some((m) => m.id === id)
    );
  }

  const sleepStoryEvaluation = registry.queryApplicableModules({
    preset: "sleep-story",
    stage: "evaluation",
  });
  for (const id of sleepStoryIds) {
    // not applicable to evaluation -- planning/generation-only device
    if (id === "episodic_meandering_structure") continue;
    checkTrue(
      `sleep-story receives "${id}" at evaluation`,
      sleepStoryEvaluation.some((m) => m.id === id)
    );
  }

  const narrativeGenerationForSleepStoryCheck = registry.queryApplicableModules({
    preset: "narrative",
    stage: "generation",
  });
  for (const id of sleepStoryIds) {
    checkTrue(
      `narrative preset does NOT receive sleep-story module "${id}"`,
      !narrativeGenerationForSleepStoryCheck.some((m) => m.id === id)
    );
  }

  const meditationGenerationForSleepStoryCheck = registry.queryApplicableModules({
    preset: "meditation",
    stage: "generation",
  });
  for (const id of sleepStoryIds) {
    checkTrue(
      `meditation preset does NOT receive sleep-story module "${id}"`,
      !meditationGenerationForSleepStoryCheck.some((m) => m.id === id)
    );
  }

  const kidsStoryGenerationForSleepStoryCheck = registry.queryApplicableModules({
    preset: "kids-story",
    stage: "generation",
  });
  for (const id of sleepStoryIds) {
    checkTrue(
      `kids-story preset does NOT receive sleep-story module "${id}"`,
      !kidsStoryGenerationForSleepStoryCheck.some((m) => m.id === id)
    );
  }

  const classicAsmrGenerationForSleepStoryCheck = registry.queryApplicableModules({
    preset: "classic-asmr",
    stage: "generation",
  });
  for (const id of sleepStoryIds) {
    checkTrue(
      `classic-asmr preset does NOT receive sleep-story module "${id}"`,
      !classicAsmrGenerationForSleepStoryCheck.some((m) => m.id === id)
    );
  }

  // Global modules still reach sleep-story alongside its own modules.
  checkTrue(
    "sleep-story also receives the global trust_the_reader module",
    sleepStoryGeneration.some((m) => m.id === "trust_the_reader")
  );

  // companions_as_warmth documents a conflictsWith relationship to the
  // global character_wants_needs module, but there is no conflict-
  // resolution engine in the registry -- both still surface for sleep-story
  // at generation (conflictsWith is a documentation-only reference today).
  checkTrue(
    "companions_as_warmth documents conflictsWith character_wants_needs without suppressing either module",
    registry.get("companions_as_warmth")?.conflictsWith?.includes("character_wants_needs") === true &&
      sleepStoryGeneration.some((m) => m.id === "character_wants_needs")
  );
}

// ─── 11. Malformed module validation fails ─────────────────────────────

{
  const malformed = {
    id: "",
    name: "",
    category: "not-a-real-category",
    description: "",
    appliesTo: { scope: "preset", presets: [] },
    stages: [],
    purpose: "",
    knowledge: [],
    priority: "URGENT",
    metadata: { version: "", status: "unknown", sourceReference: { document: "" } },
  } as unknown as KnowledgeModule;

  const result = validateKnowledgeModule(malformed);
  checkTrue("malformed module fails validation", result.valid === false);

  const registry = new CreativeKnowledgeRegistry();
  let threw = false;
  try {
    registry.register(malformed);
  } catch {
    threw = true;
  }
  checkTrue("registering a malformed module throws", threw);
}

// ─── 11b. appliesTo.asmrModes validation (RP-011C.8.8.3J) ──────────────

{
  const base = {
    id: "test_module",
    name: "Test Module",
    category: "tone" as const,
    description: "test",
    stages: ["generation"] as const,
    purpose: "test",
    knowledge: ["test"],
    priority: "LOW" as const,
    metadata: {
      version: "1.0.0",
      status: "active" as const,
      sourceReference: { document: "test" },
    },
  };

  checkTrue(
    "asmrModes on a classic-asmr module validates successfully",
    validateKnowledgeModule({
      ...base,
      appliesTo: { scope: "preset", presets: ["classic-asmr"], asmrModes: ["presence"] },
    } as unknown as KnowledgeModule).valid === true
  );

  checkTrue(
    "asmrModes on a non-classic-asmr module fails validation",
    validateKnowledgeModule({
      ...base,
      appliesTo: { scope: "preset", presets: ["meditation"], asmrModes: ["presence"] },
    } as unknown as KnowledgeModule).valid === false
  );

  checkTrue(
    "an empty asmrModes array fails validation",
    validateKnowledgeModule({
      ...base,
      appliesTo: { scope: "preset", presets: ["classic-asmr"], asmrModes: [] },
    } as unknown as KnowledgeModule).valid === false
  );

  checkTrue(
    "an invalid asmrMode value fails validation",
    validateKnowledgeModule({
      ...base,
      appliesTo: { scope: "preset", presets: ["classic-asmr"], asmrModes: ["not-a-mode"] },
    } as unknown as KnowledgeModule).valid === false
  );
}

// ─── 12. No existing pipeline files import creative-intelligence ──────

{
  const pipelinePaths = [
    "app/api/jobs",
    "lib/narrative",
    "lib/story-supervisor.ts",
    "lib/script-builder.ts",
    "lib/tts",
    "lib/audio",
    "app/generate",
  ];

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

  const offendingFiles: string[] = [];
  for (const target of pipelinePaths) {
    for (const file of collectFiles(target)) {
      const content = fs.readFileSync(file, "utf8");
      if (content.includes("creative-intelligence")) {
        offendingFiles.push(path.relative(process.cwd(), file));
      }
    }
  }

  check(
    "no existing pipeline file imports lib/creative-intelligence",
    offendingFiles,
    []
  );
}

// ─── Summary ─────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
