// lib/creative-intelligence/knowledge/meditation/index.ts
//
// Meditation KnowledgeModules. Nothing here is auto-registered — see
// ../init.ts for explicit registration.

import type { KnowledgeModule } from "../types";
import { guidedPresence } from "./guided-presence";
import { breathAwareness } from "./breath-awareness";
import { bodyAwareness } from "./body-awareness";
import { nonJudgmentalLanguage } from "./non-judgmental-language";
import { emotionalSafety } from "./emotional-safety";
import { gentleVisualization } from "./gentle-visualization";

export const meditationModules: KnowledgeModule[] = [
  guidedPresence,
  breathAwareness,
  bodyAwareness,
  nonJudgmentalLanguage,
  emotionalSafety,
  gentleVisualization,
];
