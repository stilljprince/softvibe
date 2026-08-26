// lib/creative-intelligence/knowledge/character/index.ts
//
// Character KnowledgeModules. Nothing here is auto-registered — see
// ../init.ts for explicit registration.

import type { KnowledgeModule } from "../types";
import { characterWantsNeeds } from "./character-wants-needs";

export const characterModules: KnowledgeModule[] = [characterWantsNeeds];
