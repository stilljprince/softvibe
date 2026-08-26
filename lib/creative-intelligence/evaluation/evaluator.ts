// lib/creative-intelligence/evaluation/evaluator.ts
//
// Narrative Evaluation Layer (RP-011C.7.27). Answers "does the generated
// content fulfill the planned creative goals and quality principles?" for
// content the (future) Writer Layer already produced. It only evaluates --
// it does not rewrite, repair, or generate anything, and it does not
// replace lib/story-supervisor.ts or change the active pipeline.
//
// Deterministic only for this pass: no LLM/provider calls, only simple
// structural/keyword checks (per the RP-011C.7.27 brief -- no large text
// analysis). It never queries creativeKnowledgeRegistry directly; it only
// reads the modules and evaluation-stage knowledge statements the Context
// Builder already resolved onto CreativeContext -- the same pattern used
// by planning/blueprint-builder.ts, scenes/planner.ts, and
// guidance/builder.ts.

import type { CreativeContext } from "../context/types";
import type { KnowledgeModule } from "../knowledge/types";
import { getApplicableCriteria } from "./criteria";
import type {
  CriteriaResult,
  EvaluationCriterionDefinition,
  EvaluationCriterionId,
  EvaluationInput,
  EvaluationResult,
  NarrativeEvaluator,
  OverallAssessment,
} from "./types";

export const EVALUATOR_VERSION = "1.0.0";

function findModule(context: CreativeContext, id: string): KnowledgeModule | undefined {
  return context.knowledge.modules.find((module) => module.id === id);
}

function combinedText(input: EvaluationInput): string {
  return input.generatedContent.map((scene) => scene.text).join("\n\n").toLowerCase();
}

// Small, fixed phrase lists for cheap substring checks -- deliberately not
// an NLP/sentiment pass (see file header and README.md).
const STOCK_EXPLANATORY_PHRASES = ["little did", "in that moment", "somehow", "she felt", "he felt", "i felt", "deep down"];

const STOCK_MORAL_PHRASES = ["moral of the story", "and so we learn", "the lesson here is", "in conclusion"];

// Kids Story-specific phrase lists (RP-011C.8.8.1C), same cheap substring-
// check approach as STOCK_EXPLANATORY_PHRASES / STOCK_MORAL_PHRASES above --
// not NLP, just fixed markers of the failure modes each kids-story
// knowledge module already names in its antiPatterns (see
// knowledge/kids-story/*).
const ADULT_REFLECTION_PHRASES = ["in retrospect", "philosophically", "as any adult would", "with the wisdom of age"];

const UNSAFE_CONTENT_PHRASES = ["terrified", "screamed in fear", "monster attacked", "nightmare"];

const EPIC_FANTASY_PHRASES = ["save the world", "ancient prophecy", "the fate of", "epic battle", "dark lord", "chosen one"];

const ISOLATED_ACHIEVEMENT_PHRASES = ["did it all alone", "needed no one", "all by myself, without help"];

// Meditation-specific phrase lists (RP-011C.8.8.2E), same cheap substring-
// check approach as the lists above -- grounded in the antiPatterns already
// named by the meditation knowledge modules (see knowledge/meditation/*),
// not a new NLP system.
const MEDITATION_VAGUE_POETIC_PHRASES = [
  "cosmic tapestry",
  "celestial symphony",
  "boundless void",
  "infinite ethereal",
  "mystical energies",
  "universal consciousness",
];

const MEDITATION_COMMANDING_PHRASES = ["you must", "you have to", "do this now", "you need to relax", "you will now"];

const MEDITATION_FAILURE_FRAMING_PHRASES = [
  "you're doing it wrong",
  "you failed to",
  "if you fail to relax",
  "you are not doing this correctly",
];

const MEDITATION_OVERWHELMING_PHRASES = [
  "confront your deepest fear",
  "face your trauma",
  "force yourself to feel",
  "let it completely overwhelm you",
];

const MEDITATION_GUARANTEED_OUTCOME_PHRASES = [
  "guaranteed to heal",
  "this will cure",
  "you will definitely feel",
  "always works instantly",
];

const MEDITATION_FANTASY_NARRATIVE_PHRASES = [
  "once upon a time in a kingdom",
  "the dragon",
  "on your quest",
  "the adventure begins",
  "a magical kingdom",
];

const MEDITATION_RUSHED_PHRASES = ["rush through", "hurry", "quickly move on", "right away, move to", "no time to waste"];

const MEDITATION_BREATH_KEYWORDS = /breath|inhale|exhale/i;
const MEDITATION_BODY_KEYWORDS = /\bbody\b|shoulders|chest|muscles|tension/i;
const MEDITATION_SENSORY_PRESENCE_KEYWORDS = /notice|sensation|feel the|aware of|present.moment/i;
const MEDITATION_SPACIOUS_PACING_KEYWORDS = /space|pause|gradual|slow|unhurried/i;

// RP-011C.8.8.2G -- pacing polish: benchmark review found generated
// meditation text over-relying on announced step markers between
// instructions ("Now,", "For the next few moments,", "When you are ready,",
// "You might begin"), which reads as being guided step-by-step rather than
// resting in a continuous space. A single use of any of these is ordinary,
// natural meditation language (the same "you might notice" shape
// non_judgmental_language already treats as good invitation phrasing) --
// it is only frequent repetition that produces the sequential feel the
// benchmark flagged, so this is a count threshold, unlike the single-match
// MEDITATION_*_PHRASES checks above.
const MEDITATION_SEQUENTIAL_MARKER_PHRASES = ["for the next few moments", "when you are ready", "you might begin", "now,"];
const MEDITATION_SEQUENTIAL_MARKER_MAX_COUNT = 2;

function countSequentialMarkers(text: string): number {
  return MEDITATION_SEQUENTIAL_MARKER_PHRASES.reduce((count, phrase) => count + (text.split(phrase).length - 1), 0);
}

