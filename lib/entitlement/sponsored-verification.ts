// lib/entitlement/sponsored-verification.ts
//
// RP-010 Phase 4B-2 — Trusted Sponsored Unlock Verification.
//
// Small, purely computational HMAC-SHA256 contract that lets a trusted
// server-side caller (a future Sponsored provider integration or an
// internal server component) prove that a Sponsored obligation was
// fulfilled for a specific (user, librarySession) pair. On successful
// verification the caller of `runSponsoredVerification` invokes the
// authoritative `claimLibrarySessionUnlock` write path from Phase 4B-1;
// no additional daily-limit, session-active, advisory-lock or
// providerEventId logic is duplicated here.
//
// Design choices, in order of importance:
//
//   * Signature covers the UNMODIFIED raw request body. We compute the
//     HMAC over `${eventId}.${timestamp}.${rawBody}` — the raw body is
//     never re-serialized. This makes the signature invariant to any
//     future JSON parser reformatting and eliminates a whole class of
//     "verified one payload, acted on another" bugs.
//
//   * Constant-time compare only. `crypto.timingSafeEqual` on hex-decoded
//     Buffers of equal length; unequal-length signatures short-circuit to
//     a controlled INVALID_SIGNATURE without ever calling timingSafeEqual
//     (it would throw on length mismatch). Malformed hex is likewise a
//     controlled reject, never a crash.
//
//   * Timestamp is Unix seconds, ±5 minutes replay window, inclusive on
//     both boundaries. Millisecond-shaped values (>10 digits) are
//     rejected as INVALID_TIMESTAMP so a caller that accidentally sends
//     Date.now() can never satisfy the window by coincidence.
//
//   * No control flow depends on the secret's contents. The secret is
//     only used as HMAC key input; nothing else compares against it.
//     Absent / empty secret is a controlled SPONSORED_VERIFICATION_NOT_
//     CONFIGURED — never a silent allow.
//
//   * Provider Event ID is treated as an opaque correlation id here. Its
//     uniqueness / idempotency semantics live in the Phase 4B-1 DB
//     schema (LibraryUnlock.providerEventId @unique) and in
//     claimLibrarySessionUnlock's in-transaction findUnique. This module
//     only enforces "non-empty, sane length, exact-string-match under
//     the signature".
//
// This file contains no I/O and no Prisma calls. The route composes
// `verifySponsoredHeaders` + `parseSponsoredBody` with a caller-provided
// `claim` function via `runSponsoredVerification`; tests inject a stub
// claim, and the production route wires the real
// `claimLibrarySessionUnlock`.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { ClaimLibrarySessionUnlockResult } from "@/lib/entitlement/library-unlock";

/**
 * Canonical HTTP header names for the sponsored verification contract.
 * All-lowercase per HTTP header case-insensitivity; callers may send
 * any casing.
 */
export const SPONSORED_HEADER_SIGNATURE = "x-softvibe-sponsored-signature";
export const SPONSORED_HEADER_EVENT_ID = "x-softvibe-sponsored-event-id";
export const SPONSORED_HEADER_TIMESTAMP = "x-softvibe-sponsored-timestamp";

/**
 * Replay window applied to the request timestamp, in seconds. The check
 * is inclusive on both sides: `|now - ts| <= 300` passes, 301 fails.
 */
export const SPONSORED_REPLAY_WINDOW_SECONDS = 5 * 60;

/**
 * Upper bound on Event ID length. Long enough for any realistic
 * provider event id (typically ≤ 64 hex chars) while keeping DB rows
 * bounded. Exceeding it is a controlled reject — never truncation.
 */
export const SPONSORED_EVENT_ID_MAX_LENGTH = 128;

export type SponsoredVerificationErrorCode =
  | "SPONSORED_VERIFICATION_NOT_CONFIGURED"
  | "MISSING_SIGNATURE"
  | "MISSING_EVENT_ID"
  | "MISSING_TIMESTAMP"
  | "INVALID_SIGNATURE"
  | "INVALID_TIMESTAMP"
  | "REPLAY_WINDOW_EXCEEDED"
  | "EVENT_ID_TOO_LONG";

export type SponsoredHeaderVerificationResult =
  | { ok: true; eventId: string; timestamp: number }
  | { ok: false; error: SponsoredVerificationErrorCode };

export type SponsoredPayload = {
  userId: string;
  librarySessionId: string;
};

export type SponsoredPayloadResult =
  | { ok: true; payload: SponsoredPayload }
  | { ok: false; error: "INVALID_PAYLOAD" };

// ---------------------------------------------------------------------------
// Small primitives — signature base, HMAC, constant-time compare
// ---------------------------------------------------------------------------

/**
 * Canonical signing input. The order is fixed and dot-separated; the
 * raw body sits at the tail so it can contain arbitrary bytes without
 * ambiguity (we never parse this string — HMAC operates over it as-is).
 */
export function buildSignatureBase(
  eventId: string,
  timestamp: string,
  rawBody: string
): string {
  return `${eventId}.${timestamp}.${rawBody}`;
}

