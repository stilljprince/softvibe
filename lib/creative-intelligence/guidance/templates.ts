// lib/creative-intelligence/guidance/templates.ts
//
// Deterministic per-preset writing-guidance defaults consumed by
// builder.ts. These describe how a preset's scenes should generally be
// approached (dialogue, pacing, description, tone) -- never prose,
// dialogue, or scene-specific content. Mirrors the pattern already used by
// planning/templates.ts and scenes/templates.ts.

import type { CreativePreset } from "../core/constants";


export type PresetGuidanceTemplate = {
  dialogueGuidance: string;
  pacingGuidance: string;
  descriptionGuidance: string;
  styleGuidance: string;
  // Extra allowed-content labels specific to this preset, merged in
  // builder.ts with the scene's own requiredElements and knowledge-module
  // permissions -- explicit room for ordinary, unremarkable scenes.
  allowedElementsBase: string[];
  // Plot-driven presets get conflict/turning-point-aware writingFocus and
  // characterGuidance; non-plot presets (sleep-story, meditation,
  // classic-asmr) deliberately never receive plot/conflict-shaped guidance.
  plotDriven: boolean;
};

export const GUIDANCE_TEMPLATE_BY_PRESET: Record<CreativePreset, PresetGuidanceTemplate> = {
  narrative: {
    dialogueGuidance:
      "Prefer natural dialogue over internal exposition; let characters reveal intent through what they say and don't say.",
    pacingGuidance:
      "Sustain tension, uncertainty, and unresolved conflict through the scene; release it only at a turning point.",
    descriptionGuidance:
      "Ground description in what the protagonist would notice in the moment, not decorative or symbolic detail.",
    styleGuidance: "Show change through choices and behavior rather than stated realization.",
    allowedElementsBase: ["ordinary interactions that support realism", "natural, unresolved dialogue"],
    plotDriven: true,
  },
  // Strengthened in calibration RP-011C.8.8.1E: benchmark review found kids
  // stories leaning on narration and decorative description over character
  // interaction. These four fields now explicitly push toward dialogue and
  // shared moments as the primary carrier of discovery, understanding, and
  // reassurance, and away from description that doesn't serve the
  // character or an explained/narrated emotional summary.
  "kids-story": {
    dialogueGuidance:
      "Favor dialogue and back-and-forth exchange over narration for a young child listener -- let a friend's spoken reactions carry discovery, reassurance, and understanding; keep lines simple, warm, and short.",
    pacingGuidance:
      "Keep pacing calm and simple; let the scene linger in a shared moment of curiosity, dialogue, or discovery rather than advancing to the next event.",
    descriptionGuidance:
      "Use simple, concrete, age-safe description that serves what the character notices or feels; avoid long decorative description that doesn't involve the character.",
    styleGuidance:
      "Show the emotional learning through the characters' actions and dialogue with each other, not narrated explanation or a stated moral.",
    allowedElementsBase: [
      "ordinary, everyday moments",
      "gentle, age-appropriate humor",
      "playful misunderstandings between friends",
    ],
    plotDriven: true,
  },
  // Calibrated in RP-011C.8.10G: dialogueGuidance/pacingGuidance/
  // descriptionGuidance/styleGuidance are strengthened to state explicitly
  // what they exclude, matching the "rules out" pattern meditation/
  // classic-asmr's entries already use, so a Writer Layer cannot drift
  // toward meditation's breath/body instruction or classic-asmr's
  // whisper/tingle trigger framing -- Sleep Story stays story-first, an
  // external, in-world journey (docs/sleep-story-principle-library-v1.md),
  // not an inward relaxation practice. allowedElementsBase gains explicit
  // room for companions_as_warmth and rest_worthy_setting's identity
  // (warm, low-conflict companions; familiar, cozy environments).
  "sleep-story": {
    dialogueGuidance:
      "Dialogue is optional and secondary to sensory narration; when a companion speaks, keep it warm, simple, and brief -- small observations or comforting exchange, never exposition, problem-solving, or emotional dependency.",
    pacingGuidance:
      "Keep pacing slow and unhurried, gradually stilling and introducing fewer new elements as the scene continues; ease toward rest rather than escalating, building anticipation, or holding novelty back for later.",
    descriptionGuidance:
      "Ground description in cozy, familiar sensory detail the listener can settle into; keep atmosphere muted and safe, never overstimulating, dramatic, or danger-coded.",
    styleGuidance:
      "Let calm accumulate through the external world's steadiness and gentle repetition, not narrative event; stay story-first -- never meditation-style breath/body instruction or ASMR whisper-trigger framing.",
    allowedElementsBase: [
      "quiet, ordinary sensory detail",
      "gentle repetition",
      "companions present for warmth, not conflict",
      "familiar, cozy environments",
    ],
    plotDriven: false,
  },
  // Calibrated in RP-011C.8.8.2D: meditation guidance must read as
  // invitation over command and awareness over performance -- a Writer
  // Layer following this should never produce staged dialogue, a story to
  // follow, or a guaranteed outcome, and should treat every instruction as
  // something offered to the listener to explore, not a task to complete.
  //
  // pacingGuidance further calibrated in RP-011C.8.8.2G: benchmark review
  // found generated meditation text leaning on announced step markers
  // ("Now," "For the next few moments," "When you are ready," "You might
  // begin") between instructions, which reads as step-by-step guidance
  // rather than a continuous space the listener rests in. The fix is pacing
  // guidance, not a rewrite of the invitation language itself -- occasional
  // use of an invitation phrase is fine (see non_judgmental_language's "you
  // might notice"); it's the announced hand-off between every instruction
  // that produces the sequential feel.
  meditation: {
    dialogueGuidance:
      "Speak to the listener directly as a gentle invitation, offering options rather than commands; no staged dialogue between characters.",
    pacingGuidance:
      "Leave spacious pauses and let each instruction land before the next, moving continuously rather than announcing every step; gradual and unhurried, never a rush toward what's next.",
    descriptionGuidance:
      "Describe breath, body, and present-moment sensation plainly and concretely; avoid abstract, symbolic, or fantasy-world imagery.",
    styleGuidance:
      "Hold a tone of acceptance and non-judgment that keeps the listener safe to explore; guide toward awareness and presence, not a guaranteed outcome or mystical, poetic language.",
    allowedElementsBase: [
      "direct, gentle invitation to notice",
      "plain, unembellished instructions",
      "space to simply observe without response",
    ],
    plotDriven: false,
  },
  // Calibrated in RP-011C.8.8.3D: classic ASMR guidance must communicate
  // sensory attention and safe, personal address to the Writer Layer --
  // never narrative progression, fictional storytelling, meditation-style
  // instruction, sleep-induction framing, or a guaranteed relaxation/
  // emotional-transformation claim (knowledge/classic-asmr/*).
  "classic-asmr": {
    dialogueGuidance:
      "Dialogue between characters should not appear; speak directly to the listener in calm, personal address that offers closeness without expecting a response.",
    pacingGuidance:
      "Keep sensory focus slow and gently repetitive, with only small, gradual variation from one moment to the next; never a step-by-step sequence or a meditation-style progression through stages.",
    descriptionGuidance:
      "Describe one concrete sensory detail of the voice at a time (whisper, breath, rhythm), grounded in what the listener can actually perceive; avoid decorative prose, fantasy scenery, or external sound/object triggers.",
    styleGuidance:
      "Let vocal sensory presence itself carry the scene, not narrative development, transformation, or a healing arc; never claim or imply a guaranteed relaxation, tingling, or emotional outcome.",
    allowedElementsBase: [
      "ordinary vocal detail (whisper, breath, pacing, tone)",
      "quiet, gently varied repetition",
      "close, personal address that expects nothing in return",
    ],
    plotDriven: false,
  },
};

