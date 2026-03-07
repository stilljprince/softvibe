// lib/audio/chunks.ts
//
// Punctuation-aware text splitter for TTS pipelines.
//
// ElevenLabs has a per-request character limit. This module reads that limit
// from ELEVENLABS_MAX_CHARS_PER_REQUEST (env) and uses a safe conservative
// default when the env var is absent.
//
// splitToChunksSafe guarantees:
//   - No chunk exceeds maxLen (or maxLen * maxOvershoot to reach a sentence end)
//   - Never cuts mid-word
//   - Prefers natural split points in priority order:
//       1) paragraph break (\n\n)
//       2) sentence end  (. ! ?)
//       3) clause boundary (, ; :)
//       4) extend up to maxLen * maxOvershoot to reach the NEXT sentence end
//       5) word boundary (space) as last resort
//   - Tiny chunks (< minChunkLen chars) are merged into the previous chunk

const FALLBACK_MAX_CHARS = 2500;

export function getMaxCharsPerRequest(): number {
  const fromEnv = parseInt(
    process.env.ELEVENLABS_MAX_CHARS_PER_REQUEST ?? "",
    10
  );
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : FALLBACK_MAX_CHARS;
}

export function splitToChunksSafe(
  text: string,
  maxLen: number = getMaxCharsPerRequest(),
  maxOvershoot = 1.2,
  minChunkLen = 200
): string[] {
  const clean = (text ?? "").trim();
  if (!clean) return [];
  if (clean.length <= maxLen) return [clean];

  const extendedLen = Math.floor(maxLen * maxOvershoot);
  const parts: string[] = [];
  let remaining = clean;

  while (remaining.length > maxLen) {
    let cut = -1;

    // Priority 1: paragraph break (\n\n) at or before maxLen
    // cut is the position of the first \n — trim() handles trailing whitespace
    const paraPos = remaining.lastIndexOf("\n\n", maxLen);
    if (paraPos > 0) {
      cut = paraPos;
    }

    // Priority 2: sentence end (. ! ?) + whitespace at or before maxLen
    if (cut < 0) {
      const dotPos = Math.max(
        remaining.lastIndexOf(". ", maxLen),
        remaining.lastIndexOf("! ", maxLen),
        remaining.lastIndexOf("? ", maxLen),
        remaining.lastIndexOf(".\n", maxLen),
        remaining.lastIndexOf("!\n", maxLen),
        remaining.lastIndexOf("?\n", maxLen)
      );
      if (dotPos > 0) {
        cut = dotPos + 1; // include the punctuation in the chunk
      }
    }

    // Priority 3: clause boundary (, ; :) + whitespace at or before maxLen
    if (cut < 0) {
      const clausePos = Math.max(
        remaining.lastIndexOf(", ", maxLen),
        remaining.lastIndexOf("; ", maxLen),
        remaining.lastIndexOf(": ", maxLen)
      );
      if (clausePos > 0) {
        cut = clausePos + 1; // include the punctuation in the chunk
      }
    }

    // Priority 4: extend up to maxLen * maxOvershoot to find the NEXT sentence end
    if (cut < 0) {
      const extended = remaining.slice(0, extendedLen);
      const nextDot = Math.max(
        extended.indexOf(". ", maxLen),
        extended.indexOf("! ", maxLen),
        extended.indexOf("? ", maxLen),
        extended.indexOf(".\n", maxLen),
        extended.indexOf("!\n", maxLen),
        extended.indexOf("?\n", maxLen)
      );
      if (nextDot > 0 && nextDot < extendedLen) {
        cut = nextDot + 1; // include the punctuation
      }
    }

    // Priority 5: word boundary (space) — never cut mid-word
    if (cut < 0) {
      const spacePos = remaining.lastIndexOf(" ", maxLen);
      if (spacePos > 0) {
        cut = spacePos;
      }
    }

    // Absolute fallback: hard cut at maxLen (should almost never happen)
    if (cut <= 0) {
      cut = maxLen;
    }

    const chunk = remaining.slice(0, cut).trim();
    if (chunk) parts.push(chunk);
    remaining = remaining.slice(cut).trim();
  }

  if (remaining) parts.push(remaining);

  // Merge tiny trailing chunks into the previous chunk to avoid
  // very short audio segments that may produce artifacts.
  const result: string[] = [];
  for (const part of parts) {
    if (result.length > 0 && part.length < minChunkLen) {
      result[result.length - 1] = result[result.length - 1] + "\n\n" + part;
    } else {
      result.push(part);
    }
  }

  return result;
}
