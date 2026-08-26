// lib/creative-intelligence/intent/classifiers.ts
//
// Deterministic, keyword-based classifiers used by extractor.ts. Each
// function answers one narrow question about the raw prompt ("what preset
// is implied?", "what themes are present?") using substring matching only
// -- no LLM calls, no scene/prose generation, no knowledge-registry
// lookups. Swappable later for a model-based implementation without
// changing extractor.ts's shape.

import { CREATIVE_PRESETS } from "../core/constants";
import type {
  ClassicAsmrMode,
  CreativeAudience,
  CreativePerspective,
  CreativePreset,
  MeditationExperienceType,
  StoryScale,
} from "../core/constants";
import type { ExtractionSignals } from "./types";

function includesAny(promptLower: string, phrases: string[]): boolean {
  return phrases.some((phrase) => promptLower.includes(phrase));
}

// ---------------------------------------------------------------------------
// Preset
// ---------------------------------------------------------------------------

const PRESET_KEYWORDS: Record<CreativePreset, string[]> = {
  "classic-asmr": ["asmr", "tingles", "whisper", "soft spoken"],
  "sleep-story": ["sleep story", "bedtime story", "fall asleep", "bedtime"],
  meditation: ["meditation", "meditate", "mindfulness", "breathing exercise"],
  "kids-story": ["kids story", "children's story", "for kids", "for children"],
  narrative: [],
};

export function classifyPreset(signals: ExtractionSignals): CreativePreset {
  const hint = signals.raw.presetHint;
  if (hint && (CREATIVE_PRESETS as readonly string[]).includes(hint)) {
    return hint as CreativePreset;
  }
  for (const preset of CREATIVE_PRESETS) {
    if (includesAny(signals.promptLower, PRESET_KEYWORDS[preset])) return preset;
  }
  return "narrative";
}

// ---------------------------------------------------------------------------
// Classic ASMR mode (secondary intent axis, classic-asmr only)
// ---------------------------------------------------------------------------
//
// Only meaningful once preset === "classic-asmr". Distinguishes a wordless
// sensory-presence request from one that explicitly wants a story told in
// an ASMR voice. Defaults to "presence" when no story signal is present.

const ASMR_STORY_SIGNALS = [
  "story",
  "tell me a story",
  "read me",
  "roleplay",
  "pretend",
  "as a ",
  "character",
];

// Concrete ASMR scenario signals -- independent of the narrow story-keyword
// list above. A request can ask for another presence/persona/activity/
// context (a companion showing up, a personal-attention framing, a role the
// listener is placed opposite, a named activity) without ever using a
// "story" word. That's still a request for the scenario-capable branch, not
// generic sensory presence, so classifyAsmrMode treats either signal set as
// sufficient. Defined here (rather than down by classifyCreativeDirection)
// since it's now shared by both.
const ASMR_COMPANION_SIGNALS = [
  "friend",
  "companion",
  "someone who",
  "partner",
  "boyfriend",
  "girlfriend",
];

const ASMR_PERSONAL_ATTENTION_SIGNALS = [
  "personal attention",
  "attention session",
  "takes care of you",
  "looks after you",
  "pampers you",
];

const ASMR_ROLE_PERSONA_SIGNALS = ["roleplay", "role play", "pretend", "as a ", "character", "persona"];

const ASMR_ACTIVITY_SIGNALS = [
  "reads to you",
  "reads you",
  "reads to me",
  "brush",
  "haircut",
  "massage",
  "spa",
  "exam",
  "checkup",
  "check-up",
  "makeover",
];

// Atmospheric/scenario signals: a setting or premise the ASMR voice is
// narrating within (a mystery unfolding by candlelight, a hidden discovery),
// as opposed to a bare sensory-presence request. classifyAsmrMode only
// consults this list once preset === "classic-asmr" is already established
// (see the guard at the top of that function), so these words never push a
// prompt into ASMR on their own -- "write a mysterious story" stays
// "narrative" because none of the ASMR preset keywords match first.
const ASMR_ATMOSPHERIC_SCENARIO_SIGNALS = [
  "mystery",
  "mysterious",
  "secret",
  "candlelight",
  "hidden",
  "ancient",
  "magical",
  "adventure",
  "journey",
  "explore",
  "detective",
];

const ASMR_SCENARIO_SIGNALS = [
  ...ASMR_COMPANION_SIGNALS,
  ...ASMR_PERSONAL_ATTENTION_SIGNALS,
  ...ASMR_ROLE_PERSONA_SIGNALS,
  ...ASMR_ACTIVITY_SIGNALS,
  ...ASMR_ATMOSPHERIC_SCENARIO_SIGNALS,
];

