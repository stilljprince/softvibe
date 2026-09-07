// app/api/library/sponsored/gam-web/complete/route.ts
//
// F-003 Slice 1 — Authenticated route that completes a previously
// started Google Ad Manager Rewarded Web sponsored-unlock event and, on
// success, claims the underlying LibraryUnlock via the central helper.
//
// Contract:
//
//   * Requires next-auth session. Anonymous callers → 401.
//   * Body: { eventId: string }. NO librarySessionId, NO userId, NO
//     reward/unlock flags — every authoritative fact comes from the
//     persisted SponsoredUnlockEvent row.
//   * Gated by SPONSORED_GAM_WEB_MODE.
//   * Retries are idempotent: replaying the same eventId returns the
//     same LibraryUnlock outcome as `reused`.
//
// Residual-risk note (see lib/entitlement/sponsored-gam-web.ts): this
// completion is an authenticated browser-originated signal, NOT a
// cryptographically verified provider callback. The server still
// enforces user/event/provider/expiry/session binding, the daily limit,
// active-unlock reuse, idempotency and concurrency safety — it simply
// cannot prove Google itself granted the reward. That gap is accepted
// for this MVP slice and is why /api/library/sponsored/verify (the real
// HMAC contract) is untouched and unrelated to this route.

import { getServerSession } from "next-auth";
import { cookies, headers } from "next/headers";
import { authOptions } from "@/lib/auth/config";
import { jsonError, jsonOk } from "@/lib/api";
import { log } from "@/lib/log";
import { toErrData } from "@/lib/error";
import { rateLimit, clientIpFromRequest } from "@/lib/rate";
import {
  completeGamWebSponsoredEvent,
  type CompleteGamWebEventErrorCode,
} from "@/lib/entitlement/sponsored-gam-web";
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

function httpForCompleteError(code: CompleteGamWebEventErrorCode): number {
  switch (code) {
    case "PROVIDER_UNAVAILABLE":
      return 503;
    case "EVENT_NOT_FOUND":
      return 404;
    case "EVENT_WRONG_USER":
      // Same enumeration-hardening rationale as the simulated route:
      // 404 rather than 403 so a stolen event id cannot be distinguished
      // from a nonexistent one by status code alone.
      return 404;
    case "PROVIDER_MISMATCH":
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
  log.info(h, "library:sponsored:gam-web:complete:begin");

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return jsonError("Unauthorized", 401);
    }
    const userId = session.user.id as string;

    // Same shape as the simulated provider: 30 requests/min per user+IP.
    const ip = clientIpFromRequest(req);
    const rate = await rateLimit(
      `library:sponsored:gam-web:complete:${userId}:${ip}`,
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

    const result = await completeGamWebSponsoredEvent({
      userId,
      eventId,
      effectiveAccess,
    });

    if (!result.ok) {
      log.warn(h, "library:sponsored:gam-web:complete:rejected", {
        code: result.error,
      });
      return jsonError(result.error, httpForCompleteError(result.error));
    }

    log.info(h, "library:sponsored:gam-web:complete:ok", {
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
    log.error(h, "library:sponsored:gam-web:complete:failed", { code, msg });
    return jsonError("INTERNAL_ERROR", 500, { code, message: msg });
  }
}
