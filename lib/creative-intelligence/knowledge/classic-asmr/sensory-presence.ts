// lib/creative-intelligence/knowledge/classic-asmr/sensory-presence.ts

import type { KnowledgeModule } from "../types";

export const sensoryPresence: KnowledgeModule = {
  id: "sensory_presence",
  name: "Sensory Presence",
  category: "tone",
  description: "Attention comes from noticing sensory detail in the immediate moment, not from following a story.",

  // Presence-only (RP-011C.8.8.3J): this module's restrictions describe
  // wordless sensory-presence ASMR, where attention stays in the immediate
  // moment rather than following a story. classic-asmr + story explicitly
  // allows narrative structure, so this module must not apply there. The
  // voice-first / no-external-trigger identity that still applies to both
  // modes lives in ./voice-first-identity.ts instead.
  appliesTo: { scope: "preset", presets: ["classic-asmr"], asmrModes: ["presence"] },
  stages: ["planning", "generation", "evaluation"],

  purpose: "Attention comes from noticing sensory detail in the immediate moment, not from following a story.",
  knowledge: [
    "Attention in ASMR comes from sensory detail and immediate perception -- the voice, its rhythm, breath, closeness -- not from following where a story goes next.",
    "The listener's focus should stay anchored in what is happening right now, in this small moment, rather than being carried forward by plot or events.",
    "Sensory presence favors noticing over narrating: a detail is offered so the listener can notice it, not to advance an unfolding scene.",
  ],

  antiPatterns: [
    "Building a narrative arc, external adventure, or unfolding plot around the sensory moment instead of staying with it.",
    "Turning sensory noticing into a device that mainly exists to move a story forward.",
  ],
  evaluationCriteria: [
    "Does attention stay anchored in immediate sensory noticing rather than following a plot or unfolding narrative?",
  ],

  relatedModules: ["gentle_rhythm", "sensory_detail_balance", "voice_first_identity"],

  priority: "CRITICAL",

  metadata: {
    version: "1.1.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe ASMR Principle Library v1.0",
      section: "Sensory Presence",
    },
  },
};
