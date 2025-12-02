// lib/s3.ts
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  type PutObjectCommandInput,
  type GetObjectCommandOutput,
  type HeadObjectCommandOutput,
  type ObjectCannedACL,
} from "@aws-sdk/client-s3";

/** S3 Client (R2 kompatibel) */
export const s3 = new S3Client({
  region: process.env.S3_REGION || "auto",
  endpoint: process.env.S3_ENDPOINT || undefined,
  credentials:
    process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.S3_ACCESS_KEY_ID!,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
        }
      : undefined,
  forcePathStyle: !!process.env.S3_FORCE_PATH_STYLE,
});

/** Ist S3/R2 korrekt konfiguriert? */
export function hasS3Env(): boolean {
  return Boolean(
    process.env.S3_BUCKET &&
      (process.env.S3_ACCESS_KEY_ID || process.env.S3_ENDPOINT) // bei R2 reicht oft Endpoint+Tokens
  );
}

/** Key-Namensschema: <prefix>/<jobId>.mp3 */
export function s3KeyForJob(jobId: string): string {
  const prefix = (process.env.S3_PREFIX || "generated").replace(/^\/|\/$/g, "");
  return `${prefix}/${jobId}.mp3`;
}

/** Upload MP3 – akzeptiert Buffer/Uint8Array/ArrayBuffer */
export async function uploadMP3ToS3(
  key: string,
  data: Uint8Array | ArrayBuffer | Buffer
) {
  const Bucket = process.env.S3_BUCKET;
  if (!Bucket) throw new Error("S3_BUCKET missing");

  const Body: Uint8Array =
    data instanceof ArrayBuffer ? new Uint8Array(data) : (data as Uint8Array);

  const acl = process.env.S3_OBJECT_ACL as ObjectCannedACL | undefined;

  const input: PutObjectCommandInput = {
    Bucket,
    Key: key,
    Body,
    ContentType: "audio/mpeg",
    ...(acl ? { ACL: acl } : {}),
  };

  await s3.send(new PutObjectCommand(input));
  return key;
}

/** Head: nur Metadaten (ContentLength/Type) */
export async function headObjectByKey(
  key: string
): Promise<Pick<HeadObjectCommandOutput, "ContentLength" | "ContentType">> {
  const Bucket = process.env.S3_BUCKET;
  if (!Bucket) throw new Error("S3_BUCKET missing");
  const out = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
  return { ContentLength: out.ContentLength, ContentType: out.ContentType };
}

/** Get: Objekt inkl. Body */
export async function getObjectByKey(
  key: string
): Promise<
  Pick<GetObjectCommandOutput, "Body" | "ContentLength" | "ContentType">
> {
  const Bucket = process.env.S3_BUCKET;
  if (!Bucket) throw new Error("S3_BUCKET missing");
  const out = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
  return {
    Body: out.Body,
    ContentLength: out.ContentLength,
    ContentType: out.ContentType,
  };
}

/** Objekt per Key löschen */
export async function deleteObjectByKey(key: string): Promise<void> {
  const Bucket = process.env.S3_BUCKET;
  if (!Bucket) throw new Error("S3_BUCKET missing");
  await s3.send(
    new DeleteObjectCommand({
      Bucket,
      Key: key,
    })
  );
}

/**
 * Aus einer URL den S3-Key extrahieren.
 * Spezialfall: /api/jobs/<jobId>/audio -> s3KeyForJob(jobId)
 */
export function s3KeyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  // Helper: Pfad normalisieren + auf /api/jobs/<id>/audio prüfen
  const extractFromPath = (rawPath: string): string | null => {
    const path = rawPath.replace(/^\/+/, ""); // führende Slashes weg
    if (!path) return null;

    // /api/jobs/<jobId>/audio -> jobId
    const m = path.match(/^api\/jobs\/([^/]+)\/audio$/);
    if (m && m[1]) {
      return s3KeyForJob(m[1]);
    }

    // sonst: Pfad direkt als Key verwenden
    return path;
  };

  try {
    const u = new URL(url);
    const key = extractFromPath(u.pathname);
    if (key) return key;
  } catch {
    // war wohl keine absolute URL
  }

  // Fallback: relative URL oder schon ein Key
  const noLead = url.replace(/^\/+/, "");
  const key = extractFromPath(noLead);
  if (key) return key;

  // letzter Fallback: wenn's halbwegs "key-artig" aussieht
  return url.includes(" ") ? null : noLead;
}

export function s3EnvSummary() {
  return {
    hasS3: hasS3Env(),
    bucket: process.env.S3_BUCKET ?? null,
    region: process.env.S3_REGION ?? null,
    endpoint: process.env.S3_ENDPOINT ?? null,
    prefix: process.env.S3_PREFIX ?? null,
    forcePathStyle: !!process.env.S3_FORCE_PATH_STYLE,
  };
}