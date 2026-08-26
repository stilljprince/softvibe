// lib/creative-intelligence/knowledge/classic-asmr/gentle-rhythm.ts

import type { KnowledgeModule } from "../types";

export const gentleRhythm: KnowledgeModule = {
  id: "gentle_rhythm",
  name: "Gentle Rhythm",
  category: "pacing",
  description: "ASMR relies on slow pacing, repetition, and a predictable, unhurried flow.",

  // Presence-only (RP-011C.8.8.3J): "never rushes toward a payoff" describes
  // wordless sensory-presence ASMR. classic-asmr + story explicitly allows
  // narrative structure (and therefore narrative momentum), so this
  // restriction must not apply there.
  appliesTo: { scope: "preset", presets: ["classic-asmr"], asmrModes: ["presence"] },
  stages: ["planning", "generation", "evaluation"],

  purpose: "ASMR relies on slow pacing, repetition, and a predictable, unhurried flow.",
  knowledge: [
    "Pacing should stay slow and unhurried, giving each small moment room to settle before moving to the next.",
    "A predictable, gently repeating flow -- in sentence rhythm, in the pattern of attention -- is soothing rather than monotonous.",
    "Rhythm should never rush toward a payoff or climax -- there is no destination the pacing is building toward.",
  ],

  antiPatterns: [
    "Accelerating pace or building tension toward a climax or payoff.",
    "Varying rhythm abruptly in a way that startles or re-orients the listener's attention.",
  ],
  evaluationCriteria: [
    "Does the pacing stay slow, unhurried, and gently predictable rather than building toward a climax?",
  ],

  relatedModules: ["sensory_presence", "calming_repetition"],

  priority: "CRITICAL",

  metadata: {
    version: "1.1.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe ASMR Principle Library v1.0",
      section: "Gentle Rhythm",
    },
  },
};
