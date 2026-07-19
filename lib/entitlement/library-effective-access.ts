// lib/entitlement/library-effective-access.ts
//
// RP-004E1 browser-QA — Effective Curated-Library access mode.
//
// Single central resolver that answers exactly one question, for the
// Library subsystem only:
//
//   "For THIS user, what effective mode governs Curated-Library
//    entitlement — FREE, STARTER, PREMIUM or ADMIN — and does the
//    Library UI need to expose an active-unlock expiry?"
//
// The mode is composed of three inputs:
//
//   * The real database `User.plan` (or its FREE fall-back when the
//     paid billing period has already ended). This is the single source
//     of truth for the actual subscription; it is NEVER mutated here.
//   * The real database `User.isAdmin` flag. Real admins default to
//     ADMIN — unrestricted Curated-Library access, no sponsored flow.
//     This is what fixes the current regression where a genuine admin
//     was treated as FREE and pushed through the sponsored unlock.
//   * An OPTIONAL Library-specific QA cookie override (`sv_library_qa_mode`)
//     used by internal browser QA. The override is honoured only when
//     ALL of the following are true:
//       — the caller is authenticated,
//       — `User.isAdmin === true` (server-verified),
//       — `NODE_ENV !== "production"`,
//       — `LIBRARY_QA_ACCESS_MODE_ENABLED=true`.
//     Any missing condition silently ignores the cookie — hiding the UI
//     is NOT the security boundary; the server independently rejects
//     the override.
//
// Scope invariants (must remain true forever):
//
//   * This resolver never writes to the database. No User.plan flip,
//     no LibraryUnlock create/delete, no Stripe call, no PeriodUsage
//     touch, no probe or credit mutation.
//   * The override affects Curated-Library entitlement ONLY. It never
//     leaks into Stripe, Billing, Custom Minutes, probes, generation,
//     Track playback or playlists. Callers outside the Library
//     subsystem MUST NOT read the cookie.
//   * The resolved mode is a *display* mode for QA. A caller
//     that resolves to STARTER, PREMIUM or ADMIN receives direct
//     Curated-Library access with no LibraryUnlock and no
//     SponsoredUnlockEvent. FREE preserves the existing sponsored
//     unlock rules (three-per-local-day, 8 h duration, active-unlock
//     reuse).
//
// Everything mode-aware in the Library subsystem — catalog, detail,
// audio route, sponsored-simulated start / complete — reads the same
// `resolveLibraryEffectiveAccess` result. There is no second override
// path.

