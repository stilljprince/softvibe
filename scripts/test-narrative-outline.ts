// scripts/test-narrative-outline.ts
//
// Offline test for the Pass-B narrative outline / StoryBible builder.
//
//   npx tsx scripts/test-narrative-outline.ts
//
// Optional live OpenAI call (gated):
//   TEST_NARRATIVE_OUTLINE_LIVE=1 npx tsx scripts/test-narrative-outline.ts
//   npx tsx scripts/test-narrative-outline.ts --live
//
// What this file verifies:
//
//   1. validateStoryBible accepts a well-formed bible.
//   2. validateStoryBible rejects invalid trajectoryShape values.
//   3. validateStoryBible rejects invalid endingTone values.
//   4. validateStoryBible rejects missing required string fields.
//   5. validateStoryBible rejects empty pressureSources.
//   6. validateStoryBible drops empty / null optional fields cleanly.
//   7. ALLOWED_TRAJECTORY_SHAPES and ALLOWED_ENDING_TONES are the closed
//      sets we expect (no drift).
//   8. STORY_BIBLE_JSON_SCHEMA exposes no forbidden beat-sheet fields
//      (chapter / beat / midpoint / climax / act / falseLead / etc).
//   9. The OUTLINE PROMPT does not contain forbidden beat-sheet vocabulary
//      ("Save The Cat", "Hero's Journey", "midpoint", "climax",
//      "false lead", "chapter 1", "chapter 2", "act structure").
//  10. The OUTLINE PROMPT contains the language we DO expect (emergent
//      shape, no fixed beats, concrete pressure, trajectory + tone enums).

import {
  ALLOWED_ENDING_TONES,
  ALLOWED_TRAJECTORY_SHAPES,
  STORY_BIBLE_JSON_SCHEMA,
  buildStoryOutline,
  buildStoryOutlinePrompts,
  validateStoryBible,
  type BuildStoryOutlineInput,
} from "../lib/narrative/outline-and-segments";
import type { EndingTone, StoryBible, TrajectoryShape } from "../lib/narrative/types";

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
// 1) Allowed enum sets are closed and exactly the documented values.
// -----------------------------------------------------------------------------

const EXPECTED_TRAJECTORY: TrajectoryShape[] = [
  "gradual-rise",
  "rise-and-fall",
  "spiral",
  "drift",
  "fracture-and-settle",
  "open",
];
const EXPECTED_TONE: EndingTone[] = [
  "warm",
  "bittersweet",
  "ambiguous",
  "quietly-tragic",
  "settled",
  "unresolved",
];

assert(
  "ALLOWED_TRAJECTORY_SHAPES matches documented set",
  EXPECTED_TRAJECTORY.length === ALLOWED_TRAJECTORY_SHAPES.length &&
    EXPECTED_TRAJECTORY.every((v) => (ALLOWED_TRAJECTORY_SHAPES as readonly string[]).includes(v)),
  `got: ${ALLOWED_TRAJECTORY_SHAPES.join(", ")}`,
);

assert(
  "ALLOWED_ENDING_TONES matches documented set",
  EXPECTED_TONE.length === ALLOWED_ENDING_TONES.length &&
    EXPECTED_TONE.every((v) => (ALLOWED_ENDING_TONES as readonly string[]).includes(v)),
  `got: ${ALLOWED_ENDING_TONES.join(", ")}`,
);

// -----------------------------------------------------------------------------
// 2) validateStoryBible — happy path
// -----------------------------------------------------------------------------

const goodRaw = {
  title: "The Long Way Back",
  protagonistSummary: "Mara, a forty-year-old archivist returning to her childhood city for a funeral she has been dreading.",
  supportingCharacterSummary: [
    { name: "Yusuf", role: "former neighbor", summary: "Steady, watchful, knows things she does not want to revisit." },
    { name: null, role: null, summary: "An elderly woman in the funeral home who keeps mistaking Mara for someone else." },
  ],
  settingSummary: "Late autumn in a coastal port town that has changed faster than Mara realized — ferries replaced by bridges, shop fronts she does not recognize.",
  pressureSources: [
    "The brother she has not spoken to in seven years arrives tomorrow.",
    "The estate paperwork needs her signature by Friday or it goes to a public sale.",
  ],
  importantRelationships: [
    { between: ["Mara", "Yusuf"], nature: "old kindness, never quite acknowledged" },
  ],
  unresolvedQuestions: [
    "Whether Mara will return to her brother's call.",
    "What her mother kept in the locked drawer of the desk.",
  ],
  endingTone: "bittersweet",
  trajectoryShape: "fracture-and-settle",
};

