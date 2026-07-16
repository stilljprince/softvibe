// app/api/library/sessions/route.ts
//
// RP-010 Phase 4D — Curated Library Catalog list route.
//
// Authenticated read of the active curated LibrarySession catalog, with
// per-user access hints (direct_plan_access / active_unlock /
// requires_sponsored_unlock). The heavy lifting lives in
// lib/entitlement/library-catalog.ts; this route is a thin dispatcher:
//
//   * requires next-auth session — anonymous callers receive 401 with
//     no database read;
//   * returns only sessions with isActive = true — inactive rows are
//     externally indistinguishable from non-existent rows;
//   * never surfaces audioKey, S3 keys, providerEventId, credits or any
//     internal owner field;
//   * emits Cache-Control: private, no-store because the response body
//     depends on the caller's effective plan and unlock state, and MUST
//     NOT be reused across users by an intermediary or CDN.
//
// The access hint is informational only. Actual audio delivery is still
// authorized by /api/library/chapters/[id]/audio (Phase 4C).

import { getServerSession } from "next-auth";
import { headers } from "next/headers";
import { authOptions } from "@/lib/auth/config";
import { jsonError, jsonOk } from "@/lib/api";
import { log } from "@/lib/log";
import { toErrData } from "@/lib/error";
import { listActiveLibrarySessions } from "@/lib/entitlement/library-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_NO_STORE: HeadersInit = { "Cache-Control": "private, no-store" };

export async function GET() {
  const h = await headers();
  log.info(h, "library:catalog:list:start");

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      log.warn(h, "library:catalog:list:unauthorized");
      return jsonError("Unauthorized", 401, undefined, PRIVATE_NO_STORE);
    }
    const userId = session.user.id as string;

    const result = await listActiveLibrarySessions(userId);
    if (!result.ok) {
      if (result.error === "AUTH_REQUIRED") {
        return jsonError("Unauthorized", 401, undefined, PRIVATE_NO_STORE);
      }
      if (result.error === "USER_NOT_FOUND") {
        return jsonError("USER_NOT_FOUND", 401, undefined, PRIVATE_NO_STORE);
      }
      return jsonError("INTERNAL_ERROR", 500, undefined, PRIVATE_NO_STORE);
    }

    log.info(h, "library:catalog:list:ok", {
      count: result.sessions.length,
    });

    // Serialize Date values as ISO strings for stable JSON output.
    const sessions = result.sessions.map((s) => ({
      id: s.id,
      slug: s.slug,
      title: s.title,
      description: s.description,
      preset: s.preset,
      durationSeconds: s.durationSeconds,
      chapterCount: s.chapterCount,
      access: {
        status: s.access.status,
        unlockExpiresAt: s.access.unlockExpiresAt
          ? s.access.unlockExpiresAt.toISOString()
          : null,
      },
    }));

    return jsonOk({ sessions }, { status: 200, headers: PRIVATE_NO_STORE });
  } catch (e) {
    const { code, msg } = toErrData(e);
    log.error(h, "library:catalog:list:failed", { code, msg });
    return jsonError("INTERNAL_ERROR", 500, undefined, PRIVATE_NO_STORE);
  }
}
