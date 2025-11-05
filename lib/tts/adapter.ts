// lib/tts/adapter.ts
export type TTSSpeakInput = {
  text: string;
  voiceId?: string;
  modelId?: string;
  stability?: number;         // 0..1
  similarityBoost?: number;   // 0..1
  style?: number;             // 0..100
  useSpeakerBoost?: boolean;
};

export type TTSSpeakResult = {
  audio: Uint8Array;          // MP3-Bytes
  contentType: string;        // z.B. "audio/mpeg"
};

export interface TTSAdapter {
  speak(input: TTSSpeakInput): Promise<TTSSpeakResult>;
}