/**
 * HMAC-SHA256(secret, base) as lowercase hex. Callers should compare
 * with `timingSafeCompareHex`, not `===`.
 */
export function computeSignatureHex(secret: string, base: string): string {
  return createHmac("sha256", secret).update(base, "utf8").digest("hex");
}

const HEX_RE = /^[0-9a-fA-F]+$/;

function hexToBufferOrNull(hex: string): Buffer | null {
  if (hex.length === 0) return null;
  if (hex.length % 2 !== 0) return null;
  if (!HEX_RE.test(hex)) return null;
  try {
    return Buffer.from(hex, "hex");
  } catch {
    return null;
  }
}

/**
 * Constant-time compare for two hex-encoded signatures. Returns false
 * on any format error (odd length, non-hex chars, length mismatch)
 * rather than throwing; `crypto.timingSafeEqual` would throw on
 * unequal-length inputs, so we length-guard first.
 */
export function timingSafeCompareHex(a: string, b: string): boolean {
  const bufA = hexToBufferOrNull(a);
  const bufB = hexToBufferOrNull(b);
  if (!bufA || !bufB) return false;
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// Timestamp parsing
// ---------------------------------------------------------------------------

/**
 * Strict Unix-seconds parser. Accepts only 1–10 decimal digits with an
 * optional leading `+`; rejects NaN, Infinity, decimals, exponents,
 * signs beyond `+`, whitespace-inside, and millisecond-shaped values
 * (>10 digits). Returns the parsed integer, or `null` on any rejection.
 */
export function parseUnixSecondsStrict(input: string): number | null {
  if (typeof input !== "string") return null;
  if (!/^\+?\d{1,10}$/.test(input)) return null;
  const n = Number(input);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < 0 || n > 9_999_999_999) return null;
  return n;
}

// ---------------------------------------------------------------------------
// Header verification (pure, side-effect free)
// ---------------------------------------------------------------------------

/**
 * Verify the sponsored request headers against the raw body under the
 * server secret. Does not touch the DB and does not parse the payload;
 * a successful result means the caller possessed the shared secret and
 * proved so for this exact combination of `(eventId, timestamp, body)`.
 *
 * Order of rejection is deterministic:
 *
 *   1. Secret not configured           → SPONSORED_VERIFICATION_NOT_CONFIGURED
 *   2. Any required header missing     → MISSING_SIGNATURE / _EVENT_ID / _TIMESTAMP
 *   3. Signature mismatch (any cause)  → INVALID_SIGNATURE
 *   4. Timestamp not a valid integer   → INVALID_TIMESTAMP
 *   5. Timestamp outside ±5-min window → REPLAY_WINDOW_EXCEEDED
 *   6. Event ID over max length        → EVENT_ID_TOO_LONG
 *
 * Signature is verified BEFORE post-signature semantic checks
 * (timestamp window, event-id length) so a caller who does not hold
 * the secret cannot enumerate anything except "signature bad" and
 * "which header did I forget".
 */
export function verifySponsoredHeaders(input: {
  secret: string | null | undefined;
  rawBody: string;
  signatureHex: string | null | undefined;
  eventId: string | null | undefined;
  timestamp: string | null | undefined;
  now: Date;
}): SponsoredHeaderVerificationResult {
  // 1. Server-side secret must exist. An absent secret NEVER falls
  // through to allow; the route surfaces a controlled 503-shaped error.
  if (typeof input.secret !== "string" || input.secret.length === 0) {
    return { ok: false, error: "SPONSORED_VERIFICATION_NOT_CONFIGURED" };
  }

  // 2. Header presence. We tolerate surrounding whitespace on the
  // header values but do not otherwise normalize.
  const sigRaw =
    typeof input.signatureHex === "string" ? input.signatureHex.trim() : "";
  const evtRaw =
    typeof input.eventId === "string" ? input.eventId.trim() : "";
  const tsRaw =
    typeof input.timestamp === "string" ? input.timestamp.trim() : "";
  if (sigRaw.length === 0) return { ok: false, error: "MISSING_SIGNATURE" };
  if (evtRaw.length === 0) return { ok: false, error: "MISSING_EVENT_ID" };
  if (tsRaw.length === 0) return { ok: false, error: "MISSING_TIMESTAMP" };

  // 3. Signature check. Note we sign the ORIGINAL header values
  // (post-trim) exactly as they appear in the signature base — a caller
  // that pads whitespace must produce a signature over the padded form
  // or over the trimmed form and remain consistent with the server's
  // choice. We use the trimmed values consistently on both sides.
  const base = buildSignatureBase(evtRaw, tsRaw, input.rawBody);
  const expected = computeSignatureHex(input.secret, base);
  if (!timingSafeCompareHex(expected, sigRaw)) {
    return { ok: false, error: "INVALID_SIGNATURE" };
  }

  // 4. Timestamp is only trusted after the signature check succeeded.
  const ts = parseUnixSecondsStrict(tsRaw);
  if (ts === null) {
    return { ok: false, error: "INVALID_TIMESTAMP" };
  }

  // 5. Replay window. Inclusive on both sides: exactly ±300s passes.
  const nowSec = Math.floor(input.now.getTime() / 1000);
  if (Math.abs(nowSec - ts) > SPONSORED_REPLAY_WINDOW_SECONDS) {
    return { ok: false, error: "REPLAY_WINDOW_EXCEEDED" };
  }

  // 6. Event id length. Rejecting oversize IDs here (not silently
  // truncating them) keeps the DB providerEventId column bounded.
  if (evtRaw.length > SPONSORED_EVENT_ID_MAX_LENGTH) {
    return { ok: false, error: "EVENT_ID_TOO_LONG" };
  }

  return { ok: true, eventId: evtRaw, timestamp: ts };
}

