// app/api/jobs/[id]/complete/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { $Enums } from "@prisma/client";

type Params = {
  params: {
    id: string;
  };
};

export async function POST(_req: Request, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // nur eigenen Job updaten
  const job = await prisma.job.findFirst({
    where: {
      id: params.id,
      userId: session.user.id,
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await prisma.job.update({
    where: { id: params.id },
    data: {
      status: $Enums.JobStatus.DONE,
      // hier könnten wir eine echte URL setzen – fürs Testing reicht ein Dummy
      resultUrl: job.resultUrl ?? "https://example.com/fake-asmr.mp3",
    },
    select: {
      id: true,
      status: true,
      resultUrl: true,
      prompt: true,
      preset: true,
      error: true,
      createdAt: true,
    },
  });

  return NextResponse.json(updated);
}