// Classic ASMR + story mode (RP-011C.8.8.3M) is a distinct guidance
// template, selected in builder.ts alongside GUIDANCE_TEMPLATE_BY_PRESET's
// classic-asmr entry above (which remains presence-mode's template). Story
// mode allows the scenario/persona/interaction framing scenes/planner.ts
// already builds for it (CLASSIC_ASMR_STORY_SCENE_STEPS) -- gentle
// storytelling delivery, persona address, and low-stakes dialogue -- while
// keeping the same non-plot-driven, no-forced-outcome, voice-first ASMR
// identity as presence mode. It must never read as Narrative preset
// guidance: no dramatic conflict, escalation, stakes, or turning-point
// pacing.
export const CLASSIC_ASMR_STORY_GUIDANCE_TEMPLATE: PresetGuidanceTemplate = {
  dialogueGuidance:
    "Dialogue between the listener and the scene's persona is allowed when it deepens closeness, but stays gentle and low-stakes; never plot-advancing exchange, argument, or exposition.",
  pacingGuidance:
    "Let the scene move gently through its persona and setting, layering in new sensory detail rather than new events; keep pacing slow and unhurried, never building toward a turning point, climax, or resolution.",
  descriptionGuidance:
    "Ground description in the persona and setting's sensory detail -- voice, closeness, atmosphere -- the listener can actually perceive; avoid dramatic incident, escalation, or elaborate world-building.",
  styleGuidance:
    "Let the scene's persona and gentle movement carry sensory presence forward, not narrative stakes or a story arc; never claim or imply a guaranteed relaxation, tingling, or emotional outcome.",
  allowedElementsBase: [
    "gentle scenario and persona framing",
    "low-stakes dialogue with the persona",
    "small, gradual sensory movement through the scene",
  ],
  plotDriven: false,
};

