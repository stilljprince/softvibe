// lib/creative-intelligence/knowledge/sleep-story/episodic-meandering-structure.ts

import type { KnowledgeModule } from "../types";

export const episodicMeanderingStructure: KnowledgeModule = {
  id: "episodic_meandering_structure",
  name: "Episodic Meandering Structure",
  category: "structure",
  description:
    "Scenes function as loosely connected vignettes rather than links in an escalating chain, with a sense of time passing but no escalation.",

  appliesTo: { scope: "preset", presets: ["sleep-story"] },
  stages: ["planning", "generation"],

  purpose:
    "Scenes function as loosely connected vignettes rather than links in an escalating chain, with a sense of time passing but no escalation.",
  knowledge: [
    "Scenes should function as loosely connected vignettes rather than links in an escalating chain -- each scene can be complete in itself, so a listener who falls asleep partway through hasn't missed a setup they need resolved.",
    "There should be a sense of time passing and things settling, without escalation -- progression can exist entirely without tension.",
    "Travel and description take up real airtime rather than being summarized to get to the next event, matching the actual pace of drifting attention near sleep.",
  ],

  antiPatterns: [
    "Rapid scene changes -- frequent cuts between settings that require re-orientation.",
    "Scenes written as sequential links in an escalating chain rather than standalone vignettes.",
    "Compressing or summarizing gentle progression to reach the next plot beat sooner.",
  ],
  evaluationCriteria: [
    "Could a listener fall asleep partway through any scene without having missed a setup that later scenes depend on resolving?",
  ],

  relatedModules: ["movement_without_urgency", "rest_worthy_setting"],

  priority: "MEDIUM",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe Sleep Story Principle Library v1.0",
      section: "Narrative Movement",
    },
  },
};
