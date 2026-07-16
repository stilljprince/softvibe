// scripts/test-sponsored-verification.ts
//
// Offline tests for RP-010 Phase 4B-2 — Sponsored Unlock Verification.
// Exercises the pure signature / timestamp / event-id primitives, the
// full end-to-end `runSponsoredVerification` composition (via a stub
// claim function), and the invariants that keep the trusted route from
// silently softening the Free public route from Phase 4B-1.
//
// Run:
//   npx tsx scripts/test-sponsored-verification.ts
//
// No DB required — the claim helper is injected as a stub, so the
// tests focus exclusively on Phase 4B-2 concerns. Phase 4B-1 claim
// semantics are covered by scripts/test-library-unlock.ts and are NOT
// re-tested here.

import { createHmac } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  SPONSORED_EVENT_ID_MAX_LENGTH,
  SPONSORED_HEADER_EVENT_ID,
  SPONSORED_HEADER_SIGNATURE,
  SPONSORED_HEADER_TIMESTAMP,
  SPONSORED_REPLAY_WINDOW_SECONDS,
  buildSignatureBase,
  computeSignatureHex,
  parseSponsoredBody,
  parseUnixSecondsStrict,
  runSponsoredVerification,
  timingSafeCompareHex,
  verifySponsoredHeaders,
} from "../lib/entitlement/sponsored-verification";
import type { ClaimLibrarySessionUnlockResult } from "../lib/entitlement/library-unlock";

// --- Assertion runner -----------------------------------------------------

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const equal =
    actual instanceof Date && expected instanceof Date
      ? actual.getTime() === expected.getTime()
      : actual === expected;
  if (equal) {
    console.log(`[PASS] ${name}`);
    passed++;
  } else {
    console.log(
      `[FAIL] ${name}\n       expected=${String(expected)}\n       actual=  ${String(actual)}`
    );
    failed++;
  }
}

// --- Test constants -------------------------------------------------------

const SECRET = "test-secret-do-not-log";
const OTHER_SECRET = "some-other-secret";
// A reference "now" pinned inside 2026-07-17 so timestamp arithmetic is
// obvious; well inside the 32-bit safe range for Unix seconds.
const NOW = new Date("2026-07-17T12:00:00.000Z");
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

function makeBody(userId: string, librarySessionId: string): string {
  // Fixed field order — the client and the server sign the exact same
  // byte sequence. Reordering must break the signature; see test 35.
  return JSON.stringify({ userId, librarySessionId });
}

function signHex(
  secret: string,
  eventId: string,
  timestamp: string,
  rawBody: string
): string {
  return computeSignatureHex(secret, buildSignatureBase(eventId, timestamp, rawBody));
}

type ClaimCall = {
  userId: string;
  librarySessionId: string;
  providerEventId: string;
  now: Date;
};

function makeStubClaim(
  response: ClaimLibrarySessionUnlockResult
): { fn: (p: ClaimCall) => Promise<ClaimLibrarySessionUnlockResult>; calls: ClaimCall[] } {
  const calls: ClaimCall[] = [];
  const fn = async (p: ClaimCall) => {
    calls.push(p);
    return response;
  };
  return { fn, calls };
}

// --- Main -----------------------------------------------------------------

