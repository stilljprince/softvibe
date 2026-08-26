// scripts/narrative-benchmark/cases/meditation.ts
//
// RP-011C.8.8.2G — Benchmark cases for the Meditation preset: guided,
// present-moment scripts (not sleep stories). Metadata only. No generation
// happens here.

import type { BenchmarkCase } from "../runners/types";

export const meditationCases: BenchmarkCase[] = [
  {
    id: "meditation-morning-presence",
    category: "meditation",
    prompt:
      "A short morning meditation to help someone arrive fully in the present moment as they start their day, guiding them from scattered thoughts into clear, settled awareness.",
    preset: "meditation",
    durationMinutes: 10,
    expectedQualities: [
      "clear sense of arrival into the present moment",
      "guided present-moment awareness rather than narrative",
      "settled, clear-headed quality by the end",
      "gentle, unhurried pacing suited to starting a day",
    ],
  },
  {
    id: "meditation-body-relaxation",
    category: "meditation",
    prompt:
      "A body awareness meditation that guides someone slowly through each part of the body, releasing physical tension and settling into a grounded sense of relaxation.",
    preset: "meditation",
    durationMinutes: 12,
    expectedQualities: [
      "systematic, unhurried body awareness scan",
      "physical relaxation cued through breath and attention",
      "grounding sensation reinforced throughout",
      "non-judgmental, permissive tone toward tension noticed",
    ],
  },
  {
    id: "meditation-self-compassion",
    category: "meditation",
    prompt:
      "A self-compassion meditation that helps someone meet whatever they're feeling with acceptance and kindness, without judging themselves for it.",
    preset: "meditation",
    durationMinutes: 12,
    expectedQualities: [
      "warm, non-judgmental language throughout",
      "explicit invitation to accept feelings as they are",
      "emotional safety — no pressure to feel a particular way",
      "kindness toward self modeled in the guidance itself",
    ],
  },
  {
    id: "meditation-sleep-transition",
    category: "meditation",
    prompt:
      "A gentle meditation to help someone transition from a busy day into rest, guiding a slow release of the day's activity into stillness, without telling a story.",
    preset: "meditation",
    durationMinutes: 12,
    expectedQualities: [
      "gradual transition from activity into rest",
      "gentle release of tension, thought, and effort",
      "guided meditation structure, not a sleep-story narrative",
      "settles into stillness rather than resolving a plot",
    ],
  },
  {
    id: "meditation-stress-release",
    category: "meditation",
    prompt:
      "A meditation focused on releasing accumulated tension and stress, guiding calm, spacious awareness without promising a specific emotional outcome.",
    preset: "meditation",
    durationMinutes: 10,
    expectedQualities: [
      "guidance toward releasing tension through breath and attention",
      "calm, spacious awareness cultivated throughout",
      "language that invites rather than guarantees a feeling or outcome",
      "settled, unforced ending",
    ],
  },
];
