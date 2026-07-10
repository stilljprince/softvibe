// lib/narrative/editor.ts
//
// Pass-C3E: post-merge editorial pass for long-form Narrative Story output.
//
// The long-form narrative orchestrator writes the story as a sequence of
// consecutive segments and joins them with `mergeNarrativeSegments`. That
// merge is a deterministic string join — no editorial smoothing, no cross-
// segment compression, no seam repair. `editNarrativeLongform` is the
// editorial pass that runs over the merged text and:
//
//   • compresses repetition that survives across segment boundaries
//   • smooths seams where segments meet
//   • removes residual paragraphs once the story has clearly resolved
//   • preserves plot clarity, causal chain, character decisions, and meaning
//   • never invents new events, characters, or settings
//
// This module no longer carries a "compression" mode — material overshoot is
// handled by the dedicated Compression Writer in compression-writer.ts. This
// editor is responsible only for "polish" (first-pass surgical edits on
// drafts already near target) and "repair-light" (second pass that fixes
// concrete supervisor-flagged issues without reshaping length).
//
// Failure handling mirrors `editSleepStory`: any OpenAI failure, parse
// failure, truncation, or empty output falls back silently to the unedited
// merged text. The editor is never allowed to block a job.
//
// Kill switch: caller honors SKIP_EDITOR_PASS=1 to bypass this pass entirely.
// Telemetry: [EDITOR:C3E] prefix on all log lines.

import OpenAI from "openai";

export type EditorMode = "polish" | "repair-light" | "copy-editor";

export type EditNarrativeLongformInput = {
  finalText: string;
  outputLanguage: "English" | "German";
  wordTarget: number;
  openaiTimeoutMs?: number;
  model?: string;
  // Optional editor mode. Defaults to "polish" — preserves legacy behavior.
  //   polish        → light surgical pass, draft already near target length
  //   repair-light  → second pass; fix only listed supervisor issues, preserve length
  mode?: EditorMode;
  // Used by repair-light mode only. Concrete issues from the Story Supervisor
  // that the repair pass should address. Ignored in other modes.
  supervisorIssues?: string[];
  // Used by repair-light mode only. Conveys cross-attempt context to the model
  // when multiple repair attempts are allowed (duration-aware repair budget):
  //   • previousScore   — supervisor score on the draft fed into THIS attempt
  //   • bestScore       — highest supervisor score observed so far (anchor)
  //   • previousDegraded — true iff a previous repair attempt scored lower
  //                        than the pre-repair version (signals: be smaller).
  // Ignored in other modes.
  repairContext?: {
    previousScore?: number;
    bestScore?: number;
    previousDegraded?: boolean;
  };
};

export type EditNarrativeLongformOutput = {
  editedText: string;
  changesSummary: string[];
};