function hasConcreteAsmrScenario(signals: ExtractionSignals): boolean {
  return includesAny(signals.promptLower, ASMR_SCENARIO_SIGNALS);
}

export function classifyAsmrMode(signals: ExtractionSignals, preset: CreativePreset): ClassicAsmrMode | undefined {
  if (preset !== "classic-asmr") return undefined;
  if (includesAny(signals.promptLower, ASMR_STORY_SIGNALS)) return "story";
  return hasConcreteAsmrScenario(signals) ? "story" : "presence";
}

// ---------------------------------------------------------------------------
// Classic ASMR narrative tension (tertiary intent axis, asmrMode "story" only)
// ---------------------------------------------------------------------------
//
// RP-011C.7 targeted fix (Cutover Readiness): CLASSIC_ASMR_STORY_SCENE_STEPS
// (scenes/templates.ts) is a no-complication, no-payoff comfort progression --
// correct for companion/roleplay/reading scenarios, but wrong for a request
// that explicitly wants a mystery/thriller told in an ASMR voice. This
// distinguishes the two so scenes/planning/guidance can route to a separate
// tension-aware template instead of forcing every story-mode request through
// the same no-complication shape.
//
// Deliberately narrower than ASMR_ATMOSPHERIC_SCENARIO_SIGNALS above: bare
// "secret"/"hidden"/"ancient" already route to asmrMode "story" (a scenario
// exists) without implying the user wants real narrative tension -- "an ASMR
// personal attention session with a soft secret shared between us" should
// stay a companion scenario, not become a thriller. Only explicit
// mystery/thriller/investigation vocabulary, or "uncover/discover" already
// paired with "secret" (matching the CEO-direction example phrasing), counts
// as an unambiguous ask for real narrative tension.
const ASMR_TENSION_SIGNALS = [
  "mystery",
  "mysterious",
  "thriller",
  "suspense",
  "suspenseful",
  "secret investigation",
  "investigate",
  "investigation",
  "investigating",
  "detective",
  "whodunit",
  "sinister",
  "eerie",
  "uncover the secret",
  "uncovering the secret",
  "uncover a secret",
  "uncovering a secret",
  "discover the secret",
  "discovering the secret",
  "discover a secret",
  "discovering a secret",
];

export function classifyAsmrNarrativeTension(
  signals: ExtractionSignals,
  asmrMode: ClassicAsmrMode | undefined
): boolean | undefined {
  if (asmrMode !== "story") return undefined;
  return includesAny(signals.promptLower, ASMR_TENSION_SIGNALS);
}

// ---------------------------------------------------------------------------
// Listener-as-experiencer (preset-independent, refines perspective "first")
// ---------------------------------------------------------------------------
//
// RP-011C.7 targeted fix: classifyPerspective below only detects grammatical
// person ("write this in first person"), which says nothing about *who* the
// resulting "I" is. A request can go further and explicitly make the
// listener themselves the first-person experiencer of the scene ("from my
// perspective", "I am the one uncovering the secret") -- distinct from a
// persona-roleplay request ("you are a librarian speaking to me"), where a
// separate in-scene persona-I addressing the listener as "you" is exactly
// what was asked for. Only an explicit role claim like the phrases below
// counts; a bare "I"/"you" pronoun scan would false-positive on ordinary
// prompt language, same reasoning as classifyPerspective.
const LISTENER_EXPERIENCER_SIGNALS = [
  "from my perspective",
  "from my point of view",
  "as if i am the one",
  "as if i'm the one",
  "i am the one",
  "i'm the one",
  "as the protagonist",
  "i am the protagonist",
  "put me in the story",
  "make me the protagonist",
  "make me the main character",
];

export function classifyListenerIsExperiencer(signals: ExtractionSignals): boolean | undefined {
  return includesAny(signals.promptLower, LISTENER_EXPERIENCER_SIGNALS) ? true : undefined;
}

// ---------------------------------------------------------------------------
// Meditation experience type (secondary intent axis, meditation only)
// ---------------------------------------------------------------------------
//
// Different meditation requests need different planning/guidance -- a
// self-compassion practice, a morning presence practice, and a guided beach
// visualization are not the same experience, even though the pre-existing
// extractor collapsed all of them into the same generic "meditation" preset
// with no further signal. Checked in priority order (most specific/safety-
// relevant first) so an ambiguous prompt resolves to its most salient
// signal rather than the first alphabetically-listed one. Falls back to
// "breath_presence" -- a plain breath/attention meditation -- when no more
// specific signal is present, which is also the pre-existing default shape
// (arrival -> anchor -> deepen -> return) and must stay the control case.

