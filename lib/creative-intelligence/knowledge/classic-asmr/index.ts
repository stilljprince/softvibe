// lib/creative-intelligence/knowledge/classic-asmr/index.ts
//
// Classic ASMR KnowledgeModules. Nothing here is auto-registered -- see
// ../init.ts for explicit registration.

import type { KnowledgeModule } from "../types";
import { sensoryPresence } from "./sensory-presence";
import { gentleRhythm } from "./gentle-rhythm";
import { intimateSafeAddress } from "./intimate-safe-address";
import { sensoryDetailBalance } from "./sensory-detail-balance";
import { calmingRepetition } from "./calming-repetition";
import { noForcedResponse } from "./no-forced-response";
import { voiceFirstIdentity } from "./voice-first-identity";

export const classicAsmrModules: KnowledgeModule[] = [
  sensoryPresence,
  gentleRhythm,
  intimateSafeAddress,
  sensoryDetailBalance,
  calmingRepetition,
  noForcedResponse,
  voiceFirstIdentity,
];
