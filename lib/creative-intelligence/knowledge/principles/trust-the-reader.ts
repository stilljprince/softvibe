// lib/creative-intelligence/knowledge/principles/trust-the-reader.ts

import type { KnowledgeModule } from "../types";

export const trustTheReader: KnowledgeModule = {
  id: "trust_the_reader",
  name: "Trust The Reader",
  category: "writing-quality",
  description: "Prevent over-explanation by letting meaning emerge implicitly.",

  appliesTo: { scope: "global" },
  stages: ["generation", "editing"],

  purpose: "Prevent over-explanation.",
  knowledge: ["Meaning should emerge through action, dialogue, context, and consequences."],

  antiPatterns: [
    "Explaining symbolism directly.",
    "Repeating an emotional conclusion the reader already inferred.",
    "Characters continuously explaining their own psychology.",
  ],
  evaluationCriteria: [
    "Could a stated meaning or emotion instead be shown through action or dialogue?",
  ],

  relatedModules: ["avoid_ai_writing_patterns"],

  priority: "HIGH",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe Narrative Principle Library v1.1 / Narrative Bible v1.1",
      section: "Trust The Reader",
    },
  },
};
