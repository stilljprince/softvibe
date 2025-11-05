// app/api/jobs/[id]/complete/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { $Enums } from "@prisma/client";
import path from "node:path";
import fs from "node:fs/promises";

export const runtime = "nodejs";

type CompleteBody = {
  resultUrl?: string;
  durationSec?: number;
  error?: string;
};

// Preset → Voice Settings (Werte 0..1)
function settingsForPreset(preset?: string) {
  switch (preset) {
    case "classic-asmr":
      return { stability: 0.25, similarity_boost: 0.9, style: 0.75, use_speaker_boost: false };
    case "sleep-story":
      return { stability: 0.55, similarity_boost: 0.85, style: 0.45, use_speaker_boost: false };
    case "meditation":
      return { stability: 0.4, similarity_boost: 0.9, style: 0.6, use_speaker_boost: false };
    default:
      return { stability: 0.5, similarity_boost: 0.75, style: 0.3, use_speaker_boost: false };
  }
}

// S3-Helfer lokal in dieser Route (damit du sonst nichts anfassen musst)
function hasS3Env() {
  return Boolean(
    process.env.S3_BUCKET &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY
  );
}
function s3KeyForJob(id: string) {
  const prefix = (process.env.S3_PREFIX ?? "generated").replace(/^\/|\/$/g, "");
  return `${prefix}/${id}.mp3`;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> } // Next.js 15: params ist Promise
) {
  const { id } = await ctx.params;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    },
  });
  if (!job) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  let body: CompleteBody = {};
  try {
    body = (await req.json()) as CompleteBody;
  } catch {
    // kein Body → ok
  }

  if (body.error && body.error.trim() !== "") {
    const failed = await prisma.job.update({
      where: { id },
      data: { status: $Enums.JobStatus.FAILED, error: body.error, resultUrl: job.resultUrl ?? null },
      select: {
        id: true,
        status: true,
        resultUrl: true,
        durationSec: true,
        prompt: true,
        preset: true,
        createdAt: true,
      },
    });
    return NextResponse.json(failed);
  }

  // Lokaler Zielpfad (Fallback)
  const localAbs = path.join(process.cwd(), "public", "generated", `${id}.mp3`);

  let nextResultUrl = body.resultUrl ?? null;

  if (!nextResultUrl) {
    // === ElevenLabs Synthese ===
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // setze deine Voice in .env.local
    const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";

    if (!apiKey) {
      await prisma.job.update({
        where: { id },
        data: { status: $Enums.JobStatus.FAILED, error: "ELEVENLABS_API_KEY missing" },
      });
      return NextResponse.json({ error: "ELEVENLABS_API_KEY missing" }, { status: 500 });
    }

    const text = job.prompt?.trim() || "SoftVibe Demo Clip";
    const voiceSettings = settingsForPreset(job.preset ?? undefined);

    console.log("[S3:complete]", {
      hasS3: hasS3Env(),
      bucket: process.env.S3_BUCKET,
      prefix: process.env.S3_PREFIX ?? "generated",
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION,
    });

    try {
      const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
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
      });

      if (!resp.ok) {
        const errTxt = await resp.text().catch(() => String(resp.status));
        throw new Error(`ElevenLabs: ${resp.status} ${errTxt}`);
      }

      const arrBuf = await resp.arrayBuffer();
      const bytes = new Uint8Array(arrBuf);

      if (hasS3Env()) {
        const { uploadMP3ToS3 } = await import("@/lib/s3");
        const key = s3KeyForJob(id);
        console.log("[S3:upload]", key);
        await uploadMP3ToS3(key, bytes);
        nextResultUrl = `/api/jobs/${id}/audio`;
      } else {
        await fs.mkdir(path.dirname(localAbs), { recursive: true });
        await fs.writeFile(localAbs, bytes);
        nextResultUrl = `/api/jobs/${id}/audio`;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "TTS failed";
      await prisma.job.update({
        where: { id },
        data: { status: $Enums.JobStatus.FAILED, error: msg },
      });
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  const nextDuration =
    typeof body.durationSec === "number" && !Number.isNaN(body.durationSec)
      ? body.durationSec
      : job.durationSec ?? undefined;

  const updated = await prisma.job.update({
    where: { id },
    data: {
      status: $Enums.JobStatus.DONE,
      resultUrl: nextResultUrl ?? `/api/jobs/${id}/audio`,
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
    },
  });

  return NextResponse.json(updated);
}