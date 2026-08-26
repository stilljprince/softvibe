// scripts/narrative-benchmark/cases/transformation.ts
//
// RP-011C.8.7.1 — Benchmark cases for "transformation" style narratives:
// a character or situation gradually shifts into a calmer, resolved state.
// Metadata only. No generation happens here.

import type { BenchmarkCase } from "../runners/types";

export const transformationCases: BenchmarkCase[] = [
  {
    id: "transformation-01",
    category: "transformation",
    prompt:
      "A restless architect spends a quiet night walking an empty city, and by dawn feels at peace with a decision she's been avoiding.",
    preset: "narrative",
    durationMinutes: 25,
    expectedQualities: [
      "gradual emotional shift from restlessness to calm",
      "slow, unhurried pacing",
      "sensory, grounded imagery",
      "gentle, resolved ending",
    ],
  },
  {
    id: "transformation-02",
    category: "transformation",
    prompt:
      "An old lighthouse keeper who has grown weary of solitude comes to see his quiet life as a gift rather than a burden.",
    preset: "narrative",
    durationMinutes: 15,
    expectedQualities: [
      "reflective, introspective tone",
      "clear internal turning point",
      "soothing, non-jarring transitions",
      "ends in acceptance rather than resolution of plot",
    ],
  },
];
