// lib/script-builder-narrative-quiet-knowledge.ts
//
// Narrative preset — "Quiet Knowledge" submode.
//
// Calm, atmospheric, factually-grounded spoken-word sessions in the
// editorial / library-room register: history, astronomy, philosophy,
// psychology, science, biographies, cultures. Late-night documentary tone,
// museum-audio-guide pacing. NOT podcast energy, NOT teacher-lecturing,
// NOT listicle.
//
// Called by `script-builder-narrative.ts` (Agent B) which dispatches the
// `narrative` preset's two submodes. Agent B's router invokes this builder
// with the already-normalized prompt string (same convention as
// `buildSleepStory_v3` / `buildMeditation_v3` in `script-builder.ts`) and
// expects a string back — `buildScriptV3()` then applies rhythm and
// duration fitting on top.
//
// Per /CLAUDE.md: OpenAI must be lazily initialized inside request handlers.
// This file therefore contains NO module-level OpenAI import or client
// construction. The downstream OpenAI generation path (`buildScriptOpenAI`)
// is where the API key is used; this file produces only the calm spoken
// scaffold that seeds Quiet Knowledge's voice — exactly the role the other
// v3 builders play for their presets.
//
// Per /CLAUDE.md change-budget rule: no extra helpers, abstractions, or
// files beyond what this submode strictly needs.

/** Topic categories Quiet Knowledge supports.
 *  "open" is the soft fallback when no category clearly fits — the prompt is
 *  still respected verbatim; the scaffold simply doesn't lean into a
 *  category-specific image. */
type QuietKnowledgeTopic =
  | "history"
  | "astronomy"
  | "philosophy"
  | "psychology"
  | "science"
  | "biographies"
  | "cultures"
  | "open";

/** Heuristic topic detection. Small, deliberate keyword set in EN+DE.
 *  Explicit user intent is never overridden — this only seeds the scaffold's
 *  opening image. */
function detectTopic(prompt: string): QuietKnowledgeTopic {
  const s = (prompt ?? "").toLowerCase();

  if (/\b(history|historical|geschichte|historisch|empire|reich|dynasty|dynastie|war|krieg|ancient|antike|medieval|mittelalter|century|jahrhundert|revolution)\b/.test(s)) {
    return "history";
  }
  if (/\b(astronom\w*|cosmos|kosmos|universe|universum|galax\w*|nebula|nebel|planet|stars?|sterne?|black hole|schwarzes loch|telescope|teleskop|space|weltraum|kepler|hubble)\b/.test(s)) {
    return "astronomy";
  }
  if (/\b(philosoph\w*|stoic\w*|stoiker|stoizismus|ethics?|ethik|metaphysic\w*|metaphysik|epistemolog\w*|existential\w*|existenz|kant|nietzsche|plato|platon|aristotle|aristoteles)\b/.test(s)) {
    return "philosophy";
  }
  if (/\b(psycholog\w*|the mind|geist|unconscious|unbewusst|cognition|kognition|memory|gedächtnis|emotion\w*|dream\w*|traum|jung|freud|attachment|bindung)\b/.test(s)) {
    return "psychology";
  }
  // biographies before "science" so e.g. "the life of Marie Curie" lands here
  if (/\b(biograph\w*|life of|leben von|portrait of|porträt von|memoir|erinnerungen)\b/.test(s)) {
    return "biographies";
  }
  if (/\b(culture\w*|kultur\w*|tradition\w*|ritual\w*|ritus|folklore|mythology|mythologie|ceremony|zeremonie|indigenous|indigen|civilization\w*|zivilisation)\b/.test(s)) {
    return "cultures";
  }
  if (/\b(science|wissenschaft|physic\w*|physik|chemi\w*|biolog\w*|geolog\w*|evolut\w*|quantum|quanten|neuro\w*|microb\w*|ocean|ozean|climate|klima)\b/.test(s)) {
    return "science";
  }
  return "open";
}

