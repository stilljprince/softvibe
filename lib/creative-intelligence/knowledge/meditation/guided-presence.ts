// lib/creative-intelligence/knowledge/meditation/guided-presence.ts

import type { KnowledgeModule } from "../types";

export const guidedPresence: KnowledgeModule = {
  id: "guided_presence",
  name: "Guided Presence",
  category: "tone",
  description: "Guide attention back to the present moment with gentle awareness.",

  appliesTo: { scope: "preset", presets: ["meditation"] },
  stages: ["planning", "generation", "evaluation"],

  purpose: "Guide attention back to the present moment with gentle awareness.",
  knowledge: [
    "Guidance should repeatedly return the listener's attention to the present moment rather than to a story or plot.",
    "Awareness should be offered gently, as a soft noticing, not as a task to complete or a state to achieve.",
    "Observation should be presented without judgment — whatever the listener notices is simply noted, not evaluated as good or bad.",
  ],

  antiPatterns: [
    "Turning present-moment guidance into a narrative with characters, events, or plot progression.",
    "Framing attention as a skill to master or a goal the listener might fail to reach.",
    // RP-011C.8.8.2G: benchmark review found present-moment guidance
    // announcing every shift in attention with a step marker, which reads
    // as being walked through a sequence rather than resting in a
    // continuous space.
    "Announcing every attention shift with a step marker ('Now,' 'For the next few moments,' 'When you are ready,' 'You might begin') instead of letting attention rest and move on its own.",
  ],
  evaluationCriteria: [
    "Does the guidance gently return attention to the present moment without judgment or narrative framing?",
  ],

  relatedModules: ["breath_awareness", "non_judgmental_language"],

  priority: "CRITICAL",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe Meditation Principle Library v1.0",
      section: "Guided Presence",
    },
  },
};
