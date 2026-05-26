// lib/validation/promptGate.ts
//
// P0 safety gate. Runs BEFORE credit debit and BEFORE any generation call.
// Three layers, in order:
//
//   1. validatePromptShape() — fast, local, free.
//      Catches empty/too-short, oversize, and gibberish prompts that would
//      otherwise feed the script-builder garbage and let the model
//      hallucinate meaning.
//
//   2. localSafetyCheck() — fast, local, free.
//      Catches unambiguous extremist phrases and extremist-subject +
//      glorification combos that the OpenAI Moderation API misses at
//      default thresholds. Neutral/educational mentions are left alone.
//
//   3. moderatePromptContent() — OpenAI Moderation API (omni-moderation-latest).
//      Catches unsafe/hateful/sexualized-minors/etc. We do NOT trust just
//      `result.flagged` — we read `category_scores` and apply stricter
//      SoftVibe thresholds so borderline hateful content also gets blocked.
//
// All user-facing messages are calm and non-corporate. No OpenAI category
// names or policy language ever leaves this module.
import OpenAI from "openai";

export type PromptGateCode =
  | "VALIDATION_TOO_SHORT"
  | "VALIDATION_TOO_LONG"
  | "VALIDATION_GIBBERISH"
  | "SAFETY_BLOCKED";

export type PromptGateOutcome =
  | { ok: true; normalized: string }
  | { ok: false; code: PromptGateCode; message: string; httpStatus: 400 | 422 };

// Calm copy. Tone calibrated to the brief: non-accusatory, non-technical,
// emotionally soft, still clear. German first (primary user base); English
// kept short because the iOS app currently surfaces these as-is.
export const PROMPT_GATE_COPY: Record<PromptGateCode, string> = {
  VALIDATION_TOO_SHORT:
    "Damit daraus etwas Schönes entstehen kann, braucht der Prompt noch etwas mehr Richtung.",
  VALIDATION_TOO_LONG:
    "Ein etwas kürzerer Prompt funktioniert besser. Magst du es verdichten?",
  VALIDATION_GIBBERISH:
    "Damit daraus etwas Schönes entstehen kann, braucht der Prompt noch etwas mehr Richtung.",
  SAFETY_BLOCKED:
    "Diese Art von Inhalt unterstützen wir nicht. Magst du ein anderes Thema wählen?",
};

const MIN_LENGTH = 4;       // hard floor — anything shorter cannot carry meaning
const MAX_LENGTH = 2000;    // generous — real prompts rarely exceed a few hundred
const MIN_ALPHA_RATIO = 0.4;

// Single-word prompts must look like an actual word. Accepts the broad set of
// vowel-like characters used across the languages SoftVibe accepts (de/en
// primarily, with romance + nordic tolerated). We deliberately exclude "y" —
// every legit ≥4-char single-word prompt has a real vowel, and including y
// would let "xyzz" / "yyzz" slip through the single-word gate.
const VOWEL_LIKE_RE = /[aeiouäöüáéíóúàèìòùâêîôûãõñå]/i;

// Curated short-theme allowlist (German + English). When a user types a
// single calm concept, we bypass the strict single-word heuristics — these
// are unambiguously legitimate SoftVibe topics. Lowercase, no whitespace.
// Extend conservatively: every entry here weakens the gibberish gate.
const SHORT_THEME_WHITELIST: ReadonlySet<string> = new Set([
  // de — calm themes
  "wald", "regen", "meer", "mond", "stern", "sterne", "nacht", "wolke",
  "wolken", "strand", "wiese", "berg", "berge", "himmel", "garten", "wind",
  "wasser", "feuer", "licht", "traum", "ruhe", "stille", "ozean", "welle",
  "wellen", "sonne", "schlaf", "atem", "herz", "weite", "ferne", "nebel",
  "regenwald", "wüste", "see", "fluss",
  // en — calm themes
  "rain", "forest", "space", "moon", "stars", "star", "ocean", "sleep",
  "cloud", "clouds", "sea", "garden", "mountain", "mountains", "light",
  "dream", "calm", "peace", "river", "sky", "snow", "fire", "fog",
  "mist", "storm", "lake", "wave", "waves", "breath", "heart", "shore",
  "meadow", "stream", "desert", "sunset", "sunrise", "twilight", "dawn",
  // celestial / generic
  "saturn", "jupiter", "mars", "venus", "neptune", "pluto", "earth",
  "galaxy", "nebula", "cosmos",
]);