/** Coarse language detection from prompt content. Mirrors the de/en split
 *  used by the other builders. Defaults to German (app default). */
function detectLanguage(prompt: string): "de" | "en" {
  const s = (prompt ?? "").toLowerCase();
  const enHits = (s.match(/\b(the|and|of|in|with|about|story|history)\b/g) ?? []).length;
  const deHits = (s.match(/\b(der|die|das|und|von|über|geschichte|eine|einen)\b/g) ?? []).length;
  return enHits > deHits ? "en" : "de";
}

/** A short atmospheric opener for each topic, used to anchor the editorial
 *  register before the user prompt enters. One opener per topic per language. */
function openerFor(topic: QuietKnowledgeTopic, language: "de" | "en"): string {
  if (language === "de") {
    switch (topic) {
      case "history":
        return "Stell dir einen ruhigen Saal vor, alte Wände, das Licht eines späten Nachmittags.";
      case "astronomy":
        return "Stell dir vor, du stehst spät am Abend draußen, und der Himmel ist still und weit.";
      case "philosophy":
        return "Manche Gedanken werden besser leise getragen als laut ausgesprochen.";
      case "psychology":
        return "Es gibt etwas am inneren Leben des Menschen, das sich langsam zeigen muss.";
      case "science":
        return "Manche Dinge in der Welt werden erst sichtbar, wenn man ihnen Zeit lässt.";
      case "biographies":
        return "Ein Leben lässt sich nicht in Zahlen erzählen. Eher in Bildern.";
      case "cultures":
        return "Jede Tradition hat ihren eigenen Rhythmus, ihr eigenes Schweigen.";
      case "open":
      default:
        return "Manche Themen mögen es, ruhig betreten zu werden.";
    }
  }
  switch (topic) {
    case "history":
      return "Picture a quiet room, old walls, the light of a late afternoon.";
    case "astronomy":
      return "Imagine standing outside late in the evening, the sky wide and still.";
    case "philosophy":
      return "Some thoughts are better carried quietly than spoken aloud.";
    case "psychology":
      return "There is something in our inner life that has to show itself slowly.";
    case "science":
      return "Some things in the world only become visible when you give them time.";
    case "biographies":
      return "A life cannot be told in numbers. It is told in images.";
    case "cultures":
      return "Every tradition has its own rhythm, its own silence.";
    case "open":
    default:
      return "Some subjects like to be entered gently.";
  }
}

/** A brief factual-stance line, mirrored in DE/EN. Plants the scaffold's
 *  hedging register so downstream generation inherits a "don't fabricate"
 *  posture rather than confident invention. */
function factualStanceFor(language: "de" | "en"): string {
  if (language === "de") {
    return "Wir bleiben bei dem, was sich wirklich sagen lässt. Wo etwas unsicher ist, sagen wir das auch.";
  }
  return "We stay with what can honestly be said. Where the record is uncertain, we leave it uncertain.";
}

/** A short closing beat. No "and that's it for tonight" — just a soft landing. */
function closerFor(language: "de" | "en"): string {
  if (language === "de") {
    return "Mehr braucht es für heute nicht.";
  }
  return "Nothing more needs to be said tonight.";
}

// -----------------------------------------------------------------------------
// OpenAI prompt assembly (production path).
//
// Mirrors `buildNarrativeStoryOpenAIPrompts` in
// `./script-builder-narrative-story.ts`. The handler-side caller
// (`buildScriptOpenAI`) feeds the returned { system, user } pair straight
// into responses.create() — no module-level OpenAI client is constructed
// here (per /CLAUDE.md "OpenAI must be lazily initialized inside request
// handlers").
//
// Voice rules (must hold across both languages):
//   - calm, atmospheric, factually-grounded
//   - editorial / library-room register
//   - NO podcast-host energy ("welcome back", "today we're going to")
//   - NO ASMR reassurance ("you're safe", "I'm here", "let go")
//   - NO sleep-story narrative arcs (no protagonist, no plot)
//   - NO meditation framing (no breathing instructions, no body scans)
//     unless the user explicitly requests them
// -----------------------------------------------------------------------------