// Classic ASMR + story mode + narrative tension (RP-011C.7 targeted fix):
// selected in guidance/builder.ts's resolveTemplate instead of
// CLASSIC_ASMR_STORY_GUIDANCE_TEMPLATE above when intent.asmrNarrativeTension
// is true. That template's pacing/description/style guidance explicitly rule
// out "building toward a turning point, climax, or resolution" and
// "dramatic incident, escalation" -- correct for a companion/roleplay
// scenario, but exactly wrong for a request that explicitly asked for a
// mystery/thriller. This template allows a genuine clue, complication,
// escalation, and reveal while keeping every other ASMR delivery constraint
// identical: voice-first, intimate, controlled pacing, no shouting, no
// frantic cadence, no external object/sound triggers, no guaranteed
// relaxation/tingling claim. Tension is something that happens in the
// story, never something delivered through hurried or intense narration.
export const CLASSIC_ASMR_TENSION_STORY_GUIDANCE_TEMPLATE: PresetGuidanceTemplate = {
  dialogueGuidance:
    "Dialogue between the listener and the scene's persona is allowed when it carries the mystery forward or deepens closeness, but the persona's voice itself stays gentle and controlled even as the mystery's content grows tense -- never shouting, panic, or rushed exclamation.",
  pacingGuidance:
    "Let the scene move through a real clue, complication, escalation, and reveal -- pacing may tighten slightly as the mystery deepens, but stays slow, controlled, and voice-first throughout; never a rushed, frantic, or hurried cadence, and never resolved before its reveal.",
  descriptionGuidance:
    "Ground description in the persona and setting's sensory detail -- voice, closeness, atmosphere -- while also carrying the mystery's actual content: a concrete clue, a real complication, a genuine discovery; avoid external sound/object triggers and avoid delivering mystery content as pure atmosphere with nothing to actually uncover.",
  styleGuidance:
    "Let the scene deliver a genuine mystery -- a real clue, a deepening complication, a controlled escalation or discovery, and a reveal -- entirely through calm, close, voice-first delivery; tension comes from what happens in the story, never from hurried, frantic, or intense narration, and the ending must be an actual reveal or resolution, not a comfort-only close with nothing resolved.",
  allowedElementsBase: [
    "a genuine clue, complication, escalation, and reveal",
    "gentle scenario and persona framing carrying real story movement",
    "low-stakes dialogue with the persona that can carry mystery content",
    "controlled, voice-first tension -- never shouting, panic, or frantic pacing",
  ],
  plotDriven: false,
};

// Meditation + guided imagery (CreativeIntent.meditationExperienceType ===
// "guided_imagery"): the generic meditation template's descriptionGuidance
// above explicitly rules out "fantasy-world imagery" for every meditation,
// which directly contradicts supporting a genuinely-requested guided
// visualization (knowledge/meditation/gentle-visualization.ts already
// permits "simple, supportive mental spaces"). This template keeps every
// other meditation constraint (no plot, no characters, no guaranteed
// outcome, invitation over command) while letting descriptionGuidance/
// styleGuidance actually describe the imagined space's sensory detail
// instead of forbidding it. Selected in guidance/builder.ts's
// resolveTemplate alongside CLASSIC_ASMR_STORY_GUIDANCE_TEMPLATE above.
export const MEDITATION_GUIDED_IMAGERY_GUIDANCE_TEMPLATE: PresetGuidanceTemplate = {
  dialogueGuidance:
    "Speak to the listener directly as a gentle invitation into the imagined space, offering options rather than commands; no staged dialogue between characters.",
  pacingGuidance:
    "Leave spacious pauses and let each sensory detail land before the next, moving continuously rather than announcing every step; gradual and unhurried, never a rush toward what's next.",
  descriptionGuidance:
    "Describe the imagined space's sensory detail plainly and concretely -- what the listener can see, hear, feel, or smell within it; keep the space simple, still, and supportive, never an eventful or plot-driven fantasy world.",
  styleGuidance:
    "Hold a tone of acceptance and non-judgment that keeps the listener safe to explore the imagined space; guide toward calm immersion in the space itself, not a story, adventure, or characters within it.",
  allowedElementsBase: [
    "a simple, still, supportive imagined space",
    "plain, unembellished sensory detail within the space",
    "space to simply rest in the imagined setting without response",
  ],
  plotDriven: false,
};
