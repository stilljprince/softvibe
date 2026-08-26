// scripts/narrative-benchmark/cases/classic-asmr.ts
//
// RP-011C.8.8.3G — Benchmark cases for the classic-asmr preset: sensory,
// listener-directed content (not narrative, not meditation). Metadata only.
// No generation happens here.
//
// Corrected in RP-011C.8.8.3G's review pass: SoftVibe Classic ASMR is
// voice-first, not trigger-based. Earlier cases here tested traditional
// trigger-based ASMR (writing sounds, object care/handling) that SoftVibe
// does not generate -- no tapping, scratching, writing sounds, object
// manipulation, or other external sound events. Every case below is
// voice/whisper/presence-based instead (gentle whisper, personal attention,
// soft reassurance, slow spoken presence, calm companion style).

import type { BenchmarkCase } from "../runners/types";

export const classicAsmrCases: BenchmarkCase[] = [
  {
    id: "classic-asmr-gentle-whisper",
    category: "classic-asmr",
    prompt:
      "A gentle, whispered ASMR session that speaks directly and closely to the listener, using soft, steady rhythmic phrasing that feels personal and safe, without ever casting them as a character in a story.",
    preset: "classic-asmr",
    durationMinutes: 12,
    expectedQualities: [
      "direct, personal address to the listener",
      "close, intimate whispered quality carried through the prose",
      "gentle, steady rhythm across phrases",
      "purely sensory framing, not narrative",
    ],
  },
  {
    id: "classic-asmr-soft-reassurance",
    category: "classic-asmr",
    prompt:
      "A close, personal ASMR session built entirely on soft, reassuring spoken words to the listener — quiet affirmations and gentle reassurance offered slowly, with no fictional scenario and no expectation of a response.",
    preset: "classic-asmr",
    durationMinutes: 12,
    expectedQualities: [
      "reassurance carried entirely through spoken address, not description of sounds or objects",
      "precise, unhurried vocal pacing over decorative or flowery prose",
      "small spoken details noticed one at a time",
      "steady, unhurried pacing",
    ],
  },
  {
    id: "classic-asmr-slow-spoken-presence",
    category: "classic-asmr",
    prompt:
      "An ASMR session centered on slow, repetitive spoken presence — the same soft phrase or rhythm returned to again and again — where each repetition carries small natural variations in tone or pacing within a steady, predictable rhythm.",
    preset: "classic-asmr",
    durationMinutes: 14,
    expectedQualities: [
      "repetitive spoken rhythm as the core content",
      "small, natural variation in vocal tone or pacing rather than monotony",
      "predictable, steady rhythm sustained throughout",
      "attention stays on the voice and its rhythm, not a storyline or external sound",
    ],
  },
  {
    id: "classic-asmr-personal-attention",
    category: "classic-asmr",
    prompt:
      "A personal-attention ASMR session where the listener receives calm, safe, undivided attention and gentle care, with the focus entirely on their comfort and the sensations offered to them.",
    preset: "classic-asmr",
    durationMinutes: 14,
    expectedQualities: [
      "listener is the direct recipient of attention and care",
      "safe, comforting framing throughout",
      "focus remains on the listener's experience, not the speaker",
      "calm, unhurried, reassuring tone",
    ],
  },
  {
    id: "classic-asmr-calm-companion",
    category: "classic-asmr",
    prompt:
      "An extended ASMR session in a calm companion style, moving slowly through a series of closely noticed qualities of the speaker's own voice — its softness, breath, and closeness — staying purely sensory throughout without developing into a story or shifting into guided-meditation instructions.",
    preset: "classic-asmr",
    durationMinutes: 18,
    expectedQualities: [
      "sustained voice-based sensory immersion across the full length",
      "no narrative arc, plot, or characters introduced",
      "no meditation-style guided instructions (breath cues, present-moment prompts)",
      "varied vocal/spoken detail without narrative connective tissue or external sound triggers",
    ],
  },
];
