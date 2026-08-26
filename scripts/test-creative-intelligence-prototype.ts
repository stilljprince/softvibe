// scripts/test-creative-intelligence-prototype.ts
//
// RP-011C.7.28 — Isolated tests for the Creative Intelligence End-to-End
// Prototype Layer (lib/creative-intelligence/prototype/**). Nothing here
// touches the active generation pipeline, calls a provider, or hits the
// database.
//
// Run with:  npx tsx scripts/test-creative-intelligence-prototype.ts

import fs from "node:fs";
import path from "node:path";
import { runCreativeIntelligencePrototype } from "../lib/creative-intelligence/prototype";
import type { CreativeIntelligencePrototypeInput } from "../lib/creative-intelligence/prototype";
import { getApplicableCriteria } from "../lib/creative-intelligence";

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

const FIXED_CREATED_AT = "2026-01-01T00:00:00.000Z";

function run(input: CreativeIntelligencePrototypeInput) {
  return runCreativeIntelligencePrototype(input, { createdAt: FIXED_CREATED_AT });
}

const narrativeInput: CreativeIntelligencePrototypeInput = {
  prompt:
    "A young man leaves his childhood bedroom and builds a small business while struggling with confidence.",
  preset: "narrative",
  durationMinutes: 45,
};

const sleepStoryInput: CreativeIntelligencePrototypeInput = {
  prompt: "A relaxing bedtime story to help me fall asleep by the sea.",
  preset: "sleep-story",
  durationMinutes: 30,
};

const kidsStoryInput: CreativeIntelligencePrototypeInput = {
  prompt: "A gentle story for kids about a rabbit who makes a new friend.",
  preset: "kids-story",
  durationMinutes: 8,
};

const classicAsmrInput: CreativeIntelligencePrototypeInput = {
  prompt: "A slow, sensory ASMR session with soft tapping sounds.",
  preset: "classic-asmr",
  durationMinutes: 15,
};

const meditationInput: CreativeIntelligencePrototypeInput = {
  prompt: "A guided meditation session for centering attention.",
  preset: "meditation",
  durationMinutes: 12,
};

// ─── 1. Full pipeline executes ──────────────────────────────────────────

{
  let result: ReturnType<typeof run> | undefined;
  let threw = false;
  try {
    result = run(narrativeInput);
  } catch {
    threw = true;
  }
  checkTrue("runCreativeIntelligencePrototype() executes without throwing", !threw);
  checkTrue("runCreativeIntelligencePrototype() returns a value", result !== undefined && result !== null);
}

// ─── 2. Every layer receives data ───────────────────────────────────────

{
  const result = run(narrativeInput);
  checkTrue("intent stage received data", result.intent !== undefined && result.intent.preset === "narrative");
  checkTrue("context stage received data", result.context !== undefined && result.context.intent === result.intent);
  checkTrue("storyBlueprint stage received data", result.storyBlueprint !== undefined && result.storyBlueprint.intent === result.intent);
  checkTrue("scenes stage received data", Array.isArray(result.scenes) && result.scenes.length > 0);
  checkTrue(
    "guidance stage received data (one entry per scene)",
    result.guidance.length === result.scenes.length &&
      result.guidance.every((g) => result.scenes.some((s) => s.id === g.sceneId))
  );
  checkTrue(
    "writer stage received data (one GeneratedScene per scene)",
    result.generatedOutput.length === result.scenes.length &&
      result.generatedOutput.every((g) => result.scenes.some((s) => s.id === g.sceneId))
  );
  checkTrue(
    "evaluation stage received data (criteria match the intent's preset)",
    result.evaluation.criteriaResults.length === getApplicableCriteria(result.intent.preset).length
  );
}

// ─── 3. Output contains all expected stages ─────────────────────────────

{
  const result = run(narrativeInput);
  const expectedKeys = [
    "input",
    "intent",
    "context",
    "storyBlueprint",
    "scenes",
    "guidance",
    "generatedOutput",
    "evaluation",
    "metadata",
  ];
  checkTrue(
    "prototype result contains every expected stage key",
    expectedKeys.every((key) => key in result)
  );
  check("prototype result echoes back the exact input it was given", result.input, narrativeInput);
}

