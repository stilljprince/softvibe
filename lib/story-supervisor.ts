// lib/story-supervisor.ts
//
// Pass-C3E: read-only Story Supervisor / Evaluator.
//
// Runs after the editor pass and before TTS/chunking. It evaluates the
// finished script's quality and emits a structured signal. It is LOGGING-
// ONLY in this pass:
//   • it never modifies the script
//   • it never blocks generation
//   • it never triggers an automatic rewrite
//   • a low score does not fail the job
//
// The output is meant to be observed over time so future passes can decide
// whether to add automatic rewrite loops. For now, the signal is captured
// in the logs and that is enough.
//
// Failure handling: every code path that could throw is wrapped. If the
// supervisor cannot produce a verdict, it logs a single warning and returns
// null. Generation continues unaffected.
//
// Kill switch: callers honor SKIP_STORY_SUPERVISOR=1 to bypass this stage
// entirely. This module logs a small diagnostic if it ever runs without an
// API key configured so the absence is visible.
//
// Telemetry: [STORY_SUPERVISOR] prefix on all log lines.

import OpenAI from "openai";

export type StorySupervisorPreset =
  | "sleep-story"
  | "narrative"
  | "kids-story"
  | "meditation"
  | "classic-asmr"
  | string;

export type StorySupervisorRecommendation =
  | "accept"
  | "minor_issues"
  | "rewrite_recommended";

export type StorySupervisorResult = {
  overallScore: number;
  recommendation: StorySupervisorRecommendation;
  issues: string[];
  strengths: string[];
  notes: string;
};

export type EvaluateStoryQualityInput = {
  finalText: string;
  outputLanguage: "English" | "German";
  preset: StorySupervisorPreset;
  openaiTimeoutMs?: number;
  model?: string;
};

const RECOMMENDATIONS: readonly StorySupervisorRecommendation[] = [
  "accept",
  "minor_issues",
  "rewrite_recommended",
] as const;

