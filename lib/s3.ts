// lib/s3.ts
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  type ObjectCannedACL,
} from "@aws-sdk/client-s3";

/** bool aus ENV sicher parsen */
function parseBool(v: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(v ?? "");
}

/** sind die wichtigsten Variablen da? */
export function hasS3Env() {
  return !!(
    process.env.S3_BUCKET &&
    process.env.S3_REGION &&
    process.env.S3_ACCESS_KEY_ID &&
    process.env.S3_SECRET_ACCESS_KEY
  );
}

/** nur für Debug-Ausgaben */
export function s3EnvSummary() {
  return {
    hasS3: hasS3Env(),
    bucket: process.env.S3_BUCKET || null,
    region: process.env.S3_REGION || null,
    endpoint: process.env.S3_ENDPOINT || null,
    prefix: process.env.S3_PREFIX || null,
    forcePathStyle: parseBool(process.env.S3_FORCE_PATH_STYLE),
  };
}

/** globaler S3-Client */
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
  // wichtig: nicht !!string, sondern korrekt parsen
  forcePathStyle: parseBool(process.env.S3_FORCE_PATH_STYLE),
});

/** konsistenter Key: <prefix>/<id>.mp3 */
export function s3KeyForJob(jobId: string) {
  const prefix = (process.env.S3_PREFIX || "generated").replace(/^\/+|\/+$/g, "");
  return `${prefix}/${jobId}.mp3`;
}

/** Normalisierung nach Uint8Array (deckt Buffer UND Uint8Array ab) */
function toUint8(input: Uint8Array | ArrayBuffer): Uint8Array {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  // Buffer ist eine Unterklasse von Uint8Array → direkt nutzbar
  return input;
}

/** Upload: akzeptiert Uint8Array/ArrayBuffer/Buffer */
export async function uploadMP3ToS3(
  key: string,
  data: Uint8Array | ArrayBuffer | Buffer
) {
  const Bucket = process.env.S3_BUCKET;
  if (!Bucket) throw new Error("S3_BUCKET missing");

  // TS-sicher normalisieren (Buffer wird hier als Uint8Array behandelt)
  const Body = toUint8(data as Uint8Array | ArrayBuffer);

  const acl = process.env.S3_OBJECT_ACL as ObjectCannedACL | undefined;

  await s3.send(
    new PutObjectCommand({
      Bucket,
      Key: key,
      Body,
      ContentType: "audio/mpeg",
      ...(acl ? { ACL: acl } : {}),
    })
  );

  return key;
}

/** GetObject (für Proxy) */
export async function getObjectForKey(key: string) {
  const Bucket = process.env.S3_BUCKET;
  if (!Bucket) throw new Error("S3_BUCKET missing");
  return s3.send(new GetObjectCommand({ Bucket, Key: key }));
}