// scripts/validate-narrative-repair.ts
//
// Diagnostic harness for validating the current Narrative repair_light
// architecture before designing a Structural Repair stage.
//
// Runs orchestrateLongformNarrative() against a small fixed prompt set
// covering distinct story styles. Captures supervisor + repair telemetry
// from the orchestrator's stdout log lines, persists per-run JSON, and
// prints a summary table.
//
// Usage:
//   OPENAI_API_KEY=... npx tsx scripts/validate-narrative-repair.ts
//
//   # Run a subset (by label substring):
//   FILTER=mystery npx tsx scripts/validate-narrative-repair.ts
//
//   # Pick duration in seconds (default 1200 = 20 min; minimum for orchestrator):
//   DURATION_SEC=1200 npx tsx scripts/validate-narrative-repair.ts
//
//   # Output directory for raw results:
//   OUT_DIR=/tmp/narrative-validate npx tsx scripts/validate-narrative-repair.ts
//
// This file is read-only telemetry. It does NOT modify the orchestrator.

import * as fs from "node:fs";
import * as path from "node:path";
// NOTE: this script imports modules that construct an OpenAI client at
// module-load time, so OPENAI_API_KEY must be present BEFORE these imports
// resolve. Invoke via `node --env-file=.env.local --import tsx scripts/...`
// (or export OPENAI_API_KEY directly). dotenv-in-script does not work here
// because ESM hoists all imports above the dotenv.config() call.
import {
  LONGFORM_THRESHOLD_SEC,
  orchestrateLongformNarrative,
} from "../lib/narrative/orchestrator";
import { wordTargetFor } from "../lib/script-builder-openai";

type Case = {
  label: string;
  style: string;
  prompt: string;
  language: "English" | "German";
};

const CASES: Case[] = [
  {
    label: "family-secrets",
    style: "family secrets",
    prompt:
      "A quiet family story. Three adult siblings spend a weekend at their late mother's house and slowly uncover a long-kept secret hidden in her letters. The mood is calm, reflective, and ultimately forgiving.",
    language: "English",
  },
  {
    label: "friendship",
    style: "friendship",
    prompt:
      "A gentle story about two childhood friends who drifted apart over the years and meet again by chance in a small bookstore. They spend an afternoon walking the town, finding their old rhythm.",
    language: "English",
  },
  {
    label: "romance",
    style: "romance",
    prompt:
      "A soft slow-paced romance. A florist and a piano tuner meet in a quiet town and find each other across a series of small everyday encounters. Tender, warm, never melodramatic.",
    language: "English",
  },
  {
    label: "mystery",
    style: "mystery",
    prompt:
      "A calm low-stakes mystery. A retired librarian notices that a single book has been returned to her shelves with a different bookmark for years. She quietly investigates and finds a touching explanation.",
    language: "English",
  },
  {
    label: "cozy",
    style: "positive/cozy",
    prompt:
      "A cozy story set in a small alpine village inn over a snowed-in weekend. A handful of stranded travelers share meals, tell small stories, and slowly learn to trust each other.",
    language: "English",
  },
  {
    label: "emotional",
    style: "emotional",
    prompt:
      "An emotional story about a grown daughter accompanying her elderly father on the last drive to his childhood farm. They revisit places, speak honestly, and end the day at peace.",
    language: "English",
  },
];

type SupervisorVerdictTelemetry = {
  score: number;
  recommendation: string;
  issuesCount: number;
  strengthsCount: number;
  words: number;
  issues: string[];
};

type RepairAttemptTelemetry = {
  attempt: number;
  scoreBefore: number | null;
  scoreAfter: number | null;
  accepted: "yes" | "no" | "unknown";
  reason: string | null;
};

type RunTelemetry = {
  initialVerdict: SupervisorVerdictTelemetry | null;
  repairTrigger: {
    score: number;
    threshold: number;
    issuesCount: number;
    maxRepairAttempts: number;
    durationSec: number;
  } | null;
  repairSkipped: { reason: string; score: number | null } | null;
  attempts: RepairAttemptTelemetry[];
  bestScore: number | null;
  attemptsUsed: number | null;
  maxRepairAttempts: number | null;
  earlyStop: string | null;
  initialRoute: string | null;
  finalEditorPasses: { copyEditor: string; repairLight: string } | null;
  mergedWords: number | null;
  raw: string[];
};

