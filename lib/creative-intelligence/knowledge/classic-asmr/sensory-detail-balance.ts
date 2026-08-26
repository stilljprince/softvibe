// lib/creative-intelligence/knowledge/classic-asmr/sensory-detail-balance.ts

import type { KnowledgeModule } from "../types";

export const sensoryDetailBalance: KnowledgeModule = {
  id: "sensory_detail_balance",
  name: "Sensory Detail Balance",
  category: "scene-design",
  description: "Use meaningful sensory detail without decorative description.",

  appliesTo: { scope: "preset", presets: ["classic-asmr"] },
  stages: ["planning", "generation", "evaluation"],

  purpose: "Use meaningful sensory detail without decorative description.",
  knowledge: [
    "Sensory detail should be meaningful -- grounded in something the listener can actually perceive -- rather than decorative or purely descriptive.",
    "A small number of well-chosen sensory details serves calm better than an accumulation of description.",
    "Detail exists to support presence and noticing, not to build atmosphere for its own sake or showcase descriptive writing.",
  ],

  antiPatterns: [
    "Piling on decorative descriptive language that doesn't correspond to something the listener can perceive.",
    "Using sensory detail mainly to demonstrate vivid or ornate writing rather than to support calm noticing.",
  ],
  evaluationCriteria: [
    "Is sensory detail meaningful and perceivable rather than decorative or overwritten?",
  ],

  relatedModules: ["sensory_presence", "calming_repetition"],

  priority: "HIGH",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe ASMR Principle Library v1.0",
      section: "Sensory Detail Balance",
    },
  },
};