// ─── 4. No prose generation happens outside the Writer Layer ───────────

{
  const result = run(narrativeInput);

  // Every non-writer-stage descriptive field stays a short structural
  // label/phrase (matching the contracts in core/types.ts, context/types.ts,
  // etc.) -- only writer.text is allowed to be long, multi-line content.
  const shortFields = [
    result.intent.experience,
    result.storyBlueprint.premise.centralQuestion,
    result.storyBlueprint.premise.coreConflict,
    result.storyBlueprint.protagonist.desire,
    ...result.scenes.map((s) => s.purpose),
    ...result.scenes.map((s) => s.narrativeFunction),
    ...result.guidance.map((g) => g.writingFocus),
    ...result.guidance.map((g) => g.narrativeIntent),
  ];
  checkTrue(
    "non-writer stages stay short structural labels (under 300 chars each)",
    shortFields.every((field) => field.length < 300)
  );

  // No long hand-written prose/story text baked into the coordinator source.
  const prototypeDir = path.join(process.cwd(), "lib/creative-intelligence/prototype");
  const longStringOffenders: string[] = [];
  for (const file of fs.readdirSync(prototypeDir).filter((f) => /\.ts$/.test(f))) {
    const content = fs.readFileSync(path.join(prototypeDir, file), "utf8");
    const codeOnly = content
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    for (const match of codeOnly.matchAll(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`/g)) {
      const literal = match[0].slice(1, -1);
      if (literal.length >= 200) longStringOffenders.push(`${file}: string literal of ${literal.length} chars`);
    }
  }
  check("no prototype/ source file contains a long hand-written string literal (mock story/prose text)", longStringOffenders, []);
}

// ─── 5. Writer output is still placeholder structural output ───────────

{
  const result = run(narrativeInput);
  checkTrue(
    "generatedOutput text is still the deterministic writer placeholder, not prose",
    result.generatedOutput.every(
      (scene) =>
        scene.text.includes("Scene generated from blueprint:") &&
        scene.text.includes("Writing focus:") &&
        scene.metadata.writerMethod === "deterministic-template"
    )
  );
}

// ─── 6. Evaluation receives Writer output ───────────────────────────────

{
  const result = run(narrativeInput);
  const premiseFulfillment = result.evaluation.criteriaResults.find((c) => c.criterionId === "premise_fulfillment");
  checkTrue(
    "evaluation's premise_fulfillment criterion reflects the actual writer output (every scene covered)",
    premiseFulfillment !== undefined && premiseFulfillment.passed === (result.generatedOutput.length === result.scenes.length)
  );
  checkTrue(
    "overallScore is a number between 0 and 1",
    typeof result.evaluation.overallScore === "number" &&
      result.evaluation.overallScore >= 0 &&
      result.evaluation.overallScore <= 1
  );
  check("evaluation metadata reports the deterministic-structural evaluator", result.evaluation.metadata.evaluatorMethod, "deterministic-structural");
}

// ─── 7. Narrative preset works ───────────────────────────────────────────

{
  const result = run(narrativeInput);
  check("narrative preset resolves as narrative", result.intent.preset, "narrative");
  checkTrue("narrative preset produces at least one scene", result.scenes.length > 0);
}

// ─── 8. Sleep Story preset works ─────────────────────────────────────────

{
  const result = run(sleepStoryInput);
  check("sleep-story preset resolves as sleep-story", result.intent.preset, "sleep-story");
  checkTrue("sleep-story preset produces at least one scene", result.scenes.length > 0);
  checkTrue(
    "sleep-story preset gets sleep_atmosphere_and_safety in its evaluation criteria",
    result.evaluation.criteriaResults.some((c) => c.criterionId === "sleep_atmosphere_and_safety")
  );
}

// ─── 9. Kids Story preset works ──────────────────────────────────────────

{
  const result = run(kidsStoryInput);
  check("kids-story preset resolves as kids-story", result.intent.preset, "kids-story");
  check("kids-story preset resolves to a child audience", result.intent.audience, "child");
  checkTrue(
    "kids-story preset carries an age-safety constraint",
    result.intent.constraints.some((c) => /age[- ]safe/i.test(c))
  );
  checkTrue(
    "kids-story preset gets age_appropriate_imagination in its evaluation criteria",
    result.evaluation.criteriaResults.some((c) => c.criterionId === "age_appropriate_imagination")
  );
}

// ─── 10. ASMR / Meditation do not incorrectly receive plot-driven planning ─

{
  const asmrResult = run(classicAsmrInput);
  const meditationResult = run(meditationInput);

  checkTrue(
    "classic-asmr gets no turning points (not plot-driven)",
    asmrResult.storyBlueprint.trajectory.turningPoints.length === 0
  );
  checkTrue(
    "meditation gets no turning points (not plot-driven)",
    meditationResult.storyBlueprint.trajectory.turningPoints.length === 0
  );
  checkTrue(
    "classic-asmr guidance does not use plot-driven character framing",
    asmrResult.guidance.every((g) => !g.characterGuidance.includes("not plot convenience"))
  );
  checkTrue(
    "meditation guidance does not use plot-driven character framing",
    meditationResult.guidance.every((g) => !g.characterGuidance.includes("not plot convenience"))
  );
}

// ─── 11. No imports from active production pipeline ──────────────────────

{
  const forbiddenPipelinePaths = [
    "app/api/jobs",
    "app/generate",
    "lib/narrative",
    "lib/story-supervisor.ts",
    "lib/script-builder.ts",
    "lib/script-builder-openai.ts",
    "lib/script-builder-narrative.ts",
    "lib/script-builder-narrative-story.ts",
    "lib/script-builder-narrative-quiet-knowledge.ts",
    "lib/tts",
    "lib/audio",
  ];

  const prototypeDir = path.join(process.cwd(), "lib/creative-intelligence/prototype");
  const prototypeFiles = fs
    .readdirSync(prototypeDir)
    .filter((f) => /\.ts$/.test(f))
    .map((f) => path.join(prototypeDir, f));

  const offending: string[] = [];
  for (const file of prototypeFiles) {
    const codeOnly = fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    for (const forbidden of forbiddenPipelinePaths) {
      if (codeOnly.includes(forbidden)) offending.push(`${path.relative(process.cwd(), file)} -> ${forbidden}`);
    }
  }
  check("no prototype/ file references an active pipeline path", offending, []);

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
  check("no existing pipeline file imports lib/creative-intelligence (prototype stays unwired)", offendingPipelineFiles, []);
}

// ─── 12. No OpenAI/ElevenLabs/provider calls ─────────────────────────────

{
  const prototypeDir = path.join(process.cwd(), "lib/creative-intelligence/prototype");
  const offending: string[] = [];
  for (const file of fs.readdirSync(prototypeDir).filter((f) => /\.ts$/.test(f))) {
    const content = fs.readFileSync(path.join(prototypeDir, file), "utf8");
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
  check("no prototype/ file imports a provider SDK, calls a provider, or touches the database", offending, []);
}

// ─── 13. No mutation of source objects ───────────────────────────────────

{
  const inputSnapshot = JSON.stringify(narrativeInput);
  const result = run(narrativeInput);
  check("runCreativeIntelligencePrototype does not mutate the input it is given", JSON.stringify(narrativeInput), inputSnapshot);

  const secondResult = run(narrativeInput);
  check(
    "running the prototype twice with the same input yields an equivalent intent (no cross-run shared mutable state)",
    JSON.stringify(secondResult.intent),
    JSON.stringify(result.intent)
  );
  check(
    "running the prototype twice with the same input yields an equivalent storyBlueprint",
    JSON.stringify(secondResult.storyBlueprint),
    JSON.stringify(result.storyBlueprint)
  );
}

// ─── Summary ─────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