// Classic ASMR-specific phrase lists (RP-011C.8.8.3E), same cheap substring-
// check approach as the lists above -- grounded in the antiPatterns already
// named by the classic-asmr knowledge modules (see knowledge/classic-asmr/*),
// not a new NLP system. Chosen to not overlap with any classic-asmr
// GUIDANCE_TEMPLATE_BY_PRESET or CLASSIC_ASMR_SCENE_STEPS wording, since
// those are echoed verbatim into the Writer Layer's deterministic
// placeholder text (see writer.ts composePlaceholderText()).
const ASMR_NARRATIVE_DRIFT_PHRASES = [
  "the adventure begins",
  "once upon a time",
  "our story continues",
  "little did they know",
  "chapter one",
  "the tale unfolds",
];

// SoftVibe Classic ASMR is voice-first, not trigger-based (RP-011C.8.8.3G):
// no tapping, scratching, writing sounds, object handling, or external sound
// events. These phrases catch generated text drifting toward traditional
// trigger-based ASMR instead of sensory_presence's voice-anchored framing
// (knowledge/classic-asmr/sensory-presence.ts).
const ASMR_EXTERNAL_TRIGGER_PHRASES = [
  "tapping sound",
  "the sound of tapping",
  "scratching sound",
  "the sound of scratching",
  "pen on paper",
  "pen tip on paper",
  "sound of writing",
  "crinkling",
  "brushing sound",
  "the object in my hands",
];

const ASMR_RUSHED_PHRASES = [
  "rush toward a climax",
  "building to a climax",
  "hurry to the next",
  "quicken the pace toward",
  "racing toward the payoff",
];

const ASMR_CHARACTER_DIALOGUE_PHRASES = ["she said", "he said", "they said", "she asked", "he asked"];

const ASMR_INTRUSIVE_ADDRESS_PHRASES = [
  "you must feel",
  "you have to respond",
  "don't look away",
  "you need to react",
  "you must react right now",
];

const ASMR_DECORATIVE_FANTASY_PHRASES = [
  "shimmering aura",
  "enchanted forest",
  "mystical glow",
  "sparkling wonderland",
  "ethereal glow surrounds",
  "magical kingdom of light",
];

const ASMR_REDUNDANT_FILLER_PHRASES = [
  "nothing more to say, so",
  "repeating because there is nothing else to say",
  "said again for lack of anything new",
];

const ASMR_FORCED_OUTCOME_PHRASES = [
  "guaranteed to give you tingles",
  "you will definitely feel relaxed",
  "this will make you fall asleep instantly",
  "guaranteed relaxation",
  "you will feel tingles",
];

const ASMR_RESPONSE_FAILURE_FRAMING_PHRASES = [
  "you're doing it wrong if you don't feel",
  "if you don't feel anything, something is wrong",
  "you should be feeling tingles by now",
];

// Sleep Story-specific phrase lists (RP-011C.8.10H), same cheap substring-
// check approach as the lists above -- grounded in the antiPatterns already
// named by the sleep-story knowledge modules (see knowledge/sleep-story/*),
// not a new NLP system. Chosen to not overlap with any sleep-story
// GUIDANCE_TEMPLATE_BY_PRESET, SLEEP_STORY_SCENE_STEPS, or writer template
// wording, since those are echoed verbatim into the Writer Layer's
// deterministic placeholder text (composePlaceholderText()) and already
// name "conflict", "dependency", "narrative tension", and "danger-coded"
// only to rule them out -- single-word matches on those terms would trip
// on the guidance's own safety language, so every phrase below is a
// multi-word marker of the failure mode actually occurring.
const SLEEP_STORY_URGENCY_PHRASES = [
  "running out of time",
  "before it's too late",
  "had to hurry",
  "no time to lose",
  "chased by",
  "being chased",
  "had to escape",
  "in danger of",
  "raced against time",
  "or else",
];

const SLEEP_STORY_LATE_NOVELTY_PHRASES = [
  "suddenly appeared",
  "for the first time",
  "a new character",
  "without warning",
  "just then",
  "out of nowhere",
];

const SLEEP_STORY_ACTIVE_FINAL_PHRASES = [
  "leaped up",
  "rushed toward",
  "burst into",
  "shouted with excitement",
  "raced ahead",
  "heart racing",
];

const SLEEP_STORY_DISTRESS_PHRASES = [
  "screamed in terror",
  "overwhelming grief",
  "furious argument",
  "panic rising",
  "burst into tears",
  "heart pounding in fear",
];

const SLEEP_STORY_ENDING_HOOK_PHRASES = [
  "little did they know",
  "turns out",
  "the truth was",
  "to be continued",
  "everything changed in an instant",
  "revealed that",
];

const SLEEP_STORY_COMPANION_CONFLICT_PHRASES = [
  "refused to speak to",
  "stormed off in anger",
  "needed to be rescued",
  "couldn't survive without",
  "desperately needed them",
  "abandoned by",
];

// Finds the generated text for the last scene in planned order -- used by
// sleep-story's ending-focused criteria (sleep_transition_arc's final beat,
// peaceful_non_demanding_endings) so they check the actual ending rather
// than the whole session, matching what "does the ending support sleep?"
// asks.
function lastSceneInOrder(input: EvaluationInput) {
  const { scenes, generatedContent } = input;
  const ordered = scenes.slice().sort((a, b) => a.order - b.order);
  const lastScene = ordered[ordered.length - 1];
  const lastGenerated = lastScene ? generatedContent.find((g) => g.sceneId === lastScene.id) : undefined;
  return {
    lastScene,
    lastText: lastGenerated ? stripGuidanceEchoLines(lastGenerated.text.toLowerCase()) : "",
  };
}

