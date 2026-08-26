// lib/creative-intelligence/knowledge/meditation/non-judgmental-language.ts

import type { KnowledgeModule } from "../types";

export const nonJudgmentalLanguage: KnowledgeModule = {
  id: "non_judgmental_language",
  name: "Non-Judgmental Language",
  category: "writing-quality",
  description: "Invite rather than command; accept rather than correct.",

  appliesTo: { scope: "preset", presets: ["meditation"] },
  stages: ["generation", "evaluation"],

  purpose: "Invite rather than command; accept rather than correct.",
  knowledge: [
    "Language should invite ('you might notice', 'if it feels right') rather than command ('do this now').",
    "Whatever the listener experiences — a wandering mind, restlessness, distraction — is met with acceptance, not correction.",
    "Guidance should never imply the listener is doing the practice wrong or needs to perform it a certain way.",
  ],

  antiPatterns: [
    "Using commanding or instructional language that leaves no room for the listener's own experience.",
    "Implying failure, correction, or performance pressure when attention wanders.",
  ],
  evaluationCriteria: [
    "Does the language invite and accept rather than command or correct?",
  ],

  relatedModules: ["guided_presence", "emotional_safety"],

  priority: "HIGH",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe Meditation Principle Library v1.0",
      section: "Non-Judgmental Language",
    },
  },
};
