// app/api/library/unlock/route.ts
//
// RP-010 Phase 4B-1 — Free Library Unlock Runtime (public dispatcher).
//
// Thin authenticated route that resolves per-session curated Library access.
// The heavy lifting lives in lib/entitlement/library-unlock.ts; this file is
// only a router:
//
//   * Paid callers (STARTER / PREMIUM inside their billing period) receive
//     `direct_plan_access` — no LibraryUnlock row is created, no daily
//     limit is touched.
//
//   * FREE callers receive `requires_sponsored_verification` and no
//     LibraryUnlock row is created. Phase 4B-1 intentionally does NOT
//     accept a plain authenticated POST as proof that a Sponsored
//     obligation was completed. The real server-verified Sponsored
//     provider path lands in Phase 4B-2 and will call
//     `claimLibrarySessionUnlock` directly with a trusted provider signal.
//
// The route neither reads nor accepts a client `adCompleted` boolean, and
// it does not accept a client-supplied providerEventId — those are only
// meaningful once a trusted server-side verification path exists.
//
// Auth uses the standard next-auth session pattern shared with the rest
// of /api/**. There is intentionally no new env variable and no new
// system-secret header for this route.

import { getServerSession } from "next-auth";
import { headers } from "next/headers";
import { authOptions } from "@/lib/auth/config";
import { jsonError, jsonOk } from "@/lib/api";
import { log } from "@/lib/log";
import { addDebugLog } from "@/lib/debug-log";
import { toErrData } from "@/lib/error";
import {
  claimLibrarySessionUnlock,
  decidePublicClaimRouting,
} from "@/lib/entitlement/library-unlock";

export const runtime = "nodejs";

type RawBody = {
  librarySessionId?: unknown;
};

async function readBody(req: Request): Promise<RawBody> {
  try {
    return (await req.json()) as RawBody;
  } catch {
    return {};
  }
}

export async function POST(req: Request) {
  const h = await headers();
  log.info(h, "library:unlock:start");

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      log.warn(h, "library:unlock:unauthorized");
      return jsonError("Unauthorized", 401);
    }
    const userId = session.user.id as string;

    const raw = await readBody(req);
    const librarySessionId =
      typeof raw.librarySessionId === "string" && raw.librarySessionId.trim() !== ""
        ? raw.librarySessionId.trim()
        : null;
    if (!librarySessionId) {
      return jsonError("MISSING_LIBRARY_SESSION_ID", 400);
    }

    const decision = await decidePublicClaimRouting({
      userId,
      librarySessionId,
    });

    if (!decision.ok) {
      // USER_NOT_FOUND is a 401 for parity with /api/jobs; the two session
      // errors are 404 (unknown) / 409 (inactive) so the client can
      // distinguish "wrong id" from "temporarily disabled".
      if (decision.error === "USER_NOT_FOUND") {
        return jsonError("USER_NOT_FOUND", 401);
      }
      if (decision.error === "SESSION_NOT_FOUND") {
        return jsonError("SESSION_NOT_FOUND", 404);
      }
      // SESSION_INACTIVE
      return jsonError("SESSION_INACTIVE", 409);
    }

    if (decision.outcome === "direct_plan_access") {
      // Paid callers still go through the central claim helper so the
      // effective-plan gate, the session-active check, and the direct-
      // access outcome all live in one place. No LibraryUnlock row is
      // created — the helper short-circuits before the write path.
      const result = await claimLibrarySessionUnlock({
        userId,
        librarySessionId,
      });
      if (!result.ok) {
        if (result.error === "USER_NOT_FOUND") {
          return jsonError("USER_NOT_FOUND", 401);
        }
        if (result.error === "SESSION_NOT_FOUND") {
          return jsonError("SESSION_NOT_FOUND", 404);
        }
        if (result.error === "SESSION_INACTIVE") {
          return jsonError("SESSION_INACTIVE", 409);
        }
        // The paid path can never legitimately trip DAILY_UNLOCK_LIMIT_REACHED
        // or CONCURRENCY_CONFLICT on providerEventId — surface them generically
        // if they somehow occur.
        return jsonError(result.error, 400);
      }
      // Should always be direct_plan_access on this branch — but if the
      // effective plan flipped between the routing snapshot and the
      // authoritative in-transaction read, we still return the actual
      // outcome verbatim.
      log.info(h, "library:unlock:paid", {
        outcome: result.outcome,
        librarySessionId,
      });
      addDebugLog({
        ts: new Date().toISOString(),
        level: "info",
        route: "/api/library/unlock POST",
        userId,
        message: "Paid direct access",
        data: { outcome: result.outcome, librarySessionId },
        reqId: h.get("x-request-id") ?? undefined,
      });
      return jsonOk(
        {
          outcome: result.outcome,
          librarySessionId,
        },
        200
      );
    }

    // FREE path — no LibraryUnlock row is created by this route in
    // Phase 4B-1. The client cannot self-certify sponsored completion.
    log.info(h, "library:unlock:free:requires_verification", {
      librarySessionId,
    });
    addDebugLog({
      ts: new Date().toISOString(),
      level: "info",
      route: "/api/library/unlock POST",
      userId,
      message: "Free: sponsored verification required",
      data: { librarySessionId },
      reqId: h.get("x-request-id") ?? undefined,
    });
    return jsonOk(
      {
        outcome: "requires_sponsored_verification",
        librarySessionId,
      },
      200
    );
  } catch (e) {
    const { code, msg } = toErrData(e);
    log.error(h, "library:unlock:failed", { code, msg });
    addDebugLog({
      ts: new Date().toISOString(),
      level: "error",
      route: "/api/library/unlock POST",
      userId: undefined,
      message: "Unlock failed",
      data: { code, msg },
      reqId: h.get("x-request-id") ?? undefined,
    });
    return jsonError("INTERNAL_ERROR", 500, {
      code,
      message: "Deine Anfrage konnte gerade nicht verarbeitet werden.",
    });
  }
}
