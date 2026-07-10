// lib/narrative/compression-writer.ts
//
// Compression Writer for long-form Narrative Story output.
//
// Replaces the legacy "compression" mode that previously lived inside
// editNarrativeLongform. The editor pass behaved as a minimal-diff editor
// and consistently reduced overlong drafts by only ~3–4% even when the
// merged text was ~1.35–1.40× its word target. Moving compression into a
// dedicated writer-framed pass — a literary novelist rewriting their own
// overlong draft into its natural final-length version — produces the
// larger structural cuts (scene combination, earlier landing, removal of
// duplicated emotional loops) that the editor framing could not reach.
//
// Compression sources, in order of preference:
//   • cross-segment redundancy
//   • combining scenes that share a function
//   • earlier landing once the story has resolved
//   • removing duplicated emotional loops
// Never summarization.
//
// Failure handling mirrors the legacy editor: any OpenAI failure, parse
// failure, truncation, or empty output falls back silently to the unedited
// merged text. The compression writer is never allowed to block a job.
//
// Telemetry: [COMPRESSION_WRITER] prefix on all log lines.

import OpenAI from "openai";

export type CompressWriteNarrativeInput = {
  mergedText: string;
  outputLanguage: "English" | "German";
  wordTarget: number;
  durationSec: number;
  openaiTimeoutMs?: number;
  model?: string;
};

export type CompressionPlan = {
  sceneInventory: string[];
  scenesToCombine: string[];
  scenesToShorten: string[];
  scenesToPreserve: string[];
  endingLandsAt: string;
};

export type CompressWriteNarrativeOutput = {
  finalText: string;
  plan: CompressionPlan | null;
  changesSummary: string[];
};

