// lib/creative-intelligence/knowledge/principles/index.ts
//
// Global writing-principle KnowledgeModules. Nothing here is
// auto-registered — see ../init.ts for explicit registration.

import type { KnowledgeModule } from "../types";
import { storyIsChange } from "./story-is-change";
import { trustTheReader } from "./trust-the-reader";
import { avoidAiWritingPatterns } from "./avoid-ai-writing-patterns";

export const principleModules: KnowledgeModule[] = [
  storyIsChange,
  trustTheReader,
  avoidAiWritingPatterns,
];