const MEDITATION_SLEEP_ORIENTED_SIGNALS = [
  "fall asleep",
  "falling asleep",
  "meditation for sleep",
  "meditation to sleep",
  "help me sleep",
  "helps you sleep",
  "drift off to sleep",
  "sleep meditation",
];

const MEDITATION_SELF_COMPASSION_SIGNALS = [
  "self-compassion",
  "self compassion",
  "self-kindness",
  "self kindness",
  "loving-kindness",
  "loving kindness",
  "be kind to myself",
  "be gentle with myself",
  "inner critic",
  "self-love",
  "self love",
];

const MEDITATION_STRESS_RELEASE_SIGNALS = [
  "stress release",
  "release stress",
  "stress relief",
  "anxiety relief",
  "anxious",
  "anxiety",
  "overwhelmed",
  "overwhelm",
  "tension release",
  "racing thoughts",
  "calm my nerves",
  "mental overactivation",
];

const MEDITATION_BODY_RELAXATION_SIGNALS = [
  "body scan",
  "body relaxation",
  "progressive relaxation",
  "relax my body",
  "physical relaxation",
  "release tension in my body",
  "release physical tension",
];

const MEDITATION_MORNING_PRESENCE_SIGNALS = [
  "morning meditation",
  "morning presence",
  "start my day",
  "start the day",
  "wake up meditation",
  "waking up",
  "morning routine",
  "energize my morning",
];

const MEDITATION_EVENING_WIND_DOWN_SIGNALS = [
  "evening meditation",
  "wind down",
  "wind-down",
  "end of day",
  "end my day",
  "before bed meditation",
  "night meditation",
  "evening presence",
];

const MEDITATION_GUIDED_IMAGERY_SIGNALS = [
  "visualization",
  "visualisation",
  "guided imagery",
  "guided visualization",
  "picture yourself",
  "imagine you are",
  "imagine yourself",
  "mental journey",
  "take me to a",
  "beach meditation",
  "meadow meditation",
  "forest meditation",
];

const MEDITATION_EXPERIENCE_TYPE_SIGNALS: Array<{ type: MeditationExperienceType; phrases: string[] }> = [
  { type: "sleep_oriented", phrases: MEDITATION_SLEEP_ORIENTED_SIGNALS },
  { type: "self_compassion", phrases: MEDITATION_SELF_COMPASSION_SIGNALS },
  { type: "stress_release", phrases: MEDITATION_STRESS_RELEASE_SIGNALS },
  { type: "body_relaxation", phrases: MEDITATION_BODY_RELAXATION_SIGNALS },
  { type: "morning_presence", phrases: MEDITATION_MORNING_PRESENCE_SIGNALS },
  { type: "evening_wind_down", phrases: MEDITATION_EVENING_WIND_DOWN_SIGNALS },
  { type: "guided_imagery", phrases: MEDITATION_GUIDED_IMAGERY_SIGNALS },
];

export function classifyMeditationExperienceType(
  signals: ExtractionSignals,
  preset: CreativePreset
): MeditationExperienceType | undefined {
  if (preset !== "meditation") return undefined;
  for (const { type, phrases } of MEDITATION_EXPERIENCE_TYPE_SIGNALS) {
    if (includesAny(signals.promptLower, phrases)) return type;
  }
  return "breath_presence";
}

// ---------------------------------------------------------------------------
// Perspective (grammatical person, preset-independent)
// ---------------------------------------------------------------------------
//
// Only matches an explicit, unambiguous request for a specific grammatical
// person (e.g. "write this in first person") -- never a raw pronoun scan
// ("I", "you", "she"), which would false-positive on ordinary prompt
// language ("I want a story about..."). Absence of a match means the user
// expressed no preference; it must never be read as "the user asked for
// second person" or any other default.

const FIRST_PERSON_SIGNALS = [
  "first person",
  "first-person",
  "in the first person",
  "from my perspective",
  "from my point of view",
  "in my own voice",
  "using \"i\"",
  "as \"i\"",
];

const SECOND_PERSON_SIGNALS = [
  "second person",
  "second-person",
  "in the second person",
  "using \"you\"",
  "address me as you",
  "addressing me as you",
];

