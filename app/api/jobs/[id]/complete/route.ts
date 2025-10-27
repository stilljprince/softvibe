import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { $Enums } from "@prisma/client";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ✅ erst prüfen, ob der Job dem Nutzer gehört
  const found = await prisma.job.findFirst({
    where: { id: params.id, userId: session.user.id },
    select: { id: true },
  });
  if (!found) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const job = await prisma.job.update({
    where: { id: params.id },
    data: {
      status: $Enums.JobStatus.DONE,
      resultUrl:
        "https://cdn.pixabay.com/download/audio/2021/10/26/audio_5f2b3f.mp3?filename=softvibe-demo.mp3",
      error: null,
    },
    select: { id: true, status: true, resultUrl: true },
  });

  return NextResponse.json(job);
}