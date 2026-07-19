// app/api/library/sponsored/simulated/complete/route.ts
//
// RP-004E1 — Authenticated route that completes a previously started
// simulated Sponsored Unlock event and, on success, claims the
// underlying LibraryUnlock via the central helper.
//
// Contract:
//
//   * Requires next-auth session. Anonymous callers → 401.
//   * Body: { eventId: string }. NO librarySessionId, NO userId, NO
//     adCompleted, NO elapsedSeconds — every authoritative fact comes
//     from the persisted SponsoredUnlockEvent row.
//   * Feature-flagged via SIMULATED_SPONSORED_UNLOCK_ENABLED.
//   * Retries are idempotent: replaying the same eventId returns the
//     same LibraryUnlock outcome as `reused`.
//
// The route does NOT accept the browser's assertion of elapsed time.
// The server checks now against eligibleAt / expiresAt using its own
// clock; a manipulated client cannot forge either.

import { getServerSession } from "next-auth";
import { cookies, headers } from "next/headers";
import { authOptions } from "@/lib/auth/config";
import { jsonError, jsonOk } from "@/lib/api";
import { log } from "@/lib/log";
import { toErrData } from "@/lib/error";
import { rateLimit, clientIpFromRequest } from "@/lib/rate";
import {
  completeSimulatedSponsoredEvent,
  type CompleteSponsoredEventErrorCode,
} from "@/lib/entitlement/sponsored-simulated";
import {
  LIBRARY_QA_MODE_COOKIE_NAME,
  resolveLibraryEffectiveAccess,
} from "@/lib/entitlement/library-effective-access";

export const runtime = "nodejs";

type RawBody = { eventId?: unknown };

async function readBody(req: Request): Promise<RawBody> {
  try {
    return (await req.json()) as RawBody;
  } catch {
    return {};
  }
}

function httpForCompleteError(code: CompleteSponsoredEventErrorCode): number {
  switch (code) {
    case "SIMULATION_DISABLED":
      return 503;
    case "EVENT_NOT_FOUND":
      return 404;
    case "EVENT_WRONG_USER":
      // Do not leak "this event exists but belongs to someone else" —
      // clients treat it identically to EVENT_NOT_FOUND from the UI
      // perspective, but the on-the-wire code stays distinct for
      // server-side observability. 404 keeps enumeration cheap.
      return 404;
    case "EVENT_TOO_EARLY":
      return 409;
    case "EVENT_EXPIRED":
      return 409;
    case "EVENT_CANCELLED":
      return 409;
    case "USER_NOT_FOUND":
      return 401;
    case "SESSION_NOT_FOUND":
      return 404;
    case "SESSION_INACTIVE":
      return 409;
    case "DAILY_UNLOCK_LIMIT_REACHED":
      return 429;
    case "CONCURRENCY_CONFLICT":
      return 409;
  }
}

export async function POST(req: Request) {
  const h = await headers();
  log.info(h, "library:sponsored:simulated:complete:begin");

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return jsonError("Unauthorized", 401);
    }
    const userId = session.user.id as string;

    // 30 requests per minute per user + IP. Slightly higher than start
    // to accommodate legitimate retries after transient network failure.
    const ip = clientIpFromRequest(req);
    const rate = await rateLimit(
      `library:sponsored:simulated:complete:${userId}:${ip}`,
      30,
      60_000
    );
    if (!rate.ok) {
      return jsonError("RATE_LIMITED", 429, undefined, rate.headers);
    }

    const raw = await readBody(req);
    const eventId =
      typeof raw.eventId === "string" && raw.eventId.trim() !== ""
        ? raw.eventId.trim()
        : null;
    if (!eventId) {
      return jsonError("MISSING_EVENT_ID", 400);
    }

    const cookieStore = await cookies();
    const qaModeCookie =
      cookieStore.get(LIBRARY_QA_MODE_COOKIE_NAME)?.value ?? null;
    const effective = await resolveLibraryEffectiveAccess({
      userId,
      qaModeCookie,
    });
    const effectiveAccess = effective.ok ? effective.access : undefined;

    const result = await completeSimulatedSponsoredEvent({
      userId,
      eventId,
      effectiveAccess,
    });

    if (!result.ok) {
      log.warn(h, "library:sponsored:simulated:complete:rejected", {
        code: result.error,
      });
      return jsonError(result.error, httpForCompleteError(result.error));
    }

    log.info(h, "library:sponsored:simulated:complete:ok", {
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
    return jsonOk(
      {
        outcome: result.outcome,
        unlockId: result.unlockId,
        librarySessionId: result.librarySessionId,
        unlockedAt: result.unlockedAt.toISOString(),
        expiresAt: result.expiresAt.toISOString(),
      },
      200
    );
  } catch (e) {
    const { code, msg } = toErrData(e);
    log.error(h, "library:sponsored:simulated:complete:failed", { code, msg });
    return jsonError("INTERNAL_ERROR", 500, { code, message: msg });
  }
}
