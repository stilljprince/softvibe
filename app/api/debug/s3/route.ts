// app/api/debug/s3/route.ts
import { NextResponse } from "next/server";
import { s3EnvSummary } from "@/lib/s3";

export const runtime = "nodejs";

export async function GET() {
  const summary = s3EnvSummary();
  // Keys niemals loggen/ausgeben – nur Struktur!
  return NextResponse.json(summary);
}