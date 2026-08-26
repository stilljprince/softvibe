// lib/creative-intelligence/knowledge/principles/story-is-change.ts

import type { KnowledgeModule } from "../types";

export const storyIsChange: KnowledgeModule = {
  id: "story_is_change",
  name: "Story Is Change",
  category: "structure",
  description: "Stories need meaningful change rather than only event sequences.",

  appliesTo: { scope: "global" },
  stages: ["planning", "generation", "evaluation"],

  purpose: "Stories need meaningful change rather than only event sequences.",
  knowledge: [
    "Change can be internal, external, relational, situational, or understanding-based.",
    "A sequence of events without a resulting change is not yet a story.",
  ],

  antiPatterns: [
    "Forcing a dramatic transformation into a story whose scale only calls for subtle change.",
  ],
  evaluationCriteria: [
    "Is there a discernible difference between the story's beginning state and its end state?",
  ],

  relatedModules: ["premise_fulfillment", "character_wants_needs"],

  priority: "CRITICAL",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe Narrative Principle Library v1.1",
      section: "Story Is Change",
    },
  },
};
