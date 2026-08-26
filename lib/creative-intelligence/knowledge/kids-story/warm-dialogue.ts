// lib/creative-intelligence/knowledge/kids-story/warm-dialogue.ts

import type { KnowledgeModule } from "../types";

export const warmDialogue: KnowledgeModule = {
  id: "warm_dialogue",
  name: "Warm Dialogue",
  category: "writing-quality",
  description: "Simple, warm, character-driven dialogue.",

  appliesTo: { scope: "preset", presets: ["kids-story"] },
  stages: ["generation", "evaluation"],

  purpose: "Simple, warm, character-driven dialogue.",
  knowledge: [
    "Dialogue should be simple, warm, and grounded in what the character wants or feels in the moment.",
    "Word choice should stay within a young child's everyday vocabulary.",
  ],

  antiPatterns: [
    "Dialogue that explains a moral or lesson directly rather than letting warmth and character carry it.",
  ],
  evaluationCriteria: [
    "Does the dialogue sound like something a warm, caring character would actually say to a child?",
  ],

  relatedModules: ["child_perspective", "friendship_and_belonging"],

  priority: "MEDIUM",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe Kids Story Principle Library v1.0",
      section: "Warm Dialogue",
    },
  },
};