// RP-011C.8.10S: Sleep Story endings must close with a complete, punctuated
// sentence -- a literal ellipsis or an unfinished final sentence reads as
// the story cutting off mid-thought rather than as quiet closure (see
// knowledge/sleep-story/peaceful-non-demanding-endings.ts). Both checks run
// against the final scene's own trimmed text only (via lastSceneInOrder),
// so an ellipsis used as a pause earlier in the story is never flagged --
// only the text's actual closing characters are.
const CLOSING_APOSTROPHE = "'";
const LITERAL_ELLIPSIS_PATTERN = new RegExp(`(\\.\\.\\.|…)[")\\]${CLOSING_APOSTROPHE}]*$`);
const TERMINAL_PUNCTUATION_PATTERN = new RegExp(`[.!?][")\\]${CLOSING_APOSTROPHE}]*$`);

function endsWithLiteralEllipsis(trimmedText: string): boolean {
  return LITERAL_ELLIPSIS_PATTERN.test(trimmedText);
}

function endsWithIncompleteSentence(trimmedText: string): boolean {
  if (trimmedText.length === 0) return false;
  if (endsWithLiteralEllipsis(trimmedText)) return false;
  return !TERMINAL_PUNCTUATION_PATTERN.test(trimmedText);
}

type CriterionCheckResult = { passed: boolean; explanation: string };
type CriterionCheck = (input: EvaluationInput) => CriterionCheckResult;

// Generated text legitimately *names* an anti-pattern (via the Writer
// Layer's deterministic placeholder "Avoid: ..." line, which echoes
// scene.avoidPatterns to prove it consumed its guidance) without exhibiting
// it -- strip that line before matching so naming a pattern isn't scored as
// committing it. Same reasoning as ai_writing_patterns below.
//
// "Pacing guidance: ..." is stripped for the same reason (RP-011C.8.8.2G):
// the same placeholder also echoes guidance.pacingGuidance verbatim, which
// now names the exact step-marker phrases pacing_quality's sequential-
// marker check looks for -- without this, naming the anti-pattern in
// guidance would itself trip the check meant to catch exhibiting it.
const GUIDANCE_ECHO_LINE_PREFIXES = ["avoid:", "pacing guidance:"];
function stripGuidanceEchoLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !GUIDANCE_ECHO_LINE_PREFIXES.some((prefix) => line.trim().startsWith(prefix)))
    .join("\n");
}
function textExcludingAvoidLines(input: EvaluationInput): string {
  return stripGuidanceEchoLines(combinedText(input));
}