async function main(): Promise<void> {
  // --- Named constants sanity ---------------------------------------------

  check("Header name: signature", SPONSORED_HEADER_SIGNATURE, "x-softvibe-sponsored-signature");
  check("Header name: event-id", SPONSORED_HEADER_EVENT_ID, "x-softvibe-sponsored-event-id");
  check("Header name: timestamp", SPONSORED_HEADER_TIMESTAMP, "x-softvibe-sponsored-timestamp");
  check("Replay window = 300s", SPONSORED_REPLAY_WINDOW_SECONDS, 300);
  check("Event-id max length = 128", SPONSORED_EVENT_ID_MAX_LENGTH, 128);

  // --- Pure primitives ----------------------------------------------------

  // buildSignatureBase — deterministic and dot-separated.
  check(
    "buildSignatureBase joins eventId.ts.rawBody",
    buildSignatureBase("evt-1", "1000", '{"a":1}'),
    'evt-1.1000.{"a":1}'
  );

  // computeSignatureHex — HMAC-SHA256 with known vector.
  {
    const knownExpected = createHmac("sha256", "k").update("m", "utf8").digest("hex");
    check("computeSignatureHex matches Node crypto", computeSignatureHex("k", "m"), knownExpected);
  }

  // timingSafeCompareHex — happy path.
  {
    const s = computeSignatureHex("k", "m");
    check("timingSafeCompareHex equal hex", timingSafeCompareHex(s, s), true);
  }

  // timingSafeCompareHex — mismatched length short-circuits to false (test 10).
  check(
    "timingSafeCompareHex unequal length ≠ throw",
    timingSafeCompareHex("aa", "aabb"),
    false
  );

  // timingSafeCompareHex — non-hex chars → false, no throw.
  check("timingSafeCompareHex non-hex → false", timingSafeCompareHex("zz", "zz"), false);
  // odd length
  check("timingSafeCompareHex odd length → false", timingSafeCompareHex("abc", "abc"), false);
  // empty
  check("timingSafeCompareHex empty → false", timingSafeCompareHex("", ""), false);

  // parseUnixSecondsStrict — comprehensive
  check("parseUnixSecondsStrict 0", parseUnixSecondsStrict("0"), 0);
  check("parseUnixSecondsStrict positive", parseUnixSecondsStrict("1000"), 1000);
  check("parseUnixSecondsStrict leading +", parseUnixSecondsStrict("+1000"), 1000);
  check("parseUnixSecondsStrict NaN string", parseUnixSecondsStrict("NaN"), null);
  check("parseUnixSecondsStrict Infinity", parseUnixSecondsStrict("Infinity"), null);
  check("parseUnixSecondsStrict decimal", parseUnixSecondsStrict("1000.5"), null);
  check("parseUnixSecondsStrict exponent", parseUnixSecondsStrict("1e3"), null);
  check("parseUnixSecondsStrict negative", parseUnixSecondsStrict("-1"), null);
  check("parseUnixSecondsStrict whitespace inside", parseUnixSecondsStrict("10 00"), null);
  check("parseUnixSecondsStrict empty", parseUnixSecondsStrict(""), null);
  check(
    "parseUnixSecondsStrict millisecond-shaped (13 digits)",
    parseUnixSecondsStrict("1752600000000"),
    null
  );
  check(
    "parseUnixSecondsStrict 10-digit cap accepted",
    parseUnixSecondsStrict("9999999999"),
    9999999999
  );

  // --- Header verification ------------------------------------------------

  const rawBody = makeBody("u-1", "s-1");
  const eventId = "evt-42";
  const ts = String(NOW_SEC);
  const goodSig = signHex(SECRET, eventId, ts, rawBody);

  // (1) Happy path — valid signature.
  {
    const r = verifySponsoredHeaders({
      secret: SECRET,
      rawBody,
      signatureHex: goodSig,
      eventId,
      timestamp: ts,
      now: NOW,
    });
    check("Header verify: happy path ok", r.ok, true);
    if (r.ok) {
      check("Header verify: eventId echoed", r.eventId, eventId);
      check("Header verify: timestamp parsed", r.timestamp, NOW_SEC);
    }
  }

  // (2) Wrong signature (deliberate corruption) → INVALID_SIGNATURE.
  {
    const badSig = "0".repeat(goodSig.length);
    const r = verifySponsoredHeaders({
      secret: SECRET,
      rawBody,
      signatureHex: badSig,
      eventId,
      timestamp: ts,
      now: NOW,
    });
    check("Wrong signature: ok=false", r.ok, false);
    if (!r.ok) check("Wrong signature: INVALID_SIGNATURE", r.error, "INVALID_SIGNATURE");
  }

  // (3) Tampered userId → recomputed sig differs → INVALID_SIGNATURE.
  {
    const tamperedBody = makeBody("u-EVIL", "s-1");
    const r = verifySponsoredHeaders({
      secret: SECRET,
      rawBody: tamperedBody,
      signatureHex: goodSig,
      eventId,
      timestamp: ts,
      now: NOW,
    });
    check("Tampered userId: ok=false", r.ok, false);
    if (!r.ok) check("Tampered userId: INVALID_SIGNATURE", r.error, "INVALID_SIGNATURE");
  }

  // (4) Tampered librarySessionId → INVALID_SIGNATURE.
  {
    const tamperedBody = makeBody("u-1", "s-EVIL");
    const r = verifySponsoredHeaders({
      secret: SECRET,
      rawBody: tamperedBody,
      signatureHex: goodSig,
      eventId,
      timestamp: ts,
      now: NOW,
    });
    check("Tampered librarySessionId: ok=false", r.ok, false);
    if (!r.ok) check("Tampered librarySessionId: INVALID_SIGNATURE", r.error, "INVALID_SIGNATURE");
  }

  // (5) Tampered event-id → INVALID_SIGNATURE.
  {
    const r = verifySponsoredHeaders({
      secret: SECRET,
      rawBody,
      signatureHex: goodSig,
      eventId: "evt-EVIL",
      timestamp: ts,
      now: NOW,
    });
    check("Tampered eventId: ok=false", r.ok, false);
    if (!r.ok) check("Tampered eventId: INVALID_SIGNATURE", r.error, "INVALID_SIGNATURE");
  }

  // (6) Tampered timestamp → INVALID_SIGNATURE (before window check).
  {
    const r = verifySponsoredHeaders({
      secret: SECRET,
      rawBody,
      signatureHex: goodSig,
      eventId,
      timestamp: String(NOW_SEC + 1),
      now: NOW,
    });
    check("Tampered timestamp: ok=false", r.ok, false);
    if (!r.ok) check("Tampered timestamp: INVALID_SIGNATURE", r.error, "INVALID_SIGNATURE");
  }

  // (7) Missing signature header.
  {
    const r = verifySponsoredHeaders({
      secret: SECRET,
      rawBody,
      signatureHex: null,
      eventId,
      timestamp: ts,
      now: NOW,
    });
    check("Missing sig: ok=false", r.ok, false);
    if (!r.ok) check("Missing sig: MISSING_SIGNATURE", r.error, "MISSING_SIGNATURE");
  }

  // (8) Empty signature header.
  {
    const r = verifySponsoredHeaders({
      secret: SECRET,
      rawBody,
      signatureHex: "   ",
      eventId,
      timestamp: ts,
      now: NOW,
    });
    check("Empty sig: MISSING_SIGNATURE", r.ok === false && r.error === "MISSING_SIGNATURE", true);
  }

  // (9) Invalid hex — odd length / non-hex chars.
  {
    const r1 = verifySponsoredHeaders({
      secret: SECRET,
      rawBody,
      signatureHex: "abc", // odd length
      eventId,
      timestamp: ts,
      now: NOW,
    });
    check("Odd-length sig: INVALID_SIGNATURE",
      r1.ok === false && r1.error === "INVALID_SIGNATURE", true);

    const r2 = verifySponsoredHeaders({
      secret: SECRET,
      rawBody,
      signatureHex: "zzzzzzzz", // non-hex
      eventId,
      timestamp: ts,
      now: NOW,
    });
    check("Non-hex sig: INVALID_SIGNATURE",
      r2.ok === false && r2.error === "INVALID_SIGNATURE", true);
  }

  // (10) Signatures of unlike length must not crash.
  {
    // Compute a real sig of "correct" length so the byte comparison is
    // apples-to-apples, then pass a shorter one and confirm no throw.
    const half = goodSig.slice(0, goodSig.length - 2);
    const r = verifySponsoredHeaders({
      secret: SECRET,
      rawBody,
      signatureHex: half,
      eventId,
      timestamp: ts,
      now: NOW,
    });
    check("Different-length sig: no crash, INVALID_SIGNATURE",
      r.ok === false && r.error === "INVALID_SIGNATURE", true);
  }

  // (11) Missing SPONSORED_UNLOCK_SECRET → NOT_CONFIGURED, no allow.
  {
    const r = verifySponsoredHeaders({
      secret: undefined,
      rawBody,
      signatureHex: goodSig,
      eventId,
      timestamp: ts,
      now: NOW,
    });
    check("No secret: NOT_CONFIGURED",
      r.ok === false && r.error === "SPONSORED_VERIFICATION_NOT_CONFIGURED", true);
  }

  // (12) Empty secret → NOT_CONFIGURED.
  {
    const r = verifySponsoredHeaders({
      secret: "",
      rawBody,
      signatureHex: goodSig,
      eventId,
      timestamp: ts,
      now: NOW,
    });
    check("Empty secret: NOT_CONFIGURED",
      r.ok === false && r.error === "SPONSORED_VERIFICATION_NOT_CONFIGURED", true);
  }

  // (13) Secret must not leak into error strings/serializations. The
  // controlled error codes are the ONLY externally-visible signal.
  {
    const r = verifySponsoredHeaders({
      secret: SECRET,
      rawBody,
      signatureHex: "aa",
      eventId,
      timestamp: ts,
      now: NOW,
    });
    const serialized = JSON.stringify(r);
    check("Secret never in serialised error", serialized.includes(SECRET), false);
    check("Secret never in serialised error (case 2)",
      serialized.includes(OTHER_SECRET), false);
  }

  // (14) Current timestamp → allowed.
  {
    const r = verifySponsoredHeaders({
      secret: SECRET,
      rawBody,
      signatureHex: signHex(SECRET, eventId, String(NOW_SEC), rawBody),
      eventId,
      timestamp: String(NOW_SEC),
      now: NOW,
    });
    check("Current ts: ok=true", r.ok, true);
  }

  // (15) Exactly at lower ±5min boundary → allowed (inclusive).
  {
    const tsPast = String(NOW_SEC - SPONSORED_REPLAY_WINDOW_SECONDS);
    const r = verifySponsoredHeaders({
      secret: SECRET,
      rawBody,
      signatureHex: signHex(SECRET, eventId, tsPast, rawBody),
      eventId,
      timestamp: tsPast,
      now: NOW,
    });
    check("Exact lower boundary: ok=true", r.ok, true);
  }

  // (16) One second past lower boundary → REPLAY_WINDOW_EXCEEDED.
  {
    const tsPast = String(NOW_SEC - SPONSORED_REPLAY_WINDOW_SECONDS - 1);
    const r = verifySponsoredHeaders({
      secret: SECRET,
      rawBody,
      signatureHex: signHex(SECRET, eventId, tsPast, rawBody),
      eventId,
      timestamp: tsPast,
      now: NOW,
    });
    check("Older than 5 min: REPLAY_WINDOW_EXCEEDED",
      r.ok === false && r.error === "REPLAY_WINDOW_EXCEEDED", true);
  }

  // (17) Exactly at upper ±5min future boundary → allowed.
  {
    const tsFut = String(NOW_SEC + SPONSORED_REPLAY_WINDOW_SECONDS);
    const r = verifySponsoredHeaders({
      secret: SECRET,
      rawBody,
      signatureHex: signHex(SECRET, eventId, tsFut, rawBody),
      eventId,
      timestamp: tsFut,
      now: NOW,
    });
    check("Exact upper boundary: ok=true", r.ok, true);
  }

  // (18) More than 5 minutes in the future → REPLAY_WINDOW_EXCEEDED.
  {
    const tsFut = String(NOW_SEC + SPONSORED_REPLAY_WINDOW_SECONDS + 1);
    const r = verifySponsoredHeaders({
      secret: SECRET,
      rawBody,
      signatureHex: signHex(SECRET, eventId, tsFut, rawBody),
      eventId,
      timestamp: tsFut,
      now: NOW,
    });
    check("Too far future: REPLAY_WINDOW_EXCEEDED",
      r.ok === false && r.error === "REPLAY_WINDOW_EXCEEDED", true);
  }

  // (19) Non-numeric timestamp → INVALID_TIMESTAMP.
  {
    const nonNumeric = "not-a-number";
    const r = verifySponsoredHeaders({
      secret: SECRET,
      rawBody,
      signatureHex: signHex(SECRET, eventId, nonNumeric, rawBody),
      eventId,
      timestamp: nonNumeric,
      now: NOW,
    });
    // Signature over the literal string succeeds, then timestamp parse fails.
    check("Non-numeric ts: INVALID_TIMESTAMP",
      r.ok === false && r.error === "INVALID_TIMESTAMP", true);
  }

  // (20) NaN / Infinity strings.
  {
    const r1 = verifySponsoredHeaders({
      secret: SECRET,
      rawBody,
      signatureHex: signHex(SECRET, eventId, "NaN", rawBody),
      eventId,
      timestamp: "NaN",
      now: NOW,
    });
    check("NaN ts: INVALID_TIMESTAMP",
      r1.ok === false && r1.error === "INVALID_TIMESTAMP", true);
    const r2 = verifySponsoredHeaders({
      secret: SECRET,
      rawBody,
      signatureHex: signHex(SECRET, eventId, "Infinity", rawBody),
      eventId,
      timestamp: "Infinity",
      now: NOW,
    });
    check("Infinity ts: INVALID_TIMESTAMP",
      r2.ok === false && r2.error === "INVALID_TIMESTAMP", true);
  }

  // (21) Millisecond-shaped timestamp mistakenly sent → controlled reject.
  {
    const msLike = String(NOW.getTime());
    const r = verifySponsoredHeaders({
      secret: SECRET,
      rawBody,
      signatureHex: signHex(SECRET, eventId, msLike, rawBody),
      eventId,
      timestamp: msLike,
      now: NOW,
    });
    check("Millisecond ts: INVALID_TIMESTAMP",
      r.ok === false && r.error === "INVALID_TIMESTAMP", true);
  }

  // (22) Valid event-id.
  {
    const r = verifySponsoredHeaders({
      secret: SECRET,
      rawBody,
      signatureHex: signHex(SECRET, "provider-event-xyz-123", ts, rawBody),
      eventId: "provider-event-xyz-123",
      timestamp: ts,
      now: NOW,
    });
    check("Valid eventId: ok=true", r.ok, true);
  }

  // (23) Missing event-id.
  {
    const r = verifySponsoredHeaders({
      secret: SECRET,
      rawBody,
      signatureHex: goodSig,
      eventId: null,
      timestamp: ts,
      now: NOW,
    });
    check("Missing eventId: MISSING_EVENT_ID",
      r.ok === false && r.error === "MISSING_EVENT_ID", true);
  }

  // (24) Empty event-id.
  {
    const r = verifySponsoredHeaders({
      secret: SECRET,
      rawBody,
      signatureHex: goodSig,
      eventId: "   ",
      timestamp: ts,
      now: NOW,
    });
    check("Empty eventId: MISSING_EVENT_ID",
      r.ok === false && r.error === "MISSING_EVENT_ID", true);
  }

  // (25) Event-id over max length → EVENT_ID_TOO_LONG.
  {
    const longEvt = "e".repeat(SPONSORED_EVENT_ID_MAX_LENGTH + 1);
    const r = verifySponsoredHeaders({
      secret: SECRET,
      rawBody,
      signatureHex: signHex(SECRET, longEvt, ts, rawBody),
      eventId: longEvt,
      timestamp: ts,
      now: NOW,
    });
    check("Too-long eventId: EVENT_ID_TOO_LONG",
      r.ok === false && r.error === "EVENT_ID_TOO_LONG", true);
  }

  // (29) Valid JSON body — parseSponsoredBody.
  {
    const r = parseSponsoredBody(makeBody("u-1", "s-1"));
    check("parseBody: ok=true", r.ok, true);
    if (r.ok) {
      check("parseBody: userId", r.payload.userId, "u-1");
      check("parseBody: librarySessionId", r.payload.librarySessionId, "s-1");
    }
  }

  // (30) Invalid JSON.
  {
    const r = parseSponsoredBody("{not json");
    check("parseBody invalid JSON: INVALID_PAYLOAD",
      r.ok === false && r.error === "INVALID_PAYLOAD", true);
  }

  // (31) Missing userId.
  {
    const r = parseSponsoredBody(JSON.stringify({ librarySessionId: "s-1" }));
    check("parseBody no userId: INVALID_PAYLOAD",
      r.ok === false && r.error === "INVALID_PAYLOAD", true);
  }

  // (32) Missing librarySessionId.
  {
    const r = parseSponsoredBody(JSON.stringify({ userId: "u-1" }));
    check("parseBody no sessionId: INVALID_PAYLOAD",
      r.ok === false && r.error === "INVALID_PAYLOAD", true);
  }

  // (33) Empty strings.
  {
    const r = parseSponsoredBody(JSON.stringify({ userId: "", librarySessionId: "" }));
    check("parseBody empty strings: INVALID_PAYLOAD",
      r.ok === false && r.error === "INVALID_PAYLOAD", true);
  }

  // (34) Extra fields ignored.
  {
    const r = parseSponsoredBody(
      JSON.stringify({ userId: "u-1", librarySessionId: "s-1", extra: "ignored" })
    );
    check("parseBody extra fields: ok=true", r.ok, true);
    if (r.ok) check("parseBody extra fields: userId", r.payload.userId, "u-1");
  }

  // (35) Signature is bound to the EXACT raw body — reordering fields
  // (a different byte sequence) does NOT verify against a signature
  // over the original ordering.
  {
    const bodyA = JSON.stringify({ userId: "u-1", librarySessionId: "s-1" });
    const bodyB = JSON.stringify({ librarySessionId: "s-1", userId: "u-1" });
    const sigA = signHex(SECRET, eventId, ts, bodyA);
    check("Raw-body bound signature: A != B",
      verifySponsoredHeaders({
        secret: SECRET,
        rawBody: bodyB,
        signatureHex: sigA,
        eventId,
        timestamp: ts,
        now: NOW,
      }).ok,
      false
    );
  }

  // --- End-to-end runSponsoredVerification with stubbed claim ------------

  const stubCreated: ClaimLibrarySessionUnlockResult = {
    ok: true,
    outcome: "created",
    unlockId: "unlock-1",
    librarySessionId: "s-1",
    unlockedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 8 * 60 * 60 * 1000),
  };
  const stubReused: ClaimLibrarySessionUnlockResult = {
    ok: true,
    outcome: "reused",
    unlockId: "unlock-1",
    librarySessionId: "s-1",
    unlockedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 8 * 60 * 60 * 1000),
  };

  // (36) Verified request calls claim exactly once.
  {
    const body = makeBody("u-1", "s-1");
    const stub = makeStubClaim(stubCreated);
    const r = await runSponsoredVerification(
      {
        rawBody: body,
        signatureHex: signHex(SECRET, "evt-e2e-1", ts, body),
        eventId: "evt-e2e-1",
        timestamp: ts,
        secret: SECRET,
        now: NOW,
      },
      { claim: stub.fn }
    );
    check("E2E happy: claim invoked once", stub.calls.length, 1);
    check("E2E happy: outcome kind", r.kind, "claim_result");
  }

  // (37) Invalid signature never calls claim.
  {
    const body = makeBody("u-1", "s-1");
    const stub = makeStubClaim(stubCreated);
    const r = await runSponsoredVerification(
      {
        rawBody: body,
        signatureHex: "00".repeat(32),
        eventId: "evt-x",
        timestamp: ts,
        secret: SECRET,
        now: NOW,
      },
      { claim: stub.fn }
    );
    check("E2E bad sig: claim NOT invoked", stub.calls.length, 0);
    check("E2E bad sig: kind=verification_failed", r.kind, "verification_failed");
    if (r.kind === "verification_failed") {
      check("E2E bad sig: INVALID_SIGNATURE", r.error, "INVALID_SIGNATURE");
    }
  }

  // (38) Replay-window failure never calls claim.
  {
    const body = makeBody("u-1", "s-1");
    const stub = makeStubClaim(stubCreated);
    const tsOld = String(NOW_SEC - 10 * 60);
    const r = await runSponsoredVerification(
      {
        rawBody: body,
        signatureHex: signHex(SECRET, "evt-old", tsOld, body),
        eventId: "evt-old",
        timestamp: tsOld,
        secret: SECRET,
        now: NOW,
      },
      { claim: stub.fn }
    );
    check("E2E replay: claim NOT invoked", stub.calls.length, 0);
    if (r.kind === "verification_failed") {
      check("E2E replay: REPLAY_WINDOW_EXCEEDED", r.error, "REPLAY_WINDOW_EXCEEDED");
    }
  }

  // (39) providerEventId forwarded verbatim.
  // (40) userId + librarySessionId forwarded verbatim.
  {
    const body = makeBody("u-abc", "s-xyz");
    const stub = makeStubClaim(stubCreated);
    const evt = "evt-forward-check";
    await runSponsoredVerification(
      {
        rawBody: body,
        signatureHex: signHex(SECRET, evt, ts, body),
        eventId: evt,
        timestamp: ts,
        secret: SECRET,
        now: NOW,
      },
      { claim: stub.fn }
    );
    check("Forward: providerEventId", stub.calls[0]?.providerEventId, evt);
    check("Forward: userId", stub.calls[0]?.userId, "u-abc");
    check("Forward: librarySessionId", stub.calls[0]?.librarySessionId, "s-xyz");
    check("Forward: now propagated", stub.calls[0]?.now.getTime(), NOW.getTime());
  }

  // (41) `created` mapped through.
  {
    const body = makeBody("u-1", "s-1");
    const stub = makeStubClaim(stubCreated);
    const r = await runSponsoredVerification(
      {
        rawBody: body,
        signatureHex: signHex(SECRET, "evt-c", ts, body),
        eventId: "evt-c",
        timestamp: ts,
        secret: SECRET,
        now: NOW,
      },
      { claim: stub.fn }
    );
    if (r.kind === "claim_result" && r.result.ok) {
      check("Map created", r.result.outcome, "created");
    } else {
      check("Map created: wrong kind", r.kind, "claim_result");
    }
  }

  // (42) `reused` mapped through.
  {
    const body = makeBody("u-1", "s-1");
    const stub = makeStubClaim(stubReused);
    const r = await runSponsoredVerification(
      {
        rawBody: body,
        signatureHex: signHex(SECRET, "evt-r", ts, body),
        eventId: "evt-r",
        timestamp: ts,
        secret: SECRET,
        now: NOW,
      },
      { claim: stub.fn }
    );
    if (r.kind === "claim_result" && r.result.ok) {
      check("Map reused", r.result.outcome, "reused");
    }
  }

  // (43-47) Claim error codes mapped through unchanged.
  for (const err of [
    "DAILY_UNLOCK_LIMIT_REACHED",
    "SESSION_NOT_FOUND",
    "SESSION_INACTIVE",
    "USER_NOT_FOUND",
    "CONCURRENCY_CONFLICT",
  ] as const) {
    const body = makeBody("u-1", "s-1");
    const stub = makeStubClaim({ ok: false, error: err });
    const r = await runSponsoredVerification(
      {
        rawBody: body,
        signatureHex: signHex(SECRET, `evt-${err}`, ts, body),
        eventId: `evt-${err}`,
        timestamp: ts,
        secret: SECRET,
        now: NOW,
      },
      { claim: stub.fn }
    );
    if (r.kind === "claim_result" && !r.result.ok) {
      check(`Map error ${err}`, r.result.error, err);
    } else {
      check(`Map error ${err}: wrong outcome`, r.kind, "claim_result");
    }
  }

  // (48) Paid direct_plan_access mapped through faithfully.
  {
    const body = makeBody("u-paid", "s-1");
    const stubPaid = makeStubClaim({
      ok: true,
      outcome: "direct_plan_access",
      plan: "STARTER",
    });
    const r = await runSponsoredVerification(
      {
        rawBody: body,
        signatureHex: signHex(SECRET, "evt-paid", ts, body),
        eventId: "evt-paid",
        timestamp: ts,
        secret: SECRET,
        now: NOW,
      },
      { claim: stubPaid.fn }
    );
    if (r.kind === "claim_result" && r.result.ok && r.result.outcome === "direct_plan_access") {
      check("Map direct_plan_access: plan", r.result.plan, "STARTER");
    } else {
      check("Map direct_plan_access: wrong outcome", r.kind, "claim_result");
    }
  }

  // --- Idempotency contract forwarding (26-28) ---------------------------

  {
    const body1 = makeBody("u-A", "s-A");
    const body2 = makeBody("u-B", "s-A"); // different user
    const body3 = makeBody("u-A", "s-B"); // different session

    const stub1 = makeStubClaim(stubReused);
    await runSponsoredVerification(
      {
        rawBody: body1,
        signatureHex: signHex(SECRET, "evt-idem", ts, body1),
        eventId: "evt-idem",
        timestamp: ts,
        secret: SECRET,
        now: NOW,
      },
      { claim: stub1.fn }
    );
    check("(26) idempotent: providerEventId forwarded", stub1.calls[0]?.providerEventId, "evt-idem");
    check("(26) idempotent: userId forwarded", stub1.calls[0]?.userId, "u-A");
    check("(26) idempotent: librarySessionId forwarded", stub1.calls[0]?.librarySessionId, "s-A");

    const stub2 = makeStubClaim({ ok: false, error: "CONCURRENCY_CONFLICT" });
    const r2 = await runSponsoredVerification(
      {
        rawBody: body2,
        signatureHex: signHex(SECRET, "evt-idem", ts, body2),
        eventId: "evt-idem",
        timestamp: ts,
        secret: SECRET,
        now: NOW,
      },
      { claim: stub2.fn }
    );
    if (r2.kind === "claim_result" && !r2.result.ok) {
      check("(27) cross-user: CONCURRENCY_CONFLICT propagated", r2.result.error, "CONCURRENCY_CONFLICT");
    }

    const stub3 = makeStubClaim({ ok: false, error: "CONCURRENCY_CONFLICT" });
    const r3 = await runSponsoredVerification(
      {
        rawBody: body3,
        signatureHex: signHex(SECRET, "evt-idem", ts, body3),
        eventId: "evt-idem",
        timestamp: ts,
        secret: SECRET,
        now: NOW,
      },
      { claim: stub3.fn }
    );
    if (r3.kind === "claim_result" && !r3.result.ok) {
      check("(28) cross-session: CONCURRENCY_CONFLICT propagated", r3.result.error, "CONCURRENCY_CONFLICT");
    }
  }

  // --- Extra safety: signed-but-broken payload → controlled INVALID_PAYLOAD
  {
    const brokenBody = "{not json";
    const stub = makeStubClaim(stubCreated);
    const r = await runSponsoredVerification(
      {
        rawBody: brokenBody,
        signatureHex: signHex(SECRET, "evt-broken", ts, brokenBody),
        eventId: "evt-broken",
        timestamp: ts,
        secret: SECRET,
        now: NOW,
      },
      { claim: stub.fn }
    );
    check("Signed-but-broken payload: claim NOT invoked", stub.calls.length, 0);
    check("Signed-but-broken payload: kind=payload_failed", r.kind, "payload_failed");
  }

  // --- Route / module security invariants (49-52) ------------------------

  const publicRoutePath = path.resolve("app/api/library/unlock/route.ts");
  const publicRouteSrc = fs.readFileSync(publicRoutePath, "utf8");
  check(
    "(49) Public route still returns requires_sponsored_verification",
    publicRouteSrc.includes("requires_sponsored_verification"),
    true
  );
  check(
    "(49) Public route does NOT reference SPONSORED_UNLOCK_SECRET",
    publicRouteSrc.includes("SPONSORED_UNLOCK_SECRET"),
    false
  );
  check(
    "(49) Public route does NOT import sponsored-verification",
    publicRouteSrc.includes("sponsored-verification"),
    false
  );

  const sponsoredRoutePath = path.resolve("app/api/library/sponsored/verify/route.ts");
  const sponsoredRouteSrc = fs.readFileSync(sponsoredRoutePath, "utf8");
  // (50) No client boolean like adCompleted as a proof.
  check(
    "(50) Sponsored verify route does NOT accept adCompleted",
    /adCompleted/i.test(sponsoredRouteSrc),
    false
  );
  // (51) No browser-session authority — no next-auth on this route.
  // We check for actual `from "next-auth"` imports rather than any
  // mention, so a docstring can still reference the deliberate omission.
  check(
    "(51) Sponsored verify route does NOT import from next-auth",
    /from ["']next-auth/.test(sponsoredRouteSrc),
    false
  );
  check(
    "(51) Sponsored verify route does NOT call getServerSession",
    /getServerSession/.test(sponsoredRouteSrc),
    false
  );
  // (52) Secret is server-only, and there is no NEXT_PUBLIC_ variant.
  check(
    "(52) Sponsored verify route reads SPONSORED_UNLOCK_SECRET from process.env",
    sponsoredRouteSrc.includes("process.env.SPONSORED_UNLOCK_SECRET"),
    true
  );
  check(
    "(52) No NEXT_PUBLIC_ sponsored env var",
    /NEXT_PUBLIC_SPONSORED/.test(sponsoredRouteSrc),
    false
  );

  const utilPath = path.resolve("lib/entitlement/sponsored-verification.ts");
  const utilSrc = fs.readFileSync(utilPath, "utf8");
  check(
    "Utility does NOT import Prisma client",
    /@\/lib\/prisma|"@prisma\/client"/.test(utilSrc),
    false
  );

  // --- System separation (53-57) -----------------------------------------

  const combined = utilSrc + "\n" + sponsoredRouteSrc;

  check("(53) Separation: no credits ref", /\bcredits\b/i.test(combined), false);
  check("(54) Separation: no probeGenerationsUsed ref",
    /probeGenerationsUsed/i.test(combined), false);
  check("(55) Separation: no PeriodUsage ref", /PeriodUsage/i.test(combined), false);
  check("(56) Separation: no Job import",
    /@\/lib\/entitlement\/(reservation|finalization|release)/i.test(combined), false);
  check("(57) Separation: no Stripe ref", /stripe/i.test(combined), false);
}

main()
  .then(() => {
    console.log("");
    console.log(
      `Total: ${passed + failed}   Passed: ${passed}   Failed: ${failed}`
    );
    if (failed > 0) process.exit(1);
  })
  .catch((err) => {
    console.error("Test harness threw:", err);
    process.exit(2);
  });
