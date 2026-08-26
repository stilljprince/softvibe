// lib/tts/elevenlabs.ts
import type { TTSAdapter, TTSSpeakInput, TTSSpeakResult } from "./adapter";
import { ensureTtsPayloadWithinLimit, getPostProsodyMaxChars } from "@/lib/audio/chunks";

const API_KEY = process.env.ELEVENLABS_API_KEY;

// Fallback-Model & Default-Voice (Backup, falls envs fehlen)
const DEFAULT_MODEL =
  process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";

const DEFAULT_VOICE =
  process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";

// Optional: spezielle Voices pro Preset (kannst du in .env setzen)


const VOICE_SLEEP_STORY =
  process.env.ELEVENLABS_VOICE_SLEEP_STORY_ID || DEFAULT_VOICE;

const VOICE_MEDITATION =
  process.env.ELEVENLABS_VOICE_MEDITATION_ID || DEFAULT_VOICE;

// Read at call time so deployments that set the env after module init still work.
// One slot per distinct fallback path so each path warns at most once.
const kidsStoryWarned = new Set<string>();
function warnKidsStoryOnce(key: string, message: string) {
  if (kidsStoryWarned.has(key)) return;
  kidsStoryWarned.add(key);
  console.warn(message);
}

// Same warn-once pattern for the Narrative preset.
const narrativeWarned = new Set<string>();
function warnNarrativeOnce(key: string, message: string) {
  if (narrativeWarned.has(key)) return;
  narrativeWarned.add(key);
  console.warn(message);
}



// Falls kein API-Key gesetzt ist, nur warnen – Fehler kommt erst bei speak()
if (!API_KEY) {
  console.warn(
    "[TTS] ELEVENLABS_API_KEY ist nicht gesetzt – TTS-Aufrufe werden fehlschlagen."
  );
}

/**
 * Kleiner Helper, um aus einem Preset (und optional expliziter VoiceId)
 * die tatsächlich zu verwendende ElevenLabs-Voice-ID zu bestimmen.
 */
function isV3Model(modelId: string) {
  return modelId.toLowerCase().includes("eleven_v3");
}

function normalizeStabilityForModel(modelId: string, stability?: number) {
  const s = typeof stability === "number" ? stability : undefined;

  // v3: nur 0.0 / 0.5 / 1.0 erlaubt
  if (isV3Model(modelId)) {
    // Default: Natural
    if (s === undefined || Number.isNaN(s)) return 0.5;

    // Map continuous -> discrete bucket
    if (s < 0.25) return 0.0;      // Creative
    if (s < 0.75) return 0.5;      // Natural
    return 1.0;                   // Robust
  }

  // v2: continuous okay
  return s ?? 0.4;
}

export function prepareTtsText(opts: {
  text: string;
  preset?: string | null;
  modelId?: string | null;
}): string {
  const base = (opts.text ?? "").trim();
  return base;
}

type VoiceStyle = "soft" | "whisper";
type VoiceGender = "female" | "male";

const VOICE_ASMR_SOFT_FEMALE =
  process.env.ELEVENLABS_VOICE_ASMR_SOFT_FEMALE_ID || DEFAULT_VOICE;
const VOICE_ASMR_WHISPER_FEMALE =
  process.env.ELEVENLABS_VOICE_ASMR_WHISPER_FEMALE_ID || DEFAULT_VOICE;
const VOICE_ASMR_SOFT_MALE =
  process.env.ELEVENLABS_VOICE_ASMR_SOFT_MALE_ID || DEFAULT_VOICE;
const VOICE_ASMR_WHISPER_MALE =
  process.env.ELEVENLABS_VOICE_ASMR_WHISPER_MALE_ID || DEFAULT_VOICE;

