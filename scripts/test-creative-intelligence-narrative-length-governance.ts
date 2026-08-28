// scripts/test-creative-intelligence-narrative-length-governance.ts
//
// RP-011C.8D -- Narrative Pre-Cutover Minimal Capability Patch: Length
// Governance. Regression coverage for the remaining-word-budget awareness
// added to the Writer Layer's sequential scene loop
// (guidance/duration-budget.ts resolveRemainingWordBudget /
// resolveMaxRecommendedWords, wired into writer/writer.ts
// writeStoryWithProvider and surfaced in writer/prompts.ts). Narrative
// only -- other presets keep the pre-existing static per-scene target
// unchanged.
//
// Nothing here calls a provider for real, hits the database, or touches the
// active generation pipeline.
//
// Run with:  npx tsx scripts/test-creative-intelligence-narrative-length-governance.ts

import {
  CreativeKnowledgeRegistry,
  initializeCreativeKnowledge,
  buildCreativeContext,
  buildStoryBlueprint,
  buildSceneBlueprints,
  buildGenerationGuidance,
  buildWriterUserPrompt,
  writeStoryWithProvider,
  resolveWordBudget,
  resolveMaxRecommendedWords,
  resolveRemainingWordBudget,
  resolvePlannedCumulativeWords,
  countWords,
  NARRATIVE_LENGTH_GOVERNANCE_CONFIG,
} from "../lib/creative-intelligence";
import type {
  CreativeContext,
  CreativeIntent,
  CreativeTextProvider,
  GenerationGuidance,
  SceneBlueprint,
  StoryBlueprint,
} from "../lib/creative-intelligence";

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
const CREATED_AT = "2026-01-01T00:00:00.000Z";

function contextFor(intent: CreativeIntent, prompt = "test"): CreativeContext {
  return buildCreativeContext({ rawInput: { prompt }, intent, registry, createdAt: CREATED_AT });
}

function blueprintFor(intent: CreativeIntent, prompt = "test"): StoryBlueprint {
  return buildStoryBlueprint({ intent, context: contextFor(intent, prompt), createdAt: CREATED_AT });
}

function scenesFor(intent: CreativeIntent, prompt = "test"): SceneBlueprint[] {
  const context = contextFor(intent, prompt);
  const blueprint = blueprintFor(intent, prompt);
  return buildSceneBlueprints({ intent, context, blueprint, createdAt: CREATED_AT });
}

function guidanceFor(intent: CreativeIntent, prompt = "test"): GenerationGuidance[] {
  const context = contextFor(intent, prompt);
  const blueprint = blueprintFor(intent, prompt);
  const scenes = buildSceneBlueprints({ intent, context, blueprint, createdAt: CREATED_AT });
  return buildGenerationGuidance({ scenes, blueprint, context, intent, createdAt: CREATED_AT });
}

const narrative20MinIntent: CreativeIntent = {
  preset: "narrative",
  experience: "an immersive narrative built around the listener's request",
  audience: "adult",
  durationMinutes: 20,
  constraints: [],
  storyScale: "arc",
  themes: ["courage"],
};

const narrative60MinIntent: CreativeIntent = {
  ...narrative20MinIntent,
  durationMinutes: 60,
};

const sleepStory30MinIntent: CreativeIntent = {
  preset: "sleep-story",
  experience: "a relaxing bedtime story to help the listener fall asleep",
  audience: "adult",
  durationMinutes: 30,
  constraints: [],
  storyScale: "gentle_journey",
  emotionalDirection: ["calm", "safe"],
};

const meditationIntent: CreativeIntent = {
  preset: "meditation",
  experience: "a guided meditation for centering attention",
  audience: "adult",
  durationMinutes: 12,
  constraints: [],
};

const kidsStoryIntent: CreativeIntent = {
  preset: "kids-story",
  experience: "a gentle, age-safe bedtime story for children",
  audience: "child",
  durationMinutes: 8,
  constraints: ["age-safe: avoid violence, horror, and existential themes"],
  storyScale: "gentle_journey",
  themes: ["friendship"],
  requiredElements: ["gentle_pacing", "safe_resolution", "positive_resolution", "age_safe_language"],
};

const classicAsmrIntent: CreativeIntent = {
  preset: "classic-asmr",
  experience: "a slow, sensory-focused ASMR session",
  audience: "adult",
  durationMinutes: 15,
  constraints: [],
};

// ─── 1. targetWords stays durationMinutes * preset WPM (no regression) ───

{
  check(
    "resolveWordBudget: narrative 20 minutes still uses 120 wpm (unchanged formula)",
    resolveWordBudget(narrative20MinIntent, 5),
    { totalWords: 20 * 120, wordsPerScene: Math.round((20 * 120) / 5) }
  );
}

// ─── 2. Initial scene budget is a sensible even split ─────────────────────

