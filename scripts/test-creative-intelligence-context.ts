// scripts/test-creative-intelligence-context.ts
//
// RP-011C.7.21 — Isolated tests for the Creative Intelligence Context
// Builder (lib/creative-intelligence/context/**). Nothing here touches the
// active generation pipeline, calls a provider, or hits the database.
//
// Run with:  npx tsx scripts/test-creative-intelligence-context.ts

import fs from "node:fs";
import path from "node:path";
import {
  CreativeKnowledgeRegistry,
  initializeCreativeKnowledge,
  buildCreativeContext,
} from "../lib/creative-intelligence";
import type { CreativeIntent } from "../lib/creative-intelligence";

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

const narrativeIntent: CreativeIntent = {
  preset: "narrative",
  experience: "a slow-burn mystery that resolves gently",
  audience: "adult",
  durationMinutes: 20,
  constraints: [],
};

const sleepStoryIntent: CreativeIntent = {
  preset: "sleep-story",
  experience: "a slow, gentle wind-down",
  audience: "adult",
  durationMinutes: 30,
  constraints: [],
};

// ─── 1. Context can be created from basic input ────────────────────────

{
  const context = buildCreativeContext({
    rawInput: { prompt: "a lighthouse keeper waiting for a letter" },
    intent: narrativeIntent,
    registry,
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  checkTrue("context.input.prompt matches raw input", context.input.prompt === "a lighthouse keeper waiting for a letter");
  checkTrue("context.input.preset matches intent preset", context.input.preset === "narrative");
  check("context.input.durationSeconds derived from intent.durationMinutes", context.input.durationSeconds, 1200);
  check("context.intent is passed through unchanged", context.intent, narrativeIntent);
  check("context.metadata.createdAt uses the provided override", context.metadata.createdAt, "2026-01-01T00:00:00.000Z");
  checkTrue("context.metadata.version is a non-empty string", typeof context.metadata.version === "string" && context.metadata.version.length > 0);
}

// ─── 2. Global knowledge modules are included ──────────────────────────

{
  const context = buildCreativeContext({
    rawInput: { prompt: "test" },
    intent: narrativeIntent,
    registry,
  });

  checkTrue(
    "global module (trust_the_reader) is included for narrative",
    context.knowledge.modules.some((m) => m.id === "trust_the_reader")
  );
  checkTrue(
    "global module (avoid_ai_writing_patterns) is included for narrative",
    context.knowledge.modules.some((m) => m.id === "avoid_ai_writing_patterns")
  );
  checkTrue(
    "principles projection includes the same global module id",
    context.knowledge.principles.some((p) => p.id === "trust_the_reader")
  );
}

// ─── 3. Preset-specific modules included only when applicable ─────────

{
  const narrativeContext = buildCreativeContext({
    rawInput: { prompt: "test" },
    intent: narrativeIntent,
    registry,
  });
  const sleepStoryContext = buildCreativeContext({
    rawInput: { prompt: "test" },
    intent: sleepStoryIntent,
    registry,
  });

  checkTrue(
    "premise_fulfillment is included for narrative",
    narrativeContext.knowledge.modules.some((m) => m.id === "premise_fulfillment")
  );
  checkTrue(
    "premise_fulfillment is NOT included for sleep-story",
    !sleepStoryContext.knowledge.modules.some((m) => m.id === "premise_fulfillment")
  );

  // ─── 4. Different presets produce different contexts ────────────────

  checkTrue(
    "narrative and sleep-story module sets differ",
    JSON.stringify(narrativeContext.knowledge.modules.map((m) => m.id)) !==
      JSON.stringify(sleepStoryContext.knowledge.modules.map((m) => m.id))
  );
  checkTrue(
    "narrative planning guidance is non-empty",
    narrativeContext.guidance.planning.length > 0
  );
}

// ─── 5. Knowledge ordering remains priority based ──────────────────────

{
  const context = buildCreativeContext({
    rawInput: { prompt: "test" },
    intent: narrativeIntent,
    registry,
  });

  const rank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const order = context.knowledge.modules.map((m) => m.priority);
  let monotonic = true;
  for (let i = 1; i < order.length; i++) {
    if (rank[order[i]] < rank[order[i - 1]]) monotonic = false;
  }
  checkTrue("context.knowledge.modules is ordered CRITICAL -> HIGH -> MEDIUM -> LOW", monotonic);

  const principleOrder = context.knowledge.principles.map((p) => p.priority);
  let principlesMonotonic = true;
  for (let i = 1; i < principleOrder.length; i++) {
    if (principleOrder[i] < principleOrder[i - 1]) principlesMonotonic = false;
  }
  checkTrue(
    "context.knowledge.principles priority (lower = higher) is non-decreasing in the same order",
    principlesMonotonic
  );
}

// ─── 6. No imports from active generation pipeline exist ──────────────

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

  const contextDir = path.join(process.cwd(), "lib/creative-intelligence/context");
  const contextFiles = fs
    .readdirSync(contextDir)
    .filter((f) => /\.ts$/.test(f))
    .map((f) => path.join(contextDir, f));

  const offending: string[] = [];
  for (const file of contextFiles) {
    const content = fs.readFileSync(file, "utf8");
    for (const forbidden of forbiddenPipelinePaths) {
      if (content.includes(forbidden)) offending.push(`${path.relative(process.cwd(), file)} -> ${forbidden}`);
    }
  }
  check("no context/ file references a pipeline path", offending, []);

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
