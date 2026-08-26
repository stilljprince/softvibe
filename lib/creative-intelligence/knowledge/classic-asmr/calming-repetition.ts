// lib/creative-intelligence/knowledge/classic-asmr/calming-repetition.ts

import type { KnowledgeModule } from "../types";

export const calmingRepetition: KnowledgeModule = {
  id: "calming_repetition",
  name: "Calming Repetition",
  category: "structure",
  description: "Allow repetition as a soothing tool rather than unnecessary redundancy.",

  appliesTo: { scope: "preset", presets: ["classic-asmr"] },
  stages: ["generation", "evaluation"],

  purpose: "Allow repetition as a soothing tool rather than unnecessary redundancy.",
  knowledge: [
    "Repetition -- of a phrase, a sound, a small action -- can be soothing precisely because it is repeated, not despite it.",
    "Repetition should feel intentional and rhythmic, not like the same idea being restated for lack of anything else to say.",
    "A repeated element should still leave room for small, gentle variation rather than mechanically restating identically each time.",
  ],

  antiPatterns: [
    "Repeating content because there is nothing new to say, rather than because repetition itself is soothing.",
    "Restating the same sensory beat identically with no gentle variation, so it reads as filler.",
  ],
  evaluationCriteria: [
    "Does repetition feel like an intentional soothing tool rather than redundant filler?",
  ],

  relatedModules: ["gentle_rhythm", "sensory_detail_balance"],

  priority: "MEDIUM",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe ASMR Principle Library v1.0",
      section: "Calming Repetition",
    },
  },
};