{
  const budget = resolveWordBudget(narrative20MinIntent, 5)!;
  check("initial per-scene budget for a 5-scene, 20-min narrative is 480 words", budget.wordsPerScene, 480);
}

// ─── 3. Overshoot in scene 1 lowers the recommendation for later scenes ──

{
  const totalWords = 3000;
  const wordsPerScene = 600;
  const config = NARRATIVE_LENGTH_GOVERNANCE_CONFIG;

  const onTarget = resolveRemainingWordBudget({
    totalWords,
    wordsPerScene,
    previousScenesText: [Array.from({ length: 600 }, () => "word").join(" ")],
    remainingSceneCount: 4,
    config,
  });
  const overshot = resolveRemainingWordBudget({
    totalWords,
    wordsPerScene,
    previousScenesText: [Array.from({ length: 720 }, () => "word").join(" ")],
    remainingSceneCount: 4,
    config,
  });

  checkTrue(
    "scene 1 overshoot (720 vs 600) lowers the recommended budget for scene 2 relative to hitting the target exactly",
    overshot.recommendedSceneWords < onTarget.recommendedSceneWords
  );
  checkTrue("overshoot case: remainingWords reflects the actual 720-word scene 1", overshot.remainingWords === totalWords - 720);
}

// ─── 4. Undershoot grows the later recommendation / redistributes budget ──

{
  const totalWords = 3000;
  const wordsPerScene = 600;
  const config = NARRATIVE_LENGTH_GOVERNANCE_CONFIG;

  const onTarget = resolveRemainingWordBudget({
    totalWords,
    wordsPerScene,
    previousScenesText: [Array.from({ length: 600 }, () => "word").join(" ")],
    remainingSceneCount: 4,
    config,
  });
  const undershot = resolveRemainingWordBudget({
    totalWords,
    wordsPerScene,
    previousScenesText: [Array.from({ length: 400 }, () => "word").join(" ")],
    remainingSceneCount: 4,
    config,
  });

  checkTrue(
    "scene 1 undershoot (400 vs 600) grows the recommended budget for scene 2",
    undershot.recommendedSceneWords > onTarget.recommendedSceneWords
  );
}

// ─── 5. Absolute overshoot tolerance does not scale unbounded with duration ──

{
  const config = NARRATIVE_LENGTH_GOVERNANCE_CONFIG;
  const shortTotal = 600; // ~5 min narrative
  const longTotal = 7200; // 60 min narrative

  const shortAllowance = resolveMaxRecommendedWords(shortTotal, config) - shortTotal;
  const longAllowance = resolveMaxRecommendedWords(longTotal, config) - longTotal;

  check("short story: allowance is the percentage tolerance (below the absolute cap)", shortAllowance, Math.round(shortTotal * config.percentageTolerance));
  check("long story: allowance is capped at the absolute tolerance, not 15% of total", longAllowance, config.absoluteToleranceWords);
  checkTrue("long story's allowance is a much smaller proportion of total than the short story's", longAllowance / longTotal < shortAllowance / shortTotal);
}

// ─── 6. 60-minute narrative: cap prevents a large proportional free overshoot ──

{
  const budget = resolveWordBudget(narrative60MinIntent, 10)!;
  const maxRecommended = resolveMaxRecommendedWords(budget.totalWords, NARRATIVE_LENGTH_GOVERNANCE_CONFIG);
  const overshootRatio = (maxRecommended - budget.totalWords) / budget.totalWords;

  checkTrue(
    "60-minute narrative: soft ceiling allows well under 20% overshoot (benchmark saw 60-216%)",
    overshootRatio < 0.2
  );
}

// ─── 7. No negative remaining-word budget, even far past target ──────────

{
  const totalWords = 1000;
  const config = NARRATIVE_LENGTH_GOVERNANCE_CONFIG;
  const wayOver = resolveRemainingWordBudget({
    totalWords,
    wordsPerScene: 500,
    previousScenesText: [Array.from({ length: 2000 }, () => "word").join(" ")],
    remainingSceneCount: 2,
    config,
  });

  checkTrue("remainingWords never goes negative even when the story already overshot its target", wayOver.remainingWords >= 0);
  check("remainingWords clamps to exactly 0 once actual words exceed the target", wayOver.remainingWords, 0);
  checkTrue("recommendedSceneWords stays a usable positive number even at 0 remaining", wayOver.recommendedSceneWords > 0);
}

// ─── 8. Final scene keeps enough guidance to complete its beat ───────────