let validated: StoryBible | null = null;
try {
  validated = validateStoryBible(goodRaw);
  ok("validateStoryBible accepts a well-formed bible");
} catch (err) {
  fail("validateStoryBible accepts a well-formed bible", err instanceof Error ? err.message : String(err));
}

if (validated) {
  assert(
    "validated bible carries title from input",
    validated.title === "The Long Way Back",
  );
  assert(
    "validated bible drops empty name/role on anonymous supporting character",
    validated.supportingCharacterSummary.length === 2 &&
      validated.supportingCharacterSummary[1].name === undefined &&
      validated.supportingCharacterSummary[1].role === undefined,
  );
  assert(
    "validated trajectoryShape preserved",
    validated.trajectoryShape === "fracture-and-settle",
  );
  assert("validated endingTone preserved", validated.endingTone === "bittersweet");
}

// -----------------------------------------------------------------------------
// 3) validateStoryBible — rejection paths
// -----------------------------------------------------------------------------

assertThrows(
  "validateStoryBible rejects unknown trajectoryShape",
  () => validateStoryBible({ ...goodRaw, trajectoryShape: "save-the-cat" }),
  "trajectoryShape",
);

assertThrows(
  "validateStoryBible rejects unknown endingTone",
  () => validateStoryBible({ ...goodRaw, endingTone: "epic-victory" }),
  "endingTone",
);

assertThrows(
  "validateStoryBible rejects missing protagonistSummary",
  () => validateStoryBible({ ...goodRaw, protagonistSummary: "" }),
  "protagonist",
);

assertThrows(
  "validateStoryBible rejects empty pressureSources",
  () => validateStoryBible({ ...goodRaw, pressureSources: [] }),
  "pressureSources",
);

assertThrows(
  "validateStoryBible rejects non-object input",
  () => validateStoryBible(null),
  "json",
);

// Empty title becomes undefined (not present)
const noTitle = validateStoryBible({ ...goodRaw, title: null });
assert("null title is dropped (not stored as null)", noTitle.title === undefined);

// Bad relationship pair is silently dropped (not a hard error — others may be valid)
const badRel = validateStoryBible({
  ...goodRaw,
  importantRelationships: [
    { between: ["Solo"], nature: "broken" }, // wrong length
    { between: ["A", "B"], nature: "shared exile" },
  ],
});
assert(
  "single-element 'between' is dropped, valid pair retained",
  badRel.importantRelationships.length === 1 &&
    badRel.importantRelationships[0].between[0] === "A" &&
    badRel.importantRelationships[0].between[1] === "B",
);

// -----------------------------------------------------------------------------
// 4) Schema must NOT carry beat-sheet vocabulary in field names.
// -----------------------------------------------------------------------------

const schemaJson = JSON.stringify(STORY_BIBLE_JSON_SCHEMA).toLowerCase();
const FORBIDDEN_SCHEMA_TOKENS = [
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
];
for (const token of FORBIDDEN_SCHEMA_TOKENS) {
  assert(
    `schema does not contain forbidden token "${token}"`,
    !schemaJson.includes(token),
  );
}

// And the schema's required field list matches what we documented.
const EXPECTED_REQUIRED = [
  "title",
  "protagonistSummary",
  "supportingCharacterSummary",
  "settingSummary",
  "pressureSources",
  "importantRelationships",
  "unresolvedQuestions",
  "endingTone",
  "trajectoryShape",
];
assert(
  "schema required-fields list is exactly the documented set",
  Array.isArray(STORY_BIBLE_JSON_SCHEMA.required) &&
    STORY_BIBLE_JSON_SCHEMA.required.length === EXPECTED_REQUIRED.length &&
    EXPECTED_REQUIRED.every((f) => (STORY_BIBLE_JSON_SCHEMA.required as readonly string[]).includes(f)),
);

// -----------------------------------------------------------------------------
// 5) Outline PROMPT must not contain forbidden beat-sheet vocabulary.
// -----------------------------------------------------------------------------

