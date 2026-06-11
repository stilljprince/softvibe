// scripts/test-narrative-segments.ts
//
// Offline test for the Pass-C1 narrative segment engine.
//
//   npx tsx scripts/test-narrative-segments.ts
//
// Optional live OpenAI flow (gated):
//   TEST_NARRATIVE_SEGMENTS_LIVE=1 npx tsx scripts/test-narrative-segments.ts
//   npx tsx scripts/test-narrative-segments.ts --live
//
// Live flow exercises:
//   user prompt → buildStoryOutline → generateStorySegment x3 → merge → print.
//
// Offline coverage:
//
//   1. SegmentState carries ONLY the allowed evolving fields and none of the
//      forbidden beat-sheet flags (currentBeat, midpointReached, climaxPending,
//      actNumber, chapterRole, phase, beat, act, chapter).
//   2. NarrativeSegment carries NO `role` (segments are not labelled with
//      dramatic roles).
//   3. NARRATIVE_SEGMENT_JSON_SCHEMA contains none of the forbidden tokens
//      in its serialized form.
//   4. The segment PROMPT (system + user) contains none of the forbidden
//      beat-sheet vocabulary, across first-segment, mid-segment, and
//      previousSegmentText-supplied cases.
//   5. The segment PROMPT contains the language we DO expect (natural
//      rhetorical boundary cues, ban on chapter/markdown, JSON contract).
//   6. validateNarrativeSegment accepts a well-formed object and rejects
//      ones that carry a `role` field or a forbidden state field.
//   7. mergeNarrativeSegments joins prose without chapter headings,
//      markdown, or separators.

import {
  FORBIDDEN_SEGMENT_STATE_FIELDS,
  NARRATIVE_SEGMENT_JSON_SCHEMA,
  buildStoryOutline,
  buildStorySegmentPrompts,
  estimateNarrativeDurationSec,
  generateStorySegment,
  mergeNarrativeSegments,
  validateNarrativeSegment,
  type GenerateStorySegmentInput,
} from "../lib/narrative/outline-and-segments";
import {
  LONGFORM_THRESHOLD_SEC,
  orchestrateLongformNarrative,
  pickNarrativeSegmentCount,
} from "../lib/narrative/orchestrator";
import type {
  NarrativeSegment,
  SegmentState,
  StoryBible,
} from "../lib/narrative/types";

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

function assertThrows(label: string, fn: () => unknown, mustContain?: string) {
  try {
    fn();
    fail(label, "expected throw, none occurred");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (mustContain && !msg.toLowerCase().includes(mustContain.toLowerCase())) {
      fail(label, `error did not contain "${mustContain}": ${msg}`);
    } else {
      ok(label);
    }
  }
}

// -----------------------------------------------------------------------------
// 1) SegmentState type is closed to the allowed evolving fields.
//
// We can't introspect a TypeScript type at runtime, but we can pin the
// canonical set via a concrete instance and assert it.
// -----------------------------------------------------------------------------

const ALLOWED_STATE_FIELDS = [
  "emotionalState",
  "relationshipChanges",
  "unresolvedQuestions",
  "settingChanges",
  "elapsedTime",
];

const canonicalState: SegmentState = {
  emotionalState: "uneasy",
  relationshipChanges: [],
  unresolvedQuestions: [],
  settingChanges: [],
  elapsedTime: "a few minutes",
};

assert(
  "SegmentState canonical instance has exactly the allowed fields",
  Object.keys(canonicalState).length === ALLOWED_STATE_FIELDS.length &&
    ALLOWED_STATE_FIELDS.every((k) => Object.prototype.hasOwnProperty.call(canonicalState, k)),
);

for (const f of FORBIDDEN_SEGMENT_STATE_FIELDS) {
  assert(
    `FORBIDDEN_SEGMENT_STATE_FIELDS includes "${f}"`,
    FORBIDDEN_SEGMENT_STATE_FIELDS.includes(f),
  );
}

