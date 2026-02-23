// app/api/jobs/[id]/audio/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { hasS3Env, s3KeyForJob, headObjectByKey, getObjectByKey } from "@/lib/s3";
import fs from "node:fs/promises";
import path from "node:path";
import { headers } from "next/headers";
import { log } from "@/lib/log";
import { jsonError } from "@/lib/api";
import { s3KeyForJobPart } from "@/lib/s3";

export const runtime = "nodejs";

function parsePartIndex(req: Request): number | null {
  try {
    const u = new URL(req.url);
    const raw = u.searchParams.get("part");
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    const idx = Math.floor(n) - 1; // part=1 -> index 0
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
    `part-${partNumber(partIndex)}.mp3`
  );
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
    typeof (body as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] ===
      "function"
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
          new Uint8Array(maybe.buffer, maybe.byteOffset, maybe.byteLength)
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

/** HEAD */
export async function HEAD(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const h = await headers();
  const { id } = await ctx.params;
  const partIndex = parsePartIndex(req);

  log.info(h, "jobs:audio:head:start", { id });

  const session = await getServerSession(authOptions);
  const sessionUserId = session?.user?.id ?? null;

  // 1) Prüfen, ob der aktuelle User Owner des Jobs ist
  let isOwner = false;
  if (sessionUserId) {
    const jobOwner = await prisma.job.findFirst({
      where: { id, userId: sessionUserId },
      select: { id: true },
    });
    isOwner = !!jobOwner;
  }

  // 2) Wenn kein Owner → prüfen, ob es einen öffentlichen Track zu diesem Audio gibt
  if (!isOwner) {
    const publicTrack = await prisma.track.findFirst({
  where: {
    jobId: id,
    isPublic: true,
  },
  select: { id: true },
});

    if (!publicTrack) {
      if (!sessionUserId) {
        log.warn(h, "jobs:audio:head:unauthorized", { id });
        return jsonError("UNAUTHORIZED", 401);
      }
      log.warn(h, "jobs:audio:head:forbidden", { id, userId: sessionUserId });
      return jsonError("FORBIDDEN", 403);
    }
    // Es gibt einen public Track → Zugriff erlaubt (auch anonym)
  }

  // 3) Job ohne userId-Filter laden
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
  hdrs.set("Cache-Control", "no-store, max-age=0");
  hdrs.set("Pragma", "no-cache");

  if (hasS3Env()) {
    try {
      const key = partIndex !== null ? s3KeyForJobPart(id, partIndex) : s3KeyForJob(id);
      const meta = await headObjectByKey(key);
      if (meta.ContentType) hdrs.set("Content-Type", meta.ContentType);
      if (typeof meta.ContentLength === "number") {
        hdrs.set("Content-Length", String(meta.ContentLength));
      }
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

 console.log("[audio] id=", id, "partIndex=", partIndex);   
  try {
    const st = await fs.stat(abs);
    hdrs.set("Content-Type", "audio/mpeg");
    hdrs.set("Content-Length", String(st.size));
    log.info(h, "jobs:audio:head:ok", { id, src: "local" });
    return new Response(null, { status: 200, headers: hdrs });
  } catch {
    log.warn(h, "jobs:audio:head:local_missing", { id });
    return jsonError("NOT_FOUND", 404);
  }
}

/** GET */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const h = await headers();
  const { id } = await ctx.params;
  const partIndex = parsePartIndex(req);

  log.info(h, "jobs:audio:get:start", { id });

  const session = await getServerSession(authOptions);
  const sessionUserId = session?.user?.id ?? null;

  // 🔹 1) Prüfen, ob der aktuelle User Owner des Jobs ist
  let isOwner = false;
  if (sessionUserId) {
    const jobOwner = await prisma.job.findFirst({
      where: { id, userId: sessionUserId },
      select: { id: true },
    });
    isOwner = !!jobOwner;
  }

  // 🔹 2) Wenn kein Owner → prüfen, ob es einen öffentlichen Track zu diesem Audio gibt
  if (!isOwner) {
    const publicTrack = await prisma.track.findFirst({
  where: {
    jobId: id,
    isPublic: true,
  },
  select: { id: true },
});

    if (!publicTrack) {
      // niemand eingeloggt oder nicht Owner + nicht public
      if (!sessionUserId) {
        log.warn(h, "jobs:audio:get:unauthorized", { id });
        return jsonError("UNAUTHORIZED", 401, { message: "Bitte einloggen." });
      }
      log.warn(h, "jobs:audio:get:forbidden", { id, userId: sessionUserId });
      return jsonError("FORBIDDEN", 403, { message: "Keine Berechtigung." });
    }
    // falls publicTrack existiert → Zugriff ist erlaubt (auch anonym)
  }

  // 🔹 3) Job laden (ohne userId-Filter – Auth ist oben geklärt)
  const job = await prisma.job.findFirst({
    where: { id },
    select: { id: true, resultUrl: true },
  });
  if (!job) {
    log.warn(h, "jobs:audio:get:not_found", { id });
    return jsonError("NOT_FOUND", 404);
  }

  const hdrs = new Headers();
  hdrs.set("Accept-Ranges", "bytes");
  hdrs.set("Cache-Control", "no-store, max-age=0");
  hdrs.set("Pragma", "no-cache");

  if (hasS3Env()) {
    try {
      const key = partIndex !== null ? s3KeyForJobPart(id, partIndex) : s3KeyForJob(id);
      const obj = await getObjectByKey(key);
      if (obj.ContentType) hdrs.set("Content-Type", obj.ContentType);
      if (typeof obj.ContentLength === "number")
        hdrs.set("Content-Length", String(obj.ContentLength));

      const body = obj.Body;
      if (!body) {
        log.error(h, "jobs:audio:get:empty_body", { id });
        return jsonError("EMPTY_BODY", 500);
      }

      if (hasTransformToByteArray(body)) {
        const u8 = await body.transformToByteArray();
        log.info(h, "jobs:audio:get:ok", { id, src: "s3:bytearray" });
        return new Response(toArrayBuffer(u8), { headers: hdrs });
      }

      if (isAsyncIterable(body)) {
        const u8 = await concatAsyncIterable(body);
        log.info(h, "jobs:audio:get:ok", { id, src: "s3:iterable" });
        return new Response(toArrayBuffer(u8), { headers: hdrs });
      }

      log.error(h, "jobs:audio:get:unreadable", { id });
      return jsonError("UNREADABLE_BODY", 500);
    } catch {
      log.warn(h, "jobs:audio:get:s3_missing", { id });
      return jsonError("NOT_FOUND", 404);
    }
  }

      const abs =
        partIndex !== null
          ? localAbsForJobPart(id, partIndex)
          : path.join(process.cwd(), "public", "generated", `${id}.mp3`);
  
  console.log("[audio] id=", id, "partIndex=", partIndex);
  try {
    const fileU8 = new Uint8Array(await fs.readFile(abs));
    hdrs.set("Content-Type", "audio/mpeg");
    hdrs.set("Content-Length", String(fileU8.byteLength));
    log.info(h, "jobs:audio:get:ok", { id, src: "local" });
    return new Response(toArrayBuffer(fileU8), { headers: hdrs });
  } catch {
    log.warn(h, "jobs:audio:get:local_missing", { id });
    return jsonError("NOT_FOUND", 404);
  }
}