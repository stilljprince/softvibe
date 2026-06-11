// lib/narrative/types.ts
//
// Pass-A infrastructure types for future outline → segment generation.
// Intentionally abstract: no chapter numbers, no fixed beats (midpoint,
// false lead, climax, etc.). Segments represent natural rhetorical
// boundaries, never fixed roles. Nothing here is wired into the active
// single-call narrative path; these types exist only so later passes can
// build on a shared shape.

export type TrajectoryShape =
  | "gradual-rise"
  | "rise-and-fall"
  | "spiral"
  | "drift"
  | "fracture-and-settle"
  | "open";

export type EndingTone =
  | "warm"
  | "bittersweet"
  | "ambiguous"
  | "quietly-tragic"
  | "settled"
  | "unresolved";

export type CharacterSketch = {
  name?: string;
  role?: string;
  summary: string;
};

export type RelationshipSketch = {
  between: [string, string];
  nature: string;
};

// High-level "story bible" produced by an outline pass. Carries enough
// shared truth (who, where, what is at stake, what shape it traces) to
// keep later segment calls coherent — without prescribing scene order or
// rhetorical role.
export type StoryBible = {
  title?: string;
  protagonistSummary: string;
  supportingCharacterSummary: CharacterSketch[];
  settingSummary: string;
  pressureSources: string[];
  importantRelationships: RelationshipSketch[];
  unresolvedQuestions: string[];
  endingTone: EndingTone;
  trajectoryShape: TrajectoryShape;
};

// Evolving state threaded across future segment generation calls. Each
// call reads the prior SegmentState and emits the next. Kept minimal and
// abstract — no fixed-role flags ("setup done", "climax reached").
export type SegmentState = {
  emotionalState: string;
  relationshipChanges: string[];
  unresolvedQuestions: string[];
  settingChanges: string[];
  elapsedTime: string;
};

// One generated segment in a multi-segment story. `summary` is a short
// recap for the next segment's context window; `stateAfter` is the
// post-segment SegmentState that becomes input to the next call. No role
// field — segments are not labelled "setup", "twist", "resolution", etc.
export type NarrativeSegment = {
  id: string;
  text: string;
  summary: string;
  stateAfter: SegmentState;
};
