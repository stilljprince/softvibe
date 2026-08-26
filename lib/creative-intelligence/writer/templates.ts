// lib/creative-intelligence/writer/templates.ts
//
// Per-preset labels/emphasis for the Writer Layer's deterministic
// placeholder composition (writer.ts). Mirrors the pattern already used by
// planning/templates.ts, scenes/templates.ts, and guidance/templates.ts --
// structural labels only, never prose, dialogue, or story content.

import type { CreativePreset } from "../core/constants";
import type { CreativeIntent } from "../core/types";

export type WriterPresetTemplate = {
  // Short label for the kind of unit this preset writes -- a narrative
  // "scene" reads differently from a meditation "segment".
  unitLabel: string;
  // What this preset's writing should foreground once a real LLM-backed
  // writer exists -- a description of emphasis, not content. Mirrors the
  // preset differences called out in the RP-011C.7.26 brief.
  emphasis: string[];
  // Prompt section/field labels for prompts.ts's STORY DESIGN and THIS
  // <unit> sections. Defaults to the original "story"/"narrative"/
  // "characters" vocabulary for every preset except meditation and classic-
  // asmr. Calibrated in RP-011C.8.8.2F: meditation's own guidance/
  // avoidPatterns explicitly forbid "a story to follow" and "a character in
  // a story" (see guidance/templates.ts, knowledge/meditation/*), so
  // labeling meditation's own prompt sections "STORY DESIGN" / "Narrative
  // function" / "Characters involved: the listener" contradicted that
  // guidance inside the same prompt. Calibrated again in RP-011C.8.8.3F for
  // the same reason: classic-asmr's own knowledge/guidance explicitly forbid
  // treating the experience as a story or the listener as a story character
  // (knowledge/classic-asmr/sensory-presence.ts's "not from following where
  // a story goes next"; guidance/templates.ts's classic-asmr styleGuidance
  // "not narrative development ... or a healing arc"), so the same
  // STORY DESIGN / Narrative function / Characters involved labels
  // contradicted classic-asmr's guidance too. Every other preset keeps the
  // original labels unchanged.
  designSectionTitle: string;
  promiseLabel: string;
  functionLabel: string;
  // null omits the line entirely -- used for meditation and classic-asmr,
  // where the listener is a direct participant/recipient (per
  // characterGuidance / knowledge/classic-asmr/intimate-safe-address.ts),
  // not a "character" to list.
  charactersLabel: string | null;
};

