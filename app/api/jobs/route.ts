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

export const runtime = "nodejs";

/* ---- Helpers for robust parsing ---- */
type RawCreateJob = {
  prompt?: unknown;
  preset?: unknown;
  durationSec?: unknown;
  text?: unknown;
  duration?: unknown;
  title?: unknown;
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
        title: true, // Titel mitschicken
      },
      take: Math.min(isFinite(take) ? take : 20, 50),
      skip: Math.max(isFinite(skip) ? skip : 0, 0),
    });

    log.info(h, "jobs:list:ok", { count: jobs.length });
    addDebugLog({
      ts: new Date().toISOString(),
      level: "info",
      route: "/api/jobs GET",
      userId: session.user.id as string,
      message: "List OK",
      data: { count: jobs.length, take, skip },
      reqId: h.get("x-request-id") ?? undefined,
    });
    return jsonOk(jobs, 200);
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
    };

    // 🔹 Eigene minimale Validierung statt Zod
    if (!normalized.prompt || normalized.prompt.trim().length < 3) {
      addDebugLog({
        ts: new Date().toISOString(),
        level: "warn",
        route: "/api/jobs POST",
        userId: session.user.id as string,
        message: "Prompt too short or missing",
        reqId: h.get("x-request-id") ?? undefined,
      });
      return jsonError("BAD_REQUEST", 400, {
        message: "Prompt ist erforderlich und muss mindestens 3 Zeichen haben.",
      });
    }

    const prompt = normalized.prompt.trim();
    const preset = normalized.preset;
    const durationSec = normalized.durationSec;

    const effectiveTitle =
      normalized.title && normalized.title.trim() !== ""
        ? normalized.title.trim()
        : makeTitleFromPrompt(prompt);

    // User inkl. Credits/Admin-Flag holen
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

    // 👉 Credits-Gate:
    const currentCredits = dbUser.credits ?? 0;
    if (!dbUser.isAdmin && currentCredits <= 0) {
      addDebugLog({
        ts: new Date().toISOString(),
        level: "warn",
        route: "/api/jobs POST",
        userId: dbUser.id,
        message: "No credits left",
        data: { credits: currentCredits },
        reqId: h.get("x-request-id"),
      });

      return Response.json(
        {
          error: "NO_CREDITS",
          message: "Du hast aktuell keine Credits. Bitte lade dein Guthaben auf.",
        },
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
      return new Response(
        JSON.stringify({
          ok: false,
          error: "RATE_LIMITED",
          retryAfterSeconds: retryAfter,
        }),
        {
          status: 429,
          headers: { "Retry-After": String(retryAfter) },
        }
      );
    }

    const COST_PER_JOB = 1;

    if (!dbUser.isAdmin) {
      const currentCreditsInner = dbUser.credits ?? 0;

      if (currentCreditsInner < COST_PER_JOB) {
        addDebugLog({
          ts: new Date().toISOString(),
          level: "warn",
          route: "/api/jobs POST",
          userId: dbUser.id,
          message: "No credits left",
          data: { creditsLeft: currentCreditsInner },
          reqId: h.get("x-request-id"),
        });

        return Response.json(
          {
            error: "NO_CREDITS",
            message: "Du hast aktuell keine Credits mehr.",
            creditsLeft: currentCreditsInner,
          },
          { status: 402 }
        );
      }

      if (dbUser.credits < COST_PER_JOB) {
        log.warn(h, "jobs:create:no_credits", { userId: dbUser.id });
        addDebugLog({
          ts: new Date().toISOString(),
          level: "warn",
          route: "/api/jobs POST",
          userId: dbUser.id,
          message: "No credits left",
          data: { credits: dbUser.credits },
          reqId: h.get("x-request-id"),
        });

        return Response.json(
          {
            error: "NO_CREDITS",
            message:
              "Du hast aktuell keine Credits mehr. Bitte lade dein Guthaben auf.",
          },
          { status: 402 }
        );
      }
    }

    const job = await prisma.job.create({
      data: {
        userId: dbUser.id,
        prompt,
        preset: preset ?? null,
        status: $Enums.JobStatus.QUEUED,
        durationSec: typeof durationSec === "number" ? durationSec : null,
        title: effectiveTitle,
      },
      select: { id: true, status: true, title: true, prompt: true },
    });

    // 🔻 Credits abbuchen (nur Nicht-Admins)
    if (!dbUser.isAdmin) {
      await prisma.user.update({
        where: { id: dbUser.id },
        data: {
          credits: {
            decrement: COST_PER_JOB,
          },
        },
      });
    }

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