// lib/library/qa-audio-storage.ts
//
// RP-004E1-QA — Private local Curated-Library audio for development QA.
//
// A LibrarySessionChapter.audioKey that begins with the deterministic
// prefix `.storage/qa-library/` is a *private* development-only object
// seeded by scripts/seed-library-qa.ts. Those bytes must be served
// locally from `${cwd}/.storage/qa-library/…` and NEVER sent to S3 — the
// key exists specifically to exercise the protected audio pipeline
// without polluting the production R2/S3 bucket.
//
// This module owns the storage-routing decision. The chapter-audio
// route asks `isQaLibraryAudioKey(audioKey)` first; a positive answer
// unconditionally selects the QA reader (never S3) and a negative
// answer preserves the existing S3 / local-fallback behaviour for
// ordinary production audio keys.
//
// Production safety (fail-closed):
//
//   * Every QA read requires `NODE_ENV !== "production"`. A production
//     environment refuses the read even if a QA key somehow reached it
//     — the response is a plain 404 with no filesystem detail.
//   * The resolved absolute path is verified to sit *inside*
//     `${cwd}/.storage/qa-library/` before any `fs.stat`/`fs.open`
//     call. A traversal segment (`..`), a URL, an absolute key or a
//     backslash-based key is rejected before hitting the filesystem.
//   * The resolver returns `null` on any rejection; the caller emits a
//     stable 404 without leaking whether the failure was policy or
//     absent file.
//
// This helper is intentionally free of route / request concerns so
// scripts/test-library-qa-access-mode.ts can exercise every branch
// without spinning up the Next.js runtime.

import path from "node:path";
import fs from "node:fs/promises";

/**
 * Deterministic key prefix under which QA-seeded Curated Library
 * chapters are stored. Kept identical to `QA_STORAGE_DIR` in
 * `scripts/seed-library-qa.ts` so the seed and this reader cannot
 * drift apart. A trailing slash is REQUIRED — a key of literally
 * `.storage/qa-library` (no slash) would be treated as production
 * data by design.
 */
export const QA_LIBRARY_AUDIO_KEY_PREFIX = ".storage/qa-library/";

/**
 * Return true iff `audioKey` is exactly a private QA Library key. The
 * check is intentionally strict: it never accepts absolute paths, URLs
 * or traversal segments, and never accepts leading whitespace / slash
 * variants that might normalise into the same directory later.
 *
 *   accepted  : ".storage/qa-library/rain_soft_diffuse.mp3"
 *   rejected  : "/.storage/qa-library/…"
 *               "public/.storage/qa-library/…"
 *               ".storage/qa-library"        (no trailing slash)
 *               ".storage/qa-library/../etc/passwd"
 *               ".storage/qa-library/\0"     (NUL byte)
 */
export function isQaLibraryAudioKey(audioKey: string): boolean {
  if (typeof audioKey !== "string") return false;
  if (audioKey.length === 0) return false;
  if (!audioKey.startsWith(QA_LIBRARY_AUDIO_KEY_PREFIX)) return false;
  // Reject `.storage/qa-library/` on its own — an empty filename is
  // never a real object and would resolve to the directory itself.
  if (audioKey.length === QA_LIBRARY_AUDIO_KEY_PREFIX.length) return false;
  // Reject any traversal segment or NUL byte anywhere in the key.
  if (audioKey.includes("..")) return false;
  if (audioKey.includes("\0")) return false;
  // Reject backslashes — the deployment target is POSIX and a Windows
  // path separator has no legitimate place in a persisted audioKey.
  if (audioKey.includes("\\")) return false;
  return true;
}

/**
 * Absolute directory containing every private QA Library audio file
 * for a given working directory. Split out so tests can point the
 * resolver at a temporary root without touching the real repo layout.
 */
export function qaLibraryRootAbs(cwd: string = process.cwd()): string {
  return path.resolve(cwd, QA_LIBRARY_AUDIO_KEY_PREFIX);
}

export type QaLibraryResolveError =
  | "PRODUCTION_DISABLED"
  | "INVALID_KEY"
  | "OUTSIDE_ROOT";

export type QaLibraryResolveResult =
  | { ok: true; absPath: string }
  | { ok: false; error: QaLibraryResolveError };

/**
 * Resolve a `.storage/qa-library/…` audioKey to an absolute filesystem
 * path, or refuse the request. Never touches the filesystem — a
 * successful resolution only means the path is inside the QA root and
 * the environment allows the read. The caller runs the final `stat`
 * separately so a missing file surfaces as a normal 404.
 *
 *   * `NODE_ENV === "production"` → PRODUCTION_DISABLED. Callers must
 *     translate this to a stable 404 (never to a 5xx and never to a
 *     production S3 fallback).
 *   * A key that fails `isQaLibraryAudioKey` → INVALID_KEY.
 *   * A key that normalises OUTSIDE the QA root → OUTSIDE_ROOT. This
 *     is defensive-in-depth against traversal segments hidden behind
 *     symlinks or unusual path components.
 */
export function resolveQaLibraryAudioPath(
  audioKey: string,
  opts: {
    cwd?: string;
    env?: Record<string, string | undefined>;
  } = {}
): QaLibraryResolveResult {
  const env = opts.env ?? process.env;
  if (env.NODE_ENV === "production") {
    return { ok: false, error: "PRODUCTION_DISABLED" };
  }
  if (!isQaLibraryAudioKey(audioKey)) {
    return { ok: false, error: "INVALID_KEY" };
  }
  const cwd = opts.cwd ?? process.cwd();
  const root = qaLibraryRootAbs(cwd);
  // Resolve the audioKey against cwd (never against `/`) so an
  // absolute-looking `.storage/qa-library/…` key that somehow slipped
  // past `isQaLibraryAudioKey` cannot escape the working tree.
  const abs = path.resolve(cwd, audioKey);
  // `path.resolve` collapses `..` segments; enforce that the resolved
  // path is a strict descendant of the QA root — starting with
  // `${root}${sep}` prevents a trickled prefix match against
  // `${root}-something/…`.
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (!abs.startsWith(rootWithSep)) {
    return { ok: false, error: "OUTSIDE_ROOT" };
  }
  return { ok: true, absPath: abs };
}

/**
 * Convenience wrapper for the caller (chapter-audio route). Combines
 * `resolveQaLibraryAudioPath` with an `fs.stat` and returns the total
 * byte length on success. A refused resolution or a missing file
 * both surface as `null` — the caller returns a stable 404 without
 * distinguishing the two, matching how the S3 branch treats "missing
 * object" today.
 */
export async function statQaLibraryAudio(
  audioKey: string,
  opts: {
    cwd?: string;
    env?: Record<string, string | undefined>;
  } = {}
): Promise<{ absPath: string; size: number } | null> {
  const resolved = resolveQaLibraryAudioPath(audioKey, opts);
  if (!resolved.ok) return null;
  try {
    const st = await fs.stat(resolved.absPath);
    if (!st.isFile()) return null;
    return { absPath: resolved.absPath, size: st.size };
  } catch {
    return null;
  }
}
