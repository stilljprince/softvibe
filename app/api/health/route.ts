// app/api/health/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { s3, hasS3Env } from "@/lib/s3";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

type Check = { ok: boolean; error?: string };
type S3Check = { enabled: boolean; ok?: boolean; bucket?: string | null; region?: string | null; error?: string };

export async function GET() {
  const results: {
    db: Check;
    s3: S3Check;
    disk: Check & { dir: string };
    timestamp: string;
  } = {
    db: { ok: false },
    s3: { enabled: false },
    disk: { ok: false, dir: path.join(process.cwd(), "public", "generated") },
    timestamp: new Date().toISOString(),
  };

  // 1) DB check (schnell & harmlos)
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = await prisma.$queryRaw`SELECT 1`;
    results.db.ok = true;
  } catch (e) {
    results.db.ok = false;
    results.db.error = e instanceof Error ? e.message : "DB_CHECK_FAILED";
  }

  // 2) S3 check (nur wenn env konfiguriert)
  try {
    const enabled = hasS3Env();
    results.s3.enabled = enabled;
    if (enabled) {
      const Bucket = process.env.S3_BUCKET ?? null;
      const region = process.env.S3_REGION ?? null;
      results.s3.bucket = Bucket;
      results.s3.region = region;

      if (!Bucket) {
        results.s3.ok = false;
        results.s3.error = "S3_BUCKET missing";
      } else {
        await s3.send(new HeadBucketCommand({ Bucket })); // leichtgewichtiger Existenz-Check
        results.s3.ok = true;
      }
    }
  } catch (e) {
    results.s3.ok = false;
    results.s3.error = e instanceof Error ? e.message : "S3_CHECK_FAILED";
  }

  // 3) Disk check (lokaler Fallback-Ordner)
  try {
    await fs.mkdir(results.disk.dir, { recursive: true });
    await fs.access(results.disk.dir);
    results.disk.ok = true;
  } catch (e) {
    results.disk.ok = false;
    results.disk.error = e instanceof Error ? e.message : "DISK_CHECK_FAILED";
  }

  const allOk =
    results.db.ok &&
    (results.s3.enabled ? results.s3.ok === true : true) &&
    results.disk.ok;

  return NextResponse.json(results, { status: allOk ? 200 : 503 });
}