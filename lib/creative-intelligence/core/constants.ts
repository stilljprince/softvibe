// lib/creative-intelligence/core/constants.ts
//
// Shared literal values for the Creative Intelligence foundation. These
// mirror the preset vocabulary already used across the active generation
// pipeline (see lib/script-builder.ts / lib/story-supervisor.ts) but are
// redeclared here so this module has no import dependency on pipeline code.

export const CREATIVE_PRESETS = [
  "classic-asmr",
  "sleep-story",
  "meditation",
  "kids-story",
  "narrative",
] as const;

export type CreativePreset = (typeof CREATIVE_PRESETS)[number];

export const CREATIVE_AUDIENCES = ["adult", "teen", "child", "general"] as const;

export type CreativeAudience = (typeof CREATIVE_AUDIENCES)[number];

// Known principle categories for the knowledge layer foundation. This list
// is expected to grow as real knowledge modules are added; it is not meant
// to be exhaustive today.
export const PRINCIPLE_CATEGORIES = [
  "writing-quality",
  "originality",
  "coherence",
  "pacing",
  "structure",
  "safety",
  "tone",
  "scene-design",
  "character",
] as const;

export type PrincipleCategory = (typeof PRINCIPLE_CATEGORIES)[number];

export const KNOWLEDGE_SCOPES = ["global", "preset"] as const;

export type KnowledgeScope = (typeof KNOWLEDGE_SCOPES)[number];

// Relative importance of a knowledge module when multiple applicable
// modules are returned from a query. Ordered highest to lowest.
export const KNOWLEDGE_PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

export type KnowledgePriority = (typeof KNOWLEDGE_PRIORITIES)[number];

// Pipeline stage a module's guidance is relevant to. A module can apply to
// more than one stage.
export const USAGE_STAGES = ["planning", "generation", "editing", "evaluation"] as const;

export type UsageStage = (typeof USAGE_STAGES)[number];

// Lifecycle status of a knowledge module. Only "active" modules are
// returned by registry queries by default.
export const KNOWLEDGE_STATUSES = ["draft", "review", "active", "deprecated"] as const;

export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

// Rough shape/size of the creative experience, independent of preset. Used
// by the Creative Intent Extraction Layer (RP-011C.7.22) to describe what
// kind of arc the request implies (a single sensory moment vs. a full
// personal transformation), without describing scenes or prose.
export const STORY_SCALES = ["vignette", "gentle_journey", "arc", "transformation"] as const;

export type StoryScale = (typeof STORY_SCALES)[number];

// Secondary intent dimension for the "classic-asmr" preset only (see
// RP-011C.8.8.3H/I). ASMR requests split into a wordless sensory-presence
// mode and a story-driven mode; this is not a new preset, just a modifier
// on classic-asmr intent.
export const CLASSIC_ASMR_MODES = ["presence", "story"] as const;

export type ClassicAsmrMode = (typeof CLASSIC_ASMR_MODES)[number];

// Secondary intent dimension for the "meditation" preset only. Different
// meditation requests need different planning/guidance -- self-compassion
// is not morning presence is not a guided beach visualization -- so this
// distinguishes what kind of practice was actually asked for.
// "breath_presence" is the control/default: a plain breath-and-attention
// meditation with no more specific signal present, preserving the
// pre-existing generic arrival/anchor/deepen/return shape unchanged.
export const MEDITATION_EXPERIENCE_TYPES = [
  "breath_presence",
  "body_relaxation",
  "stress_release",
  "self_compassion",
  "morning_presence",
  "evening_wind_down",
  "sleep_oriented",
  "guided_imagery",
] as const;

export type MeditationExperienceType = (typeof MEDITATION_EXPERIENCE_TYPES)[number];

// Grammatical person the listener explicitly asked the experience to be
// written in. Preset-independent: any preset may honor first, second, or
// third person when the user asks for it -- no preset may suppress this
// unconditionally.
export const CREATIVE_PERSPECTIVES = ["first", "second", "third"] as const;

export type CreativePerspective = (typeof CREATIVE_PERSPECTIVES)[number];
