// lib/narrative/structural-repair.ts
//
// ONE conservative structural repair stage for long-form Narrative Story
// output. Runs AFTER the repair-light loop has completely finished and the
// best candidate from that loop still scores below the supervisor threshold.
//
// Validation across recent runs showed that most failures surviving the
// copy-editor and repair-light loop are structural rather than line-level:
// duplicated beats (the same reveal staged twice or three times), heavy
// exposition that the narrator tells instead of implies, endings that feel
// open or cliff-cut, repeated revelations, and duplicated reflection loops.
// Surface-level edits cannot fix those — they need a single, conservative
// structural intervention.
//
// This module rewrites the best draft once with the smallest structural
// change that resolves the supervisor's flagged issues. It is conservative
// by design: it must not invent new characters, settings, or plot events;
// it must not change the StoryBible trajectory or the ending tone; it must
// not introduce twists; it must not add markdown.
//
// The caller (orchestrator) owns the supervisor scoring and the
// best-version-wins acceptance rule. This module never decides what to
// keep — it only proposes a candidate.
//
// Failure handling mirrors compression-writer.ts: any failure (missing
// key, OpenAI error, truncation, parse error, empty output) returns the
// input bestText unchanged with a short skip reason. Structural repair
// is never allowed to block a job.
//
// Telemetry: [NARRATIVE-STRUCTURAL] prefix on all log lines.

import OpenAI from "openai";

export type StructuralRepairInput = {
  bestText: string;
  outputLanguage: "English" | "German";
  wordTarget: number;
  durationSec: number;
  bestScore: number;
  supervisorIssues: string[];
  supervisorNotes: string;
  openaiTimeoutMs?: number;
  model?: string;
};

export type StructuralRepairOutput = {
  candidateText: string;
  changesSummary: string[];
  attempted: boolean;
};

