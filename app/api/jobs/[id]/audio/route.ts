// app/api/jobs/[id]/audio/route.ts
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import {
  hasS3Env,
  s3KeyForJob,
  s3KeyForJobPart,
  headObjectByKey,
  getObjectByKey,
  getObjectByKeyRange,
} from "@/lib/s3";
import fs from "node:fs/promises";
import path from "node:path";
import { headers } from "next/headers";
import { log } from "@/lib/log";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";

// ─── helpers ──────────────────────────────────────────────────────────────────

function parsePartIndex(req: Request): number | null {
  try {
    const u = new URL(req.url);
    const raw = u.searchParams.get("part");
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    const idx = Math.floor(n) - 1; // part=1 → index 0
    if (idx < 0 || idx > 999) return null;
    return idx;
  } catch {
    return null;
  }
}

function partNumber(partIndex: number): string {
  return String(partIndex + 1).padStart(3, "0");
}

function localAbsForJobPart(jobId: string, partIndex: number): string {
  return path.join(
    process.cwd(),
    "public",
    "generated",
    jobId,
    `part-${partNumber(partIndex)}.mp3`,
  );
}

/**
 * Parse an HTTP Range header against a known total file size.
 *
 * Returns:
 *   { kind: "none" }                  — no Range header present → respond 200
 *   { kind: "range"; start; end }     — valid range → respond 206
 *   { kind: "invalid" }               — unsatisfiable range → respond 416
 */
type RangeResult =
  | { kind: "none" }
  | { kind: "range"; start: number; end: number }
  | { kind: "invalid" };

function parseRangeHeader(rangeHeader: string | null, total: number): RangeResult {
  if (!rangeHeader) return { kind: "none" };

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return { kind: "invalid" };

  const startStr = match[1];
  const endStr = match[2];

  let start: number;
  let end: number;

  if (startStr === "") {
    // Suffix range: bytes=-N (last N bytes)
    if (endStr === "") return { kind: "invalid" };
    const suffix = parseInt(endStr, 10);
    if (suffix === 0) return { kind: "invalid" };
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = parseInt(startStr, 10);
    end = endStr === "" ? total - 1 : parseInt(endStr, 10);
    if (end >= total) end = total - 1; // clamp to file end
    if (start > end || start >= total) return { kind: "invalid" };
  }

  return { kind: "range", start, end };
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  return copy.buffer;
}

