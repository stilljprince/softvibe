// lib/script-builder.ts

export type ScriptPreset = "classic-asmr" | "sleep-story" | "meditation";

export type ScriptInput = {
  preset: ScriptPreset;
  userPrompt: string;
  targetDurationSec?: number; // v3 nutzt das aktiv
  language?: "de" | "en";
};

export type ScriptOutput = {
  finalText: string; // NUR das, was gesprochen wird
  estimatedDurationSec: number;
};

/**
 * v3 Entry Point – neue Version mit:
 * - weicherem ASMR-Rhythmus (Pausen, Zeilen, Ellipsen)
 * - sanften Wiederholungen
 * - "Nähe"-Layer (ohne dass Anweisungen vorgelesen werden)
 * - grober Ziel-Dauer-Anpassung
 */
export function buildScriptV3(input: ScriptInput): ScriptOutput {
  const cleanedPrompt = normalizePrompt(input.userPrompt);
  const target = clampTarget(input.targetDurationSec);

  let base: string;

  switch (input.preset) {
    case "classic-asmr":
      base = buildClassicASMR_v3(cleanedPrompt);
      break;
    case "sleep-story":
      base = buildSleepStory_v3(cleanedPrompt);
      break;
    case "meditation":
      base = buildMeditation_v3(cleanedPrompt);
      break;
    default:
      base = cleanedPrompt;
  }

  // Rhythmus / Pausen / Struktur
  const structured = applyRhythm(base, input.preset);

  // Dauer grob treffen (expand/trim)
  const fitted = fitToTargetDuration(structured, input.preset, target);

  return {
    finalText: fitted,
    estimatedDurationSec: estimateSpokenSeconds(fitted, input.preset),
  };
}

/**
 * Backward-Compat: dein Projekt importiert aktuell buildScriptV2
 * → wir lassen das drin, ruft intern v3 auf.
 */
export function buildScriptV2(input: ScriptInput): { finalText: string } {
  const out = buildScriptV3(input);
  return { finalText: out.finalText };
}

/* ------------------------------------------------------------------ */
/* Helpers */
/* ------------------------------------------------------------------ */

function clampTarget(target?: number): number | undefined {
  if (typeof target !== "number" || !Number.isFinite(target)) return undefined;
  // sinnvoller Rahmen; du kannst das später frei machen
  return Math.max(15, Math.min(1800, Math.round(target)));
}

/**
 * Entfernt explizite "mach das so"-Anteile aus dem Prompt,
 * damit sie NICHT als Text gesprochen werden.
 */
