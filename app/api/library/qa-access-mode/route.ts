// app/api/library/qa-access-mode/route.ts
//
// RP-004E1 browser-QA — Admin-only Library-QA access-mode API.
//
// Scope (deliberately narrow):
//
//   * Reads / writes ONLY the Library-QA cookie. Never touches
//     User.plan, User.credits, Stripe, PeriodUsage, Job, Track, Story
//     or any other product entitlement.
//   * Even for an authenticated caller the endpoint refuses to expose
//     itself unless ALL of the following are true:
//       — the caller is a real server-verified admin
//         (`User.isAdmin === true`, read on every request),
//       — `NODE_ENV !== "production"`,
//       — `LIBRARY_QA_ACCESS_MODE_ENABLED=true`.
//     A caller that fails any guard receives 403 with the same
//     `NOT_AVAILABLE` code — the response does NOT reveal whether
//     another account is an admin.
//   * The cookie value is validated against the closed enum
//     `FREE | STARTER | PREMIUM | ADMIN`. Any other value is refused;
//     the server never trusts an arbitrary plan string. A dedicated
//     RESET body triggers `cookies().delete(...)` so the caller
//     reverts to the ADMIN default.
//
// Cookie shape:
//
//   name       : `sv_library_qa_mode` (LIBRARY_QA_MODE_COOKIE_NAME)
//   value      : one of the four modes verbatim
//   httpOnly   : true      — never readable by browser JS
//   sameSite   : "lax"     — no cross-site drift
//   secure     : true      — required for HTTPS local previews
//   path       : "/"
//   maxAge     : 24 * 60 * 60 seconds (finite, dev-friendly lifetime)
//
// The cookie is NOT signed. Signature-level trust is unnecessary
// because the server independently re-verifies `User.isAdmin` and the
// env flag on every request that consults the cookie — a manually
// forged cookie on a non-admin browser will be silently ignored by
// `resolveLibraryEffectiveAccess`.

import { getServerSession } from "next-auth";
import { cookies, headers } from "next/headers";
import { authOptions } from "@/lib/auth/config";
import { jsonError, jsonOk } from "@/lib/api";
import { log } from "@/lib/log";
import { toErrData } from "@/lib/error";
import { prisma } from "@/lib/prisma";
import {
  LIBRARY_QA_MODE_COOKIE_NAME,
  isLibraryEffectiveMode,
  isLibraryQaModeEnabled,
  defaultLibraryModeFor,
  serializeLibraryEffectiveAccessForBrowser,
  type LibraryEffectiveMode,
} from "@/lib/entitlement/library-effective-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_NO_STORE: HeadersInit = { "Cache-Control": "private, no-store" };

/**
 * Cookie lifetime in seconds. 24 h — long enough that an admin QA
 * session does not have to re-select on every browser open, short
 * enough that a stale override eventually clears itself.
 */
const COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;

type RawBody = { mode?: unknown };

async function readBody(req: Request): Promise<RawBody> {
  try {
    return (await req.json()) as RawBody;
  } catch {
    return {};
  }
}

/**
 * Central guard shared by GET and POST. Loads the caller's
 * `isAdmin` from the database on every request — never from the JWT.
 * Returns the loaded plan snapshot on success so the caller can
 * compute `defaultMode` without a second DB round-trip.
 */
async function requireQaAdmin(): Promise<
  | {
      ok: true;
      userId: string;
      user: {
        plan: import("@prisma/client").Plan;
        planPeriodEnd: Date | null;
        isAdmin: boolean;
      };
    }
  | { ok: false; status: number; code: string }
> {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (typeof userId !== "string" || userId === "") {
    return { ok: false, status: 401, code: "Unauthorized" };
  }
  if (!isLibraryQaModeEnabled()) {
    return { ok: false, status: 403, code: "NOT_AVAILABLE" };
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, planPeriodEnd: true, isAdmin: true },
  });
  if (!user) {
    return { ok: false, status: 401, code: "Unauthorized" };
  }
  if (!user.isAdmin) {
    // Same code as feature-disabled — do not reveal whether the
    // caller *would* have qualified with a different account.
    return { ok: false, status: 403, code: "NOT_AVAILABLE" };
  }
  return { ok: true, userId, user };
}

/**
 * Build the browser-safe response shape. Combines the current
 * (post-mutation) cookie value with the caller's default mode and the
 * feature-availability flag so the UI can render the segmented control
 * without a follow-up round-trip.
 */
