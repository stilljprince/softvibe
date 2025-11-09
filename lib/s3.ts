// lib/s3.ts
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
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