export async function editNarrativeLongform(
  input: EditNarrativeLongformInput,
): Promise<EditNarrativeLongformOutput> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn(
      "[EDITOR:C3E] failed reason=missing_api_key preset=narrative using=unedited_text",
    );
    return { editedText: input.finalText, changesSummary: ["editor-skipped: no api key"] };
  }

  const model =
    input.model ??
    process.env.OPENAI_NARRATIVE_EDITOR_MODEL ??
    process.env.OPENAI_EDITOR_MODEL ??
    "gpt-5.4-mini";

  const timeoutMs =
    typeof input.openaiTimeoutMs === "number" && Number.isFinite(input.openaiTimeoutMs)
      ? input.openaiTimeoutMs
      : parseInt(process.env.OPENAI_NARRATIVE_EDITOR_TIMEOUT_MS ?? "180000", 10);

  const wordCount = input.finalText.split(/\s+/).filter(Boolean).length;
  const maxTokens = Math.min(16000, wordCount * 3 + 512);

  const mode: EditorMode = input.mode ?? "polish";

  // Mode shapes the indicative output range so the editor knows how aggressive
  // to be on length. "polish" anchors on the original word target.
  // "repair-light" anchors on the *current* draft length — the goal of a
  // repair pass is to fix issues, not to re-shape length.
  // "copy-editor" is even tighter: it must preserve current length within ~2%
  // since it is only allowed to make tiny mechanical corrections.
  let targetMin: number;
  let targetMax: number;
  if (mode === "repair-light") {
    targetMin = Math.max(300, Math.round(wordCount * 0.95));
    targetMax = Math.max(targetMin, Math.round(wordCount * 1.03));
  } else if (mode === "copy-editor") {
    targetMin = Math.max(300, Math.round(wordCount * 0.98));
    targetMax = Math.max(targetMin, Math.round(wordCount * 1.02));
  } else {
    targetMin = Math.max(300, Math.round(input.wordTarget * 0.92));
    targetMax = Math.max(targetMin, Math.round(input.wordTarget * 1.05));
  }

  // Copy-editor mode has a totally separate, much narrower system prompt.
  // It runs always (regardless of supervisor score) and is allowed only to
  // make tiny mechanical corrections in four categories: [grammar],
  // [reference], [continuity], [repetition]. No editorial rewriting, no
  // length re-shaping, no tone shifts. Constructed below and returned early.
  let system: string;
  let user: string;
  if (mode === "copy-editor") {
    system = [
      `You are a senior copy editor performing an EXTREMELY CONSERVATIVE mechanical polish on a long-form narrative draft.`,
      ``,
      `━━━ MODE: COPY EDITOR ━━━`,
      ``,
      `This pass runs on every story, regardless of editorial quality. Its only purpose is to clean up small mechanical defects. It is NOT a literary edit. You do NOT compress, rewrite, restructure, soften, sharpen, or re-shape anything. You do NOT change vocabulary. You do NOT alter plot, character, atmosphere, pacing, tone, or meaning. A missed fix is preferable to an invented fix.`,
      ``,
      `Scope: four narrow categories. Anything outside these four categories is OUT OF SCOPE for this pass — leave it for a later editorial stage.`,
      ``,
      `━━━ THE FOUR CATEGORIES ━━━`,
      ``,
      `[grammar] — surface-level output defects`,
      `   • Tokenization artifacts inside names ("Ev as" → "Evas", "Pa uls" → "Pauls").`,
      `   • Stray double spaces, broken hyphenation, duplicated punctuation ("..", "??", ",,").`,
      `   • Malformed quotation marks (opener followed by a space, missing closing quote on the same speaker turn).`,
      `   • Obvious typos that are not stylistic choices.`,
      `   Fix in place. Do not rephrase the sentence — just repair the defect.`,
      ``,
      `[reference] — ambiguous pronouns and possessives`,
      `   • "in Pauls Schrift nur sein Name" — whose name? Make the antecedent clear by naming the person ("…nur Evas Name") or restructuring just enough to remove the ambiguity.`,
      `   • "she looked at her" where two female characters share the scene.`,
      `   Resolve with the smallest possible edit. Keep voice and rhythm.`,
      ``,
      `[continuity] — payoffs without setup`,
      `   • An object, smell, food, sound, or sensory detail that suddenly appears without earlier introduction.`,
      `   • A character action that assumes information the reader has not been given.`,
      `   Preferred fix: a single short clause of setup BEFORE the payoff (one image, not a paragraph). Removing the payoff is acceptable only when setup would distort the scene.`,
      `   Goal: small setup before payoff, not removing the scene.`,
      ``,
      `[repetition] — near-repetition of high-frequency atmosphere words`,
      `   • German watch list: Staub, Papier, Holz, Geruch, Schweigen. English watch list: dust, paper, wood, silence, smell.`,
      `   • Also watch for identical emotional metaphors recurring within a short span ("a stone in her chest" twice on the same page).`,
      `   Fix by varying the second instance with a same-register synonym, by replacing it with a different specific sensory anchor, or by deleting it if it is purely decorative.`,
      `   Preserve atmosphere — do not strip the scene of sensory texture. The goal is to thin nearby duplicates, not to remove imagery.`,
      ``,
      `━━━ HARD RULES — NON-NEGOTIABLE ━━━`,
      `   • Smallest possible edit. Surgical, line-level only.`,
      `   • Preserve vocabulary level. Do not simplify literary nouns. Words such as "Sekretär", "Emaille-Schüssel", "Schwelle", "Vorhalle" stay.`,
      `   • No plot changes. No character changes. No new events, scenes, characters, or settings.`,
      `   • No restructuring. No paragraph re-ordering. No scene merging.`,
      `   • No word-count optimization. Preserve current length within ~2%. Do NOT compress.`,
      `   • No emotional rewrites. No tone shifts. No "show, don't tell" rewrites — that is a later stage.`,
      `   • No reveal calibration. No transition smoothing. Those are later stages.`,
      `   • No new markdown, headings, segment labels, or meta commentary. Output is continuous prose only.`,
      `   • Do NOT remove safety-relevant content or weaken safe pacing.`,
      ``,
      `Restraint: a missed fix is fine. An invented fix is not. If you cannot point to the exact defective phrase, leave the passage alone.`,
      ``,
      `━━━ LENGTH GUIDANCE ━━━`,
      `Current draft length is the target. Indicative output range: ~${targetMin}–${targetMax} words. Do not pad. Do not compress.`,
      ``,
      `Output language: ${input.outputLanguage}`,
      `Return ONLY valid JSON: {"editedText": "...", "changesSummary": ["...", ...]}.`,
    ].join("\n");

    user = [
      `Apply the COPY EDITOR pass to the following narrative draft.`,
      ``,
      `Editor mode: copy-editor`,
      `Current draft: ~${wordCount} words.`,
      `Preserve current length — indicative output range: ~${targetMin}–${targetMax} words.`,
      ``,
      `Make ONLY the small mechanical fixes covered by the four categories: [grammar], [reference], [continuity], [repetition]. Skip everything else.`,
      ``,
      `NARRATIVE DRAFT:`,
      `---`,
      input.finalText,
      `---`,
      ``,
      `Return JSON: {"editedText": "...", "changesSummary": [...]}.`,
      `changesSummary: name each specific edit made, labeled with one of the four bracketed tags above. Be concrete.`,
      `  GOOD: "[grammar] repaired tokenization artifact: 'Ev as' → 'Evas' in paragraph 4"`,
      `  GOOD: "[reference] clarified ambiguous possessive: 'in Pauls Schrift nur sein Name' → '…nur Evas Name'"`,
      `  GOOD: "[continuity] added one-clause setup for the Emaille-Schüssel before its appearance on the threshold"`,
      `  GOOD: "[repetition] thinned three nearby uses of 'Staub' to one; replaced the second with 'Papierfasern' at the same register"`,
      `  BAD: "improved flow" / "polished prose" (out of scope for this pass)`,
      `Max 10 items. If no defects were found, return an empty changesSummary array and the unchanged draft as editedText.`,
    ].join("\n");
  } else {
  // Mode-specific directive injected near the top of the system prompt. The
  // core editorial voice and mandate below remains shared across all modes —
  // the mode only shifts emphasis, never the editorial philosophy.
  let modeDirective: string;
  if (mode === "repair-light") {
    const issues = (input.supervisorIssues ?? [])
      .filter((s) => typeof s === "string" && s.trim().length > 0)
      .slice(0, 10);
    const issueLines = issues.length > 0
      ? issues.map((s, i) => `  ${i + 1}. ${s}`).join("\n")
      : `  (no specific issues provided — apply minimal surgical fixes only where obvious problems remain)`;
    const ctx = input.repairContext;
    const ctxLines: string[] = [];
    if (ctx && typeof ctx.previousScore === "number") {
      ctxLines.push(`  • Supervisor score on the draft you are about to edit: ${ctx.previousScore}`);
    }
    if (ctx && typeof ctx.bestScore === "number") {
      ctxLines.push(`  • Highest supervisor score reached on any prior attempt: ${ctx.bestScore}`);
    }
    const degradedBlock = ctx?.previousDegraded
      ? [
          ``,
          `━━━ PRIOR ATTEMPT REDUCED QUALITY ━━━`,
          ``,
          `A previous repair attempt on this story reduced quality (its supervisor score came in below the version before it). For this attempt:`,
          `  • Preserve emotional transitions.`,
          `  • Do not collapse scenes.`,
          `  • Avoid introducing new repetition.`,
          `  • Make the smallest possible changes — only the issues listed below, only where you can pinpoint them.`,
          `If in doubt about any edit, leave the prose alone.`,
        ].join("\n")
      : "";
    modeDirective = [
      `━━━ MODE: REPAIR-LIGHT ━━━`,
      ``,
      `This is a SECOND editorial pass on a draft that already went through a full edit. The Story Supervisor evaluated the previous edit and flagged the following concrete issues:`,
      ``,
      issueLines,
      ...(ctxLines.length > 0 ? [``, `Context from prior attempts:`, ...ctxLines] : []),
      degradedBlock,
      ``,
      `Your job in this pass is narrow:`,
      `  • fix the issues listed above AND any small-quality defects covered by the QUALITY POLISH CHECKLIST below (grammar artifacts, ambiguous references, continuity gaps, near-repetition, over-explained emotion, over-dramatic reveals)`,
      `  • prefer TINY LOCAL EDITS over scene-level rewrites`,
      `  • preserve the current length as much as possible — do NOT compress further, do NOT expand`,
      `  • do not re-edit passages that are not implicated by the listed issues or the quality checklist`,
      `  • do not introduce new compression, do not invent new content`,
      `  • do not simplify vocabulary, do not flatten literary tone, do not soften atmosphere`,
      ``,
      `If an issue is vague or you cannot pinpoint it in the text, leave that area alone — a missed fix is far better than a destabilizing rewrite.`,
    ].join("\n");
  } else {
    modeDirective = [
      `━━━ MODE: POLISH ━━━`,
      ``,
      `The merged draft is already close to its target length and structurally healthy. Treat this as a light surgical pass: smooth seams, consolidate any clear repetition, trim any residual post-resolution paragraphs, and apply the QUALITY POLISH CHECKLIST below (grammar artifacts, ambiguous references, continuity gaps, near-repetition, over-explained emotion, over-dramatic reveals). Stay conservative — when in doubt, leave the prose alone.`,
    ].join("\n");
  }

  system = [
    `You are a senior novelist's editor performing a SURGICAL post-merge edit on a long-form narrative story.`,
    `The draft you are reading was written as a sequence of consecutive segments by an AI writer and then merged into one continuous text. The merge was deterministic — no smoothing, no compression. You are the first editorial pass over the full merged narrative.`,
    ``,
    modeDirective,
    ``,
    `━━━ EDITORIAL VOICE ━━━`,
    ``,
    `Edit toward LITERARY FICTION, not toward shorter. The story should feel like prose a reader trusts — confident, subtle, willing to leave meaning implicit. Slow pacing, warmth, and TTS-friendly readability are sacred. Drama, twists, and faster pacing are NOT goals.`,
    ``,
    `The single most common failure in this draft is a writer who does not trust the reader: the same realization is reached twice, the same theme is restated in the next paragraph, the same reveal is interpreted a second and third time. Consolidate. One strong beat outperforms three softer restatements. Subtext outperforms statement.`,
    ``,
    `Cuts and rewrites must be defensible at the story level — not stylistic preference, not blunt shortening. When a beat is repeated, do not simply delete the later instance: keep the strongest phrasing (which is often the first), and let it carry the weight alone.`,
    ``,
    `━━━ YOUR MANDATE ━━━`,
    ``,
    `1. REPEATED EMOTIONAL REFLECTIONS — consolidate to ONE stronger instance:`,
    `   The same internal realization is often reached multiple times across paragraphs or segments, in slightly different wording. Keep the strongest single phrasing; remove the variants.`,
    `   Example pattern: "Maybe I had run away." … "Perhaps I had misunderstood." … "Maybe I wasn't abandoned after all." These three circle the same realization. Choose the most resonant ONE and let it land. Do not soften it with restatement.`,
    `   The reflection should appear ONCE and become stronger — not be revisited.`,
    ``,
    `2. REPEATED THEMATIC LOOPS — compress to a single thematic beat:`,
    `   Recurring themes — duty, memory, home, belonging, regret, dignity, longing, return, forgiveness — are often restated in consecutive sections, each time with slightly different framing. The reader hears it. Pick the one rendering with the strongest image or rhythm and cut the surrounding restatements. A theme is more powerful when it lands once with weight than when it accumulates as a refrain.`,
    `   Exception: a deliberate motif that recurs at structurally meaningful points (opening, midpoint, close) is not a thematic loop — preserve it.`,
    ``,
    `3. REPEATED REVEAL EXPLANATIONS — preserve the reveal, cut redundant interpretations:`,
    `   After a discovery, characters or narration sometimes explain the same meaning two or three times in slightly different language. Keep the reveal itself and ONE clear interpretation. Remove paragraphs that re-explain what the reveal "really meant" once it has already been understood. Trust the reader to hold the meaning.`,
    ``,
    `4. REPEATED ATMOSPHERE DESCRIPTIONS — merge into ONE stronger description:`,
    `   When several nearby paragraphs describe essentially the same mood, weather, silence, room, light, or atmospheric texture, merge them into one richer passage. Atmosphere should remain rich and immersive — do NOT strip it — but do not describe the same feeling twice within a short span. Keep the sensory details that are most specific and distinctive; drop the generic restatements.`,
    ``,
    `5. REPEATED DIALOGUE LOOPS — compress while preserving natural pacing:`,
    `   Characters sometimes ask the same question again in slightly different form, repeat information already established, or cycle through the same reassurance, the same disagreement, the same small misunderstanding with the same emotional result. Compress these exchanges to one exchange that carries the emotional weight. Preserve dialogue that genuinely advances the relationship or reveals new information. Natural pauses and small silences are not loops — keep them.`,
    ``,
    `6. SMOOTH SEGMENT SEAMS:`,
    `   Segment boundaries often produce small discontinuities: a paragraph that re-introduces a character the reader just left, an over-recap of the prior scene, a slightly mismatched emotional temperature, a hard topic shift. Rewrite or merge those seams so the narrative reads as one continuous novel, not as joined parts.`,
    `   Do NOT erase real scene changes, time jumps, or genuine perspective shifts — only repair the small rough joins.`,
    ``,
    `7. END EARLIER ONCE THE STORY HAS RESOLVED:`,
    `   When the primary story question has clearly landed and the emotional or narrative resolution is on the page, cut residual paragraphs that prolong the close without adding new closure, a new image, or new relational information.`,
    `   Keep the genuine final image and any real callback. Cut the paragraphs between them that only re-confirm an arrival the listener has already felt. A clean landing is stronger than a long fade.`,
    ``,
    `━━━ PRESERVE — non-negotiable ━━━`,
    `   • Plot clarity and the causal chain (A leads to B leads to C must remain visible)`,
    `   • Character decisions and the turns those decisions create`,
    `   • The story's emotional arc and its meaning`,
    `   • Dialogue that genuinely changes the relationship`,
    `   • Mystery resolution logic and the answer to the primary story question`,
    `   • The terminal closing image and any real callback`,
    `   • Calm, warm tone, slow pacing, and TTS-friendly readability`,
    `   • Sensory atmosphere and immersive texture (compress repetition; do not strip richness)`,
    `   • The original output language`,
    ``,
    `━━━ HARD CONSTRAINTS ━━━`,
    `   • Do NOT introduce new plot events, new characters, or new settings.`,
    `   • Do NOT invent backstory the writer did not establish.`,
    `   • Do NOT change WHO does WHAT, WHEN, or WHY.`,
    `   • Do NOT flatten distinctive prose into generic narration.`,
    `   • Do NOT accelerate pacing, add drama, or introduce twists.`,
    `   • Do NOT make the story shorter for the sake of shortening — cut only where genuine repetition, over-explanation, or residual prolongation exists.`,
    `   • Do NOT remove safety-relevant content or weaken safe pacing.`,
    `   • Do NOT add markdown, headings, segment labels, or meta commentary. The output is continuous prose only.`,
    `   • Do NOT simplify vocabulary or replace literary nouns with plainer synonyms. Words such as "Sekretär", "Emaille-Schüssel", "Schwelle", "Vorhalle" stay. This pass is NOT about making the prose easier.`,
    ``,
    `━━━ QUALITY POLISH CHECKLIST ━━━`,
    ``,
    `Six narrow categories of small defects. Each is a localized, line-level fix — none requires a scene rewrite. Apply only where the defect is concrete and visible; do not invent problems. When you make a fix, label it in changesSummary with the bracketed tag shown.`,
    ``,
    `[grammar] — surface-level output defects`,
    `   • Tokenization artifacts inside names ("Ev as" → "Evas", "Pa uls" → "Pauls").`,
    `   • Stray double spaces, broken hyphenation, duplicated punctuation ("..", "??", ",,").`,
    `   • Malformed quotation spacing (a quote opener followed by a space, missing closing quote on the same speaker turn).`,
    `   • Obvious typos that are not stylistic choices.`,
    `   Fix in place. Do not rephrase the sentence — just repair the defect.`,
    ``,
    `[reference] — ambiguous pronouns and possessives`,
    `   • "in Pauls Schrift nur sein Name" — whose name? Make the antecedent clear by naming the person ("…nur Evas Name") or restructuring just enough to remove the ambiguity.`,
    `   • "she looked at her" where two female characters share the scene.`,
    `   Resolve with the smallest possible edit. Keep voice and rhythm.`,
    ``,
    `[continuity] — payoffs without setup`,
    `   • An object, smell, food, sound, or sensory detail that suddenly appears without earlier introduction.`,
    `   • A character action that assumes information the reader has not been given.`,
    `   Preferred fix: a single short sentence of setup BEFORE the payoff (one clause, one image — not a paragraph). Removing the payoff is acceptable only when setup would distort the scene.`,
    `   Goal: small setup before payoff, not removing the scene.`,
    ``,
    `[repetition] — near-repetition of high-frequency atmosphere words`,
    `   • Watch list in German drafts: Staub, Papier, Holz, Geruch, Schweigen. In English drafts: dust, paper, wood, silence, smell.`,
    `   • Also watch for identical emotional metaphors recurring within a short span ("a stone in her chest" twice on the same page).`,
    `   Fix by varying the second instance with a synonym at the same register, by replacing it with a different specific sensory anchor, or by deleting it if it is purely decorative.`,
    `   Preserve atmosphere — do not strip the scene of sensory texture. The goal is to thin near-duplicates, not to remove imagery.`,
    ``,
    `[show_not_tell] — over-explained emotion`,
    `   • A line that names the emotion the listener should feel ("she felt deeply abandoned", "his sadness was enormous") AFTER the physical scene has already shown it.`,
    `   • Narration that interprets a character's interior on the reader's behalf when a gesture, an object, or a silence already does the work.`,
    `   Fix by replacing the explanatory sentence with a physical observation, a micro-action, a piece of body language, an unfinished line of dialogue, or simply by deleting it and trusting the surrounding scene. Do not add new physical detail invented from scratch — work from what is already on the page.`,
    ``,
    `[reveal_tone] — over-dramatized reveals`,
    `   • A large emotional reveal rendered with television-drama energy: exclamation, gasps, italicized realizations, sudden crescendo language.`,
    `   • A discovery that the prose calls out as a "twist" or otherwise telegraphs.`,
    `   Calibrate down. A reveal in this work lands as a quiet discovery, an understatement, a small breath caught. Keep the reveal itself; soften only the volume of its delivery.`,
    ``,
    `Restraint: a missed quality fix is fine. An invented fix is not. If you cannot point to the exact defective phrase, leave the passage alone.`,
    ``,
    `━━━ COMPRESSION GUIDANCE ━━━`,
    `Indicative output range: ~${targetMin}–${targetMax} words. This is guidance, not a hard ceiling — staying inside the range is preferred when genuine compression exists. Do not pad to reach the floor and do not over-cut to reach the ceiling. The goal is fewer redundancies and stronger beats, not a shorter story.`,
    ``,
    `Output language: ${input.outputLanguage}`,
    `Return ONLY valid JSON: {"editedText": "...", "changesSummary": ["...", ...]}.`,
  ].join("\n");

  const modeLabel = mode === "repair-light" ? "repair-light" : "polish";

  const lengthInstruction =
    mode === "repair-light"
      ? `Preserve current length — indicative output range: ~${targetMin}–${targetMax} words (this is roughly the current draft length).`
      : `Intended total word target: ~${input.wordTarget} words. Indicative output range: ~${targetMin}–${targetMax} words.`;

  user = [
    `Edit the following merged long-form narrative draft.`,
    ``,
    `Editor mode: ${modeLabel}`,
    `Current draft: ~${wordCount} words.`,
    lengthInstruction,
    ``,
    `Compress only where genuine repetition, over-explanation, or post-resolution prolongation exists.`,
    `Preserve the plot, the causal chain, character decisions, dialogue that turns relationships, atmosphere richness, and the story's meaning.`,
    `Edit toward literary fiction: trust the reader, let strong beats land once, prefer subtext over restatement.`,
    ``,
    `NARRATIVE DRAFT:`,
    `---`,
    input.finalText,
    `---`,
    ``,
    `Return JSON: {"editedText": "...", "changesSummary": [...]}.`,
    `changesSummary: name each specific edit made. Be concrete and label the category.`,
    `  GOOD: "[emotional-reflection] consolidated three variants of Mira's 'maybe I had run away' realization into one stronger line"`,
    `  GOOD: "[thematic-loop] compressed four restatements of the 'home' theme in segments 3–4 to one beat at the threshold"`,
    `  GOOD: "[reveal-explanation] kept the letter's discovery; cut two paragraphs re-interpreting what it meant"`,
    `  GOOD: "[atmosphere] merged three nearby descriptions of the snowed-in silence into one richer paragraph"`,
    `  GOOD: "[dialogue-loop] reduced Mira/Jonas exchange (3 cycles of the same reassurance → 1)"`,
    `  GOOD: "[seam] smoothed segment-2/segment-3 join — removed over-recap of the kitchen scene"`,
    `  GOOD: "[ending] cut two residual paragraphs after the resolution that re-confirmed the arrival without new closure"`,
    `  GOOD: "[grammar] repaired tokenization artifact: 'Ev as' → 'Evas' in paragraph 4"`,
    `  GOOD: "[reference] clarified ambiguous possessive: 'in Pauls Schrift nur sein Name' → '…nur Evas Name'"`,
    `  GOOD: "[continuity] added one-clause setup for the Emaille-Schüssel before its appearance on the threshold"`,
    `  GOOD: "[repetition] thinned three nearby uses of 'Staub' to one; replaced the second with 'Papierfasern' at the same register"`,
    `  GOOD: "[show_not_tell] removed 'she felt deeply abandoned'; the preceding silence and the unopened letter already carry the beat"`,
    `  GOOD: "[reveal_tone] softened the letter-discovery delivery — cut the exclamation, kept the discovery quiet"`,
    `  BAD: "improved flow" / "removed repetition" (too vague — be specific and category-labeled)`,
    `Use the bracketed tags above whenever they fit. The same edit may carry only one tag — pick the closest category.`,
    `Max 10 items.`,
  ].join("\n");
  }

  let resp;
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    resp = await openai.responses.create(
      {
        model,
        max_output_tokens: maxTokens,
        input: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "SoftVibeNarrativeEditorResult",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                editedText: { type: "string" },
                changesSummary: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: ["editedText", "changesSummary"],
            },
          },
        },
      },
      { timeout: timeoutMs },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[EDITOR:C3E] failed reason=openai_call_failed:${msg.slice(0, 160)} preset=narrative using=unedited_text`,
    );
    return { editedText: input.finalText, changesSummary: ["editor-error: using unedited narrative"] };
  }

  const rawText = resp.output_text ?? "";
  const respStatus = resp.status ?? "unknown";

  if (respStatus === "incomplete") {
    console.warn(
      `[EDITOR:C3E] failed reason=response_truncated length=${rawText.length} preset=narrative using=unedited_text`,
    );
    return { editedText: input.finalText, changesSummary: ["editor-truncated: using unedited narrative"] };
  }

  let parsed: { editedText: string; changesSummary: string[] };
  try {
    parsed = JSON.parse(rawText) as { editedText: string; changesSummary: string[] };
  } catch {
    console.warn(
      `[EDITOR:C3E] failed reason=json_parse_error status=${respStatus} length=${rawText.length} preset=narrative using=unedited_text`,
    );
    return { editedText: input.finalText, changesSummary: ["editor-parse-error: using unedited narrative"] };
  }

  const editedText = (parsed.editedText ?? "").trim();
  if (!editedText) {
    console.warn(
      `[EDITOR:C3E] failed reason=empty_edited_text status=${respStatus} preset=narrative using=unedited_text`,
    );
    return { editedText: input.finalText, changesSummary: ["editor-empty: using unedited narrative"] };
  }

  const editedWords = editedText.split(/\s+/).filter(Boolean).length;
  const changesSummary = Array.isArray(parsed.changesSummary) ? parsed.changesSummary : [];
  const deltaPct = wordCount > 0
    ? Math.round(((editedWords - wordCount) / wordCount) * 1000) / 10
    : 0;
  const summaryLine = changesSummary.join(" | ");
  const summaryTruncated = summaryLine.length > 500
    ? `${summaryLine.slice(0, 500)}…`
    : summaryLine;

  const logMode = mode.replace(/-/g, "_");
  console.info(
    `[EDITOR:C3E] preset=narrative mode=${logMode} model=${model} originalWords=${wordCount} editedWords=${editedWords} deltaPct=${deltaPct} changesCount=${changesSummary.length}`,
  );
  console.info(`[EDITOR:C3E] mode=${logMode} changesSummary=[${summaryTruncated}]`);

  const categoryCounts = countChangeCategories(changesSummary);
  const categoryLine = QUALITY_POLISH_TAGS.map(
    (tag) => `${tag}=${categoryCounts[tag] ?? 0}`,
  ).join(" ");
  const otherCount = categoryCounts.__other ?? 0;
  console.info(`[EDITOR:C3E] mode=${logMode} categories ${categoryLine} other=${otherCount}`);

  return { editedText, changesSummary };
}

// Quality-polish category tags surfaced in changesSummary. Kept in sync with
// the QUALITY POLISH CHECKLIST section of the editor system prompt — adding a
// new dimension means adding a tag here so the telemetry counter picks it up.
const QUALITY_POLISH_TAGS = [
  "grammar",
  "reference",
  "continuity",
  "repetition",
  "show_not_tell",
  "reveal_tone",
] as const;

type QualityPolishTag = (typeof QUALITY_POLISH_TAGS)[number];

// Counts the leading [tag] prefix on each changesSummary entry. Tags outside
// the quality-polish set (existing labels like [emotional-reflection],
// [seam], [ending], …) roll up into "__other" so the counter line stays
// stable while still showing total tagged activity.
function countChangeCategories(
  summaries: string[],
): Partial<Record<QualityPolishTag | "__other", number>> {
  const counts: Partial<Record<QualityPolishTag | "__other", number>> = {};
  const knownTags = new Set<string>(QUALITY_POLISH_TAGS);
  for (const entry of summaries) {
    if (typeof entry !== "string") continue;
    const match = /^\s*\[([a-z0-9_\-]+)\]/i.exec(entry);
    if (!match) continue;
    const tag = match[1].toLowerCase();
    if (knownTags.has(tag)) {
      const key = tag as QualityPolishTag;
      counts[key] = (counts[key] ?? 0) + 1;
    } else {
      counts.__other = (counts.__other ?? 0) + 1;
    }
  }
  return counts;
}
