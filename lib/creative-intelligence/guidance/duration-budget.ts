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

// ---------------------------------------------------------------------------
// Length Governance (RP-011C.8D)
//
// Remaining-word-budget awareness for the Writer Layer's sequential scene
// loop (writer.ts writeStoryWithProvider). Distinct from WordBudget above:
// WordBudget is the static, pre-generation even split; the functions below
// recompute a scene's recommended budget from the *actual* word count of
// already-written scenes, so a scene that overshoots or undershoots its
// guidance shifts what later scenes are told to aim for. Guidance only --
// nothing here truncates text, rewrites text, or makes a provider call.
//
// This module is preset-agnostic by design (config is a parameter, not a
// per-preset lookup) so a later empirical calibration pass only needs new
// config values, not new logic. Today only narrative uses it -- see
// NARRATIVE_LENGTH_GOVERNANCE_CONFIG and its callers in writer.ts.
// ---------------------------------------------------------------------------

export type LengthGovernanceConfig = {
  // Soft overshoot allowance as a fraction of totalWords (e.g. 0.15 = 15%).
  percentageTolerance: number;
  // Absolute word-count cap on that allowance, so long stories don't get a
  // proportionally huge free overshoot (see resolveMaxRecommendedWords).
  absoluteToleranceWords: number;
  // Minimum share of the original even per-scene target (WordBudget.wordsPerScene)
  // the final scene's recommended budget is protected down to, even if
  // earlier scenes overshot and ate into the remaining total.
  finalSceneMinShare: number;
  // RP-011C.8F Future-Scene Reservation: minimum share of the original even
  // per-scene target (WordBudget.wordsPerScene) ANY not-yet-written
  // non-final scene's recommended budget is floored to, even if earlier
  // scenes' overshoot has driven the plain remaining-budget split to zero
  // or below. This is the fix for the RP-011C.8E thriller case, where scene
  // 4's recommendation collapsed to ~1 word two scenes before the end
  // because the pre-8F formula only ever protected the final scene's floor
  // -- every other non-final scene's split had no floor of its own, so once
  // remainingWords dropped below finalSceneFloor the division to the last
  // remaining non-final scene ((0 or negative) / 1) rounded to ~0. Deliberately
  // smaller than finalSceneMinShare (0.4 < 0.6) so the final scene keeps a
  // stronger payoff reserve, and deliberately a floor via Math.max rather
  // than a hard reserve subtracted off the top of every earlier scene's own
  // split -- subtracting a reserve for every future scene up front would
  // inflate EARLY scenes' recommended numbers well past their normal
  // even-split share (worsening exactly the overshoot this exists to catch)
  // instead of just protecting later scenes from collapsing. See
  // resolveRemainingWordBudget's non-final branch for where this applies.
  futureSceneMinShare: number;
  // RP-011C.8H Early Budget-Pressure Detection: fraction of
  // plannedCumulativeWords (see resolvePlannedCumulativeWords) that actual
  // cumulative words may exceed before "budget_pressure" activates for the
  // NEXT scene -- see isBudgetPressureActive. Distinct from
  // percentageTolerance/absoluteToleranceWords above, which compare against
  // the *final* totalWords target; this compares against how much of the
  // budget SHOULD have been used by this point in the story, which is what
  // lets pressure surface after just 1-2 scenes instead of only once the
  // story is nearly done.
  cumulativePressureTolerance: number;
  // Absolute floor (in words) on the allowance derived from
  // cumulativePressureTolerance, so a small planned-cumulative total early
  // in the story (e.g. after just one scene) doesn't trigger budget_pressure
  // off a handful of words of ordinary scene-to-scene variance.
  cumulativePressureMinOvershootWords: number;
};

