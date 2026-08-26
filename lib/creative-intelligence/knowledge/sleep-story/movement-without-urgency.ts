// lib/creative-intelligence/knowledge/sleep-story/movement-without-urgency.ts

import type { KnowledgeModule } from "../types";

export const movementWithoutUrgency: KnowledgeModule = {
  id: "movement_without_urgency",
  name: "Movement Without Urgency",
  category: "pacing",
  description:
    "Sleep Story borrows Narrative's tools (setting, character, sequence) but not its stakes -- movement never comes from pressure, danger, or unresolved tension.",

  appliesTo: { scope: "preset", presets: ["sleep-story"] },
  stages: ["planning", "generation", "evaluation"],

  purpose:
    "Sleep Story borrows Narrative's tools (setting, character, sequence) but not its stakes -- movement never comes from pressure, danger, or unresolved tension.",
  knowledge: [
    "Characters travel and act, but nothing pushes them via pressure or a deadline -- a character wanders toward a lit window because it looked warm, not because they are being chased.",
    "The pull to keep listening should come from gentle wonder ('I wonder what's over the hill'), never from unresolved threat ('will they get caught') -- curiosity and suspense both create forward pull, but only one is calming.",
    "Nothing in the story should be at stake that would be distressing if lost -- a missed appointment or a scolding is still an activating stake, even at a small scale.",
    "One event should lead gently to the next through cause, not complication -- it starts raining, so they go inside, so they light a fire, with no obstacle required to justify the sequence.",
  ],

  antiPatterns: [
    "Deadlines or 'must happen before X' pressure driving a character's actions.",
    "Chases, pursuit, or any scene structured around escaping something.",
    "Danger -- physical threat to any character, real or implied.",
    "Suspense escalation -- building unresolved tension across scenes.",
    "Unresolved tension left hanging to keep the listener engaged, including cliffhangers.",
  ],
  evaluationCriteria: [
    "Does every scene move forward through gentle cause and curiosity rather than pressure, danger, or unresolved tension?",
  ],

  relatedModules: ["comfort_baseline_and_belonging", "episodic_meandering_structure"],

  priority: "CRITICAL",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe Sleep Story Principle Library v1.0",
      section: "Narrative Movement",
    },
  },
};
