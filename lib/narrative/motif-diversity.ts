// lib/narrative/motif-diversity.ts
//
// Conservative Motif Diversity Pass for already-strong long-form Narrative
// Story output. Runs ONLY for drafts whose supervisor score is at or above
// MOTIF_DIVERSITY_SCORE_THRESHOLD (gated by the orchestrator). The goal is
// not to fix flaws — earlier stages (copy-editor, repair-light, structural
// repair) own that. The goal is small, local de-repetition of sensory and
// motif patterns in stories that already work emotionally, so two strong
// stories don't feel identical in texture.
//
// This module is deliberately small:
//
//   1. analyzeMotifs(text)          — deterministic motif counter
//   2. ENDING_MOTIF_CATALOG         — curated atmospheric inspiration
//   3. runMotifDiversityPass(input) — one fail-soft OpenAI rewrite + guard
//
// The pass is an experiment. It must be conservative by design:
//   • maximum 3–5 local changes
//   • no plot, cast, revelation, timeline, or ending-meaning changes
//   • no new characters, no new exposition, no added drama
//   • length stays within ±3% of input word count
//   • on ANY failure (missing key, OpenAI error, parse error, empty output,
//     out-of-band length, too many changes) the orchestrator falls back
//     to the unchanged input text. Motif diversity is never allowed to
//     block a job or regress quality.
//
// Telemetry: [MOTIF_DIVERSITY] prefix on all log lines.

import OpenAI from "openai";
import { GERMAN_MOTIF_DICTIONARY } from "./motif-lexicon-de";
import {
  ENDING_MOTIF_CATALOG_DE,
  ENDING_MOTIF_CATALOG_EN,
  getEndingCatalog,
  type EndingAtmosphere,
} from "./ending-catalog";

// ─────────────────────────────────────────────────────────────────────────────
// Motif analysis (deterministic, pure)
// ─────────────────────────────────────────────────────────────────────────────

export type MotifCategory =
  | "weather_nature"
  | "objects"
  | "smells"
  | "gestures"
  | "silence_closure";

// English motif dictionary. Used when output language is English. German
// drafts use GERMAN_MOTIF_DICTIONARY from ./motif-lexicon-de, which is the
// primary lexicon — see CLAUDE.md and the orchestrator. Surface forms are
// short, lowercase, word-boundary-matched; we do not attempt full
// lemmatization, since the goal is only to surface high-frequency
// repetition, not exact linguistic recall.
const ENGLISH_MOTIF_DICTIONARY: Record<MotifCategory, Record<string, string[]>> = {
  weather_nature: {
    wind: ["wind", "winds", "windy"],
    rain: ["rain", "rains", "raining", "rainfall"],
    sea: ["sea", "seas", "ocean", "tide", "tides"],
    fog: ["fog", "foggy", "mist", "misty"],
    snow: ["snow", "snowy", "snowfall"],
    cold: ["cold", "chill", "chilly", "frost", "frosty"],
    grey_light: ["grey light", "gray light", "pale light", "thin light"],
  },
  objects: {
    table: ["table", "tables"],
    cup: ["cup", "cups", "mug", "mugs"],
    bowl: ["bowl", "bowls"],
    bread: ["bread", "loaf"],
    paper: ["paper", "papers"],
    letter: ["letter", "letters", "envelope", "envelopes"],
    key: ["key", "keys"],
    box: ["box", "boxes"],
  },
  smells: {
    soup: ["soup", "broth"],
    coffee: ["coffee"],
    wet_wood: ["wet wood", "damp wood"],
    dust: ["dust", "dusty"],
    smoke: ["smoke", "smoky"],
    salt: ["salt", "salty", "brine"],
  },
  gestures: {
    looking_down: ["looking down", "looked down", "looks down"],
    hand_on_table: ["hand on the table", "hands on the table"],
    nodding: ["nodded", "nodding", "nods"],
    standing_at_window: [
      "standing at the window",
      "stood at the window",
      "stands at the window",
    ],
    holding_cup: ["holding the cup", "held the cup", "holding her cup", "holding his cup"],
  },
  silence_closure: {
    silence: ["silence", "silent"],
    stillness: ["stillness", "still"],
    warmth: ["warmth", "warm"],
    door: ["door", "doors"],
    threshold: ["threshold", "thresholds"],
    light: ["light", "lights", "lit"],
  },
};