const THIRD_PERSON_SIGNALS = [
  "third person",
  "third-person",
  "in the third person",
  "using \"he\" or \"she\"",
  "using he or she",
  "using he/she",
];

export function classifyPerspective(signals: ExtractionSignals): CreativePerspective | undefined {
  if (includesAny(signals.promptLower, FIRST_PERSON_SIGNALS)) return "first";
  if (includesAny(signals.promptLower, SECOND_PERSON_SIGNALS)) return "second";
  if (includesAny(signals.promptLower, THIRD_PERSON_SIGNALS)) return "third";
  return undefined;
}

// ---------------------------------------------------------------------------
// Genre
// ---------------------------------------------------------------------------

const GENRE_BY_PRESET: Record<CreativePreset, string> = {
  "classic-asmr": "sensory-comfort",
  "sleep-story": "comfort",
  meditation: "mindfulness",
  "kids-story": "gentle-adventure",
  narrative: "character_drama",
};

const NARRATIVE_GENRE_KEYWORDS: Array<{ genre: string; phrases: string[] }> = [
  { genre: "mystery", phrases: ["mystery", "detective", "clue", "investigat"] },
  { genre: "adventure", phrases: ["adventure", "quest", "expedition"] },
  { genre: "romance", phrases: ["romance", "falls in love", "love story"] },
];

export function classifyGenre(signals: ExtractionSignals, preset: CreativePreset): string {
  if (preset === "narrative") {
    for (const { genre, phrases } of NARRATIVE_GENRE_KEYWORDS) {
      if (includesAny(signals.promptLower, phrases)) return genre;
    }
  }
  return GENRE_BY_PRESET[preset];
}

// ---------------------------------------------------------------------------
// Story scale
// ---------------------------------------------------------------------------

const TRANSFORMATION_KEYWORDS = [
  "leaves behind",
  "leaves his childhood",
  "leaves her childhood",
  "builds his own",
  "builds her own",
  "builds their own",
  "starts his own",
  "starts her own",
  "starts a new life",
  "becomes",
  "transforms",
  "grows into",
  "changes his life",
  "changes her life",
];

const ARC_KEYWORDS = ["journey", "adventure", "quest", "overcomes", "overcoming"];

const STORY_SCALE_DEFAULT_BY_PRESET: Record<CreativePreset, StoryScale> = {
  "classic-asmr": "vignette",
  "sleep-story": "gentle_journey",
  meditation: "gentle_journey",
  "kids-story": "gentle_journey",
  narrative: "arc",
};

export function classifyStoryScale(signals: ExtractionSignals, preset: CreativePreset): StoryScale {
  if (preset === "narrative" || preset === "kids-story") {
    if (includesAny(signals.promptLower, TRANSFORMATION_KEYWORDS)) return "transformation";
    if (includesAny(signals.promptLower, ARC_KEYWORDS)) return "arc";
  }
  return STORY_SCALE_DEFAULT_BY_PRESET[preset];
}

// ---------------------------------------------------------------------------
// Themes + emotional direction
// ---------------------------------------------------------------------------

const THEME_KEYWORDS: Record<string, string[]> = {
  independence: ["independence", "own company", "own business", "on his own", "on her own", "leaves home"],
  growth: ["builds", "growth", "grows", "learns", "develops", "progress"],
  courage: ["brave", "courage", "overcome", "fear"],
  friendship: ["friend", "friendship", "companion", "together"],
  comfort: ["cozy", "comfort", "warm blanket", "gentle"],
  curiosity: ["explore", "discover", "curious", "wonder"],
  safety: ["safe", "protected", "secure"],
  letting_go: ["let go", "leaves behind", "says goodbye"],
};

// Display priority for the final emotionalDirection list (most to least
// prominent). Emotions matched but not listed here are appended in match
// order, so this only needs to cover emotions we actually classify below.
const EMOTION_PRIORITY = ["hopeful", "calm", "safe", "grounded", "warm", "curious", "joyful"];

// Emotions a theme implies even when the emotion's own keywords aren't
// present verbatim (e.g. "independence" reads as "grounded" even without
// the word "grounded" anywhere in the prompt).
const THEME_TO_EMOTIONS: Record<string, string[]> = {
  independence: ["grounded"],
  growth: ["hopeful"],
  courage: ["hopeful"],
  friendship: ["warm"],
  comfort: ["calm", "safe"],
  curiosity: ["curious"],
  safety: ["safe"],
  letting_go: ["grounded"],
};

