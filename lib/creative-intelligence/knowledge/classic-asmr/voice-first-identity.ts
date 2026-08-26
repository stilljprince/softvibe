// lib/creative-intelligence/knowledge/classic-asmr/voice-first-identity.ts

import type { KnowledgeModule } from "../types";

export const voiceFirstIdentity: KnowledgeModule = {
  id: "voice_first_identity",
  name: "Voice-First Identity",
  category: "tone",
  description: "ASMR sensory attention is anchored in the voice itself, not external sound or object triggers.",

  // Applies to classic-asmr regardless of asmrMode (RP-011C.8.8.3J): SoftVibe
  // ASMR is voice-first whether the moment is pure sensory presence or woven
  // into an explicitly requested story/roleplay -- unlike sensory_presence's
  // narrative-structure ban, this identity rule is not presence-only.
  appliesTo: { scope: "preset", presets: ["classic-asmr"] },
  stages: ["planning", "generation", "evaluation"],

  purpose: "ASMR sensory attention is anchored in the voice itself, not external sound or object triggers.",
  knowledge: [
    "Sensory attention is anchored in the voice itself -- its whisper, breath, rhythm, and closeness -- rather than in external sound or object-based triggers.",
    "This holds whether the moment is presented as pure sensory presence or woven into a story or roleplay -- the voice stays the source of the sensory experience.",
  ],

  antiPatterns: [
    "Framing sensory attention around external sound or object triggers (tapping, scratching, writing sounds, object handling) instead of the voice itself.",
    "Generating new external-trigger devices for a story or roleplay premise instead of keeping the voice as the sensory source.",
  ],
  evaluationCriteria: [
    "Does sensory attention stay voice-based (whisper, breath, rhythm, closeness) rather than relying on external sound or object triggers?",
  ],

  relatedModules: ["sensory_presence", "intimate_safe_address"],

  priority: "CRITICAL",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe ASMR Principle Library v1.0",
      section: "Sensory Presence",
    },
  },
};