const CRITERION_CHECKS: Record<EvaluationCriterionId, CriterionCheck> = {
  premise_fulfillment: (input) => {
    const { generatedContent, scenes, intent } = input;
    const complete = generatedContent.length === scenes.length && generatedContent.every((g) => g.text.trim().length > 0);
    const scaleOk = intent.storyScale !== "transformation" || scenes.length > 1;
    const passed = complete && scaleOk;
    return {
      passed,
      explanation: passed
        ? "Every planned scene was produced, and the resolution scale matches the planned story scale."
        : !complete
          ? "Generated content does not cover every planned scene."
          : "A transformation-scale story was resolved in a single scene, which does not match its promised scale.",
    };
  },

  story_movement: (input) => {
    const { startingPoint, endingState } = input.storyBlueprint.trajectory;
    const passed =
      startingPoint.trim().length > 0 &&
      endingState.trim().length > 0 &&
      startingPoint.trim().toLowerCase() !== endingState.trim().toLowerCase();
    return {
      passed,
      explanation: passed
        ? "The starting point and ending state describe distinct states -- something changes."
        : "The starting point and ending state are missing or identical -- nothing changes.",
    };
  },

  character_development: (input) => {
    const { desire, need, internalConflict } = input.storyBlueprint.protagonist;
    const allPresent = [desire, need, internalConflict].every((field) => field.trim().length > 0);
    const distinct = desire.trim().toLowerCase() !== need.trim().toLowerCase();
    const passed = allPresent && distinct;
    return {
      passed,
      explanation: passed
        ? "The protagonist has a distinct desire, need, and internal conflict to act from."
        : "The protagonist's desire, need, or internal conflict is missing or interchangeable.",
    };
  },

  scene_purpose: (input) => {
    const { scenes } = input;
    const allPresent = scenes.every((scene) => scene.purpose.trim().length > 0);
    const purposes = scenes.map((scene) => scene.purpose.trim().toLowerCase());
    const allUnique = new Set(purposes).size === purposes.length;
    const passed = allPresent && allUnique;
    return {
      passed,
      explanation: passed
        ? "Every scene has its own, non-duplicated purpose."
        : "At least one scene has no purpose, or shares its purpose with another scene.",
    };
  },

  trust_the_reader: (input) => {
    const text = combinedText(input);
    const matches = STOCK_EXPLANATORY_PHRASES.filter((phrase) => text.includes(phrase));
    const passed = matches.length === 0;
    return {
      passed,
      explanation: passed
        ? "Generated text does not lean on stock explanatory phrases."
        : `Generated text contains stock explanatory phrasing: ${matches.join(", ")}.`,
    };
  },

  ai_writing_patterns: (input) => {
    const module = findModule(input.context, "avoid_ai_writing_patterns");
    const antiPatterns = module?.antiPatterns ?? [];
    // context.guidance.evaluation carries the evaluation-stage knowledge
    // statements the Context Builder already resolved for this preset --
    // surfaced here for transparency, not used as a second match source.
    const evaluationKnowledgeCount = input.context.guidance.evaluation.length;
    // Scene/guidance "avoidPatterns" lists (and the Writer Layer's
    // deterministic placeholder text, which echoes them on an "Avoid: ..."
    // line to prove it consumed its guidance) legitimately *name* these
    // anti-patterns without exhibiting them -- strip that line before
    // matching so naming a pattern isn't scored as committing it.
    const text = combinedText(input)
      .split("\n")
      .filter((line) => !line.trim().startsWith("avoid:"))
      .join("\n");
    const matches = antiPatterns.filter((pattern) => text.includes(pattern.toLowerCase()));
    const passed = matches.length === 0;
    return {
      passed,
      explanation: passed
        ? `Generated text does not match any of the ${antiPatterns.length} applicable AI-writing anti-pattern(s) (${evaluationKnowledgeCount} evaluation-stage knowledge statement(s) considered).`
        : `Generated text matches applicable AI-writing anti-patterns: ${matches.join("; ")}.`,
    };
  },

  ending_quality: (input) => {
    const { endingState } = input.storyBlueprint.trajectory;
    const text = combinedText(input);
    const hasEnding = endingState.trim().length > 0;
    const hasStockMoral = STOCK_MORAL_PHRASES.some((phrase) => text.includes(phrase));
    const passed = hasEnding && !hasStockMoral;
    return {
      passed,
      explanation: passed
        ? "The ending state is defined and the text does not state a manufactured moral."
        : !hasEnding
          ? "No ending state is defined for this experience."
          : "Generated text states a moral directly instead of letting the ending pay off.",
    };
  },

  sensory_quality: (input) => {
    const { guidance, generatedContent } = input;
    const guidancePresent = guidance.length > 0 && guidance.every((g) => g.descriptionGuidance.trim().length > 0);
    const lengths = generatedContent.map((g) => g.text.length);
    const minLength = lengths.length > 0 ? Math.min(...lengths) : 0;
    const consistent = minLength > 0 && Math.max(...lengths) <= minLength * 4;
    const passed = guidancePresent && consistent;
    return {
      passed,
      explanation: passed
        ? "Sensory description guidance is present and segment lengths are consistent."
        : "Sensory description guidance is missing for a segment, or segment lengths vary too widely.",
    };
  },

  sleep_atmosphere_and_safety: (input) => {
    const { intent, storyBlueprint } = input;
    const hasEmotionalDirection = (intent.emotionalDirection?.length ?? 0) > 0;
    const hasEndingState = storyBlueprint.emotionalArc.end.trim().length > 0;
    const text = textExcludingAvoidLines(input);
    const distressMatches = SLEEP_STORY_DISTRESS_PHRASES.filter((phrase) => text.includes(phrase));
    const passed = hasEmotionalDirection && hasEndingState && distressMatches.length === 0;
    return {
      passed,
      explanation: passed
        ? "An emotional direction and a settled emotional end state are both defined, and the text does not break the comfort baseline with fear or distress."
        : !hasEmotionalDirection || !hasEndingState
          ? "No emotional direction or emotional end state is defined for a calm transition to sleep."
          : `Generated text breaks the comfort baseline with fear or distress: ${distressMatches.join(", ")}.`,
    };
  },

  movement_without_urgency: (input) => {
    const text = textExcludingAvoidLines(input);
    const matches = SLEEP_STORY_URGENCY_PHRASES.filter((phrase) => text.includes(phrase));
    const passed = matches.length === 0;
    return {
      passed,
      explanation: passed
        ? "The story moves through gentle curiosity rather than urgency, danger, or unresolved tension."
        : `Generated text relies on urgency, danger, or unresolved tension to move the story forward: ${matches.join(", ")}.`,
    };
  },

  sleep_transition_arc: (input) => {
    const { lastScene, lastText } = lastSceneInOrder(input);
    const decelerates = lastScene ? /rest|settl|closure|sleep|quiet/i.test(`${lastScene.narrativeFunction} ${lastScene.relatedStoryProgression}`) : false;
    const noveltyMatches = SLEEP_STORY_LATE_NOVELTY_PHRASES.filter((phrase) => lastText.includes(phrase));
    const activeMatches = SLEEP_STORY_ACTIVE_FINAL_PHRASES.filter((phrase) => lastText.includes(phrase));
    const matches = [...noveltyMatches, ...activeMatches];
    const passed = decelerates && matches.length === 0;
    return {
      passed,
      explanation: passed
        ? "The final scene is a settling/rest stage and its text avoids late novelty or an active final beat."
        : !decelerates
          ? "The final planned scene is not a settling/rest stage, so pacing does not decelerate toward sleep."
          : `The final scene's text introduces late novelty or an active final beat: ${matches.join(", ")}.`,
    };
  },

  peaceful_non_demanding_endings: (input) => {
    const { lastText } = lastSceneInOrder(input);
    const trimmedLastText = lastText.trim();
    const hookMatches = SLEEP_STORY_ENDING_HOOK_PHRASES.filter((phrase) => lastText.includes(phrase));
    const moralMatches = STOCK_MORAL_PHRASES.filter((phrase) => lastText.includes(phrase));
    const matches = [...hookMatches, ...moralMatches];
    const hasLiteralEllipsis = endsWithLiteralEllipsis(trimmedLastText);
    const hasIncompleteSentence = endsWithIncompleteSentence(trimmedLastText);
    const passed = matches.length === 0 && !hasLiteralEllipsis && !hasIncompleteSentence;
    return {
      passed,
      explanation: passed
        ? "The final scene closes on a complete, settled sentence -- no twist, revelation, punchline, stated moral, literal ellipsis, or unfinished sentence."
        : hasLiteralEllipsis
          ? "The final scene's text closes with a literal ellipsis instead of a complete, settled sentence."
          : hasIncompleteSentence
            ? "The final scene's text ends without terminal punctuation, reading as an unfinished sentence rather than a complete close."
            : `The final scene's text contains a twist, revelation, punchline, or stated moral: ${matches.join(", ")}.`,
    };
  },

  companions_as_warmth: (input) => {
    const text = textExcludingAvoidLines(input);
    const matches = SLEEP_STORY_COMPANION_CONFLICT_PHRASES.filter((phrase) => text.includes(phrase));
    const passed = matches.length === 0;
    return {
      passed,
      explanation: passed
        ? "Companions provide gentle, low-conflict presence rather than driving plot through conflict, dependency, or rescue."
        : `Generated text frames a companion through conflict, dependency, or rescue: ${matches.join(", ")}.`,
    };
  },

  guided_clarity: (input) => {
    const { guidance } = input;
    const passed = guidance.length > 0 && guidance.every((g) => g.pacingGuidance.trim().length > 0 && g.characterGuidance.trim().length > 0);
    return {
      passed,
      explanation: passed
        ? "Pacing and listener guidance are defined for every part of the session."
        : "Pacing or listener guidance is missing for at least one part of the session.",
    };
  },

  child_perspective: (input) => {
    const { initialState, desire } = input.storyBlueprint.protagonist;
    const hasChildFraming = /curious|discover|wonder|explore/i.test(`${initialState} ${desire}`);
    const text = combinedText(input);
    const matches = ADULT_REFLECTION_PHRASES.filter((phrase) => text.includes(phrase));
    const passed = hasChildFraming && matches.length === 0;
    return {
      passed,
      explanation: passed
        ? "The protagonist is framed through child-like curiosity and the text avoids adult reflection."
        : !hasChildFraming
          ? "The protagonist's initial state and desire are not framed through a child's curiosity."
          : `Generated text contains adult-reflection phrasing: ${matches.join(", ")}.`,
    };
  },

  // Shared id across the Kids Story and meditation criteria (see
  // criteria.ts) -- getApplicableCriteria() only ever surfaces one of the
  // two definitions per preset, so this branches on intent.preset rather
  // than defining a second Record entry (which TypeScript would reject as
  // a duplicate key). The kids-story branch is unchanged from before this
  // task.
  emotional_safety: (input) => {
    if (input.intent.preset === "kids-story") {
      const { storyBlueprint } = input;
      const endsCalm = /calm|safe|secure|sleep|peace/i.test(storyBlueprint.emotionalArc.end);
      const text = combinedText(input);
      const matches = UNSAFE_CONTENT_PHRASES.filter((phrase) => text.includes(phrase));
      const passed = endsCalm && matches.length === 0;
      return {
        passed,
        explanation: passed
          ? "The emotional arc settles into a calm, secure ending and the text avoids frightening content."
          : !endsCalm
            ? "The emotional arc's ending state does not describe a calm, secure resolution."
            : `Generated text contains unsafe content for a child listener: ${matches.join(", ")}.`,
      };
    }

    const { guidance } = input;
    const gentlePacing = guidance.length > 0 && guidance.every((g) => g.pacingGuidance.trim().length > 0);
    const text = textExcludingAvoidLines(input);
    const overwhelmingMatches = MEDITATION_OVERWHELMING_PHRASES.filter((phrase) => text.includes(phrase));
    const guaranteedMatches = MEDITATION_GUARANTEED_OUTCOME_PHRASES.filter((phrase) => text.includes(phrase));
    const unsafeMatches = [...overwhelmingMatches, ...guaranteedMatches];
    const passed = gentlePacing && unsafeMatches.length === 0;
    return {
      passed,
      explanation: passed
        ? "Pacing stays gentle and the text avoids overwhelming emotional instructions or guaranteed-outcome claims."
        : !gentlePacing
          ? "Pacing guidance is missing for at least one part of the session, risking an unsafe pace."
          : `Generated text contains unsafe emotional framing for a meditation listener: ${unsafeMatches.join(", ")}.`,
    };
  },

  gentle_wonder: (input) => {
    const text = combinedText(input);
    const matches = EPIC_FANTASY_PHRASES.filter((phrase) => text.includes(phrase));
    const passed = matches.length === 0;
    return {
      passed,
      explanation: passed
        ? "The story's sense of wonder stays small and everyday rather than escalating into epic-fantasy stakes."
        : `Generated text escalates into epic-fantasy stakes: ${matches.join(", ")}.`,
    };
  },

  warmth_and_belonging: (input) => {
    const { need, externalGoal } = input.storyBlueprint.protagonist;
    const hasBelongingFraming = /friend|belong|together|connect/i.test(`${need} ${externalGoal}`);
    const text = combinedText(input);
    const matches = ISOLATED_ACHIEVEMENT_PHRASES.filter((phrase) => text.includes(phrase));
    const passed = hasBelongingFraming && matches.length === 0;
    return {
      passed,
      explanation: passed
        ? "The protagonist's need and goal are framed around connection, and the resolution avoids isolated-achievement framing."
        : !hasBelongingFraming
          ? "The protagonist's need and external goal are not framed around friendship or belonging."
          : `Generated text frames the resolution as isolated achievement: ${matches.join(", ")}.`,
    };
  },

  guidance_clarity: (input) => {
    const { guidance } = input;
    const hasGuidance = guidance.length > 0;
    const clear =
      hasGuidance &&
      guidance.every(
        (g) => g.writingFocus.trim().length > 0 && g.narrativeIntent.trim().length > 0 && g.pacingGuidance.trim().length > 0
      );
    const practiceOriented =
      hasGuidance && guidance.every((g) => /listener|practice|attention|awareness|breath|body/i.test(`${g.characterGuidance} ${g.descriptionGuidance}`));
    const text = textExcludingAvoidLines(input);
    const vagueMatches = MEDITATION_VAGUE_POETIC_PHRASES.filter((phrase) => text.includes(phrase));
    const passed = clear && practiceOriented && vagueMatches.length === 0;
    return {
      passed,
      explanation: passed
        ? "Guidance is clear, practice-oriented, and the text avoids vague poetic language without function."
        : !clear
          ? "Writing focus, narrative intent, or pacing guidance is missing for at least one part of the session."
          : !practiceOriented
            ? "Guidance does not clearly orient the listener toward the practice."
            : `Generated text leans on vague poetic language without function: ${vagueMatches.join(", ")}.`,
    };
  },

  attention_progression: (input) => {
    const { scenes } = input;
    const labels = scenes
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((scene) => `${scene.narrativeFunction} ${scene.relatedStoryProgression}`.toLowerCase());
    const stages = [
      { name: "arrival", pattern: /arriv|settl/i, required: true },
      { name: "focus", pattern: /anchor|attention|breath|focus|body/i, required: true },
      { name: "deepening", pattern: /deepen/i, required: false },
      { name: "integration", pattern: /integrat/i, required: false },
      { name: "return", pattern: /return/i, required: true },
    ];
    const found = stages.map((stage) => ({ ...stage, index: labels.findIndex((label) => stage.pattern.test(label)) }));
    const missingRequired = found.filter((stage) => stage.required && stage.index === -1);
    const present = found.filter((stage) => stage.index !== -1);
    const inOrder = present.every((stage, i) => i === 0 || stage.index >= present[i - 1].index);
    const passed = missingRequired.length === 0 && inOrder;
    return {
      passed,
      explanation: passed
        ? "Attention moves intentionally through arrival, focus, and a gentle return, with any deepening or integration stage in order."
        : missingRequired.length > 0
          ? `The planned scenes are missing a required attention stage: ${missingRequired.map((s) => s.name).join(", ")}.`
          : "The planned scenes' attention stages are out of order rather than progressing intentionally.",
    };
  },

  non_judgmental_language: (input) => {
    const text = textExcludingAvoidLines(input);
    const commandingMatches = MEDITATION_COMMANDING_PHRASES.filter((phrase) => text.includes(phrase));
    const failureMatches = MEDITATION_FAILURE_FRAMING_PHRASES.filter((phrase) => text.includes(phrase));
    const matches = [...commandingMatches, ...failureMatches];
    const passed = matches.length === 0;
    return {
      passed,
      explanation: passed
        ? "Generated text invites and accepts rather than commanding or framing the listener's experience as failure."
        : `Generated text contains commanding or failure-framing language: ${matches.join(", ")}.`,
    };
  },

  embodiment_and_presence: (input) => {
    const text = textExcludingAvoidLines(input);
    const hasBreath = MEDITATION_BREATH_KEYWORDS.test(text);
    const hasBody = MEDITATION_BODY_KEYWORDS.test(text);
    const hasSensoryPresence = MEDITATION_SENSORY_PRESENCE_KEYWORDS.test(text);
    const groundedCount = [hasBreath, hasBody, hasSensoryPresence].filter(Boolean).length;
    const fantasyMatches = MEDITATION_FANTASY_NARRATIVE_PHRASES.filter((phrase) => text.includes(phrase));
    // Not every meditation experience type is a breath/body practice --
    // self-compassion, morning/evening presence, and guided imagery ground
    // attention through noticing/sensory presence rather than breath or
    // body specifically (intent.meditationExperienceType, intent/
    // classifiers.ts classifyMeditationExperienceType). Requiring 2 of 3
    // regardless of type penalized those legitimate experiences for not
    // being a breath/body practice they were never meant to be; the types
    // actually built around breath/body/sleep keep the stricter threshold.
    const embodimentFocusedTypes: ReadonlySet<string> = new Set([
      "breath_presence",
      "body_relaxation",
      "stress_release",
      "sleep_oriented",
    ]);
    const requiredGroundedCount =
      input.intent.preset === "meditation" &&
      input.intent.meditationExperienceType !== undefined &&
      !embodimentFocusedTypes.has(input.intent.meditationExperienceType)
        ? 1
        : 2;
    const passed = groundedCount >= requiredGroundedCount && fantasyMatches.length === 0;
    return {
      passed,
      explanation: passed
        ? "Generated text grounds attention in breath, body, and sensory presence rather than an external fantasy narrative."
        : groundedCount < 2
          ? "Generated text does not sufficiently ground attention in breath, body, or sensory presence."
          : `Generated text leads with an external fantasy narrative instead of present-moment awareness: ${fantasyMatches.join(", ")}.`,
    };
  },

  pacing_quality: (input) => {
    const { guidance } = input;
    const pacingPresent = guidance.length > 0 && guidance.every((g) => g.pacingGuidance.trim().length > 0);
    const spacious = pacingPresent && guidance.every((g) => MEDITATION_SPACIOUS_PACING_KEYWORDS.test(g.pacingGuidance));
    const text = textExcludingAvoidLines(input);
    const rushedMatches = MEDITATION_RUSHED_PHRASES.filter((phrase) => text.includes(phrase));
    const sequentialMarkerCount = countSequentialMarkers(text);
    const overusesSequentialMarkers = sequentialMarkerCount > MEDITATION_SEQUENTIAL_MARKER_MAX_COUNT;
    const passed = pacingPresent && spacious && rushedMatches.length === 0 && !overusesSequentialMarkers;
    return {
      passed,
      explanation: passed
        ? "Pacing guidance calls for spacious, gradual transitions and the text avoids rushed sequences or overused step markers."
        : !pacingPresent
          ? "Pacing guidance is missing for at least one part of the session."
          : !spacious
            ? "Pacing guidance does not call for spacious or gradual transitions."
            : rushedMatches.length > 0
              ? `Generated text contains rushed sequences: ${rushedMatches.join(", ")}.`
              : `Generated text over-relies on announced step markers between instructions (${sequentialMarkerCount} uses), making pacing feel sequential rather than continuous.`,
    };
  },

  age_appropriate_imagination: (input) => {
    const { intent } = input;
    const hasAgeSafety = intent.constraints.some((constraint) => /age[- ]safe/i.test(constraint));
    const hasPositiveResolution = (intent.requiredElements ?? []).some((element) =>
      /safe_resolution|positive_resolution/.test(element)
    );
    const passed = hasAgeSafety && hasPositiveResolution;
    return {
      passed,
      explanation: passed
        ? "Age-safety constraints and a positive/safe resolution requirement are both present."
        : "Age-safety constraints or a positive/safe resolution requirement are missing from the intent.",
    };
  },

  sensory_presence: (input) => {
    const { guidance, intent } = input;
    const concrete =
      guidance.length > 0 && guidance.every((g) => /sensory|voice|whisper|breath|rhythm|tone|perceive|notice|sensation/i.test(g.descriptionGuidance));
    const text = textExcludingAvoidLines(input);
    // RP-011C.8.8.3N: classic-asmr + story legitimately builds attention
    // through a persona/scenario and gentle narrative movement (see
    // guidance/templates.ts CLASSIC_ASMR_STORY_GUIDANCE_TEMPLATE and
    // scenes/templates.ts CLASSIC_ASMR_STORY_SCENE_STEPS) -- only presence
    // mode, which has no scene or persona at all, treats any narrative-arc
    // phrasing as drift away from sensory attention. External sound/object
    // triggers stay out of bounds in both modes (RP-011C.8.8.3G): SoftVibe
    // Classic ASMR is voice-first regardless of asmrMode.
    const narrativeMatches =
      intent.asmrMode === "story" ? [] : ASMR_NARRATIVE_DRIFT_PHRASES.filter((phrase) => text.includes(phrase));
    const triggerMatches = ASMR_EXTERNAL_TRIGGER_PHRASES.filter((phrase) => text.includes(phrase));
    const matches = [...narrativeMatches, ...triggerMatches];
    const passed = concrete && matches.length === 0;
    return {
      passed,
      explanation: passed
        ? "Description guidance stays concrete and perceivable, and generated text avoids building a narrative arc or external sound/object triggers around the sensory moment."
        : !concrete
          ? "Description guidance does not stay concrete and perceivable for at least one part of the session."
          : `Generated text drifts toward a narrative arc or external sound/object trigger instead of voice-based sensory attention: ${matches.join(", ")}.`,
    };
  },

  gentle_rhythm: (input) => {
    const { guidance } = input;
    const slowAndGentle = guidance.length > 0 && guidance.every((g) => /slow|gentle|unhurried|repetit|gradual/i.test(g.pacingGuidance));
    const text = textExcludingAvoidLines(input);
    const matches = ASMR_RUSHED_PHRASES.filter((phrase) => text.includes(phrase));
    const passed = slowAndGentle && matches.length === 0;
    return {
      passed,
      explanation: passed
        ? "Pacing guidance calls for a slow, unhurried, repetitive flow, and generated text does not accelerate toward a climax."
        : !slowAndGentle
          ? "Pacing guidance does not call for a slow, unhurried, repetitive flow for at least one part of the session."
          : `Generated text accelerates toward a climax or payoff: ${matches.join(", ")}.`,
    };
  },

  safe_personal_address: (input) => {
    const { guidance, intent } = input;
    const directAddress = guidance.length > 0 && guidance.every((g) => /listener/i.test(g.characterGuidance) && /address|directly/i.test(g.characterGuidance));
    const text = textExcludingAvoidLines(input);
    // RP-011C.8.8.3N: classic-asmr + story's guidance explicitly allows
    // "low-stakes dialogue with the persona" (guidance/templates.ts
    // CLASSIC_ASMR_STORY_GUIDANCE_TEMPLATE) -- only presence mode, which has
    // no persona at all, treats dialogue-tag phrasing as a fictional-
    // character violation. Intrusive, response-demanding address stays out
    // of bounds in both modes -- that safety concern doesn't depend on
    // whether dialogue is otherwise allowed.
    const dialogueMatches =
      intent.asmrMode === "story" ? [] : ASMR_CHARACTER_DIALOGUE_PHRASES.filter((phrase) => text.includes(phrase));
    const intrusiveMatches = ASMR_INTRUSIVE_ADDRESS_PHRASES.filter((phrase) => text.includes(phrase));
    const matches = [...dialogueMatches, ...intrusiveMatches];
    const passed = directAddress && matches.length === 0;
    return {
      passed,
      explanation: passed
        ? "Guidance addresses the listener directly, and generated text avoids fictional character dialogue or intrusive framing."
        : !directAddress
          ? "Character guidance does not clearly address the listener directly for at least one part of the session."
          : `Generated text contains fictional dialogue or intrusive framing: ${matches.join(", ")}.`,
    };
  },

  sensory_detail_balance: (input) => {
    const text = textExcludingAvoidLines(input);
    const matches = ASMR_DECORATIVE_FANTASY_PHRASES.filter((phrase) => text.includes(phrase));
    const passed = matches.length === 0;
    return {
      passed,
      explanation: passed
        ? "Generated text uses meaningful, perceivable sensory detail rather than decorative or fantasy description."
        : `Generated text leans on decorative or fantasy description: ${matches.join(", ")}.`,
    };
  },

  calming_repetition: (input) => {
    const { scenes, intent, guidance } = input;
    const text = textExcludingAvoidLines(input);
    const fillerMatches = ASMR_REDUNDANT_FILLER_PHRASES.filter((phrase) => text.includes(phrase));

    // RP-011C.7 targeted fix: the tension branch (CLASSIC_ASMR_TENSION_STORY_
    // SCENE_STEPS) trades a literal repetition/variation beat for a real
    // clue -> complication -> escalation -> reveal progression -- there is
    // no stable, recurring stage to check for, by design (see that
    // template's own rationale in scenes/templates.ts). Calming there comes
    // from voice-first, controlled, unhurried delivery held constant across
    // the mystery's development, not from a repeated sensory beat -- so this
    // checks that pacing guidance actually calls for that instead of
    // requiring a repetition/variation stage pair that would never exist in
    // this branch's scene shape.
    if (intent.asmrMode === "story" && intent.asmrNarrativeTension) {
      const controlledPacing =
        guidance.length > 0 && guidance.every((g) => /slow|gentle|unhurried|controlled/i.test(g.pacingGuidance));
      const passed = controlledPacing && fillerMatches.length === 0;
      return {
        passed,
        explanation: passed
          ? "Pacing guidance calls for controlled, unhurried delivery held constant through the mystery's development, and generated text does not read as redundant filler."
          : !controlledPacing
            ? "Pacing guidance does not call for controlled, unhurried delivery for at least one part of the session."
            : `Generated text reads as redundant filler rather than intentional repetition: ${fillerMatches.join(", ")}.`,
      };
    }

    const labels = scenes.map((scene) => `${scene.narrativeFunction} ${scene.relatedStoryProgression}`.toLowerCase());
    // RP-011C.8.8.3N: classic-asmr + story carries the same repetition ->
    // gentle-variation shape through different stage names (see
    // scenes/templates.ts CLASSIC_ASMR_STORY_SCENE_STEPS): "Persona framing"
    // is the stable, recurring element story mode settles into, and
    // "Narrative sensory movement" is its gentle-variation stage (layering
    // new sensory detail, never a new event) -- presence mode's literal
    // "repetition"/"variation" labels don't exist in story mode's scene
    // shape, so this criterion looks for the mode-appropriate stage names.
    const repetitionPattern = intent.asmrMode === "story" ? /persona|repetit|rhythm/i : /repetit|rhythm/i;
    const variationPattern = intent.asmrMode === "story" ? /variation|vary|movement/i : /variation|vary/i;
    const hasRepetitionStage = labels.some((label) => repetitionPattern.test(label));
    const hasVariationStage = labels.some((label) => variationPattern.test(label));
    const passed = hasRepetitionStage && hasVariationStage && fillerMatches.length === 0;
    return {
      passed,
      explanation: passed
        ? "The planned scenes pair a rhythmic-repetition stage with a gentle-variation stage, and generated text does not read as redundant filler."
        : !hasRepetitionStage
          ? "The planned scenes do not include a rhythmic-repetition stage."
          : !hasVariationStage
            ? "The planned scenes include repetition but no gentle-variation stage, risking identical restatement."
            : `Generated text reads as redundant filler rather than intentional repetition: ${fillerMatches.join(", ")}.`,
    };
  },

  no_forced_response: (input) => {
    const text = textExcludingAvoidLines(input);
    const outcomeMatches = ASMR_FORCED_OUTCOME_PHRASES.filter((phrase) => text.includes(phrase));
    const failureMatches = ASMR_RESPONSE_FAILURE_FRAMING_PHRASES.filter((phrase) => text.includes(phrase));
    const matches = [...outcomeMatches, ...failureMatches];
    const passed = matches.length === 0;
    return {
      passed,
      explanation: passed
        ? "Generated text does not claim a guaranteed response and does not frame the listener's lack of response as a failure."
        : `Generated text claims a guaranteed response or frames a lack of response as failure: ${matches.join(", ")}.`,
    };
  },

  // RP-011C.7 targeted fix -- see criteria.ts for why this is deliberately a
  // structural (planning-level) check only, not a prose-analysis check.
  narrative_tension_fulfillment: (input) => {
    const { intent, scenes } = input;
    if (!intent.asmrNarrativeTension) {
      return {
        passed: true,
        explanation: "No narrative tension was explicitly requested, so this check does not apply.",
      };
    }
    const labels = scenes.map((scene) => `${scene.narrativeFunction} ${scene.relatedStoryProgression}`.toLowerCase());
    const hasComplicationStage = labels.some((label) => /clue|complication|deepen|uncertain/i.test(label));
    const hasRevealStage = labels.some((label) => /reveal|payoff|resolution|discovery|escalation/i.test(label));
    const passed = hasComplicationStage && hasRevealStage;
    return {
      passed,
      explanation: passed
        ? "Narrative tension was explicitly requested, and the planned scenes include both a complication/clue stage and a reveal/payoff stage."
        : "Narrative tension was explicitly requested, but the planned scenes do not include both a complication/clue stage and a reveal/payoff stage.",
    };
  },
};