function normalizePrompt(input: string): string {
  const s = (input ?? "").toString();

  // Entferne typische Befehle / Höflichkeits-Formulierungen
  // (nicht perfekt, aber solide v3-Baseline)
  const removed = s
    .replace(/\bflüster(e|n)?\b/gi, "")
    .replace(/\bwhisper\b/gi, "")
    .replace(/\bsprich(e|st)?\b/gi, "")
    .replace(/\berz(ähl|aehl)(e|st)?\b/gi, "")
    .replace(/\bbitte\b/gi, "")
    .replace(/\bkannst du\b/gi, "")
    .replace(/\bwürdest du\b/gi, "")
    .replace(/\bsei\b/gi, "")
    .replace(/\bmach\b/gi, "")
    .replace(/\btu\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return removed.length > 0 ? removed : s.trim();
}

function splitSoft(text: string): string[] {
  if (!text) return [];
  return text
    .split(/[\n\r]+|[.!?]+/g)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Macht Text ASMR-typischer:
 * - kürzere Segmente
 * - mehr Atem / Pausen durch Zeilen & Ellipsen
 */
function applyRhythm(text: string, preset: ScriptPreset): string {
  const lines = splitSoft(text);

  // Für sehr kurze Prompts: nicht leer laufen lassen
  const safe = lines.length ? lines : [text.trim()].filter(Boolean);

  const withPauses = safe.map((l, i) => {
    const base = l.replace(/\s+/g, " ").trim();
    if (!base) return "";

    // leichte Variation je Preset
    const end =
      preset === "classic-asmr"
        ? (i % 2 === 0 ? "…" : ".")
        : preset === "sleep-story"
        ? "."
        : "…";

    // ganz leichte "weiche" Satzöffnung
    const softened =
      preset === "classic-asmr" && base.length < 80 && i % 3 === 0
        ? `Okay… ${base}`
        : base;

    return softened + end;
  });

  // Absätze (mehr Luft)
  const paragraphEvery =
    preset === "sleep-story" ? 3 : preset === "meditation" ? 2 : 2;

  const out: string[] = [];
  for (let i = 0; i < withPauses.length; i++) {
    out.push(withPauses[i]);
    if ((i + 1) % paragraphEvery === 0) out.push(""); // Absatz
  }

  return out.join("\n").trim();
}

function estimateSpokenSeconds(text: string, preset: ScriptPreset): number {
  // grobe WPM Annahmen – für whisper/asmr langsamer
  const wpm =
    preset === "classic-asmr" ? 115 : preset === "sleep-story" ? 135 : 120;

  const words = countWords(text);
  const speaking = (words / wpm) * 60;

  // Pausen durch Ellipsen & Leerzeilen grob addieren
  const ellipses = (text.match(/…/g) ?? []).length;
  const blankLines = (text.match(/\n\s*\n/g) ?? []).length;

  const pauseSec =
    ellipses * 0.35 + // kleine Mikro-Pausen
    blankLines * 0.9; // Absatzpausen

  return Math.max(5, Math.round(speaking + pauseSec));
}

function countWords(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/g).filter(Boolean).length;
}

/**
 * Fit to target duration:
 * - Wenn zu kurz: fügt sanfte Filler + kleine Wiederholungen hinzu
 * - Wenn zu lang: kürzt prompt-nahe Teile zuerst
 */
function fitToTargetDuration(
  text: string,
  preset: ScriptPreset,
  target?: number
): string {
  if (!target) return text;

  let cur = text;
  let curSec = estimateSpokenSeconds(cur, preset);

  // Toleranz: wir versuchen in ~±10% zu landen
  const minOk = Math.floor(target * 0.9);
  const maxOk = Math.ceil(target * 1.1);

  // zu lang → trim
  if (curSec > maxOk) {
    cur = trimToDuration(cur, preset, maxOk);
    curSec = estimateSpokenSeconds(cur, preset);
  }

  // zu kurz → expand
  let guard = 0;
  while (curSec < minOk && guard < 12) {
    cur = expandOnce(cur, preset);
    curSec = estimateSpokenSeconds(cur, preset);
    guard++;
  }

  // final safety trim, falls wir drüber geschossen sind
  if (curSec > maxOk) {
    cur = trimToDuration(cur, preset, maxOk);
  }

  return cur.trim();
}

function expandOnce(text: string, preset: ScriptPreset): string {
  const filler = buildFillerBlock(preset);
  const repeated = repeatSoftKeyLine(text, preset);

  // Reihenfolge: erst etwas „Nähe“, dann leise Wiederholung, dann filler
  return [text.trim(), "", repeated, "", filler].join("\n").trim();
}

function repeatSoftKeyLine(text: string, preset: ScriptPreset): string {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // Nimm eine „kernige“ Zeile (mittlere Länge) zum Wiederholen
  const candidate =
    lines.find((l) => l.length >= 18 && l.length <= 90) ?? lines[0] ?? "";

  if (!candidate) return "";

  const lead =
    preset === "classic-asmr"
      ? "Nur nochmal… ganz ruhig…"
      : preset === "sleep-story"
      ? "Und jetzt… nochmal ganz sanft…"
      : "Ganz langsam…";

  // leichte Variation statt stumpf 1:1
  const alt = candidate
    .replace(/Okay…\s*/i, "")
    .replace(/\.$/, "…")
    .replace(/…+$/, "…");

  return `${lead}\n${alt}`;
}

function buildFillerBlock(preset: ScriptPreset): string {
  if (preset === "classic-asmr") {
    return [
      "Du musst nichts tun…",
      "",
      "Ich bin hier…",
      "Ganz nah…",
      "",
      "Alles ist ruhig…",
      "Alles ist weich…",
    ].join("\n");
  }

  if (preset === "sleep-story") {
    return [
      "Der Tag ist vorbei.",
      "Alles wird leiser.",
      "",
      "Du kannst loslassen.",
      "Ganz langsam.",
      "",
      "Und du darfst sinken…",
    ].join("\n");
  }

  // meditation
  return [
    "Atme ein…",
    "Ganz langsam…",
    "",
    "Und wieder aus…",
    "",
    "Bleib hier…",
    "Nur jetzt…",
  ].join("\n");
}

function trimToDuration(text: string, preset: ScriptPreset, maxSec: number): string {
  // Strategie:
  // - Wir behalten Intro + Outro
  // - Kürzen zuerst „Prompt-Body“ (mittlere Zeilen)
  const lines = text.split("\n");

  const keepHead = Math.min(8, lines.length);
  const keepTail = Math.min(8, Math.max(0, lines.length - keepHead));

  const head = lines.slice(0, keepHead);
  const tail = keepTail > 0 ? lines.slice(lines.length - keepTail) : [];

  // middle: nur sinnvolle, nicht-leere Zeilen
  let middle = lines.slice(keepHead, lines.length - keepTail);

  // harte Kürzung: entferne zuerst Wiederholungs-/Filler-Teile
  middle = middle.filter((l) => {
    const t = l.trim().toLowerCase();
    if (!t) return true;
    if (t.includes("nur nochmal")) return false;
    if (t.includes("du musst nichts")) return false;
    if (t.includes("ich bin hier")) return false;
    if (t.includes("atme")) return false;
    if (t.includes("der tag ist vorbei")) return false;
    return true;
  });

  let out = [...head, ...middle, ...tail].join("\n").trim();

  // falls noch immer zu lang: middle weiter ausdünnen
  let sec = estimateSpokenSeconds(out, preset);
  let guard = 0;

  while (sec > maxSec && guard < 30) {
    const parts = out.split("\n");
    // entferne jede 3. nicht-leere Zeile aus dem Mittelteil
    const filtered: string[] = [];
    let nonEmptyCount = 0;
    for (let i = 0; i < parts.length; i++) {
      const l = parts[i];
      if (l.trim() !== "") nonEmptyCount++;
      if (i > 6 && i < parts.length - 6 && l.trim() !== "" && nonEmptyCount % 3 === 0) {
        continue;
      }
      filtered.push(l);
    }
    out = filtered.join("\n").trim();
    sec = estimateSpokenSeconds(out, preset);
    guard++;
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Preset Builder v3 */
/* ------------------------------------------------------------------ */

function buildClassicASMR_v3(prompt: string): string {
  const p = prompt ? prompt : "Ich bin einfach hier bei dir.";
  return [
    "Hey…",
    "",
    "Ich bin jetzt ganz nah bei dir…",
    "Ganz ruhig…",
    "",
    p,
    "",
    "Du musst nichts tun…",
    "Du kannst einfach zuhören…",
    "",
    "Alles ist ruhig…",
    "Alles ist sanft…",
  ].join("\n").trim();
}

function buildSleepStory_v3(prompt: string): string {
  const p = prompt ? prompt : "Stell dir einen ruhigen Ort vor.";
  return [
    "Es ist Abend.",
    "",
    "Der Tag ist vorbei.",
    "",
    p,
    "",
    "Die Welt wird leiser.",
    "Deine Gedanken dürfen langsamer werden.",
    "",
    "Und du darfst einschlafen…",
  ].join("\n").trim();
}

function buildMeditation_v3(prompt: string): string {
  const p = prompt ? prompt : "Spür einfach deinen Atem.";
  return [
    "Atme langsam ein…",
    "",
    p,
    "",
    "Und wieder aus…",
    "",
    "Bleib ganz hier…",
    "Mehr brauchst du gerade nicht…",
  ].join("\n").trim();
}