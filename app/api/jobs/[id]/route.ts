import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { jsonOk, jsonError } from "@/lib/api";
import {
  hasS3Env,
  deleteObjectByKey,
  s3KeyFromUrl,
  s3KeyForJob,
} from "@/lib/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * GET /api/jobs/[id]
 * Wird von /generate für das Polling benutzt.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return jsonError("UNAUTHORIZED", 401, { message: "Bitte einloggen." });
  }
  const { id: jobId } = await ctx.params; // ✅

  if (!jobId) {
    return jsonError("JOB_ID_MISSING", 400, { message: "Job ID missing" });
  }

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      userId: true,
      title: true,
      prompt: true,
      preset: true,
      status: true,
      resultUrl: true,
      error: true,
      createdAt: true,
      updatedAt: true,
      durationSec: true,
    
    },
  });

  if (!job) {
    return jsonError("NOT_FOUND", 404, { message: "Job not found" });
  }

  if (job.userId !== session.user.id) {
    return jsonError("FORBIDDEN", 403, { message: "Forbidden" });
  }

  const { userId, ...safe } = job;
  // Dein Frontend kann sowohl plain Objekt als auch {data: …} lesen
  return jsonOk(safe, 200);
}

/**
 * DELETE /api/jobs/[id]
 *
 * - normaler User: braucht gültige Session, darf nur eigene Jobs löschen
 * - System: darf mit x-softvibe-job-secret auch ohne Session löschen
 * - Löscht:
 *    1) alle zugehörigen Tracks (inkl. S3-Objekte)
 *    2) das S3-Objekt des Jobs (fallback über jobId)
 *    3) den Job selbst
 */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await ctx.params; // ✅

  if (!jobId) {
    return jsonError("JOB_ID_MISSING", 400, { message: "Job ID missing" });
  }

  const systemSecret = req.headers.get("x-softvibe-job-secret");
  const isSystem =
    systemSecret && systemSecret === process.env.JOB_SYSTEM_SECRET;

  let userId: string | null = null;

  if (!isSystem) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return jsonError("UNAUTHORIZED", 401, { message: "Unauthorized" });
    }
    userId = session.user.id;
  }

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      userId: true,
    },
  });

  if (!job) {
    return jsonError("NOT_FOUND", 404, { message: "Not found" });
  }

  if (!isSystem && job.userId !== userId) {
    return jsonError("FORBIDDEN", 403, { message: "Forbidden" });
  }

  const hasS3 = hasS3Env();

  // 1) Alle Tracks zu diesem Job löschen (inkl. S3)
  const tracks = await prisma.track.findMany({
    where: {
      OR: [
        { jobId: jobId },
        { url: { contains: `/api/jobs/${jobId}/audio` } },
      ],
    },
    select: { id: true, url: true },
  });

  for (const t of tracks) {
    if (hasS3) {
      const key = s3KeyFromUrl(t.url);
      if (key) {
        try {
          await deleteObjectByKey(key);
        } catch (err) {
          console.error(
            "[jobs:delete] S3 delete failed for track",
            t.id,
            err
          );
        }
      }
    }

    await prisma.track.delete({ where: { id: t.id } });
  }

  // 2) Zusätzlich: Job-Audio direkt über jobId löschen (falls kein Track existiert)
  if (hasS3) {
    try {
      const key = s3KeyForJob(jobId);
      await deleteObjectByKey(key);
    } catch (err) {
      // Wenn's das Objekt schon nicht mehr gibt, ist das okay
      console.error("[jobs:delete] S3 delete by jobId failed", jobId, err);
    }
  }

  // 3) Job löschen
  await prisma.job.delete({ where: { id: jobId } });

  return new NextResponse(null, { status: 204 });
}