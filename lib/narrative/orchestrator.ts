// lib/narrative/orchestrator.ts
//
// Pass-C2: production orchestration for long-form Narrative Story generation.
//
// The single-call path remains the live path for short Narrative Story renders.
// When the requested duration crosses LONGFORM_THRESHOLD_SEC, the orchestrator
// takes over: it builds a StoryBible once, then writes the story as a
// consecutive sequence of segments, threading the bible, prior summaries, and
// the previous segment's tail into each call. Segments are NOT assigned
// dramatic roles (setup / midpoint / climax / resolution); they are simply
// consecutive rhetorical sections, in order to honor the research-based
// "no beat sheet" architecture established in Pass A/B/C1.
//
// No duration calibration, no retries, no parallelization, no chapter
// headings, no markdown, no role labels.

import {
  buildStoryOutline,
  generateStorySegment,
  mergeNarrativeSegments,
} from "./outline-and-segments";
import { editNarrativeLongform } from "./editor";
import { compressWriteNarrative } from "./compression-writer";
import { hierarchicalRewriteNarrative } from "./hierarchical-rewrite";
import { structuralRepairNarrative } from "./structural-repair";
import { evaluateStoryQuality } from "@/lib/story-supervisor";
import type { NarrativeSegment, SegmentState, StoryBible } from "./types";

// Pre-pass router threshold. If merged-words / wordTarget is at or above
// this ratio, the draft is treated as materially overshooting target and the
// orchestrator hands the merged draft to the Compression Writer (a dedicated
// writer-framed rewrite stage). Below the threshold, the orchestrator runs
// the existing polish editor unchanged. The router is deterministic and adds
// zero OpenAI calls.
const COMPRESSION_OVERSHOOT_RATIO = 1.10;

// Final-supervisor score gate. Scores at or above this threshold are accepted
// as-is and skip both repair-light and structural repair. Scores below it
// trigger ONE repair-light editor pass followed by a single re-evaluation, and
// remain eligible for the structural repair stage. There is no further retry
// loop.
const REPAIR_SCORE_THRESHOLD = 85;

// Upper duration bound for the conservative structural repair stage. Stories
// longer than this skip the structural pass entirely — at that scale a whole-
// story rewrite is too expensive and too likely to disturb the literary voice
// the earlier stages established. Matches the repair-light "0 attempts" cliff.
const STRUCTURAL_REPAIR_DURATION_LIMIT_SEC = 45 * 60;

// Initial editorial route. "compression-writer" routes to the dedicated
// Compression Writer stage; "polish" routes to the existing polish editor.
type InitialRoute = "compression-writer" | "polish";

// Deterministic router. Inspects merged word count vs. word target and picks
// which initial editorial pass to run. Kept as a pure helper so the decision
// is observable in logs and testable in isolation.
function pickInitialRoute(
  mergedWords: number,
  wordTarget: number,
): InitialRoute {
  if (wordTarget <= 0) return "polish";
  const ratio = mergedWords / wordTarget;
  return ratio >= COMPRESSION_OVERSHOOT_RATIO ? "compression-writer" : "polish";
}

// Duration-aware cap on additional repair-light attempts after the first
// supervisor verdict. The longer the story, the more expensive a whole-story
// repair pass is — and the higher the risk that the editor degrades emotional
// transitions or collapses scenes. So the budget shrinks as duration grows:
//
//     duration ≤ 20 min   → up to 2 repair attempts
//   20 min < duration ≤ 45 min → at most 1 repair attempt
//   45 min < duration   → no repair attempts (copy-editor + supervisor only)
//
// The "best version wins" loop in orchestrateLongformNarrative still keeps the
// pre-repair text and score as a floor, so a 0-attempt budget cannot degrade
// quality — it just means the post-merge output is whatever the copy editor
// produced.
export function pickMaxRepairAttempts(durationSec: number): number {
  const sec = Number.isFinite(durationSec) ? Math.round(durationSec) : 0;
  if (sec <= 20 * 60) return 2;
  if (sec <= 45 * 60) return 1;
  return 0;
}

