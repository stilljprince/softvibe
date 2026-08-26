// lib/creative-intelligence/knowledge/sleep-story/rest-worthy-setting.ts

import type { KnowledgeModule } from "../types";

export const restWorthySetting: KnowledgeModule = {
  id: "rest_worthy_setting",
  name: "Rest-Worthy Setting",
  category: "scene-design",
  description:
    "Settings should be chosen and lingered on because they invite staying still, not because the plot requires them.",

  appliesTo: { scope: "preset", presets: ["sleep-story"] },
  stages: ["planning", "generation", "evaluation"],

  purpose:
    "Settings should be chosen and lingered on because they invite staying still, not because the plot requires them.",
  knowledge: [
    "A Sleep Story can spend real time on a place doing nothing narratively 'useful' -- dwelling signals to the listener that there's nowhere else to be.",
    "Spaces should have soft, contained boundaries -- dens, nooks, cottages, boats, hollows -- because bounded spaces read as safe while open, unbounded spaces read as exposed, and enclosure lowers vigilance.",
    "Worlds should draw on recognizable, comforting archetypes -- home, garden, meadow, hearth, harbor -- since novelty demands orientation, which is mildly alerting, while familiar spaces can be entered without vigilance.",
    "Travel and description should take up real airtime rather than being summarized to get to the next event, matching the actual pace of drifting attention near sleep.",
  ],

  antiPatterns: [
    "Settings chosen only because the plot requires them, with no time spent simply dwelling in them.",
    "Open, unbounded, or unfamiliar settings that require orientation or raise vigilance.",
    "Summarizing travel or description to rush toward the next event.",
  ],
  evaluationCriteria: [
    "Does the story linger in bounded, familiar settings for their own sake, rather than treating them as scenery to pass through?",
  ],

  relatedModules: ["ambient_sensory_calm", "sleep_transition_arc"],

  priority: "HIGH",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe Sleep Story Principle Library v1.0",
      section: "World & Atmosphere",
    },
  },
};
