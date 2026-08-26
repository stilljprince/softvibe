// lib/creative-intelligence/knowledge/sleep-story/comfort-baseline-and-belonging.ts

import type { KnowledgeModule } from "../types";

export const comfortBaselineAndBelonging: KnowledgeModule = {
  id: "comfort_baseline_and_belonging",
  name: "Comfort Baseline & Belonging",
  category: "safety",
  description:
    "Every scene should leave the emotional temperature the same or calmer than it found it, and any change should be a softening rather than a dramatic arc.",

  appliesTo: { scope: "preset", presets: ["sleep-story"] },
  stages: ["planning", "generation", "evaluation"],

  purpose:
    "Every scene should leave the emotional temperature the same or calmer than it found it, and any change should be a softening rather than a dramatic arc.",
  knowledge: [
    "Comfort is the emotional baseline against which every scene can be checked -- after any scene, the listener should be calmer, or at least no less calm, than at the start of it.",
    "Every interaction should reinforce that the protagonist -- and by extension the listener -- is cared for; relational safety is cumulative, with each small kindness compounding into a sense of belonging.",
    "The protagonist is welcomed into places and among characters -- belonging, not achievement, is Sleep Story's emotional currency.",
    "If change occurs at all, it is a softening -- worry resolving into peace -- rather than a dramatic arc; growth can be gentle without being an arc.",
    "The feelings cultivated are quiet satisfaction and gratitude, not excitement or triumph.",
    "The story does not need catharsis; gentle comfort can simply accumulate and stop, with no contract requiring a resolution that 'lands'.",
  ],

  antiPatterns: [
    "Emotional activation -- fear, grief, anger, humiliation, or loss introduced to create feeling.",
    "Forced catharsis, where a scene manufactures a release of emotion the story didn't need.",
    "Dramatic emotional resolution -- a payoff or 'earned' ending in the Narrative sense.",
    "Stated morals or lessons -- explicit 'and that's why...' framing that turns comfort into instruction.",
  ],
  evaluationCriteria: [
    "Does every scene leave the listener's emotional temperature the same or calmer than it found it, without requiring catharsis or a stated lesson?",
  ],

  relatedModules: ["movement_without_urgency", "peaceful_non_demanding_endings", "companions_as_warmth"],

  priority: "CRITICAL",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe Sleep Story Principle Library v1.0",
      section: "Emotional Architecture",
    },
  },
};
