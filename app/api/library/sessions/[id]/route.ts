// app/api/library/sessions/[id]/route.ts
//
// RP-010 Phase 4D — Curated Library Catalog session-detail route.
//
// Authenticated read of a single active curated LibrarySession, with:
//
//   * safe session metadata (id, slug, title, description, preset,
//     durationSeconds),
//   * ordered chapter list (partIndex asc) with id, partIndex, title,
//     durationSeconds and a protected audioUrl that points at the
//     Phase-4C audio route,
//   * an informational `access` hint mirroring the list route.
//
// Never emitted:
//
//   * audioKey (S3 key), providerEventId, unlock ids, unlock history,
//     credits, minute usage, Stripe data.
//
// External behaviour:
//
//   * Unknown session → 404 SESSION_NOT_FOUND.
//   * Inactive session → same 404. The two outcomes are indistinguishable
//     from the client so inactive rows cannot be enumerated via ID probes.
//   * Anonymous caller → 401 with no DB read.
//   * Response is always Cache-Control: private, no-store — the body
//     depends on the caller's effective plan and unlock state.

import { getServerSession } from "next-auth";
import { cookies, headers } from "next/headers";
import { authOptions } from "@/lib/auth/config";
import { jsonError, jsonOk } from "@/lib/api";
import { log } from "@/lib/log";
import { toErrData } from "@/lib/error";
import { getActiveLibrarySessionDetail } from "@/lib/entitlement/library-catalog";
import {
  LIBRARY_QA_MODE_COOKIE_NAME,
  resolveLibraryEffectiveAccess,
} from "@/lib/entitlement/library-effective-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_NO_STORE: HeadersInit = { "Cache-Control": "private, no-store" };

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const h = await headers();
  const { id } = await ctx.params;
  log.info(h, "library:catalog:detail:start", { id });

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      log.warn(h, "library:catalog:detail:unauthorized");
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

    const result = await getActiveLibrarySessionDetail(userId, id, {
      effectiveAccess,
    });
    if (!result.ok) {
      if (result.error === "AUTH_REQUIRED") {
        return jsonError("Unauthorized", 401, undefined, PRIVATE_NO_STORE);
      }
      if (result.error === "USER_NOT_FOUND") {
        return jsonError("USER_NOT_FOUND", 401, undefined, PRIVATE_NO_STORE);
      }
      // SESSION_NOT_FOUND covers both "row missing" and "row inactive" —
      // externally indistinguishable so inactive sessions cannot be
      // enumerated via ID probing.
      return jsonError("SESSION_NOT_FOUND", 404, undefined, PRIVATE_NO_STORE);
    }

    const s = result.session;
    const body = {
      session: {
        id: s.id,
        slug: s.slug,
        title: s.title,
        description: s.description,
        preset: s.preset,
        durationSeconds: s.durationSeconds,
        access: {
          status: s.access.status,
          unlockExpiresAt: s.access.unlockExpiresAt
            ? s.access.unlockExpiresAt.toISOString()
            : null,
        },
        chapters: s.chapters.map((c) => ({
          id: c.id,
          partIndex: c.partIndex,
          title: c.title,
          durationSeconds: c.durationSeconds,
          audioUrl: c.audioUrl,
        })),
      },
    };

    log.info(h, "library:catalog:detail:ok", {
      id: s.id,
      chapters: s.chapters.length,
    });

    return jsonOk(body, { status: 200, headers: PRIVATE_NO_STORE });
  } catch (e) {
    const { code, msg } = toErrData(e);
    log.error(h, "library:catalog:detail:failed", { code, msg });
    return jsonError("INTERNAL_ERROR", 500, undefined, PRIVATE_NO_STORE);
  }
}