// ---------------------------------------------------------------------------
// Payload parsing (post-signature)
// ---------------------------------------------------------------------------

/**
 * Parse the JSON body of a verified sponsored request. Runs AFTER
 * `verifySponsoredHeaders` has already confirmed the caller holds the
 * secret; a broken payload from a signature-holding caller is a
 * controlled INVALID_PAYLOAD, not a signature error.
 *
 * Extra fields on the body are ignored — the payload is intentionally
 * a two-field contract and future fields must go through a new
 * signature-base version rather than sneak in unsigned.
 */
export function parseSponsoredBody(rawBody: string): SponsoredPayloadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, error: "INVALID_PAYLOAD" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "INVALID_PAYLOAD" };
  }
  const obj = parsed as Record<string, unknown>;
  const userId = typeof obj.userId === "string" ? obj.userId.trim() : "";
  const librarySessionId =
    typeof obj.librarySessionId === "string" ? obj.librarySessionId.trim() : "";
  if (userId.length === 0 || librarySessionId.length === 0) {
    return { ok: false, error: "INVALID_PAYLOAD" };
  }
  return { ok: true, payload: { userId, librarySessionId } };
}

// ---------------------------------------------------------------------------
// End-to-end composition — used by both the route and tests
// ---------------------------------------------------------------------------

/**
 * Runtime outcome of a full sponsored verification pass.
 *
 *   * `verification_failed` — headers / signature / timestamp / event id
 *     rejected before ever consulting the claim helper. The helper is
 *     NOT invoked on this branch.
 *
 *   * `payload_failed` — signature passed but the body could not be
 *     parsed into the required shape. Claim helper is NOT invoked.
 *
 *   * `claim_result` — signature and payload both accepted; the claim
 *     helper was invoked exactly once and its return value is forwarded
 *     verbatim.
 */
export type SponsoredVerifyOutcome =
  | {
      kind: "verification_failed";
      error: SponsoredVerificationErrorCode;
    }
  | {
      kind: "payload_failed";
      error: "INVALID_PAYLOAD";
    }
  | {
      kind: "claim_result";
      result: ClaimLibrarySessionUnlockResult;
      providerEventId: string;
      userId: string;
      librarySessionId: string;
    };

export type SponsoredClaimFn = (params: {
  userId: string;
  librarySessionId: string;
  providerEventId: string;
  now: Date;
}) => Promise<ClaimLibrarySessionUnlockResult>;

export type RunSponsoredVerificationInput = {
  rawBody: string;
  signatureHex: string | null | undefined;
  eventId: string | null | undefined;
  timestamp: string | null | undefined;
  secret: string | null | undefined;
  now: Date;
};

/**
 * Compose signature verification + payload parsing + the authoritative
 * claim helper. The helper is invoked exactly once, and only when both
 * verification steps have passed. Callers get one flat discriminated
 * outcome for easy HTTP-status mapping in the route layer.
 *
 * The `claim` dependency is injected so unit tests can substitute a
 * stub without spinning up Prisma; the production route wires the real
 * `claimLibrarySessionUnlock` from Phase 4B-1.
 */
export async function runSponsoredVerification(
  input: RunSponsoredVerificationInput,
  deps: { claim: SponsoredClaimFn }
): Promise<SponsoredVerifyOutcome> {
  const verified = verifySponsoredHeaders({
    secret: input.secret,
    rawBody: input.rawBody,
    signatureHex: input.signatureHex,
    eventId: input.eventId,
    timestamp: input.timestamp,
    now: input.now,
  });
  if (!verified.ok) {
    return { kind: "verification_failed", error: verified.error };
  }

  const payload = parseSponsoredBody(input.rawBody);
  if (!payload.ok) {
    return { kind: "payload_failed", error: payload.error };
  }

  const result = await deps.claim({
    userId: payload.payload.userId,
    librarySessionId: payload.payload.librarySessionId,
    providerEventId: verified.eventId,
    now: input.now,
  });

  return {
    kind: "claim_result",
    result,
    providerEventId: verified.eventId,
    userId: payload.payload.userId,
    librarySessionId: payload.payload.librarySessionId,
  };
}
