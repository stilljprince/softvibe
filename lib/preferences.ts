// lib/preferences.ts
//
// Helpers for the User Preference Profile feature.
//
// - buildSummaryMarkdown: derives a short, human-readable narrative from the
//   structured profile fields. Used for LLM prompt injection in the generation
//   pipeline. Output is intentionally short (target: < 1500 chars) so it never
//   dominates the user prompt.
//
// - sanitizePreferenceContextForPrompt: strips clinical/medical/therapy-sounding
//   keywords before injecting free-text into the model prompt. SoftVibe is not
//   a medical product — we never let user-typed therapy claims leak into the
//   generated script.
//
// - buildPreferenceContextBlock: produces the secondary-context block that
//   buildScriptOpenAI appends to its system prompt.

import type { UserPreferenceProfile } from "@prisma/client";

const GOAL_LABEL: Record<string, string> = {
  sleep: "Einschlafen",
  stress_relief: "Stressabbau",
  focus: "Fokus",
  relaxation: "Entspannung",
  comfort: "Geborgenheit / Trost",
  other: "Sonstiges",
};

const TONE_LABEL: Record<string, string> = {
  very_soft: "sehr weich",
  calm: "ruhig",
  neutral: "neutral",
  immersive: "immersiv",
};

const PACING_LABEL: Record<string, string> = {
  very_slow: "sehr langsam",
  slow: "langsam",
  medium: "mittel",
};

const VOICE_LABEL: Record<string, string> = {
  female: "weiblich",
  male: "männlich",
  no_preference: "keine Präferenz",
};

const DIRECT_ADDRESS_LABEL: Record<string, string> = {
  yes: "ja",
  no: "nein",
  subtle: "subtil",
};

// Words that suggest medical/diagnostic content — we never echo these into the
// LLM prompt so the model can't be nudged into therapy-style output.
const FORBIDDEN_TOKENS_RE =
  /\b(diagnos\w*|therapie|therapy|medikament\w*|medication|trauma|ptbs|ptsd|depress\w*|suicid\w*|suizid\w*|self[- ]?harm|panic\s+attack|panikattack\w*)\b/gi;

export function sanitizePreferenceContextForPrompt(text: string | null | undefined): string {
  if (!text) return "";
  // Replace forbidden tokens with a neutral placeholder. We keep surrounding
  // context so the rest of the user's note still informs tone.
  return text
    .replace(FORBIDDEN_TOKENS_RE, "…")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

function joinList(items: string[] | null | undefined, max = 6): string | null {
  if (!items || items.length === 0) return null;
  const cleaned = items
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
  return cleaned.length === 0 ? null : cleaned.join(", ");
}

/**
 * Builds a short narrative markdown summary from the structured profile fields.
 * Stable & deterministic — safe to recompute on every save.
 */
export function buildSummaryMarkdown(p: {
  primaryGoal?: string | null;
  preferredTone?: string | null;
  pacing?: string | null;
  preferredFormats?: string[] | null;
  likedThemes?: string[] | null;
  dislikedThemes?: string[] | null;
  voicePreference?: string | null;
  directAddressPreference?: string | null;
  contentBoundaries?: string[] | null;
  emotionalContext?: string | null;
  desiredOutcome?: string | null;
}): string {
  const lines: string[] = [];

  if (p.primaryGoal && GOAL_LABEL[p.primaryGoal]) {
    lines.push(`- **Hauptziel:** ${GOAL_LABEL[p.primaryGoal]}`);
  }
  if (p.preferredTone && TONE_LABEL[p.preferredTone]) {
    lines.push(`- **Bevorzugter Ton:** ${TONE_LABEL[p.preferredTone]}`);
  }
  if (p.pacing && PACING_LABEL[p.pacing]) {
    lines.push(`- **Tempo:** ${PACING_LABEL[p.pacing]}`);
  }
  if (p.voicePreference && VOICE_LABEL[p.voicePreference]) {
    lines.push(`- **Stimme:** ${VOICE_LABEL[p.voicePreference]}`);
  }
  if (p.directAddressPreference && DIRECT_ADDRESS_LABEL[p.directAddressPreference]) {
    lines.push(`- **Direkte Ansprache (du):** ${DIRECT_ADDRESS_LABEL[p.directAddressPreference]}`);
  }

  const liked = joinList(p.likedThemes);
  if (liked) lines.push(`- **Mag Themen:** ${liked}`);

  const disliked = joinList(p.dislikedThemes);
  if (disliked) lines.push(`- **Vermeidet:** ${disliked}`);

  const boundaries = joinList(p.contentBoundaries);
  if (boundaries) lines.push(`- **Inhaltsgrenzen:** ${boundaries}`);

  const formats = joinList(p.preferredFormats);
  if (formats) lines.push(`- **Bevorzugte Formate:** ${formats}`);

  const note = sanitizePreferenceContextForPrompt(p.emotionalContext);
  if (note) lines.push(`- **Persönliche Notiz:** ${note}`);

  const outcome = sanitizePreferenceContextForPrompt(p.desiredOutcome);
  if (outcome) lines.push(`- **Gewünschtes Ergebnis:** ${outcome}`);

  return lines.length > 0 ? lines.join("\n") : "";
}

/**
 * Wraps the summary in a clearly-marked secondary-context block for prompt
 * injection. Empty/whitespace summary → empty string (caller should bypass).
 */
export function buildPreferenceContextBlock(profile: UserPreferenceProfile | null): string {
  if (!profile) return "";

  const summary = (profile.summaryMarkdown ?? "").trim() || buildSummaryMarkdown(profile).trim();

  if (!summary) return "";

  return [
    "USER PREFERENCE CONTEXT (secondary; never overrides the user prompt above):",
    summary,
    "Use this only as soft style guidance. Never mention the preferences directly. Do not make medical, therapeutic, or diagnostic claims.",
  ].join("\n");
}

/**
 * Returns the structured-field subset of a profile, suitable for sending to
 * the iOS client. Strips DB-internal fields.
 */
export function serializeProfileForClient(profile: UserPreferenceProfile | null) {
  if (!profile) {
    return {
      primaryGoal: null,
      preferredTone: null,
      pacing: null,
      preferredFormats: [],
      likedThemes: [],
      dislikedThemes: [],
      voicePreference: null,
      directAddressPreference: null,
      contentBoundaries: [],
      emotionalContext: null,
      desiredOutcome: null,
      summaryMarkdown: null,
      version: 1,
      updatedAt: null as string | null,
    };
  }
  return {
    primaryGoal: profile.primaryGoal,
    preferredTone: profile.preferredTone,
    pacing: profile.pacing,
    preferredFormats: profile.preferredFormats,
    likedThemes: profile.likedThemes,
    dislikedThemes: profile.dislikedThemes,
    voicePreference: profile.voicePreference,
    directAddressPreference: profile.directAddressPreference,
    contentBoundaries: profile.contentBoundaries,
    emotionalContext: profile.emotionalContext,
    desiredOutcome: profile.desiredOutcome,
    summaryMarkdown: profile.summaryMarkdown,
    version: profile.version,
    updatedAt: profile.updatedAt.toISOString(),
  };
}
