// scripts/test-narrative-calibration-v2.ts
//
// Offline regression test for RP-011C.4 — Narrative Story Calibration V2.
//
//   npx tsx scripts/test-narrative-calibration-v2.ts
//
// Purely static: no OpenAI calls. Verifies that the prompt/instruction
// changes described in RP-011C.4 are present in the source of the affected
// narrative modules, and that no rigid beat-sheet architecture was
// introduced anywhere it touched.
//
// Coverage:
//   1. Longform outline carries premise-fulfillment / dramaturgical-
//      progression language.
//   2. Segment prompt carries the "story must move" requirement.
//   3. Segment prompt explicitly allows time jumps / location changes.
//   4. Segment prompt allows compressing low-value transitions under
//      word-budget pressure (not "describe the same scene more deeply").
//   5. Figurative-language restraint is present in the longform path
//      (outline-and-segments, scene-rewriter, compression-writer,
//      structural-repair).
//   6. Personification restraint is present alongside it.
//   7. Editor no longer carries the absolute anti-drama rule.
//   8-11. Story Supervisor carries plot progression, character development,
//      premise fulfillment, and ending/payoff dimensions for narrative.
//   12. No rigid beat-sheet vocabulary was introduced in any touched file.

import * as fs from "node:fs";
import * as path from "node:path";
import {
  buildStoryOutlinePrompts,
  buildStorySegmentPrompts,
} from "../lib/narrative/outline-and-segments";
import type { StoryBible, SegmentState } from "../lib/narrative/types";

let passed = 0;
let failed = 0;

function ok(label: string) {
  passed++;
  console.log(`[PASS] ${label}`);
}

function fail(label: string, detail?: string) {
  failed++;
  console.log(`[FAIL] ${label}${detail ? ` — ${detail}` : ""}`);
}

function assert(label: string, cond: boolean, detail?: string) {
  if (cond) ok(label);
  else fail(label, detail);
}

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, "..", relPath), "utf8");
}

const outlineSrc = readSource("lib/narrative/outline-and-segments.ts");
const editorSrc = readSource("lib/narrative/editor.ts");
const compressionSrc = readSource("lib/narrative/compression-writer.ts");
const structuralSrc = readSource("lib/narrative/structural-repair.ts");
const sceneRewriterSrc = readSource("lib/narrative/scene-rewriter.ts");
const supervisorSrc = readSource("lib/story-supervisor.ts");

// -----------------------------------------------------------------------------
// 1) Longform outline: premise fulfillment / dramaturgical progression.
// -----------------------------------------------------------------------------

const outlinePrompts = buildStoryOutlinePrompts({
  userPrompt:
    "Schreib mir eine Geschichte über einen jungen Mann Anfang 20, gefangen in einem Kreislauf von Motivation und Depression, der den Schritt in die Selbstständigkeit geht.",
  outputLanguage: "German",
  targetDurationSec: 1800,
  wordTarget: 3510,
});
const outlineHaystack = `${outlinePrompts.system}\n${outlinePrompts.user}`;

