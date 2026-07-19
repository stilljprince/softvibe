// app/api/library/chapters/[id]/audio/route.ts
//
// RP-010 Phase 4C — Curated Library chapter audio streaming.
//
// GET and HEAD stream the audio bytes of a single curated
// LibrarySessionChapter — but only after resolveLibraryAudioAccess
// grants the current caller access. The route contains no plan / unlock
// logic itself; that lives in lib/entitlement/library-audio-access.ts and
// is exercised by scripts/test-library-audio-access.ts.
//
// A refused caller never triggers a storage read, and a successful
// response is served with `Cache-Control: private, no-store` so a
// previously authorized Free stream can never be replayed to a later
// caller from an intermediary cache.
//
// The audio key (S3 key or local file path suffix) is a server-only
// value. It is looked up server-side per request and is never surfaced
// to the client — a curated chapter is only ever streamed by having
// the client re-hit this authorized endpoint.

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import fs from "node:fs/promises";
import path from "node:path";
import { cookies, headers } from "next/headers";
import { log } from "@/lib/log";
import { jsonError } from "@/lib/api";
import {
  hasS3Env,
  headObjectByKey,
  getObjectByKey,
  getObjectByKeyRange,
} from "@/lib/s3";
import {
  resolveLibraryAudioAccess,
  httpStatusForAccessError,
  type LibraryAudioAccessResult,
} from "@/lib/entitlement/library-audio-access";
import {
  isQaLibraryAudioKey,
  statQaLibraryAudio,
} from "@/lib/library/qa-audio-storage";
import {
  LIBRARY_QA_MODE_COOKIE_NAME,
  resolveLibraryEffectiveAccess,
} from "@/lib/entitlement/library-effective-access";

export const runtime = "nodejs";

// ─── HTTP mapping ──────────────────────────────────────────────────────────

/**
 * Build a jsonError response for a refused authorization outcome. Never
 * leaks the internal audioKey — the resolver only returns audioKey on
 * successful outcomes anyway.
 */
function accessErrorResponse(
  result: Extract<LibraryAudioAccessResult, { ok: false }>
) {
  return jsonError(result.error, httpStatusForAccessError(result.error));
}

// ─── streaming helpers (mirrors app/api/jobs/[id]/audio/route.ts) ─────────

type RangeResult =
  | { kind: "none" }
  | { kind: "range"; start: number; end: number }
  | { kind: "invalid" };

function parseRangeHeader(
  rangeHeader: string | null,
  total: number
): RangeResult {
  if (!rangeHeader) return { kind: "none" };

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return { kind: "invalid" };

  const startStr = match[1];
  const endStr = match[2];

  let start: number;
  let end: number;

  if (startStr === "") {
    if (endStr === "") return { kind: "invalid" };
    const suffix = parseInt(endStr, 10);
    if (suffix === 0) return { kind: "invalid" };
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = parseInt(startStr, 10);
    end = endStr === "" ? total - 1 : parseInt(endStr, 10);
    if (end >= total) end = total - 1;
    if (start > end || start >= total) return { kind: "invalid" };
  }

  return { kind: "range", start, end };
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  return copy.buffer;
}

function hasTransformToByteArray(
  body: unknown
): body is { transformToByteArray: () => Promise<Uint8Array> } {
  return (
    !!body &&
    typeof (body as { transformToByteArray?: unknown }).transformToByteArray ===
      "function"
  );
}
function isAsyncIterable(body: unknown): body is AsyncIterable<unknown> {
  return (
    !!body &&
    typeof (body as { [Symbol.asyncIterator]?: unknown })[
      Symbol.asyncIterator
    ] === "function"
  );
}
async function concatAsyncIterable(
  body: AsyncIterable<unknown>
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const part of body) {
    if (part instanceof Uint8Array) chunks.push(part);
    else if (typeof part === "string")
      chunks.push(new TextEncoder().encode(part));
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/**
 * Local-file fallback. When S3 is not configured the audioKey is treated
 * as a relative path under process.cwd() — same convention the existing
 * jobs / tracks routes use for the local fallback path. Absolute /
 * traversal keys are rejected as a defensive measure; the curated
 * dataset must not carry `..` segments.
 */
function localAbsForAudioKey(audioKey: string): string | null {
  const safe = audioKey.replace(/^\/+/, "");
  if (safe.includes("..")) return null;
  return path.join(process.cwd(), safe);
}

// ─── auth + resolver plumbing ─────────────────────────────────────────────

async function currentUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const id = session?.user?.id;
  return typeof id === "string" && id !== "" ? id : null;
}

/**
 * Load the caller's effective Library-access snapshot from the QA
 * cookie (dev-only, admin-only, feature-flag-gated) and hand it to the
 * shared audio-access resolver. When the caller is unauthenticated or
 * missing, returns `undefined` so `resolveLibraryAudioAccess` falls
 * back to its ordinary plan-based logic — legacy tests keep working.
 */
