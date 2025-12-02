// lib/title.ts

export function makeTitleFromPrompt(
  prompt: unknown,
  fallback = "SoftVibe Track"
): string {
  if (typeof prompt !== "string") return fallback;

  const s = prompt.trim();
  if (!s) return fallback;

  // nur erste Zeile nehmen
  const firstLine = s.split(/\r?\n/)[0]?.trim() ?? "";
  if (!firstLine) return fallback;

  let title = firstLine;
  // ein bisschen „aufräumen“
  title = title.replace(/\s+/g, " ");

  if (title.length > 80) {
    title = title.slice(0, 77) + "…";
  }

  return title || fallback;
}