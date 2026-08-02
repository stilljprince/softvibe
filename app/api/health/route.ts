// app/api/health/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { s3, hasS3Env } from "@/lib/s3";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import fs from "node:fs/promises";
import path from "node:path";
import { headers } from "next/headers";
import { log } from "@/lib/log";

export const runtime = "nodejs";

// Public, unauthenticated endpoint (used by hosting/monitoring). Response is
// intentionally boolean-only — no raw exceptions, bucket/region/endpoint, or
// filesystem paths are ever returned. Full technical detail is logged
// server-side only.
type Check = { ok: boolean };
type S3Check = { enabled: boolean; ok?: boolean };

export async function GET() {
  const h = await headers();

  const results: {
    db: Check;
    s3: S3Check;
    disk: Check;
    timestamp: string;
  } = {
    db: { ok: false },
    s3: { enabled: false },
    disk: { ok: false },
    timestamp: new Date().toISOString(),
  };

  // 1) DB check (schnell & harmlos)
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = await prisma.$queryRaw`SELECT 1`;
    results.db.ok = true;
  } catch (e) {
    results.db.ok = false;
    log.error(h, "health:db:failed", {
      msg: e instanceof Error ? e.message : "DB_CHECK_FAILED",
    });
  }

  // 2) S3 check (nur wenn env konfiguriert)
  try {
    const enabled = hasS3Env();
    results.s3.enabled = enabled;
    if (enabled) {
      const Bucket = process.env.S3_BUCKET ?? null;
      if (!Bucket) {
        results.s3.ok = false;
        log.error(h, "health:s3:failed", { msg: "S3_BUCKET missing" });
      } else {
        await s3.send(new HeadBucketCommand({ Bucket })); // leichtgewichtiger Existenz-Check
        results.s3.ok = true;
      }
    }
  } catch (e) {
    results.s3.ok = false;
    log.error(h, "health:s3:failed", {
      msg: e instanceof Error ? e.message : "S3_CHECK_FAILED",
    });
  }

  // 3) Disk check (lokaler Fallback-Ordner)
  try {
    const dir = path.join(process.cwd(), "public", "generated");
    await fs.mkdir(dir, { recursive: true });
    await fs.access(dir);
    results.disk.ok = true;
  } catch (e) {
    results.disk.ok = false;
    log.error(h, "health:disk:failed", {
      msg: e instanceof Error ? e.message : "DISK_CHECK_FAILED",
    });
  }

  const allOk =
    results.db.ok &&
    (results.s3.enabled ? results.s3.ok === true : true) &&
    results.disk.ok;

  return NextResponse.json(results, { status: allOk ? 200 : 503 });
}
