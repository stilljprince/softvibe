// app/api/public/[slug]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasS3Env, s3KeyForJob, s3 } from "@/lib/s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import path from "node:path";
import fs from "node:fs/promises";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

// --- Helpers ---------------------------------------------------------------

function concatU8(chunks: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const c of chunks) len += c.byteLength;
  const out = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/** Liefert garantiert ein echtes ArrayBuffer (kein SharedArrayBuffer) */
function toArrayBufferSafe(u8: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(u8.byteLength);
  out.set(u8);
  return out.buffer;
}

function isAsyncIterableBody(body: unknown): body is AsyncIterable<Uint8Array> {
  return typeof body === "object" && body !== null && Symbol.asyncIterator in (body as object);
}

/** /api/jobs/<id>/audio → <id> extrahieren */
function jobIdFromAudioUrl(url?: string | null): string | null {
  if (!url) return null;
  const m = /^\/api\/jobs\/([^/]+)\/audio$/i.exec(url);
  return m ? m[1] : null;
}

// --- Route -----------------------------------------------------------------

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;

  // 🔐 Login-Gate: Nur eingeloggte Nutzer:innen dürfen den öffentlichen Stream abrufen
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1) Track per shareSlug finden (nur wenn public)
  const track = await prisma.track.findFirst({
    where: { shareSlug: slug, isPublic: true },
    select: { id: true, jobId: true, url: true },
  });

  if (!track) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const jobId = track.jobId ?? jobIdFromAudioUrl(track.url);

  // 2) S3-Variante: Objekt per Key streamen
  if (hasS3Env()) {
    if (!jobId) {
      return NextResponse.json({ error: "NO_JOB_ID" }, { status: 404 });
    }
    try {
      const Bucket = process.env.S3_BUCKET!;
      const Key = s3KeyForJob(jobId);
      const resp = await s3.send(new GetObjectCommand({ Bucket, Key }));
      const body = resp.Body;

      if (!body) {
        return NextResponse.json({ error: "EMPTY_BODY" }, { status: 404 });
      }

      // Moderne AWS SDKs liefern häufig AsyncIterable<Uint8Array>
      if (isAsyncIterableBody(body)) {
        const chunks: Uint8Array[] = [];
        for await (const part of body) chunks.push(part);
        const merged = concatU8(chunks);
        return new Response(
          new Blob([toArrayBufferSafe(merged)], { type: "audio/mpeg" }),
          { headers: { "Content-Type": "audio/mpeg", "Accept-Ranges": "bytes" } }
        );
      }

      // Fallback: Uint8Array direkt
      if (body instanceof Uint8Array) {
        return new Response(
          new Blob([toArrayBufferSafe(body)], { type: "audio/mpeg" }),
          { headers: { "Content-Type": "audio/mpeg", "Accept-Ranges": "bytes" } }
        );
      }

      // Letzter Fallback: transformToByteArray(), falls vorhanden
      const maybe = body as { transformToByteArray?: () => Promise<Uint8Array> };
      if (typeof maybe.transformToByteArray === "function") {
        const bytes = await maybe.transformToByteArray();
        return new Response(
          new Blob([toArrayBufferSafe(bytes)], { type: "audio/mpeg" }),
          { headers: { "Content-Type": "audio/mpeg", "Accept-Ranges": "bytes" } }
        );
      }

      // Nichts Passendes
      return NextResponse.json({ error: "UNSUPPORTED_BODY" }, { status: 500 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "S3_STREAM_FAILED";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  // 3) Lokal: public/generated/<jobId>.mp3
  if (!jobId) {
    return NextResponse.json({ error: "NO_JOB_ID" }, { status: 404 });
  }
  try {
    const rel = path.join("public", "generated", `${jobId}.mp3`);
    const abs = path.join(process.cwd(), rel);
    const file = await fs.readFile(abs); // Buffer
    const u8 = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
    return new Response(
      new Blob([toArrayBufferSafe(u8)], { type: "audio/mpeg" }),
      { headers: { "Content-Type": "audio/mpeg", "Accept-Ranges": "bytes" } }
    );
  } catch {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
}