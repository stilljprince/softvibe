// app/api/tracks/[id]/audio/route.ts
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { headers } from "next/headers";
import { log } from "@/lib/log";
import { jsonError } from "@/lib/api";
import { hasS3Env, headObjectByKey, getObjectByKey } from "@/lib/s3";
import { s3KeyForTrack, localAbsForTrack } from "@/lib/s3-tracks";
import fs from "node:fs/promises";

export const runtime = "nodejs";

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
    typeof (body as { transformToByteArray?: unknown }).transformToByteArray === "function"
  );
}

function isAsyncIterable(body: unknown): body is AsyncIterable<unknown> {
  return (
    !!body &&
    typeof (body as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
  );
}

async function concatAsyncIterable(body: AsyncIterable<unknown>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const part of body) {
    if (part instanceof Uint8Array) chunks.push(part);
    else if (typeof part === "string") chunks.push(new TextEncoder().encode(part));
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

/** HEAD */
export async function HEAD(_req: Request, ctx: { params: Promise<{ id: string }> }) {
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

  const isOwner = sessionUserId && track.userId === sessionUserId;
  if (!isOwner && !track.isPublic) {
    if (!sessionUserId) return jsonError("UNAUTHORIZED", 401);
    return jsonError("FORBIDDEN", 403);
  }

  const hdrs = new Headers();
  hdrs.set("Accept-Ranges", "bytes");

  if (hasS3Env()) {
    try {
      const meta = await headObjectByKey(s3KeyForTrack(id));
      if (meta.ContentType) hdrs.set("Content-Type", meta.ContentType);
      if (typeof meta.ContentLength === "number") hdrs.set("Content-Length", String(meta.ContentLength));
      return new Response(null, { status: 200, headers: hdrs });
    } catch {
      return jsonError("NOT_FOUND", 404);
    }
  }

  try {
    const st = await fs.stat(localAbsForTrack(id));
    hdrs.set("Content-Type", "audio/mpeg");
    hdrs.set("Content-Length", String(st.size));
    return new Response(null, { status: 200, headers: hdrs });
  } catch {
    return jsonError("NOT_FOUND", 404);
  }
}

/** GET */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
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

  const isOwner = sessionUserId && track.userId === sessionUserId;
  if (!isOwner && !track.isPublic) {
    if (!sessionUserId) return jsonError("UNAUTHORIZED", 401, { message: "Bitte einloggen." });
    return jsonError("FORBIDDEN", 403, { message: "Keine Berechtigung." });
  }

  const hdrs = new Headers();
  hdrs.set("Accept-Ranges", "bytes");

  if (hasS3Env()) {
    try {
      const obj = await getObjectByKey(s3KeyForTrack(id));
      if (obj.ContentType) hdrs.set("Content-Type", obj.ContentType);
      if (typeof obj.ContentLength === "number") hdrs.set("Content-Length", String(obj.ContentLength));

      const body = obj.Body;
      if (!body) return jsonError("EMPTY_BODY", 500);

      if (hasTransformToByteArray(body)) {
        const u8 = await body.transformToByteArray();
        return new Response(toArrayBuffer(u8), { headers: hdrs });
      }

      if (isAsyncIterable(body)) {
        const u8 = await concatAsyncIterable(body);
        return new Response(toArrayBuffer(u8), { headers: hdrs });
      }

      return jsonError("UNREADABLE_BODY", 500);
    } catch {
      return jsonError("NOT_FOUND", 404);
    }
  }

  try {
    const u8 = new Uint8Array(await fs.readFile(localAbsForTrack(id)));
    hdrs.set("Content-Type", "audio/mpeg");
    hdrs.set("Content-Length", String(u8.byteLength));
    return new Response(toArrayBuffer(u8), { headers: hdrs });
  } catch {
    return jsonError("NOT_FOUND", 404);
  }
}