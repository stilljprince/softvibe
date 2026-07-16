import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
// CreateJobSchema raus
import { $Enums } from "@prisma/client";
// rateLimit wird hier nicht benutzt → raus
import { headers } from "next/headers";
import { log } from "@/lib/log";
import { addDebugLog } from "@/lib/debug-log";
import { toErrData } from "@/lib/error";
import { jsonOk, jsonError } from "@/lib/api";
import { makeTitleFromPrompt } from "@/lib/title";
import { runPromptGate } from "@/lib/validation/promptGate";
import {
  reserveAndCreateJob,
  minutesFromDurationSec,
} from "@/lib/entitlement/reservation";
import {
  claimProbeAndCreateJob,
  isOnProbePath,
} from "@/lib/entitlement/probe";
console.log("[BOOT] jobs route loaded from:", __filename);
export const runtime = "nodejs";

/* ---- Helpers for robust parsing ---- */
type RawCreateJob = {
  prompt?: unknown;
  preset?: unknown;
  durationSec?: unknown;
  text?: unknown;
  duration?: unknown;
  title?: unknown;
  language?: unknown;
  voiceStyle?: unknown;
  voiceGender?: unknown;
  narrativeMode?: unknown;
  scriptOverride?: unknown;
};

async function readCreateJobBody(req: Request): Promise<RawCreateJob> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      return (await req.json()) as unknown as RawCreateJob;
    } catch {
      return {};
    }
  }
  if (
    ct.includes("multipart/form-data") ||
    ct.includes("application/x-www-form-urlencoded")
  ) {
    try {
      const fd = await req.formData();
      const obj: RawCreateJob = {};
      for (const [k, v] of fd.entries()) {
        (obj as Record<string, unknown>)[k] =
          typeof v === "string" ? v : undefined;
      }
      return obj;
    } catch {
      /* fallthrough */
    }
  }
  try {
    const t = await req.text();
    if (!t) return {};
    try {
      return JSON.parse(t) as RawCreateJob;
    } catch {
      const sp = new URLSearchParams(t);
      const obj: RawCreateJob = {};
      sp.forEach((v, k) => ((obj as Record<string, unknown>)[k] = v));
      return obj;
    }
  } catch {
    return {};
  }
}

