// lib/narrative/scene-extractor.ts
//
// Stage 1 of the future hierarchical rewrite pipeline.
//
// Given a merged narrative draft plus its StoryBible, the Scene Extractor
// converts prose into an ordered scene inventory: structural metadata
// describing what each scene is doing, its strongest sensory anchors, and
// the callbacks it carries. It is a STRUCTURAL ANALYST, not a writer.
//
// This stage is intentionally standalone and not yet wired into the
// orchestrator. It exists so later passes (planner, rewriter) can operate
// on scenes rather than paragraphs.
//
// Hard contract:
//   • Does NOT generate prose.
//   • Does NOT rewrite the draft.
//   • Does NOT compress, summarize, or paraphrase scenes.
//   • Returns scene metadata only.
//
// Failure handling mirrors compression-writer.ts: any OpenAI failure,
// parse failure, truncation, or empty output falls back silently to an
// empty inventory `{ scenes: [] }`. The extractor is never allowed to
// block a caller.
//
// Telemetry: [SCENE_EXTRACTOR] prefix on all log lines.

import OpenAI from "openai";
import type { StoryBible } from "./types";

export type SceneInventoryItem = {
  id: string;
  function: string;
  currentWordCount: number;
  settingAndTime: string;
  keyBeats: string[];
  strongestSensoryAnchors: string[];
  emotionalRegister: string;
  callbacksUsed: string[];
};

export type SceneInventory = {
  scenes: SceneInventoryItem[];
};

export type ExtractScenesInput = {
  mergedText: string;
  bible: StoryBible;
  outputLanguage: "German" | "English";
  model?: string;
  openaiTimeoutMs?: number;
};

const EMPTY_INVENTORY: SceneInventory = { scenes: [] };