// Bootstrap values (RP-011C.8D/8F), not final empirical calibration -- see
// duration-budget.ts's header comment on PRESET_WORDS_PER_MINUTE for the
// same caveat. 15%/400-word tolerance clearly blocks the ~60-216% overshoot
// observed in the longform legacy-vs-CI benchmark (RP-011C.8B) while still
// leaving room for a scene to finish its beat; the 400-word absolute cap is
// what keeps a 60+ minute story's free overshoot from scaling up with
// duration. finalSceneMinShare guarantees the resolution scene is never
// told to wrap up in only a handful of words just because earlier scenes
// consumed the remaining budget. futureSceneMinShare (RP-011C.8F) is a
// conservative 0.4 -- comfortably below every non-degenerate recommendation
// actually observed in the RP-011C.8E thriller run (660/549/395, all well
// above 0.4 * 600 = 240), so it only ever activates in the genuinely
// degenerate case it was added to fix, and never overrides the formula's
// normal overshoot-driven shrinkage signal.
// cumulativePressureTolerance/cumulativePressureMinOvershootWords
// (RP-011C.8H) are a bootstrap pair, not a final empirical calibration --
// same caveat as the rest of this config. 25% sits clearly above ordinary
// scene-to-scene variance (a scene running 5-10% long is normal and must
// stay "normal") but clearly below the 56-77% cumulative overshoot the
// RP-011C.8G thriller trace actually showed after its first 1-3 scenes, so
// it activates on a genuinely "deutlichen" overshoot, not noise. The
// 150-word floor exists for the same reason futureSceneMinShare exists --
// early in a story plannedCumulativeWords is small (e.g. one scene's worth),
// so a purely percentage-based allowance would be too easily tripped by a
// handful of words of natural variance.
export const NARRATIVE_LENGTH_GOVERNANCE_CONFIG: LengthGovernanceConfig = {
  percentageTolerance: 0.15,
  absoluteToleranceWords: 400,
  finalSceneMinShare: 0.6,
  futureSceneMinShare: 0.4,
  cumulativePressureTolerance: 0.25,
  cumulativePressureMinOvershootWords: 150,
};

