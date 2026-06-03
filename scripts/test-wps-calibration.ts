// scripts/test-wps-calibration.ts
// Smoke test for wordTargetFor() — ASMR duration calibration.
// Run with: npx tsx scripts/test-wps-calibration.ts
export {}; // mark as module so local function names don't collide with sibling scripts

// Ensure module-level OpenAI constructor in script-builder-openai has a key.
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "test-key";

async function main() {
  const { wordTargetFor } = await import("../lib/script-builder-openai");
  runCases(wordTargetFor);
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
      name: "classic-asmr + soft → 1.50 wps",
      run: () => {
        assertEqual(wordTargetFor("classic-asmr", 60, "soft"), 90, "1min soft = 90w");
        assertEqual(wordTargetFor("classic-asmr", 120, "soft"), 180, "2min soft = 180w");
        assertEqual(wordTargetFor("classic-asmr", 180, "soft"), 270, "3min soft = 270w");
      },
    },
    {
      name: "classic-asmr + whisper → 1.12 wps",
      run: () => {
        assertEqual(wordTargetFor("classic-asmr", 60, "whisper"), 67, "1min whisper ≈ 67w");
        assertEqual(wordTargetFor("classic-asmr", 120, "whisper"), 134, "2min whisper ≈ 134w");
        assertEqual(wordTargetFor("classic-asmr", 180, "whisper"), 202, "3min whisper ≈ 202w");
      },
    },
    {
      name: "classic-asmr fallback (no voiceStyle) → soft 1.50 wps",
      run: () => {
        assertEqual(wordTargetFor("classic-asmr", 120), 180, "undefined → soft");
        assertEqual(wordTargetFor("classic-asmr", 120, null), 180, "null → soft");
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
