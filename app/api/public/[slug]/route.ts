// app/api/public/[slug]/route.ts
import { prisma } from "@/lib/prisma";
import { hasS3Env, s3KeyForJob, s3 } from "@/lib/s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import path from "node:path";
import fs from "node:fs/promises";
import { headers } from "next/headers";
import { log } from "@/lib/log";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

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

function toArrayBufferSafe(u8: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(u8.byteLength);
  out.set(u8);
  return out.buffer;
}

function isAsyncIterableBody(
  body: unknown
): body is AsyncIterable<Uint8Array> {
  return (
    typeof body === "object" &&
    body !== null &&
    Symbol.asyncIterator in (body as object)
  );
}

function jobIdFromAudioUrl(url?: string | null): string | null {
  if (!url) return null;
  const m = /^\/api\/jobs\/([^/]+)\/audio$/i.exec(url);
  return m ? m[1] : null;
}

export async function GET(_req: Request, ctx: Ctx) {
  const h = await headers();
  const { slug } = await ctx.params;

  log.info(h, "public:audio:start", { slug });

  // 🔹 Kein Login mehr – Zugriff rein über shareSlug + isPublic
  const track = await prisma.track.findFirst({
    where: { shareSlug: slug, isPublic: true },
    select: { id: true, jobId: true, url: true },
  });

  if (!track) {
    log.warn(h, "public:audio:not_found", { slug });
    return jsonError("NOT_FOUND", 404);
  }

  const jobId = track.jobId ?? jobIdFromAudioUrl(track.url);
  if (!jobId) {
    log.warn(h, "public:audio:no_job_id", { slug });
    return jsonError("NO_JOB_ID", 404);
  }

  let u8: Uint8Array;

  if (hasS3Env()) {
    try {
      const Bucket = process.env.S3_BUCKET!;
      const Key = s3KeyForJob(jobId);
      const resp = await s3.send(new GetObjectCommand({ Bucket, Key }));
      const body = resp.Body;

      if (!body) {
        log.error(h, "public:audio:empty_body", { slug });
        return jsonError("EMPTY_BODY", 404);
      }

      if (isAsyncIterableBody(body)) {
        const chunks: Uint8Array[] = [];
        for await (const part of body) {
          chunks.push(part);
        }
        u8 = concatU8(chunks);
        log.info(h, "public:audio:ok", { slug, src: "s3:iterable" });
      } else {
        const maybe = body as { transformToByteArray?: () => Promise<Uint8Array> };
        if (typeof maybe.transformToByteArray === "function") {
          const bytes = await maybe.transformToByteArray();
          u8 = new Uint8Array(bytes.buffer.slice(0));
          log.info(h, "public:audio:ok", { slug, src: "s3:bytearray" });
        } else if (body instanceof Uint8Array) {
          u8 = new Uint8Array(body.buffer.slice(0));
          log.info(h, "public:audio:ok", { slug, src: "s3:u8" });
        } else {
          log.error(h, "public:audio:unsupported_body", { slug });
          return jsonError("UNSUPPORTED_BODY", 500);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "S3_STREAM_FAILED";
      log.error(h, "public:audio:failed", { slug, msg });
      return jsonError(msg, 500);
    }
  } else {
    // 🔹 Lokale Datei unter /public/generated/[jobId].mp3
    try {
      const rel = path.join("public", "generated", `${jobId}.mp3`);
      const abs = path.join(process.cwd(), rel);
      const file = await fs.readFile(abs);
      u8 = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
      log.info(h, "public:audio:ok", { slug, src: "local" });
    } catch {
      log.warn(h, "public:audio:local_missing", { slug });
      return jsonError("NOT_FOUND", 404);
    }
  }

  const hdrs = new Headers();
  hdrs.set("Content-Type", "audio/mpeg");
  hdrs.set("Accept-Ranges", "bytes");
  hdrs.set("Content-Length", String(u8.byteLength));

  return new Response(toArrayBufferSafe(u8), { headers: hdrs });
}