// lib/script-builder-narrative-story.ts
//
// Narrative – "Story" submode builder.
//
// Scope: real fiction (crime, fantasy, sci-fi, romance, mystery, adventure,
// slice-of-life, historical). Story is NOT optimized for sleep. Emotion,
// drama, and tension are encouraged. Premium publisher tone — never pulp.
//
// This file exposes two things:
//
//   1) `buildNarrativeStory_v3(prompt)` — the offline scaffold that matches
//      the signature of the other v3 builders. `buildScriptV3` calls into it
//      and then applies rhythm + duration fitting. The scaffold is short
//      and intentionally calm so the downstream `applyRhythm` /
//      `fitToTargetDuration` pass has a clean substrate to expand from.
//
//   2) `buildNarrativeStoryOpenAIPrompts(...)` — the prompt-engineering
//      surface for the real generation pipeline. This is the production
//      path: a `system` + `user` pair that the OpenAI script builder can
//      feed straight into its existing responses.create() call. Mirrors the
//      shape `buildScriptOpenAI` uses for sleep-story / kids-story.
//
// Chapter architecture: the downstream chapter splitter (`splitToChunksSafe`
// in lib/audio/chunks.ts) is paragraph-aware — it cuts on `\n\n` first, then
// sentence boundaries. Sleep Story does not emit any explicit chapter markers
// either; its chapters fall out of paragraph breaks. We mirror that exactly:
// novella-length outputs simply use rich, well-separated paragraphs and the
// chunker carves them at natural beats. No custom markers are introduced.
//
// Language: mirrors the existing builders. The OpenAI prompt accepts an
// `outputLanguage` of "English" or "German" and binds the model to that
// language for the entire script. Genre is detected from the user prompt;
// if no genre is indicated, the model picks one organically rather than
// forcing a default. Explicit user intent is never overridden (per
// CLAUDE.md prompt-system rules).
//
// When this file's `buildNarrativeStoryOpenAIPrompts` is used to drive an
// actual OpenAI call, the caller (handler / route) is responsible for the
// lazy OpenAI client construction — per /CLAUDE.md
// "OpenAI must be lazily initialized inside request handlers." Nothing in
// this file imports OpenAI at module level.

// -----------------------------------------------------------------------------
// 1) Offline scaffold (signature-compatible with other v3 builders).
// -----------------------------------------------------------------------------

export function buildNarrativeStory_v3(prompt: string): string {
  const p = prompt && prompt.trim() ? prompt.trim() : "A quiet moment opens, and a story begins.";
  // Short, calm scaffold. The real long-form generation happens via the
  // OpenAI path below; this scaffold is the offline fallback used by
  // buildScriptV3's local pipeline.
  return [
    "The room is still.",
    "",
    p,
    "",
    "Something is about to begin.",
    "",
    "Listen closely.",
  ].join("\n").trim();
}

// -----------------------------------------------------------------------------
// 2) Genre detection — light heuristic. Respect explicit user intent first.
// -----------------------------------------------------------------------------

export type StoryGenre =
  | "crime"
  | "fantasy"
  | "sci-fi"
  | "romance"
  | "mystery"
  | "adventure"
  | "slice-of-life"
  | "historical"
  | "unspecified";

const GENRE_HINTS: Array<{ genre: StoryGenre; patterns: RegExp[] }> = [
  { genre: "crime",         patterns: [/\b(crime|detective|heist|noir|investigator|murder mystery|krimi|verbrechen|ermittl)/i] },
  { genre: "fantasy",       patterns: [/\b(fantasy|dragon|wizard|elf|magic kingdom|enchanted|fantasie|drache|magier|verzauber)/i] },
  { genre: "sci-fi",        patterns: [/\b(sci[- ]?fi|science[- ]?fiction|spaceship|starship|cyberpunk|android|alien|robot|raumschiff)/i] },
  { genre: "romance",       patterns: [/\b(romance|love story|romantic|lovers|liebesgeschichte|romanze|verliebt)/i] },
  { genre: "mystery",       patterns: [/\b(mystery|whodunit|puzzle|cipher|secret society|r[äa]tselhaft|geheimnis)/i] },
  { genre: "adventure",     patterns: [/\b(adventure|quest|expedition|voyage|treasure|abenteuer|reise|schatzsuche)/i] },
  { genre: "slice-of-life", patterns: [/\b(slice of life|everyday|cozy|small[- ]town|coming of age|alltag|kleinstadt)/i] },
  { genre: "historical",    patterns: [/\b(historical|medieval|victorian|1920s|ancient rome|wwii|second world war|mittelalter|antike|historisch)/i] },
];

export function detectGenre(prompt: string): StoryGenre {
  const text = (prompt ?? "").toLowerCase();
  if (!text.trim()) return "unspecified";
  for (const { genre, patterns } of GENRE_HINTS) {
    if (patterns.some((p) => p.test(text))) return genre;
  }
  return "unspecified";
}

