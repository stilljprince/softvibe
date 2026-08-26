// lib/creative-intelligence/knowledge/meditation/breath-awareness.ts

import type { KnowledgeModule } from "../types";

export const breathAwareness: KnowledgeModule = {
  id: "breath_awareness",
  name: "Breath Awareness",
  category: "pacing",
  description: "Use the breath as a gentle anchor, never a forced pattern.",

  appliesTo: { scope: "preset", presets: ["meditation"] },
  stages: ["planning", "generation", "evaluation"],

  purpose: "Use the breath as a gentle anchor, never a forced pattern.",
  knowledge: [
    "Breathing is offered as an anchor the listener can gently return to, not as the sole focus of the entire experience.",
    "Breathing guidance should stay gentle and natural — inviting attention to the breath as it already is.",
    "Any suggested breathing rhythm should be simple and optional, never a strict count or forced pattern the listener must follow.",
  ],

  antiPatterns: [
    "Prescribing rigid breath counts or forced breathing patterns (e.g. strict inhale/hold/exhale counts) as a requirement.",
    "Making the listener feel they are doing the breath 'wrong' if it does not match the guidance exactly.",
    // RP-011C.8.8.2G: pacing polish -- breath awareness is where each
    // instruction most often gets handed off to the next, so this is the
    // module most directly tied to the sequential-feeling pacing the
    // benchmark flagged (see pacing_quality's relatedKnowledgeModuleId).
    "Over-relying on step markers ('Now,' 'For the next few moments,' 'When you are ready,' 'You might begin') between instructions, producing a step-by-step feel.",
  ],
  evaluationCriteria: [
    "Is the breath used as a gentle, optional anchor rather than a forced or rigid pattern?",
  ],

  relatedModules: ["guided_presence", "body_awareness"],

  priority: "HIGH",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe Meditation Principle Library v1.0",
      section: "Breath Awareness",
    },
  },
};