export type MotifAnalysis = {
  totalWords: number;
  // Which lexicon produced the result — useful in telemetry.
  language: "English" | "German";
  // Categories sorted descending by total category occurrences.
  categories: Array<{
    category: MotifCategory;
    totalOccurrences: number;
    // Top repeated motifs in this category (occurrence >= 2), descending.
    topMotifs: Array<{ label: string; count: number }>;
  }>;
};

// Word-boundary characters — anything in this set is treated as a LETTER,
// so a needle match flanked by one of these is NOT a word boundary and is
// rejected. German letters ä/ö/ü/ß are included so that, for example,
// "ofen" is correctly NOT matched inside "schöfen" and "wald" is correctly
// NOT matched inside "wäldern". Without this, the boundary check would
// treat umlauts as non-letters and produce false positives.
const LETTER_RE = /[a-zäöüß]/;

// Counts whole-word occurrences (case-insensitive). For multi-word surface
// forms ("grey light", "blick senken") the function matches on lowercased
// substring with adjacent-character boundary checks, since splitting on
// whitespace would lose the phrase. This is deliberately lightweight —
// good enough to surface repeated motifs, not a full NLP pipeline.
function countSurfaceForm(textLc: string, surface: string): number {
  if (!surface) return 0;
  const needle = surface.toLowerCase();
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const idx = textLc.indexOf(needle, from);
    if (idx === -1) break;
    const before = idx === 0 ? "" : textLc[idx - 1];
    const after =
      idx + needle.length >= textLc.length ? "" : textLc[idx + needle.length];
    const beforeOk = before === "" || !LETTER_RE.test(before);
    const afterOk = after === "" || !LETTER_RE.test(after);
    if (beforeOk && afterOk) count += 1;
    from = idx + needle.length;
  }
  return count;
}

// Picks the lexicon to use for analysis. German is the primary language of
// the narrative pipeline, so any value other than an explicit "English"
// routes through the German dictionary.
function dictionaryFor(
  language: "English" | "German",
): Record<MotifCategory, Record<string, string[]>> {
  return language === "English" ? ENGLISH_MOTIF_DICTIONARY : GERMAN_MOTIF_DICTIONARY;
}

export function analyzeMotifs(
  text: string,
  language: "English" | "German" = "German",
): MotifAnalysis {
  const safe = typeof text === "string" ? text : "";
  const textLc = safe.toLowerCase();
  const totalWords = safe.split(/\s+/).filter(Boolean).length;
  const dict = dictionaryFor(language);

  const categories: MotifAnalysis["categories"] = [];
  (Object.keys(dict) as MotifCategory[]).forEach((category) => {
    const labels = dict[category];
    const motifCounts: Array<{ label: string; count: number }> = [];
    let totalOccurrences = 0;
    Object.keys(labels).forEach((label) => {
      const surfaces = labels[label];
      let count = 0;
      for (const surf of surfaces) count += countSurfaceForm(textLc, surf);
      if (count > 0) {
        motifCounts.push({ label, count });
        totalOccurrences += count;
      }
    });
    motifCounts.sort((a, b) => b.count - a.count);
    const topMotifs = motifCounts.filter((m) => m.count >= 2).slice(0, 5);
    categories.push({ category, totalOccurrences, topMotifs });
  });

  categories.sort((a, b) => b.totalOccurrences - a.totalOccurrences);
  return { totalWords, language, categories };
}