function coerceNumber(n: unknown): number | null {
  if (typeof n === "number" && Number.isFinite(n)) return n;
  if (typeof n === "string" && n.trim() !== "") {
    const v = Number(n);
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

function pickPrompt(data: RawCreateJob): string | null {
  const p = typeof data.prompt === "string" ? data.prompt : undefined;
  const t = typeof data.text === "string" ? data.text : undefined;
  const out = (p ?? t ?? "").trim();
  return out.length > 0 ? out : null;
}

/* ---- LIST ---- */
export async function GET(req: Request) {
  const h = await headers();
  log.info(h, "jobs:list:start");

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    log.warn(h, "jobs:list:unauthorized");
    addDebugLog({
      ts: new Date().toISOString(),
      level: "warn",
      route: "/api/jobs GET",
      userId: null,
      message: "Unauthorized list",
      reqId: h.get("x-request-id") ?? undefined,
    });
    return jsonError("Unauthorized", 401);
  }

 try {
  const { searchParams } = new URL(req.url);
  const take = Number(searchParams.get("take") ?? "20");
  const skip = Number(searchParams.get("skip") ?? "0");

  const jobs = await prisma.job.findMany({
    where: { userId: session.user.id as string },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      resultUrl: true,
      prompt: true,
      preset: true,
      durationSec: true,
      createdAt: true,
      title: true,
      language: true,
      voiceGender: true,
      voiceStyle: true,
      _count: { select: { tracks: true } },
    },
    take: Math.min(isFinite(take) ? take : 20, 50),
    skip: Math.max(isFinite(skip) ? skip : 0, 0),
  });

  // Story metadata: resolve storyId + chapterCount in 2 batched queries
  // instead of 2 queries × N jobs (was 40 round-trips for a 20-job page).
  const jobIds = jobs.map((j) => j.id);

  // Query 1: first track with storyId per job (partIndex = 0)
  const storyAnchorTracks = jobIds.length > 0
    ? await prisma.track.findMany({
        where: {
          jobId: { in: jobIds },
          storyId: { not: null },
          partIndex: 0,
        },
        select: { jobId: true, storyId: true },
      })
    : [];

  // Build jobId → storyId lookup
  const storyByJobId = new Map<string, string>();
  for (const t of storyAnchorTracks) {
    if (t.jobId && t.storyId) storyByJobId.set(t.jobId, t.storyId);
  }

  const storyIds = [...new Set(storyAnchorTracks.map((t) => t.storyId!))];

  // Query 2: chapter counts grouped by storyId
  const chapterCountRows = storyIds.length > 0
    ? await prisma.track.groupBy({
        by: ["storyId"],
        where: { storyId: { in: storyIds } },
        _count: { id: true },
      })
    : [];

  const countByStoryId = new Map<string, number>();
  for (const r of chapterCountRows) {
    if (r.storyId) countByStoryId.set(r.storyId, r._count.id);
  }

  const jobsWithStory = jobs.map((j) => {
    const storyId = storyByJobId.get(j.id) ?? null;
    return {
      ...j,
      storyId,
      chapterCount: storyId ? (countByStoryId.get(storyId) ?? 0) : 0,
      firstPartTitle: null as string | null,
    };
  });

  log.info(h, "jobs:list:ok", { count: jobsWithStory.length });
  addDebugLog({
    ts: new Date().toISOString(),
    level: "info",
    route: "/api/jobs GET",
    userId: session.user.id as string,
    message: "List OK",
    data: { count: jobsWithStory.length, take, skip },
    reqId: h.get("x-request-id") ?? undefined,
  });

  return jsonOk(jobsWithStory, 200);

} catch (e) {
  const msg = e instanceof Error ? e.message : "unknown";
  log.error(h, "jobs:list:failed", { msg });
  addDebugLog({
    ts: new Date().toISOString(),
    level: "error",
    route: "/api/jobs GET",
    userId: session.user.id as string,
    message: "List failed",
    data: { msg },
    reqId: h.get("x-request-id") ?? undefined,
  });
  return jsonError("INTERNAL_ERROR", 500, { message: msg });
}

}
/* ---- CREATE ---- */
export async function POST(req: Request) {
  const h = await headers();
  log.info(h, "jobs:create:start");

  const { pathname } = new URL(req.url);
  if (!/^\/api\/jobs\/?$/.test(pathname)) {
    return jsonError("WRONG_ENDPOINT", 404, {
      want: "/api/jobs",
      got: pathname,
    });
  }

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      log.warn(h, "jobs:create:unauthorized");
      addDebugLog({
        ts: new Date().toISOString(),
        level: "warn",
        route: "/api/jobs POST",
        userId: null,
        message: "Unauthorized create",
        reqId: h.get("x-request-id") ?? undefined,
      });
      return jsonError("Unauthorized", 401);
    }

    const raw = await readCreateJobBody(req);

    const normalized = {
      title:
        typeof raw.title === "string" && raw.title.trim() !== ""
          ? raw.title.trim()
          : null,
      prompt: pickPrompt(raw),
      preset:
        typeof raw.preset === "string" && raw.preset.trim() !== ""
          ? raw.preset.trim()
          : null,
      durationSec: coerceNumber(raw.durationSec ?? raw.duration),
      language:
        raw.language === "en" || raw.language === "de"
          ? raw.language
          : "de",
      voiceGender:
        raw.voiceGender === "male" || raw.voiceGender === "female"
          ? raw.voiceGender
          : "female",
      voiceStyle: ((): "soft" | "whisper" => {
        const requested: "soft" | "whisper" =
          raw.voiceStyle === "whisper" || raw.voiceStyle === "soft"
            ? raw.voiceStyle
            : "soft";
        // sleep-story and kids-story always render with "soft" delivery
        // (resolveVoiceId + script wps both ignore voiceStyle for these presets).
        // Normalize at create-time so job.voiceStyle reflects the effective style
        // — keeps DB state and all downstream logs consistent.
        const presetStr =
          typeof raw.preset === "string" ? raw.preset.trim() : "";
        if (presetStr === "sleep-story" || presetStr === "kids-story") {
          return "soft";
        }
        return requested;
      })(),
      narrativeMode: ((): "story" | "quiet-knowledge" | null => {
        // narrativeMode is only meaningful for the narrative preset.
        // For any other preset we persist null so downstream consumers
        // can't accidentally branch on a stale submode.
        const presetStr =
          typeof raw.preset === "string" ? raw.preset.trim() : "";
        if (presetStr !== "narrative") return null;
        if (raw.narrativeMode === "story" || raw.narrativeMode === "quiet-knowledge") {
          return raw.narrativeMode;
        }
        return "story";
      })(),
      scriptOverride:
        typeof raw.scriptOverride === "string" && raw.scriptOverride.trim() !== ""
          ? raw.scriptOverride.trim()
          : null,
    };

    // P0 Safety Gate — shape check + local safety + OpenAI moderation.
    // Runs before any credit/rate-limit work so a rejected prompt costs nothing.
    const gate = await runPromptGate(normalized.prompt ?? "");
    if (!gate.ok) {
      addDebugLog({
        ts: new Date().toISOString(),
        level: "warn",
        route: "/api/jobs POST",
        userId: session.user.id as string,
        message: "Prompt rejected by gate",
        data: { code: gate.code },
        reqId: h.get("x-request-id") ?? undefined,
      });
      return jsonError(gate.code, gate.httpStatus, { message: gate.message });
    }

    const prompt = gate.normalized;
    const preset = normalized.preset;
    const durationSec = normalized.durationSec;

    const effectiveTitle =
      normalized.title && normalized.title.trim() !== ""
        ? normalized.title.trim()
        : makeTitleFromPrompt(prompt);

    // User inkl. Credits/Admin-Flag holen. plan+planPeriodEnd are used only to
    // pick the admission path (probe vs. reservation). The probe transaction
    // re-reads its own authoritative snapshot; the paid reservation path does
    // too — this fetch is a routing hint, not a decision commit.
    const dbUser = await prisma.user.findFirst({
      where: {
        OR: [
          { id: session.user.id as string },
          ...(session.user.email
            ? [{ email: session.user.email as string }]
            : []),
        ],
      },
      select: {
        id: true,
        isAdmin: true,
        credits: true,
        plan: true,
        planPeriodEnd: true,
      },
    });

    if (!dbUser) {
      log.warn(h, "jobs:create:user_not_found");
      addDebugLog({
        ts: new Date().toISOString(),
        level: "warn",
        route: "/api/jobs POST",
        userId: session.user.id as string,
        message: "User not found",
        reqId: h.get("x-request-id"),
      });
      return Response.json({ error: "USER_NOT_FOUND" }, { status: 401 });
    }

    // RP-010 Phase 4A — Free Probe path.
    // Non-admin users whose *effective* plan is FREE (persisted FREE, or a
    // paid plan whose billing period has already elapsed) are routed to the
    // lifetime probe path. Credits and Custom-Minute reservation are
    // deliberately bypassed here — Free admission is now governed solely by
    // probeGenerationsUsed. Admin users retain their pre-Phase-4A behaviour
    // and always flow through reserveAndCreateJob below.
    const now = new Date();
    const onProbePath =
      !dbUser.isAdmin && isOnProbePath(dbUser.plan, dbUser.planPeriodEnd, now);

    // Fast-path credits check using already-fetched value.
    // The authoritative atomic decrement happens below, after the rate-limit check.
    // This early exit avoids the rate-limit DB query for users definitively at 0.
    // Probe callers skip the credit gate — probes never debit credits.
    if (!onProbePath && !dbUser.isAdmin && (dbUser.credits ?? 0) < 1) {
      addDebugLog({
        ts: new Date().toISOString(),
        level: "warn",
        route: "/api/jobs POST",
        userId: dbUser.id,
        message: "No credits left (fast-path)",
        data: { credits: dbUser.credits },
        reqId: h.get("x-request-id"),
      });
      return Response.json(
        { error: "NO_CREDITS", message: "Du hast aktuell keine Credits. Bitte lade dein Guthaben auf." },
        { status: 402 }
      );
    }

    // Softes Rate-Limit über DB
    const WINDOW_MS = 5000;
    const since = new Date(Date.now() - WINDOW_MS);
    const recent = await prisma.job.findFirst({
      where: { userId: dbUser.id, createdAt: { gt: since } },
      select: { id: true },
    });
    if (recent) {
      const retryAfter = Math.ceil(WINDOW_MS / 1000);
      log.warn(h, "jobs:create:rate_limited", { retryAfter });
      addDebugLog({
        ts: new Date().toISOString(),
        level: "warn",
        route: "/api/jobs POST",
        userId: dbUser.id,
        message: "Rate limited",
        data: { retryAfter },
        reqId: h.get("x-request-id") ?? undefined,
      });
      // Both field names are included: retryAfter (read by the web UI) and
      // retryAfterSeconds (the originally released name). The Retry-After header
      // is the authoritative value for all clients.
      return new Response(
        JSON.stringify({
          ok: false,
          error: "RATE_LIMITED",
          retryAfter: retryAfter,
          retryAfterSeconds: retryAfter,
        }),
        {
          status: 429,
          headers: { "Retry-After": String(retryAfter) },
        }
      );
    }

    // RP-010 Phase 4A — Free Probe admission.
    // For effective FREE (non-admin) users the counter claim and Job.create
    // run atomically inside claimProbeAndCreateJob. No credit debit, no
    // PeriodUsage write, no LibraryUnlock interaction. The two-lifetime cap
    // is enforced with a conditional updateMany against the current
    // committed row — concurrent claimers cannot exceed the limit.
    if (onProbePath) {
      const probeResult = await claimProbeAndCreateJob({
        userId: dbUser.id,
        durationSec: typeof durationSec === "number" ? durationSec : null,
        jobData: {
          userId: dbUser.id,
          prompt,
          preset: preset ?? null,
          status: $Enums.JobStatus.QUEUED,
          durationSec: typeof durationSec === "number" ? durationSec : null,
          title: effectiveTitle,
          language: normalized.language,
          voiceGender: normalized.voiceGender,
          voiceStyle: normalized.voiceStyle,
          narrativeMode: normalized.narrativeMode,
          scriptOverride: normalized.scriptOverride ?? null,
        },
        now,
      });

      if (!probeResult.ok) {
        log.warn(h, "jobs:create:probe_rejected", {
          error: probeResult.error,
        });
        addDebugLog({
          ts: new Date().toISOString(),
          level: "warn",
          route: "/api/jobs POST",
          userId: dbUser.id,
          message: "Probe claim rejected",
          data: { error: probeResult.error },
          reqId: h.get("x-request-id") ?? undefined,
        });
        if (probeResult.error === "PROBE_LIMIT_REACHED") {
          return jsonError("PROBE_LIMIT_REACHED", 402, {
            message:
              "Du hast deine zwei kostenlosen Probe-Generierungen bereits genutzt.",
          });
        }
        if (probeResult.error === "INVALID_PROBE_DURATION") {
          return jsonError("INVALID_PROBE_DURATION", 400, {
            message: "Probe-Dauer muss zwischen 5 und 8 Minuten liegen.",
          });
        }
        if (probeResult.error === "NOT_FREE_PLAN") {
          // Effective plan flipped between the routing snapshot and the
          // authoritative in-transaction read. Surface a controlled 409 so
          // the client can retry rather than see a generic 500.
          return jsonError("NOT_FREE_PLAN", 409, {
            message: "Bitte kurz erneut versuchen.",
          });
        }
        if (probeResult.error === "USER_NOT_FOUND") {
          return jsonError("USER_NOT_FOUND", 401);
        }
        if (probeResult.error === "CONCURRENCY_CONFLICT") {
          return jsonError("CONCURRENCY_CONFLICT", 409, {
            message: "Bitte kurz erneut versuchen.",
          });
        }
        return jsonError(probeResult.error, 400);
      }

      log.info(h, "jobs:create:probe_ok", {
        jobId: probeResult.job.id,
        probeGenerationsUsed: probeResult.probeGenerationsUsed,
      });
      addDebugLog({
        ts: new Date().toISOString(),
        level: "info",
        route: "/api/jobs POST",
        userId: dbUser.id,
        message: "Probe claim OK",
        data: {
          jobId: probeResult.job.id,
          probeGenerationsUsed: probeResult.probeGenerationsUsed,
        },
        reqId: h.get("x-request-id") ?? undefined,
      });
      return Response.json(probeResult.job, { status: 201 });
    }

    // RP-010 Phase 3A — Credit debit, Custom-Minute reservation and
    // Job.create all run inside the same Prisma transaction. If any step
    // fails the whole transaction rolls back, so a decremented credit can
    // never remain without its matching Job, and a PLAN_MINUTES Job can
    // never exist without a matching PeriodUsage increment. FREE / no-period
    // / zero-duration cases short-circuit to an untagged Job through the
    // same call. No separate credit refund path exists any more.
    const requestedMinutes = minutesFromDurationSec(
      typeof durationSec === "number" ? durationSec : null
    );
    const reservation = await reserveAndCreateJob({
      userId: dbUser.id,
      isAdmin: dbUser.isAdmin,
      requestedMinutes,
      jobData: {
        userId: dbUser.id,
        prompt,
        preset: preset ?? null,
        status: $Enums.JobStatus.QUEUED,
        durationSec: typeof durationSec === "number" ? durationSec : null,
        title: effectiveTitle,
        language: normalized.language,
        voiceGender: normalized.voiceGender,
        voiceStyle: normalized.voiceStyle,
        narrativeMode: normalized.narrativeMode,
        scriptOverride: normalized.scriptOverride ?? null,
      },
    });

    if (!reservation.ok) {
      log.warn(h, "jobs:create:reservation_rejected", {
        error: reservation.error,
      });
      addDebugLog({
        ts: new Date().toISOString(),
        level: "warn",
        route: "/api/jobs POST",
        userId: dbUser.id,
        message: "Reservation rejected",
        data: { error: reservation.error },
        reqId: h.get("x-request-id") ?? undefined,
      });
      if (reservation.error === "NO_CREDITS") {
        return jsonError("NO_CREDITS", 402, {
          message:
            "Du hast aktuell keine Credits mehr. Bitte lade dein Guthaben auf.",
        });
      }
      if (reservation.error === "INSUFFICIENT_MINUTES") {
        return jsonError("INSUFFICIENT_MINUTES", 402, {
          message:
            "Du hast dein monatliches Custom-Minuten-Kontingent aufgebraucht.",
        });
      }
      if (reservation.error === "USER_NOT_FOUND") {
        return jsonError("USER_NOT_FOUND", 401);
      }
      if (reservation.error === "CONCURRENCY_CONFLICT") {
        // Two writers raced for the same period's first PeriodUsage row and
        // both retries collided. Nothing is committed — surface a controlled
        // 409 so clients can retry rather than see a generic 500.
        return jsonError("CONCURRENCY_CONFLICT", 409, {
          message: "Bitte kurz erneut versuchen.",
        });
      }
      return jsonError(reservation.error, 400);
    }

    const job = reservation.job;
    addDebugLog({
      ts: new Date().toISOString(),
      level: "info",
      route: "/api/jobs POST",
      userId: dbUser.id,
      message: "Reservation result",
      data: { jobId: job.id, kind: reservation.reservation },
      reqId: h.get("x-request-id") ?? undefined,
    });

    log.info(h, "jobs:create:ok", { jobId: job.id });
    addDebugLog({
      ts: new Date().toISOString(),
      level: "info",
      route: "/api/jobs POST",
      userId: dbUser.id,
      message: "Create OK",
      data: { jobId: job.id },
      reqId: h.get("x-request-id"),
    });
    return Response.json(job, { status: 201 });
  } catch (e) {
    const { code, msg } = toErrData(e);
    log.error(h, "jobs:create:failed", { code, msg });
    addDebugLog({
      ts: new Date().toISOString(),
      level: "error",
      route: "/api/jobs POST",
      userId: undefined,
      message: "Create failed",
      data: { code, msg },
      reqId: (await headers()).get("x-request-id") ?? undefined,
    });
    return jsonError("INTERNAL_ERROR", 500, { code, message: msg });
  }
}