async function currentEffectiveAccess(userId: string | null) {
  if (!userId) return undefined;
  const cookieStore = await cookies();
  const qaModeCookie =
    cookieStore.get(LIBRARY_QA_MODE_COOKIE_NAME)?.value ?? null;
  const eff = await resolveLibraryEffectiveAccess({ userId, qaModeCookie });
  return eff.ok ? eff.access : undefined;
}

function withPrivateCache(headers: Headers): Headers {
  // Curated audio must not be publicly cached — a previously authorized
  // Free response would otherwise be replayable to a later caller from
  // an intermediary. `private, no-store` refuses shared and browser
  // caching alike.
  headers.set("Cache-Control", "private, no-store");
  return headers;
}

// ─── HEAD ─────────────────────────────────────────────────────────────────

export async function HEAD(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const h = await headers();
  const { id } = await ctx.params;

  log.info(h, "library:chapters:audio:head:start", { id });

  const userId = await currentUserId();
  const effectiveAccess = await currentEffectiveAccess(userId);
  const access = await resolveLibraryAudioAccess({
    userId,
    librarySessionChapterId: id,
    effectiveAccess,
  });

  if (!access.ok) {
    log.warn(h, "library:chapters:audio:head:refused", {
      id,
      error: access.error,
    });
    return accessErrorResponse(access);
  }

  const { audioKey } = access.grant;

  const hdrs = withPrivateCache(new Headers());
  hdrs.set("Accept-Ranges", "bytes");
  hdrs.set("Content-Type", "audio/mpeg");

  // ── Private QA local storage ────────────────────────────────────────────
  // A key under `.storage/qa-library/` is a development-only seeded object
  // and MUST bypass S3 entirely — the QA seed never uploads to S3 and a
  // wildcard S3 miss here would appear as a spurious 404 (the visible
  // browser regression we are fixing). The helper enforces production
  // fail-closed, traversal rejection and root containment.
  if (isQaLibraryAudioKey(audioKey)) {
    const stat = await statQaLibraryAudio(audioKey);
    if (!stat) {
      log.warn(h, "library:chapters:audio:head:qa_missing", { id });
      return jsonError("NOT_FOUND", 404);
    }
    hdrs.set("Content-Length", String(stat.size));
    return new Response(null, { status: 200, headers: hdrs });
  }

  if (hasS3Env()) {
    try {
      const meta = await headObjectByKey(audioKey);
      if (meta.ContentType) hdrs.set("Content-Type", meta.ContentType);
      if (typeof meta.ContentLength === "number")
        hdrs.set("Content-Length", String(meta.ContentLength));
      return new Response(null, { status: 200, headers: hdrs });
    } catch {
      log.warn(h, "library:chapters:audio:head:s3_missing", { id });
      return jsonError("NOT_FOUND", 404);
    }
  }

  const abs = localAbsForAudioKey(audioKey);
  if (!abs) return jsonError("NOT_FOUND", 404);
  try {
    const st = await fs.stat(abs);
    hdrs.set("Content-Length", String(st.size));
    return new Response(null, { status: 200, headers: hdrs });
  } catch {
    log.warn(h, "library:chapters:audio:head:local_missing", { id });
    return jsonError("NOT_FOUND", 404);
  }
}

