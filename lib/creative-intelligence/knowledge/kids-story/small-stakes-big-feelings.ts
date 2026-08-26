// lib/creative-intelligence/knowledge/kids-story/small-stakes-big-feelings.ts

import type { KnowledgeModule } from "../types";

export const smallStakesBigFeelings: KnowledgeModule = {
  id: "small_stakes_big_feelings",
  name: "Small Stakes, Big Feelings",
  category: "structure",
  description: "Small events can carry meaningful emotions.",

  appliesTo: { scope: "preset", presets: ["kids-story"] },
  stages: ["planning", "generation", "evaluation"],

  purpose: "Small events can carry meaningful emotions.",
  knowledge: [
    "A small, everyday event — a lost toy, a first sleepover, a shy hello — can carry real emotional weight without escalating the stakes.",
    "Meaning comes from friendship, courage, discovery, and growth, not from danger or the size of the event.",
    "The resolution's emotional payoff should match the event's small scale rather than being inflated to seem more important.",
  ],

  antiPatterns: [
    "Adding danger, high stakes, or dramatic peril to make a small event feel 'important enough.'",
  ],
  evaluationCriteria: [
    "Does the story's emotional weight come from feeling rather than from the size or danger of the event?",
  ],

  relatedModules: ["gentle_wonder", "friendship_and_belonging"],

  priority: "HIGH",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe Kids Story Principle Library v1.0",
      section: "Small Stakes, Big Feelings",
    },
  },
};