export type NarrativeQuietKnowledgePromptOpts = {
  userPrompt: string;
  outputLanguage: "English" | "German";
  wordTarget: number;
  targetDurationSec?: number;
};

export type NarrativeQuietKnowledgePrompts = {
  system: string;
  user: string;
  topic: QuietKnowledgeTopic;
};

export function buildNarrativeQuietKnowledgeOpenAIPrompts(
  opts: NarrativeQuietKnowledgePromptOpts,
): NarrativeQuietKnowledgePrompts {
  const userPrompt = (opts.userPrompt ?? "").trim();
  const topic = detectTopic(userPrompt);
  const wordTarget = Math.max(150, Math.round(opts.wordTarget));

  const system = [
    `You are a calm, knowledgeable narrator producing audio-narratable Quiet Knowledge sessions for an adult listening audience.`,
    ``,
    `Your voice is the late-night documentary, the museum audio guide at closing time, the well-read friend who knows a subject and shares it without performance. Curious, grounded, unhurried.`,
    ``,
    `WHAT THIS IS NOT:`,
    `- NOT a sleep story. There is no protagonist, no plot, no narrative arc.`,
    `- NOT ASMR. Never reassure the listener ("you're safe", "I'm here", "let go", "everything is calm"). Never address the listener with intimacy ("hey", "shhh").`,
    `- NOT a meditation. Do not give breathing instructions, body scans, or grounding cues unless the user's prompt explicitly asks for them.`,
    `- NOT a podcast. No "welcome back", no "today we're going to talk about", no "in this episode", no host energy, no first-person promotional voice.`,
    `- NOT a lecture. No "let me explain", no didactic teacher tone, no quiz prompts.`,
    `- NOT a listicle. No "five things you didn't know", no enumerated bullet structure.`,
    ``,
    `WHAT THIS IS:`,
    `- A calm, factual exploration of a subject. Information first, atmosphere second.`,
    `- Editorial prose: complete sentences, varied length, real paragraphs.`,
    `- Atmospheric ground (a quiet room, a window, a lamp) is allowed sparingly to anchor the voice — but it must never replace content. The subject is the destination.`,
    `- Specific, accurate details over vague poeticism. Concrete nouns. Real names, dates, places when relevant.`,
    ``,
    `FACTUAL STANCE:`,
    `- Stay with what is reasonably well established. Where the historical or scientific record is genuinely uncertain, say so plainly ("we are not entirely sure", "the sources disagree", "this is one interpretation").`,
    `- Do NOT invent specific dates, names, statistics, or quotations. If you do not know a specific fact precisely, generalise honestly rather than fabricate.`,
    `- No real public figures portrayed in defamatory or invented private acts. No copyrighted IP (Disney, Marvel, etc.).`,
    ``,
    `AUDIO-NARRATION RULES:`,
    `- This text will be read aloud by a TTS narrator. Write for the ear.`,
    `- Plain prose. No headings, no bullet points, no markdown, no bracketed stage directions like [softly] or [pause].`,
    `- Avoid em dashes (—) and ellipses (… or ...) — they confuse TTS pacing. Use periods and commas for rhythm; blank lines between paragraphs for pause.`,
    `- Every paragraph break is a real paragraph break: blank line between paragraphs.`,
    `- The opening sentence should be short, grounded, and inviting — not theatrical, not a podcast greeting.`,
    ``,
    `OUTPUT FORMAT:`,
    `Return ONLY valid JSON in the shape: {"finalText": "..."}.`,
    `The finalText field contains the full spoken script as plain prose with blank-line paragraph separation. No title prefix, no chapter labels, no metadata.`,
  ].join("\n");

  const topicHint =
    topic === "open"
      ? `No specific topic category was detected. Stay with the subject the user described and treat it on its own terms.`
      : `Detected topic category: "${topic}". Use this only as a register hint — do not announce the category, and follow the user's actual subject wording precisely.`;

  const user = [
    `Selected output language: ${opts.outputLanguage}`,
    ``,
    `Preset: narrative / quiet-knowledge`,
    ``,
    `Topic handling:`,
    topicHint,
    ``,
    `Length target:`,
    `- Approximate word count: ${wordTarget} words (±10%).`,
    `- Do NOT pad with atmosphere to reach the target. Reach it through real substance — facts, context, examples, gentle observation — staying inside the user's subject.`,
    ``,
    `Important language rule:`,
    `- The user's theme below may be written in ANY language.`,
    `- You MUST understand the theme.`,
    `- You MUST write the final session entirely in ${opts.outputLanguage}.`,
    ``,
    `Subject (treat the user's wording as the binding brief — do NOT echo it verbatim as narration, do NOT replace it with a different topic):`,
    userPrompt || "(no subject provided — choose a calm factual topic that fits the Quiet Knowledge register)",
    ``,
    `Voice reminders:`,
    `- Editorial, calm, factually grounded. No host energy. No reassurance. No breathing instructions. No protagonist or plot.`,
    `- Begin with a short, grounded opening sentence. End softly — no "and that's all for tonight", no benediction.`,
    ``,
    `Formatting reminders:`,
    `- Plain prose only. No markdown, no headings, no bullet points, no stage directions.`,
    `- Blank line between paragraphs. No ellipses, no em dashes.`,
    `- Return ONLY JSON: {"finalText": "..."}.`,
  ].join("\n");

  return { system, user, topic };
}