type RunResult = {
  label: string;
  style: string;
  prompt: string;
  durationSec: number;
  language: "English" | "German";
  wordTarget: number;
  finalText: string;
  finalWords: number;
  totalMs: number;
  ok: boolean;
  errorMessage?: string;
  telemetry: RunTelemetry;
};

function emptyTelemetry(): RunTelemetry {
  return {
    initialVerdict: null,
    repairTrigger: null,
    repairSkipped: null,
    attempts: [],
    bestScore: null,
    attemptsUsed: null,
    maxRepairAttempts: null,
    earlyStop: null,
    initialRoute: null,
    finalEditorPasses: null,
    mergedWords: null,
    raw: [],
  };
}

function parseKv(line: string): Record<string, string> {
  // Parse "key=value" tokens; values can be quoted. Tokens are space-separated.
  const out: Record<string, string> = {};
  const re = /(\w+)=("([^"]*)"|\[([^\]]*)\]|([^\s]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const key = m[1];
    const quoted = m[3];
    const bracketed = m[4];
    const bare = m[5];
    out[key] = quoted ?? bracketed ?? bare ?? "";
  }
  return out;
}

function classifySupervisorIssue(issue: string): string[] {
  const i = issue.toLowerCase();
  const tags: string[] = [];
  if (/(repetiti|repeated|repeats|duplicate|echo|recur)/.test(i)) tags.push("repetition");
  if (/(pacing|drag|rush|slow|stall|momentum|sag|sagg|meander)/.test(i)) tags.push("pacing");
  if (/(ending|closure|resolution|conclud|wrap|end\s)/.test(i)) tags.push("ending");
  if (/(exposition|telling|info|expound|over[- ]explain|preach|monologue)/.test(i)) tags.push("exposition");
  if (/(coheren|causal|logic|consist|continuity|contradict|plot hole)/.test(i)) tags.push("coherence");
  if (/(revelation|reveal|secret|twist|disclos)/.test(i)) tags.push("revelation");
  if (/(structur|scene|beat|act|arc|order|sequence)/.test(i)) tags.push("structure");
  if (/(character|motivation|persona|relationship)/.test(i)) tags.push("character");
  if (/(setting|atmosphere|sensory|imagery|description)/.test(i)) tags.push("sensory");
  if (/(language|word\s+choice|phrasing|prose|register|tone)/.test(i)) tags.push("prose");
  if (/(length|word\s+count|too\s+long|too\s+short)/.test(i)) tags.push("length");
  return tags;
}

function isStructuralTag(tag: string): boolean {
  return tag === "repetition" || tag === "pacing" || tag === "ending" || tag === "exposition" || tag === "revelation" || tag === "structure";
}