{
  const totalWords = 3000;
  const wordsPerScene = 600;
  const config = NARRATIVE_LENGTH_GOVERNANCE_CONFIG;

  // Heavy overshoot across the first 4 scenes eats almost the entire budget.
  const heavyOvershootBudget = resolveRemainingWordBudget({
    totalWords,
    wordsPerScene,
    previousScenesText: Array.from({ length: 4 }, () => Array.from({ length: 700 }, () => "word").join(" ")),
    remainingSceneCount: 1,
    config,
  });

  checkTrue("final scene is recognized as such (remainingSceneCount <= 1)", heavyOvershootBudget.isFinalScene);
  checkTrue(
    "final scene's recommended budget never collapses below the configured floor share of the original per-scene target",
    heavyOvershootBudget.recommendedSceneWords >= Math.round(wordsPerScene * config.finalSceneMinShare)
  );
}

// ─── 9. countWords is a plain whitespace word count ───────────────────────

{
  check("countWords: empty string is 0 words", countWords(""), 0);
  check("countWords: whitespace-only string is 0 words", countWords("   \n\t "), 0);
  check("countWords: simple sentence", countWords("The quick brown fox jumps."), 5);
}

// ─── 9b. RP-011C.8F: futureSceneMinShare config sanity ──────────────────

{
  const config = NARRATIVE_LENGTH_GOVERNANCE_CONFIG;
  checkTrue("futureSceneMinShare is configured and positive", config.futureSceneMinShare > 0);
  checkTrue(
    "futureSceneMinShare stays below finalSceneMinShare -- final scene keeps the stronger payoff reserve",
    config.futureSceneMinShare < config.finalSceneMinShare
  );
}

// ─── 9c. RP-011C.8F Future-Scene Reservation: reproduces the RP-011C.8E ──
// thriller trace (targetWords 3000, wordsPerScene 600, 5 scenes) and
// verifies scene 4's recommendation -- which collapsed to ~1 word before
// this fix -- is now floored to a non-degenerate value, while scenes 1-3
// reproduce the exact pre-fix recommendations unchanged (the floor is
// inactive there) and the final scene keeps its existing stronger reserve.

{
  const totalWords = 3000;
  const wordsPerScene = 600;
  const config = NARRATIVE_LENGTH_GOVERNANCE_CONFIG;
  const futureFloor = Math.round(wordsPerScene * config.futureSceneMinShare);

  const scene1 = resolveRemainingWordBudget({
    totalWords,
    wordsPerScene,
    previousScenesText: [],
    remainingSceneCount: 5,
    config,
  });
  check("8E trace scene 1: recommendation unchanged by the new floor (660)", scene1.recommendedSceneWords, 660);

  const scene1Text = Array.from({ length: 993 }, () => "word").join(" ");
  const scene2 = resolveRemainingWordBudget({
    totalWords,
    wordsPerScene,
    previousScenesText: [scene1Text],
    remainingSceneCount: 4,
    config,
  });
  check("8E trace scene 2: recommendation unchanged by the new floor (549)", scene2.recommendedSceneWords, 549);

  const scene2Text = Array.from({ length: 858 }, () => "word").join(" ");
  const scene3 = resolveRemainingWordBudget({
    totalWords,
    wordsPerScene,
    previousScenesText: [scene1Text, scene2Text],
    remainingSceneCount: 3,
    config,
  });
  check("8E trace scene 3: recommendation unchanged by the new floor (395)", scene3.recommendedSceneWords, 395);

  const scene3Text = Array.from({ length: 849 }, () => "word").join(" ");
  const scene4 = resolveRemainingWordBudget({
    totalWords,
    wordsPerScene,
    previousScenesText: [scene1Text, scene2Text, scene3Text],
    remainingSceneCount: 2,
    config,
  });
  checkTrue(
    "8E trace scene 4: raw remaining-minus-final-reserve would have been <= 0 (this is the pre-fix degenerate case)",
    scene4.remainingWords - Math.round(wordsPerScene * config.finalSceneMinShare) <= 0
  );
  check("8E trace scene 4: recommendation is floored to futureSceneMinShare's share, not ~1 word", scene4.recommendedSceneWords, futureFloor);
  checkTrue("8E trace scene 4: recommendation is clearly non-degenerate (not 0/1/5 words)", scene4.recommendedSceneWords > 5);

  const scene4Text = Array.from({ length: 1582 }, () => "word").join(" ");
  const scene5 = resolveRemainingWordBudget({
    totalWords,
    wordsPerScene,
    previousScenesText: [scene1Text, scene2Text, scene3Text, scene4Text],
    remainingSceneCount: 1,
    config,
  });
  checkTrue("8E trace scene 5 (final): still recognized as final scene", scene5.isFinalScene);
  check(
    "8E trace scene 5 (final): keeps its pre-existing stronger payoff reserve (360), unaffected by the futureSceneMinShare floor",
    scene5.recommendedSceneWords,
    Math.round(wordsPerScene * config.finalSceneMinShare)
  );
  check("8E trace scene 5 (final): storyBudgetStatus is over_limit once total actual words exceed the soft ceiling", scene5.storyBudgetStatus, "over_limit");
}

// ─── 9d. RP-011C.8F Teil B: storyBudgetStatus classification ────────────