// Render the analysis as compact bullet lines for the model prompt. Only
// includes motifs that actually repeat (count >= 2). Returns an empty string
// when nothing repeats noticeably — in that case the rewrite has very little
// to do and the orchestrator can still call this pass (it will almost
// certainly be rejected by the guardrails or the model itself).
function formatAnalysisForPrompt(analysis: MotifAnalysis): string {
  const lines: string[] = [];
  for (const cat of analysis.categories) {
    if (cat.topMotifs.length === 0) continue;
    const items = cat.topMotifs
      .map((m) => `${m.label}×${m.count}`)
      .join(", ");
    lines.push(`  • ${cat.category}: ${items}`);
  }
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Ending / motif inspiration catalog (curated, quiet, non-formulaic)
// ─────────────────────────────────────────────────────────────────────────────
//
// The actual catalog data lives in ./ending-catalog (German primary, English
// secondary). The legacy `ENDING_MOTIF_CATALOG` export is kept as an alias to
// the German catalog so any out-of-tree consumer continues to compile.
export type { EndingAtmosphere };
export const ENDING_MOTIF_CATALOG = ENDING_MOTIF_CATALOG_DE;
export { ENDING_MOTIF_CATALOG_DE, ENDING_MOTIF_CATALOG_EN };

// Compact catalog summary for the prompt. Kept inline rather than the full
// catalog so the prompt doesn't balloon — the model gets 2–3 sample lines per
// atmosphere in the target language plus the explicit instruction that
// catalog items are inspirations only.
function formatCatalogForPrompt(language: "English" | "German"): string {
  const catalog = getEndingCatalog(language);
  const lines: string[] = [];
  (Object.keys(catalog) as EndingAtmosphere[]).forEach((atm) => {
    const sample = catalog[atm].slice(0, 3);
    lines.push(`  • ${atm}: ${sample.map((s) => `"${s}"`).join("; ")}`);
  });
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Micro rewriter (conservative motif-diversity pass)
// ─────────────────────────────────────────────────────────────────────────────

export type MotifDiversityInput = {
  finalText: string;
  outputLanguage: "English" | "German";
  wordTarget: number;
  bestScore: number;
  openaiTimeoutMs?: number;
  model?: string;
};

export type MotifDiversityOutput = {
  // The text the orchestrator should use going forward. Equal to input on
  // rejection or any failure.
  finalText: string;
  // True only if a model candidate was produced AND passed guardrails.
  accepted: boolean;
  // Short reason string for telemetry (e.g. "no_repeated_motifs",
  // "out_of_length_band", "too_many_changes", "ok").
  reason: string;
  // Concrete edit descriptions from the model. Empty on rejection.
  changesSummary: string[];
};

// Guardrail thresholds. Pulled into named constants so log lines and accept/
// reject decisions stay consistent.
const MAX_LOCAL_CHANGES = 5;
const LENGTH_BAND_PCT = 0.03; // ±3% of input word count

export async function runMotifDiversityPass(
  input: MotifDiversityInput,
): Promise<MotifDiversityOutput> {
  const originalText = input.finalText ?? "";
  const originalWords = originalText.split(/\s+/).filter(Boolean).length;

  // Analyze first — the result feeds the prompt AND determines whether the
  // pass has anything to do at all. German is the primary lexicon; English
  // drafts route through the English dictionary.
  const analysis = analyzeMotifs(originalText, input.outputLanguage);
  const analysisLines = formatAnalysisForPrompt(analysis);
  const repeatedMotifCount = analysis.categories.reduce(
    (acc, c) => acc + c.topMotifs.length,
    0,
  );

  // Per-category occurrence counts, for visibility over many runs into
  // which motif families dominate.
  const hitByCategory = (cat: MotifCategory): number =>
    analysis.categories.find((c) => c.category === cat)?.totalOccurrences ?? 0;
  const weatherHits = hitByCategory("weather_nature");
  const objectHits = hitByCategory("objects");
  const smellHits = hitByCategory("smells");
  const gestureHits = hitByCategory("gestures");
  const closureHits = hitByCategory("silence_closure");

  // Top repeated motifs across all categories — descending by count, capped
  // at 8 entries so telemetry stays one line.
  const topRepeatedMotifs = analysis.categories
    .flatMap((c) => c.topMotifs.map((m) => ({ label: m.label, count: m.count })))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((m) => `${m.label}×${m.count}`);

  console.info(
    `[MOTIF_DIVERSITY] phase=analysis language=${analysis.language} originalWords=${originalWords} repeatedMotifCount=${repeatedMotifCount} bestScore=${input.bestScore}`,
  );
  console.info(
    `[MOTIF_DIVERSITY] phase=analysis weatherHits=${weatherHits} objectHits=${objectHits} smellHits=${smellHits} gestureHits=${gestureHits} closureHits=${closureHits}`,
  );
  if (topRepeatedMotifs.length > 0) {
    console.info(
      `[MOTIF_DIVERSITY] topRepeatedMotifs=[${topRepeatedMotifs.join(", ")}]`,
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    console.warn(
      `[MOTIF_DIVERSITY] accepted=no reason=missing_api_key originalWords=${originalWords}`,
    );
    return {
      finalText: originalText,
      accepted: false,
      reason: "missing_api_key",
      changesSummary: [],
    };
  }

  if (repeatedMotifCount === 0) {
    console.info(
      `[MOTIF_DIVERSITY] accepted=no reason=no_repeated_motifs originalWords=${originalWords}`,
    );
    return {
      finalText: originalText,
      accepted: false,
      reason: "no_repeated_motifs",
      changesSummary: [],
    };
  }

  const model =
    input.model ??
    process.env.OPENAI_NARRATIVE_MOTIF_DIVERSITY_MODEL ??
    process.env.OPENAI_NARRATIVE_EDITOR_MODEL ??
    process.env.OPENAI_EDITOR_MODEL ??
    "gpt-5.4-mini";

  const timeoutMs =
    typeof input.openaiTimeoutMs === "number" &&
    Number.isFinite(input.openaiTimeoutMs)
      ? input.openaiTimeoutMs
      : parseInt(
          process.env.OPENAI_NARRATIVE_MOTIF_DIVERSITY_TIMEOUT_MS ??
            process.env.OPENAI_NARRATIVE_EDITOR_TIMEOUT_MS ??
            "180000",
          10,
        );

  // Token budget: anchored on the input draft (the rewrite is roughly the
  // same length). Plus JSON overhead headroom.
  const maxTokens = Math.min(16000, originalWords * 3 + 1024);

  // Hard length band (±3% of input words). A motif pass must NOT reshape
  // length — this is the same band the acceptance check uses below.
  const targetMin = Math.max(
    1,
    Math.round(originalWords * (1 - LENGTH_BAND_PCT)),
  );
  const targetMax = Math.max(
    targetMin,
    Math.round(originalWords * (1 + LENGTH_BAND_PCT)),
  );

  const catalogLines = formatCatalogForPrompt(input.outputLanguage);

  const system = [
    `You are a senior literary novelist performing a CONSERVATIVE motif diversity pass on an already-finished narrative draft.`,
    ``,
    `The draft has already scored highly with the Story Supervisor. It is emotionally and structurally sound. Your ONLY job is to reduce the repetition of a small number of sensory and motif patterns so the story feels textured rather than circular. You are NOT fixing structural problems. You are NOT repairing weaknesses. You are NOT making the story more dramatic.`,
    ``,
    `━━━ ABSOLUTE LIMITS ━━━`,
    `  • Make at MOST ${MAX_LOCAL_CHANGES} local changes. Fewer is fine. Zero is fine — if you cannot improve diversity without breaking the rules, return the draft unchanged.`,
    `  • Each change must be LOCAL: a phrase, a sensory detail, an object reference, a gesture, or the final image. Never a whole scene.`,
    `  • Total length must stay within ±3% of input word count: BAND ${targetMin}–${targetMax} words.`,
    ``,
    `━━━ HARD CONSTRAINTS — NEVER DO ━━━`,
    `  • Do NOT change the plot.`,
    `  • Do NOT change the cast or add new characters.`,
    `  • Do NOT change revelations, facts, the timeline, or the ending meaning.`,
    `  • Do NOT add new exposition or backstory.`,
    `  • Do NOT make the story more dramatic, more eventful, or higher in stakes.`,
    `  • Do NOT change emotional meaning of any scene.`,
    `  • Do NOT change structure or reorder scenes.`,
    `  • Do NOT change the output language. Keep prose voice, register, and pacing intact.`,
    `  • Do NOT add markdown, headings, or meta commentary.`,
    ``,
    `━━━ WHAT YOU MAY DO ━━━`,
    `  • Replace one of several repeated sensory details with a quieter, equally apt alternative — e.g. the third use of "wind" becomes "thin grey light" or "the smell of wet wood".`,
    `  • Vary one or two repeated gestures — e.g. a second "looking down" becomes "a hand briefly steadying the cup".`,
    `  • Adjust the FINAL closing image so it does not echo a sensory beat already used earlier in the story — pick a quieter alternative that fits the same atmosphere.`,
    `  • Substitute a repeated object reference with an equally ordinary object already plausibly present in the scene.`,
    ``,
    `━━━ ENDING / MOTIF CATALOG — INSPIRATION ONLY ━━━`,
    `Use these as quiet inspiration ONLY when the existing atmosphere matches. Do not force any of them. Do not make the ending feel formulaic. Most stories will not pick from this list at all; that is correct.`,
    catalogLines,
    ``,
    `━━━ PRESERVE — non-negotiable ━━━`,
    `  • Literary prose voice and vocabulary level`,
    `  • Calm, slow, TTS-friendly pacing`,
    `  • Characters, relationships, settings, decisions, and the causal chain`,
    `  • Atmosphere and overall sensory palette — you may diversify within it, not replace it`,
    `  • The emotional landing of the ending`,
    `  • The original output language`,
    ``,
    `Output language: ${input.outputLanguage}`,
    `Return ONLY valid JSON: {"finalText": "...", "changesSummary": ["...", ...]}. finalText is continuous prose only — no markdown, no headings, no segment labels. changesSummary lists each local change you made (or is empty if you made none).`,
  ].join("\n");

  const user = [
    `Apply ONE conservative MOTIF DIVERSITY pass to the following narrative draft.`,
    ``,
    `Current draft: ~${originalWords} words. Latest supervisor score: ${input.bestScore}.`,
    `MANDATORY length band: ${targetMin}–${targetMax} words. Output outside this band is INVALID.`,
    `MANDATORY change budget: at most ${MAX_LOCAL_CHANGES} local changes. Fewer is better.`,
    ``,
    repeatedMotifCount > 0
      ? `Repeated motif analysis (occurrence ≥ 2):\n${analysisLines}`
      : `Repeated motif analysis: none detected — return the draft unchanged if no diversity gain is possible without breaking the rules.`,
    ``,
    `Focus on the repeated motifs above. Do NOT touch beats the supervisor would call structural. Do NOT touch the ending meaning — only the final image's surface. If a high-frequency motif is intentional (e.g. a recurring symbol stated at the outset), leave it alone.`,
    ``,
    `If you cannot make at least one safe, local improvement under these rules, return the draft unchanged and an empty changesSummary array. That is a valid result.`,
    ``,
    `DRAFT:`,
    `---`,
    originalText,
    `---`,
    ``,
    `Return JSON: {"finalText": "...", "changesSummary": [...]}.`,
    `changesSummary: name each local edit concretely. Examples:`,
    `  GOOD: "replaced second 'wind through the trees' with 'thin grey light along the wall' to break weather-motif repetition"`,
    `  GOOD: "varied final closing image from 'silence around the table' to 'a lamp left on in the hallway' (same warmth, less echo of the kitchen scene)"`,
    `  GOOD: "swapped a third 'looking down' for 'her hand briefly steadying the cup'"`,
    `  BAD: "improved sensory variety" (too vague)`,
    `Max ${MAX_LOCAL_CHANGES} items.`,
  ].join("\n");

  console.info(
    `[MOTIF_DIVERSITY] phase=rewrite.start preset=narrative model=${model} originalWords=${originalWords} targetBand=${targetMin}-${targetMax} repeatedMotifCount=${repeatedMotifCount}`,
  );

  let resp;
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    resp = await openai.responses.create(
      {
        model,
        max_output_tokens: maxTokens,
        input: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "SoftVibeNarrativeMotifDiversityResult",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                finalText: { type: "string" },
                changesSummary: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: ["finalText", "changesSummary"],
            },
          },
        },
      },
      { timeout: timeoutMs },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[MOTIF_DIVERSITY] accepted=no reason=openai_call_failed:${msg.slice(0, 160)} originalWords=${originalWords}`,
    );
    return {
      finalText: originalText,
      accepted: false,
      reason: "openai_call_failed",
      changesSummary: [],
    };
  }

  const rawText = resp.output_text ?? "";
  const respStatus = resp.status ?? "unknown";

  if (respStatus === "incomplete") {
    console.warn(
      `[MOTIF_DIVERSITY] accepted=no reason=response_truncated length=${rawText.length} originalWords=${originalWords}`,
    );
    return {
      finalText: originalText,
      accepted: false,
      reason: "response_truncated",
      changesSummary: [],
    };
  }

  let parsed: { finalText: string; changesSummary: string[] };
  try {
    parsed = JSON.parse(rawText) as {
      finalText: string;
      changesSummary: string[];
    };
  } catch {
    console.warn(
      `[MOTIF_DIVERSITY] accepted=no reason=json_parse_error status=${respStatus} length=${rawText.length} originalWords=${originalWords}`,
    );
    return {
      finalText: originalText,
      accepted: false,
      reason: "json_parse_error",
      changesSummary: [],
    };
  }

  const candidateText = (parsed.finalText ?? "").trim();
  const changesSummary = Array.isArray(parsed.changesSummary)
    ? parsed.changesSummary.filter((s): s is string => typeof s === "string")
    : [];

  if (!candidateText) {
    console.warn(
      `[MOTIF_DIVERSITY] accepted=no reason=empty_final_text status=${respStatus} originalWords=${originalWords}`,
    );
    return {
      finalText: originalText,
      accepted: false,
      reason: "empty_final_text",
      changesSummary: [],
    };
  }

  const editedWords = candidateText.split(/\s+/).filter(Boolean).length;
  const deltaPct =
    originalWords > 0
      ? Math.round(((editedWords - originalWords) / originalWords) * 1000) / 10
      : 0;
  const changesCount = changesSummary.length;

  // Guardrail 1: hard length band (±3%).
  if (editedWords < targetMin || editedWords > targetMax) {
    console.warn(
      `[MOTIF_DIVERSITY] phase=rewrite.done originalWords=${originalWords} editedWords=${editedWords} deltaPct=${deltaPct} changesCount=${changesCount}`,
    );
    console.warn(
      `[MOTIF_DIVERSITY] accepted=no reason=out_of_length_band editedWords=${editedWords} targetMin=${targetMin} targetMax=${targetMax} deltaPct=${deltaPct}`,
    );
    return {
      finalText: originalText,
      accepted: false,
      reason: "out_of_length_band",
      changesSummary: [],
    };
  }

  // Guardrail 2: change budget. A motif pass that claims more than
  // MAX_LOCAL_CHANGES edits is almost certainly doing more than motif work —
  // reject and keep the original.
  if (changesCount > MAX_LOCAL_CHANGES) {
    console.warn(
      `[MOTIF_DIVERSITY] phase=rewrite.done originalWords=${originalWords} editedWords=${editedWords} deltaPct=${deltaPct} changesCount=${changesCount}`,
    );
    console.warn(
      `[MOTIF_DIVERSITY] accepted=no reason=too_many_changes changesCount=${changesCount} max=${MAX_LOCAL_CHANGES}`,
    );
    return {
      finalText: originalText,
      accepted: false,
      reason: "too_many_changes",
      changesSummary: [],
    };
  }

  // Guardrail 3: a zero-change candidate that is identical to the input is a
  // valid "no-op" result, but we report it as not accepted (so the caller
  // doesn't log a misleading "applied 0 changes" success).
  if (changesCount === 0 || candidateText === originalText) {
    console.info(
      `[MOTIF_DIVERSITY] phase=rewrite.done originalWords=${originalWords} editedWords=${editedWords} deltaPct=${deltaPct} changesCount=${changesCount}`,
    );
    console.info(
      `[MOTIF_DIVERSITY] accepted=no reason=no_change`,
    );
    return {
      finalText: originalText,
      accepted: false,
      reason: "no_change",
      changesSummary: [],
    };
  }

  console.info(
    `[MOTIF_DIVERSITY] phase=rewrite.done originalWords=${originalWords} editedWords=${editedWords} deltaPct=${deltaPct} changesCount=${changesCount}`,
  );
  const summaryLine = changesSummary.join(" | ");
  const summaryTruncated =
    summaryLine.length > 500 ? `${summaryLine.slice(0, 500)}…` : summaryLine;
  console.info(`[MOTIF_DIVERSITY] changesSummary=[${summaryTruncated}]`);
  console.info(`[MOTIF_DIVERSITY] accepted=yes reason=ok`);

  return {
    finalText: candidateText,
    accepted: true,
    reason: "ok",
    changesSummary,
  };
}
