// app/api/jobs/[id]/audio/route.ts
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { getObjectForKey as getObjectStream } from "@/lib/s3";
import type { GetObjectCommandOutput } from "@aws-sdk/client-s3";
import path from "node:path";
import fs from "node:fs/promises";

export const runtime = "nodejs";

/** Body hat transformToByteArray (AWS SDK >= v3.310) */
function hasTransformToByteArray(
  body: unknown
): body is { transformToByteArray: () => Promise<Uint8Array> } {
  return !!body && typeof (body as { transformToByteArray?: unknown }).transformToByteArray === "function";
}

/** Ist ein AsyncIterable (Node Readable kompatibel) */
function isAsyncIterable(
  body: unknown
): body is AsyncIterable<Uint8Array | Buffer | string> {
  return !!body && typeof (body as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function";
}

/** AsyncIterable → Uint8Array zusammenführen */
async function toUint8ArrayFromStream(
  stream: AsyncIterable<Uint8Array | Buffer | string>
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const c of stream) {
    if (typeof c === "string") {
      chunks.push(new TextEncoder().encode(c));
    } else if (c instanceof Uint8Array) {
      chunks.push(c);
    } else {
      chunks.push(new Uint8Array(c)); // Buffer -> Uint8Array
    }
  }
  const total = chunks.reduce((n, u) => n + u.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const u of chunks) {
    out.set(u, off);
    off += u.byteLength;
  }
  return out;
}

/** Uint8Array → garantiert echtes ArrayBuffer-Slice (ohne SharedArrayBuffer) */
function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(u8.byteLength);
  new Uint8Array(buf).set(u8);
  return buf;
}

/** S3-Key aus Job-ID */
function s3KeyForJob(id: string) {
  const prefix = (process.env.S3_PREFIX ?? "generated").replace(/^\/|\/$/g, "");
  return `${prefix}/${id}.mp3`;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> } // Next.js 15: params ist Promise
) {
  const { id } = await ctx.params;

  // Auth & Ownership
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const job = await prisma.job.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!job) {
    return new Response(JSON.stringify({ error: "NOT_FOUND" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const baseHeaders = {
    "Content-Type": "audio/mpeg",
    "Cache-Control": "public, max-age=300",
  } as const;

  // 1) S3 versuchen
  if (process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY) {
    try {
      const key = s3KeyForJob(id);
      const out = (await getObjectStream(key)) as GetObjectCommandOutput;
      const body = out.Body;

      if (hasTransformToByteArray(body)) {
        const u8 = await body.transformToByteArray();
        return new Response(toArrayBuffer(u8), {
          headers: { ...baseHeaders, "x-audio-source": "s3" },
        });
      }

      if (isAsyncIterable(body)) {
        const u8 = await toUint8ArrayFromStream(
          body as AsyncIterable<Uint8Array | Buffer | string>
        );
        return new Response(toArrayBuffer(u8), {
          headers: { ...baseHeaders, "x-audio-source": "s3" },
        });
      }
      // kein Body -> lokal probieren
    } catch {
      // stiller Fallback
    }
  }

  // 2) Lokal lesen
  try {
    const rel = path.join("public", "generated", `${id}.mp3`);
    const file = await fs.readFile(path.join(process.cwd(), rel));
    const u8 = new Uint8Array(file);
    return new Response(toArrayBuffer(u8), {
      headers: { ...baseHeaders, "x-audio-source": "local" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "AUDIO_NOT_FOUND" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
}