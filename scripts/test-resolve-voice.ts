// scripts/test-resolve-voice.ts
// Smoke test for resolveVoiceId() — Workstream 1 (Kids Story dual-voice mapping).
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
  delete process.env.ELEVENLABS_VOICE_KIDS_STORY_FEMALE_ID;
  delete process.env.ELEVENLABS_VOICE_KIDS_STORY_MALE_ID;

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

function setKidsEnv(female?: string, male?: string) {
  if (female) process.env.ELEVENLABS_VOICE_KIDS_STORY_FEMALE_ID = female;
  else delete process.env.ELEVENLABS_VOICE_KIDS_STORY_FEMALE_ID;
  if (male) process.env.ELEVENLABS_VOICE_KIDS_STORY_MALE_ID = male;
  else delete process.env.ELEVENLABS_VOICE_KIDS_STORY_MALE_ID;
}

async function runCases(resolveVoiceId: ResolveFn, __resetKidsStoryWarnedForTests: ResetFn) {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  const cases: Case[] = [
  {
    name: "kids-story + female resolves to FEMALE env when set",
    run: () => {
      setKidsEnv("KIDS_F_ID", "KIDS_M_ID");
      __resetKidsStoryWarnedForTests();
      const { result, warnings } = captureWarn(() =>
        resolveVoiceId("kids-story", "soft", "female")
      );
      assertEqual(result, "KIDS_F_ID", "kids female voice");
      assertEqual(warnings.length, 0, "no warning when env is set");
    },
  },
  {
    name: "kids-story + male resolves to MALE env when set",
    run: () => {
      setKidsEnv("KIDS_F_ID", "KIDS_M_ID");
      __resetKidsStoryWarnedForTests();
      const { result, warnings } = captureWarn(() =>
        resolveVoiceId("kids-story", "soft", "male")
      );
      assertEqual(result, "KIDS_M_ID", "kids male voice");
      assertEqual(warnings.length, 0, "no warning when env is set");
    },
  },
  {
    name: "kids-story default gender is female",
    run: () => {
      setKidsEnv("KIDS_F_ID", "KIDS_M_ID");
      __resetKidsStoryWarnedForTests();
      assertEqual(resolveVoiceId("kids-story"), "KIDS_F_ID", "default to female");
    },
  },
  {
    name: "female requested, FEMALE env missing → falls back to MALE with one warning",
    run: () => {
      setKidsEnv(undefined, "KIDS_M_ID");
      __resetKidsStoryWarnedForTests();
      const { result, warnings } = captureWarn(() =>
        resolveVoiceId("kids-story", "soft", "female")
      );
      assertEqual(result, "KIDS_M_ID", "cross-gender fallback to male");
      assertEqual(warnings.length, 1, "one warning on female-missing path");
      if (!warnings[0].includes("ELEVENLABS_VOICE_KIDS_STORY_FEMALE_ID")) {
        throw new Error(`warning should name FEMALE env, got: ${warnings[0]}`);
      }
    },
  },
  {
    name: "male requested, MALE env missing → falls back to FEMALE with one warning",
    run: () => {
      setKidsEnv("KIDS_F_ID", undefined);
      __resetKidsStoryWarnedForTests();
      const { result, warnings } = captureWarn(() =>
        resolveVoiceId("kids-story", "soft", "male")
      );
      assertEqual(result, "KIDS_F_ID", "cross-gender fallback to female");
      assertEqual(warnings.length, 1, "one warning on male-missing path");
      if (!warnings[0].includes("ELEVENLABS_VOICE_KIDS_STORY_MALE_ID")) {
        throw new Error(`warning should name MALE env, got: ${warnings[0]}`);
      }
    },
  },
  {
    name: "both kids envs missing → falls back to DEFAULT_VOICE with one warning",
    run: () => {
      setKidsEnv(undefined, undefined);
      __resetKidsStoryWarnedForTests();
      const { result, warnings } = captureWarn(() =>
        resolveVoiceId("kids-story", "soft", "female")
      );
      assertEqual(result, "DEFAULT_VOICE_ID", "default voice fallback");
      assertEqual(warnings.length, 1, "one warning on both-missing path");
      if (
        !warnings[0].includes("ELEVENLABS_VOICE_KIDS_STORY_FEMALE_ID") ||
        !warnings[0].includes("ELEVENLABS_VOICE_KIDS_STORY_MALE_ID")
      ) {
        throw new Error(`warning should mention both env names, got: ${warnings[0]}`);
      }
    },
  },
  {
    name: "warn-once: same fallback path called repeatedly warns once",
    run: () => {
      setKidsEnv(undefined, undefined);
      __resetKidsStoryWarnedForTests();
      const { warnings } = captureWarn(() => {
        resolveVoiceId("kids-story", "soft", "female");
        resolveVoiceId("kids-story", "soft", "female");
        resolveVoiceId("kids-story", "soft", "male");
        resolveVoiceId("kids-story", "soft", "male");
      });
      assertEqual(warnings.length, 1, "warn-once across 4 default-fallback calls");
    },
  },
  {
    name: "warn-once: distinct fallback paths each warn once independently",
    run: () => {
      // First, exhaust the cross-gender female path (female missing, male present)
      setKidsEnv(undefined, "KIDS_M_ID");
      __resetKidsStoryWarnedForTests();
      const first = captureWarn(() => {
        resolveVoiceId("kids-story", "soft", "female");
        resolveVoiceId("kids-story", "soft", "female");
      });
      assertEqual(first.warnings.length, 1, "one warn for female-missing");

      // Now flip: male missing, female present — should warn again on the male path
      setKidsEnv("KIDS_F_ID", undefined);
      const second = captureWarn(() => {
        resolveVoiceId("kids-story", "soft", "male");
        resolveVoiceId("kids-story", "soft", "male");
      });
      assertEqual(second.warnings.length, 1, "one warn for male-missing (distinct path)");

      // Now both missing — should warn again on the default path
      setKidsEnv(undefined, undefined);
      const third = captureWarn(() => {
        resolveVoiceId("kids-story", "soft", "female");
        resolveVoiceId("kids-story", "soft", "male");
      });
      assertEqual(third.warnings.length, 1, "one warn for both-missing (distinct path)");
    },
  },
  {
    name: "explicitVoiceId override wins over kids-story envs",
    run: () => {
      setKidsEnv("KIDS_F_ID", "KIDS_M_ID");
      __resetKidsStoryWarnedForTests();
      assertEqual(
        resolveVoiceId("kids-story", "soft", "female", "OVERRIDE_ID"),
        "OVERRIDE_ID",
        "override beats female kids env"
      );
      assertEqual(
        resolveVoiceId("kids-story", "soft", "male", "OVERRIDE_ID"),
        "OVERRIDE_ID",
        "override beats male kids env"
      );
    },
  },
  {
    name: "explicitVoiceId override wins even when kids envs are missing (no warning)",
    run: () => {
      setKidsEnv(undefined, undefined);
      __resetKidsStoryWarnedForTests();
      const { result, warnings } = captureWarn(() =>
        resolveVoiceId("kids-story", "soft", "female", "OVERRIDE_ID")
      );
      assertEqual(result, "OVERRIDE_ID", "override beats missing kids envs");
      assertEqual(warnings.length, 0, "override path emits no fallback warning");
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
    name: "sleep-story unchanged (env-driven, ready for future Atlas V6 swap)",
    run: () => {
      assertEqual(resolveVoiceId("sleep-story"), "SLEEP_VOICE_ID", "sleep-story voice");
      // gender/style ignored for sleep-story
      assertEqual(
        resolveVoiceId("sleep-story", "whisper", "female"),
        "SLEEP_VOICE_ID",
        "sleep-story ignores style/gender"
      );
      assertEqual(
        resolveVoiceId("sleep-story", "soft", "male"),
        "SLEEP_VOICE_ID",
        "sleep-story ignores male gender"
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