// -----------------------------------------------------------------------------
// 2 & 3) JSON schema must not carry beat-sheet vocabulary anywhere and must
// not declare a `role` property on the segment.
// -----------------------------------------------------------------------------

const schemaJson = JSON.stringify(NARRATIVE_SEGMENT_JSON_SCHEMA).toLowerCase();
const FORBIDDEN_SCHEMA_TOKENS = [
  "role",
  "chapter",
  "midpoint",
  "climax",
  "falselead",
  "false_lead",
  "actstructure",
  "act_structure",
  "savethecat",
  "save_the_cat",
  "herosjourney",
  "heros_journey",
  "beatsheet",
  "beat_sheet",
  "currentbeat",
  "current_beat",
  "midpointreached",
  "midpoint_reached",
  "climaxpending",
  "climax_pending",
  "actnumber",
  "act_number",
  "chapterrole",
  "chapter_role",
];
for (const token of FORBIDDEN_SCHEMA_TOKENS) {
  assert(
    `segment schema does not contain forbidden token "${token}"`,
    !schemaJson.includes(token),
  );
}

const requiredTop = NARRATIVE_SEGMENT_JSON_SCHEMA.required as readonly string[];
assert(
  "segment schema requires exactly text, summary, stateAfter (no role)",
  requiredTop.length === 3 &&
    requiredTop.includes("text") &&
    requiredTop.includes("summary") &&
    requiredTop.includes("stateAfter") &&
    !requiredTop.includes("role"),
);

// -----------------------------------------------------------------------------
// 4 & 5) Segment prompts must not carry forbidden beat-sheet vocabulary,
// and must carry the expected continuation language.
// -----------------------------------------------------------------------------

const sampleBible: StoryBible = {
  title: "The Long Way Back",
  protagonistSummary:
    "Mara, a forty-year-old archivist returning to her childhood city for a funeral she has been dreading.",
  supportingCharacterSummary: [
    { name: "Yusuf", role: "former neighbor", summary: "Steady, watchful." },
  ],
  settingSummary:
    "Late autumn in a coastal port town that has changed faster than Mara realized.",
  pressureSources: [
    "The brother she has not spoken to in seven years arrives tomorrow.",
    "Estate paperwork due Friday.",
  ],
  importantRelationships: [
    { between: ["Mara", "Yusuf"], nature: "old kindness, never quite acknowledged" },
  ],
  unresolvedQuestions: ["Whether Mara will return her brother's call."],
  endingTone: "bittersweet",
  trajectoryShape: "fracture-and-settle",
};

const sampleState: SegmentState = {
  emotionalState: "guarded, tired, listening hard",
  relationshipChanges: [],
  unresolvedQuestions: ["Whether Mara will return her brother's call."],
  settingChanges: [],
  elapsedTime: "the evening she arrives",
};

const promptCases: Array<{ label: string; input: GenerateStorySegmentInput }> = [
  {
    label: "first segment, English, no previous text",
    input: {
      bible: sampleBible,
      priorState: sampleState,
      priorSummaries: [],
      outputLanguage: "English",
      wordTarget: 600,
    },
  },
  {
    label: "mid segment, English, with previous text",
    input: {
      bible: sampleBible,
      priorState: {
        ...sampleState,
        emotionalState: "thinning patience, a small private anger",
        settingChanges: ["arrived at the family house"],
      },
      priorSummaries: [
        "Mara arrives in town at dusk. She crosses the new bridge that replaced the ferry and notices a closed bakery. At the family house she finds Yusuf waiting on the porch with a covered dish, a kindness she does not yet know how to accept.",
      ],
      outputLanguage: "English",
      wordTarget: 700,
      previousSegmentText:
        "She set the dish on the kitchen table without unwrapping it. The radiator ticked. Outside, the wind off the harbor pressed against the windows in long slow waves.",
    },
  },
  {
    label: "mid segment, German, with two prior summaries",
    input: {
      bible: { ...sampleBible, title: "Der lange Weg zurück" },
      priorState: sampleState,
      priorSummaries: [
        "Mara kommt am Abend an. Yusuf wartet auf der Veranda.",
        "Sie sitzen wortlos in der Küche, bis der Wasserkessel pfeift.",
      ],
      outputLanguage: "German",
      wordTarget: 500,
    },
  },
];