const promptCases: Array<{ label: string; input: BuildStoryOutlineInput }> = [
  {
    label: "English crime brief",
    input: {
      userPrompt: "A retired detective takes one last case in coastal Maine.",
      outputLanguage: "English",
      targetDurationSec: 1200,
      wordTarget: 2340,
      genre: "crime",
    },
  },
  {
    label: "German slice-of-life brief",
    input: {
      userPrompt: "Eine alte Bäckerin schließt ihren Laden zum letzten Mal.",
      outputLanguage: "German",
      targetDurationSec: 600,
    },
  },
  {
    label: "Empty brief, no genre",
    input: {
      userPrompt: "",
      outputLanguage: "English",
      targetDurationSec: 600,
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
  /story bible/i,
  /trajectoryShape/i,
  /endingTone/i,
  /emergent|not assigned/i,
  /gradual-rise/,
  /rise-and-fall/,
  /spiral/,
  /drift/,
  /fracture-and-settle/,
  /\bopen\b/,
  /quietly-tragic/,
  /bittersweet/,
];

for (const c of promptCases) {
  const { system, user } = buildStoryOutlinePrompts(c.input);
  const haystack = `${system}\n${user}`;

  let caseFails = 0;
  for (const pat of FORBIDDEN_PROMPT_PATTERNS) {
    if (pat.test(haystack)) {
      caseFails++;
      fail(`[${c.label}] prompt contains forbidden pattern ${pat}`);
    }
  }
  for (const pat of REQUIRED_PROMPT_PATTERNS) {
    if (!pat.test(haystack)) {
      caseFails++;
      fail(`[${c.label}] prompt missing required pattern ${pat}`);
    }
  }
  if (caseFails === 0) {
    ok(`[${c.label}] outline prompt vocabulary is clean`);
  }
}

// Confirm the German case carries the German output-language directive.
const germanPrompt = buildStoryOutlinePrompts({
  userPrompt: "Eine Reise.",
  outputLanguage: "German",
  targetDurationSec: 600,
});
assert(
  "German prompt requests German output language",
  /German/.test(germanPrompt.user),
);

// Title hint round-trips into the prompt body.
const titledPrompt = buildStoryOutlinePrompts({
  userPrompt: "Anything.",
  outputLanguage: "English",
  targetDurationSec: 600,
  title: "Glass and Iron",
});
assert(
  "title hint appears in prompt body",
  /Glass and Iron/.test(titledPrompt.user),
);

// Genre hint round-trips.
const genrePrompt = buildStoryOutlinePrompts({
  userPrompt: "Anything.",
  outputLanguage: "English",
  targetDurationSec: 600,
  genre: "noir mystery",
});
assert(
  "caller-supplied genre appears in prompt body",
  /noir mystery/.test(genrePrompt.user),
);

// -----------------------------------------------------------------------------
// 6) Optional live OpenAI smoke test.
// -----------------------------------------------------------------------------

const wantLive =
  process.env.TEST_NARRATIVE_OUTLINE_LIVE === "1" ||
  process.argv.includes("--live");

async function maybeLive() {
  if (!wantLive) {
    console.log("");
    console.log("[skip] live OpenAI test — set TEST_NARRATIVE_OUTLINE_LIVE=1 or pass --live to enable.");
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    console.log("");
    console.log("[skip] live OpenAI test requested but OPENAI_API_KEY is not set.");
    return;
  }
  console.log("");
  console.log("[live] calling buildStoryOutline against OpenAI...");
  try {
    const bible = await buildStoryOutline({
      userPrompt:
        "Tell me a story about a lighthouse keeper who finds an unsigned letter in a bottle, written in a language she half-remembers from her childhood.",
      outputLanguage: "English",
      targetDurationSec: 900,
      wordTarget: 1755,
    });
    console.log("");
    console.log("=== STORY BIBLE ===");
    console.log(JSON.stringify(bible, null, 2));
    console.log("===================");
    ok("live buildStoryOutline returned a validated StoryBible");
  } catch (err) {
    fail("live buildStoryOutline call", err instanceof Error ? err.message : String(err));
  }
}

(async () => {
  await maybeLive();
  console.log("");
  console.log(`Total: ${passed + failed}   Passed: ${passed}   Failed: ${failed}`);
  if (failed > 0) process.exit(1);
})();