export async function compressWriteNarrative(
  input: CompressWriteNarrativeInput,
): Promise<CompressWriteNarrativeOutput> {
  const originalWords = input.mergedText.split(/\s+/).filter(Boolean).length;

  if (!process.env.OPENAI_API_KEY) {
    console.warn(
      `[COMPRESSION_WRITER] failed reason=missing_api_key preset=narrative using=unedited_text originalWords=${originalWords}`,
    );
    return {
      finalText: input.mergedText,
      plan: null,
      changesSummary: ["compression-writer-skipped: no api key"],
    };
  }

  const targetWords = Math.max(300, Math.round(input.wordTarget));
  const durationSec = Math.max(1, Math.round(input.durationSec));

  const model =
    input.model ??
    process.env.OPENAI_NARRATIVE_COMPRESSION_WRITER_MODEL ??
    process.env.OPENAI_NARRATIVE_EDITOR_MODEL ??
    process.env.OPENAI_EDITOR_MODEL ??
    "gpt-5.4-mini";

  const timeoutMs =
    typeof input.openaiTimeoutMs === "number" &&
    Number.isFinite(input.openaiTimeoutMs)
      ? input.openaiTimeoutMs
      : parseInt(
          process.env.OPENAI_NARRATIVE_COMPRESSION_WRITER_TIMEOUT_MS ??
            process.env.OPENAI_NARRATIVE_EDITOR_TIMEOUT_MS ??
            "240000",
          10,
        );

  // Output budget sized against the *rewritten* target plus headroom for
  // the plan object and JSON overhead. The rewritten text is the smaller
  // version of the draft, so anchoring on targetWords (not originalWords)
  // keeps the budget tight without risking truncation of the natural close.
  const maxTokens = Math.min(16000, targetWords * 3 + 1024);

  const targetMin = Math.max(300, Math.round(targetWords * 0.92));
  const targetMax = Math.max(targetMin, Math.round(targetWords * 1.02));
  const overshootRatio =
    targetWords > 0
      ? Math.round((originalWords / targetWords) * 100) / 100
      : 1;

  console.info(
    `[COMPRESSION_WRITER] phase=start preset=narrative model=${model} originalWords=${originalWords} targetWords=${targetWords} durationSec=${durationSec} overshootRatio=${overshootRatio} targetBand=${targetMin}-${targetMax}`,
  );

  const system = [
    `You are a literary novelist rewriting an overlong draft of your own story into its natural final-length version.`,
    `The draft below is yours. It is structurally sound but ran long during composition: scenes that serve the same function appear more than once, atmospheric beats double up across sections, emotional realizations are reached two or three times in slightly different language, and the close stretches past the moment the story has already resolved. Your job is to deliver the version of this story you would publish — the same story, told at its natural length, with the redundancy that accumulated during writing absorbed.`,
    ``,
    `━━━ STANCE ━━━`,
    ``,
    `Approach this as a rewrite, not as line-editing. You are not preserving the draft's surface — you are publishing the story it is trying to be. Confident literary novelists make structural cuts: they combine scenes that share a function, they let the story land when it has landed, and they trust the reader to hold a beat without restatement. Adopt that stance.`,
    ``,
    `The draft is your work. There is no other author to defer to. You may reshape paragraphs, fold scenes together, drop redundant micro-actions, and end earlier — whatever the published version requires.`,
    ``,
    `━━━ HOW COMPRESSION COMES ━━━`,
    ``,
    `Compression in this rewrite must come from:`,
    `  • cross-segment redundancy — adjacent or nearby passages performing the same narrative function`,
    `  • combining scenes that share a function — two arrival scenes, two reconciliation scenes, two reassurance exchanges become one stronger scene`,
    `  • earlier landing after resolution — when the primary story question has landed, conclude at the genuine final image and cut the afterglow paragraphs that only re-confirm the arrival`,
    `  • removing duplicated emotional loops — the same realization, the same theme, the same reveal interpretation reached more than once`,
    ``,
    `Compression must NEVER come from summarization. Do not narrate scenes that previously played in real time. Do not flatten lived moments into reported description. The rewritten text is still prose lived from inside the story — only shorter because the structural redundancies are gone.`,
    ``,
    `━━━ PRESERVE — non-negotiable ━━━`,
    `  • Literary quality and prose voice`,
    `  • Slow, calm pacing and TTS-friendly readability`,
    `  • The emotional arc and its turns`,
    `  • Atmosphere and sensory richness — keep the strongest sensory moments; consolidate parallel atmospheric beats`,
    `  • The genuine final image and any real callback`,
    `  • The causal chain — A leads to B leads to C must remain visible`,
    `  • Character logic, decisions, and the turns those decisions create`,
    `  • The original output language`,
    ``,
    `━━━ HARD CONSTRAINTS ━━━`,
    `  • Do NOT introduce new plot events, new characters, or new settings.`,
    `  • Do NOT change WHO does WHAT, WHEN, or WHY.`,
    `  • Do NOT summarize scenes that the draft played in real time.`,
    `  • Do NOT accelerate pacing or add drama.`,
    `  • Do NOT strip atmosphere — consolidate it, do not remove it.`,
    `  • Do NOT add markdown, headings, segment labels, or meta commentary.`,
    ``,
    `━━━ WORKFLOW ━━━`,
    ``,
    `Plan briefly, then write. The plan you return is for observability only — downstream consumers will use finalText. Make the plan accurate to what you actually do in finalText.`,
    `  1. sceneInventory — list the scenes in the current draft in order, one short label per scene.`,
    `  2. scenesToCombine — which scenes share a function and will be folded together.`,
    `  3. scenesToShorten — which scenes will keep their place but be trimmed of repeated atmosphere, duplicate reflection, or redundant micro-action.`,
    `  4. scenesToPreserve — which scenes are doing distinctive work and will land untouched at the structural level (sentence-level cleanup is fine).`,
    `  5. endingLandsAt — name the moment the rewritten story will close on. Pick the genuine final image; everything past it is afterglow.`,
    ``,
    `Then write the rewritten story as finalText.`,
    ``,
    `━━━ LENGTH ━━━`,
    ``,
    `Intended duration: ~${durationSec} seconds of spoken audio.`,
    `Intended word target: ~${targetWords} words. Land meaningfully inside ~${targetMin}–${targetMax} words.`,
    `The band reflects the pacing the listener expects. Reach it by removing accumulated redundancy — not by padding the floor, and not by stripping atmosphere, flattening pacing, or rushing the arc.`,
    ``,
    `Output language: ${input.outputLanguage}`,
    `Return ONLY valid JSON matching the schema below. finalText is continuous prose only — no markdown, no headings, no segment labels.`,
  ].join("\n");

  const user = [
    `Rewrite the following overlong draft of your own story into its natural final-length version.`,
    ``,
    `Current draft: ~${originalWords} words (~${overshootRatio}× the intended target of ~${targetWords} words for a ~${durationSec}-second spoken story).`,
    ``,
    `Plan briefly using sceneInventory / scenesToCombine / scenesToShorten / scenesToPreserve / endingLandsAt, then produce finalText as the rewritten story.`,
    `Treat the draft as your own work. Combine scenes that share a function, end at the genuine final image, and let strong beats land once.`,
    ``,
    `DRAFT:`,
    `---`,
    input.mergedText,
    `---`,
    ``,
    `Return JSON: {"plan": {...}, "finalText": "...", "changesSummary": [...]}.`,
    `changesSummary: name each structural decision in the rewrite. Be concrete and labeled.`,
    `  GOOD: "[scene-combine] folded the kitchen reconciliation into the porch scene — both deepened the same Mira/Jonas turn"`,
    `  GOOD: "[earlier-landing] ended at the lit window; removed four afterglow paragraphs"`,
    `  GOOD: "[emotional-loop] consolidated three variants of 'maybe I had run away' into one line"`,
    `  GOOD: "[atmosphere] merged three nearby descriptions of the snowed-in silence into one richer passage"`,
    `  GOOD: "[micro-action] reduced pour-the-tea / adjust-the-blanket beats from four to one stronger sensory moment"`,
    `  BAD: "shortened the story" / "improved flow" (too vague)`,
    `Max 12 items.`,
  ].join("\n");

  let resp;
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    resp = await openai.responses.create(
      {
        model,
        max_output_tokens: maxTokens,
        input: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "SoftVibeNarrativeCompressionWriterResult",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                plan: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    sceneInventory: {
                      type: "array",
                      items: { type: "string" },
                    },
                    scenesToCombine: {
                      type: "array",
                      items: { type: "string" },
                    },
                    scenesToShorten: {
                      type: "array",
                      items: { type: "string" },
                    },
                    scenesToPreserve: {
                      type: "array",
                      items: { type: "string" },
                    },
                    endingLandsAt: { type: "string" },
                  },
                  required: [
                    "sceneInventory",
                    "scenesToCombine",
                    "scenesToShorten",
                    "scenesToPreserve",
                    "endingLandsAt",
                  ],
                },
                finalText: { type: "string" },
                changesSummary: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: ["plan", "finalText", "changesSummary"],
            },
          },
        },
      },
      { timeout: timeoutMs },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[COMPRESSION_WRITER] failed reason=openai_call_failed:${msg.slice(0, 160)} preset=narrative using=unedited_text originalWords=${originalWords}`,
    );
    return {
      finalText: input.mergedText,
      plan: null,
      changesSummary: ["compression-writer-error: using unedited narrative"],
    };
  }

  const rawText = resp.output_text ?? "";
  const respStatus = resp.status ?? "unknown";

  if (respStatus === "incomplete") {
    console.warn(
      `[COMPRESSION_WRITER] failed reason=response_truncated length=${rawText.length} preset=narrative using=unedited_text originalWords=${originalWords}`,
    );
    return {
      finalText: input.mergedText,
      plan: null,
      changesSummary: [
        "compression-writer-truncated: using unedited narrative",
      ],
    };
  }

  let parsed: {
    plan: CompressionPlan;
    finalText: string;
    changesSummary: string[];
  };
  try {
    parsed = JSON.parse(rawText) as {
      plan: CompressionPlan;
      finalText: string;
      changesSummary: string[];
    };
  } catch {
    console.warn(
      `[COMPRESSION_WRITER] failed reason=json_parse_error status=${respStatus} length=${rawText.length} preset=narrative using=unedited_text originalWords=${originalWords}`,
    );
    return {
      finalText: input.mergedText,
      plan: null,
      changesSummary: [
        "compression-writer-parse-error: using unedited narrative",
      ],
    };
  }

  const finalText = (parsed.finalText ?? "").trim();
  if (!finalText) {
    console.warn(
      `[COMPRESSION_WRITER] failed reason=empty_final_text status=${respStatus} preset=narrative using=unedited_text originalWords=${originalWords}`,
    );
    return {
      finalText: input.mergedText,
      plan: null,
      changesSummary: ["compression-writer-empty: using unedited narrative"],
    };
  }

  const rewrittenWords = finalText.split(/\s+/).filter(Boolean).length;
  const deltaPct =
    originalWords > 0
      ? Math.round(((rewrittenWords - originalWords) / originalWords) * 1000) /
        10
      : 0;
  const plan = parsed.plan ?? null;
  const sceneCount =
    plan && Array.isArray(plan.sceneInventory) ? plan.sceneInventory.length : 0;
  const changesSummary = Array.isArray(parsed.changesSummary)
    ? parsed.changesSummary
    : [];
  const summaryLine = changesSummary.join(" | ");
  const summaryTruncated =
    summaryLine.length > 500 ? `${summaryLine.slice(0, 500)}…` : summaryLine;

  console.info(
    `[COMPRESSION_WRITER] preset=narrative model=${model} originalWords=${originalWords} rewrittenWords=${rewrittenWords} deltaPct=${deltaPct} targetWords=${targetWords} durationSec=${durationSec} scenes=${sceneCount} changesCount=${changesSummary.length}`,
  );
  console.info(
    `[COMPRESSION_WRITER] changesSummary=[${summaryTruncated}]`,
  );

  return { finalText, plan, changesSummary };
}
