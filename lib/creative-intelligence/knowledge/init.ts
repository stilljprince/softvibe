// lib/creative-intelligence/knowledge/init.ts
//
// Explicit, reviewable activation of approved KnowledgeModules. No
// filesystem auto-discovery — modules are imported and registered by name
// so activation stays deterministic and diffable.

import { creativeKnowledgeRegistry, CreativeKnowledgeRegistry } from "./registry";
import { principleModules } from "./principles";
import { sceneModules } from "./scene";
import { characterModules } from "./character";
import { structureModules } from "./structure";
import { kidsStoryModules } from "./kids-story";
import { meditationModules } from "./meditation";
import { classicAsmrModules } from "./classic-asmr";
import { sleepStoryModules } from "./sleep-story";
import type { KnowledgeModule } from "./types";

// The approved, active set. Adding a module here is the only way it
// becomes active — nothing auto-registers.
export const ACTIVE_KNOWLEDGE_MODULES: KnowledgeModule[] = [
  ...principleModules,
  ...sceneModules,
  ...characterModules,
  ...structureModules,
  ...kidsStoryModules,
  ...meditationModules,
  ...classicAsmrModules,
  ...sleepStoryModules,
];

export function initializeCreativeKnowledge(
  registry: CreativeKnowledgeRegistry = creativeKnowledgeRegistry
): void {
  for (const knowledgeModule of ACTIVE_KNOWLEDGE_MODULES) {
    registry.register(knowledgeModule);
  }
}
