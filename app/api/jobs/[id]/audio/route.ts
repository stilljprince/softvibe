// app/api/jobs/[id]/audio/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import {
  hasS3Env,
  s3KeyForJob,
  headObjectByKey,
  getObjectByKey,
} from "@/lib/s3";
import fs from "node:fs/promises";
import path from "node:path";
import { headers } from "next/headers";
import { log } from "@/lib/log";

export const runtime = "nodejs";

/** sicheres Kopieren in echtes ArrayBuffer (kein SharedArrayBuffer) */
function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  return copy.buffer;
}

/** Type Guard: Uint8Array */
function isUint8Array(x: unknown): x is Uint8Array {
  return x instanceof Uint8Array;
}

/** Type Guard: Node Buffer */
function isNodeBuffer(x: unknown): x is Buffer {
  return typeof Buffer !== "undefined" && Buffer.isBuffer(x);
}

/** Body mit transformToByteArray (AWS SDK >= v3.310) */
function hasTransformToByteArray(
  body: unknown
): body is { transformToByteArray: () => Promise<Uint8Array> } {
  return !!body && typeof (body as { transformToByteArray?: unknown }).transformToByteArray === "function";
}

/** Fallback: AsyncIterable erkennen */
function isAsyncIterable(
  body: unknown
): body is AsyncIterable<unknown> {
  return !!body && typeof (body as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function";
}

/** Node-AsyncIterable in Bytes zusammenführen – robust getypt */
async function concatAsyncIterable(
  body: AsyncIterable<unknown>
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const part of body) {
    if (typeof part === "string") {
      chunks.push(new TextEncoder().encode(part));
    } else if (isUint8Array(part)) {
      chunks.push(part);
    } else if (isNodeBuffer(part)) {
      chunks.push(new Uint8Array(part.buffer, part.byteOffset, part.byteLength));
    } else {
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
        chunks.push(new Uint8Array(maybe.buffer, maybe.byteOffset, maybe.byteLength));
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

/** HEAD: nur Länge/Typ */
export async function HEAD(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const h = await headers();
  const { id } = await ctx.params;

  log.info(h, "jobs:audio:head:start", { id });

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    log.warn(h, "jobs:audio:head:unauthorized", { id });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = await prisma.job.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, resultUrl: true },
  });
  if (!job) {
    log.warn(h, "jobs:audio:head:not_found", { id });
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const hdrs = new Headers();
  hdrs.set("Accept-Ranges", "bytes");

  if (hasS3Env()) {
    try {
      const meta = await headObjectByKey(s3KeyForJob(id));
      if (meta.ContentType) hdrs.set("Content-Type", meta.ContentType);
      if (typeof meta.ContentLength === "number") {
        hdrs.set("Content-Length", String(meta.ContentLength));
      }
      log.info(h, "jobs:audio:head:ok", { id, src: "s3" });
      return new Response(null, { status: 200, headers: hdrs });
    } catch {
      log.warn(h, "jobs:audio:head:s3_missing", { id });
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
  }

  // lokal
  const rel = job.resultUrl?.startsWith("/generated/")
    ? job.resultUrl
    : `/generated/${id}.mp3`;
  const abs = path.join(process.cwd(), "public", rel.replace(/^\//, ""));
  try {
    const st = await fs.stat(abs);
    hdrs.set("Content-Type", "audio/mpeg");
    hdrs.set("Content-Length", String(st.size));
    log.info(h, "jobs:audio:head:ok", { id, src: "local" });
    return new Response(null, { status: 200, headers: hdrs });
  } catch {
    log.warn(h, "jobs:audio:head:local_missing", { id });
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
}

/** GET: Datei liefern */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const h = await headers();
  const { id } = await ctx.params;

  log.info(h, "jobs:audio:get:start", { id });

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    log.warn(h, "jobs:audio:get:unauthorized", { id });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = await prisma.job.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, resultUrl: true },
  });
  if (!job) {
    log.warn(h, "jobs:audio:get:not_found", { id });
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const hdrs = new Headers();
  hdrs.set("Accept-Ranges", "bytes");

  if (hasS3Env()) {
    try {
      const obj = await getObjectByKey(s3KeyForJob(id));
      if (obj.ContentType) hdrs.set("Content-Type", obj.ContentType);
      if (typeof obj.ContentLength === "number") {
        hdrs.set("Content-Length", String(obj.ContentLength));
      }

      const body = obj.Body;
      if (!body) {
        log.error(h, "jobs:audio:get:empty_body", { id });
        return NextResponse.json({ error: "EMPTY_BODY" }, { status: 500 });
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
      return NextResponse.json({ error: "UNREADABLE_BODY" }, { status: 500 });
    } catch {
      log.warn(h, "jobs:audio:get:s3_missing", { id });
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
  }

  // lokal
  const rel = job.resultUrl?.startsWith("/generated/")
    ? job.resultUrl
    : `/generated/${id}.mp3`;
  const abs = path.join(process.cwd(), "public", rel.replace(/^\//, ""));
  try {
    const fileU8 = new Uint8Array(await fs.readFile(abs));
    hdrs.set("Content-Type", "audio/mpeg");
    hdrs.set("Content-Length", String(fileU8.byteLength));
    log.info(h, "jobs:audio:get:ok", { id, src: "local" });
    return new Response(toArrayBuffer(fileU8), { headers: hdrs });
  } catch {
    log.warn(h, "jobs:audio:get:local_missing", { id });
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
}