// lib/script-builder-openai.ts
import OpenAI from "openai";
import type { ScriptInput, ScriptPreset } from "@/lib/script-builder";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function clampTarget(target?: number): number {
  if (typeof target !== "number" || !Number.isFinite(target)) return 60;
  return Math.max(15, Math.min(1800, Math.round(target)));
}

function wordTargetFor(preset: ScriptPreset, durationSec: number): number {
  // Sleep story eher 130–160 wpm → 2.2–2.7 wps
  // aber wir nehmen einen festen Sicherheitsaufschlag, damit es nicht zu kurz wird.
  const wps =
    preset === "sleep-story" ? 2.6 :
    preset === "classic-asmr" ? 2.1 :
    2.0;

  const base = Math.round(durationSec * wps);

  // Safety: sleep-story nie unter Mindestwortzahl
  if (preset === "sleep-story") {
    return Math.max(base, 1400); // für 10 Min: ~1560, Minimum 1400
  }
  return base;
}

export async function buildScriptOpenAI(input: ScriptInput & { language: "de" | "en" }): Promise<{ finalText: string }> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const durationSec = clampTarget(input.targetDurationSec);
  const wordTarget = wordTargetFor(input.preset, durationSec);
  const userPrompt = (input.userPrompt ?? "").trim();
 

  const presetStyle =
  input.preset === "classic-asmr"
    ? "Positive Affirmations im ASMR-Stil (nah, direkt, warm). Du sprichst die hörende Person mit 'du' an. Zuspruch und Nähe sind erlaubt (z.B. 'ich bin hier', 'ich glaube an dich'). Keine Poesie, keine Metaphern, keine Naturbilder."
   : input.preset === "sleep-story"
? "Sleep story with a coherent plot, third-person narration by default, gentle pacing, clear ending. No direct address unless explicitly requested."
    : "Meditation (ruhig, minimalistisch). Nur sehr sparsam Atemhinweise, keine Wiederholungs-Loops";


const baseSystem = `
You write complete, spoken scripts for audio (ASMR / calming speech / sleep content).

CRITICAL RULES:
- Output language MUST exactly match the selected language.
- The user prompt is ONLY a theme. Never reference it.
- Do NOT summarize, explain or comment on the prompt.
- Do NOT sound poetic, abstract or symbolic unless requested.
- Avoid list-like rhythm. Vary sentence length naturally.
- Allow pauses by using line breaks, not punctuation spam.
- No filler loops. No coaching phrases.
- Do NOT include bracket tags like [whispers], [softly], etc.

OUTPUT FORMAT:
Return ONLY valid JSON: {"finalText": "..."}.
`.trim();

const presetSystem =
  input.preset === "sleep-story"
    ? `
SLEEP STORY MODE (default: third person narration):
- Do NOT address the listener directly ("you") unless the user explicitly asks for 2nd-person narration.
- Use third-person narration by default (he/she/they + a named protagonist).
- The story must be logically consistent, with a clear thread from beginning to end.
- No sudden time/location jumps unless they are smoothly motivated.
- Gentle tension is allowed, but it must be mild and resolved calmly.
- Must have a real ending: protagonist returns to safety and can rest. End with: "Good night."
- Do NOT say "the story is finished" or any meta-commentary.

STRUCTURE (must follow):
1) Title line (short, evocative).
2) Setup: who/where/when (calm).
3) Gentle objective/curiosity.
4) Three small steps with a soft, repetitive rhythm.
5) Resolution and return to safety.
6) Closing: protagonist relaxes and can rest now. Good night.
`.trim()
    : input.preset === "classic-asmr"
    ? `
CLASSIC ASMR MODE:
- Direct personal address ("du/you") is allowed and encouraged.
- Close, warm, reassuring. No poetry, no metaphors unless requested.
- Human, casual intimacy. Natural pauses. No self-help lecture tone.
`.trim()
    : `
MEDITATION MODE:
- Minimalist, calm, neutral.
- Avoid strong emotional swings.
- No direct coaching loops or repetitive instruction patterns.
`.trim();

const system = `${baseSystem}\n\n${presetSystem}`.trim();

const outputLanguage =
  input.language === "en" ? "English" : "German";
console.log("[buildScriptOpenAI] outputLanguage=", outputLanguage);
const user = `
Selected output language: ${outputLanguage}

Preset: ${input.preset}
Style description:
${presetStyle}

Word target: ${wordTarget} words (±5%)

Important language rule:
- The theme may be written in ANY language.
- You MUST understand the theme.
- You MUST write the final script entirely in ${outputLanguage}.

Tone requirements:
- Calm, reassuring, personal.
- Simple language.
- No metaphors, symbols or abstract imagery.
- Short and medium sentences mixed naturally.
- It must sound like a real person speaking slowly and gently.

${input.preset === "sleep-story" ? `
Sleep story requirements:
- Third-person narration (no "you") unless explicitly requested.
- Start with a short title line.
- Keep one continuous plot thread.
- Ensure a gentle ending with the protagonist safely resting.
` : ""}

Theme (for understanding only, NEVER reference directly):
${userPrompt}

Length requirements (VERY IMPORTANT):
- Target length: ${wordTarget} words (±5%).
- If you are unsure, write LONGER rather than shorter.
- Do NOT end early.
- The story MUST contain a clear beginning, middle, and a gentle ending.
- Keep continuity: names, places, objects must remain consistent.
- Minimum length: ${Math.round(wordTarget * 5)} characters (approx).

Formatting rules:
- Do NOT use ellipses (...) or the single-character ellipsis (…).
- Do NOT use em dashes (—).
- Prefer short sentences and line breaks for pauses.

Write a complete, spoken script.
Return ONLY JSON.
`.trim();

  const resp = await openai.responses.create({
  model: "gpt-4o-mini", // oder "gpt-4o-2024-08-06"
  input: [
    { role: "system", content: system },
    { role: "user", content: user },
  ],
  text: {
    format: {
      type: "json_schema",
      name: "SoftVibeFinalText",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          finalText: { type: "string" },
        },
        required: ["finalText"],
      },
    },
  },
});

  const parsed = JSON.parse(resp.output_text) as { finalText: string };
  const finalText = (parsed.finalText ?? "").trim();
  if (!finalText) throw new Error("OpenAI returned empty finalText");

  return { finalText };
}
