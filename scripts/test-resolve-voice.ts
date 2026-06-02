// scripts/test-resolve-voice.ts
// Smoke test for resolveVoiceId() — Workstream 1 (Kids Story voice mapping).
// Run with: npx tsx scripts/test-resolve-voice.ts

// ESM imports are hoisted; setting env first only works with a dynamic import.
async function main() {
  process.env.ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "test-key";
  process.env.ELEVENLABS_VOICE_ID = "DEFAULT_VOICE_ID";
  process.env.ELEVENLABS_VOICE_SLEEP_STORY_ID = "SLEEP_VOICE_ID";
  process.env.ELEVENLABS_VOICE_MEDITATION_ID = "MEDITATION_VOICE_ID";
  process.env.ELEVENLABS_VOICE_ASMR_SOFT_FEMALE_ID = "ASMR_SOFT_F_ID";
  process.env.ELEVENLABS_VOICE_ASMR_WHISPER_FEMALE_ID = "ASMR_WHISPER_F_ID";
  process.env.ELEVENLABS_VOICE_ASMR_SOFT_MALE_ID = "ASMR_SOFT_M_ID";
  process.env.ELEVENLABS_VOICE_ASMR_WHISPER_MALE_ID = "ASMR_WHISPER_M_ID";
  delete process.env.ELEVENLABS_VOICE_KIDS_STORY_ID;

  const { resolveVoiceId, __resetKidsStoryWarnedForTests } = await import(
    "../lib/tts/elevenlabs"
  );

  await runCases(resolveVoiceId, __resetKidsStoryWarnedForTests);
}

type ResolveFn = (
  preset?: string | null,
  voiceStyle?: "soft" | "whisper",
  voiceGender?: "female" | "male",
  explicitVoiceId?: string | null
) => string;
type ResetFn = () => void;

type Case = { name: string; run: () => void };

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function captureWarn<T>(fn: () => T): { result: T; warnings: string[] } {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    const result = fn();
    return { result, warnings };
  } finally {
    console.warn = original;
  }
}

async function runCases(resolveVoiceId: ResolveFn, __resetKidsStoryWarnedForTests: ResetFn) {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  const cases: Case[] = [
  {
    name: "kids-story resolves to ELEVENLABS_VOICE_KIDS_STORY_ID when set",
    run: () => {
      process.env.ELEVENLABS_VOICE_KIDS_STORY_ID = "KIDS_VOICE_ID";
      __resetKidsStoryWarnedForTests();
      const { result, warnings } = captureWarn(() => resolveVoiceId("kids-story"));
      assertEqual(result, "KIDS_VOICE_ID", "kids-story resolved voice");
      assertEqual(warnings.length, 0, "no warning when env is set");
      delete process.env.ELEVENLABS_VOICE_KIDS_STORY_ID;
    },
  },
  {
    name: "kids-story falls back to DEFAULT_VOICE when env missing",
    run: () => {
      delete process.env.ELEVENLABS_VOICE_KIDS_STORY_ID;
      __resetKidsStoryWarnedForTests();
      const { result, warnings } = captureWarn(() => resolveVoiceId("kids-story"));
      assertEqual(result, "DEFAULT_VOICE_ID", "kids-story fallback voice");
      assertEqual(warnings.length, 1, "exactly one warning on first missing-env call");
      if (!warnings[0].includes("ELEVENLABS_VOICE_KIDS_STORY_ID")) {
        throw new Error(`warning text should mention env var name, got: ${warnings[0]}`);
      }
    },
  },
  {
    name: "warning only fires once across multiple missing-env calls",
    run: () => {
      delete process.env.ELEVENLABS_VOICE_KIDS_STORY_ID;
      __resetKidsStoryWarnedForTests();
      const { warnings } = captureWarn(() => {
        resolveVoiceId("kids-story");
        resolveVoiceId("kids-story");
        resolveVoiceId("kids-story");
        resolveVoiceId("kids-story");
      });
      assertEqual(warnings.length, 1, "warn-once across 4 calls");
    },
  },
  {
    name: "explicitVoiceId override wins over kids-story env",
    run: () => {
      process.env.ELEVENLABS_VOICE_KIDS_STORY_ID = "KIDS_VOICE_ID";
      __resetKidsStoryWarnedForTests();
      const result = resolveVoiceId("kids-story", "soft", "female", "OVERRIDE_ID");
      assertEqual(result, "OVERRIDE_ID", "explicit override beats kids env");
      delete process.env.ELEVENLABS_VOICE_KIDS_STORY_ID;
    },
  },
  {
    name: "explicitVoiceId override wins for any preset",
    run: () => {
      assertEqual(
        resolveVoiceId("sleep-story", "soft", "female", "OVERRIDE_ID"),
        "OVERRIDE_ID",
        "override beats sleep-story"
      );
      assertEqual(
        resolveVoiceId("meditation", "soft", "female", "OVERRIDE_ID"),
        "OVERRIDE_ID",
        "override beats meditation"
      );
      assertEqual(
        resolveVoiceId("classic-asmr", "whisper", "male", "OVERRIDE_ID"),
        "OVERRIDE_ID",
        "override beats classic-asmr"
      );
    },
  },
  {
    name: "sleep-story unchanged",
    run: () => {
      assertEqual(resolveVoiceId("sleep-story"), "SLEEP_VOICE_ID", "sleep-story voice");
      // gender/style ignored for sleep-story
      assertEqual(
        resolveVoiceId("sleep-story", "whisper", "female"),
        "SLEEP_VOICE_ID",
        "sleep-story ignores style/gender"
      );
    },
  },
  {
    name: "meditation unchanged",
    run: () => {
      assertEqual(resolveVoiceId("meditation"), "MEDITATION_VOICE_ID", "meditation voice");
    },
  },
  {
    name: "classic-asmr unchanged (all 4 style/gender combos)",
    run: () => {
      assertEqual(
        resolveVoiceId("classic-asmr", "soft", "female"),
        "ASMR_SOFT_F_ID",
        "asmr soft female"
      );
      assertEqual(
        resolveVoiceId("classic-asmr", "whisper", "female"),
        "ASMR_WHISPER_F_ID",
        "asmr whisper female"
      );
      assertEqual(
        resolveVoiceId("classic-asmr", "soft", "male"),
        "ASMR_SOFT_M_ID",
        "asmr soft male"
      );
      assertEqual(
        resolveVoiceId("classic-asmr", "whisper", "male"),
        "ASMR_WHISPER_M_ID",
        "asmr whisper male"
      );
    },
  },
  {
    name: "null/undefined/unknown preset falls back to DEFAULT_VOICE",
    run: () => {
      assertEqual(resolveVoiceId(null), "DEFAULT_VOICE_ID", "null preset");
      assertEqual(resolveVoiceId(undefined), "DEFAULT_VOICE_ID", "undefined preset");
      assertEqual(resolveVoiceId("something-else"), "DEFAULT_VOICE_ID", "unknown preset");
    },
  },
  ];

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
