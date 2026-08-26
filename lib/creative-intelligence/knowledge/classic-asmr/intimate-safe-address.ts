// lib/creative-intelligence/knowledge/classic-asmr/intimate-safe-address.ts

import type { KnowledgeModule } from "../types";

export const intimateSafeAddress: KnowledgeModule = {
  id: "intimate_safe_address",
  name: "Intimate, Safe Address",
  category: "writing-quality",
  description: "Create personal closeness with the listener without being intrusive.",

  appliesTo: { scope: "preset", presets: ["classic-asmr"] },
  stages: ["generation", "evaluation"],

  purpose: "Create personal closeness with the listener without being intrusive.",
  knowledge: [
    "Address can be close and personal -- speaking directly to the listener -- while remaining gentle and unhurried rather than intense or intrusive.",
    "Closeness is created through warmth and attentiveness, not through urgency, suggestion, or pressure to respond a certain way.",
    "The listener should always feel free to simply receive the attention being offered, with no expectation placed on them.",
  ],

  antiPatterns: [
    "Language that feels intense, urgent, or intrusive rather than gentle and unhurried.",
    "Implying the listener owes a reaction, or addressing them in a way that pressures a particular response.",
  ],
  evaluationCriteria: [
    "Does the address feel personally close and warm without feeling intrusive or demanding a response?",
  ],

  relatedModules: ["sensory_presence", "no_forced_response"],

  priority: "HIGH",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe ASMR Principle Library v1.0",
      section: "Intimate, Safe Address",
    },
  },
};
