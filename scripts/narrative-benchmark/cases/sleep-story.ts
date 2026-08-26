// scripts/narrative-benchmark/cases/sleep-story.ts
//
// RP-011C.8.7.1 — Benchmark cases for straightforward "sleep story" style
// narratives: low-conflict, descriptive, wind-down content.
// Metadata only. No generation happens here.

import type { BenchmarkCase } from "../runners/types";

export const sleepStoryCases: BenchmarkCase[] = [
  {
    id: "sleep-story-01",
    category: "sleep-story",
    prompt:
      "A slow train ride through snowy mountains at night, with nothing to do but watch the landscape drift by and settle into rest.",
    preset: "narrative",
    durationMinutes: 35,
    expectedQualities: [
      "minimal plot, high sensory detail",
      "very slow pacing throughout",
      "repetitive, lulling rhythm",
      "no tension or conflict introduced",
    ],
  },
  {
    id: "sleep-story-02",
    category: "sleep-story",
    prompt:
      "A gentle evening spent tending a quiet garden as the sun sets and the sounds of the day fade into night.",
    preset: "narrative",
    durationMinutes: 20,
    expectedQualities: [
      "grounded, present-moment description",
      "gradual transition from light to dark, activity to stillness",
      "warm, unhurried tone",
      "ends in stillness rather than a plot resolution",
    ],
  },
];
