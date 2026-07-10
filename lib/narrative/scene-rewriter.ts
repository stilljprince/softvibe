// lib/narrative/scene-rewriter.ts
//
// Stage 3 of the hierarchical rewrite pipeline.
//
// Given a consolidated scene plan from Stage 2 (scene-consolidator) plus the
// StoryBible, the Scene Rewriter renders each consolidated scene into final
// literary prose, scene by scene, in plan order. It is a WRITER, not an
// editor: it does not see the original merged draft and never operates on
// existing prose. It works from structural specs only.
//
// The point is to break the minimal-diff prior. Previous compression-style
// editors anchored on the original prose and produced ~3–4% reductions even
// at large overshoot. By rebuilding scene-by-scene from a structural plan,
// the rewriter is free to deliver scenes at their planned length without
// being dragged back toward the original surface.
//
// Hard contract:
//   • Renders scene prose from the consolidated scene spec only.
//   • Does NOT accept or use mergedText or the original full prose.
//   • Receives the previous rewritten scene's tail (~120 words) for
//     continuity of tone / seam only — never as content to extend.
//   • Each scene's word budget is the per-scene targetWordCount supplied by
//     the plan. Aim at or slightly under, never pad.
//
// This stage is intentionally standalone and is NOT wired into the
// orchestrator. It will later be called by a hierarchicalRewriteNarrative
// wrapper that chains Stages 1 → 2 → 3.
//
// Failure handling mirrors scene-extractor.ts / scene-consolidator.ts /
// compression-writer.ts: any OpenAI failure, parse failure, truncation, or
// empty scene text falls back to a compact structural-bridge paragraph
// derived from the scene spec. The rewriter is never allowed to throw to
// its caller.
//
// Telemetry: [SCENE_REWRITER] prefix on all log lines.

import OpenAI from "openai";
import type {
  ConsolidatedScenePlan,
  ConsolidatedScenePlanItem,
} from "./scene-consolidator";
import type { StoryBible } from "./types";

export type RewrittenScene = {
  id: string;
  text: string;
  wordCount: number;
};

export type RewriteScenesInput = {
  plan: ConsolidatedScenePlan;
  bible: StoryBible;
  outputLanguage: "English" | "German";
  targetDurationSec: number;
  model?: string;
  openaiTimeoutMs?: number;
};

export type RewriteScenesOutput = {
  scenes: RewrittenScene[];
  assembledText: string;
  totalWordCount: number;
};

// Tail size carried into the next scene's render. ~120 words sits in the
// middle of the requested 100–140 band: enough seam to preserve tone and
// the last image, short enough to keep the model from continuing the
// previous scene's action instead of beginning the new one.
const TAIL_WORDS = 120;

// Internal rewrite-budget safety factor. The model systematically overshoots
// per-scene targets by ~20–30% even with retry + compact passes. We compensate
// here by aiming the renderer at a lower effective target. The consolidated
// scene plan is left untouched — it still sums to wordTarget — and only
// Stage 3 internally writes against a reduced budget. Telemetry preserves the
// original planned target so overshoot can still be measured against intent.
const SCENE_REWRITE_TARGET_SAFETY_FACTOR = 0.84;

const EMPTY_OUTPUT: RewriteScenesOutput = {
  scenes: [],
  assembledText: "",
  totalWordCount: 0,
};

