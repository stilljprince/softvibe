// lib/creative-intelligence/knowledge/scene/scene-has-purpose.ts

import type { KnowledgeModule } from "../types";

export const sceneHasPurpose: KnowledgeModule = {
  id: "scene_has_purpose",
  name: "Scene Has Purpose",
  category: "scene-design",
  description: "Scenes should have a reason to exist.",

  appliesTo: { scope: "global" },
  stages: ["planning", "generation", "evaluation"],

  purpose: "Scenes should have a reason to exist.",
  knowledge: [
    "A scene may primarily advance plot, reveal character, change a relationship, provide information, create atmosphere, or provide recovery/transition.",
  ],

  antiPatterns: [
    "Requiring every scene to deliver a revelation, symbolism, or major emotional transformation.",
  ],
  evaluationCriteria: ["Can the scene's primary purpose be named in one sentence?"],

  relatedModules: ["story_is_change"],

  priority: "HIGH",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe Narrative Bible v1.1",
      section: "Scene Design",
    },
  },
};