{
  const totalWords = 3000;
  const wordsPerScene = 600;
  const config = NARRATIVE_LENGTH_GOVERNANCE_CONFIG;
  const maxRecommendedWords = resolveMaxRecommendedWords(totalWords, config);

  // RP-011C.8H: 650 words after 1 scene against a 600-word/scene pace is
  // ordinary scene-to-scene variance (~8% over pace) as well as
  // comfortably under totalWords -- this must stay "normal" under both the
  // pre-existing and the new cumulative-pace check. (Before RP-011C.8H this
  // case used 1000 words, a ~67% overshoot of the planned per-scene pace --
  // that is exactly the early-overshoot case budget_pressure now exists to
  // catch, so it moved to its own case below instead of asserting "normal".)
  const normal = resolveRemainingWordBudget({
    totalWords,
    wordsPerScene,
    previousScenesText: [Array.from({ length: 650 }, () => "word").join(" ")],
    remainingSceneCount: 4,
    config,
  });
  check("storyBudgetStatus: comfortably under target and on pace is 'normal'", normal.storyBudgetStatus, "normal");

  const nearLimit = resolveRemainingWordBudget({
    totalWords,
    wordsPerScene,
    previousScenesText: [Array.from({ length: totalWords + 50 }, () => "word").join(" ")],
    remainingSceneCount: 2,
    config,
  });
  checkTrue("storyBudgetStatus: past totalWords but under the soft ceiling is 'near_limit'", nearLimit.storyBudgetStatus === "near_limit");

  const overLimit = resolveRemainingWordBudget({
    totalWords,
    wordsPerScene,
    previousScenesText: [Array.from({ length: maxRecommendedWords + 50 }, () => "word").join(" ")],
    remainingSceneCount: 2,
    config,
  });
  check("storyBudgetStatus: past the soft ceiling is 'over_limit'", overLimit.storyBudgetStatus, "over_limit");
}

// ─── 9e. RP-011C.8F: negative/zero remaining budget never yields absurd values ──

{
  const totalWords = 1000;
  const wordsPerScene = 500;
  const config = NARRATIVE_LENGTH_GOVERNANCE_CONFIG;

  const wayOver = resolveRemainingWordBudget({
    totalWords,
    wordsPerScene,
    previousScenesText: [Array.from({ length: 5000 }, () => "word").join(" ")],
    remainingSceneCount: 3,
    config,
  });

  checkTrue("heavy overshoot, non-final scene: recommendation is floored, not 0/1/5 words", wayOver.recommendedSceneWords > 5);
  check(
    "heavy overshoot, non-final scene: recommendation equals the futureSceneMinShare floor",
    wayOver.recommendedSceneWords,
    Math.round(wordsPerScene * config.futureSceneMinShare)
  );
  check("heavy overshoot: storyBudgetStatus is over_limit", wayOver.storyBudgetStatus, "over_limit");
  check("heavy overshoot: remainingSceneCount is surfaced on the result unchanged from input", wayOver.remainingSceneCount, 3);
}

// ─── 9f. RP-011C.8H Teil A: planned cumulative budget ────────────────────

{
  check("resolvePlannedCumulativeWords: 0 scenes completed plans 0 words", resolvePlannedCumulativeWords(600, 0), 0);
  check("resolvePlannedCumulativeWords: 1 scene completed plans exactly one scene's share", resolvePlannedCumulativeWords(600, 1), 600);
  check("resolvePlannedCumulativeWords: N scenes completed plans N even shares", resolvePlannedCumulativeWords(600, 3), 1800);
}

// ─── 9g. RP-011C.8H Teil B: budget_pressure activation and status priority ──