export async function evaluateStoryQuality(
  input: EvaluateStoryQualityInput,
): Promise<StorySupervisorResult | null> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn(
      `[STORY_SUPERVISOR] failed reason=missing_api_key preset=${input.preset} continuing_generation=true`,
    );
    return null;
  }

  const finalText = (input.finalText ?? "").trim();
  if (!finalText) {
    console.warn(
      `[STORY_SUPERVISOR] failed reason=empty_final_text preset=${input.preset} continuing_generation=true`,
    );
    return null;
  }

  const model =
    input.model ??
    process.env.OPENAI_SUPERVISOR_MODEL ??
    process.env.OPENAI_EDITOR_MODEL ??
    "gpt-5.4-mini";

  const timeoutMs =
    typeof input.openaiTimeoutMs === "number" && Number.isFinite(input.openaiTimeoutMs)
      ? input.openaiTimeoutMs
      : parseInt(process.env.OPENAI_SUPERVISOR_TIMEOUT_MS ?? "90000", 10);

  const wordCount = finalText.split(/\s+/).filter(Boolean).length;

  const system = [
    `You are a senior story editor performing a READ-ONLY quality review of a finished script that will be read aloud as a relaxation / sleep audio piece.`,
    `Your job is to assess the finished text and return a structured evaluation. You do NOT modify it. You do NOT suggest rewrites in the text. You return ONLY the structured verdict described below.`,
    ``,
    `Evaluate the script across these dimensions:`,
    `• Coherence: does the narrative hold together? are causal links clear?`,
    `• Pacing: does the story breathe — neither rushed nor dragging?`,
    `• Repetition: is there obvious duplication of phrasing, imagery, or beats that survived the editor pass?`,
    `• Closure: is there a clean ending — not premature, not over-extended?`,
    `• Tone: is the language calm, warm, and TTS-friendly?`,
    `• Listener experience: would a listener trying to relax or fall asleep find this rewarding?`,
    ``,
    `Be concrete. Be honest. This is a quality signal, not a marketing summary.`,
    `Do NOT propose edits in prose form. Do NOT include a rewritten version of the script. Do NOT include any text outside the JSON envelope.`,
    ``,
    `Return strict JSON only, matching exactly this shape:`,
    `{`,
    `  "overallScore": integer 0–100,`,
    `  "recommendation": "accept" | "minor_issues" | "rewrite_recommended",`,
    `  "issues": array of short concrete strings (each ≤ 160 chars) naming specific problems — empty array if none,`,
    `  "strengths": array of short concrete strings (each ≤ 160 chars) naming specific strengths — empty array if none,`,
    `  "notes": short free-form remarks (≤ 400 chars) — empty string if none`,
    `}`,
    ``,
    `Recommendation guide:`,
    `• "accept" — strong piece, ready to ship`,
    `• "minor_issues" — ships as-is, but specific small problems are worth noting`,
    `• "rewrite_recommended" — substantive problems that meaningfully degrade the listener experience`,
    ``,
    `The script language is ${input.outputLanguage}. Score the script in its own language; do not penalize it for not being in another language.`,
  ].join("\n");

  const user = [
    `Preset: ${input.preset}`,
    `Word count: ~${wordCount}`,
    ``,
    `SCRIPT:`,
    `---`,
    finalText,
    `---`,
    ``,
    `Return ONLY the JSON verdict described in the system message.`,
  ].join("\n");

  let resp;
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    resp = await openai.responses.create(
      {
        model,
        max_output_tokens: 1200,
        input: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "SoftVibeStorySupervisorVerdict",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                overallScore: { type: "number" },
                recommendation: {
                  type: "string",
                  enum: ["accept", "minor_issues", "rewrite_recommended"],
                },
                issues: { type: "array", items: { type: "string" } },
                strengths: { type: "array", items: { type: "string" } },
                notes: { type: "string" },
              },
              required: ["overallScore", "recommendation", "issues", "strengths", "notes"],
            },
          },
        },
      },
      { timeout: timeoutMs },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[STORY_SUPERVISOR] failed reason=openai_call_failed:${msg.slice(0, 160)} preset=${input.preset} continuing_generation=true`,
    );
    return null;
  }

  const rawText = resp.output_text ?? "";
  const respStatus = resp.status ?? "unknown";

  if (respStatus === "incomplete") {
    console.warn(
      `[STORY_SUPERVISOR] failed reason=response_truncated length=${rawText.length} preset=${input.preset} continuing_generation=true`,
    );
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    console.warn(
      `[STORY_SUPERVISOR] failed reason=json_parse_error status=${respStatus} length=${rawText.length} preset=${input.preset} continuing_generation=true`,
    );
    return null;
  }

  const verdict = coerceVerdict(parsed);
  if (!verdict) {
    console.warn(
      `[STORY_SUPERVISOR] failed reason=schema_coercion_failed preset=${input.preset} continuing_generation=true`,
    );
    return null;
  }

  const issuesLine = verdict.issues.slice(0, 6).join(" | ");
  const strengthsLine = verdict.strengths.slice(0, 6).join(" | ");
  const issuesTruncated = issuesLine.length > 500 ? `${issuesLine.slice(0, 500)}…` : issuesLine;
  const strengthsTruncated = strengthsLine.length > 500 ? `${strengthsLine.slice(0, 500)}…` : strengthsLine;
  const notesPreview = verdict.notes.slice(0, 240).replace(/\s+/g, " ").trim();

  console.info(
    `[STORY_SUPERVISOR] preset=${input.preset} model=${model} score=${verdict.overallScore} ` +
      `recommendation=${verdict.recommendation} issuesCount=${verdict.issues.length} ` +
      `strengthsCount=${verdict.strengths.length} words=${wordCount} lang=${input.outputLanguage}`,
  );
  if (verdict.issues.length > 0) {
    console.info(`[STORY_SUPERVISOR] issues=[${issuesTruncated}]`);
  }
  if (verdict.strengths.length > 0) {
    console.info(`[STORY_SUPERVISOR] strengths=[${strengthsTruncated}]`);
  }
  if (notesPreview) {
    console.info(`[STORY_SUPERVISOR] notes="${notesPreview}"`);
  }

  return verdict;
}

function coerceVerdict(raw: unknown): StorySupervisorResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const scoreNum = typeof r.overallScore === "number" ? r.overallScore : Number(r.overallScore);
  if (!Number.isFinite(scoreNum)) return null;
  const overallScore = Math.max(0, Math.min(100, Math.round(scoreNum)));

  const recRaw = typeof r.recommendation === "string" ? r.recommendation : "";
  const recommendation: StorySupervisorRecommendation = RECOMMENDATIONS.includes(
    recRaw as StorySupervisorRecommendation,
  )
    ? (recRaw as StorySupervisorRecommendation)
    : "minor_issues";

  const issues = Array.isArray(r.issues)
    ? r.issues.filter((s): s is string => typeof s === "string")
    : [];
  const strengths = Array.isArray(r.strengths)
    ? r.strengths.filter((s): s is string => typeof s === "string")
    : [];
  const notes = typeof r.notes === "string" ? r.notes : "";

  return { overallScore, recommendation, issues, strengths, notes };
}
