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
import { cookies, headers } from "next/headers";
import { authOptions } from "@/lib/auth/config";
import { jsonError, jsonOk } from "@/lib/api";
import { log } from "@/lib/log";
import { toErrData } from "@/lib/error";
import { prisma } from "@/lib/prisma";
import { listActiveLibrarySessions } from "@/lib/entitlement/library-catalog";
import {
  LIBRARY_QA_MODE_COOKIE_NAME,
  resolveLibraryEffectiveAccess,
} from "@/lib/entitlement/library-effective-access";

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

    const cookieStore = await cookies();
    const qaModeCookie =
      cookieStore.get(LIBRARY_QA_MODE_COOKIE_NAME)?.value ?? null;
    const effective = await resolveLibraryEffectiveAccess({
      userId,
      qaModeCookie,
    });
    const effectiveAccess = effective.ok ? effective.access : undefined;

    // Pull the captured IANA timezone so the client can format the
    // FREE-unlock expiry line ("Freigeschaltet bis 21:35 Uhr") in the
    // user's own local time even when their browser reports a
    // different zone (e.g. a laptop that travelled). Falls back to
    // undefined → browser default.
    const viewerRow = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });

    const result = await listActiveLibrarySessions(userId, { effectiveAccess });
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

    // Attach a compact viewer snapshot so the Library UI can render
    // the admin-only QA panel (four modes) and the calm FREE-unlock
    // expiry line without a second /qa-access-mode round trip. Only
    // ever describes the CURRENT authenticated user; never leaks
    // audioKey, DB plan, cookie contents or admin identifiers.
    const viewer = effectiveAccess
      ? {
          effectiveMode: effectiveAccess.effectiveMode,
          isAdmin: effectiveAccess.isAdmin,
          qaFeatureAvailable: effectiveAccess.qaFeatureAvailable,
          timezone: viewerRow?.timezone ?? null,
        }
      : null;

    return jsonOk(
      { sessions, viewer },
      { status: 200, headers: PRIVATE_NO_STORE }
    );
  } catch (e) {
    const { code, msg } = toErrData(e);
    log.error(h, "library:catalog:list:failed", { code, msg });
    return jsonError("INTERNAL_ERROR", 500, undefined, PRIVATE_NO_STORE);
  }
}
