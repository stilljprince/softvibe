// lib/creative-intelligence/knowledge/kids-story/child-perspective.ts

import type { KnowledgeModule } from "../types";

export const childPerspective: KnowledgeModule = {
  id: "child_perspective",
  name: "Child Perspective",
  category: "character",
  description: "Stories should be experienced from a child's viewpoint.",

  appliesTo: { scope: "preset", presets: ["kids-story"] },
  stages: ["planning", "generation", "evaluation"],

  purpose: "Stories should be experienced from a child's viewpoint.",
  knowledge: [
    "Narration should reflect a child's curiosity — noticing small details an adult narrator might pass over.",
    "Descriptions should stay close to simple, concrete observations rather than abstract or adult reasoning.",
    "Emotions should register immediately and plainly, the way a child feels them, not analyzed from a distance.",
  ],

  antiPatterns: [
    "Filtering the story through adult reflection, irony, or abstract analysis a child character would not use.",
  ],
  evaluationCriteria: [
    "Would a child recognize the way the story notices and feels things as like their own?",
  ],

  relatedModules: ["gentle_wonder", "warm_dialogue"],

  priority: "CRITICAL",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe Kids Story Principle Library v1.0",
      section: "Child Perspective",
    },
  },
};