const FORBIDDEN_PROMPT_PATTERNS: RegExp[] = [
  /save\s+the\s+cat/i,
  /hero(?:'|’)?s\s+journey/i,
  /\bmidpoint\b/i,
  /\bclimax\b/i,
  /\bfalse\s+lead\b/i,
  /\bchapter\s+1\b/i,
  /\bchapter\s+2\b/i,
  /\bact\s+structure\b/i,
  /\bbeat\s+sheet\b/i,
  /\bthree[- ]act\b/i,
];

const REQUIRED_PROMPT_PATTERNS: RegExp[] = [
  /natural rhetorical boundary/i,
  /continue/i,
  /No chapter headings/i,
  /markdown/i,
  /stateAfter/i,
  /emotionalState/i,
  /unresolvedQuestions/i,
  /relationshipChanges/i,
  /settingChanges/i,
  /elapsedTime/i,
];

for (const c of promptCases) {
  const { system, user } = buildStorySegmentPrompts(c.input);
  const haystack = `${system}\n${user}`;

  let caseFails = 0;
  for (const pat of FORBIDDEN_PROMPT_PATTERNS) {
    // The forbidden block legitimately *names* these tokens to forbid them.
    // We exempt the explicit "FORBIDDEN — DO NOT USE" section by checking that
    // every match in the haystack is also inside the forbidden block.
    const all = haystack.match(new RegExp(pat.source, "gi")) ?? [];
    if (all.length === 0) continue;
    // Find the forbidden block and verify every occurrence falls inside it.
    const blockStart = haystack.indexOf("FORBIDDEN — DO NOT USE");
    const blockEnd = haystack.indexOf("\n\n", blockStart === -1 ? 0 : blockStart);
    if (blockStart === -1) {
      caseFails++;
      fail(`[${c.label}] prompt contains forbidden pattern ${pat} outside any forbidden block`);
      continue;
    }
    const re = new RegExp(pat.source, "gi");
    let m: RegExpExecArray | null;
    let allInsideBlock = true;
    while ((m = re.exec(haystack)) !== null) {
      const idx = m.index;
      if (!(idx >= blockStart && (blockEnd === -1 || idx < blockEnd))) {
        allInsideBlock = false;
        break;
      }
    }
    if (!allInsideBlock) {
      caseFails++;
      fail(`[${c.label}] prompt contains forbidden pattern ${pat} OUTSIDE the forbidden block`);
    }
  }

  for (const pat of REQUIRED_PROMPT_PATTERNS) {
    if (!pat.test(haystack)) {
      caseFails++;
      fail(`[${c.label}] prompt missing required pattern ${pat}`);
    }
  }

  if (caseFails === 0) {
    ok(`[${c.label}] segment prompt vocabulary is clean`);
  }
}

// Carrier checks: previous-text tail and language directive.
const midPrompts = buildStorySegmentPrompts(promptCases[1].input);
assert(
  "mid segment prompt carries previous-text tail",
  /LAST PROSE FROM THE PREVIOUS SEGMENT/.test(midPrompts.user) &&
    /radiator ticked/.test(midPrompts.user),
);
assert(
  "first segment prompt does NOT carry previous-text tail",
  !/LAST PROSE FROM THE PREVIOUS SEGMENT/.test(
    buildStorySegmentPrompts(promptCases[0].input).user,
  ),
);
assert(
  "German segment prompt requests German output language",
  /German/.test(buildStorySegmentPrompts(promptCases[2].input).user),
);

// -----------------------------------------------------------------------------
// 6) validateNarrativeSegment — happy path + rejection paths
// -----------------------------------------------------------------------------

const goodSegRaw = {
  text: "She set the dish on the kitchen table. The radiator ticked. Outside, the wind off the harbor pressed against the windows in long slow waves.",
  summary:
    "Mara arrives at the family house and accepts a small kindness from Yusuf without acknowledging it. She lingers in the kitchen, listening to the wind, unwilling to unwrap the dish he has left.",
  stateAfter: {
    emotionalState: "guarded, thawing slightly",
    relationshipChanges: ["Yusuf reappears in her life; nothing said aloud"],
    unresolvedQuestions: ["Will Mara call her brother back?"],
    settingChanges: ["arrived at the family house"],
    elapsedTime: "the first evening",
  },
};

let validated: NarrativeSegment | null = null;
try {
  validated = validateNarrativeSegment(goodSegRaw, "seg-1");
  ok("validateNarrativeSegment accepts a well-formed segment");
} catch (err) {
  fail(
    "validateNarrativeSegment accepts a well-formed segment",
    err instanceof Error ? err.message : String(err),
  );
}

if (validated) {
  assert("validated segment carries the requested id", validated.id === "seg-1");
  assert("validated segment has no role field", !("role" in validated));
}

assertThrows(
  "validateNarrativeSegment rejects a role field on the segment",
  () => validateNarrativeSegment({ ...goodSegRaw, role: "midpoint" }, "seg-1"),
  "role",
);

assertThrows(
  "validateNarrativeSegment rejects a forbidden state field (currentBeat)",
  () =>
    validateNarrativeSegment(
      {
        ...goodSegRaw,
        stateAfter: { ...goodSegRaw.stateAfter, currentBeat: "rising-action" },
      },
      "seg-1",
    ),
  "currentBeat",
);

assertThrows(
  "validateNarrativeSegment rejects a forbidden state field (actNumber)",
  () =>
    validateNarrativeSegment(
      {
        ...goodSegRaw,
        stateAfter: { ...goodSegRaw.stateAfter, actNumber: 2 },
      },
      "seg-1",
    ),
  "actNumber",
);

assertThrows(
  "validateNarrativeSegment rejects missing text",
  () => validateNarrativeSegment({ ...goodSegRaw, text: "" }, "seg-1"),
  "text",
);

assertThrows(
  "validateNarrativeSegment rejects missing summary",
  () => validateNarrativeSegment({ ...goodSegRaw, summary: "" }, "seg-1"),
  "summary",
);

// validation should strip a stray chapter heading from the text body.
const stripped = validateNarrativeSegment(
  {
    ...goodSegRaw,
    text: "# Chapter 2\n\nShe walked along the harbor wall. The lamps had not yet come on.",
  },
  "seg-1",
);
assert(
  "validateNarrativeSegment strips a chapter heading from the prose",
  !/chapter\s+2/i.test(stripped.text) && /harbor wall/.test(stripped.text),
);

// -----------------------------------------------------------------------------
// 7) mergeNarrativeSegments produces clean prose flow.
// -----------------------------------------------------------------------------

const seg1: NarrativeSegment = {
  id: "seg-1",
  text: "She stepped off the train and the cold caught in her throat.",
  summary: "Mara arrives.",
  stateAfter: canonicalState,
};
const seg2: NarrativeSegment = {
  id: "seg-2",
  text: "Yusuf was already waiting on the platform, hands deep in his coat.",
  summary: "Yusuf meets her.",
  stateAfter: canonicalState,
};
const seg3: NarrativeSegment = {
  id: "seg-3",
  text: "They drove in silence. The harbor lights blinked on as if remembering her.",
  summary: "They drive home.",
  stateAfter: canonicalState,
};

const merged = mergeNarrativeSegments([seg1, seg2, seg3]);
assert("merged output contains all three prose passages", /train/.test(merged) && /platform/.test(merged) && /harbor lights/.test(merged));
assert("merged output contains no chapter headings", !/\bchapter\b/i.test(merged));
assert("merged output contains no markdown headings (#, **, ##)", !/^\s*#/m.test(merged) && !/\*\*/.test(merged));
assert("merged output contains no horizontal-rule separators", !/^[-*]{3,}\s*$/m.test(merged) && !/^\s*\*\*\*\s*$/m.test(merged));
assert("merged output contains no Part/Section labels", !/^\s*(part|section)\s+[ivxlcdm\d]+/im.test(merged));

const mergedEmpty = mergeNarrativeSegments([]);
assert("mergeNarrativeSegments on empty array returns empty string", mergedEmpty === "");

// -----------------------------------------------------------------------------
// 8) Optional live OpenAI smoke test:
//   buildStoryOutline → 3× generateStorySegment → mergeNarrativeSegments → print
// -----------------------------------------------------------------------------

const wantLive =
  process.env.TEST_NARRATIVE_SEGMENTS_LIVE === "1" ||
  process.argv.includes("--live");

async function maybeLive() {
  if (!wantLive) {
    console.log("");
    console.log(
      "[skip] live OpenAI test — set TEST_NARRATIVE_SEGMENTS_LIVE=1 or pass --live to enable.",
    );
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    console.log("");
    console.log("[skip] live OpenAI test requested but OPENAI_API_KEY is not set.");
    return;
  }

  console.log("");
  console.log("[live] buildStoryOutline → generateStorySegment ×3 → merge");

  const TARGET_DURATION_SEC = 900;
  const SEGMENT_COUNT = 3;
  const SEGMENT_WORD_TARGET = 600;
  const WORD_TARGET_TOTAL = SEGMENT_WORD_TARGET * SEGMENT_COUNT;

  try {
    const bible = await buildStoryOutline({
      userPrompt:
        "Tell me a story about a lighthouse keeper who finds an unsigned letter in a bottle, written in a language she half-remembers from her childhood.",
      outputLanguage: "English",
      targetDurationSec: TARGET_DURATION_SEC,
      wordTarget: 1755,
    });

    console.log("");
    console.log("=== STORY BIBLE ===");
    console.log(JSON.stringify(bible, null, 2));
    console.log("===================");

    console.log(
      "[NARRATIVE-SEGMENT]",
      "phase=plan",
      `segmentCount=${SEGMENT_COUNT}`,
      `wordTargetTotal=${WORD_TARGET_TOTAL}`,
      `wordTargetPerSegment=${SEGMENT_WORD_TARGET}`,
      `durationTargetSec=${TARGET_DURATION_SEC}`,
    );

    let state: SegmentState = {
      emotionalState: "quiet, attentive",
      relationshipChanges: [],
      unresolvedQuestions: [...bible.unresolvedQuestions],
      settingChanges: [],
      elapsedTime: "the opening evening",
    };
    const summaries: string[] = [];
    const segs: NarrativeSegment[] = [];
    let previousSegmentText = "";

    for (let i = 0; i < SEGMENT_COUNT; i++) {
      const seg = await generateStorySegment({
        bible,
        priorState: state,
        priorSummaries: summaries,
        outputLanguage: "English",
        wordTarget: SEGMENT_WORD_TARGET,
        previousSegmentText: previousSegmentText || undefined,
      });
      segs.push(seg);
      summaries.push(seg.summary);
      state = seg.stateAfter;
      previousSegmentText = seg.text;
      console.log(`[live] segment ${i + 1} produced — ${seg.text.split(/\s+/).filter(Boolean).length} words`);
    }

    const finalText = mergeNarrativeSegments(segs);
    const totalWords = finalText.split(/\s+/).filter(Boolean).length;

    const estimatedDurationSec = estimateNarrativeDurationSec(finalText);
    const deltaPercent =
      TARGET_DURATION_SEC > 0
        ? Math.round(((estimatedDurationSec - TARGET_DURATION_SEC) / TARGET_DURATION_SEC) * 100)
        : 0;
    console.log(
      "[NARRATIVE-SEGMENT]",
      "phase=duration.estimate",
      `estimatedDurationSec=${estimatedDurationSec}`,
      `targetDurationSec=${TARGET_DURATION_SEC}`,
      `deltaPercent=${deltaPercent}`,
    );

    console.log(`[live] total merged words: ${totalWords}`);

    ok("live segment flow returned merged prose");
  } catch (err) {
    fail("live segment flow", err instanceof Error ? err.message : String(err));
  }
}

// -----------------------------------------------------------------------------
// 9) Pass-C2 orchestration: offline checks of threshold and segment-count
//    mapping; optional live smoke test of orchestrateLongformNarrative at a
//    caller-supplied duration.
// -----------------------------------------------------------------------------

assert(
  "LONGFORM_THRESHOLD_SEC is 20 minutes",
  LONGFORM_THRESHOLD_SEC === 20 * 60,
);

const SEGMENT_COUNT_CASES: Array<{ minutes: number; expect: number }> = [
  { minutes: 19, expect: 3 },
  { minutes: 20, expect: 3 },
  { minutes: 25, expect: 3 },
  { minutes: 29, expect: 3 },
  { minutes: 30, expect: 4 },
  { minutes: 35, expect: 4 },
  { minutes: 44, expect: 4 },
  { minutes: 45, expect: 5 },
  { minutes: 50, expect: 5 },
  { minutes: 60, expect: 5 },
];
for (const c of SEGMENT_COUNT_CASES) {
  const got = pickNarrativeSegmentCount(c.minutes * 60);
  assert(
    `pickNarrativeSegmentCount(${c.minutes}min) === ${c.expect}`,
    got === c.expect,
    `got ${got}`,
  );
}

async function maybeOrchLive() {
  const wantOrch =
    process.env.TEST_NARRATIVE_ORCH_LIVE === "1" ||
    process.argv.includes("--orch");
  if (!wantOrch) {
    console.log("");
    console.log(
      "[skip] live orchestrator test — set TEST_NARRATIVE_ORCH_LIVE=1 or pass --orch to enable.",
    );
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    console.log("");
    console.log("[skip] live orchestrator test requested but OPENAI_API_KEY is not set.");
    return;
  }

  const durationSec = parseInt(
    process.env.TEST_NARRATIVE_ORCH_DURATION_SEC ?? "1200",
    10,
  );
  // Mirror the production wordTarget calculation for the narrative preset
  // (1.8 wps fallback in wordTargetFor → matches what the live wiring passes).
  const wordTarget = Math.round(durationSec * 1.8);

  console.log("");
  console.log(
    `[live] orchestrateLongformNarrative durationSec=${durationSec} wordTarget=${wordTarget}`,
  );

  try {
    const result = await orchestrateLongformNarrative({
      userPrompt:
        "Tell me a story about a lighthouse keeper who finds an unsigned letter in a bottle, written in a language she half-remembers from her childhood.",
      outputLanguage: "English",
      targetDurationSec: durationSec,
      wordTarget,
    });

    const est = estimateNarrativeDurationSec(result.finalText);
    const deltaPercent =
      durationSec > 0 ? Math.round(((est - durationSec) / durationSec) * 100) : 0;

    console.log(
      "[NARRATIVE-ORCH]",
      "phase=duration.estimate",
      `estimatedDurationSec=${est}`,
      `targetDurationSec=${durationSec}`,
      `deltaPercent=${deltaPercent}`,
    );
    console.log(
      `[live] orchestrator produced ${result.mergedWords} words across ${result.segmentCount} segments`,
    );

    ok("live orchestrator flow returned merged prose");
  } catch (err) {
    fail("live orchestrator flow", err instanceof Error ? err.message : String(err));
  }
}

(async () => {
  await maybeLive();
  await maybeOrchLive();
  console.log("");
  console.log(`Total: ${passed + failed}   Passed: ${passed}   Failed: ${failed}`);
  if (failed > 0) process.exit(1);
})();