function gibberish(): PromptGateOutcome {
  return {
    ok: false,
    code: "VALIDATION_GIBBERISH",
    message: PROMPT_GATE_COPY.VALIDATION_GIBBERISH,
    httpStatus: 400,
  };
}

// True if `s` contains a run of 3+ consecutive ASCII letters in alphabetical
// order (ascending or descending). This is the signature of "ABC", "ABCC",
// "xyzz", "abcd", "qrstu" — the textbook gibberish patterns. Real words
// almost never carry such a run (would-be false positives like "hijack"
// or "rstu" patterns inside words are filtered out by only applying this
// to single-word prompts, where the entire token is the run).
function hasAlphabetSequence(s: string): boolean {
  const lower = s.toLowerCase();
  let run = 1;
  for (let i = 1; i < lower.length; i++) {
    const prev = lower.charCodeAt(i - 1);
    const curr = lower.charCodeAt(i);
    const prevIsAlpha = prev >= 97 && prev <= 122;
    const currIsAlpha = curr >= 97 && curr <= 122;
    if (prevIsAlpha && currIsAlpha && (curr === prev + 1 || curr === prev - 1)) {
      run++;
      if (run >= 3) return true;
    } else {
      run = 1;
    }
  }
  return false;
}

export function validatePromptShape(input: string): PromptGateOutcome {
  const raw = (input ?? "").toString();
  const trimmed = raw.trim().replace(/\s+/g, " ");

  if (trimmed.length === 0 || trimmed.length < MIN_LENGTH) {
    return {
      ok: false,
      code: "VALIDATION_TOO_SHORT",
      message: PROMPT_GATE_COPY.VALIDATION_TOO_SHORT,
      httpStatus: 400,
    };
  }

  if (trimmed.length > MAX_LENGTH) {
    return {
      ok: false,
      code: "VALIDATION_TOO_LONG",
      message: PROMPT_GATE_COPY.VALIDATION_TOO_LONG,
      httpStatus: 400,
    };
  }

  // Mostly punctuation / digits / emojis — no real prompt content.
  // Use Unicode letter class so non-Latin scripts pass.
  const letters = trimmed.match(/\p{L}/gu) ?? [];
  const totalLetters = letters.length;
  const alphaRatio = totalLetters / trimmed.length;
  if (alphaRatio < MIN_ALPHA_RATIO) return gibberish();

  // Long runs of the same character ("aaaa", "!!!!", "....").
  if (/(.)\1{3,}/u.test(trimmed)) return gibberish();

  // Single-word prompts are the gibberish hotspot. Multi-word prompts get
  // the benefit of the doubt — they almost always carry intent.
  const words = trimmed.split(" ").filter(Boolean);
  if (words.length === 1) {
    const lower = trimmed.toLowerCase();
    // Curated calm themes bypass the strict single-word checks.
    if (SHORT_THEME_WHITELIST.has(lower)) {
      return { ok: true, normalized: trimmed };
    }
    if (totalLetters < 4) return gibberish();
    if (!VOWEL_LIKE_RE.test(trimmed)) return gibberish();
    // ABCC, abcc, xyzz, abcde — alphabet-walk gibberish.
    if (hasAlphabetSequence(trimmed)) return gibberish();
  }

  return { ok: true, normalized: trimmed };
}

// Local safety pre-filter. Two independent rules:
//
//   • STANDALONE: phrases that are unambiguous on their own (Nazi salutes,
//     hate-group calls). Block immediately regardless of surrounding text.
//
//   • SUBJECT × VALENCE: extremist subjects (Hitler, Nazi, NSDAP…) are
//     allowed when framed neutrally/educationally (e.g. "ruhige
//     Wissenssession über Adolf Hitler"). They are blocked only when paired
//     with glorifying or hostile language. This preserves the spec: do
//     NOT block the subject alone.
//
// This layer exists because OpenAI Moderation at default thresholds is
// inconsistent on these borderline cases — and once a prompt reaches the
// script-builder we lose control: the writer model silently rephrases
// hostile prompts into unrelated content. The local check is the
// reliable backstop.

const STANDALONE_EXTREMIST_RE =
  /\b(sieg\s*heil|heil\s*hitler|white\s*power|14\s*88|nazi\s*salute|gas\s*the\s+\w+|kill\s+(all|the)\s+(jews|blacks|muslims|whites|asians))\b/i;

