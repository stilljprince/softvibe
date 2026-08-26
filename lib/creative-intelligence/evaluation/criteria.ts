// lib/creative-intelligence/evaluation/criteria.ts
//
// Structured evaluation criteria for the Narrative Evaluation Layer
// (RP-011C.7.27). Pure data -- no scoring logic here (see evaluator.ts).
// Mirrors the templates.ts pattern used by planning/, scenes/, guidance/,
// and writer/: short structural definitions only, never prose.
//
// Seven global criteria answer the questions from the RP-011C.7.27 brief
// and apply to every preset (Premise Fulfillment, Story Movement,
// Character Development, Scene Purpose, Trust The Reader, AI Writing
// Patterns, Ending Quality). Preset-scoped criteria cover dimensions that
// don't fit a classic plot-driven story shape -- "Nicht alles als
// klassische Story bewerten": sensory quality (classic-asmr), atmosphere
// and safety (sleep-story), guided clarity (meditation), and age-
// appropriate imagination (kids-story). Narrative needs no extra criterion
// beyond the global set -- Handlung/Konflikt/Charakterentwicklung/Auflösung
// are already the seven global questions.
//
// Kids Story additionally gets four criteria of its own (RP-011C.8.8.1C),
// one per kids-story-specific knowledge module added in
// RP-011C.8.8.1A/B (see knowledge/kids-story/*): kids stories are not
// judged like adult narrative, so these evaluate child-appropriate
// perspective, emotional safety, small-scale wonder, and relational
// warmth -- dimensions the seven global criteria don't cover.
//
// Meditation additionally gets six criteria of its own (RP-011C.8.8.2E),
// grounded in the meditation-specific knowledge modules from
// RP-011C.8.8.2A (see knowledge/meditation/*): meditation is not judged
// like narrative either, so these replace plot/character/conflict-
// resolution questions with guidance quality, attention progression,
// non-judgmental language, emotional safety, embodiment/presence, and
// pacing quality. emotional_safety reuses the Kids Story criterion's id
// (both cover the same underlying safety concern) but is a distinct,
// meditation-scoped definition here -- getApplicableCriteria() only ever
// returns one of the two per preset, and evaluator.ts branches its single
// CRITERION_CHECKS.emotional_safety entry on intent.preset accordingly.
//
// Classic ASMR additionally gets six criteria of its own (RP-011C.8.8.3E),
// one per classic-asmr knowledge module from RP-011C.8.8.3A (see
// knowledge/classic-asmr/*): classic ASMR is a sensory-attention
// experience, not a plot-driven story or a guided practice, so these
// evaluate sensory presence, gentle/unhurried rhythm, safe personal
// address, meaningful (non-decorative) sensory detail, intentional
// (non-redundant) repetition, and the absence of guaranteed-outcome
// claims -- dimensions the seven global criteria and sensory_quality (the
// pre-existing classic-asmr criterion, RP-011C.7.27) don't cover.
// safe_personal_address's id deliberately doesn't match its knowledge
// module id (intimate_safe_address) -- same naming choice as
// warmth_and_belonging (grounded in friendship_and_belonging).
//
// RP-011C.8.8.3N (Evaluation Layer calibration) makes three of these six
// criteria -- sensory_presence, safe_personal_address, calming_repetition --
// aware of CreativeIntent.asmrMode ("presence" | "story"): their definitions
// below are unchanged (still one classic-asmr-scoped criterion each, not a
// second evaluation system), but evaluator.ts's CRITERION_CHECKS branch on
// intent.asmrMode so story mode's persona, scenario, and gentle narrative
// movement (guidance/templates.ts CLASSIC_ASMR_STORY_GUIDANCE_TEMPLATE,
// scenes/templates.ts CLASSIC_ASMR_STORY_SCENE_STEPS) no longer read as
// presence-only violations. gentle_rhythm, sensory_detail_balance, and
// no_forced_response are unchanged and apply identically to both modes --
// pacing, decorative/fantasy detail, and forced-outcome claims are equally
// out of bounds whether or not a persona/scenario is present.
//
// Sleep Story Evaluation Calibration (RP-011C.8.10H) adds four criteria of
// its own -- movement_without_urgency, sleep_transition_arc,
// peaceful_non_demanding_endings, companions_as_warmth -- and extends the
// pre-existing sleep_atmosphere_and_safety (RP-011C.7.27) rather than
// duplicating it. Before this calibration, sleep-story's only preset-scoped
// criterion (a check on intent.emotionalDirection and
// storyBlueprint.emotionalArc.end being non-empty) could not detect any of
// Sleep Story's real failure modes: urgency/danger/chase escalation
// borrowed from Narrative, late novelty or an active final scene breaking
// the decelerating sleep-transition curve, fear/distress/drama breaking the
// comfort baseline, twist/moral/punchline endings, or companions written as
// conflict-driven characters instead of warmth. All five criteria here are
// grounded one-to-one in the Sleep Story Knowledge Foundation
// (knowledge/sleep-story/*, RP-011C.8.10C): movement_without_urgency,
// sleep_transition_arc, peaceful_non_demanding_endings, and
// companions_as_warmth reuse their knowledge module's id as the criterion
// id (same convention as child_perspective/gentle_wonder for Kids Story);
// sleep_atmosphere_and_safety is re-grounded in comfort_baseline_and_belonging
// and its severity raised from "weakness" to "violation" to match that
// module's CRITICAL priority and the safety-violation severity meditation's
// and Kids Story's own emotional_safety criteria already use. None of these
// require meditation's breath/body instruction, classic-asmr's whisper
// triggers, or narrative's character-arc/conflict machinery -- see
// evaluator.ts's phrase lists, which are deliberately chosen not to overlap
// with sleep-story's own GUIDANCE_TEMPLATE_BY_PRESET / SLEEP_STORY_SCENE_STEPS
// wording (which itself already names "conflict", "dependency", and
// "narrative tension" only to rule them out).

