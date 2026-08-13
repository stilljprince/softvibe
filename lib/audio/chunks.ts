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
//   - Mini-tail post-pass: if the FINAL chunk is noticeably smaller than maxLen
//     AND merging it back into the previous chunk still respects maxLen, merge.
//     Otherwise leave it — natural endings stay natural, the hard limit wins.

const FALLBACK_MAX_CHARS = 3100;

// Real ElevenLabs TTS requests must stay much closer to maxLen than the
// general-purpose default (1.2) allows. At maxLen=4000, the default let a
// sentence-end extension reach up to ~4800 chars — real production requests
// hit 4461-4777 chars this way and reproducibly timed out. Pass this to
// splitToChunksSafe for any real TTS request so the extension window stays
// small (~4040-4080 at maxLen=4000) while still preferring a sentence end
// over a mid-sentence cut. (RP-011C.2 follow-up.)
export const TTS_REQUEST_MAX_OVERSHOOT = 1.02;

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
  minChunkLen = 200,
  miniTailThreshold: number = Math.floor(maxLen * 0.4)
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

  // Conservative mini-tail post-pass.
  // Only the FINAL chunk is considered. If it is noticeably smaller than
  // maxLen (< miniTailThreshold) AND merging it into the previous chunk
  // would still respect maxLen, merge. Otherwise leave it alone so we
  // never violate the hard character limit and never redistribute
  // sentences across chunks.
  if (result.length >= 2) {
    const lastIdx = result.length - 1;
    const last = result[lastIdx];
    const prev = result[lastIdx - 1];
    const joiner = "\n\n";
    if (
      last.length < miniTailThreshold &&
      prev.length + joiner.length + last.length <= maxLen
    ) {
      result[lastIdx - 1] = prev + joiner + last;
      result.pop();
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// RP-011C.2 — Post-Prosody TTS Payload Guard
//
// splitToChunksSafe() bounds chunk length BEFORE preset/voice prosody
// transformations run (see lib/tts/prosody-v3.ts, applied downstream in the
// TTS pipeline). Those transformations insert "[tag]" markers per sentence
// and paragraph, and can grow a chunk well past its pre-prosody size. Real
// production QA reproduced this: a classic-asmr chunk measured 3800 chars
// pre-prosody but 4488 chars in the actual ElevenLabs request, close to the
// TTS timeout ceiling.
//
// This is a second, smaller ceiling checked against the FINAL text right
// before the ElevenLabs request, reusing splitToChunksSafe so there is no
// duplicate splitting logic anywhere in the codebase.
const POST_PROSODY_FALLBACK_MAX_CHARS = 4000;

export function getPostProsodyMaxChars(): number {
  const fromEnv = parseInt(
    process.env.TTS_POST_PROSODY_MAX_CHARS ?? "",
    10
  );
  return Number.isFinite(fromEnv) && fromEnv > 0
    ? fromEnv
    : POST_PROSODY_FALLBACK_MAX_CHARS;
}

// Applies the post-prosody guard to a single, fully-prepared TTS payload
// (post-chunking, post-prosody, post any other text transformation).
//
//   - Empty input -> [].
//   - Within maxLen -> [text] unchanged (trimmed), no split.
//   - Over maxLen -> split further via splitToChunksSafe (same punctuation-
//     aware splitter, same strict TTS overshoot), preserving order with no
//     text loss or duplication.
export function ensureTtsPayloadWithinLimit(
  text: string,
  maxLen: number = getPostProsodyMaxChars()
): string[] {
  const clean = (text ?? "").trim();
  if (!clean) return [];
  if (clean.length <= maxLen) return [clean];
  return splitToChunksSafe(clean, maxLen, TTS_REQUEST_MAX_OVERSHOOT);
}
