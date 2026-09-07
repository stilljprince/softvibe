// app/api/library/sponsored/gam-web/start/route.ts
//
// F-003 Slice 1 — Authenticated route that begins a Google Ad Manager
// Rewarded Web sponsored-unlock flow for the current user. Curated
// Library only.
//
// This route is *only* the auth + rate-limit dispatcher; all lifecycle
// decisions live in `lib/entitlement/sponsored-gam-web.ts`.
//
// Contract:
//
//   * Requires next-auth session. Anonymous callers → 401.
//   * userId is NEVER accepted from the client body.
//   * Body: { librarySessionId: string }.
//   * Gated by SPONSORED_GAM_WEB_MODE ("test" | "live"); missing/invalid
//     config returns { ok: false, error: PROVIDER_UNAVAILABLE }.
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
  startGamWebSponsoredEvent,
  type StartGamWebEventErrorCode,
} from "@/lib/entitlement/sponsored-gam-web";
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

function httpForStartError(code: StartGamWebEventErrorCode): number {
  switch (code) {
    case "PROVIDER_UNAVAILABLE":
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
  log.info(h, "library:sponsored:gam-web:start:begin");

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return jsonError("Unauthorized", 401);
    }
    const userId = session.user.id as string;

    // Same shape as the simulated provider: 20 requests/min per user+IP.
    const ip = clientIpFromRequest(req);
    const rate = await rateLimit(
      `library:sponsored:gam-web:start:${userId}:${ip}`,
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

    const result = await startGamWebSponsoredEvent({
      userId,
      librarySessionId,
      effectiveAccess,
    });

    if (!result.ok) {
      log.warn(h, "library:sponsored:gam-web:start:rejected", {
        code: result.error,
      });
      return jsonError(result.error, httpForStartError(result.error));
    }

    log.info(h, "library:sponsored:gam-web:start:ok", {
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
      },
      200
    );
  } catch (e) {
    const { code, msg } = toErrData(e);
    log.error(h, "library:sponsored:gam-web:start:failed", { code, msg });
    return jsonError("INTERNAL_ERROR", 500, { code, message: msg });
  }
}