{
  const totalWords = 3000;
  const wordsPerScene = 600;
  const config = NARRATIVE_LENGTH_GOVERNANCE_CONFIG;

  // 1. On-target progression (actual == planned pace) stays "normal".
  const onPace = resolveRemainingWordBudget({
    totalWords,
    wordsPerScene,
    previousScenesText: [Array.from({ length: 600 }, () => "word").join(" ")],
    remainingSceneCount: 4,
    config,
  });
  check("on-target progression after scene 1 stays 'normal'", onPace.storyBudgetStatus, "normal");

  // 2. Small natural cumulative variance (~10% over pace) stays "normal".
  const smallVariance = resolveRemainingWordBudget({
    totalWords,
    wordsPerScene,
    previousScenesText: [Array.from({ length: 660 }, () => "word").join(" ")],
    remainingSceneCount: 4,
    config,
  });
  check("small natural cumulative variance (~10% over pace) stays 'normal'", smallVariance.storyBudgetStatus, "normal");

  // 3. Deutlicher cumulative overshoot (matches the RP-011C.8G scene-1 shape:
  // planned 600, actual 1060) activates budget_pressure.
  const clearOvershoot = resolveRemainingWordBudget({
    totalWords,
    wordsPerScene,
    previousScenesText: [Array.from({ length: 1060 }, () => "word").join(" ")],
    remainingSceneCount: 4,
    config,
  });
  check("clear cumulative overshoot after scene 1 activates 'budget_pressure'", clearOvershoot.storyBudgetStatus, "budget_pressure");

  // 4. budget_pressure can be active while the story is still clearly under
  // near_limit (wordsWrittenSoFar well below totalWords).
  checkTrue(
    "budget_pressure case is still clearly under totalWords (nowhere near near_limit by the absolute check)",
    clearOvershoot.wordsWrittenSoFar < totalWords * 0.5
  );

  // 5. near_limit stays stronger than budget_pressure: once wordsWrittenSoFar
  // reaches totalWords, status reports near_limit even though the same story
  // is also far ahead of its planned cumulative pace.
  const nearLimitAndOffPace = resolveRemainingWordBudget({
    totalWords,
    wordsPerScene,
    previousScenesText: [Array.from({ length: totalWords + 50 }, () => "word").join(" ")],
    remainingSceneCount: 2,
    config,
  });
  check("near_limit takes priority over budget_pressure when both conditions hold", nearLimitAndOffPace.storyBudgetStatus, "near_limit");

  // 6. over_limit stays the strongest status of all.
  const maxRecommendedWords = resolveMaxRecommendedWords(totalWords, config);
  const overLimitAndOffPace = resolveRemainingWordBudget({
    totalWords,
    wordsPerScene,
    previousScenesText: [Array.from({ length: maxRecommendedWords + 50 }, () => "word").join(" ")],
    remainingSceneCount: 2,
    config,
  });
  check("over_limit takes priority over budget_pressure and near_limit", overLimitAndOffPace.storyBudgetStatus, "over_limit");
}

// ─── 9h. RP-011C.8H: reproduces the RP-011C.8G thriller trace ───────────
// (targetWords 3000, wordsPerScene 600, 5 scenes, actual per-scene words
// 1060/823/1021/244/855) and verifies budget_pressure activates several
// scenes before the final scene, well before near_limit used to be the
// first non-"normal" signal.

{
  const totalWords = 3000;
  const wordsPerScene = 600;
  const config = NARRATIVE_LENGTH_GOVERNANCE_CONFIG;
  const actualPerScene = [1060, 823, 1021, 244, 855];
  const sceneCount = actualPerScene.length;

  const statuses: string[] = [];
  const previousScenesText: string[] = [];
  for (let index = 0; index < sceneCount; index++) {
    const budget = resolveRemainingWordBudget({
      totalWords,
      wordsPerScene,
      previousScenesText: [...previousScenesText],
      remainingSceneCount: sceneCount - index,
      config,
    });
    statuses.push(budget.storyBudgetStatus);
    previousScenesText.push(Array.from({ length: actualPerScene[index] }, () => "word").join(" "));
  }

  check(
    "8G trace: budget_pressure activates for scene 2 onward, well before the final scene's near_limit",
    statuses,
    ["normal", "budget_pressure", "budget_pressure", "budget_pressure", "near_limit"]
  );
  checkTrue(
    "8G trace: budget_pressure is active strictly before the final scene is written",
    statuses.slice(0, sceneCount - 1).includes("budget_pressure")
  );
}

// ─── 10. Writer prompt: narrative-only dynamic length guidance ───────────

{
  const context = contextFor(narrative20MinIntent);
  const blueprint = blueprintFor(narrative20MinIntent);
  const scenes = scenesFor(narrative20MinIntent);
  const guidance = guidanceFor(narrative20MinIntent);
  const wordBudget = resolveWordBudget(narrative20MinIntent, scenes.length)!;

  const lengthGovernance = resolveRemainingWordBudget({
    totalWords: wordBudget.totalWords,
    wordsPerScene: wordBudget.wordsPerScene,
    previousScenesText: [],
    remainingSceneCount: scenes.length,
    config: NARRATIVE_LENGTH_GOVERNANCE_CONFIG,
  });

  const prompt = buildWriterUserPrompt({
    scene: scenes[0],
    guidance: guidance[0],
    blueprint,
    context,
    intent: narrative20MinIntent,
    lengthGovernance,
  });

  checkTrue(
    "narrative prompt with lengthGovernance states the dynamic recommended word count",
    prompt.includes(`Aim to complete this scene within approximately ${lengthGovernance.recommendedSceneWords} words`)
  );
  checkTrue(
    "narrative prompt with lengthGovernance states the story-wide remaining budget",
    prompt.includes(`${lengthGovernance.remainingWords} words remaining`)
  );
  checkTrue(
    "narrative prompt with lengthGovernance explicitly frames this as guidance, not a hard limit",
    /small overrun is acceptable/i.test(prompt) && /guidance, not a hard limit/i.test(prompt)
  );
  checkTrue(
    "narrative prompt with lengthGovernance never demands a mechanical stop / hard cut",
    !/must (be )?exactly|hard cut|stop writing at/i.test(prompt)
  );

  // Without lengthGovernance (e.g. a direct buildWriterUserPrompt call, as
  // the pre-existing duration-budget test suite still makes), narrative
  // falls back to the original static per-scene line unchanged.
  const staticPrompt = buildWriterUserPrompt({
    scene: scenes[0],
    guidance: guidance[0],
    blueprint,
    context,
    intent: narrative20MinIntent,
  });
  checkTrue(
    "narrative prompt without lengthGovernance keeps the original static length-target line",
    staticPrompt.includes(`Length target for this scene: approximately ${guidance[0].targetWordCount} words (guidance, not a hard limit).`)
  );
}

