// scripts/test-creative-intelligence-evaluation.ts
//
// RP-011C.7.27 — Isolated tests for the Narrative Evaluation Layer
// (lib/creative-intelligence/evaluation/**). Nothing here touches the
// active generation pipeline, calls a provider, or hits the database.
//
// Run with:  npx tsx scripts/test-creative-intelligence-evaluation.ts

import fs from "node:fs";
import path from "node:path";
import {
  CreativeKnowledgeRegistry,
  initializeCreativeKnowledge,
  buildCreativeContext,
  buildStoryBlueprint,
  buildSceneBlueprints,
  buildGenerationGuidance,
  writeStory,
  evaluateNarrative,
  getApplicableCriteria,
  EVALUATION_CRITERIA,
  EVALUATION_CRITERION_IDS,
} from "../lib/creative-intelligence";
import type {
  CreativeContext,
  CreativeIntent,
  EvaluationResult,
  GeneratedScene,
  GenerationGuidance,
  SceneBlueprint,
  StoryBlueprint,
} from "../lib/creative-intelligence";
import {
  SLEEP_STORY_SCENE_STEPS,
  SLEEP_STORY_EXPLICIT_SCENARIO_SCENE_STEPS,
} from "../lib/creative-intelligence/scenes/templates";

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

function storyFor(intent: CreativeIntent, prompt = "test"): GeneratedScene[] {
  const context = contextFor(intent, prompt);
  const blueprint = blueprintFor(intent, prompt);
  const scenes = buildSceneBlueprints({ intent, context, blueprint, createdAt: "2026-01-01T00:00:00.000Z" });
  const guidance = buildGenerationGuidance({ scenes, blueprint, context, intent, createdAt: "2026-01-01T00:00:00.000Z" });
  return writeStory({ scenes, guidance, blueprint, context, intent, createdAt: "2026-01-01T00:00:00.000Z" });
}

