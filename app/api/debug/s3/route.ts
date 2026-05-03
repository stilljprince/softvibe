// app/api/debug/s3/route.ts
import { s3EnvSummary } from "@/lib/s3";
import { jsonOk } from "@/lib/api";
export const runtime = "nodejs";

export async function GET() {
  const summary = s3EnvSummary();
  // Keys niemals loggen/ausgeben – nur Struktur!
  return jsonOk(summary, 200);
}