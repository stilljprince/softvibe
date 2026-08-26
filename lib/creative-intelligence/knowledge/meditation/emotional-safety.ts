// lib/creative-intelligence/knowledge/meditation/emotional-safety.ts

import type { KnowledgeModule } from "../types";

export const emotionalSafety: KnowledgeModule = {
  id: "meditation_emotional_safety",
  name: "Emotional Safety",
  category: "safety",
  description: "The listener should always feel safe within their own inner experience.",

  appliesTo: { scope: "preset", presets: ["meditation"] },
  stages: ["planning", "generation", "evaluation"],

  purpose: "The listener should always feel safe within their own inner experience.",
  knowledge: [
    "The listener's inner experience should always feel safe, supported, and within their control.",
    "Guidance should avoid instructions that could feel overwhelming, triggering, or emotionally intense.",
    "The listener should be free to disengage from any suggestion (a visualization, a body area, a breath pattern) without consequence.",
  ],

  antiPatterns: [
    "Instructions that could surface overwhelming emotion, trauma, or fear without support.",
    "Guidance that pressures the listener to stay with an uncomfortable sensation or feeling.",
  ],
  evaluationCriteria: [
    "Would the listener feel emotionally safe and in control throughout the practice?",
  ],

  relatedModules: ["non_judgmental_language", "gentle_visualization"],

  priority: "CRITICAL",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe Meditation Principle Library v1.0",
      section: "Emotional Safety",
    },
  },
};