// The soft ceiling for the story's total word count: how far over
// totalWords the story is allowed to run before it's no longer a "small
// overrun." min(...) is what keeps the allowance from scaling up
// proportionally with very long durations.
export function resolveMaxRecommendedWords(totalWords: number, config: LengthGovernanceConfig): number {
  const allowance = Math.min(
    Math.round(totalWords * config.percentageTolerance),
    config.absoluteToleranceWords
  );
  return totalWords + allowance;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

// RP-011C.8F Teil B/Soft-Ceiling-Status, extended by RP-011C.8H: derived
// purely from values the Writer already has (no new state), so the prompt
// can distinguish four situations -- comfortable budget, using budget
// faster than planned but still well under the target, approaching the
// recommended maximum, or already past it. "normal"/"near_limit" split on
// totalWords (the plain target) rather than maxRecommendedWords, since
// maxRecommendedWords is the soft *ceiling*, not the point past which the
// story should already start tightening up. "budget_pressure" sits strictly
// between "normal" and "near_limit" in priority -- see
// resolveStoryBudgetStatus's check order -- so a story that is already at or
// past totalWords keeps reporting "near_limit" (the stronger, more specific
// signal) rather than regressing to the earlier-warning "budget_pressure".
export type StoryBudgetStatus = "normal" | "budget_pressure" | "near_limit" | "over_limit";

// RP-011C.8H Teil A: the story's planned cumulative word consumption AT
// THIS POINT -- i.e. the even per-scene split (WordBudget.wordsPerScene)
// times however many scenes are already written -- as opposed to
// totalWords, which is the planned consumption at the very END of the
// story. Deliberately reuses wordsPerScene (already computed for every
// other calculation in this module) rather than introducing a second,
// independent budget model.
export function resolvePlannedCumulativeWords(wordsPerScene: number, scenesCompleted: number): number {
  return wordsPerScene * Math.max(0, scenesCompleted);
}

// RP-011C.8H Teil B: true when the story's actual cumulative word count is
// already meaningfully ahead of resolvePlannedCumulativeWords -- i.e. the
// story is consuming its budget faster than its own planned pace, even if
// it is nowhere near totalWords yet. See
// NARRATIVE_LENGTH_GOVERNANCE_CONFIG's comment for why the tolerance and
// floor are set where they are.
function isBudgetPressureActive(
  wordsWrittenSoFar: number,
  plannedCumulativeWords: number,
  config: LengthGovernanceConfig
): boolean {
  // plannedCumulativeWords is 0 before any scene has been written yet --
  // nothing to compare actual consumption against.
  if (plannedCumulativeWords <= 0) return false;
  const overshoot = wordsWrittenSoFar - plannedCumulativeWords;
  if (overshoot <= 0) return false;
  const allowance = Math.max(
    Math.round(plannedCumulativeWords * config.cumulativePressureTolerance),
    config.cumulativePressureMinOvershootWords
  );
  return overshoot > allowance;
}

export function resolveStoryBudgetStatus(
  wordsWrittenSoFar: number,
  totalWords: number,
  maxRecommendedWords: number,
  plannedCumulativeWords: number,
  config: LengthGovernanceConfig
): StoryBudgetStatus {
  if (wordsWrittenSoFar >= maxRecommendedWords) return "over_limit";
  if (wordsWrittenSoFar >= totalWords) return "near_limit";
  if (isBudgetPressureActive(wordsWrittenSoFar, plannedCumulativeWords, config)) return "budget_pressure";
  return "normal";
}

export type RemainingWordBudget = {
  totalWords: number;
  maxRecommendedWords: number;
  wordsWrittenSoFar: number;
  // totalWords - wordsWrittenSoFar, clamped to >= 0 so an already-overshot
  // story never produces a negative number in prompt text.
  remainingWords: number;
  recommendedSceneWords: number;
  isFinalScene: boolean;
  // RP-011C.8F Teil B: scenes not yet written, including the one this
  // budget is for -- the same remainingSceneCount passed in, surfaced on
  // the result so the prompt builder can state it without recomputing it.
  remainingSceneCount: number;
  // RP-011C.8F Teil B/Soft-Ceiling-Status -- see resolveStoryBudgetStatus.
  storyBudgetStatus: StoryBudgetStatus;
  // RP-011C.8H Teil A -- see resolvePlannedCumulativeWords. Surfaced mainly
  // for tests/observability; the prompt builder does not need to format
  // this number itself, only react to storyBudgetStatus.
  plannedCumulativeWords: number;
};

// Recomputes what the scene about to be written should aim for, given how
// many words the story has actually used so far. remainingSceneCount counts
// scenes not yet written, including the one this call is for.
export function resolveRemainingWordBudget(params: {
  totalWords: number;
  wordsPerScene: number;
  previousScenesText: string[];
  remainingSceneCount: number;
  config: LengthGovernanceConfig;
}): RemainingWordBudget {
  const { totalWords, wordsPerScene, previousScenesText, remainingSceneCount, config } = params;

  const wordsWrittenSoFar = previousScenesText.reduce((sum, text) => sum + countWords(text), 0);
  const remainingWords = Math.max(0, totalWords - wordsWrittenSoFar);
  const maxRecommendedWords = resolveMaxRecommendedWords(totalWords, config);
  const isFinalScene = remainingSceneCount <= 1;
  // Reserved off the top of remainingWords before splitting the rest across
  // the other, non-final remaining scenes -- this is the "final scene
  // reserve" that stops early scenes from eating the whole remaining budget.
  const finalSceneFloor = Math.max(1, Math.round(wordsPerScene * config.finalSceneMinShare));
  // RP-011C.8F Future-Scene Reservation floor -- see
  // LengthGovernanceConfig.futureSceneMinShare. Applied via Math.max, i.e.
  // as a floor on the *result* of the existing even-split formula below,
  // not as an extra reserve subtracted off the top of it: subtracting a
  // reserve up front for every future non-final scene would inflate early
  // scenes' recommendations well past their normal even-split share.
  // Because this floor is re-applied every time a scene's own budget is
  // computed (recomputed from actual wordsWrittenSoFar so far, not
  // precomputed once), it protects every not-yet-written non-final scene
  // when its own turn comes, regardless of how much earlier scenes
  // overshot -- which is what stops the ~1-word degenerate recommendation
  // seen in the RP-011C.8E thriller run two scenes before the end.
  const futureSceneFloor = Math.max(1, Math.round(wordsPerScene * config.futureSceneMinShare));

  const recommendedSceneWords = isFinalScene
    ? Math.max(finalSceneFloor, remainingWords)
    : Math.max(
        futureSceneFloor,
        Math.round(Math.max(0, remainingWords - finalSceneFloor) / Math.max(1, remainingSceneCount - 1))
      );

  // RP-011C.8H Teil A: scenesCompleted is previousScenesText.length -- the
  // count of scenes already written, i.e. how many even-split shares of
  // wordsPerScene the story SHOULD have consumed by this point.
  const plannedCumulativeWords = resolvePlannedCumulativeWords(wordsPerScene, previousScenesText.length);
  const storyBudgetStatus = resolveStoryBudgetStatus(
    wordsWrittenSoFar,
    totalWords,
    maxRecommendedWords,
    plannedCumulativeWords,
    config
  );

  return {
    totalWords,
    maxRecommendedWords,
    wordsWrittenSoFar,
    remainingWords,
    recommendedSceneWords,
    isFinalScene,
    remainingSceneCount,
    storyBudgetStatus,
    plannedCumulativeWords,
  };
}
