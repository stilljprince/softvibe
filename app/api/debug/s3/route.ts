// app/api/debug/s3/route.ts
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { s3EnvSummary } from "@/lib/s3";
import { jsonOk, jsonError } from "@/lib/api";
export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return jsonError("UNAUTHORIZED", 401);
  }

  // isAdmin lives only in the DB, not the JWT — must check here
  const caller = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isAdmin: true },
  });
  if (!caller?.isAdmin) {
    return jsonError("FORBIDDEN", 403);
  }

  const summary = s3EnvSummary();
  // Keys niemals loggen/ausgeben – nur Struktur!
  return jsonOk(summary, 200);
}