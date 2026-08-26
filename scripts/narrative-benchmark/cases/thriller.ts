// scripts/narrative-benchmark/cases/thriller.ts
//
// RP-011C.8.7.1 — Benchmark cases for "thriller" style narratives:
// tension-driven stories that must still resolve calmly, since SoftVibe
// output always needs to land somewhere soothing regardless of genre.
// Metadata only. No generation happens here.

import type { BenchmarkCase } from "../runners/types";

export const thrillerCases: BenchmarkCase[] = [
  {
    id: "thriller-01",
    category: "thriller",
    prompt:
      "A detective follows a string of odd clues through a fog-covered coastal town, only to find the mystery was never dangerous at all.",
    preset: "narrative",
    durationMinutes: 30,
    expectedQualities: [
      "tension that builds gradually without becoming alarming",
      "mystery framing without violence or horror",
      "atmospheric, fog/coastal imagery",
      "de-escalating resolution suitable for sleep",
    ],
  },
  {
    id: "thriller-02",
    category: "thriller",
    prompt:
      "A courier must deliver a mysterious package across a sleeping city before sunrise, sensing she's being followed the whole way.",
    preset: "narrative",
    durationMinutes: 20,
    expectedQualities: [
      "suspense conveyed through sound and pacing rather than danger",
      "steady, unhurried tension",
      "no explicit threat or violence",
      "calm, safe conclusion",
    ],
  },
];
