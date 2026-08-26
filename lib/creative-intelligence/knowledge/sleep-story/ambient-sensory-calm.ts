// lib/creative-intelligence/knowledge/sleep-story/ambient-sensory-calm.ts

import type { KnowledgeModule } from "../types";

export const ambientSensoryCalm: KnowledgeModule = {
  id: "ambient_sensory_calm",
  name: "Ambient Sensory Calm",
  category: "tone",
  description:
    "Soft sensory worldbuilding immerses the listener in the story's world -- it is not a trigger channel the way ASMR's sensory/auditory detail is.",

  // Sleep Story's sensory detail serves immersion in the story world, not
  // the sensory/auditory trigger itself the way classic-asmr's sensory
  // modules describe (see classic-asmr/sensory-presence.ts and
  // sensory-detail-balance.ts). Kept deliberately separate: this module
  // does not use asmrModes and never applies to classic-asmr.
  appliesTo: { scope: "preset", presets: ["sleep-story"] },
  stages: ["generation", "evaluation"],

  purpose:
    "Soft sensory worldbuilding immerses the listener in the story's world -- it is not a trigger channel the way ASMR's sensory/auditory detail is.",
  knowledge: [
    "Sensory detail -- texture, temperature, light, distant sound -- should be used sparingly, one or two senses at a time; immersion needs grounding detail, not a catalog of stimuli.",
    "Visual imagery should favor dusk, lamplight, moonlight, mist, and candle-glow over bright or saturated color -- soft light is visually calming and low-arousal, while vivid, high-contrast imagery is stimulating even in audio form via association.",
    "Background ambient sound in the world should itself be soothing -- a stream, distant owls, a low wind -- not machinery, crowds, or alarms; it sets a scene's emotional register even when unstated.",
  ],

  antiPatterns: [
    "Sensory overload -- stacking multiple vivid senses at once in a single beat.",
    "Loud or jarring imagery -- alarms, crashes, shouting -- used as ambient texture.",
    "Bright, saturated, or high-contrast visual imagery in place of soft light and muted color.",
  ],
  evaluationCriteria: [
    "Does sensory detail stay sparing and soft -- one or two senses at a time, low-arousal light and sound -- rather than stacking vivid stimuli?",
  ],

  relatedModules: ["rest_worthy_setting", "sleep_transition_arc"],

  priority: "MEDIUM",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe Sleep Story Principle Library v1.0",
      section: "World & Atmosphere",
    },
  },
};