const EMOTION_KEYWORDS: Record<string, string[]> = {
  calm: ["calm", "relax", "peaceful", "soothing", "sleep", "rest", "bedtime"],
  safe: ["safe", "protected", "secure", "cozy", "bedtime"],
  hopeful: ["hope", "hopeful", "optimis", "dream"],
  grounded: ["grounded", "stable", "steady", "confidence", "confident"],
  warm: ["warm", "tender", "loving"],
  curious: ["curious", "wonder"],
  joyful: ["joy", "happy", "delight", "playful"],
};

const EMOTIONAL_DIRECTION_DEFAULT_BY_PRESET: Record<CreativePreset, string[]> = {
  "classic-asmr": ["calm"],
  "sleep-story": ["calm", "safe"],
  meditation: ["calm"],
  "kids-story": ["warm", "safe"],
  narrative: ["engaged"],
};

export function classifyThemes(signals: ExtractionSignals): string[] {
  return Object.keys(THEME_KEYWORDS).filter((theme) =>
    includesAny(signals.promptLower, THEME_KEYWORDS[theme])
  );
}

export function classifyEmotionalDirection(
  signals: ExtractionSignals,
  preset: CreativePreset,
  themes: string[]
): string[] {
  const matched = new Set<string>();
  for (const emotion of Object.keys(EMOTION_KEYWORDS)) {
    if (includesAny(signals.promptLower, EMOTION_KEYWORDS[emotion])) matched.add(emotion);
  }
  for (const theme of themes) {
    for (const emotion of THEME_TO_EMOTIONS[theme] ?? []) matched.add(emotion);
  }
  if (matched.size === 0) return EMOTIONAL_DIRECTION_DEFAULT_BY_PRESET[preset];
  const prioritized = EMOTION_PRIORITY.filter((emotion) => matched.has(emotion));
  const unlisted = Array.from(matched).filter((emotion) => !EMOTION_PRIORITY.includes(emotion));
  return [...prioritized, ...unlisted];
}

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------

const CHILD_KEYWORDS = ["kid", "kids", "child", "children"];
const TEEN_KEYWORDS = ["teen", "teenager", "teenage"];

export function classifyAudience(signals: ExtractionSignals, preset: CreativePreset): CreativeAudience {
  if (preset === "kids-story") return "child";
  if (includesAny(signals.promptLower, CHILD_KEYWORDS)) return "child";
  if (includesAny(signals.promptLower, TEEN_KEYWORDS)) return "teen";
  if (preset === "narrative") return "adult";
  return "general";
}

// ---------------------------------------------------------------------------
// Narrative focus + required elements
// ---------------------------------------------------------------------------

const NARRATIVE_FOCUS_BY_SCALE: Record<StoryScale, string> = {
  vignette: "sensory_atmosphere",
  gentle_journey: "comfort_and_safety",
  arc: "discovery",
  transformation: "personal_change",
};

const REQUIRED_ELEMENTS_BY_SCALE: Record<StoryScale, string[]> = {
  vignette: ["sensory_detail", "atmosphere"],
  gentle_journey: ["gentle_pacing", "safe_resolution"],
  arc: ["turning_point", "resolution"],
  transformation: ["personal_change", "progression"],
};

export function classifyNarrativeFocus(storyScale: StoryScale): string {
  return NARRATIVE_FOCUS_BY_SCALE[storyScale];
}

export function classifyRequiredElements(storyScale: StoryScale, preset: CreativePreset): string[] {
  const elements = new Set(REQUIRED_ELEMENTS_BY_SCALE[storyScale]);
  if (preset === "kids-story") {
    elements.add("positive_resolution");
    elements.add("age_safe_language");
  }
  return Array.from(elements);
}

// ---------------------------------------------------------------------------
// Constraints
// ---------------------------------------------------------------------------
//
// Hard constraints the output must respect. Kept deterministic: a fixed
// safety constraint for kids-story, plus a few explicit-instruction
// patterns ("no X", "without X", "must include X") pulled straight from
// the prompt text so user intent is never silently dropped.

const NO_PATTERN = /\bno\s+([a-z][a-z\s]{2,40}?)(?=[,.;]|$)/gi;
const WITHOUT_PATTERN = /\bwithout\s+([a-z][a-z\s]{2,40}?)(?=[,.;]|$)/gi;
const MUST_PATTERN = /\bmust\s+(?:include|have|contain)\s+([a-z][a-z\s]{2,40}?)(?=[,.;]|$)/gi;

