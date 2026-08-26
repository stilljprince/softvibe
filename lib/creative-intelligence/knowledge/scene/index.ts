// lib/creative-intelligence/knowledge/scene/index.ts
//
// Scene-design KnowledgeModules. Nothing here is auto-registered — see
// ../init.ts for explicit registration.

import type { KnowledgeModule } from "../types";
import { sceneHasPurpose } from "./scene-has-purpose";

export const sceneModules: KnowledgeModule[] = [sceneHasPurpose];
