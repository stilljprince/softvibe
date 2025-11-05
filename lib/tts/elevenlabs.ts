// lib/tts/elevenlabs.ts
import type { TTSAdapter, TTSSpeakInput, TTSSpeakResult } from "./adapter";

const API_KEY = process.env.ELEVENLABS_API_KEY;
const DEFAULT_VOICE = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
const DEFAULT_MODEL = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";

if (!API_KEY) {
  // Absichtlich kein throw hier – wir behandeln das im speak() sauber
  console.warn("[TTS] ELEVENLABS_API_KEY ist nicht gesetzt – TTS wird fehlschlagen.");
}

export class ElevenLabsAdapter implements TTSAdapter {
  async speak(input: TTSSpeakInput): Promise<TTSSpeakResult> {
    if (!API_KEY) {
      throw new Error("ELEVENLABS_API_KEY fehlt");
    }

    const voiceId = input.voiceId ?? DEFAULT_VOICE;
    const modelId = input.modelId ?? DEFAULT_MODEL;

    const body = {
      text: input.text,
      model_id: modelId,
      voice_settings: {
        stability: input.stability ?? 0.4,
        similarity_boost: input.similarityBoost ?? 0.8,
        style: input.style ?? 0,
        use_speaker_boost: input.useSpeakerBoost ?? true,
      },
    };

    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(`ElevenLabs TTS failed: ${res.status} ${res.statusText} ${msg}`);
    }

    const buf = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "audio/mpeg";

    return { audio: buf, contentType };
  }
}

export const elevenlabs = new ElevenLabsAdapter();