// lib/creative-intelligence/knowledge/kids-story/gentle-wonder.ts

import type { KnowledgeModule } from "../types";

export const gentleWonder: KnowledgeModule = {
  id: "gentle_wonder",
  name: "Gentle Wonder",
  category: "tone",
  description: "Create everyday wonder instead of epic fantasy.",

  appliesTo: { scope: "preset", presets: ["kids-story"] },
  stages: ["planning", "generation", "evaluation"],

  purpose: "Create everyday wonder instead of epic fantasy.",
  knowledge: [
    "Wonder comes from small, everyday magical moments rather than epic-fantasy stakes or world-shaping forces.",
    "Discovery — noticing something new in a familiar place — carries more warmth than a grand revelation.",
    "Imagination is treated as play that colors how a child sees the world, not a power that changes the world's rules.",
  ],

  antiPatterns: [
    "Escalating a small discovery into epic-fantasy stakes such as saving the world, ancient prophecies, or powerful villains.",
  ],
  evaluationCriteria: [
    "Does the story's sense of wonder come from something small and everyday rather than an epic-scale event?",
  ],

  relatedModules: ["child_perspective", "small_stakes_big_feelings"],

  priority: "HIGH",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe Kids Story Principle Library v1.0",
      section: "Gentle Wonder",
    },
  },
};