// ─── GET ──────────────────────────────────────────────────────────────────

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const h = await headers();
  const { id } = await ctx.params;

  log.info(h, "library:chapters:audio:get:start", { id });

  const userId = await currentUserId();
  const effectiveAccess = await currentEffectiveAccess(userId);
  const access = await resolveLibraryAudioAccess({
    userId,
    librarySessionChapterId: id,
    effectiveAccess,
  });

  if (!access.ok) {
    log.warn(h, "library:chapters:audio:get:refused", {
      id,
      error: access.error,
    });
    return accessErrorResponse(access);
  }

  const { audioKey } = access.grant;
  const rangeHeader = req.headers.get("range");

  const baseHdrs = withPrivateCache(new Headers());
  baseHdrs.set("Accept-Ranges", "bytes");
  baseHdrs.set("Content-Type", "audio/mpeg");

  // ── Private QA local storage ────────────────────────────────────────────
  // See HEAD above. `.storage/qa-library/…` keys always resolve locally in
  // development and are refused in production — S3 is never consulted for
  // these keys, and there is NO broad "S3 missing → try local filesystem"
  // fallback for ordinary production audioKeys.
  if (isQaLibraryAudioKey(audioKey)) {
    const stat = await statQaLibraryAudio(audioKey);
    if (!stat) {
      log.warn(h, "library:chapters:audio:get:qa_missing", { id });
      return jsonError("NOT_FOUND", 404);
    }
    const total = stat.size;
    const range = parseRangeHeader(rangeHeader, total);
    if (range.kind === "invalid") {
      baseHdrs.set("Content-Range", `bytes */${total}`);
      return new Response(null, { status: 416, headers: baseHdrs });
    }
    if (range.kind === "range") {
      const { start, end } = range;
      const length = end - start + 1;
      const fh = await fs.open(stat.absPath, "r");
      const buf = Buffer.allocUnsafe(length);
      await fh.read(buf, 0, length, start);
      await fh.close();
      baseHdrs.set("Content-Range", `bytes ${start}-${end}/${total}`);
      baseHdrs.set("Content-Length", String(length));
      return new Response(toArrayBuffer(new Uint8Array(buf)), {
        status: 206,
        headers: baseHdrs,
      });
    }
    const u8 = new Uint8Array(await fs.readFile(stat.absPath));
    baseHdrs.set("Content-Length", String(u8.byteLength));
    return new Response(toArrayBuffer(u8), {
      status: 200,
      headers: baseHdrs,
    });
  }

  // ── S3 path ─────────────────────────────────────────────────────────────
  if (hasS3Env()) {
    try {
      if (rangeHeader) {
        const meta = await headObjectByKey(audioKey);
        const total = meta.ContentLength ?? 0;

        const range = parseRangeHeader(rangeHeader, total);
        if (range.kind === "invalid") {
          baseHdrs.set("Content-Range", `bytes */${total}`);
          return new Response(null, { status: 416, headers: baseHdrs });
        }

        if (range.kind === "range") {
          const { start, end } = range;
          const obj = await getObjectByKeyRange(
            audioKey,
            `bytes=${start}-${end}`
          );
          if (obj.ContentType) baseHdrs.set("Content-Type", obj.ContentType);
          baseHdrs.set(
            "Content-Range",
            obj.ContentRange ?? `bytes ${start}-${end}/${total}`
          );
          baseHdrs.set("Content-Length", String(end - start + 1));

          const body = obj.Body;
          if (!body) return jsonError("EMPTY_BODY", 500);

          let u8: Uint8Array;
          if (hasTransformToByteArray(body)) {
            u8 = await body.transformToByteArray();
          } else if (isAsyncIterable(body)) {
            u8 = await concatAsyncIterable(body);
          } else {
            return jsonError("UNREADABLE_BODY", 500);
          }

          return new Response(toArrayBuffer(u8), {
            status: 206,
            headers: baseHdrs,
          });
        }
      }

      // Full content
      const obj = await getObjectByKey(audioKey);
      if (obj.ContentType) baseHdrs.set("Content-Type", obj.ContentType);
      if (typeof obj.ContentLength === "number")
        baseHdrs.set("Content-Length", String(obj.ContentLength));

      const body = obj.Body;
      if (!body) return jsonError("EMPTY_BODY", 500);

      let u8: Uint8Array;
      if (hasTransformToByteArray(body)) {
        u8 = await body.transformToByteArray();
      } else if (isAsyncIterable(body)) {
        u8 = await concatAsyncIterable(body);
      } else {
        return jsonError("UNREADABLE_BODY", 500);
      }

      return new Response(toArrayBuffer(u8), {
        status: 200,
        headers: baseHdrs,
      });
    } catch {
      log.warn(h, "library:chapters:audio:get:s3_missing", { id });
      return jsonError("NOT_FOUND", 404);
    }
  }

  // ── Local file fallback ─────────────────────────────────────────────────
  const abs = localAbsForAudioKey(audioKey);
  if (!abs) return jsonError("NOT_FOUND", 404);
  try {
    const st = await fs.stat(abs);
    const total = st.size;

    const range = parseRangeHeader(rangeHeader, total);
    if (range.kind === "invalid") {
      baseHdrs.set("Content-Range", `bytes */${total}`);
      return new Response(null, { status: 416, headers: baseHdrs });
    }

    if (range.kind === "range") {
      const { start, end } = range;
      const length = end - start + 1;
      const fh = await fs.open(abs, "r");
      const buf = Buffer.allocUnsafe(length);
      await fh.read(buf, 0, length, start);
      await fh.close();

      baseHdrs.set("Content-Range", `bytes ${start}-${end}/${total}`);
      baseHdrs.set("Content-Length", String(length));
      return new Response(toArrayBuffer(new Uint8Array(buf)), {
        status: 206,
        headers: baseHdrs,
      });
    }

    const u8 = new Uint8Array(await fs.readFile(abs));
    baseHdrs.set("Content-Length", String(u8.byteLength));
    return new Response(toArrayBuffer(u8), {
      status: 200,
      headers: baseHdrs,
    });
  } catch {
    log.warn(h, "library:chapters:audio:get:local_missing", { id });
    return jsonError("NOT_FOUND", 404);
  }
}
