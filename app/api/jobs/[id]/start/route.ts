// app/api/jobs/[id]/start/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { rateLimit, clientIpFromRequest } from "@/lib/rate";
import { headers } from "next/headers";
import { log } from "@/lib/log";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const h = await headers();
  const { id } = await ctx.params;

  log.info(h, "jobs:start", { id });

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    log.warn(h, "jobs:start:unauthorized", { id });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const key = session?.user?.id
    ? `u:${session.user.id}:start`
    : `ip:${clientIpFromRequest(req)}:start`;
  const rl = rateLimit(key, 10, 60_000); // 10 Starts/Minute

  if (!rl.ok) {
    log.warn(h, "jobs:start:rate_limited", { id });
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Zu viele Anfragen. Bitte kurz warten." },
      { status: 429, headers: rl.headers }
    );
  }

  const job = await prisma.job.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, status: true },
  });
  if (!job) {
    log.warn(h, "jobs:start:not_found", { id });
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  if (job.status === "PROCESSING") {
    log.info(h, "jobs:start:idempotent_ok", { id });
    return NextResponse.json({ id, status: job.status }, { status: 200 });
  }

  if (job.status !== "QUEUED") {
    log.warn(h, "jobs:start:invalid_state", { id, status: job.status });
    return NextResponse.json(
      { error: "INVALID_STATE", status: job.status },
      { status: 409 }
    );
  }

  const updated = await prisma.job.update({
    where: { id },
    data: { status: "PROCESSING" },
    select: { id: true, status: true },
  });

  log.info(h, "jobs:start:ok", { id });
  return NextResponse.json(updated, { status: 200 });
}