// -----------------------------------------------------------------------------
// 3) Duration shape. Short story vs novella thresholds.
// -----------------------------------------------------------------------------
//
// Short:  10–20 min  → tight 3-act vignette, single setting, one pivot.
// Long:   20+ min    → novella with chapters (paragraph-driven, no markers).
// Threshold: 1200 sec (20 min) is the split point.

export type StoryShape = "short" | "long";

export function shapeForDuration(targetDurationSec?: number): StoryShape {
  if (typeof targetDurationSec !== "number" || !Number.isFinite(targetDurationSec)) {
    return "short";
  }
  return targetDurationSec >= 1200 ? "long" : "short";
}

// -----------------------------------------------------------------------------
// 4) OpenAI prompt assembly (production path).
// -----------------------------------------------------------------------------

export type NarrativeStoryPromptOpts = {
  userPrompt: string;
  outputLanguage: "English" | "German";
  wordTarget: number;
  targetDurationSec?: number;
};

export type NarrativeStoryPrompts = {
  system: string;
  user: string;
  genre: StoryGenre;
  shape: StoryShape;
};

export function buildNarrativeStoryOpenAIPrompts(
  opts: NarrativeStoryPromptOpts,
): NarrativeStoryPrompts {
  const userPrompt = (opts.userPrompt ?? "").trim();
  const genre = detectGenre(userPrompt);
  const shape = shapeForDuration(opts.targetDurationSec);
  const wordTarget = Math.max(150, Math.round(opts.wordTarget));

  const GENRE_BRIEFS: Record<Exclude<StoryGenre, "unspecified">, string> = {
    crime:           `Crime: moral weight and human cost. Specific tradecraft, real procedure. Plant misdirection and plausible false leads; track consequences. The reveal must reframe earlier scenes, not arrive from nowhere, and never resolve at midpoint.`,
    fantasy:         `Fantasy: a coherent world with its own rules, costs, and customs — lived-in, not explained. Wonder must be paid for; magic has price.`,
    "sci-fi":        `Sci-fi: one or two specific speculative ideas with concrete trade-offs in daily life — never generic futurism. The idea must bite something or someone.`,
    romance:         `Romance: interiority and restraint. Connection through specific gesture and friction — not declaration. Both people must change.`,
    mystery:         `Mystery: a real puzzle with planted, fair clues and at least one credible wrong path. The answer must satisfy by reframing earlier detail, not by surprising for its own sake.`,
    adventure:       `Adventure: forward momentum across a demanding landscape. The world tests the protagonist in ways that change them.`,
    "slice-of-life": `Slice-of-life: small stakes treated with full seriousness. The pivot is internal, quiet, and unmistakable.`,
    historical:      `Historical: period felt through specific objects, idioms, and constraints — and the pressure the era puts on ordinary lives. No modern vocabulary, no costume-drama gloss.`,
  };

  const genreInstruction =
    genre === "unspecified"
      ? `No genre specified. Choose one that genuinely fits — crime, fantasy, sci-fi, romance, mystery, adventure, slice-of-life, or historical — and commit to it. Do not announce it; let it emerge.`
      : `Genre: "${genre}". Honor it precisely; do not substitute. ${GENRE_BRIEFS[genre]}`;

  const shapeInstruction =
    shape === "short"
      ? [
          `STRUCTURE — SHORT STORY (vignette, ~${wordTarget} words):`,
          `- Tight 3-act vignette: setup, turn, landing. Single setting, one real shift in the protagonist.`,
          `- Hook the first paragraph. Reach the climax with runway left to resolve it — do not spend the budget on setup.`,
          `- The final stretch is real aftermath: the choice has visible consequences and the piece settles before it ends. A true ending, not a teaser.`,
        ].join("\n")
      : [
          `STRUCTURE — NOVELLA (chapter-driven, ~${wordTarget} words):`,
          `- 3–6 chapters. Paragraph breaks ARE the chapter boundaries — no chapter labels, numbers, or headings; start each new chapter with a blank line and a short grounded opening sentence.`,
          `- Each chapter advances plot, deepens character, or shifts setting. No filler. Each ends on a beat that pulls forward.`,
          `- Maintain consistent characters, places, and through-line across chapters.`,
          `- The FINAL chapter is resolution, not more rising action: fallout, reckoning, new equilibrium. Threads opened earlier are answered, paid off, or deliberately closed.`,
          `- Pace the chapter count so resolution gets real space. Main characters end visibly changed by what they chose and what it cost.`,
        ].join("\n");

  const system = [
    `You are a premium literary fiction writer producing audio-narratable short stories and novellas for adult listeners. Your work belongs in literary-mainstream venues (New Yorker fiction, Tor.com, Asimov's, contemporary noir) — not pulp, not fan-fiction, not screenplay shorthand.`,
    ``,
    `These are NOT sleep stories. Tension, drama, and emotional arcs are expected. The listener chose Narrative because they want a real story.`,
    ``,
    `STORY ARC:`,
    `- Named protagonist with concrete motivation. Name what they want or stand to lose — a person, place, job, secret, promise, chance — early enough that later beats carry weight. No stakes, no story.`,
    `- Deliver a COMPLETE arc: setup, climax, AND a real RESOLUTION phase — consequences land, characters react, the world resettles. Resolution is its own beat, not one closing line.`,
    `- No "chapter 1" stops, no cliffhangers, no "to be continued" feel unless the user explicitly asks. If you sense the runtime is short, compress the middle — never truncate the ending.`,
    `- Closure is not the same as a happy ending. Tragic, bittersweet, morally unresolved, ambiguous-but-settled endings are all valid. What is banned is a story that simply stops.`,
    `- End on a final image, choice, or consequence that lingers. The last paragraph should feel like the last page of a book — never a summary, never a moral, never a teaser.`,
    ``,
    `PROSE & VOICE:`,
    `- Plain, direct language. Strong verbs and concrete nouns do the work; adjectives and adverbs earn their place. Vary sentence length deliberately.`,
    `- Restrained figurative density: at most one metaphor or lyrical image per three-to-five-paragraph cluster, often none. Metaphor is a spice, not the meal.`,
    `- Show, never label. Emotion lands through behavior, gesture, object, silence — never "she felt sad" or "he was furious." Trust the listener.`,
    `- Wide emotional palette (hope, fear, shame, grief, longing, relief, anger), but only what the story has earned. Betrayal lands because we saw the bond; relief lands because we felt the fear.`,
    `- Quiet scenes and breaking scenes must contrast. When the earned moment arrives, let it land in the body — a hand that won't stop shaking, a voice gone flat, weeping that comes out wrong, a thrown object, a held breath. Then return to restraint. No melodrama, but no permanent elegance either.`,
    ``,
    `CHARACTERS & DIALOGUE:`,
    `- Each named character speaks in their own register, shaped by age, education, profession, era, region, and the power they hold or lack in the moment. A detective interrogates; a suspect evades; a frightened person fragments; a powerful one is short and cold; a working-class voice is plainer than the narrator's. Not every voice is equally polished — that is the point.`,
    `- Register comes from word choice, sentence shape, and what a person will and won't say. No phonetic accents, no dialect caricature, no thee-thou cosplay. Attribute only when the speaker isn't obvious from voice.`,
    ``,
    `WORLD & SETTING:`,
    `- Period, genre, and social rules emerge through specific objects, idioms, gestures, and what things cost — never through exposition dumps or narrator lectures. One or two precise details outweigh a paragraph of scene-setting.`,
    `- Characters move inside the rules of their world; in-universe consequences (a wound, a debt, a rumor, a missed train) carry the weight that world gives them.`,
    `- Historical pieces: period-accurate vocabulary and rhythms. No modern idiom, no Wikipedia voice, no tourist-brochure history.`,
    ``,
    `FIDELITY & CONTENT:`,
    `- The user's prompt is the binding brief. Honor explicit characters, names, settings, periods, tones, and constraints. Shape and elevate — never substitute a story you'd rather tell.`,
    `- Do NOT write: graphic gore, sexual content, hate speech, slurs, glorified cruelty, on-page sexual violence, content sexualizing minors, torture-porn. Threat, fear, and violence may appear, staged with restraint.`,
    `- No real public figures in defamatory or invented private acts. No copyrighted IP (Marvel, Disney, Star Wars, Harry Potter, etc.) — original characters and worlds.`,
    ``,
    `OUTPUT (TTS narration):`,
    `- Plain prose written for the ear. Blank line between paragraphs. No headings, bullets, markdown, chapter labels, or bracketed stage directions like [softly] or [pause].`,
    `- Dialogue uses standard double quotes; attribute speakers when ambiguous.`,
    `- No em dashes (—) and no ellipses (… or ...) — they confuse TTS pacing. Use periods and commas for rhythm.`,
    `- Return ONLY valid JSON: {"finalText": "..."}. The finalText is the full spoken script — no title prefix, no metadata.`,
  ].join("\n");

  const user = [
    `Preset: narrative / story. Output language: ${opts.outputLanguage}. The theme below may be in any language — understand it, but write the entire script in ${opts.outputLanguage}.`,
    ``,
    `Genre: ${genreInstruction}`,
    ``,
    `Length target: ~${wordTarget} words (±10%). Reach it through real story development — scene, conflict, character — not padding. Reach the climax AND deliver its resolution within the budget.`,
    ``,
    shapeInstruction,
    ``,
    `Theme (binding brief — do not echo verbatim, do not replace):`,
    userPrompt || "(no theme provided — choose a fitting scenario)",
  ].join("\n");

  return { system, user, genre, shape };
}
