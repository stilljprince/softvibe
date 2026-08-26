// lib/creative-intelligence/knowledge/sleep-story/peaceful-non-demanding-endings.ts

import type { KnowledgeModule } from "../types";

export const peacefulNonDemandingEndings: KnowledgeModule = {
  id: "peaceful_non_demanding_endings",
  name: "Peaceful, Non-Demanding Endings",
  category: "structure",
  description:
    "Endings should close on a concrete, settled image or action -- quiet and complete, asking nothing further of the listener.",

  appliesTo: { scope: "preset", presets: ["sleep-story"] },
  stages: ["generation", "evaluation"],

  purpose:
    "Endings should close on a concrete, settled image or action -- quiet and complete, asking nothing further of the listener.",
  knowledge: [
    "The resolution should be soft, often closing on rest itself -- a character falling asleep, settling by the fire, closing their eyes -- giving the listener's own descent something to mirror.",
    "The ending should land on a concrete, settled image or action rather than leaving something open, unstated, or for the listener to mentally complete.",
    "End with a complete sentence and normal terminal punctuation (a period). Do not use a literal ellipsis (...) or an unfinished sentence as the closing device -- that reads as the story cutting off mid-thought, not as peaceful closure.",
    "Final beats should leave space and quiet rather than a punchy final line -- a strong ending beat is a wake-up cue, not a wind-down cue.",
    "The last paragraph can be shorter and quieter than any before it, with no punchline, twist, or summary following.",
  ],

  antiPatterns: [
    "Twists -- surprise reveals designed to re-spike attention right at the close.",
    "Punchlines or any strong final beat used as a closer.",
    "Morals -- explicit lessons drawn at the end, which belongs to Kids Story's register, not Sleep Story's.",
    "Final revelations or new information introduced in the closing beat.",
    "A literal ellipsis (...) or an unfinished sentence used as the closing device -- ambiguous trailing-off language reads as incomplete text, not quiet closure.",
  ],
  evaluationCriteria: [
    "Does the ending close on a concrete, settled image or action, with a complete final sentence and normal terminal punctuation -- no twist, punchline, moral, final revelation, literal ellipsis, or unfinished sentence?",
  ],

  relatedModules: ["sleep_transition_arc", "comfort_baseline_and_belonging"],

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
