// lib/creative-intelligence/knowledge/sleep-story/index.ts
//
// Sleep Story KnowledgeModules. Nothing here is auto-registered -- see
// ../init.ts for explicit registration.

import type { KnowledgeModule } from "../types";
import { movementWithoutUrgency } from "./movement-without-urgency";
import { comfortBaselineAndBelonging } from "./comfort-baseline-and-belonging";
import { sleepTransitionArc } from "./sleep-transition-arc";
import { peacefulNonDemandingEndings } from "./peaceful-non-demanding-endings";
import { restWorthySetting } from "./rest-worthy-setting";
import { companionsAsWarmth } from "./companions-as-warmth";
import { episodicMeanderingStructure } from "./episodic-meandering-structure";
import { ambientSensoryCalm } from "./ambient-sensory-calm";

export const sleepStoryModules: KnowledgeModule[] = [
  movementWithoutUrgency,
  comfortBaselineAndBelonging,
  sleepTransitionArc,
  peacefulNonDemandingEndings,
  restWorthySetting,
  companionsAsWarmth,
  episodicMeanderingStructure,
  ambientSensoryCalm,
];
