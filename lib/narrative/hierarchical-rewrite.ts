// lib/narrative/hierarchical-rewrite.ts
//
// Wrapper that chains the three stages of the hierarchical rewrite pipeline:
//
//   Stage 1  extractScenes()       → SceneInventory          (structural)
//   Stage 2  consolidateScenes()   → ConsolidatedScenePlan   (structural)
//   Stage 3  rewriteScenes()       → RewriteScenesOutput     (prose)
//
// This file is a coordinator only. It performs no prose manipulation, no
// editing, no polishing, no supervision, no repair, and adds no new prompts
// or AI logic. It exists so callers can run the full hierarchical pipeline
// behind a single async function.
//
// Failure handling mirrors compression-writer.ts: the wrapper never throws.
// If any stage fails — by throwing, by returning an empty result, or by
// producing no assembled text — the wrapper falls back silently to the
// original mergedText with sceneCount=0 on both stages.
//
// Telemetry: [HIERARCHICAL_REWRITE] prefix on all log lines.

import { extractScenes } from "./scene-extractor";
import { consolidateScenes } from "./scene-consolidator";
import { rewriteScenes } from "./scene-rewriter";
import type { StoryBible } from "./types";

export type HierarchicalRewriteInput = {
  mergedText: string;
  bible: StoryBible;
  outputLanguage: "English" | "German";
  wordTarget: number;
  targetDurationSec: number;
  model?: string;
  openaiTimeoutMs?: number;
};

export type HierarchicalRewriteResult = {
  text: string;
  wordCount: number;
  extractedSceneCount: number;
  consolidatedSceneCount: number;
};

export async function hierarchicalRewriteNarrative(
  input: HierarchicalRewriteInput,
): Promise<HierarchicalRewriteResult> {
  const originalWords = countWords(input.mergedText);
  const wordTarget = Math.max(0, Math.round(input.wordTarget));
  const durationSec = Math.max(0, Math.round(input.targetDurationSec));

  console.info(
    `[HIERARCHICAL_REWRITE] phase=start preset=narrative originalWords=${originalWords} wordTarget=${wordTarget} durationSec=${durationSec} lang=${input.outputLanguage}`,
  );

  const fallback: HierarchicalRewriteResult = {
    text: input.mergedText,
    wordCount: originalWords,
    extractedSceneCount: 0,
    consolidatedSceneCount: 0,
  };

  try {
    const inventory = await extractScenes({
      mergedText: input.mergedText,
      bible: input.bible,
      outputLanguage: input.outputLanguage,
      model: input.model,
      openaiTimeoutMs: input.openaiTimeoutMs,
    });
    const extractedSceneCount = inventory?.scenes?.length ?? 0;

    console.info(
      `[HIERARCHICAL_REWRITE] phase=extract.done sceneCount=${extractedSceneCount}`,
    );

    if (extractedSceneCount === 0) {
      console.warn(
        `[HIERARCHICAL_REWRITE] failed reason=extract_empty using=unedited_text originalWords=${originalWords}`,
      );
      return fallback;
    }

    const plan = await consolidateScenes({
      inventory,
      bible: input.bible,
      outputLanguage: input.outputLanguage,
      wordTarget: input.wordTarget,
      targetDurationSec: input.targetDurationSec,
      model: input.model,
      openaiTimeoutMs: input.openaiTimeoutMs,
    });
    const consolidatedSceneCount = plan?.scenes?.length ?? 0;

    console.info(
      `[HIERARCHICAL_REWRITE] phase=consolidate.done sceneCount=${consolidatedSceneCount}`,
    );

    if (consolidatedSceneCount === 0) {
      console.warn(
        `[HIERARCHICAL_REWRITE] failed reason=consolidate_empty using=unedited_text originalWords=${originalWords} extractedSceneCount=${extractedSceneCount}`,
      );
      return fallback;
    }

    const rewritten = await rewriteScenes({
      plan,
      bible: input.bible,
      outputLanguage: input.outputLanguage,
      targetDurationSec: input.targetDurationSec,
      model: input.model,
      openaiTimeoutMs: input.openaiTimeoutMs,
    });
    const rewrittenText = (rewritten?.assembledText ?? "").trim();
    const rewrittenWords = rewritten?.totalWordCount ?? 0;

    console.info(
      `[HIERARCHICAL_REWRITE] phase=rewrite.done wordCount=${rewrittenWords}`,
    );

    if (!rewrittenText || rewrittenWords === 0) {
      console.warn(
        `[HIERARCHICAL_REWRITE] failed reason=rewrite_empty using=unedited_text originalWords=${originalWords} extractedSceneCount=${extractedSceneCount} consolidatedSceneCount=${consolidatedSceneCount}`,
      );
      return fallback;
    }

    const deltaPct =
      originalWords > 0
        ? Math.round(((rewrittenWords - originalWords) / originalWords) * 1000) /
          10
        : 0;

    console.info(
      `[HIERARCHICAL_REWRITE] phase=done originalWords=${originalWords} finalWords=${rewrittenWords} deltaPct=${deltaPct} extractedSceneCount=${extractedSceneCount} consolidatedSceneCount=${consolidatedSceneCount}`,
    );

    return {
      text: rewrittenText,
      wordCount: rewrittenWords,
      extractedSceneCount,
      consolidatedSceneCount,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[HIERARCHICAL_REWRITE] failed reason=unexpected_error:${msg.slice(0, 160)} using=unedited_text originalWords=${originalWords}`,
    );
    return fallback;
  }
}

function countWords(text: string): number {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}