function evaluationFor(intent: CreativeIntent, prompt = "test"): EvaluationResult {
  const context = contextFor(intent, prompt);
  const storyBlueprint = blueprintFor(intent, prompt);
  const scenes = scenesFor(intent, prompt);
  const guidance = guidanceFor(intent, prompt);
  const generatedContent = storyFor(intent, prompt);
  return evaluateNarrative({
    generatedContent,
    storyBlueprint,
    scenes,
    guidance,
    context,
    intent,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
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

const classicAsmrPresenceIntent: CreativeIntent = {
  ...classicAsmrIntent,
  asmrMode: "presence",
};

const classicAsmrStoryIntent: CreativeIntent = {
  preset: "classic-asmr",
  experience: "a gentle, persona-led ASMR scenario",
  audience: "adult",
  durationMinutes: 15,
  constraints: [],
  asmrMode: "story",
};

const allIntents = [
  narrativeArcIntent,
  transformationIntent,
  sleepStoryIntent,
  meditationIntent,
  kidsStoryIntent,
  classicAsmrIntent,
];

// ─── 1. EvaluationResult can be created ─────────────────────────────────

{
  const result = evaluationFor(narrativeArcIntent);
  checkTrue("evaluateNarrative() returns a value", result !== undefined && result !== null);
  checkTrue(
    "EvaluationResult has the full contract shape",
    typeof result.overallAssessment === "string" &&
      typeof result.overallScore === "number" &&
      Array.isArray(result.criteriaResults) &&
      Array.isArray(result.strengths) &&
      Array.isArray(result.weaknesses) &&
      Array.isArray(result.violations) &&
      Array.isArray(result.suggestions) &&
      typeof result.metadata?.createdAt === "string" &&
      typeof result.metadata?.version === "string" &&
      result.metadata?.evaluatorMethod === "deterministic-structural"
  );
  checkTrue(
    "every CriteriaResult has the full contract shape",
    result.criteriaResults.every(
      (c) =>
        typeof c.criterionId === "string" &&
        typeof c.score === "number" &&
        typeof c.passed === "boolean" &&
        typeof c.explanation === "string"
    )
  );
  check("metadata.createdAt uses the provided override", result.metadata.createdAt, "2026-01-01T00:00:00.000Z");
}

// ─── 2. All criteria exist ───────────────────────────────────────────────

{
  // +1 because "emotional_safety" (RP-011C.8.8.2E) is one id shared by two
  // distinct, non-overlapping preset-scoped definitions -- kids-story's and
  // meditation's -- not a 1:1 id-to-definition mapping otherwise.
  check("EVALUATION_CRITERIA has one definition per EVALUATION_CRITERION_IDS entry, plus the shared emotional_safety id", EVALUATION_CRITERIA.length, EVALUATION_CRITERION_IDS.length + 1);
  check(
    "EVALUATION_CRITERIA ids match EVALUATION_CRITERION_IDS exactly (as a set)",
    [...new Set(EVALUATION_CRITERIA.map((c) => c.id))].sort(),
    [...EVALUATION_CRITERION_IDS].sort()
  );
  checkTrue(
    "every criterion definition has the full contract shape",
    EVALUATION_CRITERIA.every(
      (c) =>
        typeof c.id === "string" &&
        typeof c.name === "string" &&
        typeof c.question === "string" &&
        typeof c.description === "string" &&
        typeof c.appliesTo === "object" &&
        (c.severity === "violation" || c.severity === "weakness") &&
        typeof c.suggestion === "string"
    )
  );
}

// ─── 3. Premise Fulfillment criterion is present ────────────────────────

{
  const criterion = EVALUATION_CRITERIA.find((c) => c.id === "premise_fulfillment");
  checkTrue("Premise Fulfillment criterion exists", criterion !== undefined);
  check("Premise Fulfillment is global (applies to every preset)", criterion?.appliesTo.scope, "global");
  check("Premise Fulfillment is grounded in the premise_fulfillment knowledge module", criterion?.relatedKnowledgeModuleId, "premise_fulfillment");
  checkTrue(
    "Premise Fulfillment appears in getApplicableCriteria() for every preset",
    allIntents.every((intent) => getApplicableCriteria(intent.preset).some((c) => c.id === "premise_fulfillment"))
  );
}

// ─── 4. Trust The Reader criterion is present ───────────────────────────

{
  const criterion = EVALUATION_CRITERIA.find((c) => c.id === "trust_the_reader");
  checkTrue("Trust The Reader criterion exists", criterion !== undefined);
  check("Trust The Reader is global", criterion?.appliesTo.scope, "global");
  check("Trust The Reader is grounded in the trust_the_reader knowledge module", criterion?.relatedKnowledgeModuleId, "trust_the_reader");
}

// ─── 5. AI Pattern Detection structure is present and reacts to content ─

{
  const criterion = EVALUATION_CRITERIA.find((c) => c.id === "ai_writing_patterns");
  checkTrue("AI Writing Patterns criterion exists", criterion !== undefined);
  check(
    "AI Writing Patterns is grounded in the avoid_ai_writing_patterns knowledge module",
    criterion?.relatedKnowledgeModuleId,
    "avoid_ai_writing_patterns"
  );

  const context = contextFor(narrativeArcIntent);
  const storyBlueprint = blueprintFor(narrativeArcIntent);
  const scenes = scenesFor(narrativeArcIntent);
  const guidance = guidanceFor(narrativeArcIntent);
  const cleanContent = storyFor(narrativeArcIntent);

  const cleanResult = evaluateNarrative({
    generatedContent: cleanContent,
    storyBlueprint,
    scenes,
    guidance,
    context,
    intent: narrativeArcIntent,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const cleanCriterion = cleanResult.criteriaResults.find((c) => c.criterionId === "ai_writing_patterns");
  checkTrue("ai_writing_patterns passes on deterministic placeholder text", cleanCriterion?.passed === true);

  // Inject a literal anti-pattern phrase (from the avoid_ai_writing_patterns
  // module, resolved via CreativeContext) into otherwise-valid generated
  // content, and confirm the check reacts to it.
  const antiPattern = context.knowledge.modules.find((m) => m.id === "avoid_ai_writing_patterns")?.antiPatterns?.[0];
  checkTrue("avoid_ai_writing_patterns module has at least one antiPattern to test against", typeof antiPattern === "string");

  const taintedContent: GeneratedScene[] = cleanContent.map((scene, i) =>
    i === 0 ? { ...scene, text: `${scene.text}\n${antiPattern}` } : scene
  );
  const taintedResult = evaluateNarrative({
    generatedContent: taintedContent,
    storyBlueprint,
    scenes,
    guidance,
    context,
    intent: narrativeArcIntent,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const taintedCriterion = taintedResult.criteriaResults.find((c) => c.criterionId === "ai_writing_patterns");
  checkTrue("ai_writing_patterns fails once generated text contains a resolved anti-pattern phrase", taintedCriterion?.passed === false);
}

// ─── 6. Preset differences are supported ────────────────────────────────

{
  check(
    "narrative gets exactly the 7 global criteria (no preset-specific one)",
    getApplicableCriteria("narrative").map((c) => c.id).sort(),
    EVALUATION_CRITERIA.filter((c) => c.appliesTo.scope === "global").map((c) => c.id).sort()
  );
  checkTrue("classic-asmr gets sensory_quality", getApplicableCriteria("classic-asmr").some((c) => c.id === "sensory_quality"));
  checkTrue(
    "classic-asmr does not get sleep/meditation/kids-story-specific criteria",
    !getApplicableCriteria("classic-asmr").some((c) =>
      ["sleep_atmosphere_and_safety", "guided_clarity", "age_appropriate_imagination"].includes(c.id)
    )
  );
  checkTrue("sleep-story gets sleep_atmosphere_and_safety only (of the preset-scoped set)", getApplicableCriteria("sleep-story").some((c) => c.id === "sleep_atmosphere_and_safety"));
  checkTrue("meditation gets guided_clarity", getApplicableCriteria("meditation").some((c) => c.id === "guided_clarity"));
  checkTrue("kids-story gets age_appropriate_imagination", getApplicableCriteria("kids-story").some((c) => c.id === "age_appropriate_imagination"));

  // "Nicht alles als klassische Story bewerten": every preset can be
  // evaluated end-to-end without throwing, and produces a preset-shaped
  // criteria set (not a one-size-fits-all narrative rubric).
  for (const intent of allIntents) {
    const result = evaluationFor(intent);
    const expectedCount = getApplicableCriteria(intent.preset).length;
    check(`${intent.preset}: criteriaResults length matches getApplicableCriteria()`, result.criteriaResults.length, expectedCount);
  }
}

// ─── 7. No prose is generated ───────────────────────────────────────────

{
  for (const intent of allIntents) {
    const result = evaluationFor(intent);
    const allStrings = [...result.strengths, ...result.weaknesses, ...result.violations, ...result.suggestions];
    checkTrue(
      `${intent.preset}: no evaluation output string reads as a paragraph of prose (all under 300 chars)`,
      allStrings.every((s) => s.length < 300)
    );
  }

  // No large hand-written example story text baked into the evaluator
  // source -- only short structural label strings and check logic.
  const evaluationDir = path.join(process.cwd(), "lib/creative-intelligence/evaluation");
  const longStringOffenders: string[] = [];
  for (const file of fs.readdirSync(evaluationDir).filter((f) => /\.ts$/.test(f))) {
    const content = fs.readFileSync(path.join(evaluationDir, file), "utf8");
    const codeOnly = content
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    for (const match of codeOnly.matchAll(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`/g)) {
      const literal = match[0].slice(1, -1);
      if (literal.length >= 200) longStringOffenders.push(`${file}: string literal of ${literal.length} chars`);
    }
  }
  check("no evaluation/ source file contains a long hand-written string literal (mock story/prose text)", longStringOffenders, []);
}

// ─── 8. No rewrite actions are performed ────────────────────────────────

{
  const context = contextFor(narrativeArcIntent);
  const storyBlueprint = blueprintFor(narrativeArcIntent);
  const scenes = scenesFor(narrativeArcIntent);
  const guidance = guidanceFor(narrativeArcIntent);
  const generatedContent = storyFor(narrativeArcIntent);

  const contextSnapshot = JSON.stringify(context);
  const blueprintSnapshot = JSON.stringify(storyBlueprint);
  const scenesSnapshot = JSON.stringify(scenes);
  const guidanceSnapshot = JSON.stringify(guidance);
  const contentSnapshot = JSON.stringify(generatedContent);

  evaluateNarrative({ generatedContent, storyBlueprint, scenes, guidance, context, intent: narrativeArcIntent, createdAt: "2026-01-01T00:00:00.000Z" });

  check("evaluateNarrative does not mutate the CreativeContext it is given", JSON.stringify(context), contextSnapshot);
  check("evaluateNarrative does not mutate the StoryBlueprint it is given", JSON.stringify(storyBlueprint), blueprintSnapshot);
  check("evaluateNarrative does not mutate the SceneBlueprint[] it is given", JSON.stringify(scenes), scenesSnapshot);
  check("evaluateNarrative does not mutate the GenerationGuidance[] it is given", JSON.stringify(guidance), guidanceSnapshot);
  check("evaluateNarrative does not mutate the GeneratedScene[] it is given", JSON.stringify(generatedContent), contentSnapshot);

  const evaluationDir = path.join(process.cwd(), "lib/creative-intelligence/evaluation");
  const rewriteOffenders: string[] = [];
  for (const file of fs.readdirSync(evaluationDir).filter((f) => /\.ts$/.test(f))) {
    const content = fs.readFileSync(path.join(evaluationDir, file), "utf8");
    if (/\brewrite\w*\s*\(/i.test(content) || /\brepair\w*\s*\(/i.test(content) || /\bwriteScene\s*\(/.test(content) || /\bwriteStory\s*\(/.test(content)) {
      rewriteOffenders.push(path.relative(process.cwd(), path.join(evaluationDir, file)));
    }
  }
  check("no evaluation/ source file defines or calls a rewrite/repair/writer function", rewriteOffenders, []);
}

// ─── 9. No pipeline imports ──────────────────────────────────────────────

{
  const forbiddenPipelinePaths = [
    "app/api/jobs",
    "lib/narrative",
    "lib/story-supervisor.ts",
    "lib/script-builder.ts",
    "lib/script-builder-openai.ts",
    "lib/script-builder-narrative.ts",
    "lib/script-builder-narrative-story.ts",
    "lib/script-builder-narrative-quiet-knowledge.ts",
    "lib/tts",
    "lib/audio",
    "app/generate",
  ];

  const evaluationDir = path.join(process.cwd(), "lib/creative-intelligence/evaluation");
  const evaluationFiles = fs
    .readdirSync(evaluationDir)
    .filter((f) => /\.ts$/.test(f))
    .map((f) => path.join(evaluationDir, f));

  const offending: string[] = [];
  for (const file of evaluationFiles) {
    // Explanatory comments legitimately name lib/story-supervisor.ts and
    // creativeKnowledgeRegistry (to document what this layer does NOT do)
    // -- only real code should trip this check.
    const codeOnly = fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    for (const forbidden of forbiddenPipelinePaths) {
      if (codeOnly.includes(forbidden)) offending.push(`${path.relative(process.cwd(), file)} -> ${forbidden}`);
    }
    if (/\bcreativeKnowledgeRegistry\b/.test(codeOnly)) {
      offending.push(`${path.relative(process.cwd(), file)} -> direct registry usage (must use CreativeContext only)`);
    }
  }
  check("no evaluation/ file references a pipeline path or queries creativeKnowledgeRegistry directly", offending, []);

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

// ─── 10. No provider calls ───────────────────────────────────────────────

{
  const evaluationDir = path.join(process.cwd(), "lib/creative-intelligence/evaluation");
  const offending: string[] = [];
  for (const file of fs.readdirSync(evaluationDir).filter((f) => /\.ts$/.test(f))) {
    const content = fs.readFileSync(path.join(evaluationDir, file), "utf8");
    if (/from\s+["']openai["']/.test(content) || /from\s+["']elevenlabs["']/.test(content)) {
      offending.push(`${file} -> provider import`);
    }
    if (/from\s+["'].*prisma.*["']/.test(content) || /@prisma\/client/.test(content)) {
      offending.push(`${file} -> database import`);
    }
    if (/\bopenai\./i.test(content) || /\belevenlabs\./i.test(content)) {
      offending.push(`${file} -> provider call`);
    }
  }
  check("no evaluation/ file imports a provider SDK, calls a provider, or touches the database", offending, []);
}

// ─── 11. Kids Story-specific evaluation criteria (RP-011C.8.8.1C) ───────

{
  const kidsOnlyIds = ["child_perspective", "emotional_safety", "gentle_wonder", "warmth_and_belonging"];

  checkTrue(
    "all four new Kids Story criteria exist",
    kidsOnlyIds.every((id) => EVALUATION_CRITERIA.some((c) => c.id === id))
  );
  checkTrue(
    "all four new Kids Story criteria are preset-scoped to kids-story only",
    kidsOnlyIds.every((id) => {
      const c = EVALUATION_CRITERIA.find((def) => def.id === id);
      return c?.appliesTo.scope === "preset" && JSON.stringify(c.appliesTo.presets) === JSON.stringify(["kids-story"]);
    })
  );
  check(
    "child_perspective is grounded in the child_perspective knowledge module",
    EVALUATION_CRITERIA.find((c) => c.id === "child_perspective")?.relatedKnowledgeModuleId,
    "child_perspective"
  );
  check(
    "emotional_safety is grounded in the emotional_safety knowledge module",
    EVALUATION_CRITERIA.find((c) => c.id === "emotional_safety")?.relatedKnowledgeModuleId,
    "emotional_safety"
  );
  check(
    "gentle_wonder is grounded in the gentle_wonder knowledge module",
    EVALUATION_CRITERIA.find((c) => c.id === "gentle_wonder")?.relatedKnowledgeModuleId,
    "gentle_wonder"
  );
  check(
    "warmth_and_belonging is grounded in the friendship_and_belonging knowledge module",
    EVALUATION_CRITERIA.find((c) => c.id === "warmth_and_belonging")?.relatedKnowledgeModuleId,
    "friendship_and_belonging"
  );

  checkTrue(
    "kids-story gets all four new criteria",
    kidsOnlyIds.every((id) => getApplicableCriteria("kids-story").some((c) => c.id === id))
  );
  checkTrue(
    "narrative does not get any of the new Kids Story criteria",
    !getApplicableCriteria("narrative").some((c) => kidsOnlyIds.includes(c.id))
  );
  checkTrue(
    // meditation legitimately gets its own, distinct emotional_safety
    // criterion (RP-011C.8.8.2E, see section 13 below) that shares this id
    // with the Kids Story one -- excluded here, not a leak of the Kids
    // Story definition.
    "no preset other than kids-story or meditation gets any of the new Kids Story criteria",
    allIntents
      .filter((intent) => intent.preset !== "kids-story" && intent.preset !== "meditation")
      .every((intent) => !getApplicableCriteria(intent.preset).some((c) => kidsOnlyIds.includes(c.id)))
  );
  checkTrue(
    "meditation only shares the emotional_safety id with Kids Story, not the other three ids",
    !getApplicableCriteria("meditation").some((c) => ["child_perspective", "gentle_wonder", "warmth_and_belonging"].includes(c.id))
  );

  const kidsResult = evaluationFor(kidsStoryIntent);
  checkTrue(
    "kids-story evaluation produces a result for every new criterion",
    kidsOnlyIds.every((id) => kidsResult.criteriaResults.some((c) => c.criterionId === id))
  );
  checkTrue(
    "new Kids Story criteria pass on deterministic placeholder text for a well-formed kids-story intent",
    kidsOnlyIds.every((id) => kidsResult.criteriaResults.find((c) => c.criterionId === id)?.passed === true)
  );

  // Inject a phrase each check's antiPattern list should catch, and confirm
  // the corresponding criterion (and only that one) reacts to it.
  const context = contextFor(kidsStoryIntent);
  const storyBlueprint = blueprintFor(kidsStoryIntent);
  const scenes = scenesFor(kidsStoryIntent);
  const guidance = guidanceFor(kidsStoryIntent);
  const cleanContent = storyFor(kidsStoryIntent);

  const taintCases: Array<{ id: (typeof kidsOnlyIds)[number]; phrase: string }> = [
    { id: "child_perspective", phrase: "in retrospect" },
    { id: "emotional_safety", phrase: "screamed in fear" },
    { id: "gentle_wonder", phrase: "save the world" },
    { id: "warmth_and_belonging", phrase: "did it all alone" },
  ];

  for (const { id, phrase } of taintCases) {
    const taintedContent: GeneratedScene[] = cleanContent.map((scene, i) =>
      i === 0 ? { ...scene, text: `${scene.text}\n${phrase}` } : scene
    );
    const taintedResult = evaluateNarrative({
      generatedContent: taintedContent,
      storyBlueprint,
      scenes,
      guidance,
      context,
      intent: kidsStoryIntent,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    checkTrue(
      `${id} fails once generated text contains "${phrase}"`,
      taintedResult.criteriaResults.find((c) => c.criterionId === id)?.passed === false
    );
  }

  // Global criteria (e.g. age_appropriate_imagination, already present
  // before this task) must be unchanged by adding the new ones.
  check(
    "age_appropriate_imagination criterion is unchanged",
    EVALUATION_CRITERIA.find((c) => c.id === "age_appropriate_imagination")?.suggestion,
    "Check whether age-safety constraints and a positive/safe resolution requirement are present on the intent."
  );

  // No provider/rewrite calls were introduced by these new checks either.
  const evaluationDir = path.join(process.cwd(), "lib/creative-intelligence/evaluation");
  const offending: string[] = [];
  for (const file of fs.readdirSync(evaluationDir).filter((f) => /\.ts$/.test(f))) {
    const content = fs.readFileSync(path.join(evaluationDir, file), "utf8");
    if (/\bopenai\./i.test(content) || /\belevenlabs\./i.test(content) || /\brewrite\w*\s*\(/i.test(content) || /\bwriteScene\s*\(/.test(content)) {
      offending.push(file);
    }
  }
  check("no provider or rewrite calls were introduced alongside the new Kids Story criteria", offending, []);
}

// ─── 13. Meditation-specific evaluation criteria (RP-011C.8.8.2E) ───────

{
  const meditationOnlyIds = [
    "guidance_clarity",
    "attention_progression",
    "non_judgmental_language",
    "embodiment_and_presence",
    "pacing_quality",
  ];

  checkTrue(
    "all five non-shared meditation criteria exist",
    meditationOnlyIds.every((id) => EVALUATION_CRITERIA.some((c) => c.id === id))
  );
  checkTrue(
    "all five non-shared meditation criteria are preset-scoped to meditation only",
    meditationOnlyIds.every((id) => {
      const c = EVALUATION_CRITERIA.find((def) => def.id === id);
      return c?.appliesTo.scope === "preset" && JSON.stringify(c.appliesTo.presets) === JSON.stringify(["meditation"]);
    })
  );
  checkTrue(
    "meditation's emotional_safety definition is preset-scoped to meditation only, distinct from Kids Story's",
    EVALUATION_CRITERIA.filter((c) => c.id === "emotional_safety" && c.relatedKnowledgeModuleId === "meditation_emotional_safety").every(
      (c) => c.appliesTo.scope === "preset" && JSON.stringify(c.appliesTo.presets) === JSON.stringify(["meditation"])
    )
  );

  check(
    "guidance_clarity is grounded in the guided_presence knowledge module",
    EVALUATION_CRITERIA.find((c) => c.id === "guidance_clarity")?.relatedKnowledgeModuleId,
    "guided_presence"
  );
  check(
    "attention_progression is grounded in the guided_presence knowledge module",
    EVALUATION_CRITERIA.find((c) => c.id === "attention_progression")?.relatedKnowledgeModuleId,
    "guided_presence"
  );
  check(
    "non_judgmental_language is grounded in the non_judgmental_language knowledge module",
    EVALUATION_CRITERIA.find((c) => c.id === "non_judgmental_language")?.relatedKnowledgeModuleId,
    "non_judgmental_language"
  );
  check(
    "meditation's emotional_safety is grounded in the meditation_emotional_safety knowledge module",
    EVALUATION_CRITERIA.find((c) => c.id === "emotional_safety" && c.relatedKnowledgeModuleId === "meditation_emotional_safety")
      ?.relatedKnowledgeModuleId,
    "meditation_emotional_safety"
  );
  check(
    "embodiment_and_presence is grounded in the breath_awareness knowledge module",
    EVALUATION_CRITERIA.find((c) => c.id === "embodiment_and_presence")?.relatedKnowledgeModuleId,
    "breath_awareness"
  );
  check(
    "pacing_quality is grounded in the breath_awareness knowledge module",
    EVALUATION_CRITERIA.find((c) => c.id === "pacing_quality")?.relatedKnowledgeModuleId,
    "breath_awareness"
  );

  checkTrue(
    "meditation gets all five non-shared criteria plus its own emotional_safety",
    [...meditationOnlyIds, "emotional_safety"].every((id) => getApplicableCriteria("meditation").some((c) => c.id === id))
  );
  checkTrue(
    "narrative does not get any of the new meditation-only criteria",
    !getApplicableCriteria("narrative").some((c) => meditationOnlyIds.includes(c.id))
  );
  checkTrue(
    "no other preset gets any of the new meditation-only criteria",
    allIntents
      .filter((intent) => intent.preset !== "meditation")
      .every((intent) => !getApplicableCriteria(intent.preset).some((c) => meditationOnlyIds.includes(c.id)))
  );

  const meditationResult = evaluationFor(meditationIntent);
  checkTrue(
    "meditation evaluation produces a result for every new criterion",
    [...meditationOnlyIds, "emotional_safety"].every((id) => meditationResult.criteriaResults.some((c) => c.criterionId === id))
  );
  checkTrue(
    "new meditation criteria pass on deterministic placeholder text for a well-formed meditation intent",
    [...meditationOnlyIds, "emotional_safety"].every(
      (id) => meditationResult.criteriaResults.find((c) => c.criterionId === id)?.passed === true
    )
  );

  // Text-reactive criteria: inject a phrase each check's phrase list should
  // catch, and confirm the corresponding criterion (and only that one, of
  // this set) reacts to it.
  const context = contextFor(meditationIntent);
  const storyBlueprint = blueprintFor(meditationIntent);
  const scenes = scenesFor(meditationIntent);
  const guidance = guidanceFor(meditationIntent);
  const cleanContent = storyFor(meditationIntent);

  const taintCases: Array<{ id: string; phrase: string }> = [
    { id: "guidance_clarity", phrase: "cosmic tapestry" },
    { id: "non_judgmental_language", phrase: "you must" },
    { id: "emotional_safety", phrase: "confront your deepest fear" },
    { id: "embodiment_and_presence", phrase: "on your quest" },
    { id: "pacing_quality", phrase: "hurry" },
  ];

  for (const { id, phrase } of taintCases) {
    const taintedContent: GeneratedScene[] = cleanContent.map((scene, i) =>
      i === 0 ? { ...scene, text: `${scene.text}\n${phrase}` } : scene
    );
    const taintedResult = evaluateNarrative({
      generatedContent: taintedContent,
      storyBlueprint,
      scenes,
      guidance,
      context,
      intent: meditationIntent,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    checkTrue(
      `${id} fails once generated text contains "${phrase}"`,
      taintedResult.criteriaResults.find((c) => c.criterionId === id)?.passed === false
    );
  }

  // Structural criterion: attention_progression reacts to scenes, not
  // generated text -- swap the order of the first ("arrival and settling")
  // and last ("gentle return") scenes so attention moves backwards instead
  // of arrival -> focus -> ... -> return.
  {
    const firstScene = scenes.find((s) => s.order === Math.min(...scenes.map((sc) => sc.order)))!;
    const lastScene = scenes.find((s) => s.order === Math.max(...scenes.map((sc) => sc.order)))!;
    const reorderedScenes: SceneBlueprint[] = scenes.map((s) => {
      if (s.id === firstScene.id) return { ...s, order: lastScene.order };
      if (s.id === lastScene.id) return { ...s, order: firstScene.order };
      return s;
    });
    const reorderedResult = evaluateNarrative({
      generatedContent: cleanContent,
      storyBlueprint,
      scenes: reorderedScenes,
      guidance,
      context,
      intent: meditationIntent,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    checkTrue(
      "attention_progression fails once the arrival and return scenes are swapped out of order",
      reorderedResult.criteriaResults.find((c) => c.criterionId === "attention_progression")?.passed === false
    );
  }

  // No provider/rewrite calls were introduced by these new checks either.
  const evaluationDir = path.join(process.cwd(), "lib/creative-intelligence/evaluation");
  const offending: string[] = [];
  for (const file of fs.readdirSync(evaluationDir).filter((f) => /\.ts$/.test(f))) {
    const content = fs.readFileSync(path.join(evaluationDir, file), "utf8");
    if (/\bopenai\./i.test(content) || /\belevenlabs\./i.test(content) || /\brewrite\w*\s*\(/i.test(content) || /\bwriteScene\s*\(/.test(content)) {
      offending.push(file);
    }
  }
  check("no provider or rewrite calls were introduced alongside the new meditation criteria", offending, []);
}

// ─── 14. Meditation pacing polish: sequential-marker overuse (RP-011C.8.8.2G) ──
// Benchmark review found generated meditation text over-relying on
// announced step markers ("Now,", "For the next few moments,", "When you
// are ready,", "You might begin") between instructions, reading as
// step-by-step guidance rather than a continuous space. A single use is
// ordinary, natural language and must still pass; only frequent repetition
// should fail pacing_quality.

{
  const context = contextFor(meditationIntent);
  const storyBlueprint = blueprintFor(meditationIntent);
  const scenes = scenesFor(meditationIntent);
  const guidance = guidanceFor(meditationIntent);
  const cleanContent = storyFor(meditationIntent);

  function withInjectedText(phrase: string, times: number): GeneratedScene[] {
    let remaining = times;
    return cleanContent.map((scene) => {
      if (remaining <= 0) return scene;
      remaining -= 1;
      return { ...scene, text: `${scene.text}\n${phrase}` };
    });
  }

  const singleUsePassed = evaluateNarrative({
    generatedContent: withInjectedText("when you are ready", 1),
    storyBlueprint,
    scenes,
    guidance,
    context,
    intent: meditationIntent,
    createdAt: "2026-01-01T00:00:00.000Z",
  }).criteriaResults.find((c) => c.criterionId === "pacing_quality")?.passed;
  checkTrue("pacing_quality still passes on a single, natural use of an invitation phrase", singleUsePassed === true);

  const overusedResult = evaluateNarrative({
    generatedContent: withInjectedText("when you are ready", 3),
    storyBlueprint,
    scenes,
    guidance,
    context,
    intent: meditationIntent,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  checkTrue(
    "pacing_quality fails once an announced step marker is repeated across the session",
    overusedResult.criteriaResults.find((c) => c.criterionId === "pacing_quality")?.passed === false
  );

  const mixedMarkersResult = evaluateNarrative({
    generatedContent: cleanContent.map((scene, i) =>
      i === 0 ? { ...scene, text: `${scene.text}\nNow,\nFor the next few moments\nYou might begin` } : scene
    ),
    storyBlueprint,
    scenes,
    guidance,
    context,
    intent: meditationIntent,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  checkTrue(
    "pacing_quality fails once several different step markers together exceed the threshold",
    mixedMarkersResult.criteriaResults.find((c) => c.criterionId === "pacing_quality")?.passed === false
  );
}

// ─── 16. Classic ASMR-specific evaluation criteria (RP-011C.8.8.3E) ─────

{
  const asmrOnlyIds = [
    "sensory_presence",
    "gentle_rhythm",
    "safe_personal_address",
    "sensory_detail_balance",
    "calming_repetition",
    "no_forced_response",
  ];

  checkTrue(
    "all six new classic-asmr criteria exist",
    asmrOnlyIds.every((id) => EVALUATION_CRITERIA.some((c) => c.id === id))
  );
  checkTrue(
    "all six new classic-asmr criteria are preset-scoped to classic-asmr only",
    asmrOnlyIds.every((id) => {
      const c = EVALUATION_CRITERIA.find((def) => def.id === id);
      return c?.appliesTo.scope === "preset" && JSON.stringify(c.appliesTo.presets) === JSON.stringify(["classic-asmr"]);
    })
  );

  check(
    "sensory_presence is grounded in the sensory_presence knowledge module",
    EVALUATION_CRITERIA.find((c) => c.id === "sensory_presence")?.relatedKnowledgeModuleId,
    "sensory_presence"
  );
  check(
    "gentle_rhythm is grounded in the gentle_rhythm knowledge module",
    EVALUATION_CRITERIA.find((c) => c.id === "gentle_rhythm")?.relatedKnowledgeModuleId,
    "gentle_rhythm"
  );
  check(
    "safe_personal_address is grounded in the intimate_safe_address knowledge module",
    EVALUATION_CRITERIA.find((c) => c.id === "safe_personal_address")?.relatedKnowledgeModuleId,
    "intimate_safe_address"
  );
  check(
    "sensory_detail_balance is grounded in the sensory_detail_balance knowledge module",
    EVALUATION_CRITERIA.find((c) => c.id === "sensory_detail_balance")?.relatedKnowledgeModuleId,
    "sensory_detail_balance"
  );
  check(
    "calming_repetition is grounded in the calming_repetition knowledge module",
    EVALUATION_CRITERIA.find((c) => c.id === "calming_repetition")?.relatedKnowledgeModuleId,
    "calming_repetition"
  );
  check(
    "no_forced_response is grounded in the no_forced_response knowledge module",
    EVALUATION_CRITERIA.find((c) => c.id === "no_forced_response")?.relatedKnowledgeModuleId,
    "no_forced_response"
  );

  checkTrue(
    "classic-asmr gets all six new criteria plus the pre-existing sensory_quality",
    [...asmrOnlyIds, "sensory_quality"].every((id) => getApplicableCriteria("classic-asmr").some((c) => c.id === id))
  );
  checkTrue(
    "narrative does not get any of the new classic-asmr criteria",
    !getApplicableCriteria("narrative").some((c) => asmrOnlyIds.includes(c.id))
  );
  checkTrue(
    "no preset other than classic-asmr gets any of the new classic-asmr criteria",
    allIntents
      .filter((intent) => intent.preset !== "classic-asmr")
      .every((intent) => !getApplicableCriteria(intent.preset).some((c) => asmrOnlyIds.includes(c.id)))
  );
  checkTrue(
    "meditation, sleep-story, narrative, and kids-story evaluation criteria sets are unaffected by the new classic-asmr criteria",
    getApplicableCriteria("meditation").length +
      getApplicableCriteria("sleep-story").length +
      getApplicableCriteria("narrative").length +
      getApplicableCriteria("kids-story").length ===
      [meditationIntent, sleepStoryIntent, narrativeArcIntent, kidsStoryIntent].reduce(
        (sum, intent) => sum + getApplicableCriteria(intent.preset).length,
        0
      )
  );

  const asmrResult = evaluationFor(classicAsmrIntent);
  checkTrue(
    "classic-asmr evaluation produces a result for every new criterion",
    asmrOnlyIds.every((id) => asmrResult.criteriaResults.some((c) => c.criterionId === id))
  );
  checkTrue(
    "new classic-asmr criteria pass on deterministic placeholder text for a well-formed classic-asmr intent",
    asmrOnlyIds.every((id) => asmrResult.criteriaResults.find((c) => c.criterionId === id)?.passed === true)
  );

  // Text-reactive criteria: inject a phrase each check's phrase list should
  // catch, and confirm the corresponding criterion reacts to it.
  const context = contextFor(classicAsmrIntent);
  const storyBlueprint = blueprintFor(classicAsmrIntent);
  const scenes = scenesFor(classicAsmrIntent);
  const guidance = guidanceFor(classicAsmrIntent);
  const cleanContent = storyFor(classicAsmrIntent);

  const taintCases: Array<{ id: string; phrase: string }> = [
    { id: "sensory_presence", phrase: "chapter one" },
    { id: "gentle_rhythm", phrase: "building to a climax" },
    { id: "safe_personal_address", phrase: "she said" },
    { id: "sensory_detail_balance", phrase: "enchanted forest" },
    { id: "no_forced_response", phrase: "you will feel tingles" },
  ];

  for (const { id, phrase } of taintCases) {
    const taintedContent: GeneratedScene[] = cleanContent.map((scene, i) =>
      i === 0 ? { ...scene, text: `${scene.text}\n${phrase}` } : scene
    );
    const taintedResult = evaluateNarrative({
      generatedContent: taintedContent,
      storyBlueprint,
      scenes,
      guidance,
      context,
      intent: classicAsmrIntent,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    checkTrue(
      `${id} fails once generated text contains "${phrase}"`,
      taintedResult.criteriaResults.find((c) => c.criterionId === id)?.passed === false
    );
  }

  // Structural criterion: calming_repetition reacts to the planned scenes,
  // not generated text -- drop the "Sensory variation" scene so repetition
  // has no paired gentle-variation stage (knowledge/classic-asmr/
  // calming-repetition.ts's antiPattern: "restating the same sensory beat
  // identically with no gentle variation").
  {
    const scenesWithoutVariation = scenes.filter((s) => !/variation/i.test(s.narrativeFunction));
    checkTrue(
      "classic-asmr planning includes a Sensory variation scene to remove for this test",
      scenesWithoutVariation.length < scenes.length
    );
    const noVariationResult = evaluateNarrative({
      generatedContent: cleanContent,
      storyBlueprint,
      scenes: scenesWithoutVariation,
      guidance,
      context,
      intent: classicAsmrIntent,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    checkTrue(
      "calming_repetition fails once the planned scenes have no gentle-variation stage",
      noVariationResult.criteriaResults.find((c) => c.criterionId === "calming_repetition")?.passed === false
    );
  }

  // Global criteria (e.g. sensory_quality, already present before this
  // task) must be unchanged by adding the new ones.
  check(
    "sensory_quality criterion is unchanged",
    EVALUATION_CRITERIA.find((c) => c.id === "sensory_quality")?.suggestion,
    "Check whether segment lengths and sensory description guidance are consistent across the session."
  );

  // trust_the_reader, ending_quality, and ai_writing_patterns must not be
  // altered by this calibration -- classic ASMR does not require narrative
  // payoff, transformation, or resolution, and these three global checks
  // continue to apply unchanged (verified separately not to penalize
  // ASMR's legitimate calming repetition or lack of plot payoff).
  checkTrue(
    "trust_the_reader passes on classic-asmr's own deterministic placeholder text",
    asmrResult.criteriaResults.find((c) => c.criterionId === "trust_the_reader")?.passed === true
  );
  checkTrue(
    "ai_writing_patterns passes on classic-asmr's own deterministic placeholder text",
    asmrResult.criteriaResults.find((c) => c.criterionId === "ai_writing_patterns")?.passed === true
  );
  checkTrue(
    "ending_quality passes on classic-asmr's own deterministic placeholder text",
    asmrResult.criteriaResults.find((c) => c.criterionId === "ending_quality")?.passed === true
  );

  // No provider/rewrite calls were introduced by these new checks either.
  const evaluationDir = path.join(process.cwd(), "lib/creative-intelligence/evaluation");
  const offending: string[] = [];
  for (const file of fs.readdirSync(evaluationDir).filter((f) => /\.ts$/.test(f))) {
    const content = fs.readFileSync(path.join(evaluationDir, file), "utf8");
    if (/\bopenai\./i.test(content) || /\belevenlabs\./i.test(content) || /\brewrite\w*\s*\(/i.test(content) || /\bwriteScene\s*\(/.test(content)) {
      offending.push(file);
    }
  }
  check("no provider or rewrite calls were introduced alongside the new classic-asmr criteria", offending, []);
}

// ─── 17. Classic ASMR story mode evaluation calibration (RP-011C.8.8.3N) ─
// Evaluation must become aware of CreativeIntent.asmrMode ("presence" |
// "story") for classic-asmr without becoming a second evaluation system:
// same six criteria, same getApplicableCriteria() routing, only the
// CRITERION_CHECKS for sensory_presence, safe_personal_address, and
// calming_repetition branch on intent.asmrMode inside evaluator.ts.

{
  const asmrOnlyIds = [
    "sensory_presence",
    "gentle_rhythm",
    "safe_personal_address",
    "sensory_detail_balance",
    "calming_repetition",
    "no_forced_response",
  ];

  // getApplicableCriteria() routing depends only on preset, not asmrMode --
  // both modes get the exact same criteria set (global + classic-asmr-
  // scoped), confirming this is still one evaluation system, not two.
  check(
    "presence and story mode get identical applicable criteria",
    getApplicableCriteria("classic-asmr").map((c) => c.id).sort(),
    [...EVALUATION_CRITERIA.filter((c) => c.appliesTo.scope === "global").map((c) => c.id), ...asmrOnlyIds, "sensory_quality"].sort()
  );

  const presenceResult = evaluationFor(classicAsmrPresenceIntent);
  const storyResult = evaluationFor(classicAsmrStoryIntent);

  checkTrue(
    "classic-asmr presence: clean deterministic placeholder text still passes every criterion",
    asmrOnlyIds.every((id) => presenceResult.criteriaResults.find((c) => c.criterionId === id)?.passed === true)
  );
  checkTrue(
    "classic-asmr story: clean deterministic placeholder text passes every criterion, including calming_repetition's mode-appropriate stage names",
    asmrOnlyIds.every((id) => storyResult.criteriaResults.find((c) => c.criterionId === id)?.passed === true)
  );

  // 1. classic-asmr presence: existing restrictions still pass/fail
  // correctly -- unchanged behavior from RP-011C.8.8.3E.
  {
    const context = contextFor(classicAsmrPresenceIntent);
    const storyBlueprint = blueprintFor(classicAsmrPresenceIntent);
    const scenes = scenesFor(classicAsmrPresenceIntent);
    const guidance = guidanceFor(classicAsmrPresenceIntent);
    const cleanContent = storyFor(classicAsmrPresenceIntent);

    const presenceTaintCases: Array<{ id: string; phrase: string }> = [
      { id: "sensory_presence", phrase: "our story continues" },
      { id: "safe_personal_address", phrase: "she said" },
    ];

    for (const { id, phrase } of presenceTaintCases) {
      const taintedContent: GeneratedScene[] = cleanContent.map((scene, i) =>
        i === 0 ? { ...scene, text: `${scene.text}\n${phrase}` } : scene
      );
      const taintedResult = evaluateNarrative({
        generatedContent: taintedContent,
        storyBlueprint,
        scenes,
        guidance,
        context,
        intent: classicAsmrPresenceIntent,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      checkTrue(
        `presence mode: ${id} still fails once generated text contains "${phrase}"`,
        taintedResult.criteriaResults.find((c) => c.criterionId === id)?.passed === false
      );
    }
  }

  // 2. classic-asmr story: persona/dialogue/scenario no longer trigger
  // false positives.
  {
    const context = contextFor(classicAsmrStoryIntent);
    const storyBlueprint = blueprintFor(classicAsmrStoryIntent);
    const scenes = scenesFor(classicAsmrStoryIntent);
    const guidance = guidanceFor(classicAsmrStoryIntent);
    const cleanContent = storyFor(classicAsmrStoryIntent);

    const storyAllowedCases: Array<{ id: string; phrase: string }> = [
      { id: "sensory_presence", phrase: "our story continues" },
      { id: "safe_personal_address", phrase: "she said" },
    ];

    for (const { id, phrase } of storyAllowedCases) {
      const taintedContent: GeneratedScene[] = cleanContent.map((scene, i) =>
        i === 0 ? { ...scene, text: `${scene.text}\n${phrase}` } : scene
      );
      const taintedResult = evaluateNarrative({
        generatedContent: taintedContent,
        storyBlueprint,
        scenes,
        guidance,
        context,
        intent: classicAsmrStoryIntent,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      checkTrue(
        `story mode: ${id} no longer fails once generated text contains "${phrase}"`,
        taintedResult.criteriaResults.find((c) => c.criterionId === id)?.passed === true
      );
    }

    // calming_repetition is structural (planned scenes, not text): story
    // mode's "Persona framing" stage is the repetition-equivalent stage and
    // "Narrative sensory movement" is the gentle-variation stage -- dropping
    // the movement stage should still fail the criterion, proving the check
    // still enforces the pairing rather than passing unconditionally.
    const scenesWithoutMovement = scenes.filter((s) => !/narrative sensory movement/i.test(s.narrativeFunction));
    checkTrue(
      "classic-asmr story planning includes a Narrative sensory movement scene to remove for this test",
      scenesWithoutMovement.length < scenes.length
    );
    const noMovementResult = evaluateNarrative({
      generatedContent: cleanContent,
      storyBlueprint,
      scenes: scenesWithoutMovement,
      guidance,
      context,
      intent: classicAsmrStoryIntent,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    checkTrue(
      "story mode: calming_repetition fails once the planned scenes have no gentle-variation-equivalent stage",
      noMovementResult.criteriaResults.find((c) => c.criterionId === "calming_repetition")?.passed === false
    );
  }

  // 3. story mode still fails: forced outcome claims, trigger sound
  // generation, dramatic escalation -- these safety/identity constraints
  // are not relaxed by asmrMode.
  {
    const context = contextFor(classicAsmrStoryIntent);
    const storyBlueprint = blueprintFor(classicAsmrStoryIntent);
    const scenes = scenesFor(classicAsmrStoryIntent);
    const guidance = guidanceFor(classicAsmrStoryIntent);
    const cleanContent = storyFor(classicAsmrStoryIntent);

    const storyStillFailsCases: Array<{ id: string; phrase: string }> = [
      { id: "no_forced_response", phrase: "you will feel tingles" },
      { id: "sensory_presence", phrase: "tapping sound" },
      { id: "gentle_rhythm", phrase: "building to a climax" },
    ];

    for (const { id, phrase } of storyStillFailsCases) {
      const taintedContent: GeneratedScene[] = cleanContent.map((scene, i) =>
        i === 0 ? { ...scene, text: `${scene.text}\n${phrase}` } : scene
      );
      const taintedResult = evaluateNarrative({
        generatedContent: taintedContent,
        storyBlueprint,
        scenes,
        guidance,
        context,
        intent: classicAsmrStoryIntent,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      checkTrue(
        `story mode: ${id} still fails once generated text contains "${phrase}"`,
        taintedResult.criteriaResults.find((c) => c.criterionId === id)?.passed === false
      );
    }
  }

  // 4. non-ASMR presets unchanged -- asmrMode is only meaningful for
  // classic-asmr, and none of these presets set it.
  {
    const otherIntents = [narrativeArcIntent, sleepStoryIntent, meditationIntent, kidsStoryIntent];
    checkTrue("non-ASMR preset intents leave asmrMode unset", otherIntents.every((intent) => intent.asmrMode === undefined));
    checkTrue(
      "non-ASMR presets never receive any of the six classic-asmr-only criteria",
      otherIntents.every((intent) => !getApplicableCriteria(intent.preset).some((c) => asmrOnlyIds.includes(c.id)))
    );
    checkTrue(
      "non-ASMR presets' clean evaluations are unaffected by the asmrMode calibration",
      otherIntents.every((intent) => {
        const result = evaluationFor(intent);
        return result.criteriaResults.length === getApplicableCriteria(intent.preset).length;
      })
    );
  }

  // No provider/rewrite calls were introduced by this calibration either.
  const evaluationDir = path.join(process.cwd(), "lib/creative-intelligence/evaluation");
  const offending: string[] = [];
  for (const file of fs.readdirSync(evaluationDir).filter((f) => /\.ts$/.test(f))) {
    const content = fs.readFileSync(path.join(evaluationDir, file), "utf8");
    if (/\bopenai\./i.test(content) || /\belevenlabs\./i.test(content) || /\brewrite\w*\s*\(/i.test(content) || /\bwriteScene\s*\(/.test(content)) {
      offending.push(file);
    }
  }
  check("no provider or rewrite calls were introduced alongside the story-mode calibration", offending, []);
}

// ─── 15. Existing Creative Intelligence tests stay green ────────────────
// (Run separately: each scripts/test-creative-intelligence-*.ts still
// passes after this layer was added -- see verification report.)

// ─── 18. Sleep Story Evaluation Calibration (RP-011C.8.10H) ─────────────
// Before this calibration, sleep-story's only preset-scoped criterion
// (sleep_atmosphere_and_safety) could not detect urgency/danger escalation,
// a broken sleep-transition curve, twist/moral endings, or conflict-driven
// companions -- see criteria.ts's RP-011C.8.10H header comment. This adds
// four criteria grounded in knowledge/sleep-story/* and extends
// sleep_atmosphere_and_safety rather than duplicating it.

{
  const sleepStoryOnlyIds = [
    "sleep_atmosphere_and_safety",
    "movement_without_urgency",
    "sleep_transition_arc",
    "peaceful_non_demanding_endings",
    "companions_as_warmth",
  ];

  // 1. Sleep Story receives intended criteria (global + all five).
  check(
    "sleep-story gets exactly the 7 global criteria plus its five preset-scoped criteria",
    getApplicableCriteria("sleep-story").map((c) => c.id).sort(),
    [...EVALUATION_CRITERIA.filter((c) => c.appliesTo.scope === "global").map((c) => c.id), ...sleepStoryOnlyIds].sort()
  );

  // 2. Narrative criteria are not incorrectly required -- no plot-driven
  // machinery (character arcs, transformation, conflict-driven change)
  // leaks in as a sleep-story-scoped criterion.
  checkTrue(
    "no preset other than sleep-story gets any of the four new sleep-story criteria",
    allIntents
      .filter((intent) => intent.preset !== "sleep-story")
      .every((intent) =>
        !getApplicableCriteria(intent.preset).some((c) =>
          ["movement_without_urgency", "sleep_transition_arc", "peaceful_non_demanding_endings", "companions_as_warmth"].includes(c.id)
        )
      )
  );

  // 3. Meditation/ASMR boundaries remain intact -- sleep-story never
  // receives guided_clarity (meditation) or sensory_presence (classic-asmr).
  checkTrue(
    "sleep-story does not get meditation or classic-asmr-specific criteria",
    !getApplicableCriteria("sleep-story").some((c) =>
      ["guided_clarity", "guidance_clarity", "attention_progression", "sensory_presence", "gentle_rhythm", "sensory_quality"].includes(c.id)
    )
  );

  // Grounding: each new/extended criterion points at its sleep-story
  // knowledge module.
  check(
    "movement_without_urgency is grounded in the movement_without_urgency knowledge module",
    EVALUATION_CRITERIA.find((c) => c.id === "movement_without_urgency")?.relatedKnowledgeModuleId,
    "movement_without_urgency"
  );
  check(
    "sleep_transition_arc is grounded in the sleep_transition_arc knowledge module",
    EVALUATION_CRITERIA.find((c) => c.id === "sleep_transition_arc")?.relatedKnowledgeModuleId,
    "sleep_transition_arc"
  );
  check(
    "peaceful_non_demanding_endings is grounded in the peaceful_non_demanding_endings knowledge module",
    EVALUATION_CRITERIA.find((c) => c.id === "peaceful_non_demanding_endings")?.relatedKnowledgeModuleId,
    "peaceful_non_demanding_endings"
  );
  check(
    "companions_as_warmth is grounded in the companions_as_warmth knowledge module",
    EVALUATION_CRITERIA.find((c) => c.id === "companions_as_warmth")?.relatedKnowledgeModuleId,
    "companions_as_warmth"
  );
  check(
    "sleep_atmosphere_and_safety is re-grounded in comfort_baseline_and_belonging",
    EVALUATION_CRITERIA.find((c) => c.id === "sleep_atmosphere_and_safety")?.relatedKnowledgeModuleId,
    "comfort_baseline_and_belonging"
  );
  check(
    "sleep_atmosphere_and_safety severity is raised to violation",
    EVALUATION_CRITERIA.find((c) => c.id === "sleep_atmosphere_and_safety")?.severity,
    "violation"
  );

  // 4. Positive Sleep Story examples pass -- clean deterministic
  // placeholder text for a well-formed sleep-story intent passes every
  // one of the five criteria (no false positives from the sleep-story
  // guidance/scene-template wording itself, which already names
  // "conflict", "dependency", and "narrative tension" only to rule them
  // out -- see evaluator.ts's phrase-list comment).
  const cleanResult = evaluationFor(sleepStoryIntent);
  checkTrue(
    "sleep-story: clean deterministic placeholder text passes every sleep-story-scoped criterion",
    sleepStoryOnlyIds.every((id) => cleanResult.criteriaResults.find((c) => c.criterionId === id)?.passed === true)
  );

  // 5. Narrative escalation examples fail -- inject a phrase each check's
  // phrase list should catch, and confirm the corresponding criterion
  // reacts to it.
  const context = contextFor(sleepStoryIntent);
  const storyBlueprint = blueprintFor(sleepStoryIntent);
  const scenes = scenesFor(sleepStoryIntent);
  const guidance = guidanceFor(sleepStoryIntent);
  const cleanContent = storyFor(sleepStoryIntent);
  const orderedScenes = scenes.slice().sort((a, b) => a.order - b.order);
  const lastSceneId = orderedScenes[orderedScenes.length - 1].id;

  function withTaint(phrase: string, targetSceneId?: string): GeneratedScene[] {
    return cleanContent.map((scene) =>
      scene.sceneId === (targetSceneId ?? cleanContent[0].sceneId) ? { ...scene, text: `${scene.text}\n${phrase}` } : scene
    );
  }

  function evaluateWith(generatedContent: GeneratedScene[], sceneBlueprints: SceneBlueprint[] = scenes): EvaluationResult {
    return evaluateNarrative({
      generatedContent,
      storyBlueprint,
      scenes: sceneBlueprints,
      guidance,
      context,
      intent: sleepStoryIntent,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  }

  const wholeTextTaintCases: Array<{ id: string; phrase: string }> = [
    { id: "movement_without_urgency", phrase: "chased by" },
    { id: "sleep_atmosphere_and_safety", phrase: "burst into tears" },
    { id: "companions_as_warmth", phrase: "needed to be rescued" },
  ];

  for (const { id, phrase } of wholeTextTaintCases) {
    const taintedResult = evaluateWith(withTaint(phrase));
    checkTrue(
      `${id} fails once generated text contains "${phrase}"`,
      taintedResult.criteriaResults.find((c) => c.criterionId === id)?.passed === false
    );
  }

  const endingTaintCases: Array<{ id: string; phrase: string }> = [
    { id: "sleep_transition_arc", phrase: "suddenly appeared" },
    { id: "peaceful_non_demanding_endings", phrase: "little did they know" },
  ];

  for (const { id, phrase } of endingTaintCases) {
    const taintedResult = evaluateWith(withTaint(phrase, lastSceneId));
    checkTrue(
      `${id} fails once the final scene's text contains "${phrase}"`,
      taintedResult.criteriaResults.find((c) => c.criterionId === id)?.passed === false
    );
  }

  // Tainting a non-final scene with an ending-only phrase must not trip
  // the ending-focused criteria -- they read the final scene specifically,
  // not the whole session.
  const firstSceneId = orderedScenes[0].id;
  const nonFinalTaintResult = evaluateWith(withTaint("suddenly appeared", firstSceneId));
  checkTrue(
    "sleep_transition_arc does not fail when late-novelty phrasing appears in a non-final scene",
    nonFinalTaintResult.criteriaResults.find((c) => c.criterionId === "sleep_transition_arc")?.passed === true
  );

  // Structural case: sleep_transition_arc fails when the final planned
  // scene is not a settling/rest stage.
  const scenesWithoutFinalRest = scenes.filter((s) => !/gradual rest/i.test(s.narrativeFunction));
  checkTrue(
    "sleep-story planning includes a Gradual rest scene to remove for this test",
    scenesWithoutFinalRest.length < scenes.length
  );
  const noRestResult = evaluateWith(cleanContent, scenesWithoutFinalRest);
  checkTrue(
    "sleep_transition_arc fails once the final planned scene is not a settling/rest stage",
    noRestResult.criteriaResults.find((c) => c.criterionId === "sleep_transition_arc")?.passed === false
  );

  // 6. Other presets remain unchanged -- meditation, classic-asmr,
  // narrative, and kids-story evaluations are unaffected by this
  // calibration.
  checkTrue(
    "meditation, classic-asmr, narrative, and kids-story evaluations are unaffected by the sleep-story calibration",
    [meditationIntent, classicAsmrIntent, narrativeArcIntent, kidsStoryIntent].every((intent) => {
      const result = evaluationFor(intent);
      return result.criteriaResults.length === getApplicableCriteria(intent.preset).length;
    })
  );

  // Global criteria untouched by this calibration.
  check(
    "ending_quality criterion is unchanged",
    EVALUATION_CRITERIA.find((c) => c.id === "ending_quality")?.suggestion,
    "Check whether the ending pays off the story's own setup instead of stating a moral directly."
  );

  // No provider/rewrite calls were introduced by this calibration either.
  const evaluationDirSleep = path.join(process.cwd(), "lib/creative-intelligence/evaluation");
  const offendingSleep: string[] = [];
  for (const file of fs.readdirSync(evaluationDirSleep).filter((f) => /\.ts$/.test(f))) {
    const content = fs.readFileSync(path.join(evaluationDirSleep, file), "utf8");
    if (/\bopenai\./i.test(content) || /\belevenlabs\./i.test(content) || /\brewrite\w*\s*\(/i.test(content) || /\bwriteScene\s*\(/.test(content)) {
      offendingSleep.push(file);
    }
  }
  check("no provider or rewrite calls were introduced alongside the sleep-story calibration", offendingSleep, []);
}

// ─── 19. Sleep Story Ending & Closure Calibration (RP-011C.8.10S) ───────
// The ending defect: ambiguous "trailing off" language let the Writer
// interpret quiet closure as literal unfinished text -- a literal ellipsis
// or an incomplete final sentence -- instead of emotional settling. This
// calibration removes the ambiguous language from the knowledge module and
// the two sleep-story scene templates' final step, and teaches
// peaceful_non_demanding_endings to detect a literal ellipsis or an
// unfinished final sentence in the final scene only.

{
  // Knowledge calibration: the module no longer uses ambiguous "trail off"
  // language, and explicitly requires a complete, properly-punctuated
  // closing sentence with no literal ellipsis.
  const endingModule = registry.getAll().find((m) => m.id === "peaceful_non_demanding_endings");
  const endingModuleText = endingModule
    ? [
        endingModule.purpose,
        ...endingModule.knowledge,
        ...(endingModule.antiPatterns ?? []),
        ...(endingModule.evaluationCriteria ?? []),
      ]
    : [];

  checkTrue(
    "peaceful_non_demanding_endings knowledge module no longer uses ambiguous 'trail off'/'trailing off' language",
    endingModule !== undefined && !endingModuleText.some((line) => /trail(ing)? off/i.test(line))
  );
  checkTrue(
    "peaceful_non_demanding_endings knowledge module explicitly requires a complete sentence with normal terminal punctuation",
    endingModuleText.some((line) => /complete sentence/i.test(line)) &&
      endingModuleText.some((line) => /terminal punctuation/i.test(line))
  );
  checkTrue(
    "peaceful_non_demanding_endings knowledge module explicitly rules out a literal ellipsis as the closing device",
    endingModuleText.some((line) => line.includes("..."))
  );

  // Scene template calibration: the final "Gradual rest" step of both
  // sleep-story scene templates no longer describes the ending as
  // "trailing off", and instead names a concrete, settled close.
  const blueprint = blueprintFor(sleepStoryIntent);
  const finalSteps: Array<[string, (typeof SLEEP_STORY_SCENE_STEPS)[number]]> = [
    ["SLEEP_STORY_SCENE_STEPS", SLEEP_STORY_SCENE_STEPS[SLEEP_STORY_SCENE_STEPS.length - 1]],
    [
      "SLEEP_STORY_EXPLICIT_SCENARIO_SCENE_STEPS",
      SLEEP_STORY_EXPLICIT_SCENARIO_SCENE_STEPS[SLEEP_STORY_EXPLICIT_SCENARIO_SCENE_STEPS.length - 1],
    ],
  ];
  for (const [label, step] of finalSteps) {
    const fields = [step.purpose(blueprint), step.desiredChange(blueprint), step.settingGuidance(blueprint)];
    checkTrue(
      `${label}'s final scene step no longer uses ambiguous 'trailing off' wording`,
      !fields.some((f) => /trail(ing)? off/i.test(f))
    );
    checkTrue(
      `${label}'s final scene step names a concrete, settled close`,
      fields.some((f) => /concrete, settled/i.test(f))
    );
    checkTrue(
      `${label}'s final scene step remains the "Gradual rest" step (no new ending type/stage introduced)`,
      step.narrativeFunction === "Gradual rest" && step.relatedStoryProgression(blueprint) === "gradual rest"
    );
  }

  // Evaluation calibration: peaceful_non_demanding_endings detects a
  // literal ellipsis or an unfinished final sentence in the final scene.
  const context = contextFor(sleepStoryIntent);
  const storyBlueprint = blueprint;
  const scenes = scenesFor(sleepStoryIntent);
  const guidance = guidanceFor(sleepStoryIntent);
  const cleanContent = storyFor(sleepStoryIntent);
  const orderedScenes = scenes.slice().sort((a, b) => a.order - b.order);
  const lastSceneId = orderedScenes[orderedScenes.length - 1].id;
  const firstSceneId = orderedScenes[0].id;

  function withEnding(text: string, targetSceneId: string = lastSceneId): GeneratedScene[] {
    return cleanContent.map((scene) =>
      scene.sceneId === targetSceneId ? { ...scene, text: `${scene.text}\n${text}` } : scene
    );
  }

  function evaluateWith(generatedContent: GeneratedScene[]): EvaluationResult {
    return evaluateNarrative({
      generatedContent,
      storyBlueprint,
      scenes,
      guidance,
      context,
      intent: sleepStoryIntent,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  }

  function endingCriterion(generatedContent: GeneratedScene[]) {
    return evaluateWith(generatedContent).criteriaResults.find((c) => c.criterionId === "peaceful_non_demanding_endings");
  }

  // Good: a complete, quiet closing image with normal terminal punctuation.
  checkTrue(
    "peaceful_non_demanding_endings: a complete closing image with normal punctuation passes",
    endingCriterion(withEnding("The lantern's glow fades and the room settles into stillness."))?.passed === true
  );
  checkTrue(
    "peaceful_non_demanding_endings: a plain complete sentence ending in a period passes",
    endingCriterion(withEnding("Sleep gathers softly around the quiet room."))?.passed === true
  );

  // Bad: a literal ASCII ellipsis as the closing device fails.
  const asciiEllipsisResult = endingCriterion(withEnding("The room grows quiet and the story drifts away..."));
  checkTrue(
    "peaceful_non_demanding_endings: a final sentence ending with a literal '...' fails",
    asciiEllipsisResult?.passed === false
  );
  checkTrue(
    "peaceful_non_demanding_endings: literal-ellipsis failure explanation names the ellipsis",
    !!asciiEllipsisResult && /literal ellipsis/i.test(asciiEllipsisResult.explanation)
  );

  // Bad: a literal unicode ellipsis character as the closing device fails.
  checkTrue(
    "peaceful_non_demanding_endings: a final sentence ending with a literal unicode ellipsis '…' fails",
    endingCriterion(withEnding("The room grows quiet and the story drifts away…"))?.passed === false
  );

  // Bad: an unfinished final sentence without terminal punctuation fails.
  const incompleteResult = endingCriterion(withEnding("and the fire burns low as the room grows quiet"));
  checkTrue(
    "peaceful_non_demanding_endings: an unfinished final sentence without terminal punctuation fails",
    incompleteResult?.passed === false
  );
  checkTrue(
    "peaceful_non_demanding_endings: unfinished-sentence failure explanation names the unfinished sentence",
    !!incompleteResult && /unfinished sentence/i.test(incompleteResult.explanation)
  );

  // Bad: a cliffhanger-like closure left open rather than resolved fails.
  checkTrue(
    "peaceful_non_demanding_endings: a cliffhanger-like unresolved closure fails",
    endingCriterion(withEnding("and just as her eyes began to close, something stirred"))?.passed === false
  );

  // Do not flag: an ellipsis used earlier in the story (a non-final scene)
  // never trips the check, which only reads the final scene.
  checkTrue(
    "peaceful_non_demanding_endings: an ellipsis used earlier in the story does not fail the criterion",
    endingCriterion(withEnding("She paused for a moment...", firstSceneId))?.passed === true
  );

  // Do not flag: a normal mid-text pause inside the final scene is fine as
  // long as the final scene's own last sentence is complete.
  checkTrue(
    "peaceful_non_demanding_endings: a mid-text pause inside the final scene does not fail when the final sentence is complete",
    endingCriterion(withEnding("She paused... and let the quiet settle around her."))?.passed === true
  );

  // Regression: narrative, meditation, classic-asmr, and kids-story clean
  // placeholder text still pass every applicable criterion -- this
  // calibration only touches sleep-story's knowledge/scene-template/
  // evaluation wiring (peaceful_non_demanding_endings is sleep-story-scoped
  // only) and the shared Writer Layer's placeholder punctuation, which is a
  // purely additive fix (a trailing period) that no other preset's checks
  // depend on the absence of.
  checkTrue(
    "narrative, meditation, classic-asmr, and kids-story clean placeholder text is unaffected by the sleep-story ending calibration",
    [narrativeArcIntent, meditationIntent, classicAsmrIntent, kidsStoryIntent].every((intent) =>
      evaluationFor(intent).criteriaResults.every((c) => c.passed)
    )
  );
}

// ─── Summary ─────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