function matchAll(regex: RegExp, text: string, prefix: string): string[] {
  const results: string[] = [];
  for (const match of text.matchAll(regex)) {
    const captured = match[1]?.trim();
    if (captured) results.push(`${prefix}${captured}`);
  }
  return results;
}

export function classifyConstraints(signals: ExtractionSignals, preset: CreativePreset): string[] {
  const constraints: string[] = [];
  if (preset === "kids-story") {
    constraints.push("age-safe: avoid violence, horror, and existential themes");
  }
  constraints.push(...matchAll(NO_PATTERN, signals.promptLower, "explicit: no "));
  constraints.push(...matchAll(WITHOUT_PATTERN, signals.promptLower, "explicit: without "));
  constraints.push(...matchAll(MUST_PATTERN, signals.promptLower, "explicit: must include "));
  return constraints;
}

// ---------------------------------------------------------------------------
// Tone + experience summary
// ---------------------------------------------------------------------------

const TONE_BY_PRESET: Record<CreativePreset, string> = {
  "classic-asmr": "soothing",
  "sleep-story": "gentle",
  meditation: "centered",
  "kids-story": "warm",
  narrative: "reflective",
};

export function classifyTone(preset: CreativePreset): string {
  return TONE_BY_PRESET[preset];
}

const EXPERIENCE_BY_PRESET: Record<CreativePreset, string> = {
  "classic-asmr": "a calming sensory ASMR experience",
  "sleep-story": "a relaxing bedtime story to help the listener fall asleep",
  meditation: "a guided meditation for calm and centering",
  "kids-story": "a gentle, age-safe bedtime story for children",
  narrative: "an immersive narrative built around the listener's request",
};

export function classifyExperience(preset: CreativePreset, themes: string[]): string {
  const base = EXPERIENCE_BY_PRESET[preset];
  if (themes.length === 0) return base;
  return `${base}, with themes of ${themes.join(", ")}`;
}

// ---------------------------------------------------------------------------
// Creative direction preservation
// ---------------------------------------------------------------------------
//
// Deliberately not extraction: this does not parse personas, relationships,
// scenarios, or activities out of the prompt. It only decides *whether* the
// deterministic fields above are likely to have discarded an explicit
// creative request, and if so, preserves the raw prompt verbatim so a later
// layer (the Writer) can still see it. classic-asmr "presence" requests and
// simple keyword-driven presets have nothing to lose, so they're left alone.
//
// classifyAsmrMode already routes any prompt matching ASMR_SCENARIO_SIGNALS
// (see above) to "story", so isAsmrStory below covers concrete-scenario
// presence prompts too -- no separate scenario check needed here.
//
// sleep-story is included here too: RP-011C.8.10J found concrete user
// scenarios (a valley walk, a snowy-mountain train ride) were being
// discarded before reaching the Writer, which then fell back to generic
// sleep-story defaults regardless of what the user asked for.
//
// meditation and kids-story are included for the same reason: a specific
// meditation experience (e.g. "a guided beach visualization") or a named
// kids-story premise/character had nowhere to go once the deterministic
// preset/theme fields above discarded it, so the Writer only ever saw
// generic preset defaults for these two presets. Both feed the same
// generic "USER CREATIVE DIRECTION" prompt section every other included
// preset already uses (writer/prompts.ts) -- no new mechanism.

export function classifyCreativeDirection(
  signals: ExtractionSignals,
  preset: CreativePreset,
  asmrMode: ClassicAsmrMode | undefined
): string | undefined {
  const isAsmr = preset === "classic-asmr";
  const isAsmrStory = isAsmr && asmrMode === "story";
  const isNarrative = preset === "narrative";
  const isSleepStory = preset === "sleep-story";
  const isMeditation = preset === "meditation";
  const isKidsStory = preset === "kids-story";
  if (!isAsmrStory && !isNarrative && !isSleepStory && !isMeditation && !isKidsStory) return undefined;

  const trimmed = signals.raw.prompt.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// RP-011C.8.10P: a lightweight, preset-scoped signal for Sleep Story only --
// see core/types.ts CreativeIntent.hasExplicitScenario. Deliberately not a
// scenario-understanding check: it reuses the creativeDirection this module
// already computes above rather than re-parsing the prompt, so it answers
// only "does the user's request carry a creativeDirection Planning/Scenes/
// Guidance/Writer should defer to?", never "what is the scenario?".
export function classifyHasExplicitScenario(
  preset: CreativePreset,
  creativeDirection: string | undefined
): boolean | undefined {
  return preset === "sleep-story" && Boolean(creativeDirection) ? true : undefined;
}
