// scripts/diagnose-narrative-longform.ts
//
// Diagnostic-only script. Calls buildScriptOpenAI() directly on the same
// narrative path the script-preview / complete routes use, so we can measure
// where time is spent and whether single-call generation is viable for
// longer durations (10/15/30 min).
//
// Usage:
//   npx tsx scripts/diagnose-narrative-longform.ts
//   npx tsx scripts/diagnose-narrative-longform.ts --include-30m   # opt-in
//
// Requires OPENAI_API_KEY in the environment. Exits gracefully if missing.
//
// No persistence, no DB writes, no TTS, no auth. Read-only diagnostic.

import { buildScriptOpenAI } from "../lib/script-builder-openai";

type Case = {
  label: string;
  prompt: string;
  durationSec: number;
};

const includeThirtyMin = process.argv.includes("--include-30m");

const CASES: Case[] = [
  { label: "historical-crime-10m", prompt: "Eine historische Krimi-Geschichte im viktorianischen London. Ein leiser Inspektor, ein Diebstahl an der Themse, gefälschte Briefe.", durationSec: 600 },
  { label: "fantasy-15m",          prompt: "Eine Fantasy-Geschichte mit einer alten Bibliothek, einem stillen Wächter und einem Buch, das nicht gelesen werden darf.", durationSec: 900 },
  { label: "sci-fi-10m",           prompt: "Eine Sci-Fi-Geschichte: ein Wartungstechniker auf einer Raumstation entdeckt, dass eine Routinemeldung seit Jahren falsch ist.", durationSec: 600 },
  { label: "sci-fi-15m",           prompt: "Eine Sci-Fi-Geschichte: zwei Kolonisten auf einem zurückgelassenen Mars-Außenposten entscheiden, ob sie das letzte Signal beantworten.", durationSec: 900 },
];
if (includeThirtyMin) {
  CASES.push({
    label: "sci-fi-30m",
    prompt: "Eine ausgedehnte Sci-Fi-Geschichte: ein Generationenschiff erreicht ein System, in dem es eigentlich keine Erinnerung mehr geben sollte.",
    durationSec: 1800,
  });
}

type Result = {
  label: string;
  durationSec: number;
  ok: boolean;
  totalMs: number;
  outputChars?: number;
  outputWords?: number;
  errorName?: string;
  errorMessage?: string;
  errorStatus?: number | string;
  errorCode?: string;
};

async function runOne(c: Case): Promise<Result> {
  const t0 = Date.now();
  try {
    const out = await buildScriptOpenAI({
      preset: "narrative",
      narrativeMode: "story",
      language: "de",
      voiceStyle: "soft",
      userPrompt: c.prompt,
      targetDurationSec: c.durationSec,
    });
    const totalMs = Date.now() - t0;
    const text = (out?.finalText ?? "").trim();
    const words = text.split(/\s+/).filter(Boolean).length;
    return {
      label: c.label,
      durationSec: c.durationSec,
      ok: text.length > 0,
      totalMs,
      outputChars: text.length,
      outputWords: words,
    };
  } catch (err) {
    const totalMs = Date.now() - t0;
    const e = err as { name?: string; message?: string; status?: number | string; code?: string };
    return {
      label: c.label,
      durationSec: c.durationSec,
      ok: false,
      totalMs,
      errorName: e?.name,
      errorMessage: (e?.message ?? "").slice(0, 240),
      errorStatus: e?.status,
      errorCode: e?.code,
    };
  }
}

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY missing — set it in .env.local or your shell env and rerun.");
    process.exit(1);
  }

  console.log("[diagnose] cases=", CASES.length, "include-30m=", includeThirtyMin);
  console.log("[diagnose] OPENAI_TIMEOUT_MS=", process.env.OPENAI_TIMEOUT_MS ?? "(unset; defaults to 90000)");
  console.log("[diagnose] OPENAI_NARRATIVE_TIMEOUT_MS=", process.env.OPENAI_NARRATIVE_TIMEOUT_MS ?? "(unset; narrative defaults to 240000, maxRetries=0)");
  console.log("[diagnose] OPENAI_SCRIPT_MODEL=", process.env.OPENAI_SCRIPT_MODEL ?? "(unset; defaults to gpt-5.4)");
  console.log("");

  const results: Result[] = [];
  for (const c of CASES) {
    console.log(`-> running ${c.label} (durationSec=${c.durationSec})…`);
    const r = await runOne(c);
    results.push(r);
    if (r.ok) {
      console.log(`   ok=true  totalMs=${r.totalMs}  words=${r.outputWords}  chars=${r.outputChars}`);
    } else {
      console.log(
        `   ok=false totalMs=${r.totalMs}  name=${r.errorName ?? "—"}  status=${r.errorStatus ?? "—"}  code=${r.errorCode ?? "—"}  msg=${r.errorMessage ?? "—"}`,
      );
    }
  }

  console.log("");
  console.log("=== SUMMARY ===");
  for (const r of results) {
    const tag = r.ok ? "PASS" : "FAIL";
    console.log(
      `[${tag}] ${r.label.padEnd(22)} durationSec=${String(r.durationSec).padStart(4)}  totalMs=${String(r.totalMs).padStart(6)}  words=${r.outputWords ?? "—"}  chars=${r.outputChars ?? "—"}  err=${r.errorName ?? ""}`,
    );
  }
}

main().catch((err) => {
  console.error("[diagnose] unexpected error:", err);
  process.exit(1);
});
