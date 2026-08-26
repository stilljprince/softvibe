// lib/creative-intelligence/guidance/duration-budget.ts
//
// Deterministic word-budget helper for the Generation Guidance Layer
// (RP-011C.8.10T). Turns CreativeIntent.durationMinutes into a total word
// target and an even per-scene split. No LLM calls, no TTS coupling, no
// pipeline imports -- this module only computes numbers from already-known
// inputs (durationMinutes, scene count).
//
// PRESET_WORDS_PER_MINUTE mirrors the words-per-minute figures the
// production pipeline's own spoken-duration estimate already uses
// (classic-asmr 115, sleep-story 135, kids-story 120, default 120).
// Redeclared here rather than imported, since guidance/ must not depend on
// pipeline code (see scripts/test-creative-intelligence-guidance.ts's
// pipeline-isolation check) -- the same "mirror, don't import" approach
// core/constants.ts already takes for CREATIVE_PRESETS.

import type { CreativePreset } from "../core/constants";
import type { CreativeIntent } from "../core/types";

export const PRESET_WORDS_PER_MINUTE: Record<CreativePreset, number> = {
  "classic-asmr": 115,
  "sleep-story": 135,
  meditation: 120,
  "kids-story": 120,
  narrative: 120,
};

export type WordBudget = {
  totalWords: number;
  wordsPerScene: number;
};

// Returns undefined when the intent carries no requested duration -- there
// is nothing deterministic to budget against, and callers should omit
// length guidance entirely rather than guess a default.
export function resolveWordBudget(intent: CreativeIntent, sceneCount: number): WordBudget | undefined {
  if (intent.durationMinutes === undefined || sceneCount <= 0) return undefined;

  const wordsPerMinute = PRESET_WORDS_PER_MINUTE[intent.preset];
  const totalWords = Math.round(intent.durationMinutes * wordsPerMinute);
  const wordsPerScene = Math.max(1, Math.round(totalWords / sceneCount));

  return { totalWords, wordsPerScene };
}
