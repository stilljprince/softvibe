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
  // Buffer ist im Node-Runtime global verfügbar
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
      // defensiver Fallback für ArrayBufferView-ähnliche Strukturen
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
      // Unbekanntes Format: ignorieren
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
  const { id } = await ctx.params;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = await prisma.job.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, resultUrl: true },
  });
  if (!job) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const headers = new Headers();
  headers.set("Accept-Ranges", "bytes");

  if (hasS3Env()) {
    try {
      const meta = await headObjectByKey(s3KeyForJob(id));
      if (meta.ContentType) headers.set("Content-Type", meta.ContentType);
      if (typeof meta.ContentLength === "number") {
        headers.set("Content-Length", String(meta.ContentLength));
      }
      return new Response(null, { status: 200, headers });
    } catch {
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
    headers.set("Content-Type", "audio/mpeg");
    headers.set("Content-Length", String(st.size));
    return new Response(null, { status: 200, headers });
  } catch {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
}

/** GET: Datei liefern */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = await prisma.job.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, resultUrl: true },
  });
  if (!job) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const headers = new Headers();
  headers.set("Accept-Ranges", "bytes");

  if (hasS3Env()) {
    try {
      const obj = await getObjectByKey(s3KeyForJob(id));
      if (obj.ContentType) headers.set("Content-Type", obj.ContentType);
      if (typeof obj.ContentLength === "number") {
        headers.set("Content-Length", String(obj.ContentLength));
      }

      const body = obj.Body;
      if (!body) {
        return NextResponse.json({ error: "EMPTY_BODY" }, { status: 500 });
      }

      if (hasTransformToByteArray(body)) {
        const u8 = await body.transformToByteArray();
        return new Response(toArrayBuffer(u8), { headers });
      }

      if (isAsyncIterable(body)) {
        const u8 = await concatAsyncIterable(body);
        return new Response(toArrayBuffer(u8), { headers });
      }

      return NextResponse.json({ error: "UNREADABLE_BODY" }, { status: 500 });
    } catch {
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
    headers.set("Content-Type", "audio/mpeg");
    headers.set("Content-Length", String(fileU8.byteLength));
    return new Response(toArrayBuffer(fileU8), { headers });
  } catch {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
}