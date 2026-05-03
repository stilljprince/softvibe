// lib/api.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";

function normalizeInit(init?: number | ResponseInit): { status: number; headers?: HeadersInit } {
  if (typeof init === "number") {
    return { status: init, headers: undefined };
  }
  if (init) {
    return {
      status: typeof init.status === "number" ? init.status : 200,
      headers: init.headers,
    };
  }
  return { status: 200, headers: undefined };
}

export function jsonOk<T>(data: T, init?: number | ResponseInit) {
  const { status, headers } = normalizeInit(init);
  return NextResponse.json({ ok: true, data }, { status, headers });
}

/**
 * Fehlerantwort:
 * - Neue Nutzung:  jsonError({ error: "X", details }, 503)
 * - Alte Nutzung:  jsonError("X", 400, { details }, headers?)
 */
export function jsonError(
  errorOrData: string | Record<string, unknown>,
  init?: number | ResponseInit,
  extra?: Record<string, unknown>,
  headersOverride?: HeadersInit
) {
  // Body zusammenbauen (string → { error }, object → direkt mergen)
  const body =
    typeof errorOrData === "string"
      ? { ok: false, error: errorOrData, ...(extra ?? {}) }
      : { ok: false, ...errorOrData };

  // Status/Headers normalisieren
  const { status, headers } = normalizeInit(init);
  return NextResponse.json(body, {
    status,
    headers: headersOverride ?? headers,
  });
}

export async function readJsonSafe<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export async function requireAuth(): Promise<{ userId: string } | null> {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  return userId ? { userId } : null;
}

export async function awaitParams<T>(ctx: { params: Promise<T> }): Promise<T> {
  return await ctx.params;
}

export function retryAfterHeaders(seconds: number): HeadersInit {
  return { "Retry-After": String(Math.max(0, Math.floor(seconds))) };
}