export async function extractScenes(
  input: ExtractScenesInput,
): Promise<SceneInventory> {
  const originalWords = input.mergedText.split(/\s+/).filter(Boolean).length;

  if (!process.env.OPENAI_API_KEY) {
    console.warn(
      `[SCENE_EXTRACTOR] failed reason=missing_api_key preset=narrative originalWords=${originalWords}`,
    );
    return EMPTY_INVENTORY;
  }

  if (!input.mergedText || originalWords === 0) {
    console.warn(
      `[SCENE_EXTRACTOR] failed reason=empty_input preset=narrative originalWords=${originalWords}`,
    );
    return EMPTY_INVENTORY;
  }

  const model =
    input.model ??
    process.env.OPENAI_NARRATIVE_SCENE_EXTRACTOR_MODEL ??
    process.env.OPENAI_NARRATIVE_EDITOR_MODEL ??
    process.env.OPENAI_EDITOR_MODEL ??
    "gpt-5.4-mini";

  const timeoutMs =
    typeof input.openaiTimeoutMs === "number" &&
    Number.isFinite(input.openaiTimeoutMs)
      ? input.openaiTimeoutMs
      : parseInt(
          process.env.OPENAI_NARRATIVE_SCENE_EXTRACTOR_TIMEOUT_MS ??
            process.env.OPENAI_NARRATIVE_EDITOR_TIMEOUT_MS ??
            "240000",
          10,
        );

  // Metadata-only output. Each scene contributes a small JSON object —
  // ~150–300 tokens — and even very long drafts rarely contain more than
  // ~30 scenes. 8k tokens is comfortable headroom without inviting the
  // model to over-elaborate.
  const maxTokens = 8000;

  console.info(
    `[SCENE_EXTRACTOR] phase=start preset=narrative model=${model} originalWords=${originalWords}`,
  );

  const bibleBlock = safeStringifyBible(input.bible);

  const system = [
    `You are a structural analyst of literary fiction.`,
    `Your job is to read a completed narrative draft and produce an ordered scene inventory describing how the story is built. You are not a writer, not an editor, and not a summarizer. You think in scenes, not paragraphs.`,
    ``,
    `━━━ WHAT A SCENE IS ━━━`,
    ``,
    `A scene is a continuous unit of narrative action with a single dominant function — what it is *doing* in the story. Scene boundaries usually correspond to a shift in time, place, point-of-view focus, or narrative purpose. Multiple paragraphs that share the same setting and function belong to one scene. A scene typically spans several paragraphs; it is never just a single line of dialogue or a single image.`,
    ``,
    `━━━ FIELDS PER SCENE ━━━`,
    ``,
    `For each scene, in the exact order it appears in the draft, return:`,
    `  • id — short stable label, e.g. "scene-01", "scene-02". Sequential, zero-padded to two digits.`,
    `  • function — one short noun phrase naming what the scene is doing. Examples: arrival, discovery, conversation, confrontation, investigation, memory, reveal, reconciliation, closing image. You may invent a label if none of these fit, but keep it short and structural — never describe content.`,
    `  • currentWordCount — your best estimate of the scene's word count in the draft. Integer.`,
    `  • settingAndTime — where and when, in a single short phrase. Examples: "kitchen, late evening", "harbor at dawn", "Anna's childhood bedroom, remembered".`,
    `  • keyBeats — 2–5 short bullet-like events in causal order. Examples: "Anna opens the notebook.", "Mairi delivers the envelope.", "The photograph reveals Fiona." Each beat is one short sentence. Beats are events, not interpretations.`,
    `  • strongestSensoryAnchors — exactly 2 or 3 anchors that carry the scene's atmosphere. Examples: "rain against the kitchen window", "smell of wet wood", "ticking clock", "salt wind from the harbor". Pick the ones most worth preserving when the scene is later rewritten — do not list every sensory detail.`,
    `  • emotionalRegister — one short phrase naming the scene's dominant emotional color. Examples: "guarded warmth", "quiet dread", "soft relief", "stubborn grief".`,
    `  • callbacksUsed — recurring motifs the scene touches. Empty array if none. Examples: "tea ritual", "kettle", "weather", "silence", "stars", "lighthouse", "letters". Only include motifs that actually appear in this scene.`,
    ``,
    `━━━ HARD RULES ━━━`,
    ``,
    `  • Do NOT rewrite, paraphrase, or summarize scene content. keyBeats are event labels, not prose.`,
    `  • Do NOT invent scenes, characters, settings, or beats that are not in the draft.`,
    `  • Do NOT merge scenes that have distinct functions. Do NOT split a single continuous scene into fragments.`,
    `  • Do NOT add commentary, explanations, or scene "summaries" beyond the fields above.`,
    `  • Preserve the draft's ordering exactly.`,
    `  • Language of the returned text fields: ${input.outputLanguage}.`,
    ``,
    `Return ONLY valid JSON matching the schema. No prose, no preamble, no trailing notes.`,
  ].join("\n");

  const user = [
    `Extract the ordered scene inventory from the draft below. Use the StoryBible only as orientation — it tells you who the characters are and what the story is about. Do not invent or import details from the bible that are not present in the draft.`,
    ``,
    `STORY BIBLE:`,
    `---`,
    bibleBlock,
    `---`,
    ``,
    `DRAFT (~${originalWords} words):`,
    `---`,
    input.mergedText,
    `---`,
    ``,
    `Return JSON: {"scenes":[ ... ]}.`,
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
            name: "SoftVibeNarrativeSceneInventory",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                scenes: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      id: { type: "string" },
                      function: { type: "string" },
                      currentWordCount: { type: "integer" },
                      settingAndTime: { type: "string" },
                      keyBeats: {
                        type: "array",
                        items: { type: "string" },
                      },
                      strongestSensoryAnchors: {
                        type: "array",
                        items: { type: "string" },
                      },
                      emotionalRegister: { type: "string" },
                      callbacksUsed: {
                        type: "array",
                        items: { type: "string" },
                      },
                    },
                    required: [
                      "id",
                      "function",
                      "currentWordCount",
                      "settingAndTime",
                      "keyBeats",
                      "strongestSensoryAnchors",
                      "emotionalRegister",
                      "callbacksUsed",
                    ],
                  },
                },
              },
              required: ["scenes"],
            },
          },
        },
      },
      { timeout: timeoutMs },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[SCENE_EXTRACTOR] failed reason=openai_call_failed:${msg.slice(0, 160)} preset=narrative originalWords=${originalWords}`,
    );
    return EMPTY_INVENTORY;
  }

  const rawText = resp.output_text ?? "";
  const respStatus = resp.status ?? "unknown";

  if (respStatus === "incomplete") {
    console.warn(
      `[SCENE_EXTRACTOR] failed reason=response_truncated length=${rawText.length} preset=narrative originalWords=${originalWords}`,
    );
    return EMPTY_INVENTORY;
  }

  let parsed: SceneInventory;
  try {
    parsed = JSON.parse(rawText) as SceneInventory;
  } catch {
    console.warn(
      `[SCENE_EXTRACTOR] failed reason=json_parse_error status=${respStatus} length=${rawText.length} preset=narrative originalWords=${originalWords}`,
    );
    return EMPTY_INVENTORY;
  }

  if (!parsed || !Array.isArray(parsed.scenes)) {
    console.warn(
      `[SCENE_EXTRACTOR] failed reason=invalid_shape status=${respStatus} preset=narrative originalWords=${originalWords}`,
    );
    return EMPTY_INVENTORY;
  }

  const scenes = parsed.scenes.filter(isValidSceneItem);
  const sceneCount = scenes.length;

  const preview = scenes
    .slice(0, 5)
    .map((s) => `${s.id}:${s.function}`)
    .join(" | ");

  console.info(
    `[SCENE_EXTRACTOR] preset=narrative model=${model} originalWords=${originalWords} sceneCount=${sceneCount}`,
  );
  if (sceneCount > 0) {
    console.info(`[SCENE_EXTRACTOR] scenesPreview=[${preview}]`);
  }

  return { scenes };
}

function isValidSceneItem(s: unknown): s is SceneInventoryItem {
  if (!s || typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.function === "string" &&
    typeof o.currentWordCount === "number" &&
    typeof o.settingAndTime === "string" &&
    Array.isArray(o.keyBeats) &&
    Array.isArray(o.strongestSensoryAnchors) &&
    typeof o.emotionalRegister === "string" &&
    Array.isArray(o.callbacksUsed)
  );
}

function safeStringifyBible(bible: StoryBible): string {
  try {
    return JSON.stringify(bible, null, 2);
  } catch {
    return "{}";
  }
}
