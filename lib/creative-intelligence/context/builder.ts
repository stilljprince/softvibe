// lib/creative-intelligence/context/builder.ts
//
// Builds a CreativeContext from an already-extracted CreativeIntent plus
// the KnowledgeModules applicable to it, sourced from the
// CreativeKnowledgeRegistry (RP-011C.7.20). This is not a generator: it
// produces no prose, calls no provider, and is not wired into the active
// generation pipeline.
//
// The builder does not know how modules are stored or filtered — it only
// calls registry.queryApplicableModules() per usage stage and shapes the
// results. Applicability (global vs. preset-scoped) stays owned by the
// registry.

import { KNOWLEDGE_PRIORITIES, USAGE_STAGES } from "../core/constants";
import type { UsageStage } from "../core/constants";
import type { CreativeIntent } from "../core/types";
import type { RawCreativeInput } from "../core/contracts";
import { creativeKnowledgeRegistry, CreativeKnowledgeRegistry } from "../knowledge/registry";
import type { KnowledgeModule, NarrativePrinciple } from "../knowledge/types";
import type { CreativeContext, CreativeContextGuidance } from "./types";

const CONTEXT_BUILDER_VERSION = "1.0.0";

export type BuildCreativeContextParams = {
  rawInput: RawCreativeInput;
  intent: CreativeIntent;
  // Defaults to the shared registry; pass an isolated instance in tests.
  registry?: CreativeKnowledgeRegistry;
  // Overridable for deterministic tests; defaults to the current time.
  createdAt?: string;
};

function priorityRank(module: KnowledgeModule): number {
  return KNOWLEDGE_PRIORITIES.indexOf(module.priority);
}

function toNarrativePrinciple(module: KnowledgeModule): NarrativePrinciple {
  return {
    id: module.id,
    category: module.category,
    appliesTo: module.appliesTo,
    priority: priorityRank(module),
    description: module.description,
  };
}

export function buildCreativeContext(params: BuildCreativeContextParams): CreativeContext {
  const { rawInput, intent, registry = creativeKnowledgeRegistry, createdAt } = params;

  const modulesByStage = new Map<UsageStage, KnowledgeModule[]>();
  for (const stage of USAGE_STAGES) {
    modulesByStage.set(stage, registry.queryApplicableModules({ preset: intent.preset, stage }));
  }

  const dedupedModules = new Map<string, KnowledgeModule>();
  for (const modules of modulesByStage.values()) {
    for (const knowledgeModule of modules) {
      if (!dedupedModules.has(knowledgeModule.id)) dedupedModules.set(knowledgeModule.id, knowledgeModule);
    }
  }
  const modules = Array.from(dedupedModules.values()).sort(
    (a, b) => priorityRank(a) - priorityRank(b) || a.id.localeCompare(b.id)
  );

  const stages = USAGE_STAGES.filter((stage) => (modulesByStage.get(stage) ?? []).length > 0);

  const guidance: CreativeContextGuidance = {
    planning: (modulesByStage.get("planning") ?? []).flatMap((m) => m.knowledge),
    generation: (modulesByStage.get("generation") ?? []).flatMap((m) => m.knowledge),
    evaluation: (modulesByStage.get("evaluation") ?? []).flatMap((m) => m.knowledge),
  };

  const durationSeconds =
    intent.durationMinutes !== undefined ? Math.round(intent.durationMinutes * 60) : undefined;

  return {
    input: {
      prompt: rawInput.prompt,
      preset: intent.preset,
      ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    },
    intent,
    knowledge: {
      modules,
      principles: modules.map(toNarrativePrinciple),
      stages,
    },
    guidance,
    metadata: {
      createdAt: createdAt ?? new Date().toISOString(),
      version: CONTEXT_BUILDER_VERSION,
    },
  };
}