async function captureRun(c: Case, durationSec: number): Promise<RunResult> {
  const wordTarget = wordTargetFor("narrative" as never, durationSec, "soft");

  const telemetry = emptyTelemetry();
  let pendingInitialVerdict: SupervisorVerdictTelemetry | null = null;
  let supervisorPhase: "initial" | "repair" = "initial";

  const origInfo = console.info;
  const origLog = console.log;
  const origWarn = console.warn;

  const onLine = (line: string) => {
    if (typeof line !== "string") return;
    if (!line.startsWith("[")) return;
    telemetry.raw.push(line);

    if (line.startsWith("[STORY_SUPERVISOR] preset=")) {
      const kv = parseKv(line);
      const verdict: SupervisorVerdictTelemetry = {
        score: parseInt(kv.score ?? "0", 10),
        recommendation: kv.recommendation ?? "",
        issuesCount: parseInt(kv.issuesCount ?? "0", 10),
        strengthsCount: parseInt(kv.strengthsCount ?? "0", 10),
        words: parseInt(kv.words ?? "0", 10),
        issues: [],
      };
      pendingInitialVerdict = verdict;
      if (supervisorPhase === "initial" && telemetry.initialVerdict === null) {
        telemetry.initialVerdict = verdict;
      }
      return;
    }
    if (line.startsWith("[STORY_SUPERVISOR] issues=")) {
      const m = line.match(/^\[STORY_SUPERVISOR\] issues=\[(.*)\]$/);
      if (m && pendingInitialVerdict) {
        const issuesStr = m[1];
        pendingInitialVerdict.issues = issuesStr
          .split(" | ")
          .map((s) => s.trim())
          .filter(Boolean);
      }
      return;
    }
    if (line.startsWith("[NARRATIVE-REPAIR] trigger=score_below_threshold")) {
      const kv = parseKv(line);
      telemetry.repairTrigger = {
        score: parseInt(kv.score ?? "0", 10),
        threshold: parseInt(kv.threshold ?? "0", 10),
        issuesCount: parseInt(kv.issuesCount ?? "0", 10),
        maxRepairAttempts: parseInt(kv.maxRepairAttempts ?? "0", 10),
        durationSec: parseInt(kv.durationSec ?? "0", 10),
      };
      supervisorPhase = "repair";
      return;
    }
    if (line.startsWith("[NARRATIVE-REPAIR] skipped reason=")) {
      const kv = parseKv(line);
      telemetry.repairSkipped = {
        reason: kv.reason ?? "unknown",
        score: kv.score ? parseInt(kv.score, 10) : null,
      };
      return;
    }
    if (line.startsWith("[NARRATIVE-REPAIR] attempt=")) {
      const kv = parseKv(line);
      const attempt = parseInt(kv.attempt ?? "0", 10);
      const scoreBefore = kv.scoreBefore != null ? Number(kv.scoreBefore) : null;
      const scoreAfterStr = kv.scoreAfter ?? "";
      const scoreAfter = scoreAfterStr === "null" || scoreAfterStr === "" ? null : Number(scoreAfterStr);
      const acceptedStr = (kv.accepted ?? "unknown").toLowerCase();
      const accepted: "yes" | "no" | "unknown" =
        acceptedStr === "yes" ? "yes" : acceptedStr === "no" ? "no" : "unknown";
      telemetry.attempts.push({
        attempt,
        scoreBefore: Number.isFinite(scoreBefore as number) ? (scoreBefore as number) : null,
        scoreAfter: Number.isFinite(scoreAfter as number) ? (scoreAfter as number) : null,
        accepted,
        reason: kv.reason ?? null,
      });
      return;
    }
    if (line.startsWith("[NARRATIVE-REPAIR] earlyStop=")) {
      const kv = parseKv(line);
      telemetry.earlyStop = kv.earlyStop ?? null;
      return;
    }
    if (line.startsWith("[NARRATIVE-REPAIR] bestScore=")) {
      const kv = parseKv(line);
      telemetry.bestScore = kv.bestScore ? parseInt(kv.bestScore, 10) : null;
      telemetry.attemptsUsed = kv.attemptsUsed ? parseInt(kv.attemptsUsed, 10) : null;
      telemetry.maxRepairAttempts = kv.maxRepairAttempts ? parseInt(kv.maxRepairAttempts, 10) : null;
      return;
    }
    if (line.startsWith("[NARRATIVE-ROUTER]")) {
      const kv = parseKv(line);
      telemetry.initialRoute = kv.route ?? null;
      telemetry.mergedWords = kv.mergedWords ? parseInt(kv.mergedWords, 10) : null;
      return;
    }
    if (line.startsWith("[EDITOR:C3E] passes")) {
      const kv = parseKv(line);
      telemetry.finalEditorPasses = {
        copyEditor: kv.copy_editor ?? "unknown",
        repairLight: kv.repair_light ?? "unknown",
      };
      return;
    }
  };

  const tee = (fn: (...args: unknown[]) => void) => {
    return (...args: unknown[]) => {
      try {
        const joined = args
          .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
          .join(" ");
        onLine(joined);
      } catch {
        // ignore parse failures, never block logging
      }
      fn(...args);
    };
  };

  console.info = tee(origInfo) as typeof console.info;
  console.log = tee(origLog) as typeof console.log;
  console.warn = tee(origWarn) as typeof console.warn;

  const t0 = Date.now();
  try {
    const out = await orchestrateLongformNarrative({
      userPrompt: c.prompt,
      outputLanguage: c.language,
      targetDurationSec: durationSec,
      wordTarget,
    });
    const totalMs = Date.now() - t0;
    const finalText = out.finalText ?? "";
    const finalWords = finalText.split(/\s+/).filter(Boolean).length;
    return {
      label: c.label,
      style: c.style,
      prompt: c.prompt,
      durationSec,
      language: c.language,
      wordTarget,
      finalText,
      finalWords,
      totalMs,
      ok: true,
      telemetry,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      label: c.label,
      style: c.style,
      prompt: c.prompt,
      durationSec,
      language: c.language,
      wordTarget,
      finalText: "",
      finalWords: 0,
      totalMs: Date.now() - t0,
      ok: false,
      errorMessage: msg,
      telemetry,
    };
  } finally {
    console.info = origInfo;
    console.log = origLog;
    console.warn = origWarn;
  }
}

