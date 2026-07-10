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

// The KIND of closure the story is aiming at — distinct from `EndingTone`,
// which is the emotional color. `EndingApproach` is the shape of completion:
// what mechanism brings the story to rest. These are inspirations the writer
// leans into; they are not rigid templates and do not prescribe plot beats.
export type EndingApproach =
  | "resolved-mystery"
  | "emotional-closure"
  | "quiet-ending"
  | "bittersweet-ending"
  | "reflective-ending";

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
  // The single central question / tension the listener should feel the
  // story is fundamentally about. Anchors the final segment so the story
  // closes as a self-contained experience rather than as chapter one of a
  // larger novel. Secondary threads may remain open; this one should land.
  primaryStoryQuestion: string;
  endingTone: EndingTone;
  trajectoryShape: TrajectoryShape;
  // The kind of closure the story is aiming at — an inspiration the writer
  // leans into, not a rigid template.
  endingApproach: EndingApproach;
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
