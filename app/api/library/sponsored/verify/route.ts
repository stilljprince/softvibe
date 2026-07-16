// app/api/library/sponsored/verify/route.ts
//
// RP-010 Phase 4B-2 — Trusted Sponsored Unlock Verification (route).
//
// Server-to-server endpoint. A trusted caller (a future Sponsored
// provider integration or an internal server component) proves that a
// Sponsored obligation was fulfilled for a specific
// (userId, librarySessionId) pair by signing the request with the
// shared server secret. On successful verification we invoke the
// authoritative Phase 4B-1 `claimLibrarySessionUnlock` helper — this
// route contains NO daily-limit / session-active / advisory-lock /
// providerEventId-uniqueness logic of its own.
//
// This route intentionally does NOT rely on a next-auth browser
// session. The HMAC over the raw body IS the authentication. A
// normal browser client cannot forge a valid request; the public
// `/api/library/unlock` route continues to reject Free clients with
// REQUIRES_SPONSORED_VERIFICATION and is not softened by this file.
//
// Logging is deliberately minimal: outcome and error code only; never
// the signature, never the raw body, never the secret.

import { headers } from "next/headers";
import { jsonError, jsonOk } from "@/lib/api";
import { log } from "@/lib/log";
import { toErrData } from "@/lib/error";
import {
  claimLibrarySessionUnlock,
  type ClaimLibrarySessionUnlockErrorCode,
  type ClaimLibrarySessionUnlockResult,
} from "@/lib/entitlement/library-unlock";
import {
  SPONSORED_HEADER_SIGNATURE,
  SPONSORED_HEADER_EVENT_ID,
  SPONSORED_HEADER_TIMESTAMP,
  runSponsoredVerification,
  type SponsoredVerificationErrorCode,
} from "@/lib/entitlement/sponsored-verification";

export const runtime = "nodejs";

/**
 * HTTP status mapping for verification-layer errors. Distinct buckets:
 *
 *   * NOT_CONFIGURED    → 503 (server config bug, transient from caller
 *                              point of view)
 *   * MISSING_*         → 400 (client did not send a required header)
 *   * INVALID_SIGNATURE → 401 (caller failed to prove the secret)
 *   * INVALID_TIMESTAMP → 400 (malformed timestamp header)
 *   * REPLAY_*          → 409 (well-formed but outside the freshness
 *                              window — 409 mirrors the rest of the
 *                              entitlement layer's conflict semantics)
 *   * EVENT_ID_TOO_LONG → 400 (over-length header rejected outright)
 */
function httpForVerificationError(
  code: SponsoredVerificationErrorCode
): number {
  switch (code) {
    case "SPONSORED_VERIFICATION_NOT_CONFIGURED":
      return 503;
    case "MISSING_SIGNATURE":
    case "MISSING_EVENT_ID":
    case "MISSING_TIMESTAMP":
    case "INVALID_TIMESTAMP":
    case "EVENT_ID_TOO_LONG":
      return 400;
    case "INVALID_SIGNATURE":
      return 401;
    case "REPLAY_WINDOW_EXCEEDED":
      return 409;
  }
}

/**
 * HTTP status mapping for the authoritative claim helper's controlled
 * error codes. USER_NOT_FOUND is 401 to parity with the rest of
 * /api/**; SESSION_NOT_FOUND is 404; SESSION_INACTIVE and
 * CONCURRENCY_CONFLICT are 409; DAILY_UNLOCK_LIMIT_REACHED is 429 (rate
 * limit semantics).
 */
function httpForClaimError(code: ClaimLibrarySessionUnlockErrorCode): number {
  switch (code) {
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

/**
 * Serialise a claim outcome to the on-the-wire success shape. The
 * `direct_plan_access` branch cannot fire in practice on this route
 * (paid users bypass sponsored verification via the public route), but
 * we still forward it faithfully if the effective plan flips between
 * request-issue and DB read.
 */
function successBody(
  result: Extract<ClaimLibrarySessionUnlockResult, { ok: true }>
) {
  if (result.outcome === "direct_plan_access") {
    return {
      outcome: result.outcome,
      plan: result.plan,
    };
  }
  return {
    outcome: result.outcome,
    unlockId: result.unlockId,
    librarySessionId: result.librarySessionId,
    unlockedAt: result.unlockedAt.toISOString(),
    expiresAt: result.expiresAt.toISOString(),
  };
}

export async function POST(req: Request) {
  const h = await headers();
  log.info(h, "library:sponsored:verify:start");

  try {
    // Read raw body BEFORE parsing — signature is computed over these
    // exact bytes so any downstream parse-and-reserialize would break
    // signature verification. `req.text()` gives us the request stream
    // as-was, which is the only correct input.
    const rawBody = await req.text();

    // Lazily consult the environment. A build-time evaluation would
    // couple the module import order to secret availability, which
    // CLAUDE.md explicitly warns against for OpenAI; the same
    // conservatism applies here.
    const secret = process.env.SPONSORED_UNLOCK_SECRET;

    const outcome = await runSponsoredVerification(
      {
        rawBody,
        signatureHex: req.headers.get(SPONSORED_HEADER_SIGNATURE),
        eventId: req.headers.get(SPONSORED_HEADER_EVENT_ID),
        timestamp: req.headers.get(SPONSORED_HEADER_TIMESTAMP),
        secret,
        now: new Date(),
      },
      {
        claim: (params) => claimLibrarySessionUnlock(params),
      }
    );

    if (outcome.kind === "verification_failed") {
      // Do not include signature / body / secret in logs. Outcome and
      // error code are the only observability signals here.
      log.warn(h, "library:sponsored:verify:rejected", {
        stage: "verification",
        code: outcome.error,
      });
      return jsonError(outcome.error, httpForVerificationError(outcome.error));
    }

    if (outcome.kind === "payload_failed") {
      log.warn(h, "library:sponsored:verify:rejected", {
        stage: "payload",
        code: outcome.error,
      });
      return jsonError(outcome.error, 400);
    }

    const result = outcome.result;
    if (!result.ok) {
      log.warn(h, "library:sponsored:verify:claim_rejected", {
        code: result.error,
      });
      return jsonError(result.error, httpForClaimError(result.error));
    }

    log.info(h, "library:sponsored:verify:ok", {
      outcome: result.outcome,
      librarySessionId: outcome.librarySessionId,
    });
    return jsonOk(successBody(result), 200);
  } catch (e) {
    const { code, msg } = toErrData(e);
    log.error(h, "library:sponsored:verify:failed", { code, msg });
    return jsonError("INTERNAL_ERROR", 500, { code, message: msg });
  }
}
