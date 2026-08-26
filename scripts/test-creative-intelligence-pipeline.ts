// scripts/test-creative-intelligence-pipeline.ts
//
// RP-011C.8.4 — Isolated tests for the Creative Intelligence Orchestration
// Layer (lib/creative-intelligence/orchestration/**). Nothing here touches
// the active generation pipeline, calls a provider, or hits the database.
//
// Run with:  npx tsx scripts/test-creative-intelligence-pipeline.ts

import fs from "node:fs";
import path from "node:path";
import { runCreativePipeline } from "../lib/creative-intelligence/orchestration";
import type { CreativePipelineRequest } from "../lib/creative-intelligence/orchestration";
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

function run(request: CreativePipelineRequest) {
  return runCreativePipeline(request, { createdAt: FIXED_CREATED_AT });
}

const narrativeRequest: CreativePipelineRequest = {
  prompt:
    "A young man leaves his childhood bedroom and builds a small business while struggling with confidence.",
  preset: "narrative",
  durationMinutes: 45,
};

const sleepStoryRequest: CreativePipelineRequest = {
  prompt: "A relaxing bedtime story to help me fall asleep by the sea.",
  preset: "sleep-story",
  durationMinutes: 30,
};

const kidsStoryRequest: CreativePipelineRequest = {
  prompt: "A gentle story for kids about a rabbit who makes a new friend.",
  preset: "kids-story",
  durationMinutes: 8,
};

async function main() {
  // ─── 1. Full pipeline executes ────────────────────────────────────────

  {
    let result: Awaited<ReturnType<typeof run>> | undefined;
    let threw = false;
    try {
      result = await run(narrativeRequest);
    } catch {
      threw = true;
    }
    checkTrue("runCreativePipeline() executes without throwing", !threw);
    checkTrue("runCreativePipeline() returns a value", result !== undefined && result !== null);
  }

  // ─── 2. Every stage returns data ──────────────────────────────────────

  {
    const result = await run(narrativeRequest);
    checkTrue("intent stage received data", result.intent !== undefined && result.intent.preset === "narrative");
    checkTrue("context stage received data", result.context !== undefined && result.context.intent === result.intent);
    checkTrue(
      "storyBlueprint stage received data",
      result.storyBlueprint !== undefined && result.storyBlueprint.intent === result.intent
    );
    checkTrue("scenes stage received data", Array.isArray(result.scenes) && result.scenes.length > 0);
    checkTrue(
      "guidance stage received data (one entry per scene)",
      result.guidance.length === result.scenes.length &&
        result.guidance.every((g) => result.scenes.some((s) => s.id === g.sceneId))
    );
    checkTrue(
      "writer stage received data (one GeneratedScene per scene)",
      result.generatedScenes.length === result.scenes.length &&
        result.generatedScenes.every((g) => result.scenes.some((s) => s.id === g.sceneId))
    );
    checkTrue(
      "evaluation stage received data (criteria match the intent's preset)",
      result.evaluation.criteriaResults.length === getApplicableCriteria(result.intent.preset).length
    );
  }

  // ─── 3. Output contains all expected stages ───────────────────────────

  {
    const result = await run(narrativeRequest);
    const expectedKeys = [
      "request",
      "intent",
      "context",
      "storyBlueprint",
      "scenes",
      "guidance",
      "generatedScenes",
      "evaluation",
      "metadata",
    ];
    checkTrue("pipeline result contains every expected stage key", expectedKeys.every((key) => key in result));
    check("pipeline result echoes back the exact request it was given", result.request, narrativeRequest);
  }

  // ─── 4. Narrative preset works ─────────────────────────────────────────

  {
    const result = await run(narrativeRequest);
    check("narrative preset resolves as narrative", result.intent.preset, "narrative");
    checkTrue("narrative preset produces at least one scene", result.scenes.length > 0);
  }

  // ─── 5. Sleep Story preset works ───────────────────────────────────────

  {
    const result = await run(sleepStoryRequest);
    check("sleep-story preset resolves as sleep-story", result.intent.preset, "sleep-story");
    checkTrue("sleep-story preset produces at least one scene", result.scenes.length > 0);
    checkTrue(
      "sleep-story preset gets sleep_atmosphere_and_safety in its evaluation criteria",
      result.evaluation.criteriaResults.some((c) => c.criterionId === "sleep_atmosphere_and_safety")
    );
  }

  // ─── 6. Kids Story preset works ────────────────────────────────────────

  {
    const result = await run(kidsStoryRequest);
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

  // ─── 7. No imports from active production pipeline ─────────────────────

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

    const orchestrationDir = path.join(process.cwd(), "lib/creative-intelligence/orchestration");
    const orchestrationFiles = fs
      .readdirSync(orchestrationDir)
      .filter((f) => /\.ts$/.test(f))
      .map((f) => path.join(orchestrationDir, f));

    const offending: string[] = [];
    for (const file of orchestrationFiles) {
      const codeOnly = fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
      for (const forbidden of forbiddenPipelinePaths) {
        if (codeOnly.includes(forbidden)) offending.push(`${path.relative(process.cwd(), file)} -> ${forbidden}`);
      }
    }
    check("no orchestration/ file references an active pipeline path", offending, []);

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
    check(
      "no existing pipeline file imports lib/creative-intelligence (orchestration stays unwired)",
      offendingPipelineFiles,
      []
    );
  }

  // ─── 8. No OpenAI/ElevenLabs/provider calls ─────────────────────────────

  {
    const orchestrationDir = path.join(process.cwd(), "lib/creative-intelligence/orchestration");
    const offending: string[] = [];
    for (const file of fs.readdirSync(orchestrationDir).filter((f) => /\.ts$/.test(f))) {
      const content = fs.readFileSync(path.join(orchestrationDir, file), "utf8");
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
    check("no orchestration/ file imports a provider SDK, calls a provider, or touches the database", offending, []);
  }

  // ─── 9. No mutation of source objects ────────────────────────────────────

  {
    const requestSnapshot = JSON.stringify(narrativeRequest);
    const result = await run(narrativeRequest);
    check(
      "runCreativePipeline does not mutate the request it is given",
      JSON.stringify(narrativeRequest),
      requestSnapshot
    );

    const secondResult = await run(narrativeRequest);
    check(
      "running the pipeline twice with the same request yields an equivalent intent (no cross-run shared mutable state)",
      JSON.stringify(secondResult.intent),
      JSON.stringify(result.intent)
    );
    check(
      "running the pipeline twice with the same request yields an equivalent storyBlueprint",
      JSON.stringify(secondResult.storyBlueprint),
      JSON.stringify(result.storyBlueprint)
    );
  }

  // ─── Summary ─────────────────────────────────────────────────────────

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