export async function structuralRepairNarrative(
  input: StructuralRepairInput,
): Promise<StructuralRepairOutput> {
  const originalWords = input.bestText.split(/\s+/).filter(Boolean).length;

  if (!process.env.OPENAI_API_KEY) {
    console.warn(
      `[NARRATIVE-STRUCTURAL] failed reason=missing_api_key preset=narrative using=best_text originalWords=${originalWords}`,
    );
    return {
      candidateText: input.bestText,
      changesSummary: ["structural-repair-skipped: no api key"],
      attempted: false,
    };
  }

  const targetWords = Math.max(300, Math.round(input.wordTarget));
  const durationSec = Math.max(1, Math.round(input.durationSec));

  const model =
    input.model ??
    process.env.OPENAI_NARRATIVE_STRUCTURAL_REPAIR_MODEL ??
    process.env.OPENAI_NARRATIVE_EDITOR_MODEL ??
    process.env.OPENAI_EDITOR_MODEL ??
    "gpt-5.4-mini";

  const timeoutMs =
    typeof input.openaiTimeoutMs === "number" &&
    Number.isFinite(input.openaiTimeoutMs)
      ? input.openaiTimeoutMs
      : parseInt(
          process.env.OPENAI_NARRATIVE_STRUCTURAL_REPAIR_TIMEOUT_MS ??
            process.env.OPENAI_NARRATIVE_EDITOR_TIMEOUT_MS ??
            "240000",
          10,
        );

  // Output budget anchored to whichever is larger between current draft and
  // target — a structural repair may add 1–3 paragraphs to land the ending,
  // and the brief allows ±10% around target. Plus headroom for JSON overhead.
  const sizeAnchor = Math.max(originalWords, targetWords);
  const maxTokens = Math.min(16000, sizeAnchor * 3 + 1024);

  // Length band: ±10% of wordTarget per the brief. Small contraction is
  // acceptable (the rewrite often consolidates duplicated beats); padding is
  // not.
  const targetMin = Math.max(300, Math.round(targetWords * 0.9));
  const targetMax = Math.max(targetMin, Math.round(targetWords * 1.1));

  const issues = (input.supervisorIssues ?? [])
    .filter((s) => typeof s === "string" && s.trim().length > 0)
    .slice(0, 10);
  const issueLines =
    issues.length > 0
      ? issues.map((s, i) => `  ${i + 1}. ${s}`).join("\n")
      : `  (no specific issues provided — apply only the smallest structural fix obviously required)`;

  const notesPreview = (input.supervisorNotes ?? "")
    .slice(0, 800)
    .replace(/\s+/g, " ")
    .trim();

  console.info(
    `[NARRATIVE-STRUCTURAL] phase=start preset=narrative model=${model} originalWords=${originalWords} targetWords=${targetWords} durationSec=${durationSec} bestScore=${input.bestScore} issuesCount=${issues.length} targetBand=${targetMin}-${targetMax}`,
  );

  const system = [
    `You are a senior literary novelist performing ONE decisive STRUCTURAL repair pass (V2) on a finished narrative draft.`,
    `The draft has already been through a copy-editor and a repair-light loop. Line-level fixes have been exhausted. The Story Supervisor has flagged STRUCTURAL problems that line edits cannot reach: duplicated revelations, repeated search/object beats, repeated emotional explanation, multiple weak closure beats, and endings that feel open or unresolved. Your job is to resolve those issues with real cross-scene structural change — not surface polish.`,
    ``,
    `━━━ STANCE ━━━`,
    ``,
    `This is a STRUCTURAL repair pass. It is NOT repair_light.`,
    `  • repair_light is for local, line-level edits — it has already run.`,
    `  • structural_repair is for cross-scene fixes: collapsing duplicate reveals, merging repeated beats, removing duplicate endings, completing emotional closure.`,
    ``,
    `Preserving every beat is NOT required. Preserving the STRONGEST version of each story function IS required.`,
    ``,
    `Do not protect repeated beats just because they are well written. If two beautiful passages perform the same story function, keep the stronger one and remove or fold the weaker one. Beautiful prose is not a license to repeat.`,
    ``,
    `Preserve everything the supervisor did not flag and everything that is doing distinct story work. If a passage is healthy and non-redundant, do not touch it. But when supervisor issues require structural change, act decisively — a timid pass that leaves duplicates standing is a failed pass.`,
    ``,
    `━━━ FULL-STORY REPAIR — NOT A SYNOPSIS ━━━`,
    ``,
    `Structural repair is a FULL-STORY repair pass. It is NOT a synopsis pass.`,
    ``,
    `When you remove a duplicate, you remove a duplicated FUNCTION, not literary texture. The kept beat must be re-rendered as full literary prose — with atmosphere, pacing, dialogue texture, and emotional embodiment intact. Do not leave behind a thin, summarized residue of the merged beats.`,
    ``,
    `When you collapse three repeated reveals into one, the surviving reveal does not stay at one-third the size — it absorbs the dramatic weight of all three. Use the saved space to:`,
    `  • deepen the strongest reveal — render it more vividly, sensorily, emotionally`,
    `  • make the ending land more clearly — add focused closing prose if needed`,
    `  • preserve slow, warm, TTS-friendly narrative texture across the whole story`,
    ``,
    `Solving structural problems by summarizing the story is a FAILURE MODE. The output must remain a finished literary draft of comparable length to the input — not a compressed retelling.`,
    ``,
    `━━━ WHAT YOU MAY DO ━━━`,
    ``,
    `1. COLLAPSE DUPLICATED REVELATIONS — aggressively, but render fully.`,
    `   If two or more discoveries, letters, recordings, notes, conversations, or realizations communicate the same information or the same emotional realization:`,
    `     • Keep the strongest single instance.`,
    `     • Remove the weaker repeated reveal entirely — do not just shorten it.`,
    `     • Re-render the kept reveal as full literary prose — with sensory detail, atmosphere, pacing, and emotional embodiment. Do NOT leave a shortened summary in its place.`,
    `     • Use the freed space to DEEPEN the surviving reveal — let it breathe, complicate, land.`,
    `     • Let later material REACT to or COMPLICATE the revelation, not restate it.`,
    `   "Same realization three times" patterns must end as one moment, carried alone — but carried in full literary form.`,
    ``,
    `2. MERGE REPEATED SEARCH / OBJECT / FIND BEATS — as full prose, not as a summary.`,
    `   If the story stages multiple physical search or find beats with the same dramatic function — room search, cabinet search, basement search, box search, envelope search, drawer search, photograph find — they should be merged into fewer stronger beats. Do not preserve every physical search step unless each one creates a NEW story turn (new information, new emotional shift, new stakes). Otherwise, fold them.`,
    `   The merged beat is not a shorter beat. It is the strongest beat, written in full — texture, breath, gesture, and atmosphere preserved. Removing the duplicates frees space; spend that space on the kept beat, not on cutting the page count.`,
    ``,
    `3. REMOVE DUPLICATE CLOSURE BEATS.`,
    `   If the story ends with multiple quiet closure moments stacked on top of each other — e.g. a basement resolution, then a kitchen tea scene, then a final table silence, then another reflective ending — keep only the STRONGEST closing image. Do not stack several endings. One landing, not four.`,
    ``,
    `4. STRENGTHEN EMOTIONAL CLOSURE.`,
    `   If the supervisor says the ending is open, soft, unresolved, cliff-cut, or not clearly closed:`,
    `     • PREFER adding 1–3 focused closing paragraphs to complete the emotional landing.`,
    `     • Do NOT solve a weak ending by cutting to an earlier ending. Adding closure beats the band-aid of truncation.`,
    `     • Make the final relationship state clearer.`,
    `     • Answer the central emotional question more concretely.`,
    `   Work only from relationships, settings, and emotional notes already established. Do NOT introduce a new plot thread. Do NOT add a twist. Do NOT change the ending tone.`,
    ``,
    `5. REDUCE EXPLANATION LOOPS — without flattening prose.`,
    `   If the text explains the same family conflict, motive, or realization more than once:`,
    `     • Keep the clearest version, in full literary form.`,
    `     • Convert the rest into reaction, silence, gesture, or remove it.`,
    `   Trim narrator-told background that the surrounding scene already implies. Do not replace narration with bald summary — replace it with embodied scene.`,
    ``,
    `6. IMPROVE PACING.`,
    `   Merge repeated middle beats. Reduce duplicated reflection loops. Tighten passages where the story circles the same emotional realization more than once.`,
    ``,
    `━━━ PRIORITIZE SCORE IMPROVEMENT OVER MINIMAL DIFF ━━━`,
    ``,
    `This stage is explicitly a structural repair pass. It is NOT minimal-diff editing.`,
    `You MAY:`,
    `  • remove whole paragraphs that duplicate function`,
    `  • merge adjacent scenes performing the same function`,
    `  • reorder small local beats when it strengthens the build`,
    `  • replace repeated explanation with one stronger scene movement`,
    `  • add a short closing beat when the ending lacks closure`,
    ``,
    `━━━ HARD CONSTRAINTS — NEVER DO ━━━`,
    `  • Do NOT invent new characters.`,
    `  • Do NOT invent new settings.`,
    `  • Do NOT invent new backstory.`,
    `  • Do NOT invent new plot events or twists.`,
    `  • Do NOT change the core premise.`,
    `  • Do NOT change the StoryBible trajectory or the ending tone.`,
    `  • Do NOT flatten literary atmosphere.`,
    `  • Do NOT summarize the story. Structural repair is not a synopsis pass.`,
    `  • Do NOT turn the story into exposition.`,
    `  • Do NOT compress ${originalWords} words into a much shorter retelling. That is a summary failure, not a structural repair.`,
    `  • Do NOT add markdown, headings, segment labels, or meta commentary.`,
    ``,
    `━━━ PRESERVE — non-negotiable ━━━`,
    `  • Literary prose voice and vocabulary level`,
    `  • Slow, calm pacing and TTS-friendly readability`,
    `  • Characters, relationships, settings, decisions, and the causal chain`,
    `  • Atmosphere and sensory texture — consolidate where duplicated, never strip`,
    `  • The genuine final image and any real callback`,
    `  • The original output language`,
    ``,
    `━━━ LENGTH — HARD BAND, NON-NEGOTIABLE ━━━`,
    `Intended duration: ~${durationSec} seconds of spoken audio.`,
    `Word target: ~${targetWords} words.`,
    `The final text MUST remain inside the explicit word band:`,
    `  targetMin = ${targetMin} words (= round(${targetWords} * 0.90))`,
    `  targetMax = ${targetMax} words (= round(${targetWords} * 1.10))`,
    ``,
    `WARNING: A candidate below the minimum word count is INVALID, even if it fixes repetition.`,
    `WARNING: Do not compress ~${originalWords} words into ${Math.round(originalWords * 0.6)} words. That is a summary failure, not a structural repair. Length faithfulness is mandatory.`,
    ``,
    `Removing duplicates frees space. Spend that space by re-rendering kept beats more fully, deepening the strongest reveal, and landing the ending — NOT by emitting a shorter story.`,
    `Do not pad just to hit word count, and do not summarize to fall under it. The output is a finished literary draft sized to the band.`,
    ``,
    `Output language: ${input.outputLanguage}`,
    `Return ONLY valid JSON: {"finalText": "...", "changesSummary": ["...", ...]}. finalText is continuous prose only — no markdown, no headings, no segment labels.`,
  ].join("\n");

  const user = [
    `Apply ONE decisive STRUCTURAL repair pass (V2.1) to the following narrative draft.`,
    ``,
    `Current draft: ~${originalWords} words. Word target: ~${targetWords} (~${durationSec}-second spoken story).`,
    `MANDATORY length band: ${targetMin}–${targetMax} words. Output outside this band is INVALID.`,
    `Latest supervisor score on this draft: ${input.bestScore}.`,
    ``,
    `STRUCTURAL ISSUES FLAGGED BY THE SUPERVISOR:`,
    issueLines,
    ...(notesPreview ? [``, `Supervisor notes: "${notesPreview}"`] : []),
    ``,
    `Resolve the issues above with real cross-scene structural change. Collapse duplicate reveals. Merge repeated search/object beats. Remove duplicate closure beats — keep only the strongest one. Complete the emotional landing if it is open. Do NOT preserve repeated beats just because they are well written. Do NOT change the ending tone, the trajectory, the cast, or the setting.`,
    ``,
    `CRITICAL: This is a FULL-STORY repair pass, not a synopsis. Re-render kept beats as full literary prose — atmosphere, pacing, dialogue texture, emotional embodiment preserved. Use space freed by removed duplicates to deepen the surviving beats and land the ending. Do NOT emit a shortened retelling. A candidate below ${targetMin} words is invalid even if it fixes repetition.`,
    ``,
    `DRAFT:`,
    `---`,
    input.bestText,
    `---`,
    ``,
    `Return JSON: {"finalText": "...", "changesSummary": [...]}.`,
    `changesSummary: name each structural decision in this repair, labeled with one of these tags. Be concrete.`,
    `  GOOD: "[collapse-reveals] consolidated three variants of the same realization into the strongest one — removed the second letter and the band-scene restatement"`,
    `  GOOD: "[merge-search-beats] folded the cabinet, drawer, and envelope searches into a single basement-box find that carries the discovery"`,
    `  GOOD: "[remove-duplicate-ending] kept the lit-window closing image; removed the kitchen tea scene and the final table silence that re-staged the same beat"`,
    `  GOOD: "[closure] added a two-paragraph close completing the mother–daughter reconciliation so the realization lands"`,
    `  GOOD: "[reduce-exposition] converted the two-paragraph family-history explanation at scene 3 into a single reaction line"`,
    `  GOOD: "[pacing] merged two consecutive reflection paragraphs in the middle into one"`,
    `  BAD: "improved structure" / "polished prose" (too vague)`,
    `Allowed tags: [collapse-reveals], [merge-search-beats], [remove-duplicate-ending], [closure], [reduce-exposition], [pacing]. Max 10 items.`,
  ].join("\n");

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
            name: "SoftVibeNarrativeStructuralRepairResult",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                finalText: { type: "string" },
                changesSummary: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: ["finalText", "changesSummary"],
            },
          },
        },
      },
      { timeout: timeoutMs },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[NARRATIVE-STRUCTURAL] failed reason=openai_call_failed:${msg.slice(0, 160)} preset=narrative using=best_text originalWords=${originalWords}`,
    );
    return {
      candidateText: input.bestText,
      changesSummary: ["structural-repair-error: using best_text"],
      attempted: true,
    };
  }

  const rawText = resp.output_text ?? "";
  const respStatus = resp.status ?? "unknown";

  if (respStatus === "incomplete") {
    console.warn(
      `[NARRATIVE-STRUCTURAL] failed reason=response_truncated length=${rawText.length} preset=narrative using=best_text originalWords=${originalWords}`,
    );
    return {
      candidateText: input.bestText,
      changesSummary: ["structural-repair-truncated: using best_text"],
      attempted: true,
    };
  }

  let parsed: { finalText: string; changesSummary: string[] };
  try {
    parsed = JSON.parse(rawText) as {
      finalText: string;
      changesSummary: string[];
    };
  } catch {
    console.warn(
      `[NARRATIVE-STRUCTURAL] failed reason=json_parse_error status=${respStatus} length=${rawText.length} preset=narrative using=best_text originalWords=${originalWords}`,
    );
    return {
      candidateText: input.bestText,
      changesSummary: ["structural-repair-parse-error: using best_text"],
      attempted: true,
    };
  }

  const finalText = (parsed.finalText ?? "").trim();
  if (!finalText) {
    console.warn(
      `[NARRATIVE-STRUCTURAL] failed reason=empty_final_text status=${respStatus} preset=narrative using=best_text originalWords=${originalWords}`,
    );
    return {
      candidateText: input.bestText,
      changesSummary: ["structural-repair-empty: using best_text"],
      attempted: true,
    };
  }

  const rewrittenWords = finalText.split(/\s+/).filter(Boolean).length;
  const deltaPct =
    originalWords > 0
      ? Math.round(((rewrittenWords - originalWords) / originalWords) * 1000) /
        10
      : 0;
  const changesSummary = Array.isArray(parsed.changesSummary)
    ? parsed.changesSummary
    : [];

  // V2.1 hard length-band validation. A structural repair candidate that
  // falls outside ±10% of the wordTarget is structurally invalid regardless
  // of how well it resolved repetition. Returning bestText prevents wasting
  // a supervisor call on a clearly out-of-band candidate.
  if (rewrittenWords < targetMin || rewrittenWords > targetMax) {
    console.warn(
      `[NARRATIVE-STRUCTURAL] failed reason=out_of_length_band rewrittenWords=${rewrittenWords} targetMin=${targetMin} targetMax=${targetMax} originalWords=${originalWords} targetWords=${targetWords} deltaPct=${deltaPct} using=best_text`,
    );
    return {
      candidateText: input.bestText,
      changesSummary: [
        "[fallback] structural repair output outside length band; preserved best text",
      ],
      attempted: true,
    };
  }

  const summaryLine = changesSummary.join(" | ");
  const summaryTruncated =
    summaryLine.length > 500 ? `${summaryLine.slice(0, 500)}…` : summaryLine;

  console.info(
    `[NARRATIVE-STRUCTURAL] preset=narrative model=${model} originalWords=${originalWords} rewrittenWords=${rewrittenWords} deltaPct=${deltaPct} targetWords=${targetWords} targetMin=${targetMin} targetMax=${targetMax} durationSec=${durationSec} changesCount=${changesSummary.length}`,
  );
  console.info(
    `[NARRATIVE-STRUCTURAL] changesSummary=[${summaryTruncated}]`,
  );

  return { candidateText: finalText, changesSummary, attempted: true };
}
