// scripts/test-creative-intelligence-language-preferences.ts
//
// RP-011C.7D.1 — Phase 0 structural additions: CreativePipelineRequest gained
// `language` and `preferenceContext`, threaded onto CreativeIntent
// (orchestration/pipeline.ts applyRequestExtras()) and surfaced by the Writer
// Layer's prompt builder (writer/prompts.ts). This verifies the plumbing
// end-to-end using writerMode:"mock" (no OpenAI call) -- the mock writer
// never calls buildWriterPrompt, so this reads the REAL context/blueprint/
// scenes/guidance a "provider" run would use straight off the mock run's
// result, and feeds them into buildWriterSystemPrompt/buildWriterUserPrompt
// directly.
//
// Run with:  npx tsx scripts/test-creative-intelligence-language-preferences.ts

import { runCreativePipeline } from "../lib/creative-intelligence/orchestration";
import { buildWriterSystemPrompt, buildWriterUserPrompt } from "../lib/creative-intelligence";

let passed = 0;
let failed = 0;

function checkTrue(name: string, condition: boolean): void {
  if (condition) {
    console.log(`[PASS] ${name}`);
    passed++;
  } else {
    console.log(`[FAIL] ${name}`);
    failed++;
  }
}

const FIXED_CREATED_AT = "2026-01-01T00:00:00.000Z";

async function main() {
  // ─── language threads onto CreativeIntent and the Writer system prompt ──
  {
    const result = await runCreativePipeline(
      { prompt: "A calm walk by the sea.", preset: "sleep-story", language: "de" },
      { createdAt: FIXED_CREATED_AT }
    );
    checkTrue("intent.language carries the request's language", result.intent.language === "de");

    const systemPrompt = buildWriterSystemPrompt(result.intent);
    checkTrue(
      "Writer system prompt states German output language",
      /Output language: German/.test(systemPrompt)
    );
  }

  {
    const result = await runCreativePipeline(
      { prompt: "A calm walk by the sea.", preset: "sleep-story", language: "en" },
      { createdAt: FIXED_CREATED_AT }
    );
    const systemPrompt = buildWriterSystemPrompt(result.intent);
    checkTrue(
      "Writer system prompt states English output language",
      /Output language: English/.test(systemPrompt)
    );
  }

  {
    const result = await runCreativePipeline(
      { prompt: "A calm walk by the sea.", preset: "meditation" },
      { createdAt: FIXED_CREATED_AT }
    );
    const systemPrompt = buildWriterSystemPrompt(result.intent);
    checkTrue(
      "No language line when the request specifies none",
      !/Output language:/.test(systemPrompt)
    );
  }

  // ─── preferenceContext threads onto CreativeIntent and the Writer user prompt ──
  {
    const PREF_BLOCK = [
      "USER PREFERENCE CONTEXT (secondary; never overrides the user prompt above):",
      "- **Bevorzugter Ton:** ruhig",
      "Use this only as soft style guidance. Never mention the preferences directly.",
    ].join("\n");

    const result = await runCreativePipeline(
      {
        prompt: "A calm walk by the sea.",
        preset: "sleep-story",
        preferenceContext: PREF_BLOCK,
      },
      { createdAt: FIXED_CREATED_AT }
    );
    checkTrue(
      "intent.preferenceContext carries the request's block",
      result.intent.preferenceContext === PREF_BLOCK
    );

    const userPrompt = buildWriterUserPrompt({
      scene: result.scenes[0],
      guidance: result.guidance[0],
      blueprint: result.storyBlueprint,
      context: result.context,
      intent: result.intent,
    });
    checkTrue(
      "Writer user prompt includes the preferenceContext block verbatim",
      userPrompt.includes(PREF_BLOCK)
    );
  }

  // ─── preferenceContext is bypassed for kids-story, mirroring legacy ─────
  {
    const PREF_BLOCK = "USER PREFERENCE CONTEXT (secondary; never overrides the user prompt above):\n- test";

    const result = await runCreativePipeline(
      {
        prompt: "A gentle story for kids about a rabbit.",
        preset: "kids-story",
        preferenceContext: PREF_BLOCK,
      },
      { createdAt: FIXED_CREATED_AT }
    );

    const userPrompt = buildWriterUserPrompt({
      scene: result.scenes[0],
      guidance: result.guidance[0],
      blueprint: result.storyBlueprint,
      context: result.context,
      intent: result.intent,
    });
    checkTrue(
      "Writer user prompt bypasses preferenceContext for kids-story",
      !userPrompt.includes(PREF_BLOCK)
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