function formatScoreOrDash(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? String(n) : "—";
}

function summarizeResults(results: RunResult[]): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("=== SUMMARY TABLE ===");
  lines.push("");
  lines.push(
    "| Label | Style | Initial Score | Repair? | Attempts | scoreBefore→scoreAfter (accepted) | Best | Major issues |",
  );
  lines.push(
    "|-------|-------|---------------|---------|----------|-----------------------------------|------|--------------|",
  );
  for (const r of results) {
    const t = r.telemetry;
    const initial = t.initialVerdict ? t.initialVerdict.score : null;
    const repairTriggered = t.repairTrigger ? "yes" : t.repairSkipped ? `no (${t.repairSkipped.reason})` : "no";
    const attempts = t.attemptsUsed != null ? `${t.attemptsUsed}/${t.maxRepairAttempts ?? "?"}` : "0";
    const attemptStr = t.attempts.length === 0
      ? "—"
      : t.attempts
          .map(
            (a) =>
              `#${a.attempt} ${formatScoreOrDash(a.scoreBefore)}→${formatScoreOrDash(a.scoreAfter)} (${a.accepted}${a.reason ? `:${a.reason}` : ""})`,
          )
          .join(" ; ");
    const best = t.bestScore ?? initial;
    const issues = (t.initialVerdict?.issues ?? []).slice(0, 3).join(" / ").slice(0, 180);
    lines.push(
      `| ${r.label} | ${r.style} | ${formatScoreOrDash(initial)} | ${repairTriggered} | ${attempts} | ${attemptStr} | ${formatScoreOrDash(best)} | ${issues || "—"} |`,
    );
  }
  lines.push("");
  lines.push("=== AGGREGATE STATS ===");
  const total = results.length;
  const okRuns = results.filter((r) => r.ok).length;
  const initialScores = results
    .map((r) => r.telemetry.initialVerdict?.score)
    .filter((n): n is number => typeof n === "number");
  const alreadyAtThreshold = initialScores.filter((s) => s >= 90).length;
  const triggeredRepair = results.filter((r) => r.telemetry.repairTrigger != null).length;
  const acceptedAttempts = results.flatMap((r) => r.telemetry.attempts).filter((a) => a.accepted === "yes").length;
  const totalAttempts = results.flatMap((r) => r.telemetry.attempts).length;
  const improvedRuns = results.filter((r) => {
    const v = r.telemetry.initialVerdict?.score;
    const best = r.telemetry.bestScore;
    return typeof v === "number" && typeof best === "number" && best > v;
  }).length;

  lines.push(`Total runs: ${total} (ok=${okRuns}, failed=${total - okRuns})`);
  lines.push(`Initial scores: ${initialScores.join(", ")}`);
  lines.push(
    `Already ≥90 on first verdict: ${alreadyAtThreshold}/${total} (${total === 0 ? "—" : ((alreadyAtThreshold / total) * 100).toFixed(0) + "%"})`,
  );
  lines.push(
    `Runs that triggered repair_light: ${triggeredRepair}/${total}`,
  );
  lines.push(
    `Repair attempts: ${totalAttempts} total / ${acceptedAttempts} accepted (improvement-rate=${totalAttempts === 0 ? "—" : ((acceptedAttempts / totalAttempts) * 100).toFixed(0) + "%"})`,
  );
  lines.push(
    `Runs where best > initial: ${improvedRuns}/${total}`,
  );

  // Issue-tag tally across initial verdicts.
  const tagCounts = new Map<string, number>();
  let structuralIssueRuns = 0;
  for (const r of results) {
    const issues = r.telemetry.initialVerdict?.issues ?? [];
    let hadStructural = false;
    for (const issue of issues) {
      const tags = classifySupervisorIssue(issue);
      for (const tag of tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
        if (isStructuralTag(tag)) hadStructural = true;
      }
    }
    if (hadStructural) structuralIssueRuns += 1;
  }
  const ranked = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);
  lines.push("");
  lines.push("Issue-tag frequency (across initial verdicts):");
  for (const [tag, n] of ranked) {
    lines.push(`  ${tag.padEnd(12)} ${n}   (structural=${isStructuralTag(tag) ? "yes" : "no"})`);
  }
  lines.push("");
  lines.push(
    `Runs with at least one structural issue on initial verdict: ${structuralIssueRuns}/${total}`,
  );

  return lines.join("\n");
}

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY missing — set it in .env.local or your shell env and rerun.");
    process.exit(1);
  }

  const durationSec = parseInt(process.env.DURATION_SEC ?? `${LONGFORM_THRESHOLD_SEC}`, 10);
  const filter = process.env.FILTER ?? "";
  const outDir = process.env.OUT_DIR ?? path.join("/tmp", `narrative-validate-${Date.now()}`);
  fs.mkdirSync(outDir, { recursive: true });

  const selected = CASES.filter((c) => (filter ? c.label.includes(filter) || c.style.includes(filter) : true));
  console.log(`[validate] starting cases=${selected.length} durationSec=${durationSec} outDir=${outDir}`);
  console.log(`[validate] OPENAI_API_KEY set, OPENAI_SUPERVISOR_MODEL=${process.env.OPENAI_SUPERVISOR_MODEL ?? "(default gpt-5.4-mini)"}`);
  console.log("");

  const results: RunResult[] = [];
  for (let i = 0; i < selected.length; i++) {
    const c = selected[i];
    console.log(`---- [${i + 1}/${selected.length}] ${c.label} (${c.style}) ----`);
    const r = await captureRun(c, durationSec);
    results.push(r);
    const t = r.telemetry;
    const init = t.initialVerdict?.score ?? null;
    const best = t.bestScore ?? init;
    console.log(
      `[validate] done label=${r.label} ok=${r.ok} ms=${r.totalMs} initial=${init ?? "—"} best=${best ?? "—"} attempts=${t.attemptsUsed ?? 0}/${t.maxRepairAttempts ?? "?"} editorPasses=${JSON.stringify(t.finalEditorPasses)}`,
    );
    if (!r.ok) console.log(`[validate] error: ${r.errorMessage}`);
    const perRunPath = path.join(outDir, `${r.label}.json`);
    fs.writeFileSync(
      perRunPath,
      JSON.stringify(
        {
          ...r,
          // truncate finalText in the per-run dump to keep file small but still
          // useful; full text is also written to a separate .txt file.
          finalText: r.finalText.slice(0, 4000),
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(path.join(outDir, `${r.label}.txt`), r.finalText);
    console.log(`[validate] wrote ${perRunPath}`);
    console.log("");
  }

  const summary = summarizeResults(results);
  console.log(summary);

  const summaryPath = path.join(outDir, "SUMMARY.md");
  fs.writeFileSync(summaryPath, summary);
  fs.writeFileSync(
    path.join(outDir, "results.json"),
    JSON.stringify(
      results.map((r) => ({ ...r, finalText: r.finalText.slice(0, 1200) })),
      null,
      2,
    ),
  );
  console.log(`[validate] wrote ${summaryPath}`);
}

main().catch((err) => {
  console.error("[validate] unexpected error:", err);
  process.exit(1);
});