export function resolveVoiceId(
  preset?: string | null,
  voiceStyle: VoiceStyle = "soft",
  voiceGender: VoiceGender = "female",
  explicitVoiceId?: string | null
): string {
  if (explicitVoiceId && explicitVoiceId.trim().length > 0) {
    return explicitVoiceId.trim();
  }

  // ✅ SLEEP STORY: immer feste Erzählerstimme (male), Style/Gender ignorieren
  if (preset === "sleep-story") {
    return VOICE_SLEEP_STORY;
  }

  // ✅ CLASSIC ASMR: abhängig von Style + Gender
  if (preset === "classic-asmr") {
    if (voiceGender === "male") {
      return voiceStyle === "whisper"
        ? VOICE_ASMR_WHISPER_MALE
        : VOICE_ASMR_SOFT_MALE;
    }
    return voiceStyle === "whisper"
      ? VOICE_ASMR_WHISPER_FEMALE
      : VOICE_ASMR_SOFT_FEMALE;
  }

  // ✅ MEDITATION & Fallback
  if (preset === "meditation") {
    return VOICE_MEDITATION;
  }

  // ✅ KIDS STORY: gendered voices (Lumen V2 / Atlas V5) with layered fallbacks.
  if (preset === "kids-story") {
    const femaleVoice = process.env.ELEVENLABS_VOICE_KIDS_STORY_FEMALE_ID?.trim();
    const maleVoice = process.env.ELEVENLABS_VOICE_KIDS_STORY_MALE_ID?.trim();
    const wantMale = voiceGender === "male";

    const primary = wantMale ? maleVoice : femaleVoice;
    if (primary) return primary;

    const alt = wantMale ? femaleVoice : maleVoice;
    if (alt) {
      const missingVar = wantMale
        ? "ELEVENLABS_VOICE_KIDS_STORY_MALE_ID"
        : "ELEVENLABS_VOICE_KIDS_STORY_FEMALE_ID";
      warnKidsStoryOnce(
        `cross:${missingVar}`,
        `[TTS] ${missingVar} is not set – falling back to the other kids-story voice.`
      );
      return alt;
    }

    warnKidsStoryOnce(
      "default",
      "[TTS] Neither ELEVENLABS_VOICE_KIDS_STORY_FEMALE_ID nor ELEVENLABS_VOICE_KIDS_STORY_MALE_ID is set – falling back to DEFAULT_VOICE for kids-story."
    );
    return DEFAULT_VOICE;
  }

  // ✅ NARRATIVE: gendered voices with layered fallbacks. Mirrors the
  // kids-story dispatch — explicit env-var → cross-gender narrative fallback →
  // kids-story voice for the same gender → cross-gender kids-story fallback →
  // DEFAULT_VOICE. No narrative-specific ElevenLabs voice exists yet, so it
  // borrows the already-configured kids-story UIDs instead of an invalid
  // built-in name.
  if (preset === "narrative") {
    const femaleVoice = process.env.ELEVENLABS_VOICE_NARRATIVE_FEMALE_ID?.trim();
    const maleVoice = process.env.ELEVENLABS_VOICE_NARRATIVE_MALE_ID?.trim();
    const kidsFemaleVoice = process.env.ELEVENLABS_VOICE_KIDS_STORY_FEMALE_ID?.trim();
    const kidsMaleVoice = process.env.ELEVENLABS_VOICE_KIDS_STORY_MALE_ID?.trim();
    const wantMale = voiceGender === "male";

    const primary = wantMale ? maleVoice : femaleVoice;
    if (primary) return primary;

    const narrativeAlt = wantMale ? femaleVoice : maleVoice;
    if (narrativeAlt) {
      const missingVar = wantMale
        ? "ELEVENLABS_VOICE_NARRATIVE_MALE_ID"
        : "ELEVENLABS_VOICE_NARRATIVE_FEMALE_ID";
      warnNarrativeOnce(
        `cross:${missingVar}`,
        `[TTS] ${missingVar} is not set – falling back to the other narrative voice.`
      );
      return narrativeAlt;
    }

    const kidsPrimary = wantMale ? kidsMaleVoice : kidsFemaleVoice;
    if (kidsPrimary) {
      warnNarrativeOnce(
        `kids-primary:${wantMale ? "male" : "female"}`,
        "[TTS] Neither ELEVENLABS_VOICE_NARRATIVE_FEMALE_ID nor ELEVENLABS_VOICE_NARRATIVE_MALE_ID is set – falling back to the kids-story voice for this gender."
      );
      return kidsPrimary;
    }

    const kidsAlt = wantMale ? kidsFemaleVoice : kidsMaleVoice;
    if (kidsAlt) {
      warnNarrativeOnce(
        `kids-alt:${wantMale ? "male" : "female"}`,
        "[TTS] Narrative and matching kids-story voice envs are not set – falling back to the other kids-story voice."
      );
      return kidsAlt;
    }

    warnNarrativeOnce(
      "default",
      "[TTS] Neither narrative nor kids-story voice envs are set – falling back to DEFAULT_VOICE for narrative."
    );
    return DEFAULT_VOICE;
  }

  return DEFAULT_VOICE;
}

// Test-only helper. Lets the smoke test reset warn-once flags between cases.
export function __resetKidsStoryWarnedForTests() {
  kidsStoryWarned.clear();
}

// Test-only helper. Lets the smoke test reset narrative warn-once flags between cases.
export function __resetNarrativeWarnedForTests() {
  narrativeWarned.clear();
}
/**
 * 🔹 NEU (optional): sehr kurzer “Whisper-Cue” Prefix.
 * Wird NICHT gesprochen wie ein Prompt, sondern soll dem Modell einen Stil geben.
 * Funktioniert nicht perfekt bei jeder Voice, hilft aber oft spürbar.
 */