function buildResponseBody(params: {
  cookieValue: LibraryEffectiveMode | null;
  defaultMode: LibraryEffectiveMode;
  isAdmin: boolean;
  qaFeatureAvailable: boolean;
  databasePlan: import("@prisma/client").Plan;
}) {
  const effectiveMode: LibraryEffectiveMode =
    params.cookieValue ?? params.defaultMode;
  return serializeLibraryEffectiveAccessForBrowser({
    databasePlan: params.databasePlan,
    isAdmin: params.isAdmin,
    defaultMode: params.defaultMode,
    qaOverride: params.cookieValue,
    effectiveMode,
    qaFeatureAvailable: params.qaFeatureAvailable,
    hasDirectAccess: effectiveMode !== "FREE",
    requiresSponsoredUnlockPath: effectiveMode === "FREE",
  });
}

// ─── GET — read current mode ─────────────────────────────────────────────

export async function GET() {
  const h = await headers();
  log.info(h, "library:qa-mode:get:start");

  try {
    const gate = await requireQaAdmin();
    if (!gate.ok) {
      log.warn(h, "library:qa-mode:get:refused", { code: gate.code });
      return jsonError(gate.code, gate.status, undefined, PRIVATE_NO_STORE);
    }

    const cookieStore = await cookies();
    const raw = cookieStore.get(LIBRARY_QA_MODE_COOKIE_NAME)?.value ?? null;
    const cookieValue: LibraryEffectiveMode | null = isLibraryEffectiveMode(raw)
      ? raw
      : null;

    const defaultMode = defaultLibraryModeFor(
      gate.user.plan,
      gate.user.planPeriodEnd,
      gate.user.isAdmin,
      new Date()
    );

    const body = buildResponseBody({
      cookieValue,
      defaultMode,
      isAdmin: gate.user.isAdmin,
      qaFeatureAvailable: true,
      databasePlan: gate.user.plan,
    });

    log.info(h, "library:qa-mode:get:ok", {
      effectiveMode: body.effectiveMode,
    });

    return jsonOk(body, { status: 200, headers: PRIVATE_NO_STORE });
  } catch (e) {
    const { code, msg } = toErrData(e);
    log.error(h, "library:qa-mode:get:failed", { code, msg });
    return jsonError("INTERNAL_ERROR", 500, undefined, PRIVATE_NO_STORE);
  }
}

// ─── POST — set / reset current mode ─────────────────────────────────────

export async function POST(req: Request) {
  const h = await headers();
  log.info(h, "library:qa-mode:post:start");

  try {
    const gate = await requireQaAdmin();
    if (!gate.ok) {
      log.warn(h, "library:qa-mode:post:refused", { code: gate.code });
      return jsonError(gate.code, gate.status, undefined, PRIVATE_NO_STORE);
    }

    const raw = await readBody(req);
    // Two shapes are accepted: `{ mode: "FREE" | "STARTER" | "PREMIUM"
    // | "ADMIN" }` sets an override, `{ mode: null }` (or omitted)
    // clears the cookie back to the admin default. Anything else is
    // refused with 400.
    let newValue: LibraryEffectiveMode | null;
    if (raw.mode === null || raw.mode === undefined) {
      newValue = null;
    } else if (isLibraryEffectiveMode(raw.mode)) {
      newValue = raw.mode;
    } else {
      log.warn(h, "library:qa-mode:post:invalid_mode");
      return jsonError("INVALID_MODE", 400, undefined, PRIVATE_NO_STORE);
    }

    const cookieStore = await cookies();
    if (newValue) {
      cookieStore.set(LIBRARY_QA_MODE_COOKIE_NAME, newValue, {
        httpOnly: true,
        sameSite: "lax",
        // Secure cookies work over HTTPS local previews and are the
        // safer default; a local http://localhost preview also
        // accepts them under Chrome's localhost exception.
        secure: true,
        path: "/",
        maxAge: COOKIE_MAX_AGE_SECONDS,
      });
    } else {
      cookieStore.delete(LIBRARY_QA_MODE_COOKIE_NAME);
    }

    const defaultMode = defaultLibraryModeFor(
      gate.user.plan,
      gate.user.planPeriodEnd,
      gate.user.isAdmin,
      new Date()
    );

    const body = buildResponseBody({
      cookieValue: newValue,
      defaultMode,
      isAdmin: gate.user.isAdmin,
      qaFeatureAvailable: true,
      databasePlan: gate.user.plan,
    });

    log.info(h, "library:qa-mode:post:ok", {
      effectiveMode: body.effectiveMode,
      cleared: newValue === null,
    });

    return jsonOk(body, { status: 200, headers: PRIVATE_NO_STORE });
  } catch (e) {
    const { code, msg } = toErrData(e);
    log.error(h, "library:qa-mode:post:failed", { code, msg });
    return jsonError("INTERNAL_ERROR", 500, undefined, PRIVATE_NO_STORE);
  }
}