// Threshold above (and including) which the orchestrator runs. Stories below
// this duration continue to use the single-call narrative path unchanged.
export const LONGFORM_THRESHOLD_SEC = 20 * 60;

// Segment-count mapping. Segments are simply consecutive rhetorical sections;
// no segment is pre-assigned a dramatic role.
//   20–30 min  → 3 segments
//   30–45 min  → 4 segments
//   45–60 min  → 5 segments
// Durations outside [20, 60] min are not part of the production envelope but
// are mapped sensibly (clamped at 3 below, 5 above) so the orchestrator never
// faces an undefined segment count.
export function pickNarrativeSegmentCount(durationSec: number): number {
  const sec = Number.isFinite(durationSec) ? Math.round(durationSec) : 0;
  if (sec < 30 * 60) return 3;
  if (sec < 45 * 60) return 4;
  return 5;
}

export type OrchestrateLongformNarrativeInput = {
  userPrompt: string;
  outputLanguage: "English" | "German";
  targetDurationSec: number;
  // Total word target across the whole story. Each segment gets total/N.
  wordTarget: number;
  // Optional caller-side hints, forwarded to the outline call only.
  genre?: string;
  title?: string;
  // Optional model / timeout overrides forwarded to both outline and segment
  // calls. The lower modules respect their own env-var defaults when unset.
  outlineModel?: string;
  segmentModel?: string;
  outlineTimeoutMs?: number;
  segmentTimeoutMs?: number;
};

export type OrchestrateLongformNarrativeOutput = {
  finalText: string;
  segmentCount: number;
  mergedWords: number;
  bible: StoryBible;
};

