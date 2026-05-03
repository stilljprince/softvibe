// app/api/debug/logs/route.ts
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { getDebugLogs } from "@/lib/debug-log";
import { headers } from "next/headers";
import { jsonOk, jsonError } from "@/lib/api";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return jsonError("UNAUTHORIZED", 401);
  }

  const adminEmail = process.env.DEBUG_LOG_EMAIL?.trim();
  if (adminEmail && session.user.email !== adminEmail) {
    return jsonError("FORBIDDEN", 403);
  }

  const h = await headers();
  const reqId = h.get("x-request-id") ?? undefined;

  const { searchParams } = new URL(req.url);
  const limit = Number(searchParams.get("limit") ?? "100");

  const items = getDebugLogs(Number.isFinite(limit) ? limit : 100);
  return jsonOk({ reqId, items }, 200);
}