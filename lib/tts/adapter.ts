// lib/tts/adapter.ts
export type TTSSpeakInput = {
  text: string;
  voiceId?: string;
  modelId?: string;
  preset?: string | null;
  stability?: number;          // 0..1
  similarityBoost?: number;    // 0..1
  style?: number;              // 0..100
  useSpeakerBoost?: boolean;
  /** Voice continuity stitching: pass the requestId(s) from the preceding chapter. */
  previousRequestIds?: string[];
};

export type TTSSpeakResult = {
  audio: Uint8Array;           // MP3-Bytes
  contentType: string;         // z.B. "audio/mpeg"
  /** X-Request-Id returned by ElevenLabs — used to stitch the next chapter call. */
  requestId?: string;
};

export interface TTSAdapter {
  speak(input: TTSSpeakInput): Promise<TTSSpeakResult>;
}