export async function orchestrateLongformNarrative(
  input: OrchestrateLongformNarrativeInput,
): Promise<OrchestrateLongformNarrativeOutput> {
  const startedAt = Date.now();
  const durationSec = Math.max(1, Math.round(input.targetDurationSec));
  const totalWordTarget = Math.max(300, Math.round(input.wordTarget));
  const segmentCount = pickNarrativeSegmentCount(durationSec);
  const perSegmentWordTarget = Math.max(
    200,
    Math.round(totalWordTarget / segmentCount),
  );

  console.log(
    "[NARRATIVE-ORCH]",
    "phase=start",
    `durationSec=${durationSec}`,
    `segmentCount=${segmentCount}`,
    `totalWordTarget=${totalWordTarget}`,
    `perSegmentWordTarget=${perSegmentWordTarget}`,
    `lang=${input.outputLanguage}`,
  );

  const bible = await buildStoryOutline({
    userPrompt: input.userPrompt,
    outputLanguage: input.outputLanguage,
    targetDurationSec: durationSec,
    wordTarget: totalWordTarget,
    genre: input.genre,
    title: input.title,
    model: input.outlineModel,
    timeoutMs: input.outlineTimeoutMs,
  });

  console.log(
    "[NARRATIVE-ORCH]",
    "phase=outline.done",
    `trajectory=${bible.trajectoryShape}`,
    `endingTone=${bible.endingTone}`,
    `endingApproach=${bible.endingApproach}`,
    `primaryQ="${bible.primaryStoryQuestion.slice(0, 80).replace(/\s+/g, " ")}"`,
  );

  let state: SegmentState = {
    emotionalState: "settled, attentive",
    relationshipChanges: [],
    unresolvedQuestions: [...bible.unresolvedQuestions],
    settingChanges: [],
    elapsedTime: "the opening of the story",
  };
  const summaries: string[] = [];
  const segments: NarrativeSegment[] = [];
  let previousSegmentText = "";

  for (let i = 0; i < segmentCount; i++) {
    const index = i + 1;
    const isFinalSegment = i === segmentCount - 1;
    console.log(
      "[NARRATIVE-ORCH]",
      "phase=segment.begin",
      `index=${index}`,
      `of=${segmentCount}`,
      `isFinalSegment=${isFinalSegment ? "yes" : "no"}`,
    );

    const seg = await generateStorySegment({
      bible,
      priorState: state,
      priorSummaries: summaries,
      outputLanguage: input.outputLanguage,
      wordTarget: perSegmentWordTarget,
      previousSegmentText: previousSegmentText || undefined,
      isFinalSegment,
      model: input.segmentModel,
      timeoutMs: input.segmentTimeoutMs,
    });

    const segWords = seg.text.split(/\s+/).filter(Boolean).length;
    console.log(
      "[NARRATIVE-ORCH]",
      "phase=segment.done",
      `index=${index}`,
      `words=${segWords}`,
    );

    segments.push(seg);
    summaries.push(seg.summary);
    state = seg.stateAfter;
    previousSegmentText = seg.text;
  }

  const mergedText = mergeNarrativeSegments(segments);
  const mergedWords = mergedText.split(/\s+/).filter(Boolean).length;

  console.log(
    "[NARRATIVE-ORCH]",
    "phase=merge.done",
    `mergedWords=${mergedWords}`,
  );

  // Pre-pass router. Picks the initial editorial route based on how far the
  // merged draft sits from its word target. The router is deterministic — no
  // extra OpenAI call — and chooses between the Compression Writer (for
  // material overshoot) and the polish editor (for drafts already near
  // target). The "repair-light" editor mode is reserved for the post-
  // supervisor gate below.
  const initialRoute = pickInitialRoute(mergedWords, totalWordTarget);
  const overshootRatio = totalWordTarget > 0
    ? Math.round((mergedWords / totalWordTarget) * 1000) / 1000
    : 0;
  console.info(
    `[NARRATIVE-ROUTER] mergedWords=${mergedWords} wordTarget=${totalWordTarget} ratio=${overshootRatio} threshold=${COMPRESSION_OVERSHOOT_RATIO} route=${initialRoute}`,
  );

  // Post-merge editorial stage.
  //
  // Step 1 (route-specific rewrite): On the compression route, hand the merged
  // draft to the hierarchical rewriter (with the compression-writer as
  // fallback). On the polish route, this step is a no-op — `finalText` stays
  // equal to `mergedText` and proceeds directly to the global copy-editor.
  //
  // Step 2 (always-on Copy Editor, Stage A): runs on whatever `finalText` the
  // route produced — including the merged polish draft, the hierarchical
  // output, and the compression-writer output (both as the primary
  // compression result and as the hierarchical→compression fallback). The
  // copy editor is a narrow mechanical pass for grammar, references,
  // continuity, and atmospheric repetition.
  //
  // Both steps are failure-tolerant — any failure falls back silently to the
  // pre-stage text. Kill switch: SKIP_EDITOR_PASS=1 bypasses BOTH steps,
  // matching prior behavior.
  let finalText = mergedText;
  let copyEditorRan = false;
  let repairLightRan = false;
  if (process.env.SKIP_EDITOR_PASS === "1") {
    console.info("[EDITOR:C3E] skipped reason=SKIP_EDITOR_PASS preset=narrative");
  } else {
    if (initialRoute === "compression-writer") {
      console.info(
        `[HIERARCHICAL_ROUTE] phase=start mergedWords=${mergedWords} wordTarget=${totalWordTarget}`,
      );

      let hierarchicalUsed = false;
      let fallbackReason: string | null = null;
      try {
        const hierarchical = await hierarchicalRewriteNarrative({
          mergedText,
          bible,
          outputLanguage: input.outputLanguage,
          wordTarget: totalWordTarget,
          targetDurationSec: durationSec,
        });
        const hierarchicalText = (hierarchical.text ?? "").trim();
        // Lower-bound guard. A catastrophic scene failure (e.g.
        // response_truncated) can leave the hierarchical rewrite far short
        // of the word target. Such damaged output must NOT propagate to the
        // copy editor / supervisor / repair stages — those passes will
        // try (and fail) to rescue raw outline fragments or note blocks.
        // Anything below 90% of the word target is treated as a failed
        // hierarchical run, and the orchestrator falls through to the
        // existing compression-writer fallback below.
        const targetMin = totalWordTarget > 0
          ? Math.round(totalWordTarget * 0.9)
          : 0;
        if (!hierarchicalText) {
          fallbackReason = "empty_text";
        } else if (hierarchical.wordCount <= 0) {
          fallbackReason = "non_positive_word_count";
        } else if (
          totalWordTarget > 0 &&
          hierarchical.wordCount < targetMin
        ) {
          console.warn(
            `[HIERARCHICAL_ROUTE] failed reason=below_lower_bound words=${hierarchical.wordCount} targetMin=${targetMin} using=compression_writer`,
          );
          fallbackReason = "below_lower_bound";
        } else if (
          totalWordTarget > 0 &&
          hierarchical.wordCount > Math.round(totalWordTarget * 1.15)
        ) {
          // Hierarchical produced usable prose but materially overshot the
          // word target. Treat as unacceptable and fall through to the
          // existing compression-writer fallback below.
          console.info(
            `[HIERARCHICAL_ROUTE] phase=fallback_to_compression_writer reason=hierarchical_still_over_target words=${hierarchical.wordCount} wordTarget=${totalWordTarget}`,
          );
          fallbackReason = "hierarchical_still_over_target";
        } else {
          console.info(
            `[HIERARCHICAL_ROUTE] phase=hierarchical.done words=${hierarchical.wordCount} extractedSceneCount=${hierarchical.extractedSceneCount} consolidatedSceneCount=${hierarchical.consolidatedSceneCount}`,
          );
          finalText = hierarchicalText;
          hierarchicalUsed = true;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        fallbackReason = `caller_threw:${msg.slice(0, 160)}`;
      }

      if (!hierarchicalUsed) {
        console.info(
          `[HIERARCHICAL_ROUTE] phase=fallback_to_compression_writer reason=${fallbackReason ?? "unknown"}`,
        );

        // Upper-bound guard band for compression-writer output. The
        // compression writer itself can overshoot substantially (~126%
        // observed). When the candidate sits above compressionTargetMax,
        // perform ONE tighten pass — the compression writer re-invoked on
        // its own previous output. The tighten reuses the literary-novelist
        // framing (preserve prose voice, atmosphere, TTS pacing; remove
        // duplicated functions / explanation; never summarize). Acceptance
        // is strict: the tightened text must land at or below the upper
        // bound. Otherwise (still above, empty, or thrown) we keep the
        // original compression-writer text — best version wins, never
        // damage good prose to hit a number.
        const compressionTargetMin = Math.round(totalWordTarget * 0.9);
        const compressionTargetMax = Math.round(totalWordTarget * 1.15);
        void compressionTargetMin;

        let compressionText = mergedText;
        let compressionRan = false;
        try {
          const compressionResult = await compressWriteNarrative({
            mergedText,
            outputLanguage: input.outputLanguage,
            wordTarget: totalWordTarget,
            durationSec,
          });
          const rewrittenText = (compressionResult.finalText ?? "").trim();
          compressionText = rewrittenText || mergedText;
          compressionRan = rewrittenText.length > 0;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(
            `[COMPRESSION_WRITER] failed reason=caller_threw:${msg.slice(0, 160)} preset=narrative using=unedited_text`,
          );
          compressionText = mergedText;
        }

        const compressionWriterWords =
          compressionText.split(/\s+/).filter(Boolean).length;

        if (
          compressionRan &&
          totalWordTarget > 0 &&
          compressionWriterWords > compressionTargetMax
        ) {
          let tightenedText = "";
          try {
            const tightenedResult = await compressWriteNarrative({
              mergedText: compressionText,
              outputLanguage: input.outputLanguage,
              wordTarget: totalWordTarget,
              durationSec,
            });
            tightenedText = (tightenedResult.finalText ?? "").trim();
          } catch {
            tightenedText = "";
          }

          if (!tightenedText) {
            console.info(
              `[COMPRESSION_WRITER] phase=tighten.rejected reason=empty_or_invalid using=original_compression_text`,
            );
          } else {
            const tightenedWords =
              tightenedText.split(/\s+/).filter(Boolean).length;
            if (tightenedWords <= compressionTargetMax) {
              console.info(
                `[COMPRESSION_WRITER] phase=tighten.success originalWords=${compressionWriterWords} tightenedWords=${tightenedWords} targetMax=${compressionTargetMax}`,
              );
              compressionText = tightenedText;
            } else {
              console.info(
                `[COMPRESSION_WRITER] phase=tighten.rejected reason=still_above_upper_bound originalWords=${compressionWriterWords} tightenedWords=${tightenedWords} targetMax=${compressionTargetMax}`,
              );
            }
          }
        }

        finalText = compressionText;
      }

      const routeFinalWords = finalText.split(/\s+/).filter(Boolean).length;
      console.info(
        `[HIERARCHICAL_ROUTE] phase=done finalWords=${routeFinalWords}`,
      );
    }

    // Global Copy Editor pass. Runs on ALL routes (polish, compression-writer,
    // hierarchical, hierarchical→compression fallback) so no route bypasses
    // the mechanical pass. Operates on whatever `finalText` the route above
    // produced — for the polish route, that's still the merged draft.
    const preEditorText = finalText;
    try {
      const editorResult = await editNarrativeLongform({
        finalText: preEditorText,
        outputLanguage: input.outputLanguage,
        wordTarget: totalWordTarget,
        mode: "copy-editor",
      });
      const editedText = (editorResult.editedText ?? "").trim();
      finalText = editedText || preEditorText;
      copyEditorRan = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[EDITOR:C3E] failed reason=caller_threw:${msg.slice(0, 160)} preset=narrative mode=copy_editor using=unedited_text route=${initialRoute}`,
      );
      finalText = preEditorText;
    }
  }

  // Pass-C3E: Story Supervisor / Evaluator gate with a duration-aware
  // "best version wins" repair loop.
  //
  // Pipeline:
  //   finalText (from copy-editor)
  //     → supervisor (initial verdict)
  //     → if score < REPAIR_SCORE_THRESHOLD AND maxRepairAttempts > 0:
  //         repeatedly run repair-light, re-score, and KEEP the candidate
  //         only when its supervisor score strictly exceeds the best score
  //         observed so far. The pre-repair text and score act as a floor:
  //         a regressing repair attempt is discarded.
  //
  // Loop invariant: the final returned text is whichever candidate (including
  // the pre-repair version) has the highest supervisor score. Quality can
  // therefore never regress relative to the post-copy-editor draft.
  //
  // Early stopping:
  //   • bestScore >= REPAIR_SCORE_THRESHOLD → stop (no need to push further)
  //   • candidate did not improve on bestScore for two consecutive attempts
  //     → stop (no meaningful improvement remains)
  //   • attempt budget exhausted → stop
  //
  // Kill switch: SKIP_STORY_SUPERVISOR=1 bypasses the supervisor gate
  // entirely (and therefore also bypasses any repair attempts).
  if (process.env.SKIP_STORY_SUPERVISOR === "1") {
    console.info("[STORY_SUPERVISOR] skipped reason=SKIP_STORY_SUPERVISOR preset=narrative");
  } else {
    let firstVerdict: Awaited<ReturnType<typeof evaluateStoryQuality>> = null;
    try {
      firstVerdict = await evaluateStoryQuality({
        finalText,
        outputLanguage: input.outputLanguage,
        preset: "narrative",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[STORY_SUPERVISOR] failed reason=caller_threw:${msg.slice(0, 160)} preset=narrative continuing_generation=true`,
      );
    }

    const maxRepairAttempts = pickMaxRepairAttempts(durationSec);

    // Repair-light gate. Only fires when the supervisor produced a verdict,
    // the score is below threshold, the editor pass is not globally killed,
    // and the duration budget allows at least one repair attempt. A null
    // verdict (failure, missing key, truncation) is treated as "no signal,
    // do not repair".
    const shouldRepair =
      firstVerdict !== null &&
      firstVerdict.overallScore < REPAIR_SCORE_THRESHOLD &&
      process.env.SKIP_EDITOR_PASS !== "1" &&
      maxRepairAttempts > 0;

    if (firstVerdict !== null && firstVerdict.overallScore >= REPAIR_SCORE_THRESHOLD) {
      console.info(
        `[NARRATIVE-REPAIR] skipped reason=score_meets_threshold score=${firstVerdict.overallScore} threshold=${REPAIR_SCORE_THRESHOLD}`,
      );
    } else if (
      firstVerdict !== null &&
      firstVerdict.overallScore < REPAIR_SCORE_THRESHOLD &&
      maxRepairAttempts === 0
    ) {
      console.info(
        `[NARRATIVE-REPAIR] skipped reason=duration_budget_zero durationSec=${durationSec} score=${firstVerdict.overallScore} threshold=${REPAIR_SCORE_THRESHOLD}`,
      );
    }

    // Best-version anchor. Initialized from the pre-repair (copy-editor)
    // output and updated whenever a downstream stage (repair-light loop or
    // the structural-repair pass below) produces a candidate that strictly
    // beats bestScore. These are declared at the supervisor-block scope so
    // the structural stage appended after repair-light can read the final
    // best version, score, issues, and notes without re-running the
    // supervisor on the post-repair draft. The score uses a numeric default
    // (0) when the supervisor never produced a verdict; `haveSupervisorSignal`
    // gates downstream stages that need a real anchor score.
    const haveSupervisorSignal = firstVerdict !== null;
    let bestText = finalText;
    let bestScore = firstVerdict !== null ? firstVerdict.overallScore : 0;
    let bestIssues: string[] = firstVerdict !== null ? firstVerdict.issues : [];
    let bestNotes: string = firstVerdict !== null ? firstVerdict.notes : "";

    if (shouldRepair) {
      console.info(
        `[NARRATIVE-REPAIR] trigger=score_below_threshold score=${firstVerdict!.overallScore} threshold=${REPAIR_SCORE_THRESHOLD} issuesCount=${firstVerdict!.issues.length} maxRepairAttempts=${maxRepairAttempts} durationSec=${durationSec}`,
      );

      // Score and issues of the draft we are about to feed into the next
      // repair attempt. These start at the pre-repair values and are
      // refreshed only when an attempt is accepted (so a rejected attempt
      // does NOT poison the next attempt's anchor).
      let previousScore = bestScore;
      let previousIssues = bestIssues;
      let previousDegraded = false;

      // Track how many attempts in a row failed to improve bestScore.
      // After two such attempts, give up — no meaningful improvement remains.
      let consecutiveNoImprovement = 0;
      let attemptsUsed = 0;

      for (let attempt = 1; attempt <= maxRepairAttempts; attempt++) {
        attemptsUsed = attempt;
        const scoreBefore = bestScore;
        const inputText = bestText;

        let candidateText = inputText;
        let candidateRan = false;
        try {
          const repairResult = await editNarrativeLongform({
            finalText: inputText,
            outputLanguage: input.outputLanguage,
            wordTarget: totalWordTarget,
            mode: "repair-light",
            supervisorIssues: previousIssues,
            repairContext: {
              previousScore,
              bestScore,
              previousDegraded,
            },
          });
          const repairedText = (repairResult.editedText ?? "").trim();
          candidateText = repairedText || inputText;
          candidateRan = true;
          repairLightRan = repairLightRan || candidateRan;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(
            `[EDITOR:C3E] failed reason=caller_threw:${msg.slice(0, 160)} preset=narrative mode=repair-light attempt=${attempt} using=best_text_so_far`,
          );
          console.info(
            `[NARRATIVE-REPAIR] attempt=${attempt} scoreBefore=${scoreBefore} scoreAfter=null accepted=no reason=editor_failed`,
          );
          consecutiveNoImprovement += 1;
          if (consecutiveNoImprovement >= 2) break;
          continue;
        }

        if (!candidateRan || candidateText === inputText) {
          console.info(
            `[NARRATIVE-REPAIR] attempt=${attempt} scoreBefore=${scoreBefore} scoreAfter=${scoreBefore} accepted=no reason=no_change`,
          );
          consecutiveNoImprovement += 1;
          if (consecutiveNoImprovement >= 2) break;
          continue;
        }

        let candidateVerdict: Awaited<ReturnType<typeof evaluateStoryQuality>> = null;
        try {
          candidateVerdict = await evaluateStoryQuality({
            finalText: candidateText,
            outputLanguage: input.outputLanguage,
            preset: "narrative",
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(
            `[STORY_SUPERVISOR] failed reason=caller_threw:${msg.slice(0, 160)} preset=narrative phase=post-repair attempt=${attempt} continuing_generation=true`,
          );
        }

        if (candidateVerdict === null) {
          // No verdict means no signal — we cannot accept a candidate whose
          // quality is unverified. Discard and treat as a non-improvement.
          console.info(
            `[NARRATIVE-REPAIR] attempt=${attempt} scoreBefore=${scoreBefore} scoreAfter=null accepted=no reason=supervisor_failed`,
          );
          previousDegraded = false;
          consecutiveNoImprovement += 1;
          if (consecutiveNoImprovement >= 2) break;
          continue;
        }

        const candidateScore = candidateVerdict.overallScore;
        const accepted = candidateScore > bestScore;

        console.info(
          `[NARRATIVE-REPAIR] attempt=${attempt} scoreBefore=${scoreBefore} scoreAfter=${candidateScore} accepted=${accepted ? "yes" : "no"}`,
        );

        if (accepted) {
          bestText = candidateText;
          bestScore = candidateScore;
          bestIssues = candidateVerdict.issues;
          bestNotes = candidateVerdict.notes;
          previousScore = candidateScore;
          previousIssues = candidateVerdict.issues;
          previousDegraded = false;
          consecutiveNoImprovement = 0;
        } else {
          // Candidate scored at or below bestScore — discard. If it scored
          // strictly below the draft we just fed in, mark "degraded" so the
          // next attempt receives the explicit "make smaller edits" guidance.
          previousDegraded = candidateScore < scoreBefore;
          consecutiveNoImprovement += 1;
        }

        // Early stopping: we hit the score gate.
        if (bestScore >= REPAIR_SCORE_THRESHOLD) {
          console.info(
            `[NARRATIVE-REPAIR] earlyStop=score_meets_threshold bestScore=${bestScore} threshold=${REPAIR_SCORE_THRESHOLD}`,
          );
          break;
        }

        // Early stopping: no meaningful improvement across recent attempts.
        if (consecutiveNoImprovement >= 2) {
          console.info(
            `[NARRATIVE-REPAIR] earlyStop=no_meaningful_improvement consecutiveNoImprovement=${consecutiveNoImprovement}`,
          );
          break;
        }
      }

      // Final output is always whichever candidate (including pre-repair)
      // carried the highest supervisor score. Quality cannot regress.
      finalText = bestText;
      console.info(
        `[NARRATIVE-REPAIR] bestScore=${bestScore} attemptsUsed=${attemptsUsed} maxRepairAttempts=${maxRepairAttempts}`,
      );
    }

    // ONE conservative structural repair stage. Runs AFTER repair-light has
    // completely finished. Triggers only when the post-repair best score is
    // still below the supervisor threshold, the supervisor produced a real
    // verdict to anchor on, the duration is at or under
    // STRUCTURAL_REPAIR_DURATION_LIMIT_SEC, and the kill switch is off.
    //
    // Acceptance is best-version-wins and STRICT: a candidate replaces
    // bestText only if its supervisor score is STRICTLY GREATER than the
    // current bestScore. Equal or lower candidates are discarded. Quality
    // therefore cannot regress.
    //
    // Kill switch: SKIP_STRUCTURAL_REPAIR=1 bypasses this stage entirely.
    let resultSource: "repair_light" | "structural" = "repair_light";
    const skipStructuralEnv = process.env.SKIP_STRUCTURAL_REPAIR === "1";
    const structuralDurationAllowed = durationSec <= STRUCTURAL_REPAIR_DURATION_LIMIT_SEC;

    if (skipStructuralEnv) {
      console.info(`[NARRATIVE-STRUCTURAL] phase=skipped reason=kill_switch`);
    } else if (!haveSupervisorSignal) {
      console.info(
        `[NARRATIVE-STRUCTURAL] phase=skipped reason=no_supervisor_signal`,
      );
    } else if (!structuralDurationAllowed) {
      console.info(
        `[NARRATIVE-STRUCTURAL] phase=skipped reason=duration_exceeds_45m durationSec=${durationSec}`,
      );
    } else if (bestScore >= REPAIR_SCORE_THRESHOLD) {
      console.info(
        `[NARRATIVE-STRUCTURAL] phase=skipped reason=score_meets_threshold bestScore=${bestScore} threshold=${REPAIR_SCORE_THRESHOLD}`,
      );
    } else {
      console.info(
        `[NARRATIVE-STRUCTURAL] phase=trigger bestScoreAfterRepair=${bestScore} threshold=${REPAIR_SCORE_THRESHOLD} durationSec=${durationSec}`,
      );

      let candidateText = bestText;
      let candidateAttempted = false;
      try {
        const structuralResult = await structuralRepairNarrative({
          bestText,
          outputLanguage: input.outputLanguage,
          wordTarget: totalWordTarget,
          durationSec,
          bestScore,
          supervisorIssues: bestIssues,
          supervisorNotes: bestNotes,
        });
        candidateText = structuralResult.candidateText;
        candidateAttempted = structuralResult.attempted;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[NARRATIVE-STRUCTURAL] failed reason=caller_threw:${msg.slice(0, 160)} preset=narrative using=best_text`,
        );
        console.info(
          `[NARRATIVE-STRUCTURAL] phase=candidate scoreBefore=${bestScore} scoreAfter=null accepted=no reason=stage_failed`,
        );
      }

      if (candidateAttempted && candidateText !== bestText) {
        let candidateVerdict: Awaited<ReturnType<typeof evaluateStoryQuality>> = null;
        try {
          candidateVerdict = await evaluateStoryQuality({
            finalText: candidateText,
            outputLanguage: input.outputLanguage,
            preset: "narrative",
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(
            `[STORY_SUPERVISOR] failed reason=caller_threw:${msg.slice(0, 160)} preset=narrative phase=post-structural continuing_generation=true`,
          );
        }

        if (candidateVerdict === null) {
          // No verdict means no signal — we cannot accept a candidate whose
          // quality is unverified. Discard.
          console.info(
            `[NARRATIVE-STRUCTURAL] phase=candidate scoreBefore=${bestScore} scoreAfter=null accepted=no reason=supervisor_failed`,
          );
        } else {
          const candidateScore = candidateVerdict.overallScore;
          // STRICT acceptance: equal score does NOT count. Only a strictly
          // higher score may replace bestText.
          const accepted = candidateScore > bestScore;
          console.info(
            `[NARRATIVE-STRUCTURAL] phase=candidate scoreBefore=${bestScore} scoreAfter=${candidateScore} accepted=${accepted ? "yes" : "no"}`,
          );
          if (accepted) {
            bestText = candidateText;
            bestScore = candidateScore;
            bestIssues = candidateVerdict.issues;
            bestNotes = candidateVerdict.notes;
            resultSource = "structural";
          }
        }
      } else if (candidateAttempted) {
        // Stage ran but returned the input unchanged (or empty/parse fallback).
        console.info(
          `[NARRATIVE-STRUCTURAL] phase=candidate scoreBefore=${bestScore} scoreAfter=${bestScore} accepted=no reason=no_change`,
        );
      }
    }

    // Carry the best version forward as the final story text. This is also
    // assigned inside the repair-light block when shouldRepair is true; the
    // structural stage may have updated bestText above, so re-assert here.
    finalText = bestText;

    console.info(
      `[NARRATIVE-STRUCTURAL] phase=done finalScore=${bestScore} source=${resultSource}`,
    );
  }

  console.info(
    `[EDITOR:C3E] passes copy_editor=${copyEditorRan ? "ran" : "skipped"} repair_light=${repairLightRan ? "ran" : "skipped"}`,
  );

  console.log(
    "[NARRATIVE-ORCH]",
    "phase=finished",
    `durationMs=${Date.now() - startedAt}`,
  );

  return { finalText, segmentCount, mergedWords, bible };
}
