// app/api/jobs/[id]/fail/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { jsonOk, jsonError } from "@/lib/api";
import { releasePlanMinuteReservation } from "@/lib/entitlement/release";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const parts = url.pathname.split("/"); // ["", "api", "jobs", "<id>", "fail"]
  const jobId = parts[3];

  if (!jobId) {
    return jsonError("Job ID missing", 400);
  }

  const systemSecret = req.headers.get("x-softvibe-job-secret");
  const isSystem =
    systemSecret && systemSecret === process.env.JOB_SYSTEM_SECRET;

  let userId: string | null = null;
  if (!isSystem) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return jsonError("Unauthorized", 401);
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
    return jsonError("Not found", 404);
  }

  if (!isSystem && job.userId !== userId) {
    return jsonError("Forbidden", 403);
  }

  const errorText = "Vom System / User manuell auf FAILED gesetzt.";

  // RP-010 Phase 3C — route the FAILED persist through the central release
  // helper so PLAN_MINUTES reservations return their reserved minutes
  // atomically with the FAILED write. Non-PLAN_MINUTES Jobs take the
  // helper's no_reservation branch — a plain FAILED update, preserving
  // pre-Phase-3C behaviour for legacy / FREE / admin Jobs. Auth and
  // system-secret handling above is unchanged.
  const releaseResult = await releasePlanMinuteReservation({
    jobId,
    error: errorText,
  });
  if (!releaseResult.ok) {
    return jsonError(releaseResult.error, 500);
  }

  const updated = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      resultUrl: true,
      prompt: true,
      preset: true,
      durationSec: true,
      createdAt: true,
      error: true,
    },
  });

  return jsonOk(updated, 200);
}