// lib/creative-intelligence/knowledge/types.ts
//
// Structured knowledge foundation. This intentionally holds no actual
// creative knowledge content — it defines the shape that future knowledge
// modules (global and preset-specific) will be written against.
//
// Do not put narrative-bible-style prose or large prompt strings here or
// in any module that implements these types. Knowledge content belongs in
// small, structured records (short statements, not free text blocks).

import type {
  ClassicAsmrMode,
  CreativePreset,
  KnowledgePriority,
  KnowledgeStatus,
  PrincipleCategory,
  UsageStage,
} from "../core/constants";

// Where a module applies. Global modules apply regardless of preset (e.g.
// writing quality, coherence). Preset-scoped modules only apply to the
// listed presets (e.g. premise-fulfillment for narrative, calm-progression
// rules for sleep-story).
//
// asmrModes is an optional secondary filter, meaningful only when presets
// includes "classic-asmr" (see CLASSIC_ASMR_MODES in core/constants.ts and
// RP-011C.8.8.3J). When set, the module applies only to classic-asmr
// requests whose asmrMode is one of the listed modes -- e.g. a module that
// bans narrative structure for wordless sensory-presence ASMR but should
// not restrict explicit story-mode ASMR. This is intentionally scoped to
// classic-asmr, not a general per-preset style system -- do not add other
// per-preset filters here.
export type Applicability =
  | { scope: "global" }
  | { scope: "preset"; presets: CreativePreset[]; asmrModes?: ClassicAsmrMode[] };

// A single fine-grained rule, kept for consumers (see core/contracts.ts)
// that operate on individual statements rather than whole modules.
export type NarrativePrinciple = {
  id: string;
  category: PrincipleCategory;
  appliesTo: Applicability;
  // Lower number = higher priority. Ties are left to the consumer.
  priority: number;
  description: string;
};

// Where a piece of creative knowledge comes from. Traces a module back to
// the design document it was distilled from, so content stays reviewable
// against its source.
export type SourceReference = {
  document: string;
  section?: string;
};

export type KnowledgeModuleMetadata = {
  version: string;
  status: KnowledgeStatus;
  sourceReference: SourceReference;
};

// A named, registrable unit of creative knowledge. This is the unit the
// registry operates on — one module per coherent area of knowledge (e.g.
// "story is change", "scene has purpose").
export type KnowledgeModule = {
  // Identity
  id: string;
  name: string;
  category: PrincipleCategory;
  description: string;

  // Applicability
  appliesTo: Applicability;
  stages: UsageStage[];

  // Purpose / knowledge
  purpose: string;
  knowledge: string[];

  // Quality guidance
  examples?: string[];
  antiPatterns?: string[];
  evaluationCriteria?: string[];

  // Relationships
  relatedModules?: string[];
  conflictsWith?: string[];

  // Priority
  priority: KnowledgePriority;

  // Metadata
  metadata: KnowledgeModuleMetadata;
};
