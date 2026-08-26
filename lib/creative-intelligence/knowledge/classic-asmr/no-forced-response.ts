// lib/creative-intelligence/knowledge/classic-asmr/no-forced-response.ts

import type { KnowledgeModule } from "../types";

export const noForcedResponse: KnowledgeModule = {
  id: "no_forced_response",
  name: "No Forced Response",
  category: "safety",
  description: "Never claim guaranteed relaxation, tingles, or emotional effects.",

  appliesTo: { scope: "preset", presets: ["classic-asmr"] },
  stages: ["planning", "generation", "evaluation"],

  purpose: "Never claim guaranteed relaxation, tingles, or emotional effects.",
  knowledge: [
    "The experience should never claim or promise a guaranteed physical or emotional response, such as tingles, relaxation, or sleep.",
    "Whatever the listener does or doesn't feel is valid -- the content should not imply their response is wrong or insufficient.",
    "Sensory offerings are presented as an invitation, not a mechanism guaranteed to produce a specific effect.",
  ],

  antiPatterns: [
    "Stating or implying that the listener will definitely feel tingles, relaxation, or another specific response.",
    "Framing the absence of a physical response as a failure on the listener's part.",
  ],
  evaluationCriteria: [
    "Does the content avoid claiming or guaranteeing a specific physical or emotional response?",
  ],

  relatedModules: ["intimate_safe_address"],

  priority: "CRITICAL",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe ASMR Principle Library v1.0",
      section: "No Forced Response",
    },
  },
};
