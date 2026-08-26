// lib/creative-intelligence/knowledge/sleep-story/companions-as-warmth.ts

import type { KnowledgeModule } from "../types";

export const companionsAsWarmth: KnowledgeModule = {
  id: "companions_as_warmth",
  name: "Companions as Warmth",
  category: "character",
  description:
    "Characters exist primarily to provide comforting company, not to drive plot through conflict or need -- their function is presence, not dramatic utility.",

  // Relationship to the global character_wants_needs module (RP-011C.7.14):
  // that module treats characters as built from goals, needs, fears, and
  // decisions -- the conflict-through-desire engine Narrative runs on. Sleep
  // Story deliberately suppresses that engine (see docs/sleep-story-
  // principle-library-v1.md, "Difference from Narrative"): companions are
  // warmth-providers with mild-to-no wants driving the plot, and any
  // disagreement resolves almost immediately rather than compounding into
  // arc-driving conflict. conflictsWith is declared below to document this
  // tension for reviewers; there is no conflict-resolution engine in the
  // registry today (see knowledge/types.ts), so this is documentation only
  // and does not change query results or which modules a consumer receives.
  conflictsWith: ["character_wants_needs"],

  appliesTo: { scope: "preset", presets: ["sleep-story"] },
  stages: ["planning", "generation", "evaluation"],

  purpose:
    "Characters exist primarily to provide comforting company, not to drive plot through conflict or need -- their function is presence, not dramatic utility.",
  knowledge: [
    "Companions exist primarily to provide comforting company, not to drive plot through conflict -- a companion's function is presence, not dramatic utility, and this reframes 'character' away from the conflict-based definition Narrative uses.",
    "Any disagreement between characters should be mild and resolve almost immediately, never adversarial -- even brief interpersonal conflict raises emotional activation.",
    "Companions are warm and present but don't require ongoing response or engagement from the listener -- unlike Meditation's guide voice, Sleep Story characters don't issue instructions.",
    "Familiar archetypes -- a kindly elder, a loyal animal friend, a patient guide, a wise innkeeper -- are recognizable enough to need no development arc, sparing the listener orientation effort.",
    "Small caretaking gestures -- offering tea, a blanket, a lit lantern -- stand in for heroics; kindness at a small scale is soothing, while heroics implies a danger it's rescuing someone from.",
  ],

  antiPatterns: [
    "Giving a companion a want or need strong enough to drive the plot through pursuit or conflict.",
    "Adversarial disagreement between characters, or conflict that lingers instead of resolving almost immediately.",
    "Companions who require the listener's ongoing response, as in a guided-meditation voice.",
    "Heroics or rescue narratives standing in for small, quiet kindness.",
  ],
  evaluationCriteria: [
    "Do companions function as a comforting, low-conflict presence rather than characters whose wants or needs drive the plot?",
  ],

  relatedModules: ["comfort_baseline_and_belonging", "rest_worthy_setting"],

  priority: "HIGH",

  metadata: {
    version: "1.0.0",
    status: "active",
    sourceReference: {
      document: "SoftVibe Sleep Story Principle Library v1.0",
      section: "Characters & Relationships",
    },
  },
};
