// scripts/test-wps-calibration.ts
// Smoke test for wordTargetFor() — ASMR duration calibration.
// Run with: npx tsx scripts/test-wps-calibration.ts
export {}; // mark as module so local function names don't collide with sibling scripts

// Ensure module-level OpenAI constructor in script-builder-openai has a key.
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "test-key";

async function main() {
  const { wordTargetFor, trimKidsStoryToTarget } = await import("../lib/script-builder-openai");
  runCases(wordTargetFor);
  runTrimCases(trimKidsStoryToTarget);
}

type WordTargetFn = (
  preset: "classic-asmr" | "sleep-story" | "meditation" | "kids-story",
  durationSec: number,
  voiceStyle?: "soft" | "whisper" | null,
) => number;

type Case = { name: string; run: () => void };

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function runCases(wordTargetFor: WordTargetFn) {
  const cases: Case[] = [
    {
      name: "sleep-story uses 1.95 wps (unchanged by voiceStyle)",
      run: () => {
        assertEqual(wordTargetFor("sleep-story", 600), 1170, "600s soft default");
        assertEqual(wordTargetFor("sleep-story", 600, "soft"), 1170, "soft explicit");
        assertEqual(wordTargetFor("sleep-story", 600, "whisper"), 1170, "whisper ignored");
      },
    },
    {
      name: "kids-story uses 1.85 wps (unchanged by voiceStyle)",
      run: () => {
        assertEqual(wordTargetFor("kids-story", 600), 1110, "600s default");
        assertEqual(wordTargetFor("kids-story", 600, "whisper"), 1110, "whisper ignored");
      },
    },
    {
      name: "meditation uses 1.80 wps (unchanged)",
      run: () => {
        assertEqual(wordTargetFor("meditation", 600), 1080, "600s default");
        assertEqual(wordTargetFor("meditation", 600, "whisper"), 1080, "whisper ignored");
      },
    },
    {
      name: "classic-asmr + soft → 1.25 wps (recalibrated from 1.50; +30% drift verified)",
      run: () => {
        assertEqual(wordTargetFor("classic-asmr", 60, "soft"), 75, "1min soft = 75w");
        assertEqual(wordTargetFor("classic-asmr", 120, "soft"), 150, "2min soft = 150w");
        assertEqual(wordTargetFor("classic-asmr", 180, "soft"), 225, "3min soft = 225w");
      },
    },
    {
      name: "classic-asmr + whisper → 1.18 wps (small justified raise from 1.12; -12% drift)",
      run: () => {
        assertEqual(wordTargetFor("classic-asmr", 60, "whisper"), 71, "1min whisper ≈ 71w");
        assertEqual(wordTargetFor("classic-asmr", 120, "whisper"), 142, "2min whisper ≈ 142w");
        assertEqual(wordTargetFor("classic-asmr", 180, "whisper"), 212, "3min whisper ≈ 212w");
      },
    },
    {
      name: "classic-asmr fallback (no voiceStyle) → soft 1.25 wps",
      run: () => {
        assertEqual(wordTargetFor("classic-asmr", 120), 150, "undefined → soft");
        assertEqual(wordTargetFor("classic-asmr", 120, null), 150, "null → soft");
      },
    },
  ];

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const c of cases) {
    try {
      c.run();
      passed++;
      console.log(`PASS  ${c.name}`);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${c.name}: ${msg}`);
      console.log(`FAIL  ${c.name} — ${msg}`);
    }
  }

  console.log("");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

type TrimFn = (
  text: string,
  wordTarget: number,
) => {
  text: string;
  trimmedFrom: number;
  trimmedTo: number;
  paragraphsDropped: number;
};

function buildKidsScript(bodyParagraphs: number, wordsPerPara: number): string {
  const word = "word";
  const para = (label: string) =>
    `${label} ` + Array.from({ length: wordsPerPara - 1 }, () => word).join(" ");
  const parts: string[] = [];
  parts.push(para("Intro1"));
  parts.push(para("Intro2"));
  for (let i = 0; i < bodyParagraphs; i++) parts.push(para(`Body${i + 1}`));
  parts.push(para("Resolution1"));
  parts.push(para("Resolution2"));
  parts.push("Gute Nacht.");
  return parts.join("\n\n");
}

function runTrimCases(trim: TrimFn) {
  const countWords = (s: string) => s.split(/\s+/).filter(Boolean).length;
  const cases: Case[] = [
    {
      name: "trimKidsStoryToTarget: under threshold returns unchanged",
      run: () => {
        const text = buildKidsScript(4, 20);
        const target = countWords(text); // within target → no trim
        const r = trim(text, target);
        assertEqual(r.paragraphsDropped, 0, "no paragraphs dropped");
        assertEqual(r.text, text, "text returned unchanged");
      },
    },
    {
      name: "trimKidsStoryToTarget: 40% over target triggers trim",
      run: () => {
        const text = buildKidsScript(10, 20); // ~14 paragraphs
        const original = countWords(text);
        const target = Math.round(original / 1.4); // simulate +40% overshoot
        const r = trim(text, target);
        if (r.paragraphsDropped < 1) {
          throw new Error(`expected paragraphsDropped >= 1, got ${r.paragraphsDropped}`);
        }
        if (r.trimmedTo > Math.round(target * 1.10) && r.text.split(/\n\s*\n/).length > 6) {
          throw new Error(
            `trim did not land within 10% of target — final=${r.trimmedTo} cap=${Math.round(target * 1.10)}`,
          );
        }
      },
    },
    {
      name: "trimKidsStoryToTarget: preserves ending sleep cue",
      run: () => {
        const text = buildKidsScript(10, 20);
        const original = countWords(text);
        const target = Math.round(original / 1.4);
        const r = trim(text, target);
        if (!r.text.trim().endsWith("Gute Nacht.")) {
          throw new Error(`expected ending preserved, got tail: "${r.text.trim().slice(-40)}"`);
        }
      },
    },
    {
      name: "trimKidsStoryToTarget: refuses to trim very short scripts",
      run: () => {
        const text = buildKidsScript(1, 10); // 5 paragraphs total — below safety floor
        const original = countWords(text);
        const target = Math.round(original / 2); // way over
        const r = trim(text, target);
        assertEqual(r.paragraphsDropped, 0, "no paragraphs dropped (too short)");
        assertEqual(r.text, text, "text returned unchanged");
      },
    },
  ];

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const c of cases) {
    try {
      c.run();
      passed++;
      console.log(`PASS  ${c.name}`);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${c.name}: ${msg}`);
      console.log(`FAIL  ${c.name} — ${msg}`);
    }
  }

  console.log("");
  console.log(`Trim Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
