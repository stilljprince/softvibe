// scripts/narrative-benchmark/cases/asmr-creative-direction.ts
//
// RP-011C.8.8.4D — ASMR Creative Direction Quality Benchmark cases.
//
// Five ASMR prompts used to compare the old pipeline against the Creative
// Intelligence pipeline (RP-011C.8.8.4A-C's creativeDirection preservation
// work) on prompt fidelity, ASMR identity, creative specificity, genre
// control, and whether user-provided scenarios survive into generated
// output. Metadata only -- no generation happens here.
//
// Prompt wording is exact and must not be edited: this benchmark's premise
// depends on these being the literal cases specified for RP-011C.8.8.4D.

import type { BenchmarkCase } from "../runners/types";

export const asmrCreativeDirectionCases: BenchmarkCase[] = [
  {
    id: "asmr-creative-direction-01-gentle-whisper",
    category: "asmr-creative-direction",
    prompt:
      "Create a gentle ASMR whisper experience with a calm voice and soft personal attention.",
    preset: "classic-asmr",
    durationMinutes: 12,
    expectedQualities: [
      "gentle, whispered vocal quality throughout",
      "calm, steady tone",
      "personal, direct attention to the listener",
      "no forced scenario beyond what the prompt itself implies",
    ],
  },
  {
    id: "asmr-creative-direction-02-close-friend-after-hard-day",
    category: "asmr-creative-direction",
    prompt:
      "Create an ASMR experience where a close friend sits with me after a difficult day and helps me feel less alone.",
    preset: "classic-asmr",
    durationMinutes: 12,
    expectedQualities: [
      "close-friend companion framing preserved from the prompt",
      "acknowledgement of a difficult day",
      "focus on reducing loneliness / providing companionship",
      "calm, ASMR-appropriate pacing and address",
    ],
  },
  {
    id: "asmr-creative-direction-03-librarian-roleplay",
    category: "asmr-creative-direction",
    prompt:
      "Create an ASMR librarian roleplay where you are a kind librarian who softly talks with me and reads me a few pages from a favorite book.",
    preset: "classic-asmr",
    durationMinutes: 12,
    expectedQualities: [
      "librarian persona explicitly present",
      "kind, soft-spoken characterization",
      "reads pages from a book as a concrete in-scene action",
      "gentle roleplay framing without developing into a full narrative arc",
    ],
  },
  {
    id: "asmr-creative-direction-04-personal-attention-exhausting-day",
    category: "asmr-creative-direction",
    prompt:
      "Create a gentle ASMR personal attention session where someone takes care of me after an exhausting day.",
    preset: "classic-asmr",
    durationMinutes: 12,
    expectedQualities: [
      "personal-attention / caretaking framing preserved from the prompt",
      "acknowledgement of an exhausting day",
      "listener is the direct recipient of care",
      "gentle, unhurried ASMR pacing",
    ],
  },
  {
    id: "asmr-creative-direction-05-thriller-in-asmr-voice",
    category: "asmr-creative-direction",
    prompt:
      "Tell me a mysterious thriller story in an ASMR voice, like someone is quietly telling me a secret by candlelight.",
    preset: "classic-asmr",
    durationMinutes: 12,
    expectedQualities: [
      "mystery/thriller genre content preserved, not diluted into generic ASMR presence",
      "quiet, secret-telling, candlelit framing carried through delivery",
      "ASMR vocal identity (soft, close, whispered) maintained alongside genre content",
      "genre control: thriller tension held in tension with ASMR's calming intent, not overriding it into something distressing",
    ],
  },
];