export async function rewriteScenes(
  input: RewriteScenesInput,
): Promise<RewriteScenesOutput> {
  const scenes = input.plan?.scenes ?? [];
  const inputSceneCount = scenes.length;
  const plannedTotalWords = sumPlanWords(scenes);
  const durationSec = Math.max(1, Math.round(input.targetDurationSec));

  if (!process.env.OPENAI_API_KEY) {
    console.warn(
      `[SCENE_REWRITER] failed reason=missing_api_key preset=narrative inputSceneCount=${inputSceneCount} plannedTotalWords=${plannedTotalWords}`,
    );
    return buildFallbackOutput(scenes);
  }

  if (inputSceneCount === 0) {
    console.warn(
      `[SCENE_REWRITER] failed reason=empty_plan preset=narrative inputSceneCount=0 plannedTotalWords=0`,
    );
    return EMPTY_OUTPUT;
  }

  const model =
    input.model ??
    process.env.OPENAI_NARRATIVE_SCENE_REWRITER_MODEL ??
    process.env.OPENAI_NARRATIVE_COMPRESSION_WRITER_MODEL ??
    process.env.OPENAI_NARRATIVE_EDITOR_MODEL ??
    process.env.OPENAI_EDITOR_MODEL ??
    "gpt-5.4-mini";

  const timeoutMs =
    typeof input.openaiTimeoutMs === "number" &&
    Number.isFinite(input.openaiTimeoutMs)
      ? input.openaiTimeoutMs
      : parseInt(
          process.env.OPENAI_NARRATIVE_SCENE_REWRITER_TIMEOUT_MS ??
            process.env.OPENAI_NARRATIVE_COMPRESSION_WRITER_TIMEOUT_MS ??
            process.env.OPENAI_NARRATIVE_EDITOR_TIMEOUT_MS ??
            "240000",
          10,
        );

  console.info(
    `[SCENE_REWRITER] phase=start preset=narrative model=${model} inputSceneCount=${inputSceneCount} plannedTotalWords=${plannedTotalWords} durationSec=${durationSec} lang=${input.outputLanguage}`,
  );

  const bibleBlock = safeStringifyBible(input.bible);
  const rewrittenScenes: RewrittenScene[] = [];
  let previousTail = "";

  for (const scene of scenes) {
    const plannedTargetWords = Math.max(
      40,
      Math.round(scene.targetWordCount ?? 0),
    );
    const effectiveTargetWords = Math.max(
      80,
      Math.round(plannedTargetWords * SCENE_REWRITE_TARGET_SAFETY_FACTOR),
    );

    console.info(
      `[SCENE_REWRITER] phase=scene.start id=${scene.id} plannedTargetWords=${plannedTargetWords} effectiveTargetWords=${effectiveTargetWords} function=${shortLabel(scene.function)}`,
    );

    let sceneText = "";
    try {
      sceneText = await renderScene({
        scene,
        bible: input.bible,
        bibleBlock,
        previousTail,
        outputLanguage: input.outputLanguage,
        durationSec,
        model,
        timeoutMs,
        effectiveTargetWords,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[SCENE_REWRITER] phase=scene.fallback id=${scene.id} reason=caller_threw:${msg.slice(0, 160)}`,
      );
      sceneText = "";
    }

    if (!sceneText) {
      sceneText = buildSceneFallback(scene);
    }

    let words = countWords(sceneText);

    // Bounded per-scene retry on material overshoot. Triggered only when the
    // first attempt landed materially above the local target. The retry is
    // rendered from the same scene spec; it must NOT use the overlong first
    // attempt as a prose substrate. Acceptance is strict: retry is kept only
    // if it lands inside the local tolerance OR is at least 10% shorter than
    // the first attempt. Otherwise the first attempt stands. One retry
    // maximum, no recursion.
    if (
      effectiveTargetWords > 0 &&
      words > Math.round(effectiveTargetWords * 1.12) &&
      sceneText.trim().length > 0
    ) {
      console.info(
        `[SCENE_REWRITER] phase=scene.retry id=${scene.id} words=${words} plannedTargetWords=${plannedTargetWords} effectiveTargetWords=${effectiveTargetWords} reason=overshoot`,
      );

      const firstWords = words;

      let retryText = "";
      try {
        retryText = await renderScene({
          scene,
          bible: input.bible,
          bibleBlock,
          previousTail,
          outputLanguage: input.outputLanguage,
          durationSec,
          model,
          timeoutMs,
          effectiveTargetWords,
          retryNote:
            "Stricter re-render of the SAME scene from the SAME spec — not a rewrite of the previous output. Same scene. Same beats. Same emotional function. Do NOT add new material. Stop immediately once the scene's emotional function lands. No afterglow. No second reflection pass. No extra dialogue closure. No atmosphere epilogue.",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[SCENE_REWRITER] phase=scene.retry.failed id=${scene.id} reason=caller_threw:${msg.slice(0, 160)} plannedTargetWords=${plannedTargetWords} effectiveTargetWords=${effectiveTargetWords}`,
        );
        retryText = "";
      }

      if (retryText) {
        const retryWords = countWords(retryText);
        const retryDeltaPct =
          effectiveTargetWords > 0
            ? Math.round(
                ((retryWords - effectiveTargetWords) / effectiveTargetWords) *
                  1000,
              ) / 10
            : 0;
        const insideTolerance =
          retryWords <= Math.round(effectiveTargetWords * 1.12);
        const enoughImprovement =
          retryWords <= Math.round(firstWords * 0.9);
        if (insideTolerance || enoughImprovement) {
          sceneText = retryText;
          words = retryWords;
          console.info(
            `[SCENE_REWRITER] phase=scene.retry.done id=${scene.id} words=${retryWords} plannedTargetWords=${plannedTargetWords} effectiveTargetWords=${effectiveTargetWords} deltaPct=${retryDeltaPct}`,
          );
        } else {
          console.info(
            `[SCENE_REWRITER] phase=scene.retry.rejected id=${scene.id} reason=not_enough_improvement firstWords=${firstWords} retryWords=${retryWords} plannedTargetWords=${plannedTargetWords} effectiveTargetWords=${effectiveTargetWords}`,
          );
        }
      }
    }

    // Last-resort compact render. Triggered only when the accepted scene
    // (first attempt or retry) is still materially above target. The compact
    // pass preserves the same scene, the same mandatory beats, and the
    // scene's emotional function, but aims at 0.80×–0.95× of target and
    // forbids afterglow / reflection / epilogue. One attempt only, no
    // recursion. The result is accepted only when it is genuinely shorter
    // than what we already have — otherwise the prior scene stands.
    if (
      effectiveTargetWords > 0 &&
      words > Math.round(effectiveTargetWords * 1.2) &&
      sceneText.trim().length > 0
    ) {
      console.info(
        `[SCENE_REWRITER] phase=scene.compact.start id=${scene.id} words=${words} plannedTargetWords=${plannedTargetWords} effectiveTargetWords=${effectiveTargetWords}`,
      );

      let compactText = "";
      try {
        compactText = await renderScene({
          scene,
          bible: input.bible,
          bibleBlock,
          previousTail,
          outputLanguage: input.outputLanguage,
          durationSec,
          model,
          timeoutMs,
          effectiveTargetWords,
          compactMode: true,
          retryNote:
            "Compact-render pass. Same scene, same mandatory beats, same emotional meaning. Do NOT add new material. Do NOT summarize. Do NOT pad. Stop immediately once the scene function lands. Land inside 0.80×–0.95× of the planned scene length. Still fully literary prose — not a structural summary.",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[SCENE_REWRITER] phase=scene.compact.failed id=${scene.id} reason=caller_threw:${msg.slice(0, 160)} plannedTargetWords=${plannedTargetWords} effectiveTargetWords=${effectiveTargetWords}`,
        );
        compactText = "";
      }

      if (compactText) {
        const compactWords = countWords(compactText);
        const compactDeltaPct =
          effectiveTargetWords > 0
            ? Math.round(
                ((compactWords - effectiveTargetWords) /
                  effectiveTargetWords) *
                  1000,
              ) / 10
            : 0;
        if (compactWords < words) {
          sceneText = compactText;
          words = compactWords;
          console.info(
            `[SCENE_REWRITER] phase=scene.compact.done id=${scene.id} words=${compactWords} plannedTargetWords=${plannedTargetWords} effectiveTargetWords=${effectiveTargetWords} deltaPct=${compactDeltaPct}`,
          );
        } else {
          console.info(
            `[SCENE_REWRITER] phase=scene.compact.failed id=${scene.id} reason=not_shorter words=${compactWords} plannedTargetWords=${plannedTargetWords} effectiveTargetWords=${effectiveTargetWords} deltaPct=${compactDeltaPct}`,
          );
        }
      } else {
        console.info(
          `[SCENE_REWRITER] phase=scene.compact.failed id=${scene.id} reason=empty_compact_output plannedTargetWords=${plannedTargetWords} effectiveTargetWords=${effectiveTargetWords}`,
        );
      }
    }

    const deltaPctVsPlanned =
      plannedTargetWords > 0
        ? Math.round(((words - plannedTargetWords) / plannedTargetWords) * 1000) /
          10
        : 0;
    const deltaPctVsEffective =
      effectiveTargetWords > 0
        ? Math.round(
            ((words - effectiveTargetWords) / effectiveTargetWords) * 1000,
          ) / 10
        : 0;

    rewrittenScenes.push({
      id: scene.id,
      text: sceneText,
      wordCount: words,
    });

    previousTail = extractTail(sceneText, TAIL_WORDS);

    console.info(
      `[SCENE_REWRITER] phase=scene.done id=${scene.id} words=${words} plannedTargetWords=${plannedTargetWords} effectiveTargetWords=${effectiveTargetWords} deltaPctVsPlanned=${deltaPctVsPlanned} deltaPctVsEffective=${deltaPctVsEffective}`,
    );
  }

  const assembledText = rewrittenScenes
    .map((s) => s.text.trim())
    .filter((s) => s.length > 0)
    .join("\n\n");
  const totalWordCount = countWords(assembledText);
  const finalDeltaPct =
    plannedTotalWords > 0
      ? Math.round(
          ((totalWordCount - plannedTotalWords) / plannedTotalWords) * 1000,
        ) / 10
      : 0;

  console.info(
    `[SCENE_REWRITER] phase=done sceneCount=${rewrittenScenes.length} totalWords=${totalWordCount} plannedTotalWords=${plannedTotalWords} deltaPct=${finalDeltaPct}`,
  );

  return {
    scenes: rewrittenScenes,
    assembledText,
    totalWordCount,
  };
}

type RenderSceneArgs = {
  scene: ConsolidatedScenePlanItem;
  bible: StoryBible;
  bibleBlock: string;
  previousTail: string;
  outputLanguage: "English" | "German";
  durationSec: number;
  model: string;
  timeoutMs: number;
  // Internal effective target the renderer aims at. Already reduced from the
  // plan's per-scene target by SCENE_REWRITE_TARGET_SAFETY_FACTOR. The plan's
  // original target is preserved upstream for telemetry only.
  effectiveTargetWords: number;
  retryNote?: string;
  compactMode?: boolean;
};

async function renderScene(args: RenderSceneArgs): Promise<string> {
  const {
    scene,
    bibleBlock,
    previousTail,
    outputLanguage,
    durationSec,
    model,
    timeoutMs,
    retryNote,
    compactMode,
  } = args;

  const effectiveTargetWords = Math.max(
    40,
    Math.round(args.effectiveTargetWords ?? 0),
  );

  // Per-scene output budget. Sized to land the scene at its effective target
  // without affording room to drift far past it. ~2.1 tokens per target word
  // covers both prose and any reasoning overhead; the 350-token base absorbs
  // short scenes; the 4000-token ceiling caps the largest scenes we expect,
  // and is well below the prior 6000-token ceiling which was contributing to
  // Stage-3 overshoot. Sizing against the effective target (not the planned
  // one) keeps the ceiling consistent with the band the prompt enforces.
  const maxTokens = Math.min(
    4000,
    Math.max(500, Math.round(effectiveTargetWords * 2.1 + 350)),
  );

  const targetMin = compactMode
    ? Math.max(40, Math.round(effectiveTargetWords * 0.8))
    : Math.max(40, Math.round(effectiveTargetWords * 0.9));
  const targetMax = compactMode
    ? Math.max(targetMin, Math.round(effectiveTargetWords * 0.95))
    : Math.max(targetMin, Math.round(effectiveTargetWords * 1.05));

  const system = [
    `You are a literary novelist rendering one scene of a longer story.`,
    `You are given a structural scene specification — what the scene is doing, where it is set, the key beats in causal order, the strongest sensory anchors to carry, the emotional register, the callbacks to thread, and a one-line compression instruction. You write the scene at its natural final length from this spec. You are not editing existing prose. You are not summarizing. You are not outlining. You are publishing the scene.`,
    ``,
    `━━━ STANCE ━━━`,
    ``,
    `The scene spec is authoritative. Treat it as the brief a confident novelist would write for themselves before drafting the scene. Render lived prose — sensory, calm, paced — from inside the scene's moment. Do not narrate the scene from outside it. Do not gesture toward it. Live in it.`,
    ``,
    `If a previous-scene tail is provided, it is for continuity of tone and seam only. Pick up the scene's emotional thread — do not continue the previous scene's action. Begin this scene at its own moment.`,
    ``,
    `━━━ PRESERVE — non-negotiable ━━━`,
    ``,
    `  • Causal chain — the key beats unfold in the order the plan gives them, with the cause→effect logic intact.`,
    `  • Character logic — characters behave consistently with the StoryBible's protagonist and supporting sketches.`,
    `  • Emotional arc — the scene moves through its declared emotional register; if the scene's function is reveal / decision / closure, that turn lands here.`,
    `  • Mystery / reveal logic — clues stay clues, reveals stay reveals; do not foreshadow what the plan has not foreshadowed and do not pre-empt a later scene's revelation.`,
    `  • The two or three strongest sensory anchors the plan supplies. These carry the scene's atmosphere.`,
    `  • The calm, emotionally warm tone of the story as a whole.`,
    `  • Slow but not bloated pacing — the scene breathes; it does not stall.`,
    ``,
    `━━━ DO NOT ━━━`,
    ``,
    `  • Do NOT invent new named characters, new locations, new plot events, new twists, or new backstory beyond what the plan and bible imply.`,
    `  • Do NOT summarize the scene from outside; render it as lived prose.`,
    `  • Do NOT rush — no compressed report of events that should play in real time.`,
    `  • Do NOT pad — no afterglow paragraphs once the scene has done its work.`,
    `  • Do NOT add markdown, headings, scene labels, or meta commentary.`,
    `  • Do NOT preface the scene with any explanation, "here is the scene", or "Scene N:" label.`,
    ``,
    `━━━ LENGTH ━━━`,
    ``,
    compactMode
      ? `Compact-render pass. Planned scene length is ~${effectiveTargetWords} words; for this pass land COMPACTLY inside ~${targetMin}–${targetMax} words (0.80×–0.95× of target). The scene MUST come in at or under target without losing any mandatory beat or the scene's emotional function.`
      : `Target ~${effectiveTargetWords} words for this scene. This is the scene's real local length — not a soft suggestion. Land inside ~${targetMin}–${targetMax} words (0.90×–1.05× of target). Prefer landing at or slightly under target.`,
    `Treat the target as the scene's natural spoken-length budget for a ~${durationSec}-second story.`,
    `Do not expand the scene because it feels important. A reveal, confrontation, or turn may be emotionally full, but it is not proportionally longer than its target. Emotional weight is delivered through line-level prose, not added paragraphs.`,
    `If all key beats have landed and the scene's emotional function has resolved, stop cleanly. Do not add afterglow, extra reflection, a second atmosphere pass, repeated emotional interpretation, or additional dialogue closure. Do not pad to fill the budget.`,
    ``,
    `━━━ OUTPUT ━━━`,
    ``,
    `Return a JSON object matching the supplied schema. The object has exactly one field, "text", whose value is the rewritten scene as continuous literary prose only — no title, no "Scene N:" label, no markdown, no headings, no commentary, no quotation marks wrapping the whole response. Paragraphs inside "text" are separated by single blank lines (\\n\\n).`,
    `Output language: ${outputLanguage}.`,
    outputLanguage === "German"
      ? `Schreibe natürliches modernes Deutsch, TTS-freundlich. Keine archaischen Schreibweisen, es sei denn die Szene verlangt es ausdrücklich.`
      : `Write natural modern English, TTS-friendly.`,
  ].join("\n");

  const sceneSpecBlock = stringifySceneSpec(scene);
  const previousTailBlock = previousTail.trim()
    ? [
        `PREVIOUS-SCENE TAIL (continuity only — do not continue its action):`,
        `---`,
        previousTail.trim(),
        `---`,
      ].join("\n")
    : `PREVIOUS-SCENE TAIL: (none — this is the opening scene)`;

  const retryNoteBlock = retryNote && retryNote.trim()
    ? [
        ``,
        `RETRY NOTE: ${retryNote.trim()} Preserve the same key beats and sensory anchors. Output plain prose only.`,
      ].join("\n")
    : "";

  const user = [
    `Render the following scene of the story as final literary prose.`,
    ``,
    `STORY BIBLE (orientation only — do not import details not implied by the scene spec):`,
    `---`,
    bibleBlock,
    `---`,
    ``,
    `SCENE SPECIFICATION (authoritative — render this scene):`,
    `---`,
    sceneSpecBlock,
    `---`,
    ``,
    previousTailBlock,
    retryNoteBlock,
    ``,
    `Write the scene now. Target ~${effectiveTargetWords} words. Return the JSON object: { "text": "<scene prose>" }. The prose itself must contain no preamble, no labels, no JSON.`,
  ].join("\n");

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  let resp;
  try {
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
            name: "SoftVibeNarrativeSceneRewrite",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["text"],
              properties: {
                text: {
                  type: "string",
                  description:
                    "The rewritten scene as continuous literary prose only. No title, no scene label, no markdown, no commentary.",
                },
              },
            },
          },
        },
      },
      { timeout: timeoutMs },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[SCENE_REWRITER] phase=scene.fallback id=${scene.id} reason=openai_call_failed:${msg.slice(0, 160)} effectiveTargetWords=${effectiveTargetWords}`,
    );
    return "";
  }

  const rawText = (resp.output_text ?? "").trim();
  const respStatus = resp.status ?? "unknown";

  if (respStatus === "incomplete") {
    console.warn(
      `[SCENE_REWRITER] phase=scene.fallback id=${scene.id} reason=response_truncated length=${rawText.length} effectiveTargetWords=${effectiveTargetWords}`,
    );
    return "";
  }

  if (!rawText) {
    console.warn(
      `[SCENE_REWRITER] phase=scene.fallback id=${scene.id} reason=empty_output status=${respStatus} effectiveTargetWords=${effectiveTargetWords}`,
    );
    return "";
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    console.warn(
      `[SCENE_REWRITER] phase=scene.fallback id=${scene.id} reason=json_parse_error status=${respStatus} length=${rawText.length} effectiveTargetWords=${effectiveTargetWords}`,
    );
    return "";
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as { text?: unknown }).text !== "string"
  ) {
    console.warn(
      `[SCENE_REWRITER] phase=scene.fallback id=${scene.id} reason=invalid_json_shape status=${respStatus} effectiveTargetWords=${effectiveTargetWords}`,
    );
    return "";
  }

  const sceneText = stripPreamble((parsed as { text: string }).text.trim());
  if (!sceneText) {
    console.warn(
      `[SCENE_REWRITER] phase=scene.fallback id=${scene.id} reason=empty_text status=${respStatus} effectiveTargetWords=${effectiveTargetWords}`,
    );
    return "";
  }

  return sceneText;
}

// Removes a leading "Scene N:" / "Szene N:" label or wrapping quotation
// marks if the model ignored the prose-only instruction. Conservative: only
// trims obvious wrappers, never reaches into the body.
function stripPreamble(text: string): string {
  let t = text.trim();
  // Leading scene labels.
  t = t.replace(/^(scene|szene)\s*[-:]?\s*\d+\s*[:.\-—]\s*/i, "");
  // Wrapping single or double quotes around the whole block.
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("“") && t.endsWith("”")) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    const inner = t.slice(1, -1).trim();
    if (inner.length > 0) t = inner;
  }
  return t.trim();
}

function extractTail(text: string, words: number): string {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length <= words) return text.trim();
  return tokens.slice(-words).join(" ");
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function sumPlanWords(scenes: ConsolidatedScenePlanItem[]): number {
  let total = 0;
  for (const s of scenes) {
    if (
      typeof s.targetWordCount === "number" &&
      Number.isFinite(s.targetWordCount)
    ) {
      total += Math.max(0, s.targetWordCount);
    }
  }
  return total;
}

function shortLabel(s: string): string {
  if (!s) return "";
  return s.length > 32 ? `${s.slice(0, 32)}…` : s;
}

function stringifySceneSpec(scene: ConsolidatedScenePlanItem): string {
  try {
    return JSON.stringify(
      {
        id: scene.id,
        function: scene.function,
        targetWordCount: scene.targetWordCount,
        settingAndTime: scene.settingAndTime,
        keyBeats: scene.keyBeats,
        sensoryAnchorsToCarry: scene.sensoryAnchorsToCarry,
        emotionalRegister: scene.emotionalRegister,
        callbacksToCarry: scene.callbacksToCarry,
        compressionInstruction: scene.compressionInstruction,
      },
      null,
      2,
    );
  } catch {
    return "{}";
  }
}

function safeStringifyBible(bible: StoryBible): string {
  try {
    return JSON.stringify(bible, null, 2);
  } catch {
    return "{}";
  }
}

// Emergency per-scene fallback. Used when the OpenAI call cannot produce a
// usable scene (missing key, network error, truncation, parse failure, empty
// output). The output is intentionally compact and safe: it leans only on
// the structural spec the plan already supplies — settingAndTime, key beats,
// strongest sensory anchors, emotional register — and invents nothing. It
// is not literary prose; it is a bridge that keeps the assembled story
// intact when the renderer cannot. Normal runtime should never reach this.
function buildSceneFallback(scene: ConsolidatedScenePlanItem): string {
  const parts: string[] = [];

  const setting = (scene.settingAndTime ?? "").trim();
  if (setting) parts.push(ensureSentence(setting));

  const beats = Array.isArray(scene.keyBeats) ? scene.keyBeats : [];
  for (const beat of beats.slice(0, 4)) {
    const cleaned = (beat ?? "").trim();
    if (cleaned) parts.push(ensureSentence(cleaned));
  }

  const anchors = Array.isArray(scene.sensoryAnchorsToCarry)
    ? scene.sensoryAnchorsToCarry
    : [];
  for (const anchor of anchors.slice(0, 2)) {
    const cleaned = (anchor ?? "").trim();
    if (cleaned) parts.push(ensureSentence(cleaned));
  }

  const register = (scene.emotionalRegister ?? "").trim();
  if (register) parts.push(ensureSentence(register));

  if (parts.length === 0) {
    return "";
  }

  return parts.join(" ");
}

function ensureSentence(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return "";
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

// Full-output fallback when no OpenAI call can be made at all (e.g. missing
// API key). Each scene gets its structural-bridge fallback so the caller
// receives a non-empty result with shape parity to a real run.
function buildFallbackOutput(
  scenes: ConsolidatedScenePlanItem[],
): RewriteScenesOutput {
  if (scenes.length === 0) return EMPTY_OUTPUT;
  const rewritten: RewrittenScene[] = scenes.map((scene) => {
    const text = buildSceneFallback(scene);
    return { id: scene.id, text, wordCount: countWords(text) };
  });
  const assembledText = rewritten
    .map((s) => s.text.trim())
    .filter((s) => s.length > 0)
    .join("\n\n");
  return {
    scenes: rewritten,
    assembledText,
    totalWordCount: countWords(assembledText),
  };
}
