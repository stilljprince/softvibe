// lib/creative-intelligence/knowledge/registry.ts
//
// Registry for KnowledgeModules: registration (with validation), lookup,
// and applicability queries. Modules are registered explicitly — see
// ./init.ts — there is no filesystem auto-discovery.

import type {
  ClassicAsmrMode,
  CreativePreset,
  KnowledgePriority,
  KnowledgeStatus,
  PrincipleCategory,
  UsageStage,
} from "../core/constants";
import { KNOWLEDGE_PRIORITIES } from "../core/constants";
import type { KnowledgeModule } from "./types";
import { validateKnowledgeModule } from "./validation";

const PRIORITY_ORDER: Record<KnowledgePriority, number> = Object.fromEntries(
  KNOWLEDGE_PRIORITIES.map((priority, index) => [priority, index])
) as Record<KnowledgePriority, number>;

export type KnowledgeQuery = {
  preset: CreativePreset;
  stage: UsageStage;
  category?: PrincipleCategory | PrincipleCategory[];
  // Only meaningful when a module declares appliesTo.asmrModes (see
  // Applicability in ./types.ts) -- currently classic-asmr modules only.
  // Modules without an asmrModes filter are unaffected by this field.
  asmrMode?: ClassicAsmrMode;
  // Defaults to "active" — draft/review/deprecated modules are excluded
  // from applicability queries unless explicitly requested.
  status?: KnowledgeStatus;
};

export class CreativeKnowledgeRegistry {
  private readonly modules = new Map<string, KnowledgeModule>();

  register(module: KnowledgeModule): void {
    const result = validateKnowledgeModule(module);
    if (!result.valid) {
      const id = module && typeof module === "object" ? module.id ?? "<unknown>" : "<unknown>";
      throw new Error(`Invalid knowledge module "${id}": ${result.errors.join(", ")}`);
    }
    if (this.modules.has(module.id)) {
      throw new Error(`Knowledge module already registered: ${module.id}`);
    }
    this.modules.set(module.id, module);
  }

  get(id: string): KnowledgeModule | undefined {
    return this.modules.get(id);
  }

  getAll(): KnowledgeModule[] {
    return Array.from(this.modules.values());
  }

  // Active (by default) modules applicable to the given preset and usage
  // stage, optionally narrowed by category, ordered CRITICAL -> HIGH ->
  // MEDIUM -> LOW with id as a stable secondary sort key.
  queryApplicableModules(query: KnowledgeQuery): KnowledgeModule[] {
    const status = query.status ?? "active";
    const categories =
      query.category === undefined
        ? undefined
        : Array.isArray(query.category)
          ? query.category
          : [query.category];

    const matches = Array.from(this.modules.values()).filter((module) => {
      if (module.metadata.status !== status) return false;

      const appliesToPreset =
        module.appliesTo.scope === "global" || module.appliesTo.presets.includes(query.preset);
      if (!appliesToPreset) return false;

      if (module.appliesTo.scope === "preset" && module.appliesTo.asmrModes) {
        if (!query.asmrMode || !module.appliesTo.asmrModes.includes(query.asmrMode)) return false;
      }

      if (!module.stages.includes(query.stage)) return false;

      if (categories && !categories.includes(module.category)) return false;

      return true;
    });

    return matches.sort((a, b) => {
      const diff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });
  }
}

// Shared instance for modules to register against. Consumers that need
// isolation (e.g. tests) can instead construct their own
// CreativeKnowledgeRegistry.
export const creativeKnowledgeRegistry = new CreativeKnowledgeRegistry();
