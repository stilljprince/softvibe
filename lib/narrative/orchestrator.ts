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
import type { NarrativeSegment, SegmentState, StoryBible } from "./types";

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

  console.log("[NARRATIVE-ORCH]", "phase=outline.done");

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
    console.log(
      "[NARRATIVE-ORCH]",
      "phase=segment.begin",
      `index=${index}`,
      `of=${segmentCount}`,
    );

    const seg = await generateStorySegment({
      bible,
      priorState: state,
      priorSummaries: summaries,
      outputLanguage: input.outputLanguage,
      wordTarget: perSegmentWordTarget,
      previousSegmentText: previousSegmentText || undefined,
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

  const finalText = mergeNarrativeSegments(segments);
  const mergedWords = finalText.split(/\s+/).filter(Boolean).length;

  console.log(
    "[NARRATIVE-ORCH]",
    "phase=merge.done",
    `mergedWords=${mergedWords}`,
  );

  console.log(
    "[NARRATIVE-ORCH]",
    "phase=finished",
    `durationMs=${Date.now() - startedAt}`,
  );

  return { finalText, segmentCount, mergedWords, bible };
}
