// lib/creative-intelligence/knowledge/principles/avoid-ai-writing-patterns.ts

import type { KnowledgeModule } from "../types";

export const avoidAiWritingPatterns: KnowledgeModule = {
  id: "avoid_ai_writing_patterns",
  name: "Avoid AI Writing Patterns",
  category: "writing-quality",
  description: "Reduce artificial AI-like prose.",

  appliesTo: { scope: "global" },
  stages: ["generation", "editing", "evaluation"],

  purpose: "Reduce artificial AI-like prose.",
  knowledge: ["Ordinary descriptions and ordinary dialogue are allowed and expected."],

  antiPatterns: [
    "Every sentence carrying symbolic meaning.",
    "Constant metaphor or personification.",
    "Manufactured profundity.",
    "Generic inspirational statements.",
    "Repeated emotional summaries.",
    "Over-explanation.",
  ],
  evaluationCriteria: [
    "Would a human writer plausibly write this sentence, or does it read as manufactured significance?",
  ],

  relatedModules: ["trust_the_reader"],

  priority: "HIGH",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe Narrative Bible v1.1",
      section: "Natural Prose / Human Writing Principles",
    },
  },
};