assert(
  "outline prompt carries DRAMATURGICAL PROGRESSION block",
  /CRITICAL — DRAMATURGICAL PROGRESSION/.test(outlineHaystack),
);
assert(
  "outline prompt requires identifying what materially changes end to end",
  /materially changes between the beginning and the end/i.test(outlineHaystack),
);
assert(
  "outline prompt warns against collapsing a transformation into a smaller adjacent action",
  /file the paperwork/i.test(outlineHaystack) && /move out/i.test(outlineHaystack),
);
assert(
  "outline prompt requires decisions and consequences",
  /decisions the protagonist makes and consequences/i.test(outlineHaystack),
);
assert(
  "outline prompt requires choosing a time span appropriate to the premise",
  /choose a time span/i.test(outlineHaystack),
);
assert(
  "outline prompt does not force a rigid beat sheet",
  !/save\s+the\s+cat/i.test(outlineHaystack) &&
    !/hero(?:'|’)?s\s+journey/i.test(outlineHaystack) &&
    !/mandatory\s+midpoint/i.test(outlineHaystack),
);

// -----------------------------------------------------------------------------
// 2, 3, 4) Segment prompt: story-must-move, time/place freedom, compression.
// -----------------------------------------------------------------------------

const sampleBible: StoryBible = {
  title: "Test Bible",
  protagonistSummary: "A young man cycling between motivation and depression.",
  supportingCharacterSummary: [],
  settingSummary: "A childhood bedroom he is trying to leave.",
  pressureSources: ["Rent is due.", "His own self-doubt."],
  importantRelationships: [],
  unresolvedQuestions: ["Will he actually leave the room behind?"],
  primaryStoryQuestion: "Will he build a life outside his childhood bedroom?",
  endingTone: "warm",
  trajectoryShape: "gradual-rise",
  endingApproach: "emotional-closure",
};
const sampleState: SegmentState = {
  emotionalState: "restless",
  relationshipChanges: [],
  unresolvedQuestions: [],
  settingChanges: [],
  elapsedTime: "day one",
};

const segmentPrompts = buildStorySegmentPrompts({
  bible: sampleBible,
  priorState: sampleState,
  priorSummaries: ["He wakes up and does nothing again."],
  outputLanguage: "English",
  wordTarget: 900,
});
const segmentHaystack = `${segmentPrompts.system}\n${segmentPrompts.user}`;

assert(
  "segment prompt carries STORY MUST MOVE requirement",
  /STORY MUST MOVE/.test(segmentHaystack),
);
assert(
  "segment prompt names the narrative dimensions that must move",
  /situation, what the protagonist knows, a relationship/i.test(segmentHaystack),
);
assert(
  "segment prompt forbids segments that merely extend the same room/activity/feeling",
  /same room or setting further/i.test(segmentHaystack) &&
    /extend the same activity/i.test(segmentHaystack),
);
assert(
  "segment prompt explicitly allows time jumps and location changes",
  /TIME AND PLACE ARE FREE TO MOVE/.test(segmentHaystack) &&
    /[Tt]ime jumps/.test(segmentHaystack) &&
    /location changes/.test(segmentHaystack),
);
assert(
  "segment prompt allows crossing days/weeks/months when nothing in between matters",
  /hours, days, weeks, or months can be crossed/i.test(segmentHaystack),
);
assert(
  "segment prompt does NOT impose a minimum number of time jumps",
  /no minimum number of time jumps/i.test(segmentHaystack),
);
assert(
  "segment prompt reframes word-budget pressure toward compressing low-value time, not staying in the same scene",
  /do NOT solve this by staying in the same scene/i.test(segmentHaystack),
);
assert(
  "segment prompt allows summarizing/crossing low-value transitions under budget pressure",
  /[Cc]ompress or summarize low-value transitions/.test(segmentHaystack),
);
assert(
  "segment prompt prioritizes story movement over secondary atmosphere under budget pressure",
  /Preserve story movement before preserving secondary atmosphere/i.test(segmentHaystack),
);

// -----------------------------------------------------------------------------
// 5, 6) Figurative-language / personification restraint across longform path.
// -----------------------------------------------------------------------------

const figurativeCheckTargets: Array<{ label: string; src: string }> = [
  { label: "outline-and-segments.ts (segment prompt)", src: outlineSrc },
  { label: "scene-rewriter.ts", src: sceneRewriterSrc },
  { label: "compression-writer.ts", src: compressionSrc },
  { label: "structural-repair.ts", src: structuralSrc },
];

for (const t of figurativeCheckTargets) {
  assert(
    `${t.label} mentions sparse metaphors/similes`,
    /metaphors?.{0,20}sparse|sparse.{0,20}metaphors?/i.test(t.src) ||
      (/[Mm]etaphors.*sparse/.test(t.src) && /[Ss]imiles.*sparse/.test(t.src)),
  );
  assert(
    `${t.label} mentions personification restraint ("rare")`,
    /[Pp]ersonification.{0,20}rare|rare.{0,20}[Pp]ersonification/.test(t.src),
  );
}

assert(
  "segment prompt exposes FIGURATIVE LANGUAGE RESTRAINT block",
  /FIGURATIVE LANGUAGE RESTRAINT/.test(segmentHaystack),
);
assert(
  "segment prompt warns against purple prose",
  /purple prose/i.test(segmentHaystack),
);
assert(
  "segment prompt warns against repeated sensory inventories",
  /repeating the same sensory inventory/i.test(segmentHaystack),
);
assert(
  "segment prompt still allows imagery (density restraint, not a ban)",
  /restraint on density, not a ban on imagery/i.test(segmentHaystack),
);

// -----------------------------------------------------------------------------
// 7) Editor no longer carries the absolute anti-drama rule.
// -----------------------------------------------------------------------------

assert(
  "editor.ts no longer contains the absolute anti-drama sentence",
  !/Drama, twists, and faster pacing are NOT goals\./.test(editorSrc),
);
assert(
  "editor.ts still discourages manufactured melodrama and arbitrary twists",
  /manufacture melodrama/i.test(editorSrc) && /arbitrary twist/i.test(editorSrc),
);
assert(
  "editor.ts now recognizes conflict/tension/consequences as legitimate narrative goals",
  /conflict, tension, escalation, real consequences, and meaningful events/i.test(editorSrc),
);

// -----------------------------------------------------------------------------
// 8-11) Story Supervisor narrative-specific rubric.
// -----------------------------------------------------------------------------

assert(
  "story-supervisor.ts gates narrative dimensions on preset === narrative",
  /isNarrative = input\.preset === "narrative"/.test(supervisorSrc),
);
assert(
  "story-supervisor.ts evaluates Plot Progression for narrative",
  /Plot Progression:/.test(supervisorSrc),
);
assert(
  "story-supervisor.ts evaluates Premise Fulfillment for narrative",
  /Premise Fulfillment:/.test(supervisorSrc),
);
assert(
  "story-supervisor.ts evaluates Character Development for narrative",
  /Character Development:/.test(supervisorSrc),
);
assert(
  "story-supervisor.ts evaluates Conflict / Stakes for narrative",
  /Conflict \/ Stakes:/.test(supervisorSrc),
);
assert(
  "story-supervisor.ts evaluates Temporal / Situational Progression for narrative",
  /Temporal \/ Situational Progression:/.test(supervisorSrc),
);
assert(
  "story-supervisor.ts evaluates Ending / Payoff for narrative",
  /Ending \/ Payoff:/.test(supervisorSrc),
);
assert(
  "story-supervisor.ts still allows a quiet narrative story to score well if it progresses",
  /quiet, low-drama narrative story is not automatically weak/i.test(supervisorSrc),
);

// -----------------------------------------------------------------------------
// 12) No rigid beat-sheet architecture introduced anywhere touched.
// -----------------------------------------------------------------------------

const FORBIDDEN_BEAT_SHEET_PATTERNS: RegExp[] = [
  /save\s+the\s+cat/i,
  /hero(?:'|’)?s\s+journey/i,
  /\bthree[- ]act\s+structure\b/i,
  /\bmandatory\s+midpoint\b/i,
  /\bmandatory\s+twist\b/i,
  /\bmandatory\s+climax\b/i,
  /\bfixed\s+scene\s+count\b/i,
  /\bexactly\s+\d+\s+(?:scenes|locations|beats|chapters)\b/i,
];

// outline-and-segments.ts is intentionally excluded here: its pre-existing
// SEGMENT_PROMPT_FORBIDDEN_NOTE legitimately *names* "Save The Cat",
// "Hero's Journey", and "three-act structure" in order to forbid the model
// from using them. scripts/test-narrative-outline.ts and
// scripts/test-narrative-segments.ts already assert those tokens appear
// only inside that forbidden block.
const touchedFiles: Array<{ label: string; src: string }> = [
  { label: "editor.ts", src: editorSrc },
  { label: "compression-writer.ts", src: compressionSrc },
  { label: "structural-repair.ts", src: structuralSrc },
  { label: "scene-rewriter.ts", src: sceneRewriterSrc },
  { label: "story-supervisor.ts", src: supervisorSrc },
];

for (const f of touchedFiles) {
  let caseFails = 0;
  for (const pat of FORBIDDEN_BEAT_SHEET_PATTERNS) {
    if (pat.test(f.src)) {
      caseFails++;
      fail(`${f.label} contains forbidden rigid beat-sheet pattern ${pat}`);
    }
  }
  if (caseFails === 0) {
    ok(`${f.label} introduces no rigid beat-sheet architecture`);
  }
}

// -----------------------------------------------------------------------------
console.log("");
console.log(`Total: ${passed + failed}   Passed: ${passed}   Failed: ${failed}`);
if (failed > 0) process.exit(1);
