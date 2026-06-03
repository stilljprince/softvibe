// lib/script-builder-normalize.ts
//
// Defense against OpenAI returning nested/wrapped JSON for the final story text.
//
// The structured `json_schema` output of buildScriptOpenAI guarantees the OUTER
// envelope is `{"finalText": <string>}`, but for kids-story the model has been
// observed to put another stringified `{"finalText":"..."}` envelope INSIDE
// that string (and occasionally a malformed, unclosed one). When the raw value
// reaches ElevenLabs, the narrator literally speaks "finalText" and the JSON
// punctuation, producing a P0 content bug.
//
// This normalizer unwraps such envelopes recursively (well-formed via
// JSON.parse, malformed via a conservative label strip) and otherwise leaves
// plain story text untouched.

export function normalizeFinalText(input: unknown): string {
  if (typeof input !== "string") return "";
  let text = input.trim();
  if (!text) return "";

  for (let i = 0; i < 6; i++) {
    const before = text;

    if (text.startsWith("{") && text.includes("finalText")) {
      const inner = tryUnwrapJsonFinalText(text);
      if (inner !== null) {
        text = inner.trim();
        if (text !== before) continue;
      }
    }

    // Conservative label strip for malformed wrappers that JSON.parse can't
    // recover (e.g. `{"finalText":"…` with unescaped inner quotes). The regex
    // is anchored at the start and requires the literal word `finalText`, so
    // ordinary story text starting with any other character is never altered.
    const labelMatch = text.match(/^\s*\{?\s*"?finalText"?\s*:\s*"?/i);
    if (labelMatch && labelMatch[0].length > 0) {
      const opened = labelMatch[0];
      const hadOpenQuote = /"\s*$/.test(opened);
      const hadOpenBrace = /\{/.test(opened);
      let stripped = text.slice(opened.length);
      if (hadOpenQuote) {
        stripped = stripped.replace(/"\s*\}?\s*$/, "");
      } else if (hadOpenBrace) {
        stripped = stripped.replace(/\s*\}\s*$/, "");
      }
      text = stripped.trim();
      if (text !== before) continue;
    }

    break;
  }

  return text;
}

function tryUnwrapJsonFinalText(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const v = (parsed as Record<string, unknown>).finalText;
      if (typeof v === "string") return v;
    }
  } catch {
    // not parseable — caller will fall back to label-strip
  }
  return null;
}
