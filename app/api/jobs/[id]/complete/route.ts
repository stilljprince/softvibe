import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { $Enums } from "@prisma/client";
import path from "node:path";
import fs from "node:fs/promises";
import { rateLimit, clientIpFromRequest } from "@/lib/rate";
import { uploadMP3ToS3, s3KeyForJob, hasS3Env } from "@/lib/s3";
import { addDebugLog } from "@/lib/debug-log";
import { headers as nextHeaders } from "next/headers";
import { jsonOk, jsonError } from "@/lib/api";
export const runtime = "nodejs";

type CompleteBody = {
  resultUrl?: string;
  durationSec?: number;
  error?: string;
};
function makeTitleFromPrompt(
  prompt: string | null | undefined,
  fallback = "SoftVibe Track"
): string {
  const raw = (prompt ?? "").trim();
  if (!raw) return fallback;

  // hier kannst du die 80 Zeichen anpassen, wenn du willst
  return raw.length > 80 ? raw.slice(0, 77) + "…" : raw;
}

function settingsForPreset(preset?: string) {
  switch (preset) {
    case "classic-asmr":
      return {
        stability: 0.25,
        similarity_boost: 0.9,
        style: 0.75,
        use_speaker_boost: false,
      };
    case "sleep-story":
      return {
        stability: 0.55,
        similarity_boost: 0.85,
        style: 0.45,
        use_speaker_boost: false,
      };
    case "meditation":
      return {
        stability: 0.4,
        similarity_boost: 0.9,
        style: 0.6,
        use_speaker_boost: false,
      };
    default:
      return {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.3,
        use_speaker_boost: false,
      };
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const h = await nextHeaders();
  const reqId = h.get("x-request-id") ?? undefined;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    addDebugLog({
      ts: new Date().toISOString(),
      level: "warn",
      route: "/api/jobs/[id]/complete POST",
      userId: null,
      message: "Unauthorized",
      data: { id },
      reqId,
    });
    return jsonError("Unauthorized", 401);
  }

  const key = session.user.id
    ? `u:${session.user.id}:complete`
    : `ip:${clientIpFromRequest(req)}:complete`;
  const rl = rateLimit(key, 10, 60_000);
  if (!rl.ok) {
    addDebugLog({
      ts: new Date().toISOString(),
      level: "warn",
      route: "/api/jobs/[id]/complete POST",
      userId: session.user.id as string,
      message: "Rate limited",
      data: { id },
      reqId,
    });
    return new NextResponse(
      JSON.stringify({
        ok: false,
        error: "RATE_LIMITED",
        message: "Zu viele Abschlüsse. Bitte kurz warten.",
      }),
      { status: 429, headers: rl.headers }
    );
  }

  const job = await prisma.job.findFirst({
    where: { id, userId: session.user.id },
    select: {
      id: true,
      status: true,
      resultUrl: true,
      prompt: true,
      preset: true,
      durationSec: true,
      createdAt: true,
      title: true, // 👈 NEU
    },
  });
  if (!job) {
    addDebugLog({
      ts: new Date().toISOString(),
      level: "warn",
      route: "/api/jobs/[id]/complete POST",
      userId: session.user.id as string,
      message: "Job not found",
      data: { id },
      reqId,
    });
    return jsonError("NOT_FOUND", 404);
  }

  let body: CompleteBody = {};
  try {
    body = (await req.json()) as CompleteBody;
  } catch {
    /* empty body ok */
  }

  if (body.error && body.error.trim() !== "") {
    const failed = await prisma.job.update({
      where: { id },
      data: {
        status: $Enums.JobStatus.FAILED,
        error: body.error,
        resultUrl: job.resultUrl ?? null,
      },
      select: {
        id: true,
        status: true,
        resultUrl: true,
        durationSec: true,
        prompt: true,
        preset: true,
        createdAt: true,
        title: true, // 👈 NEU
      },
    });
    addDebugLog({
      ts: new Date().toISOString(),
      level: "warn",
      route: "/api/jobs/[id]/complete POST",
      userId: session.user.id as string,
      message: "Client failed job",
      data: { id, error: body.error },
      reqId,
    });
    return jsonOk(failed, 200);
  }

  let nextResultUrl = body.resultUrl ?? null;
  let detectedDuration: number | undefined;

  const localRel = `/generated/${id}.mp3`;
  const localAbs = path.join(process.cwd(), "public", "generated", `${id}.mp3`);

  if (!nextResultUrl) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const voiceId =
      process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
    const modelId =
      process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";

    if (!apiKey) {
      await prisma.job.update({
        where: { id },
        data: {
          status: $Enums.JobStatus.FAILED,
          error: "ELEVENLABS_API_KEY missing",
        },
      });
      addDebugLog({
        ts: new Date().toISOString(),
        level: "error",
        route: "/api/jobs/[id]/complete POST",
        userId: session.user.id as string,
        message: "Missing ELEVENLABS_API_KEY",
        data: { id },
        reqId,
      });
      return jsonError("ELEVENLABS_API_KEY missing", 500);
    }

    const text = job.prompt?.trim() || "SoftVibe Demo Clip";
    const voiceSettings = settingsForPreset(job.preset ?? undefined);

    try {
      const resp = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text,
            model_id: modelId,
            voice_settings: voiceSettings,
          }),
        }
      );

      if (!resp.ok) {
        const errTxt = await resp.text().catch(() => String(resp.status));
        throw new Error(`ElevenLabs: ${resp.status} ${errTxt}`);
      }

      const buf = Buffer.from(await resp.arrayBuffer());

      try {
        const { parseBuffer } = await import("music-metadata");
        const meta = await parseBuffer(buf, "audio/mpeg");
        if (meta.format.duration && Number.isFinite(meta.format.duration)) {
          detectedDuration = Math.round(meta.format.duration);
        }
      } catch {
        /* ignore */
      }

      try {
        if (hasS3Env()) {
          await uploadMP3ToS3(s3KeyForJob(id), buf);
          nextResultUrl = `/api/jobs/${id}/audio`;
        } else {
          await fs.mkdir(path.dirname(localAbs), { recursive: true });
          await fs.writeFile(localAbs, buf);
          nextResultUrl = `/api/jobs/${id}/audio`;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Store audio failed";
        await prisma.job.update({
          where: { id },
          data: { status: $Enums.JobStatus.FAILED, error: msg },
        });
        addDebugLog({
          ts: new Date().toISOString(),
          level: "error",
          route: "/api/jobs/[id]/complete POST",
          userId: session.user.id as string,
          message: "Store audio failed",
          data: { id, error: msg },
          reqId,
        });
        return jsonError(msg, 500);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "TTS failed";
      await prisma.job.update({
        where: { id },
        data: { status: $Enums.JobStatus.FAILED, error: msg },
      });
      addDebugLog({
        ts: new Date().toISOString(),
        level: "error",
        route: "/api/jobs/[id]/complete POST",
        userId: session.user.id as string,
        message: "TTS failed",
        data: { id, error: msg },
        reqId,
      });
      return jsonError(msg, 500);
    }
  }

  const nextDuration =
    typeof body.durationSec === "number" && !Number.isNaN(body.durationSec)
      ? body.durationSec
      : typeof detectedDuration === "number"
      ? detectedDuration
      : job.durationSec ?? undefined;

  const updated = await prisma.job.update({
    where: { id },
    data: {
      status: $Enums.JobStatus.DONE,
      resultUrl: nextResultUrl ?? localRel,
      durationSec: nextDuration,
      error: null,
    },
    select: {
      id: true,
      status: true,
      resultUrl: true,
      durationSec: true,
      prompt: true,
      preset: true,
      createdAt: true,
      title: true, // 👈 NEU
    },
  });

  if (typeof nextDuration === "number") {
    await prisma.track.updateMany({
      where: { jobId: id },
      data: { durationSeconds: nextDuration },
    });
  }

  /* 👇 NEU: falls noch kein Track zu diesem Audio existiert, einen anlegen */
  try {
  const url = updated.resultUrl ?? null;
  if (url) {
    const existing = await prisma.track.findFirst({
      where: { userId: session.user.id as string, url },
      select: { id: true },
    });

    const safeTitle =
      updated.title && updated.title.trim() !== ""
        ? updated.title.trim().slice(0, 80)
        : makeTitleFromPrompt(updated.prompt, "SoftVibe Track");

    if (!existing) {
      await prisma.track.create({
        data: {
          userId: session.user.id as string,
          jobId: updated.id,
          title: safeTitle,
          url,
          durationSeconds:
            typeof updated.durationSec === "number"
              ? updated.durationSec
              : typeof nextDuration === "number"
              ? nextDuration
              : null,
        },
      });
    } else if (typeof nextDuration === "number") {
      await prisma.track.update({
        where: { id: existing.id },
        data: { durationSeconds: nextDuration },
      });
    }
  }
  } catch {
    // Track-Erstellung darf den Job-Abschluss nicht scheitern lassen
  }
  /* 👆 NEU Ende */

  addDebugLog({
    ts: new Date().toISOString(),
    level: "info",
    route: "/api/jobs/[id]/complete POST",
    userId: session.user.id as string,
    message: "Complete OK",
    data: {
      id: updated.id,
      status: updated.status,
      durationSec: updated.durationSec ?? null,
    },
    reqId,
  });

  return jsonOk(updated, 200);
}