// ─── 11. Other presets never receive lengthGovernance / dynamic phrasing ──

for (const intent of [sleepStory30MinIntent, meditationIntent, kidsStoryIntent, classicAsmrIntent]) {
  const context = contextFor(intent);
  const blueprint = blueprintFor(intent);
  const scenes = scenesFor(intent);
  const guidance = guidanceFor(intent);

  const prompt = buildWriterUserPrompt({ scene: scenes[0], guidance: guidance[0], blueprint, context, intent });

  checkTrue(
    `${intent.preset}: writer prompt still uses the static per-scene length target (no regression)`,
    prompt.includes(`Length target for this scene: approximately ${guidance[0].targetWordCount} words (guidance, not a hard limit).`)
  );
  checkTrue(`${intent.preset}: writer prompt does not contain narrative's dynamic remaining-budget phrasing`, !prompt.includes("words remaining toward its"));
}

// ─── 11b. RP-011C.8F Teil B: prompt states global story-budget context ──

{
  const context = contextFor(narrative20MinIntent);
  const blueprint = blueprintFor(narrative20MinIntent);
  const scenes = scenesFor(narrative20MinIntent);
  const guidance = guidanceFor(narrative20MinIntent);
  const wordBudget = resolveWordBudget(narrative20MinIntent, scenes.length)!;

  const lengthGovernance = resolveRemainingWordBudget({
    totalWords: wordBudget.totalWords,
    wordsPerScene: wordBudget.wordsPerScene,
    previousScenesText: [Array.from({ length: 200 }, () => "word").join(" ")],
    remainingSceneCount: scenes.length - 1,
    config: NARRATIVE_LENGTH_GOVERNANCE_CONFIG,
  });

  const prompt = buildWriterUserPrompt({
    scene: scenes[1],
    guidance: guidance[1],
    blueprint,
    context,
    intent: narrative20MinIntent,
    lengthGovernance,
  });

  checkTrue("prompt states the global story budget line", prompt.includes("Story budget so far:"));
  checkTrue("prompt states words already written", prompt.includes(`${lengthGovernance.wordsWrittenSoFar} words written`));
  checkTrue(
    "prompt states scenes remaining including the current one",
    prompt.includes(`${lengthGovernance.remainingSceneCount} scenes left to write including this one`)
  );
  checkTrue("prompt states the soft ceiling value alongside the target", prompt.includes(`soft ceiling ~${lengthGovernance.maxRecommendedWords} words`));
}

// ─── 11c. RP-011C.8F: near_limit / over_limit focus guidance ─────────────

