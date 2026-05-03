// app/api/tracks/[id]/audio/route.ts
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { headers } from "next/headers";
import { log } from "@/lib/log";
import { jsonError } from "@/lib/api";
import {
  hasS3Env,
  headObjectByKey,
  getObjectByKey,
  getObjectByKeyRange,
} from "@/lib/s3";
import { s3KeyForTrack, localAbsForTrack } from "@/lib/s3-tracks";
import fs from "node:fs/promises";

export const runtime = "nodejs";

// ─── helpers ──────────────────────────────────────────────────────────────────

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

// ─── HEAD ─────────────────────────────────────────────────────────────────────

export async function HEAD(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const h = await headers();
  const { id } = await ctx.params;

  log.info(h, "tracks:audio:head:start", { id });

  const session = await getServerSession(authOptions);
  const sessionUserId = session?.user?.id ?? null;

  const track = await prisma.track.findFirst({
    where: { id },
    select: { id: true, userId: true, isPublic: true },
  });
  if (!track) return jsonError("NOT_FOUND", 404);

  const isOwner = !!sessionUserId && track.userId === sessionUserId;
  if (!isOwner && !track.isPublic) {
    if (!sessionUserId) return jsonError("UNAUTHORIZED", 401);
    return jsonError("FORBIDDEN", 403);
  }

  const hdrs = new Headers();
  hdrs.set("Accept-Ranges", "bytes");
  hdrs.set("Content-Type", "audio/mpeg");

  if (hasS3Env()) {
    try {
      const meta = await headObjectByKey(s3KeyForTrack(id));
      if (meta.ContentType) hdrs.set("Content-Type", meta.ContentType);
      if (typeof meta.ContentLength === "number")
        hdrs.set("Content-Length", String(meta.ContentLength));
      return new Response(null, { status: 200, headers: hdrs });
    } catch {
      return jsonError("NOT_FOUND", 404);
    }
  }

  try {
    const st = await fs.stat(localAbsForTrack(id));
    hdrs.set("Content-Length", String(st.size));
    return new Response(null, { status: 200, headers: hdrs });
  } catch {
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

  log.info(h, "tracks:audio:get:start", { id });

  const session = await getServerSession(authOptions);
  const sessionUserId = session?.user?.id ?? null;

  const track = await prisma.track.findFirst({
    where: { id },
    select: { id: true, userId: true, isPublic: true },
  });
  if (!track) return jsonError("NOT_FOUND", 404);

  const isOwner = !!sessionUserId && track.userId === sessionUserId;
  if (!isOwner && !track.isPublic) {
    if (!sessionUserId)
      return jsonError("UNAUTHORIZED", 401, { message: "Bitte einloggen." });
    return jsonError("FORBIDDEN", 403, { message: "Keine Berechtigung." });
  }

  const rangeHeader = req.headers.get("range");
  const s3Key = s3KeyForTrack(id);

  const baseHdrs = new Headers();
  baseHdrs.set("Accept-Ranges", "bytes");
  baseHdrs.set("Content-Type", "audio/mpeg");

  // ── S3 path ──────────────────────────────────────────────────────────────
  if (hasS3Env()) {
    try {
      if (rangeHeader) {
        const meta = await headObjectByKey(s3Key);
        const total = meta.ContentLength ?? 0;

        const range = parseRangeHeader(rangeHeader, total);
        if (range.kind === "invalid") {
          baseHdrs.set("Content-Range", `bytes */${total}`);
          return new Response(null, { status: 416, headers: baseHdrs });
        }

        if (range.kind === "range") {
          const { start, end } = range;
          const obj = await getObjectByKeyRange(s3Key, `bytes=${start}-${end}`);
          if (obj.ContentType) baseHdrs.set("Content-Type", obj.ContentType);
          baseHdrs.set(
            "Content-Range",
            obj.ContentRange ?? `bytes ${start}-${end}/${total}`,
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
      const obj = await getObjectByKey(s3Key);
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
      return jsonError("NOT_FOUND", 404);
    }
  }

  // ── Local file path ───────────────────────────────────────────────────────
  try {
    const abs = localAbsForTrack(id);
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

    // Full content
    const u8 = new Uint8Array(await fs.readFile(abs));
    baseHdrs.set("Content-Length", String(u8.byteLength));
    return new Response(toArrayBuffer(u8), {
      status: 200,
      headers: baseHdrs,
    });
  } catch {
    return jsonError("NOT_FOUND", 404);
  }
}