/**
 * Build the Quiet Knowledge scaffold for one session.
 *
 * Same shape as `buildSleepStory_v3` / `buildMeditation_v3` in
 * `script-builder.ts`: takes the already-normalized prompt string, returns
 * the spoken text seed. The caller (`buildScriptV3`) applies rhythm and
 * duration fitting; the downstream OpenAI generator (when used) reads the
 * scaffold's register and expands it.
 *
 * Duration sizing happens upstream in `fitToTargetDuration`, so this
 * function emits a compact, register-perfect seed rather than a full-length
 * piece. The seed length and atmospheric beats it contains are enough to
 * anchor the calm documentary voice for any session length.
 */
export function buildNarrativeQuietKnowledge_v3(prompt: string): string {
  const cleaned = (prompt ?? "").trim();
  const language = detectLanguage(cleaned);
  const topic = detectTopic(cleaned);

  // Body line: respect explicit user intent verbatim. When empty, fall back
  // to a calm, non-specific invitation in the chosen language.
  const body =
    cleaned.length > 0
      ? cleaned
      : language === "de"
        ? "Ein ruhiges Thema, das wir gemeinsam langsam betrachten."
        : "A quiet subject we will look at slowly, together.";

  // Soft-hedging anchor line: signals to the downstream voice that the
  // qualitative is preferred over invented specifics. Phrased so it reads
  // naturally if spoken, never as a meta-instruction.
  const hedge =
    language === "de"
      ? "Vieles davon ist gut belegt. Manches wissen wir nur ungefähr — und das darf so bleiben."
      : "Much of this is well established. Some of it we only know in outline — and that is enough.";

  // Editorial scaffold. Paragraphs separated by blank lines, mirroring the
  // sleep-story scaffold's `\n\n` convention so the downstream chapter
  // splitter and paragraph-based prosody pass behave consistently.
  return [
    openerFor(topic, language),
    "",
    factualStanceFor(language),
    "",
    body,
    "",
    hedge,
    "",
    closerFor(language),
  ]
    .join("\n")
    .trim();
}
