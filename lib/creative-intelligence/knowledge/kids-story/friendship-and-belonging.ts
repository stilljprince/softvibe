// lib/creative-intelligence/knowledge/kids-story/friendship-and-belonging.ts

import type { KnowledgeModule } from "../types";

export const friendshipAndBelonging: KnowledgeModule = {
  id: "friendship_and_belonging",
  name: "Friendship & Belonging",
  category: "character",
  description: "Relationships are the emotional foundation.",

  appliesTo: { scope: "preset", presets: ["kids-story"] },
  stages: ["planning", "generation", "evaluation"],

  purpose: "Relationships are the emotional foundation.",
  knowledge: [
    "Friendship and belonging are the emotional core that small-stakes events are built on.",
    "A character's sense of safety and confidence grows through connection with others, not through solving problems alone.",
  ],

  antiPatterns: [
    "Resolving the story through solitary achievement while treating relationships as background.",
  ],
  evaluationCriteria: [
    "Does the resolution strengthen a relationship or a sense of belonging?",
  ],

  relatedModules: ["small_stakes_big_feelings", "warm_dialogue"],

  priority: "HIGH",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe Kids Story Principle Library v1.0",
      section: "Friendship & Belonging",
    },
  },
};