import type { Plan, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { resolveEffectivePlan } from "@/lib/entitlement/resolver";

/**
 * Effective Library-access mode. The four values are intentionally
 * distinct even when their Curated-Library playback behaviour matches,
 * because the CEO wants to QA each state separately without changing
 * the DB plan.
 */
export type LibraryEffectiveMode = "FREE" | "STARTER" | "PREMIUM" | "ADMIN";

/**
 * Server-controlled name of the Library-specific QA override cookie.
 * Kept narrow (not `sv_qa_mode`) so no non-Library subsystem is ever
 * tempted to piggy-back on it.
 */
export const LIBRARY_QA_MODE_COOKIE_NAME = "sv_library_qa_mode";

/**
 * Environment flag that must be explicitly enabled for the override
 * cookie to have any effect. Mere presence of the cookie is never
 * sufficient — this flag is required even for a real admin.
 */
export const LIBRARY_QA_MODE_ENV_FLAG = "LIBRARY_QA_ACCESS_MODE_ENABLED";

/**
 * All four valid override values plus the sentinel `null` for "reset
 * to default". Any other string is rejected.
 */
export const LIBRARY_QA_MODES: readonly LibraryEffectiveMode[] = [
  "FREE",
  "STARTER",
  "PREMIUM",
  "ADMIN",
] as const;

export function isLibraryEffectiveMode(
  value: unknown
): value is LibraryEffectiveMode {
  return (
    typeof value === "string" &&
    (LIBRARY_QA_MODES as readonly string[]).includes(value)
  );
}

/**
 * Return true iff the QA override plumbing is enabled in this process.
 * Encapsulates the environment check so route + tests share exactly
 * one boolean. `NODE_ENV === "production"` disables it independent of
 * the explicit flag — production MUST fail closed.
 */
export function isLibraryQaModeEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  if (env.NODE_ENV === "production") return false;
  const raw = env[LIBRARY_QA_MODE_ENV_FLAG];
  if (typeof raw !== "string") return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Return the effective mode for a non-QA (real) caller. Real admins
 * default to ADMIN regardless of the persisted plan; non-admins fall
 * back to their effective plan via `resolveEffectivePlan`.
 *
 * Extracted so `POST /api/library/qa-access-mode` can compute the
 * caller's default mode to preview after a reset, and so tests can
 * assert real-admin defaulting without an override cookie.
 */
export function defaultLibraryModeFor(
  plan: Plan,
  planPeriodEnd: Date | null,
  isAdmin: boolean,
  now: Date
): LibraryEffectiveMode {
  if (isAdmin) return "ADMIN";
  return resolveEffectivePlan(plan, planPeriodEnd, now);
}

/**
 * Structured, minimum-exposure snapshot of the caller's effective
 * Curated-Library access. Consumed by catalog / detail / audio /
 * sponsored endpoints AND by the QA panel API.
 *
 * `databasePlan` is exposed so internal logging and the QA GET route
 * can distinguish "real plan is FREE but effective is ADMIN because
 * you are an admin" from "real plan is PREMIUM"; it MUST NOT be echoed
 * to the browser via any UI-safe response body (see
 * `serializeLibraryEffectiveAccessForBrowser` for the UI shape).
 */
export type LibraryEffectiveAccess = {
  /** Actual persisted plan — for logging only. */
  databasePlan: Plan;
  /** Server-verified admin flag from `User.isAdmin`. */
  isAdmin: boolean;
  /** Effective mode ignoring any override. */
  defaultMode: LibraryEffectiveMode;
  /**
   * Cookie override, or `null` if none was present / accepted. Non-null
   * only if all guards passed: authenticated real admin + dev
   * environment + explicit env flag.
   */
  qaOverride: LibraryEffectiveMode | null;
  /** Final effective mode after the override (falls back to default). */
  effectiveMode: LibraryEffectiveMode;
  /** Whether the QA override feature is currently active for this process. */
  qaFeatureAvailable: boolean;
  /** True iff the effective mode grants direct playback. */
  hasDirectAccess: boolean;
  /** True iff the effective mode is FREE (locked sessions require unlock). */
  requiresSponsoredUnlockPath: boolean;
};

export type LibraryEffectiveAccessError = "AUTH_REQUIRED" | "USER_NOT_FOUND";

export type ResolveLibraryEffectiveAccessResult =
  | { ok: true; access: LibraryEffectiveAccess }
  | { ok: false; error: LibraryEffectiveAccessError };

/**
 * All the caller-supplied inputs to the resolver. Kept explicit so a
 * route can pass the cookie value it just extracted, and tests can
 * drive the resolver without a real Request object.
 */
export type ResolveLibraryEffectiveAccessInput = {
  userId: string | null | undefined;
  /**
   * Raw cookie value, or `null` when no cookie was sent. Not parsed —
   * the resolver validates it against `LIBRARY_QA_MODES`. Invalid or
   * unknown values are silently ignored (matches the CEO spec that an
   * invalid cookie behaves as "no override").
   */
  qaModeCookie: string | null | undefined;
  now?: Date;
  env?: Record<string, string | undefined>;
};

/**
 * Load the caller's real plan + admin flag and combine with the
 * optional QA cookie override. Read-only in every branch.
 */
export async function resolveLibraryEffectiveAccess(
  input: ResolveLibraryEffectiveAccessInput,
  client: PrismaClient = defaultPrisma
): Promise<ResolveLibraryEffectiveAccessResult> {
  const now = input.now ?? new Date();
  const env = input.env ?? process.env;

  const userId =
    typeof input.userId === "string" && input.userId.trim() !== ""
      ? input.userId
      : null;
  if (!userId) return { ok: false, error: "AUTH_REQUIRED" };

  const user = await client.user.findUnique({
    where: { id: userId },
    select: {
      plan: true,
      planPeriodEnd: true,
      isAdmin: true,
    },
  });
  if (!user) return { ok: false, error: "USER_NOT_FOUND" };

  const defaultMode = defaultLibraryModeFor(
    user.plan,
    user.planPeriodEnd,
    user.isAdmin,
    now
  );

  const qaFeatureAvailable = isLibraryQaModeEnabled(env);

  // A cookie is honoured only for real admins with the feature flag on
  // in a non-production process. Missing any guard silently discards
  // the value — the server never trusts the cookie alone.
  let qaOverride: LibraryEffectiveMode | null = null;
  if (qaFeatureAvailable && user.isAdmin) {
    const raw =
      typeof input.qaModeCookie === "string"
        ? input.qaModeCookie.trim()
        : "";
    if (isLibraryEffectiveMode(raw)) {
      qaOverride = raw;
    }
  }

  const effectiveMode: LibraryEffectiveMode = qaOverride ?? defaultMode;
  const hasDirectAccess = effectiveMode !== "FREE";

  return {
    ok: true,
    access: {
      databasePlan: user.plan,
      isAdmin: user.isAdmin,
      defaultMode,
      qaOverride,
      effectiveMode,
      qaFeatureAvailable,
      hasDirectAccess,
      requiresSponsoredUnlockPath: !hasDirectAccess,
    },
  };
}

/**
 * UI-safe projection of a `LibraryEffectiveAccess`. Deliberately omits
 * `databasePlan` so a browser response cannot enumerate the real
 * subscription state alongside the current override — the browser only
 * needs the fields required to render the segmented control and any
 * expiry hint. `qaFeatureAvailable` is included so the panel knows
 * when to hide itself; `isAdmin` is included ONLY for the current
 * user (never for another user).
 */
export type LibraryEffectiveAccessBrowserView = {
  effectiveMode: LibraryEffectiveMode;
  defaultMode: LibraryEffectiveMode;
  qaOverride: LibraryEffectiveMode | null;
  qaFeatureAvailable: boolean;
  isAdmin: boolean;
};

export function serializeLibraryEffectiveAccessForBrowser(
  access: LibraryEffectiveAccess
): LibraryEffectiveAccessBrowserView {
  return {
    effectiveMode: access.effectiveMode,
    defaultMode: access.defaultMode,
    qaOverride: access.qaOverride,
    qaFeatureAvailable: access.qaFeatureAvailable,
    isAdmin: access.isAdmin,
  };
}