const EXTREMIST_SUBJECT_RE =
  /\b(hitler|nazis?|nationalsozialismus|drittes\s+reich|third\s+reich|nsdap|kkk|ku\s*klux\s*klan|al[-\s]?qaeda|isis|daesh|taliban|hamas|holocaust|völkermord|genocide|arier|aryan(\s+race)?)\b/i;

// Words/phrases that signal *praise / glorification* of the subject. If the
// prompt mentions an extremist subject AND any of these, we block.
const GLORIFICATION_RE =
  /\b(heroes?|heroic|hero(?:in)?en?|helden?|brave|mutig|tapfer|celebrat(?:e|ing|ory)|feiern(?:d|de)?|honou?r(?:ing|s)?|ehren(?:d|de)?|tribute|hommage|großartig|grossartig|amazing|brilliant|brillant|wunderbar|glorious|glorreich|saviou?r|retter|inspiring|inspirierend|admirable|bewundernswert|wonderful|fantastic|fantastisch|noble|edel|war\s+(?:richtig|gut)|hatte\s+recht|come(?:s)?\s+back|wieder\s*kommen|wiederkommen|kommt\s+zurück|return\s+to\s+power|zurück\s+an\s+die\s+macht|sieg|victory|heil|hail|long\s+live|es\s+lebe)\b/i;

// Words that signal *neutral / educational / historical* framing. Pure
// historical mention is fine, even of dark subjects.
const NEUTRAL_FRAMING_RE =
  /\b(historisch|historical|geschichte|history|wissens|wissenssession|knowledge|edukativ|educational|lern|learn|biography|biografie|biographie|fakt|fact|dokumentation|documentary|recherche|research|aufkl[äa]rung|enlightenment)\b/i;

// Slur-like terms. We do not enumerate slurs themselves (we rely on the
// Moderation API for hate-score detection) — but we block prompts that
// pair the slur marker pattern ("the n-word", "n***", "n[…]r") with any
// extremist subject. This catches the documented "Hitler + slur" case
// when the user tries to obfuscate.
const SLUR_MARKER_RE =
  /\b(n-word|n\*+|n\*+r|n\.{2,}r|the\s+n\s+word|n\s*\.\.\.\s*r)\b/i;

export function localSafetyCheck(input: string): PromptGateOutcome {
  const text = (input ?? "").toString();

  // Tier 1 — unambiguous phrases. Block immediately.
  if (STANDALONE_EXTREMIST_RE.test(text)) {
    return {
      ok: false,
      code: "SAFETY_BLOCKED",
      message: PROMPT_GATE_COPY.SAFETY_BLOCKED,
      httpStatus: 422,
    };
  }

  // Tier 2 — extremist subject combined with hateful framing or slurs.
  const hasSubject = EXTREMIST_SUBJECT_RE.test(text);
  if (hasSubject) {
    if (SLUR_MARKER_RE.test(text) || GLORIFICATION_RE.test(text)) {
      // Praise/slur tilts a sensitive subject into prohibited territory.
      return {
        ok: false,
        code: "SAFETY_BLOCKED",
        message: PROMPT_GATE_COPY.SAFETY_BLOCKED,
        httpStatus: 422,
      };
    }
    // Subject alone — and especially with neutral framing — is allowed.
    // We deliberately do NOT block "Eine ruhige Wissenssession über
    // Adolf Hitler". The moderation layer still runs as a final check.
    void NEUTRAL_FRAMING_RE; // referenced for intent; behaviour is the default
  }

  return { ok: true, normalized: text };
}

