// lib/tts/elevenlabs.ts
import type { TTSAdapter, TTSSpeakInput, TTSSpeakResult } from "./adapter";

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

  return DEFAULT_VOICE;
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
    const body = {
      text: finalText,
      model_id: modelId,

voice_settings: {
  stability: normalizedStability,
  similarity_boost: input.similarityBoost ?? 0.8,
  style: input.style ?? 0,
  use_speaker_boost: input.useSpeakerBoost ?? true,
  speed: input.speed ?? 1.0,
},
    };
console.log("[tts] modelId=", modelId, "voiceId=", voiceId, "len=", finalText.length);
console.log("[tts] stability(normalized) =", normalizedStability);

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

    return { audio: buf, contentType };
  }
}

export const elevenlabs = new ElevenLabsAdapter();