function scoreCriterion(definition: EvaluationCriterionDefinition, input: EvaluationInput): CriteriaResult {
  const { passed, explanation } = CRITERION_CHECKS[definition.id](input);
  return {
    criterionId: definition.id,
    score: passed ? 1 : 0,
    passed,
    explanation,
  };
}

function resolveOverallAssessment(passRate: number): OverallAssessment {
  if (passRate === 1) return "strong";
  if (passRate >= 0.75) return "acceptable";
  if (passRate >= 0.5) return "needs-work";
  return "weak";
}

// evaluateNarrative() only reads its inputs -- it returns a judgment, it
// never rewrites, repairs, or regenerates generatedContent (or any other
// input). That is the boundary with the future Repair / Rewrite Layer.
export const evaluateNarrative: NarrativeEvaluator = (input: EvaluationInput): EvaluationResult => {
  const definitions = getApplicableCriteria(input.intent.preset);
  const criteriaResults = definitions.map((definition) => scoreCriterion(definition, input));

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const violations: string[] = [];
  const suggestions: string[] = [];

  definitions.forEach((definition, index) => {
    const result = criteriaResults[index];
    const entry = `${definition.name}: ${result.explanation}`;
    if (result.passed) {
      strengths.push(entry);
      return;
    }
    if (definition.severity === "violation") {
      violations.push(entry);
    } else {
      weaknesses.push(entry);
    }
    suggestions.push(`${definition.name}: ${definition.suggestion}`);
  });

  const overallScore = criteriaResults.reduce((sum, result) => sum + result.score, 0) / (criteriaResults.length || 1);

  return {
    overallAssessment: resolveOverallAssessment(overallScore),
    overallScore,
    criteriaResults,
    strengths,
    weaknesses,
    violations,
    suggestions,
    metadata: {
      createdAt: input.createdAt ?? new Date().toISOString(),
      version: EVALUATOR_VERSION,
      evaluatorMethod: "deterministic-structural",
    },
  };
};
