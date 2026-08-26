// lib/creative-intelligence/knowledge/validation.ts
//
// Lightweight, deterministic validation for KnowledgeModule records before
// they enter the registry. Intentionally small — this is a shape check,
// not a schema library. No new dependency is needed for this.

import {
  CLASSIC_ASMR_MODES,
  KNOWLEDGE_PRIORITIES,
  KNOWLEDGE_STATUSES,
  PRINCIPLE_CATEGORIES,
  USAGE_STAGES,
} from "../core/constants";
import type { KnowledgeModule } from "./types";

export type KnowledgeModuleValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] };

export function validateKnowledgeModule(
  module: KnowledgeModule
): KnowledgeModuleValidationResult {
  const errors: string[] = [];

  if (!module || typeof module !== "object") {
    return { valid: false, errors: ["module is missing or not an object"] };
  }

  if (!module.id || typeof module.id !== "string") {
    errors.push("missing id");
  }
  if (!module.name || typeof module.name !== "string") {
    errors.push("missing name");
  }
  if (!module.category || !PRINCIPLE_CATEGORIES.includes(module.category)) {
    errors.push("missing or invalid category");
  }
  if (!module.description || typeof module.description !== "string") {
    errors.push("missing description");
  }

  if (!module.appliesTo) {
    errors.push("missing applicability");
  } else if (module.appliesTo.scope === "preset") {
    if (!module.appliesTo.presets || module.appliesTo.presets.length === 0) {
      errors.push("preset-scoped module must declare at least one preset");
    }
    if (module.appliesTo.asmrModes) {
      if (module.appliesTo.asmrModes.length === 0) {
        errors.push("appliesTo.asmrModes, if present, must declare at least one mode");
      } else if (module.appliesTo.asmrModes.some((mode) => !CLASSIC_ASMR_MODES.includes(mode))) {
        errors.push("invalid mode in appliesTo.asmrModes");
      }
      if (!module.appliesTo.presets?.includes("classic-asmr")) {
        errors.push("appliesTo.asmrModes is only valid for modules that include the classic-asmr preset");
      }
    }
  } else if (module.appliesTo.scope !== "global") {
    errors.push("invalid applicability scope");
  }

  if (!module.stages || module.stages.length === 0) {
    errors.push("missing usage stages");
  } else if (module.stages.some((stage) => !USAGE_STAGES.includes(stage))) {
    errors.push("invalid usage stage");
  }

  if (!module.purpose || typeof module.purpose !== "string") {
    errors.push("missing purpose");
  }
  if (!module.knowledge || module.knowledge.length === 0) {
    errors.push("missing knowledge/principles");
  }

  if (!module.priority || !KNOWLEDGE_PRIORITIES.includes(module.priority)) {
    errors.push("missing or invalid priority");
  }

  if (!module.metadata) {
    errors.push("missing metadata");
  } else {
    if (!module.metadata.version || typeof module.metadata.version !== "string") {
      errors.push("missing metadata.version");
    }
    if (!module.metadata.status || !KNOWLEDGE_STATUSES.includes(module.metadata.status)) {
      errors.push("missing or invalid metadata.status");
    }
    if (!module.metadata.sourceReference || !module.metadata.sourceReference.document) {
      errors.push("missing metadata.sourceReference.document");
    }
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}
