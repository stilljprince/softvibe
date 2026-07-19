// app/api/library/sponsored/simulated/start/route.ts
//
// RP-004E1 — Authenticated route that begins a simulated Sponsored
// Unlock experience for the current user.
//
// This route is *only* the auth + rate-limit dispatcher; all lifecycle
// decisions live in `lib/entitlement/sponsored-simulated.ts` so a real
// provider adapter (RP-004E2) can reuse the same service.
//
// Contract:
//
//   * Requires next-auth session. Anonymous callers → 401.
//   * userId is NEVER accepted from the client body.
//   * Body: { librarySessionId: string }.
//   * Feature-flagged via SIMULATED_SPONSORED_UNLOCK_ENABLED. When
//     disabled we return { ok: false, error: SIMULATION_DISABLED }.
//   * Response shapes mirror the service outcomes verbatim, ISO-serialised.
//
// The real HMAC route at /api/library/sponsored/verify is untouched.

import { getServerSession } from "next-auth";
import { cookies, headers } from "next/headers";
import { authOptions } from "@/lib/auth/config";
import { jsonError, jsonOk } from "@/lib/api";
import { log } from "@/lib/log";
import { toErrData } from "@/lib/error";
import { rateLimit, clientIpFromRequest } from "@/lib/rate";
import {
  startSimulatedSponsoredEvent,
  type StartSponsoredEventErrorCode,
} from "@/lib/entitlement/sponsored-simulated";
import {
  LIBRARY_QA_MODE_COOKIE_NAME,
  resolveLibraryEffectiveAccess,
} from "@/lib/entitlement/library-effective-access";

export const runtime = "nodejs";

type RawBody = { librarySessionId?: unknown };

async function readBody(req: Request): Promise<RawBody> {
  try {
    return (await req.json()) as RawBody;
  } catch {
    return {};
  }
}

function httpForStartError(code: StartSponsoredEventErrorCode): number {
  switch (code) {
    case "SIMULATION_DISABLED":
      return 503;
    case "USER_NOT_FOUND":
      return 401;
    case "SESSION_NOT_FOUND":
      return 404;
    case "SESSION_INACTIVE":
      return 409;
    case "CONCURRENCY_CONFLICT":
      return 409;
  }
}

export async function POST(req: Request) {
  const h = await headers();
  log.info(h, "library:sponsored:simulated:start:begin");

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return jsonError("Unauthorized", 401);
    }
    const userId = session.user.id as string;

    // 20 requests per minute per user + IP. Enough for a normal
    // interstitial retry loop; blocks brute-force event creation.
    const ip = clientIpFromRequest(req);
    const rate = await rateLimit(
      `library:sponsored:simulated:start:${userId}:${ip}`,
      20,
      60_000
    );
    if (!rate.ok) {
      return jsonError("RATE_LIMITED", 429, undefined, rate.headers);
    }

    const raw = await readBody(req);
    const librarySessionId =
      typeof raw.librarySessionId === "string" &&
      raw.librarySessionId.trim() !== ""
        ? raw.librarySessionId.trim()
        : null;
    if (!librarySessionId) {
      return jsonError("MISSING_LIBRARY_SESSION_ID", 400);
    }

    const cookieStore = await cookies();
    const qaModeCookie =
      cookieStore.get(LIBRARY_QA_MODE_COOKIE_NAME)?.value ?? null;
    const effective = await resolveLibraryEffectiveAccess({
      userId,
      qaModeCookie,
    });
    const effectiveAccess = effective.ok ? effective.access : undefined;

    const result = await startSimulatedSponsoredEvent({
      userId,
      librarySessionId,
      effectiveAccess,
    });

    if (!result.ok) {
      log.warn(h, "library:sponsored:simulated:start:rejected", {
        code: result.error,
      });
      return jsonError(result.error, httpForStartError(result.error));
    }

    log.info(h, "library:sponsored:simulated:start:ok", {
      outcome: result.outcome,
    });

    if (result.outcome === "direct_plan_access") {
      return jsonOk(
        {
          outcome: result.outcome,
          plan: result.plan,
          librarySessionId: result.librarySessionId,
        },
        200
      );
    }
    if (result.outcome === "active_unlock") {
      return jsonOk(
        {
          outcome: result.outcome,
          librarySessionId: result.librarySessionId,
          unlockExpiresAt: result.unlockExpiresAt.toISOString(),
        },
        200
      );
    }
    // event_created / event_reused share the same on-the-wire shape.
    return jsonOk(
      {
        outcome: result.outcome,
        eventId: result.eventId,
        librarySessionId: result.librarySessionId,
        eligibleAt: result.eligibleAt.toISOString(),
        expiresAt: result.expiresAt.toISOString(),
        minimumDurationSeconds: result.minimumDurationSeconds,
      },
      200
    );
  } catch (e) {
    const { code, msg } = toErrData(e);
    log.error(h, "library:sponsored:simulated:start:failed", { code, msg });
    return jsonError("INTERNAL_ERROR", 500, { code, message: msg });
  }
}