function isUint8Array(x: unknown): x is Uint8Array {
  return x instanceof Uint8Array;
}
function isNodeBuffer(x: unknown): x is Buffer {
  return typeof Buffer !== "undefined" && Buffer.isBuffer(x);
}
function hasTransformToByteArray(
  body: unknown,
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
async function concatAsyncIterable(body: AsyncIterable<unknown>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const part of body) {
    if (typeof part === "string") chunks.push(new TextEncoder().encode(part));
    else if (isUint8Array(part)) chunks.push(part);
    else if (isNodeBuffer(part))
      chunks.push(new Uint8Array(part.buffer, part.byteOffset, part.byteLength));
    else {
      const maybe = part as {
        buffer?: ArrayBufferLike;
        byteOffset?: number;
        byteLength?: number;
      };
      if (
        maybe &&
        maybe.buffer instanceof ArrayBuffer &&
        typeof maybe.byteOffset === "number" &&
        typeof maybe.byteLength === "number"
      ) {
        chunks.push(
          new Uint8Array(maybe.buffer, maybe.byteOffset, maybe.byteLength),
        );
      }
    }
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

// ─── shared auth helper ────────────────────────────────────────────────────────

async function checkAuth(
  id: string,
  sessionUserId: string | null,
): Promise<
  | { allowed: true }
  | { allowed: false; response: Response }
> {
  let isOwner = false;
  if (sessionUserId) {
    const jobOwner = await prisma.job.findFirst({
      where: { id, userId: sessionUserId },
      select: { id: true },
    });
    isOwner = !!jobOwner;
  }

  if (!isOwner) {
    const publicTrack = await prisma.track.findFirst({
      where: { jobId: id, isPublic: true },
      select: { id: true },
    });
    if (!publicTrack) {
      if (!sessionUserId)
        return { allowed: false, response: jsonError("UNAUTHORIZED", 401) };
      return { allowed: false, response: jsonError("FORBIDDEN", 403) };
    }
  }
  return { allowed: true };
}

// ─── HEAD ─────────────────────────────────────────────────────────────────────

export async function HEAD(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const h = await headers();
  const { id } = await ctx.params;
  const partIndex = parsePartIndex(req);

  log.info(h, "jobs:audio:head:start", { id });

  const session = await getServerSession(authOptions);
  const sessionUserId = session?.user?.id ?? null;

  const auth = await checkAuth(id, sessionUserId);
  if (!auth.allowed) return auth.response;

  const job = await prisma.job.findFirst({
    where: { id },
    select: { id: true, resultUrl: true },
  });
  if (!job) {
    log.warn(h, "jobs:audio:head:not_found", { id });
    return jsonError("NOT_FOUND", 404);
  }

  const hdrs = new Headers();
  hdrs.set("Accept-Ranges", "bytes");
  hdrs.set("Cache-Control", "private, max-age=3600, immutable");
  hdrs.set("Content-Type", "audio/mpeg");

  if (hasS3Env()) {
    try {
      const key =
        partIndex !== null ? s3KeyForJobPart(id, partIndex) : s3KeyForJob(id);
      const meta = await headObjectByKey(key);
      if (meta.ContentType) hdrs.set("Content-Type", meta.ContentType);
      if (typeof meta.ContentLength === "number")
        hdrs.set("Content-Length", String(meta.ContentLength));
      log.info(h, "jobs:audio:head:ok", { id, src: "s3" });
      return new Response(null, { status: 200, headers: hdrs });
    } catch {
      log.warn(h, "jobs:audio:head:s3_missing", { id });
      return jsonError("NOT_FOUND", 404);
    }
  }

  const abs =
    partIndex !== null
      ? localAbsForJobPart(id, partIndex)
      : path.join(process.cwd(), "public", "generated", `${id}.mp3`);

  try {
    const st = await fs.stat(abs);
    hdrs.set("Content-Length", String(st.size));
    log.info(h, "jobs:audio:head:ok", { id, src: "local" });
    return new Response(null, { status: 200, headers: hdrs });
  } catch {
    log.warn(h, "jobs:audio:head:local_missing", { id });
    return jsonError("NOT_FOUND", 404);
  }
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const h = await headers();
  const { id } = await ctx.params;
  const partIndex = parsePartIndex(req);

  log.info(h, "jobs:audio:get:start", { id });

  const session = await getServerSession(authOptions);
  const sessionUserId = session?.user?.id ?? null;

  const auth = await checkAuth(id, sessionUserId);
  if (!auth.allowed) return auth.response;

  const job = await prisma.job.findFirst({
    where: { id },
    select: { id: true, resultUrl: true },
  });
  if (!job) {
    log.warn(h, "jobs:audio:get:not_found", { id });
    return jsonError("NOT_FOUND", 404);
  }

  const rangeHeader = req.headers.get("range");
  const key =
    partIndex !== null ? s3KeyForJobPart(id, partIndex) : s3KeyForJob(id);

  const baseHdrs = new Headers();
  baseHdrs.set("Accept-Ranges", "bytes");
  baseHdrs.set("Cache-Control", "private, max-age=3600, immutable");
  baseHdrs.set("Content-Type", "audio/mpeg");

  // ── S3 path ──────────────────────────────────────────────────────────────
  if (hasS3Env()) {
    try {
      if (rangeHeader) {
        // Fetch total size via HEAD first so we can validate the range.
        const meta = await headObjectByKey(key);
        const total = meta.ContentLength ?? 0;

        const range = parseRangeHeader(rangeHeader, total);
        if (range.kind === "invalid") {
          baseHdrs.set("Content-Range", `bytes */${total}`);
          return new Response(null, { status: 416, headers: baseHdrs });
        }
        if (range.kind === "none") {
          // No Range header — fall through to full-content path below.
        } else {
          // Partial content
          const { start, end } = range;
          const rangeStr = `bytes=${start}-${end}`;
          const obj = await getObjectByKeyRange(key, rangeStr);
          if (obj.ContentType) baseHdrs.set("Content-Type", obj.ContentType);
          baseHdrs.set("Content-Range", obj.ContentRange ?? `bytes ${start}-${end}/${total}`);
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

          log.info(h, "jobs:audio:get:ok", { id, src: "s3:range", start, end });
          return new Response(toArrayBuffer(u8), {
            status: 206,
            headers: baseHdrs,
          });
        }
      }

      // Full content (no Range or range.kind === "none")
      const obj = await getObjectByKey(key);
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

      log.info(h, "jobs:audio:get:ok", { id, src: "s3:full" });
      return new Response(toArrayBuffer(u8), { status: 200, headers: baseHdrs });
    } catch {
      log.warn(h, "jobs:audio:get:s3_missing", { id });
      return jsonError("NOT_FOUND", 404);
    }
  }

  // ── Local file path ───────────────────────────────────────────────────────
  const abs =
    partIndex !== null
      ? localAbsForJobPart(id, partIndex)
      : path.join(process.cwd(), "public", "generated", `${id}.mp3`);

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
      log.info(h, "jobs:audio:get:ok", { id, src: "local:range", start, end });
      return new Response(toArrayBuffer(new Uint8Array(buf)), {
        status: 206,
        headers: baseHdrs,
      });
    }

    // Full content
    const fileU8 = new Uint8Array(await fs.readFile(abs));
    baseHdrs.set("Content-Length", String(fileU8.byteLength));
    log.info(h, "jobs:audio:get:ok", { id, src: "local:full" });
    return new Response(toArrayBuffer(fileU8), {
      status: 200,
      headers: baseHdrs,
    });
  } catch {
    log.warn(h, "jobs:audio:get:local_missing", { id });
    return jsonError("NOT_FOUND", 404);
  }
}