export const WRITER_TEMPLATE_BY_PRESET: Record<CreativePreset, WriterPresetTemplate> = {
  narrative: {
    unitLabel: "scene",
    emphasis: ["plot progression", "dialogue", "character development"],
    designSectionTitle: "STORY DESIGN",
    promiseLabel: "Story promise",
    functionLabel: "Narrative function",
    charactersLabel: "Characters involved",
  },
  "kids-story": {
    unitLabel: "scene",
    emphasis: ["light adventure", "clarity for a child listener", "imagination"],
    designSectionTitle: "STORY DESIGN",
    promiseLabel: "Story promise",
    functionLabel: "Narrative function",
    charactersLabel: "Characters involved",
  },
  // Calibrated in RP-011C.8.10I (Writer Layer calibration): the prior
  // emphasis ("atmosphere", "calm sensory experience", "slow transitions")
  // predates the Sleep Story Knowledge Foundation/Planning/Scene/Guidance/
  // Evaluation calibrations (RP-011C.8.10C/E/F/G/H) and named nothing that
  // distinguishes Sleep Story from Meditation or classic-asmr at the system-
  // prompt level -- a Writer reading only "Preset emphasis: atmosphere, calm
  // sensory experience, slow transitions." could just as easily be writing
  // ASMR presence copy. The six phrases below are grounded one-to-one in
  // that existing calibration rather than inventing new identity: the
  // external-world/in-world-journey framing already stated in guidance/
  // templates.ts's sleep-story styleGuidance ("stay story-first ... an
  // external, in-world journey"), and the five sleep-story-scoped
  // evaluation criteria from evaluation/criteria.ts (RP-011C.8.10H) --
  // movement_without_urgency, sleep_transition_arc,
  // peaceful_non_demanding_endings, companions_as_warmth, and
  // sleep_atmosphere_and_safety. designSectionTitle/promiseLabel/
  // functionLabel/charactersLabel are unchanged -- Sleep Story, unlike
  // meditation/classic-asmr, genuinely is a story about a protagonist and
  // companions (PROTAGONIST_ROLE_BY_PRESET, SLEEP_STORY_SCENE_STEPS), so
  // "STORY DESIGN" / "Story promise" / "Narrative function" / "Characters
  // involved" already describe it correctly; only the emphasis line, which
  // never went through that calibration, needed it. (Locked in by
  // scripts/test-creative-intelligence-sleep-story-writer-calibration.ts.)
  "sleep-story": {
    unitLabel: "segment",
    emphasis: [
      "external, in-world journey",
      "gentle movement without urgency",
      "peaceful curiosity, not suspense",
      "companions as warmth, not conflict",
      "gradual transition toward sleep",
      "quiet, non-demanding endings",
    ],
    designSectionTitle: "STORY DESIGN",
    promiseLabel: "Story promise",
    functionLabel: "Narrative function",
    charactersLabel: "Characters involved",
  },
  meditation: {
    unitLabel: "segment",
    // "continuous presence" added in RP-011C.8.8.2G: benchmark review found
    // meditation output leaning on announced step markers between
    // instructions; this emphasis label reinforces guidance/templates.ts's
    // and the meditation knowledge modules' pacing calibration at the
    // system-prompt level.
    emphasis: ["guided language", "safety", "stillness", "continuous presence"],
    designSectionTitle: "PRACTICE DESIGN",
    promiseLabel: "Session intention",
    functionLabel: "Phase focus",
    charactersLabel: null,
  },
  // Calibrated in RP-011C.8.8.3F (Writer Layer validation): classic-asmr's
  // knowledge/guidance layers describe a sensory experience the listener
  // directly receives, never a story the listener follows or a character
  // within one (knowledge/classic-asmr/sensory-presence.ts,
  // intimate-safe-address.ts; guidance/templates.ts's classic-asmr entry).
  // designSectionTitle/promiseLabel/functionLabel/charactersLabel now match
  // that instead of the inherited "story"/"narrative"/"characters"
  // vocabulary, mirroring meditation's RP-011C.8.8.2F fix. emphasis expanded
  // from a single item to the four CRITICAL/HIGH knowledge pillars so the
  // system prompt itself states the sensory framing, not just the section
  // labels below it.
  "classic-asmr": {
    unitLabel: "segment",
    emphasis: ["sensory presence", "gentle rhythm", "personal closeness", "no forced response"],
    designSectionTitle: "SENSORY DESIGN",
    promiseLabel: "Sensory intention",
    functionLabel: "Segment focus",
    charactersLabel: null,
  },
};

// Classic ASMR + story mode (RP-011C.8.8.3O): the Writer Layer's system
// prompt is the one place the two asmrModes shared a template even though
// guidance/scenes/planning already branch on intent.asmrMode (guidance/
// templates.ts's CLASSIC_ASMR_STORY_GUIDANCE_TEMPLATE, scenes/templates.ts's
// CLASSIC_ASMR_STORY_SCENE_STEPS). Presence's emphasis line above --
// "sensory presence, gentle rhythm, personal closeness, no forced
// response" -- never mentions scenario, persona, or dialogue, so a Writer
// reading only the system prompt would see presence-only framing even
// though the user message's WRITING GUIDANCE explicitly allows persona and
// low-stakes dialogue in story mode (see guidance/templates.ts's
// CLASSIC_ASMR_STORY_GUIDANCE_TEMPLATE). This template keeps every label
// identical to presence's (SENSORY DESIGN / Sensory intention / Segment
// focus / no Characters involved line) -- classic-asmr story mode is ASMR
// delivery + story content, not Narrative preset with an ASMR voice, so it
// must never take on narrative's "STORY DESIGN" / "Story promise" /
// "Narrative function" / "Characters involved" vocabulary. Only emphasis
// changes, to name what story mode actually adds.
export const CLASSIC_ASMR_STORY_WRITER_TEMPLATE: WriterPresetTemplate = {
  unitLabel: "segment",
  emphasis: ["sensory presence carried through scenario and persona", "gentle narrative movement", "personal closeness", "no forced response"],
  designSectionTitle: "SENSORY DESIGN",
  promiseLabel: "Sensory intention",
  functionLabel: "Segment focus",
  charactersLabel: null,
};

// Single source of truth for template selection, used by both prompts.ts
// (system/user prompt) and writer.ts (deterministic placeholder text) so
// the two paths never disagree on which template applies.
export function resolveWriterTemplate(intent: CreativeIntent): WriterPresetTemplate {
  if (intent.preset === "classic-asmr" && intent.asmrMode === "story") {
    return CLASSIC_ASMR_STORY_WRITER_TEMPLATE;
  }
  return WRITER_TEMPLATE_BY_PRESET[intent.preset];
}
