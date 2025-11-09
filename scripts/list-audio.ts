// scripts/list-audio.ts
import "dotenv/config";
import { s3 } from "../lib/s3";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";

async function main() {
  const Bucket = process.env.S3_BUCKET!;
  const Prefix = process.env.S3_PREFIX || "generated/";
  const out = await s3.send(new ListObjectsV2Command({ Bucket, Prefix, MaxKeys: 20 }));
  for (const o of out.Contents ?? []) {
    console.log(o.Key, o.Size, o.LastModified);
  }
}
main().catch(console.error);