// Lazy per CLAUDE.md — no module-level OpenAI client.
function getOpenAI(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// Moderation timeout: short. If the API is slow or down we fail OPEN
// (allow the prompt through). Rationale: moderation outage shouldn't
// brick the product, and the downstream kids post-check + the local
// safety layer above still catch the most egregious content.
const MODERATION_TIMEOUT_MS = parseInt(
  process.env.MODERATION_TIMEOUT_MS ?? "8000",
  10
);
const MODERATION_MODEL = process.env.OPENAI_MODERATION_MODEL ?? "omni-moderation-latest";

// SoftVibe-specific category thresholds. Tighter than the OpenAI defaults —
// we'd rather refuse a borderline prompt than ship a calmingly-narrated
// piece of hateful content. `result.flagged` alone (which uses OpenAI's
// own thresholds) misses too many borderline cases in real testing.
const STRICT_THRESHOLDS: Record<string, number> = {
  "hate": 0.20,
  "hate/threatening": 0.10,
  "harassment": 0.30,
  "harassment/threatening": 0.10,
  "sexual/minors": 0.05,
  "violence/graphic": 0.50,
  "self-harm/instructions": 0.20,
};

function exceedsStrictThreshold(scores: Record<string, number> | undefined | null): string | null {
  if (!scores) return null;
  for (const [cat, threshold] of Object.entries(STRICT_THRESHOLDS)) {
    const value = scores[cat];
    if (typeof value === "number" && value >= threshold) return cat;
  }
  return null;
}

export async function moderatePromptContent(input: string): Promise<PromptGateOutcome> {
  const text = input.trim();

  // If the OpenAI key isn't configured we cannot moderate. Fail open with a
  // log warning rather than blocking legitimate users in dev environments.
  if (!process.env.OPENAI_API_KEY) {
    console.warn("[promptGate] moderation skipped: OPENAI_API_KEY missing");
    return { ok: true, normalized: text };
  }

  try {
    const client = getOpenAI();
    const resp = await client.moderations.create(
      { model: MODERATION_MODEL, input: text },
      { timeout: MODERATION_TIMEOUT_MS }
    );

    const result = resp.results?.[0];
    if (result?.flagged) {
      return {
        ok: false,
        code: "SAFETY_BLOCKED",
        message: PROMPT_GATE_COPY.SAFETY_BLOCKED,
        httpStatus: 422,
      };
    }
    const strictHit = exceedsStrictThreshold(
      result?.category_scores as unknown as Record<string, number> | undefined
    );
    if (strictHit) {
      return {
        ok: false,
        code: "SAFETY_BLOCKED",
        message: PROMPT_GATE_COPY.SAFETY_BLOCKED,
        httpStatus: 422,
      };
    }
    return { ok: true, normalized: text };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.warn("[promptGate] moderation call failed, failing open:", msg);
    return { ok: true, normalized: text };
  }
}

// Refusal-text detection for prompt-improve.
//
// The OpenAI completion model occasionally returns a refusal string ("I'm
// sorry, but I can't assist with that.") even when our prompt gate let the
// input pass — usually because the input is technically safe but the model
// decides not to engage. Without this check, that refusal string gets
// returned to the iOS client as the *improved prompt* and overwrites the
// user's text field. We surface a typed safety response instead.
const REFUSAL_PATTERNS: RegExp[] = [
  /\bi('?m| am)\s+sorry,?\s+but\b/i,
  /\bi\s+(cannot|can'?t|am unable|am not able|will not|won'?t)\s+(help|assist|comply|do)/i,
  /\bsorry,?\s+(but\s+)?i\s+(can'?t|cannot)/i,
  /\b(es\s+tut\s+mir\s+leid|leider)\b.*\b(kann\s+ich|werde\s+ich)\b/i,
  /\bich\s+(kann|werde|möchte|moechte)\s+(dir|ihnen|damit)\s+nicht\s+(helfen|behilflich)/i,
  /\bich\s+kann\s+(hier|dabei|damit)\s+nicht\s+(helfen|weiterhelfen)/i,
  /\b(can'?t|cannot|won'?t|unable to)\s+(assist|help)\s+with\s+(that|this)\b/i,
  /\bi'?m\s+not\s+able\s+to\s+(help|assist|provide)/i,
  /\bas\s+an?\s+ai\s+(language\s+)?(model|assistant)/i,
];

export function looksLikeRefusal(text: string): boolean {
  const trimmed = (text ?? "").trim();
  if (trimmed.length === 0) return true;
  return REFUSAL_PATTERNS.some((re) => re.test(trimmed));
}

// Convenience wrapper: shape → local safety → moderation. Stops at the
// first failing layer. Used by both /api/jobs and /api/prompt-improve.
export async function runPromptGate(input: string): Promise<PromptGateOutcome> {
  const shape = validatePromptShape(input);
  if (!shape.ok) return shape;
  const local = localSafetyCheck(shape.normalized);
  if (!local.ok) return local;
  return moderatePromptContent(shape.normalized);
}