{
  const context = contextFor(narrative20MinIntent);
  const blueprint = blueprintFor(narrative20MinIntent);
  const scenes = scenesFor(narrative20MinIntent);
  const guidance = guidanceFor(narrative20MinIntent);

  function withStatus(status: "normal" | "near_limit" | "over_limit") {
    const totalWords = 3000;
    const wordsWrittenSoFar =
      status === "normal" ? 500 : status === "near_limit" ? totalWords + 50 : resolveMaxRecommendedWords(totalWords, NARRATIVE_LENGTH_GOVERNANCE_CONFIG) + 50;

    return resolveRemainingWordBudget({
      totalWords,
      wordsPerScene: 600,
      previousScenesText: [Array.from({ length: wordsWrittenSoFar }, () => "word").join(" ")],
      remainingSceneCount: 3,
      config: NARRATIVE_LENGTH_GOVERNANCE_CONFIG,
    });
  }

  const normalPrompt = buildWriterUserPrompt({
    scene: scenes[0],
    guidance: guidance[0],
    blueprint,
    context,
    intent: narrative20MinIntent,
    lengthGovernance: withStatus("normal"),
  });
  checkTrue("normal status: no near-limit/over-limit focus guidance appears", !/close to its overall recommended length|past its overall recommended maximum/i.test(normalPrompt));

  const nearLimitPrompt = buildWriterUserPrompt({
    scene: scenes[0],
    guidance: guidance[0],
    blueprint,
    context,
    intent: narrative20MinIntent,
    lengthGovernance: withStatus("near_limit"),
  });
  checkTrue("near_limit status: prompt states the story is close to its recommended length", /close to its overall recommended length/i.test(nearLimitPrompt));
  checkTrue(
    "near_limit status: prompt prioritizes necessary beats (action, decision/consequence, reveal/payoff, transition)",
    /Prioritize: necessary action, decision and consequence, the scene's clue\/reveal or payoff, and the essential transition/i.test(nearLimitPrompt)
  );
  checkTrue(
    "near_limit status: prompt tells the writer to avoid detours/reflection/redundant dialogue/repetition/new subplots",
    /Avoid: secondary detours, extended reflection, redundant dialogue, repeated description, and introducing unnecessary new subplots/i.test(nearLimitPrompt)
  );
  checkTrue("near_limit status: does not yet say the story is already past its maximum", !/past its overall recommended maximum/i.test(nearLimitPrompt));

  const overLimitPrompt = buildWriterUserPrompt({
    scene: scenes[0],
    guidance: guidance[0],
    blueprint,
    context,
    intent: narrative20MinIntent,
    lengthGovernance: withStatus("over_limit"),
  });
  checkTrue("over_limit status: prompt states the story is already past its recommended maximum", /past its overall recommended maximum/i.test(overLimitPrompt));
  checkTrue(
    "over_limit status: prompt explicitly says not to open new optional beats/subplots",
    /Do not open any new optional beats or subplots/i.test(overLimitPrompt)
  );

  for (const prompt of [normalPrompt, nearLimitPrompt, overLimitPrompt]) {
    checkTrue(
      "no status ever produces hard-truncation / mechanical-stop language",
      !/must (be )?exactly|hard cut|stop writing at|do not exceed \d+ words under any circumstances/i.test(prompt)
    );
  }
}

// ─── 11d. RP-011C.8H Teil C/D: budget_pressure focus guidance ───────────

{
  const context = contextFor(narrative20MinIntent);
  const blueprint = blueprintFor(narrative20MinIntent);
  const scenes = scenesFor(narrative20MinIntent);
  const guidance = guidanceFor(narrative20MinIntent);
  const config = NARRATIVE_LENGTH_GOVERNANCE_CONFIG;

  const budgetPressureBudget = resolveRemainingWordBudget({
    totalWords: 3000,
    wordsPerScene: 600,
    previousScenesText: [Array.from({ length: 1060 }, () => "word").join(" ")],
    remainingSceneCount: 4,
    config,
  });
  check("sanity: the fixture used below is actually classified as budget_pressure", budgetPressureBudget.storyBudgetStatus, "budget_pressure");

  const budgetPressurePrompt = buildWriterUserPrompt({
    scene: scenes[1],
    guidance: guidance[1],
    blueprint,
    context,
    intent: narrative20MinIntent,
    lengthGovernance: budgetPressureBudget,
  });

  checkTrue(
    "budget_pressure status: focus guidance appears in the prompt",
    /using its word budget faster than planned/i.test(budgetPressurePrompt)
  );
  checkTrue(
    "budget_pressure status: guidance explicitly says not to omit turning points/reveals/decisions/consequences",
    /do not omit or skip necessary turning points, reveals, decisions, or consequences/i.test(budgetPressurePrompt)
  );
  checkTrue(
    "budget_pressure status: guidance protects central plot action, decisions, consequences, clues/reveals, turning points, relationship changes, and payoff",
    /Protect: central plot action, character decisions, consequences, clues and reveals, confrontations and turning points, relationship changes, necessary transitions, and the eventual payoff\/ending/i.test(
      budgetPressurePrompt
    )
  );
  checkTrue(
    "budget_pressure status: guidance reduces repeated atmosphere, redundant description, extended reflection, secondary detours, and optional subplots first",
    /Reduce first, before touching any of the above: repeated atmosphere, redundant description, extended reflection, secondary detours/i.test(
      budgetPressurePrompt
    )
  );
  checkTrue(
    "budget_pressure status: does not say the story is already near/past its overall recommended length (weaker than near_limit/over_limit)",
    !/close to its overall recommended length|past its overall recommended maximum/i.test(budgetPressurePrompt)
  );
  checkTrue(
    "budget_pressure status: no hard-truncation / mechanical-stop language",
    !/must (be )?exactly|hard cut|stop writing at|do not exceed \d+ words under any circumstances/i.test(budgetPressurePrompt)
  );

  // A story that is normal by both checks (on pace, comfortably under
  // target) never shows the budget_pressure guidance.
  const normalBudget = resolveRemainingWordBudget({
    totalWords: 3000,
    wordsPerScene: 600,
    previousScenesText: [Array.from({ length: 600 }, () => "word").join(" ")],
    remainingSceneCount: 4,
    config,
  });
  const normalPromptForPressureCheck = buildWriterUserPrompt({
    scene: scenes[1],
    guidance: guidance[1],
    blueprint,
    context,
    intent: narrative20MinIntent,
    lengthGovernance: normalBudget,
  });
  checkTrue(
    "normal status: budget_pressure guidance does not appear",
    !/using its word budget faster than planned/i.test(normalPromptForPressureCheck)
  );
}

