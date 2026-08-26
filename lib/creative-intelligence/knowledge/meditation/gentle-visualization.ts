// lib/creative-intelligence/knowledge/meditation/gentle-visualization.ts

import type { KnowledgeModule } from "../types";

export const gentleVisualization: KnowledgeModule = {
  id: "gentle_visualization",
  name: "Gentle Visualization",
  category: "scene-design",
  description: "Optional imagery should support calm, not build a complex fantasy world.",

  appliesTo: { scope: "preset", presets: ["meditation"] },
  stages: ["planning", "generation", "evaluation"],

  purpose: "Optional imagery should support calm, not build a complex fantasy world.",
  knowledge: [
    "Visualization is optional supportive imagery, not a required element of every meditation.",
    "Imagery should depict simple, supportive mental spaces — a calm shore, a quiet room — rather than elaborate or eventful settings.",
    "Visualization should stay still and spacious, avoiding plot, characters, or a fantasy narrative to follow.",
  ],

  antiPatterns: [
    "Building an elaborate fantasy world or narrative arc out of the visualization.",
    "Introducing characters, conflict, or events into the imagined space.",
  ],
  evaluationCriteria: [
    "Does any visualization stay simple, still, and supportive rather than becoming a narrative or complex fantasy?",
  ],

  relatedModules: ["guided_presence", "emotional_safety"],

  priority: "MEDIUM",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe Meditation Principle Library v1.0",
      section: "Gentle Visualization",
    },
  },
};
