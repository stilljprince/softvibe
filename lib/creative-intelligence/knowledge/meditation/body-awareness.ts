// lib/creative-intelligence/knowledge/meditation/body-awareness.ts

import type { KnowledgeModule } from "../types";

export const bodyAwareness: KnowledgeModule = {
  id: "body_awareness",
  name: "Body Awareness",
  category: "structure",
  description: "Ground the listener through noticing sensation and progressive relaxation.",

  appliesTo: { scope: "preset", presets: ["meditation"] },
  stages: ["planning", "generation", "evaluation"],

  purpose: "Ground the listener through noticing sensation and progressive relaxation.",
  knowledge: [
    "Guidance can invite the listener to notice physical sensation as a way of grounding attention in the body.",
    "Progressive relaxation should move gently and gradually, giving each area of the body time to soften.",
    "Body awareness is used for grounding and release of tension, not for diagnosing, analyzing, or fixing the body.",
  ],

  antiPatterns: [
    "Rushing through body areas without giving the listener time to notice or release tension.",
    "Framing sensations as problems to fix or as medical/diagnostic observations.",
    // RP-011C.8.8.2G: benchmark review found body scans marking the move
    // to each new body area with a step phrase, turning the scan into a
    // checklist instead of a continuous drift of attention through the
    // body.
    "Marking each new body area with a step phrase ('Now,' 'When you are ready,' 'You might begin') like a checklist, instead of a continuous drift of attention through the body.",
  ],
  evaluationCriteria: [
    "Does the body guidance move gently and gradually, inviting grounding rather than analysis?",
  ],

  relatedModules: ["breath_awareness", "guided_presence"],

  priority: "HIGH",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe Meditation Principle Library v1.0",
      section: "Body Awareness",
    },
  },
};