// ─── 12. writeStoryWithProvider: narrative gets lengthGovernance end to end ──

function makeCapturingProvider(captured: string[]): CreativeTextProvider {
  return {
    async generateText(input) {
      captured.push(input.userPrompt);
      // Echo back a fixed-length placeholder so word counts are deterministic.
      return Array.from({ length: 50 }, () => "word").join(" ");
    },
  };
}

async function run(): Promise<void> {
  {
    const intent = narrative20MinIntent;
    const context = contextFor(intent);
    const blueprint = blueprintFor(intent);
    const scenes = scenesFor(intent);
    const guidance = guidanceFor(intent);
    const captured: string[] = [];

    await writeStoryWithProvider({
      scenes,
      guidance,
      blueprint,
      context,
      intent,
      provider: makeCapturingProvider(captured),
      createdAt: CREATED_AT,
    });

    checkTrue(
      "narrative writeStoryWithProvider: every scene prompt after the first carries a recomputed remaining-budget line",
      captured.slice(1).every((prompt) => /words remaining toward its/.test(prompt))
    );
    checkTrue(
      "narrative writeStoryWithProvider: the last scene's prompt marks itself as the final scene",
      captured[captured.length - 1].includes("This is the final scene")
    );
  }

  // RP-011C.8H: an early overshoot activates budget_pressure guidance for
  // the NEXT scene, without starving later scenes -- futureSceneFloor and
  // the final scene's payoff protection stay intact end to end.
  {
    const intent = narrative20MinIntent;
    const context = contextFor(intent);
    const blueprint = blueprintFor(intent);
    const scenes = scenesFor(intent);
    const guidance = guidanceFor(intent);
    const captured: string[] = [];
    let callIndex = 0;

    await writeStoryWithProvider({
      scenes,
      guidance,
      blueprint,
      context,
      intent,
      // Scene 0 overshoots heavily (900 words against a 480-word/scene
      // pace); every later scene echoes back a small, deliberately
      // low-but-not-degenerate word count so the test can also confirm no
      // later scene collapses to an absurd recommendation.
      provider: {
        async generateText(input) {
          captured.push(input.userPrompt);
          const wordCount = callIndex === 0 ? 900 : 50;
          callIndex++;
          return Array.from({ length: wordCount }, () => "word").join(" ");
        },
      },
      createdAt: CREATED_AT,
    });

    checkTrue("early-overshoot scenario: scene 0's own prompt has no budget_pressure guidance yet (nothing written before it)", !/using its word budget faster than planned/i.test(captured[0]));
    checkTrue(
      "early-overshoot scenario: scene 1's prompt (written right after the overshoot) carries budget_pressure guidance",
      /using its word budget faster than planned/i.test(captured[1])
    );
    checkTrue(
      "early-overshoot scenario: budget_pressure guidance protects turning points/reveals/decisions/consequences",
      /do not omit or skip necessary turning points, reveals, decisions, or consequences/i.test(captured[1])
    );

    const recommendedWordsPerScene = captured.map((prompt) => {
      const match = prompt.match(/Aim to complete this scene within approximately (\d+) words/);
      return match ? Number(match[1]) : null;
    });
    checkTrue(
      "early-overshoot scenario: no later scene's recommendation collapses to a ~1-word degenerate value",
      recommendedWordsPerScene.slice(1).every((words) => words !== null && words > 5)
    );
    checkTrue(
      "early-overshoot scenario: the final scene's prompt still marks itself final and keeps the payoff-protection line",
      captured[captured.length - 1].includes("This is the final scene") &&
        /prioritize fully completing the story's payoff and resolution/i.test(captured[captured.length - 1])
    );
  }

  // Regression: other presets still complete without lengthGovernance-related
  // phrasing appearing anywhere in their prompts.
  for (const intent of [sleepStory30MinIntent, meditationIntent, kidsStoryIntent, classicAsmrIntent]) {
    const context = contextFor(intent);
    const blueprint = blueprintFor(intent);
    const scenes = scenesFor(intent);
    const guidance = guidanceFor(intent);
    const captured: string[] = [];

    const generated = await writeStoryWithProvider({
      scenes,
      guidance,
      blueprint,
      context,
      intent,
      provider: makeCapturingProvider(captured),
      createdAt: CREATED_AT,
    });

    checkTrue(`${intent.preset}: writeStoryWithProvider still completes without error`, generated.length === scenes.length);
    checkTrue(
      `${intent.preset}: no prompt carries narrative's dynamic remaining-budget phrasing`,
      captured.every((prompt) => !prompt.includes("words remaining toward its"))
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
