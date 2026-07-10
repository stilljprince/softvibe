// lib/narrative/scene-consolidator.ts
//
// Stage 2 of the hierarchical rewrite pipeline.
//
// Given the ordered scene inventory produced by Stage 1 (scene-extractor)
// plus the StoryBible and the duration-parametric word target, the Scene
// Consolidator returns a consolidated scene plan: fewer, stronger scenes
// with per-scene word budgets that sum near `wordTarget`. It is a
// STRUCTURAL PLANNER, not a writer or editor.
//
// This stage is intentionally standalone and is NOT wired into the
// orchestrator. It exists so a later rewrite pass can render scene-by-scene
// against a plan instead of editing prose paragraph-by-paragraph.
//
// Hard contract:
//   • Does NOT produce prose.
//   • Does NOT read the merged draft — only the scene inventory.
//   • Does NOT invent events, characters, settings, or twists.
//   • Returns structural metadata only.
//
// Failure handling mirrors scene-extractor.ts / compression-writer.ts: any
// OpenAI failure, parse failure, truncation, or invalid shape falls back to
// a conservative one-to-one plan that distributes the word target roughly
// proportional to the original currentWordCount. The consolidator is never
// allowed to block its caller and never throws.
//
// Telemetry: [SCENE_CONSOLIDATOR] prefix on all log lines.

import OpenAI from "openai";
import type { SceneInventory, SceneInventoryItem } from "./scene-extractor";
import type { StoryBible } from "./types";

export type ConsolidatedScenePlanItem = {
  id: string;
  absorbsSceneIds: string[];
  function: string;
  targetWordCount: number;
  settingAndTime: string;
  keyBeats: string[];
  sensoryAnchorsToCarry: string[];
  emotionalRegister: string;
  callbacksToCarry: string[];
  compressionInstruction: string;
};

export type ConsolidatedScenePlan = {
  scenes: ConsolidatedScenePlanItem[];
  totalTargetWordCount: number;
  endingLandsAt: string;
};

export type ConsolidateScenesInput = {
  inventory: SceneInventory;
  bible: StoryBible;
  outputLanguage: "English" | "German";
  wordTarget: number;
  targetDurationSec: number;
  model?: string;
  openaiTimeoutMs?: number;
};

const MIN_SCENE_BUDGET = 80;

