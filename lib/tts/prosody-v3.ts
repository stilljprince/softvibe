// lib/tts/prosody-v3.ts

export type ScriptPreset = "classic-asmr" | "sleep-story" | "meditation";

function hashToFloat(seed: string) {
  // deterministische Pseudo-Random (0..1)
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // unsigned
  const u = (h >>> 0) / 4294967295;
  return u;
}

function pick<T>(arr: T[], r: number) {
  const idx = Math.floor(r * arr.length);
  return arr[Math.max(0, Math.min(arr.length - 1, idx))];
}

function normalizeForV3(text: string) {
  // v3: Absätze sind gut. Ellipsen nicht übertreiben.
  // Entferne übermäßige Ellipsen-Folgen und komische Trennstriche.
  return text
    .replace(/[–—]/g, ",")        // lange Dashes -> Komma (stabiler)
    .replace(/\.{4,}/g, "…")      // .... -> …
    .replace(/…{2,}/g, "…")       // …… -> …
    .replace(/\n{3,}/g, "\n\n")   // max 1 Leerabsatz
    .trim();
}

function alreadyHasTag(line: string) {
  return /^\s*\[[^\]]+\]/.test(line);
}

function sentimentHint(line: string) {
  const s = line.toLowerCase();

  // sehr grobe Heuristik: reicht für "script-following"
  if (/(i'm proud|i'm happy|i love|that's nice|perfect|i like|glad|so good)/.test(s)) return "positive";
  if (/(i'm sorry|hard|tough|overwhelmed|anxious|panic|scared|alone|hurt)/.test(s)) return "comfort";
  if (/(funny|ridiculous|can't help|made me smile|i laughed)/.test(s)) return "amused";
  if (/(listen|look|notice|imagine|picture|story|once upon|then|suddenly)/.test(s)) return "narrative";
  if (/(breathe|inhale|exhale|relax|let go|slowly)/.test(s)) return "meditative";
  return "neutral";
}

function tagsForPreset(preset: ScriptPreset) {
  if (preset === "classic-asmr") {
    return {
      opener: ["[whispers]", "[whispers]", "[softly]"],
      positive: ["[smiling]", "[warmly]", "[fondly]"],
      comfort: ["[gentle]", "[reassuring]", "[softly]"],
      amused: ["[amused]", "[chuckles]"],
      neutral: ["[whispers]", "[softly]", "[warmly]"],
      paragraphChance: 0.75,  // ASMR darf dichter sein
      sentenceChance: 0.35,
      maxChucklesPer250w: 3,
    };
  }

  if (preset === "sleep-story") {
    return {
      opener: ["[softly]", "[hushed]", "[whispers]"],
      positive: ["[tenderly]", "[warmly]"],
      comfort: ["[softly]", "[reassuring]"],
      amused: ["[amused]", "[soft chuckle]"],
      neutral: ["[softly]", "[quietly]", "[hushed]"],
      paragraphChance: 0.45,
      sentenceChance: 0.18,
      maxChucklesPer250w: 1,
    };
  }

  // meditation
  return {
    opener: ["[calm]", "[softly]"],
    positive: ["[calm]"],
    comfort: ["[calm]", "[softly]"],
    amused: ["[calm]"], // praktisch nie amused
    neutral: ["[calm]", "[softly]"],
    paragraphChance: 0.22,
    sentenceChance: 0.08,
    maxChucklesPer250w: 0,
  };
}

export function applyV3Prosody(opts: {
  preset: ScriptPreset;
  text: string;
  seed?: string; // z.B. job.id (damit gleiche Inputs gleiche Tag-Pattern geben)
}): string {
  const preset = opts.preset;
  const base = normalizeForV3(opts.text ?? "");
  if (!base) return base;

  const cfg = tagsForPreset(preset);

  const paragraphs = base.split(/\n\s*\n/);
  let chucklesUsed = 0;

  const out = paragraphs.map((p, pi) => {
    const lines = p.split("\n").map((x) => x.trim()).filter(Boolean);
    if (lines.length === 0) return "";

    // Absatz-Start Tag (häufig bei ASMR)
    const seed0 = `${opts.seed ?? "seed"}|p:${pi}|a`;
    const r0 = hashToFloat(seed0);

    const addParagraphTag = r0 < cfg.paragraphChance && !alreadyHasTag(lines[0]);
    if (addParagraphTag) {
      const tag = pick(cfg.opener, r0);
      lines[0] = `${tag} ${lines[0]}`;
    }

    // Satz-level tags (gezielt, “script-following”)
    const joined = lines.join(" ");
    const sentences = joined
      .split(/(?<=[.!?…])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const decorated = sentences.map((s, si) => {
      if (alreadyHasTag(s)) return s;

      const seed1 = `${opts.seed ?? "seed"}|p:${pi}|s:${si}`;
      const r1 = hashToFloat(seed1);

      // v3 wird instabil wenn du jeden Satz taggst -> wir nehmen Wahrscheinlichkeit + Kontext
      const hint = sentimentHint(s);
      const wantsTag = r1 < cfg.sentenceChance;

      // zusätzlich: wenn der Satz sehr “emotional” ist, etwas höheres Gewicht (ohne intensity slider)
      const emotionalBoost =
        hint === "positive" || hint === "comfort" || hint === "amused"
          ? 0.12
          : 0.0;

      const willTag = wantsTag || r1 < (cfg.sentenceChance + emotionalBoost);

      if (!willTag) return s;

      if (hint === "amused") {
        // Chuckles hart limitieren (sonst wird’s clowny)
        const words = base.split(/\s+/).length;
        const budget = Math.max(0, Math.floor((words / 250) * cfg.maxChucklesPer250w));
        if (chucklesUsed >= budget) {
          const tag = pick(cfg.neutral, r1);
          return `${tag} ${s}`;
        }
        chucklesUsed++;
        const tag = pick(cfg.amused, r1);
        return `${tag} ${s}`;
      }

      const tagPool =
        hint === "positive" ? cfg.positive :
        hint === "comfort" ? cfg.comfort :
        hint === "meditative" ? cfg.neutral :
        hint === "narrative" ? cfg.neutral :
        cfg.neutral;

      const tag = pick(tagPool, r1);
      return `${tag} ${s}`;
    });

    return decorated.join("\n"); // line breaks als Pausen
  });

  return out.filter(Boolean).join("\n\n");
}