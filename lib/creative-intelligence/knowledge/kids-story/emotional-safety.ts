// lib/creative-intelligence/knowledge/kids-story/emotional-safety.ts

import type { KnowledgeModule } from "../types";

export const emotionalSafety: KnowledgeModule = {
  id: "emotional_safety",
  name: "Emotional Safety",
  category: "safety",
  description: "Conflict is allowed but children should feel safe.",

  appliesTo: { scope: "preset", presets: ["kids-story"] },
  stages: ["planning", "generation", "evaluation"],

  purpose: "Conflict is allowed but children should feel safe.",
  knowledge: [
    "Conflict and small challenges are allowed, but the child listener should always feel emotionally safe.",
    "Tension should stay gentle — never violent, frightening, or existential — and should resolve with reassurance.",
    "The story should end on a calm, positive, sleepy note that leaves the child feeling secure.",
  ],

  antiPatterns: [
    "Introducing violence, horror, or existential themes to raise tension.",
    "Leaving a conflict unresolved or ambiguous at the story's end.",
  ],
  evaluationCriteria: [
    "Would a young child feel safe and reassured by the end of the story, even after a small challenge?",
  ],

  relatedModules: ["small_stakes_big_feelings", "child_perspective"],

  priority: "CRITICAL",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe Kids Story Principle Library v1.0",
      section: "Emotional Safety",
    },
  },
};