import type { CreativePreset } from "../core/constants";
import type { EvaluationCriterionDefinition } from "./types";

export const EVALUATION_CRITERIA: EvaluationCriterionDefinition[] = [
  {
    id: "premise_fulfillment",
    name: "Premise Fulfillment",
    question: "Does the story fulfill the promise of the original idea?",
    description:
      "A transformation-scale story must not resolve into a single symbolic moment; the resolution's scale must match what the premise promised.",
    appliesTo: { scope: "global" },
    severity: "violation",
    relatedKnowledgeModuleId: "premise_fulfillment",
    suggestion: "Check whether the resolution operates at the scale the premise promised.",
  },
  {
    id: "story_movement",
    name: "Story Movement",
    question: "Does something change between the beginning and the end?",
    description: "The experience's starting point and ending state must be distinct, not a restatement of the same state.",
    appliesTo: { scope: "global" },
    severity: "violation",
    relatedKnowledgeModuleId: "story_is_change",
    suggestion: "Check whether the starting point and ending state describe an actual change.",
  },
  {
    id: "character_development",
    name: "Character Development",
    question: "Do characters have understandable development or decisions?",
    description:
      "The protagonist's desire, need, and internal conflict must be present and distinct, not interchangeable placeholders.",
    appliesTo: { scope: "global" },
    severity: "violation",
    relatedKnowledgeModuleId: "character_wants_needs",
    suggestion: "Check whether the protagonist's decisions follow from a want or need rather than plot convenience.",
  },
  {
    id: "scene_purpose",
    name: "Scene Purpose",
    question: "Does every scene have an understandable function?",
    description: "Each planned scene must have its own, non-empty, non-duplicated purpose.",
    appliesTo: { scope: "global" },
    severity: "weakness",
    relatedKnowledgeModuleId: "scene_has_purpose",
    suggestion: "Check whether any scene shares its purpose with another scene or has no purpose at all.",
  },
  {
    id: "trust_the_reader",
    name: "Trust The Reader",
    question: "Is too much explained instead of shown?",
    description: "Generated text should not lean on stock explanatory phrases that tell the listener what to feel.",
    appliesTo: { scope: "global" },
    severity: "weakness",
    relatedKnowledgeModuleId: "trust_the_reader",
    suggestion: "Check for stock explanatory phrases that state emotions instead of showing them.",
  },
  {
    id: "ai_writing_patterns",
    name: "AI Writing Patterns",
    question: "Does the content show typical AI writing failure patterns?",
    description:
      "Checks generated text against the anti-patterns already resolved onto avoid_ai_writing_patterns via CreativeContext (never queried from the registry directly).",
    appliesTo: { scope: "global" },
    severity: "weakness",
    relatedKnowledgeModuleId: "avoid_ai_writing_patterns",
    suggestion: "Check generated text against this preset's applicable AI-writing anti-patterns.",
  },
  {
    id: "ending_quality",
    name: "Ending Quality",
    question: "Is the ending earned, with a real payoff and no manufactured moral?",
    description: "The ending state must be defined and the text must not lean on stock moral-of-the-story phrasing.",
    appliesTo: { scope: "global" },
    severity: "weakness",
    suggestion: "Check whether the ending pays off the story's own setup instead of stating a moral directly.",
  },
  {
    id: "sensory_quality",
    name: "Sensory Quality & Consistency",
    question: "Is the sensory experience consistent and relaxing across segments?",
    description: "ASMR-specific: description guidance must be present for every segment, and segment lengths should not vary wildly.",
    appliesTo: { scope: "preset", presets: ["classic-asmr"] },
    severity: "weakness",
    suggestion: "Check whether segment lengths and sensory description guidance are consistent across the session.",
  },
  {
    id: "sleep_atmosphere_and_safety",
    name: "Atmosphere & Safety",
    question: "Does the experience build calm, safety, and a believable transition toward sleep?",
    description:
      "Sleep Story-specific: the intent must define an emotional direction, the arc must settle by the end, and text must not introduce fear or distress that breaks the comfort baseline.",
    appliesTo: { scope: "preset", presets: ["sleep-story"] },
    severity: "violation",
    relatedKnowledgeModuleId: "comfort_baseline_and_belonging",
    suggestion: "Check whether the emotional direction and ending state support a calm transition to sleep, and whether generated text avoids fear, distress, or emotional drama.",
  },
  {
    id: "movement_without_urgency",
    name: "Movement Without Urgency",
    question: "Does the story move gently without relying on tension?",
    description:
      "Sleep Story-specific: generated text must not rely on deadlines, danger, chases, or unresolved suspense -- gentle curiosity is the only permitted pull.",
    appliesTo: { scope: "preset", presets: ["sleep-story"] },
    severity: "violation",
    relatedKnowledgeModuleId: "movement_without_urgency",
    suggestion: "Check whether generated text relies on urgency, danger, chase structures, or unresolved suspense instead of gentle curiosity.",
  },
  {
    id: "sleep_transition_arc",
    name: "Sleep Transition Arc",
    question: "Does the story gradually become calmer over time?",
    description:
      "Sleep Story-specific: the final planned scene must be a settling/rest stage, and its generated text must not introduce late novelty or an active, energetic final beat.",
    appliesTo: { scope: "preset", presets: ["sleep-story"] },
    severity: "violation",
    relatedKnowledgeModuleId: "sleep_transition_arc",
    suggestion: "Check whether the final scene is a settling/rest stage and whether its text avoids late novelty or an active final beat.",
  },
  {
    id: "peaceful_non_demanding_endings",
    name: "Peaceful, Non-Demanding Endings",
    question: "Does the ending support sleep?",
    description:
      "Sleep Story-specific: the final scene must not contain a twist, revelation, punchline, or stated moral, and must close with a complete sentence -- no literal ellipsis or unfinished sentence.",
    appliesTo: { scope: "preset", presets: ["sleep-story"] },
    severity: "violation",
    relatedKnowledgeModuleId: "peaceful_non_demanding_endings",
    suggestion: "Check whether the final scene's text avoids twists, revelations, punchlines, or a stated moral, and closes with a complete sentence rather than a literal ellipsis or unfinished sentence.",
  },
  {
    id: "companions_as_warmth",
    name: "Companion Character Behavior",
    question: "If characters appear, do they provide warmth without becoming plot drivers?",
    description:
      "Sleep Story-specific: generated text must not frame companions through conflict, dependency, or rescue -- companions provide gentle, low-conflict presence only.",
    appliesTo: { scope: "preset", presets: ["sleep-story"] },
    severity: "weakness",
    relatedKnowledgeModuleId: "companions_as_warmth",
    suggestion: "Check whether generated text frames companions through conflict, dependency, rescue, or unresolved problems instead of gentle presence.",
  },
  {
    id: "guided_clarity",
    name: "Guided Clarity",
    question: "Is the guided experience clear and safe throughout?",
    description: "Meditation-specific: every part of the session's pacing and listener guidance must be present.",
    appliesTo: { scope: "preset", presets: ["meditation"] },
    severity: "weakness",
    suggestion: "Check whether pacing and guidance are defined for every part of the session.",
  },
  {
    id: "child_perspective",
    name: "Child Perspective",
    question: "Does the story feel experienced from a child's viewpoint?",
    description:
      "Kids Story-specific: narration should stay close to a child's curiosity and immediate feeling, not adult reflection or abstract analysis.",
    appliesTo: { scope: "preset", presets: ["kids-story"] },
    severity: "violation",
    relatedKnowledgeModuleId: "child_perspective",
    suggestion: "Check whether the protagonist's framing centers a child's curiosity and whether the text avoids adult reflection or over-explanation.",
  },
  {
    id: "emotional_safety",
    name: "Emotional Safety",
    question: "Does the story remain emotionally safe for a child listener?",
    description:
      "Kids Story-specific: conflict is allowed but must stay gentle, resolve with reassurance, and end on a calm, secure note (CLAUDE.md).",
    appliesTo: { scope: "preset", presets: ["kids-story"] },
    severity: "violation",
    relatedKnowledgeModuleId: "emotional_safety",
    suggestion: "Check whether the emotional arc settles into a calm, secure ending and the text avoids frightening or unresolved content.",
  },
  {
    id: "gentle_wonder",
    name: "Gentle Wonder",
    question: "Does the story's sense of wonder stay small and everyday rather than epic?",
    description:
      "Kids Story-specific: discovery and imagination should come from small, everyday magical moments, not epic-fantasy stakes.",
    appliesTo: { scope: "preset", presets: ["kids-story"] },
    severity: "weakness",
    relatedKnowledgeModuleId: "gentle_wonder",
    suggestion: "Check whether the text escalates a small discovery into epic-fantasy stakes instead of everyday wonder.",
  },
  {
    id: "warmth_and_belonging",
    name: "Warmth & Belonging",
    question: "Does the story's resolution strengthen friendship or a sense of belonging?",
    description:
      "Kids Story-specific: the protagonist's sense of safety and confidence should grow through connection with others, not solitary achievement.",
    appliesTo: { scope: "preset", presets: ["kids-story"] },
    severity: "weakness",
    relatedKnowledgeModuleId: "friendship_and_belonging",
    suggestion: "Check whether the protagonist's need and goal are framed around connection and whether the text avoids isolated-achievement framing.",
  },
  {
    id: "age_appropriate_imagination",
    name: "Age-Appropriate Imagination",
    question: "Is the story age-safe, imaginative, and easy to follow for a child listener?",
    description:
      "Kids Story-specific: the intent's constraints and required elements must carry this project's age-safety and positive-resolution rules (CLAUDE.md).",
    appliesTo: { scope: "preset", presets: ["kids-story"] },
    severity: "violation",
    suggestion: "Check whether age-safety constraints and a positive/safe resolution requirement are present on the intent.",
  },

  // Meditation-specific criteria (RP-011C.8.8.2E): meditation is not judged
  // as narrative, so these replace plot/character/conflict-resolution
  // criteria with practice quality, guidance quality, emotional safety, and
  // attention progression. Grounded in the meditation knowledge modules
  // from RP-011C.8.8.2A (guided_presence, breath_awareness, body_awareness,
  // non_judgmental_language, meditation_emotional_safety,
  // gentle_visualization) -- see knowledge/meditation/*.
  {
    id: "guidance_clarity",
    name: "Guidance Clarity",
    question: "Are the listener's instructions clear, understandable, and practice-oriented?",
    description:
      "Meditation-specific: guidance must give a clear writing focus, understandable transitions, and listener-facing direction rather than vague poetic language with no function.",
    appliesTo: { scope: "preset", presets: ["meditation"] },
    severity: "violation",
    relatedKnowledgeModuleId: "guided_presence",
    suggestion: "Check whether guidance is clear and practice-oriented, and whether generated text leans on vague poetic language without function.",
  },
  {
    id: "attention_progression",
    name: "Attention Progression",
    question: "Does the meditation move attention intentionally through arrival, focus, deepening, integration, and return?",
    description:
      "Meditation-specific: planned scenes must move from arrival through a focus/anchor stage to a gentle return, in order -- not a random sequence of relaxation statements.",
    appliesTo: { scope: "preset", presets: ["meditation"] },
    severity: "violation",
    relatedKnowledgeModuleId: "guided_presence",
    suggestion: "Check whether the planned scenes cover arrival, a focus/anchor stage, and a gentle return, with any deepening or integration stage in order between them.",
  },
  {
    id: "non_judgmental_language",
    name: "Non-Judgmental Language",
    question: "Does the guidance invite and accept rather than command or correct?",
    description:
      "Meditation-specific: language should invite ('you might notice') and accept whatever the listener experiences, never command, pressure, or frame wandering attention as failure.",
    appliesTo: { scope: "preset", presets: ["meditation"] },
    severity: "weakness",
    relatedKnowledgeModuleId: "non_judgmental_language",
    suggestion: "Check generated text for commanding language or failure/performance framing instead of invitation and acceptance.",
  },
  {
    id: "emotional_safety",
    name: "Emotional Safety",
    question: "Does the meditation keep the listener's inner experience safe throughout?",
    description:
      "Meditation-specific: pacing must stay gentle and the text must avoid overwhelming emotional instructions or guaranteed-outcome claims.",
    appliesTo: { scope: "preset", presets: ["meditation"] },
    severity: "violation",
    relatedKnowledgeModuleId: "meditation_emotional_safety",
    suggestion: "Check whether pacing stays gentle and the text avoids overwhelming emotional instructions or guaranteed outcomes.",
  },
  {
    id: "embodiment_and_presence",
    name: "Embodiment & Presence",
    question: "Does the meditation support present-moment awareness through breath, body, and sensory presence?",
    description:
      "Meditation-specific: the practice should ground attention in breath awareness, body awareness, and sensory presence rather than lead with an external fantasy narrative.",
    appliesTo: { scope: "preset", presets: ["meditation"] },
    severity: "weakness",
    relatedKnowledgeModuleId: "breath_awareness",
    suggestion: "Check whether generated text grounds attention in breath, body, or sensory presence rather than an external fantasy narrative.",
  },
  {
    id: "pacing_quality",
    name: "Pacing Quality",
    question: "Does the meditation's structure support calm, spacious pacing rather than rushed sequences?",
    description: "Meditation-specific: pacing guidance must call for spacious transitions and gradual progression, and generated text must avoid rushed sequences.",
    appliesTo: { scope: "preset", presets: ["meditation"] },
    severity: "weakness",
    relatedKnowledgeModuleId: "breath_awareness",
    suggestion: "Check whether pacing guidance calls for spacious, gradual transitions and generated text avoids rushed language.",
  },

  // Classic ASMR-specific criteria (RP-011C.8.8.3E): classic ASMR is not
  // judged as narrative, guided practice, or a wind-down story either, so
  // these evaluate sensory presence, rhythm, address, detail balance,
  // repetition, and forced-outcome safety. Grounded in the classic-asmr
  // knowledge modules from RP-011C.8.8.3A (sensory_presence, gentle_rhythm,
  // intimate_safe_address, sensory_detail_balance, calming_repetition,
  // no_forced_response) -- see knowledge/classic-asmr/*.
  {
    id: "sensory_presence",
    name: "Sensory Presence",
    question: "Does attention stay anchored in immediate sensory noticing rather than an unfolding story?",
    description:
      "Classic ASMR-specific: description guidance must stay concrete and perceivable, and generated text must not build a narrative arc or drift into external sound/object triggers.",
    appliesTo: { scope: "preset", presets: ["classic-asmr"] },
    severity: "violation",
    relatedKnowledgeModuleId: "sensory_presence",
    suggestion:
      "Check whether description guidance stays concrete and voice-based, and generated text avoids a narrative arc or external sound/object triggers.",
  },
  {
    id: "gentle_rhythm",
    name: "Gentle Rhythm",
    question: "Does the pacing stay slow, unhurried, and gently predictable rather than building toward a climax?",
    description:
      "Classic ASMR-specific: pacing guidance must call for a slow, unhurried, repetitive flow, and generated text must not accelerate toward a climax or payoff.",
    appliesTo: { scope: "preset", presets: ["classic-asmr"] },
    severity: "violation",
    relatedKnowledgeModuleId: "gentle_rhythm",
    suggestion: "Check whether pacing guidance stays slow and unhurried and generated text avoids accelerating toward a climax or payoff.",
  },
  {
    id: "safe_personal_address",
    name: "Safe Personal Address",
    question: "Does the address feel personally close and warm without feeling intrusive or demanding a response?",
    description:
      "Classic ASMR-specific: character guidance must address the listener directly with no fictional characters, and generated text must avoid character dialogue or intrusive, response-demanding framing.",
    appliesTo: { scope: "preset", presets: ["classic-asmr"] },
    severity: "weakness",
    relatedKnowledgeModuleId: "intimate_safe_address",
    suggestion: "Check whether guidance addresses the listener directly and generated text avoids fictional dialogue or intrusive framing.",
  },
  {
    id: "sensory_detail_balance",
    name: "Sensory Detail Balance",
    question: "Is sensory detail meaningful and perceivable rather than decorative or overwritten?",
    description: "Classic ASMR-specific: generated text should not pile on decorative or fantasy description that doesn't correspond to something perceivable.",
    appliesTo: { scope: "preset", presets: ["classic-asmr"] },
    severity: "weakness",
    relatedKnowledgeModuleId: "sensory_detail_balance",
    suggestion: "Check whether generated text leans on decorative or fantasy description instead of meaningful, perceivable sensory detail.",
  },
  {
    id: "calming_repetition",
    name: "Calming Repetition",
    question: "Does repetition feel like an intentional soothing tool rather than redundant filler?",
    description:
      "Classic ASMR-specific: the planned scenes must include a rhythmic-repetition stage paired with a gentle-variation stage, not a single sensory beat restated identically.",
    appliesTo: { scope: "preset", presets: ["classic-asmr"] },
    severity: "weakness",
    relatedKnowledgeModuleId: "calming_repetition",
    suggestion: "Check whether the planned scenes pair a rhythmic-repetition stage with a gentle-variation stage rather than restating the same beat identically.",
  },
  {
    id: "no_forced_response",
    name: "No Forced Response",
    question: "Does the content avoid claiming or guaranteeing a specific physical or emotional response?",
    description:
      "Classic ASMR-specific: generated text must not claim or imply a guaranteed physical or emotional response (tingles, relaxation, sleep) or frame the absence of one as a failure.",
    appliesTo: { scope: "preset", presets: ["classic-asmr"] },
    severity: "violation",
    relatedKnowledgeModuleId: "no_forced_response",
    suggestion: "Check whether generated text claims a guaranteed response or frames the listener's lack of response as a failure.",
  },
  // RP-011C.7 targeted fix: the live cutover-readiness regression found a
  // classic-asmr thriller request scored 1.0/"strong" by this evaluator
  // despite delivering no actual mystery (no clue, no development, no
  // reveal) -- none of the six criteria above check for narrative
  // fulfillment at all, since CLASSIC_ASMR_STORY_SCENE_STEPS never planned
  // one to check for. This is a narrow, structural check only: it confirms
  // that when intent.asmrNarrativeTension is true, the planned scenes
  // actually include a complication/clue stage and a reveal/payoff stage
  // (i.e. that scenes/planning routed to CLASSIC_ASMR_TENSION_STORY_SCENE_STEPS
  // rather than silently falling back to the no-complication template). It
  // deliberately does NOT attempt to verify the generated prose itself
  // delivers real tension -- that would require fragile keyword heuristics
  // against free-form mystery writing, which risks false confidence more
  // than it catches real failures; see the RP-011C.7 completion report for
  // this documented evaluator limitation.
  {
    id: "narrative_tension_fulfillment",
    name: "Narrative Tension Fulfillment",
    question: "When narrative tension was explicitly requested, did planning actually provide for it?",
    description:
      "Classic ASMR-specific: when intent.asmrNarrativeTension is true, the planned scenes must include both a complication/clue stage and a reveal/payoff stage, not the ordinary no-complication comfort progression.",
    appliesTo: { scope: "preset", presets: ["classic-asmr"] },
    severity: "violation",
    suggestion:
      "Check whether the planned scenes include a complication/clue stage and a reveal/payoff stage when narrative tension was explicitly requested.",
  },
];

// Global criteria always apply; preset-scoped criteria only apply to their
// declared presets -- same query shape as
// creativeKnowledgeRegistry.queryApplicableModules(), reimplemented here
// because this layer must not query the registry directly (see
// evaluator.ts / README.md).
export function getApplicableCriteria(preset: CreativePreset): EvaluationCriterionDefinition[] {
  return EVALUATION_CRITERIA.filter(
    (criterion) => criterion.appliesTo.scope === "global" || criterion.appliesTo.presets.includes(preset)
  );
}
