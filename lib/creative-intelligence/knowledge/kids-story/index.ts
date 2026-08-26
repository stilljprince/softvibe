// lib/creative-intelligence/knowledge/kids-story/index.ts
//
// Kids Story KnowledgeModules. Nothing here is auto-registered — see
// ../init.ts for explicit registration.

import type { KnowledgeModule } from "../types";
import { childPerspective } from "./child-perspective";
import { gentleWonder } from "./gentle-wonder";
import { smallStakesBigFeelings } from "./small-stakes-big-feelings";
import { friendshipAndBelonging } from "./friendship-and-belonging";
import { warmDialogue } from "./warm-dialogue";
import { emotionalSafety } from "./emotional-safety";

export const kidsStoryModules: KnowledgeModule[] = [
  childPerspective,
  gentleWonder,
  smallStakesBigFeelings,
  friendshipAndBelonging,
  warmDialogue,
  emotionalSafety,
];
