// app/api/jobs/[id]/fail/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { jsonOk, jsonError } from "@/lib/api";
import { releasePlanMinuteReservation } from "@/lib/entitlement/release";
import { restoreProbeOnTerminalFailure } from "@/lib/entitlement/probe-restoration";
import { $Enums } from "@prisma/client";
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
      // Phase 4A-2: PROBE-tagged Jobs must return their lifetime slot on
      // manual /fail via restoreProbeOnTerminalFailure, not release.ts.
      entitlementKind: true,
    },
  });

  if (!job) {
    return jsonError("Not found", 404);
  }

  if (!isSystem && job.userId !== userId) {
    return jsonError("Forbidden", 403);
  }

  const errorText = "Vom System / User manuell auf FAILED gesetzt.";

  // Phase 4A-2 dispatcher:
  //   * PROBE-tagged Jobs route through restoreProbeOnTerminalFailure —
  //     the lifetime probe slot is returned atomically with the FAILED
  //     write. Credits and PeriodUsage are never touched for PROBE. A
  //     repeated /fail is a no-op (already_restored) via the CAS on
  //     Job.probeRestoredAt.
  //   * Non-PROBE Jobs continue through releasePlanMinuteReservation
  //     (Phase 3C behaviour): PLAN_MINUTES reservations return their
  //     reserved minutes atomically with the FAILED write; legacy / FREE
  //     / admin Jobs take the no_reservation branch (plain FAILED).
  // Auth and system-secret handling above is unchanged. refundCreditIfEligible
  // is intentionally not passed here — manual /fail must not introduce a
  // new credit-refund policy on top of the pre-Phase-4A-2 behaviour.
  if (job.entitlementKind === $Enums.EntitlementKind.PROBE) {
    const restoreResult = await restoreProbeOnTerminalFailure({
      jobId,
      error: errorText,
      persistFailedStatus: true,
    });
    if (!restoreResult.ok) {
      return jsonError(restoreResult.error, 500);
    }
  } else {
    const releaseResult = await releasePlanMinuteReservation({
      jobId,
      error: errorText,
    });
    if (!releaseResult.ok) {
      return jsonError(releaseResult.error, 500);
    }
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