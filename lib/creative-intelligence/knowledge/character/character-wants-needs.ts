// lib/creative-intelligence/knowledge/character/character-wants-needs.ts

import type { KnowledgeModule } from "../types";

export const characterWantsNeeds: KnowledgeModule = {
  id: "character_wants_needs",
  name: "Character Wants & Needs",
  category: "character",
  description: "Characters should have internal logic rather than be trait lists.",

  appliesTo: { scope: "global" },
  stages: ["planning", "generation", "evaluation"],

  purpose: "Characters should have internal logic rather than be trait lists.",
  knowledge: [
    "Characters are built from goals, needs, fears, contradictions, motivations, and decisions.",
  ],

  antiPatterns: ["Requiring every character to carry a dramatic arc."],
  evaluationCriteria: [
    "Do the character's decisions follow from a want or need rather than plot convenience?",
  ],

  relatedModules: ["story_is_change"],

  priority: "CRITICAL",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe Narrative Principle Library v1.1",
      section: "Character Through Choices / Desire Creates Movement",
    },
  },
};