export async function consolidateScenes(
  input: ConsolidateScenesInput,
): Promise<ConsolidatedScenePlan> {
  const inputSceneCount = input.inventory?.scenes?.length ?? 0;
  const wordTarget = Math.max(300, Math.round(input.wordTarget));
  const durationSec = Math.max(1, Math.round(input.targetDurationSec));

  if (!process.env.OPENAI_API_KEY) {
    console.warn(
      `[SCENE_CONSOLIDATOR] failed reason=missing_api_key preset=narrative inputSceneCount=${inputSceneCount} wordTarget=${wordTarget}`,
    );
    return buildFallbackPlan(input.inventory, wordTarget);
  }

  if (
    !input.inventory ||
    !Array.isArray(input.inventory.scenes) ||
    inputSceneCount === 0
  ) {
    console.warn(
      `[SCENE_CONSOLIDATOR] failed reason=empty_inventory preset=narrative inputSceneCount=${inputSceneCount} wordTarget=${wordTarget}`,
    );
    return { scenes: [], totalTargetWordCount: 0, endingLandsAt: "" };
  }

  const model =
    input.model ??
    process.env.OPENAI_NARRATIVE_SCENE_CONSOLIDATOR_MODEL ??
    process.env.OPENAI_NARRATIVE_EDITOR_MODEL ??
    process.env.OPENAI_EDITOR_MODEL ??
    "gpt-5.4-mini";

  const timeoutMs =
    typeof input.openaiTimeoutMs === "number" &&
    Number.isFinite(input.openaiTimeoutMs)
      ? input.openaiTimeoutMs
      : parseInt(
          process.env.OPENAI_NARRATIVE_SCENE_CONSOLIDATOR_TIMEOUT_MS ??
            process.env.OPENAI_NARRATIVE_EDITOR_TIMEOUT_MS ??
            "240000",
          10,
        );

  // Structural metadata only. Each consolidated scene is a small JSON
  // object; even very long drafts rarely yield more than ~15 consolidated
  // scenes. 8k tokens is comfortable headroom.
  const maxTokens = 8000;

  console.info(
    `[SCENE_CONSOLIDATOR] phase=start preset=narrative model=${model} inputSceneCount=${inputSceneCount} wordTarget=${wordTarget} durationSec=${durationSec}`,
  );

  const bibleBlock = safeStringifyBible(input.bible);
  const inventoryBlock = safeStringifyInventory(input.inventory);
  const totalCurrentWords = sumCurrentWords(input.inventory.scenes);
  const overshootRatio =
    wordTarget > 0
      ? Math.round((totalCurrentWords / wordTarget) * 100) / 100
      : 1;

  const system = [
    `You are a structural story planner.`,
    `You are not a writer, not an editor, not a summarizer. You think in scenes and budgets. You decide which scenes survive, which scenes are folded into others, which beats and sensory anchors carry forward, and how many words each consolidated scene gets.`,
    ``,
    `━━━ ROLE ━━━`,
    ``,
    `You receive an ordered scene inventory extracted from a finished draft, plus a StoryBible describing the story's characters, setting, central question, and intended closure. You also receive a duration-parametric word target. Return a consolidated scene plan that delivers the same story at the target length with fewer, stronger scenes.`,
    ``,
    `You do NOT write prose. You do NOT paraphrase scene content. You do NOT touch the underlying draft. Your output is a plan downstream stages will render.`,
    ``,
    `━━━ CONSOLIDATION PHILOSOPHY ━━━`,
    ``,
    `Prefer fewer stronger scenes over many near-duplicate scenes.`,
    `  • When two or more scenes share the same function (two arrival scenes, two reconciliation scenes, two reassurance exchanges, two atmospheric drifts), fold them into one consolidated scene. List every original scene id you absorb in absorbsSceneIds.`,
    `  • A scene doing genuinely distinctive work (a real turn, a discovery, the reveal, the terminal image) stands alone. absorbsSceneIds for that consolidated scene is just its single original id.`,
    `  • Carry forward only the strongest 2–3 sensory anchors per consolidated scene. Drop weaker duplicates.`,
    `  • Carry forward only callbacks that genuinely recur. Drop one-off mentions.`,
    ``,
    `━━━ WHAT YOU MUST PRESERVE ━━━`,
    ``,
    `  • Causal chain — A leads to B leads to C must remain readable in the consolidated order.`,
    `  • Genuine story turns and character decisions.`,
    `  • The emotional arc and its real turning points.`,
    `  • Mystery / reveal logic — clues, discoveries, and the moment the reveal lands.`,
    `  • The bible's endingApproach and primaryStoryQuestion.`,
    `  • The terminal image. endingLandsAt names the moment the story closes on.`,
    ``,
    `━━━ WORD BUDGETS ━━━`,
    ``,
    `Assign targetWordCount per consolidated scene. Budgets must:`,
    `  • Sum close to ${wordTarget}. Small variance is fine; large variance is not.`,
    `  • Be realistic and NOT equal slices. Discovery, reveal, and turning-point scenes can take more words. Repeated transition/atmosphere/setup scenes — especially ones that absorbed others — take fewer words than the sum of what they replace.`,
    `  • Respect a minimum reasonable budget per surviving scene (~${MIN_SCENE_BUDGET} words or more).`,
    `  • Be duration-aware: this is a ~${durationSec}-second spoken story aiming at ~${wordTarget} words. Do not pad. Do not equalize. Let the structure dictate the distribution.`,
    ``,
    `━━━ compressionInstruction ━━━`,
    ``,
    `For each consolidated scene, write ONE short sentence telling a downstream writer how to render it. Examples (style only, not content):`,
    `  • "Fold both kitchen reassurance exchanges into one — keep the second kettle moment as the anchor."`,
    `  • "Hold this scene at full length; it carries the reveal."`,
    `  • "Trim atmospheric drift to one strong sensory moment; do not summarize action."`,
    `  • "End on the lit window; no afterglow."`,
    `compressionInstruction is structural guidance, NEVER prose, NEVER a summary of the scene.`,
    ``,
    `━━━ HARD RULES ━━━`,
    ``,
    `  • Do NOT write prose, dialogue, narration, or scene description.`,
    `  • Do NOT invent new events, characters, locations, facts, or twists.`,
    `  • Do NOT reorder the causal chain. The consolidated order should follow the inventory's order.`,
    `  • Do NOT drop a scene whose function is structurally unique (the reveal, a turning decision, the terminal image).`,
    `  • Every original scene id from the inventory must appear in exactly one consolidated scene's absorbsSceneIds.`,
    `  • Use stable consolidated ids: "c-01", "c-02", ... in output order.`,
    `  • Language of returned text fields: ${input.outputLanguage}.`,
    ``,
    `Return ONLY valid JSON matching the schema. No prose, no preamble, no trailing notes.`,
  ].join("\n");

  const user = [
    `Consolidate the following scene inventory into a structural plan for a ~${durationSec}-second spoken story with a word target of ~${wordTarget}.`,
    ``,
    `Inventory currently sums to ~${totalCurrentWords} words across ${inputSceneCount} scenes (~${overshootRatio}× the target). Fold scenes that share a function, preserve the genuine turns and the terminal image, and assign realistic per-scene word budgets that sum near ${wordTarget}.`,
    ``,
    `Use the StoryBible for orientation only — it tells you the story's central question, ending tone, and intended closure. Do not import bible details that are not already represented in the inventory.`,
    ``,
    `STORY BIBLE:`,
    `---`,
    bibleBlock,
    `---`,
    ``,
    `SCENE INVENTORY:`,
    `---`,
    inventoryBlock,
    `---`,
    ``,
    `Return JSON: {"scenes":[ ... ], "totalTargetWordCount": <int>, "endingLandsAt": "..."}.`,
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
            name: "SoftVibeNarrativeConsolidatedScenePlan",
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
                      absorbsSceneIds: {
                        type: "array",
                        items: { type: "string" },
                      },
                      function: { type: "string" },
                      targetWordCount: { type: "integer" },
                      settingAndTime: { type: "string" },
                      keyBeats: {
                        type: "array",
                        items: { type: "string" },
                      },
                      sensoryAnchorsToCarry: {
                        type: "array",
                        items: { type: "string" },
                      },
                      emotionalRegister: { type: "string" },
                      callbacksToCarry: {
                        type: "array",
                        items: { type: "string" },
                      },
                      compressionInstruction: { type: "string" },
                    },
                    required: [
                      "id",
                      "absorbsSceneIds",
                      "function",
                      "targetWordCount",
                      "settingAndTime",
                      "keyBeats",
                      "sensoryAnchorsToCarry",
                      "emotionalRegister",
                      "callbacksToCarry",
                      "compressionInstruction",
                    ],
                  },
                },
                totalTargetWordCount: { type: "integer" },
                endingLandsAt: { type: "string" },
              },
              required: ["scenes", "totalTargetWordCount", "endingLandsAt"],
            },
          },
        },
      },
      { timeout: timeoutMs },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[SCENE_CONSOLIDATOR] failed reason=openai_call_failed:${msg.slice(0, 160)} preset=narrative inputSceneCount=${inputSceneCount} wordTarget=${wordTarget}`,
    );
    return buildFallbackPlan(input.inventory, wordTarget);
  }

  const rawText = resp.output_text ?? "";
  const respStatus = resp.status ?? "unknown";

  if (respStatus === "incomplete") {
    console.warn(
      `[SCENE_CONSOLIDATOR] failed reason=response_truncated length=${rawText.length} preset=narrative inputSceneCount=${inputSceneCount} wordTarget=${wordTarget}`,
    );
    return buildFallbackPlan(input.inventory, wordTarget);
  }

  let parsed: ConsolidatedScenePlan;
  try {
    parsed = JSON.parse(rawText) as ConsolidatedScenePlan;
  } catch {
    console.warn(
      `[SCENE_CONSOLIDATOR] failed reason=json_parse_error status=${respStatus} length=${rawText.length} preset=narrative inputSceneCount=${inputSceneCount}`,
    );
    return buildFallbackPlan(input.inventory, wordTarget);
  }

  if (!parsed || !Array.isArray(parsed.scenes)) {
    console.warn(
      `[SCENE_CONSOLIDATOR] failed reason=invalid_shape status=${respStatus} preset=narrative inputSceneCount=${inputSceneCount}`,
    );
    return buildFallbackPlan(input.inventory, wordTarget);
  }

  const validScenes = parsed.scenes.filter(isValidPlanItem);
  if (validScenes.length === 0) {
    console.warn(
      `[SCENE_CONSOLIDATOR] failed reason=no_valid_scenes status=${respStatus} preset=narrative inputSceneCount=${inputSceneCount}`,
    );
    return buildFallbackPlan(input.inventory, wordTarget);
  }

  const totalPlannedWords = validScenes.reduce(
    (sum, s) => sum + (Number.isFinite(s.targetWordCount) ? s.targetWordCount : 0),
    0,
  );
  const endingLandsAt =
    typeof parsed.endingLandsAt === "string" ? parsed.endingLandsAt : "";
  const reportedTotal =
    typeof parsed.totalTargetWordCount === "number"
      ? parsed.totalTargetWordCount
      : totalPlannedWords;

  const sceneReduction =
    inputSceneCount > 0
      ? Math.round(
          ((inputSceneCount - validScenes.length) / inputSceneCount) * 100,
        ) / 100
      : 0;
  const compressionRatio =
    totalCurrentWords > 0
      ? Math.round((totalPlannedWords / totalCurrentWords) * 100) / 100
      : 1;

  const preview = validScenes
    .slice(0, 5)
    .map(
      (s) =>
        `${s.id} absorbs ${s.absorbsSceneIds.join(",") || "—"} target=${s.targetWordCount}`,
    )
    .join(" | ");

  console.info(
    `[SCENE_CONSOLIDATOR] phase=success preset=narrative model=${model} inputSceneCount=${inputSceneCount} outputSceneCount=${validScenes.length} sceneReduction=${sceneReduction} totalPlannedWords=${totalPlannedWords} reportedTotal=${reportedTotal} compressionRatio=${compressionRatio} wordTarget=${wordTarget} durationSec=${durationSec}`,
  );
  console.info(`[SCENE_CONSOLIDATOR] scenesPreview=[${preview}]`);

  return {
    scenes: validScenes,
    totalTargetWordCount: totalPlannedWords,
    endingLandsAt,
  };
}

function isValidPlanItem(s: unknown): s is ConsolidatedScenePlanItem {
  if (!s || typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    Array.isArray(o.absorbsSceneIds) &&
    (o.absorbsSceneIds as unknown[]).every((x) => typeof x === "string") &&
    typeof o.function === "string" &&
    typeof o.targetWordCount === "number" &&
    Number.isFinite(o.targetWordCount as number) &&
    typeof o.settingAndTime === "string" &&
    Array.isArray(o.keyBeats) &&
    Array.isArray(o.sensoryAnchorsToCarry) &&
    typeof o.emotionalRegister === "string" &&
    Array.isArray(o.callbacksToCarry) &&
    typeof o.compressionInstruction === "string"
  );
}

function sumCurrentWords(scenes: SceneInventoryItem[]): number {
  let total = 0;
  for (const s of scenes) {
    if (typeof s.currentWordCount === "number" && Number.isFinite(s.currentWordCount)) {
      total += Math.max(0, s.currentWordCount);
    }
  }
  return total;
}

// Conservative one-to-one fallback: each original scene becomes one
// consolidated scene. Word budget is distributed proportional to the
// scene's currentWordCount with a per-scene floor; the total is normalized
// to land near `wordTarget`. Used whenever the model call cannot produce a
// trustworthy plan.
function buildFallbackPlan(
  inventory: SceneInventory | undefined,
  wordTarget: number,
): ConsolidatedScenePlan {
  const scenes = inventory?.scenes ?? [];
  if (scenes.length === 0) {
    return { scenes: [], totalTargetWordCount: 0, endingLandsAt: "" };
  }

  const totalCurrent = sumCurrentWords(scenes);
  const sceneCount = scenes.length;
  const floor = Math.min(
    MIN_SCENE_BUDGET,
    Math.max(40, Math.floor(wordTarget / Math.max(1, sceneCount * 2))),
  );

  const raw: number[] = scenes.map((s) => {
    if (totalCurrent > 0 && typeof s.currentWordCount === "number") {
      return Math.round(wordTarget * (s.currentWordCount / totalCurrent));
    }
    return Math.round(wordTarget / sceneCount);
  });

  const withFloor = raw.map((n) => Math.max(floor, n));
  const sum = withFloor.reduce((a, b) => a + b, 0);
  const scale = sum > 0 ? wordTarget / sum : 1;
  const normalized = withFloor.map((n) => Math.max(floor, Math.round(n * scale)));

  const plannedScenes: ConsolidatedScenePlanItem[] = scenes.map((s, i) => ({
    id: `c-${String(i + 1).padStart(2, "0")}`,
    absorbsSceneIds: [s.id],
    function: s.function ?? "scene",
    targetWordCount: normalized[i] ?? floor,
    settingAndTime: s.settingAndTime ?? "",
    keyBeats: Array.isArray(s.keyBeats) ? s.keyBeats.slice(0, 5) : [],
    sensoryAnchorsToCarry: Array.isArray(s.strongestSensoryAnchors)
      ? s.strongestSensoryAnchors.slice(0, 3)
      : [],
    emotionalRegister: s.emotionalRegister ?? "",
    callbacksToCarry: Array.isArray(s.callbacksUsed) ? s.callbacksUsed : [],
    compressionInstruction:
      "Preserve original beats and pacing; trim only to land near the per-scene word budget.",
  }));

  const totalTargetWordCount = plannedScenes.reduce(
    (a, b) => a + b.targetWordCount,
    0,
  );
  const last = scenes[scenes.length - 1];
  const endingLandsAt = last?.settingAndTime ?? "";

  return {
    scenes: plannedScenes,
    totalTargetWordCount,
    endingLandsAt,
  };
}

function safeStringifyBible(bible: StoryBible): string {
  try {
    return JSON.stringify(bible, null, 2);
  } catch {
    return "{}";
  }
}

function safeStringifyInventory(inventory: SceneInventory): string {
  try {
    return JSON.stringify(inventory, null, 2);
  } catch {
    return '{"scenes":[]}';
  }
}
