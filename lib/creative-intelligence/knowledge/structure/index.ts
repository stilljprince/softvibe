// lib/creative-intelligence/knowledge/structure/index.ts
//
// Structural KnowledgeModules. Nothing here is auto-registered — see
// ../init.ts for explicit registration.

import type { KnowledgeModule } from "../types";
import { premiseFulfillment } from "./premise-fulfillment";

export const structureModules: KnowledgeModule[] = [premiseFulfillment];
