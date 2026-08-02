// app/api/account/timezone/route.ts
//
// RP-004E1 — First-write-only IANA timezone capture.
//
// Authenticated POST that persists a validated IANA timezone on
// User.timezone. Semantics (deliberately narrow):
//
//   * Only accepts a browser-submitted IANA name (e.g. "Europe/Berlin").
//     Raw UTC offsets ("+02:00"), abbreviations ("CET"), and unknown
//     names are rejected by isValidIanaTimezone.
//   * If User.timezone is currently NULL, the value is stored and the
//     response reports `captured: true, retained: false`.
//   * If User.timezone is already set, the stored value is preserved
//     unchanged; the response reports `captured: false, retained: true,
//     timezone: <stored>`. This makes trivial repeated switching to
//     harvest extra daily unlocks ineffective — the manual travel /
//     account-settings flow lands in a later phase.
//   * userId is derived from the next-auth session; never accepted from
//     the client.
//   * Rate-limited via the shared lib/rate helper.
//
// The Library daily-limit read path is defensive-in-depth: it re-runs
// isValidIanaTimezone on the stored value at read time, so even if a
// malformed row somehow slipped in, the daily limit degrades to UTC
// rather than throwing.

import { getServerSession } from "next-auth";
import { headers } from "next/headers";
import { authOptions } from "@/lib/auth/config";
import { jsonError, jsonOk } from "@/lib/api";
import { log } from "@/lib/log";
import { toErrData } from "@/lib/error";
import { prisma } from "@/lib/prisma";
import { rateLimit, clientIpFromRequest } from "@/lib/rate";
import { isValidIanaTimezone } from "@/lib/entitlement/timezone";

export const runtime = "nodejs";

type RawBody = {
  timezone?: unknown;
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
  log.info(h, "account:timezone:capture:start");

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      log.warn(h, "account:timezone:capture:unauthorized");
      return jsonError("Unauthorized", 401);
    }
    const userId = session.user.id as string;

    // Rate limit: 30 requests per minute per user + IP. Timezone captures
    // are one-shot per browser session in practice; anything above this
    // is either a bug or abuse.
    const ip = clientIpFromRequest(req);
    const rate = await rateLimit(
      `account:timezone:capture:${userId}:${ip}`,
      30,
      60_000
    );
    if (!rate.ok) {
      return jsonError("RATE_LIMITED", 429, undefined, rate.headers);
    }

    const raw = await readBody(req);
    if (!isValidIanaTimezone(raw.timezone)) {
      return jsonError("INVALID_TIMEZONE", 400);
    }
    const requested = raw.timezone.trim();

    // First-write-only. Prisma's updateMany with a `null` filter is an
    // atomic conditional write: any concurrent writer that lost this
    // race will find the row already set and skip the update on the
    // next branch.
    const upd = await prisma.user.updateMany({
      where: { id: userId, timezone: null },
      data: { timezone: requested },
    });

    if (upd.count === 1) {
      log.info(h, "account:timezone:capture:stored", { userId });
      return jsonOk(
        { captured: true, retained: false, timezone: requested },
        200
      );
    }

    // Either the user did not exist, or timezone was already set. Read
    // once to distinguish the two — if the user is truly missing, treat
    // it as a session mismatch.
    const existing = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    if (!existing) {
      return jsonError("USER_NOT_FOUND", 401);
    }
    log.info(h, "account:timezone:capture:retained", { userId });
    return jsonOk(
      {
        captured: false,
        retained: true,
        timezone: existing.timezone,
      },
      200
    );
  } catch (e) {
    const { code, msg } = toErrData(e);
    log.error(h, "account:timezone:capture:failed", { code, msg });
    return jsonError("INTERNAL_ERROR", 500, {
      code,
      message: "Deine Anfrage konnte gerade nicht verarbeitet werden.",
    });
  }
}
