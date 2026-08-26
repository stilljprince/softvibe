// lib/creative-intelligence/knowledge/sleep-story/sleep-transition-arc.ts

import type { KnowledgeModule } from "../types";

export const sleepTransitionArc: KnowledgeModule = {
  id: "sleep_transition_arc",
  name: "Sleep Transition Arc",
  category: "pacing",
  description:
    "The piece should structurally decelerate across its runtime -- pacing, novelty, and sensory detail all decay toward stillness, mirroring the listener's own descent toward sleep.",

  appliesTo: { scope: "preset", presets: ["sleep-story"] },
  stages: ["planning", "generation", "evaluation"],

  purpose:
    "The piece should structurally decelerate across its runtime -- pacing, novelty, and sensory detail all decay toward stillness, mirroring the listener's own descent toward sleep.",
  knowledge: [
    "Natural cycles running underneath the story -- seasons turning, dusk falling, a tide going out -- mirror the listener's own physiological descent and invite synchrony without instruction.",
    "Pacing, sentence length, and event density should all decrease as the piece continues -- this is a structural, measurable decay curve, not just a vibe.",
    "Recurring phrases, images, or small rituals create a lulling, expected rhythm that reduces the cognitive load of tracking what's new, mirroring a lullaby's structure inside prose.",
    "New information, characters, and settings should taper off in the second half -- novelty is inherently a little alerting because it must be processed, so the back half should ask less of the listener's attention than the front half, not more.",
    "Sensory description should shift from active senses (sight, sound) toward passive, bodily ones (warmth, weight, heaviness, drowsiness) as a scene or the piece winds down.",
  ],

  antiPatterns: [
    "Late novelty -- introducing new characters, settings, or information in the back half of the story.",
    "Increasing intensity as the piece continues, rather than decaying toward stillness.",
    "New major information appearing near the ending, asking for more attention just as it should be releasing.",
    "Active final scenes -- fast pacing, dense events, or alert sensory detail (sight, sound) used late in the piece instead of passive, bodily sensation.",
  ],
  evaluationCriteria: [
    "Do pacing, novelty, and sensory detail measurably decay across the runtime, with the final scenes quieter and slower than the opening ones?",
  ],

  relatedModules: ["peaceful_non_demanding_endings", "ambient_sensory_calm"],

  priority: "CRITICAL",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe Sleep Story Principle Library v1.0",
      section: "Sleep Transition",
    },
  },
};
