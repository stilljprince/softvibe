// scripts/test-final-text-normalize.ts
//
// Local smoke test for the finalText normalizer that protects TTS from the
// kids-story "JSON-in-JSON" leak. Runs offline, no env vars required:
//
//   npx tsx scripts/test-final-text-normalize.ts
//
// The bug it guards against: OpenAI's structured-output envelope is
// `{"finalText": "<string>"}` — but for kids-story the model has been
// observed to put another `{"finalText":"..."}` envelope inside that string
// (sometimes well-formed, sometimes malformed with unescaped quotes). When
// the wrapper leaks through, ElevenLabs speaks the literal word "finalText".

import { normalizeFinalText } from "../lib/script-builder-normalize";

interface Case {
  name: string;
  input: string;
  expected: string;
}

const PLAIN_STORY =
  "An einem stillen Abend, als die Sterne langsam am Himmel auftauchten, " +
  "machte sich der kleine Fuchs auf den Weg nach Hause. Gute Nacht.";

const cases: Case[] = [
  {
    name: "plain text stays plain text",
    input: PLAIN_STORY,
    expected: PLAIN_STORY,
  },
  {
    name: "plain text with surrounding whitespace is trimmed",
    input: `   ${PLAIN_STORY}\n\n  `,
    expected: PLAIN_STORY,
  },
  {
    name: "single JSON wrap unwraps to inner story",
    input: JSON.stringify({ finalText: PLAIN_STORY }),
    expected: PLAIN_STORY,
  },
  {
    name: "double JSON wrap (well-formed) unwraps recursively",
    input: JSON.stringify({ finalText: JSON.stringify({ finalText: PLAIN_STORY }) }),
    expected: PLAIN_STORY,
  },
  {
    name: "triple JSON wrap (well-formed) unwraps recursively",
    input: JSON.stringify({
      finalText: JSON.stringify({
        finalText: JSON.stringify({ finalText: PLAIN_STORY }),
      }),
    }),
    expected: PLAIN_STORY,
  },
  {
    name: 'literal observed bug: malformed `{"finalText":"{"finalText":"story` (unescaped, unclosed)',
    input: `{"finalText":"{"finalText":"${PLAIN_STORY}`,
    expected: PLAIN_STORY,
  },
  {
    name: "bare label `finalText: story` is stripped",
    input: `finalText: ${PLAIN_STORY}`,
    expected: PLAIN_STORY,
  },
  {
    name: 'quoted label `"finalText": "story"` is stripped',
    input: `"finalText": "${PLAIN_STORY}"`,
    expected: PLAIN_STORY,
  },
  {
    name: "empty input returns empty string",
    input: "",
    expected: "",
  },
  {
    name: "whitespace-only input returns empty string",
    input: "   \n\t  ",
    expected: "",
  },
  {
    name: "plain text containing the word finalText mid-story is untouched",
    input:
      "Die Lehrerin schrieb das Wort finalText an die Tafel und alle lachten leise.",
    expected:
      "Die Lehrerin schrieb das Wort finalText an die Tafel und alle lachten leise.",
  },
  {
    name: "plain text ending with a quote is not damaged",
    input: 'Der kleine Fuchs flüsterte: "Gute Nacht."',
    expected: 'Der kleine Fuchs flüsterte: "Gute Nacht."',
  },
];

function run() {
  let passed = 0;
  let failed = 0;
  for (const c of cases) {
    const actual = normalizeFinalText(c.input);
    const ok = actual === c.expected;
    const status = ok ? "PASS" : "FAIL";
    console.log(`[${status}] ${c.name}`);
    if (!ok) {
      console.log(`         input:    ${JSON.stringify(c.input)}`);
      console.log(`         expected: ${JSON.stringify(c.expected)}`);
      console.log(`         actual:   ${JSON.stringify(actual)}`);
    }
    if (ok) passed++;
    else failed++;
  }

  console.log("");
  console.log(`Total: ${passed + failed}   Passed: ${passed}   Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

run();