export function whisperPrefixForPreset(preset?: string | null): string {
  if (preset !== "classic-asmr") return "";
  // kurz halten, damit es nicht “vorgelesen” klingt
  return "Whisper softly, very close, calm and gentle. ";
}

// RP-011C.2: raised the fallback from 120000 to 180000. Three reproducible
// timeouts were observed on a single 3267-char classic-asmr request at the
// old 120s default. No lower route/runtime timeout is configured in this
// repo (no maxDuration export, no vercel.json) that would make this
// ineffective. Only bounds the ElevenLabs fetch itself.
const TTS_TIMEOUT_FALLBACK_MS = 180000;

export function getTtsTimeoutMs(): number {
  const fromEnv = parseInt(process.env.TTS_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : TTS_TIMEOUT_FALLBACK_MS;
}

export class ElevenLabsAdapter implements TTSAdapter {
  async speak(input: TTSSpeakInput): Promise<TTSSpeakResult> {
    if (!API_KEY) {
      throw new Error("ELEVENLABS_API_KEY fehlt");
    }

    const voiceId = input.voiceId ?? DEFAULT_VOICE;
    const modelId = input.modelId ?? DEFAULT_MODEL;
    const normalizedStability = normalizeStabilityForModel(modelId, input.stability);

    const finalText = prepareTtsText({
  text: input.text,
  preset: input.preset ?? null,   // 👈 dafür gleich TTSSpeakInput erweitern
  modelId,
});
    const body: Record<string, unknown> = {
      text: finalText,
      model_id: modelId,
      voice_settings: {
        stability: normalizedStability,
        similarity_boost: input.similarityBoost ?? 0.8,
        style: input.style ?? 0,
        use_speaker_boost: input.useSpeakerBoost ?? true,
      },
    };
    // Voice continuity stitching: anchor this chapter to the prior chapter's voice state.
    // The API harmlessly ignores unknown parameters, so always send when available.
    if (input.previousRequestIds?.length) {
      body.previous_request_ids = input.previousRequestIds;
    }
console.log("[tts] modelId=", modelId, "voiceId=", voiceId, "len=", finalText.length);
console.log("[tts] stability(normalized) =", normalizedStability);

    const ttsTimeoutMs = getTtsTimeoutMs();

    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(ttsTimeoutMs),
      }
    );

    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(
        `ElevenLabs TTS failed: ${res.status} ${res.statusText} ${msg}`
      );
    }

    const buf = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "audio/mpeg";
    // ElevenLabs returns the request ID in the header — used for voice stitching on the next call.
    const requestId = res.headers.get("x-request-id") ?? res.headers.get("request-id") ?? undefined;

    return { audio: buf, contentType, requestId };
  }
}

export const elevenlabs = new ElevenLabsAdapter();

// RP-011C.2 — Post-Prosody TTS Payload Guard.
//
// Wraps elevenlabs.speak() with a final length check on input.text — the
// text as it will actually be sent, i.e. AFTER splitToChunksSafe() and
// AFTER preset/voice prosody transformations (applyV3Prosody and any other
// per-chunk text processing) have already run in the caller. Those
// transformations can grow a chunk past its pre-prosody size (see
// lib/audio/chunks.ts for the reproduced production incident).
//
// - Within getPostProsodyMaxChars(): behaves exactly like elevenlabs.speak().
// - Over the limit: splits the text further (reusing splitToChunksSafe via
//   ensureTtsPayloadWithinLimit — no separate splitting logic), issues one
//   ElevenLabs request per piece in original order, and concatenates the
//   resulting MP3 buffers into a single result. Callers that only consume
//   `audio` (every current call site) see no shape difference.
//
// No text is lost or duplicated: ensureTtsPayloadWithinLimit splits the same
// string it is given, in place, with the same guarantees as the pre-prosody
// chunker.
export async function speakWithPayloadGuard(
  input: TTSSpeakInput
): Promise<TTSSpeakResult> {
  const pieces = ensureTtsPayloadWithinLimit(input.text);
  if (pieces.length <= 1) {
    return elevenlabs.speak(input);
  }

  console.warn(
    "[tts-guard] post-prosody payload exceeded limit, splitting further:",
    "originalLen=", input.text.length,
    "pieces=", pieces.length,
    "maxLen=", getPostProsodyMaxChars()
  );

  const buffers: Buffer[] = [];
  let contentType = "audio/mpeg";
  let requestId: string | undefined;
  for (const piece of pieces) {
    const result = await elevenlabs.speak({ ...input, text: piece });
    buffers.push(Buffer.from(result.audio));
    contentType = result.contentType;
    requestId = result.requestId;
  }

  return { audio: Buffer.concat(buffers), contentType, requestId };
}