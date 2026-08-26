// lib/creative-intelligence/knowledge/structure/premise-fulfillment.ts

import type { KnowledgeModule } from "../types";

export const premiseFulfillment: KnowledgeModule = {
  id: "premise_fulfillment",
  name: "Premise Fulfillment",
  category: "structure",
  description: "Ensure the story fulfills the promise of the user premise.",

  appliesTo: { scope: "preset", presets: ["narrative"] },
  stages: ["planning", "evaluation"],

  purpose: "Ensure the story fulfills the promise of the user premise.",
  knowledge: [
    "Story scale must match premise scale.",
    "This does not require every story to have a huge transformation — the resolution's scale simply must match what the premise promised.",
  ],

  antiPatterns: [
    "A story about rebuilding an entire life reduced to filing paperwork or visiting an office.",
  ],
  evaluationCriteria: ["Does the resolution operate at the same scale the premise promised?"],

  relatedModules: ["story_is_change"],

  priority: "CRITICAL",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe Narrative Bible v1.1",
      section: "Premise Fulfillment / Story Architecture",
    },
  },
};
