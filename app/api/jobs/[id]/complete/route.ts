// app/api/jobs/[id]/complete/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { $Enums } from "@prisma/client";
import path from "node:path";
import fs from "node:fs/promises";

// 👉 wenn du lib/s3 exporte hast, nutze sie:
import { uploadMP3ToS3, s3KeyForJob, hasS3Env } from "@/lib/s3";
// Falls du KEIN hasS3Env() exportierst, kannst du ersatzweise:
// const hasS3Env = () =>
//   !!process.env.S3_BUCKET && !!process.env.S3_REGION && !!process.env.S3_ACCESS_KEY_ID && !!process.env.S3_SECRET_ACCESS_KEY;

export const runtime = "nodejs";

type CompleteBody = {
  resultUrl?: string;
  durationSec?: number;
  error?: string;
};

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

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
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
  if (!job) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // optionaler Body
  let body: CompleteBody = {};
  try {
    body = (await req.json()) as CompleteBody;
  } catch {
    // kein Body ist ok
  }

  // Client meldet Fehler -> FAIL
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

  // Falls der Client bereits eine resultUrl liefert, übernehmen (z.B. extern)
  let nextResultUrl = body.resultUrl ?? null;

  // Wir versuchen zusätzlich, die Dauer zu bestimmen – niemals fatal
  let detectedDuration: number | undefined;

  // Zielpfad für lokale Kopie (Fallback/Entwicklungsmodus)
  const localRel = `/generated/${id}.mp3`;
  const localAbs = path.join(process.cwd(), "public", "generated", `${id}.mp3`);

  if (!nextResultUrl) {
    // === ElevenLabs Synthese ===
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
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

      const buf = Buffer.from(await resp.arrayBuffer());

      // Dauer erkennen (best-effort, niemals fatal)
      try {
        const { parseBuffer } = await import("music-metadata");
        const meta = await parseBuffer(buf, "audio/mpeg");
        if (meta.format.duration && Number.isFinite(meta.format.duration)) {
          detectedDuration = Math.round(meta.format.duration);
        }
      } catch {
        // ignorieren
      }

      // === S3 bevorzugen, sonst lokal speichern ===
      try {
        if (hasS3Env()) {
          await uploadMP3ToS3(s3KeyForJob(id), buf);
          // Proxy-Route liefert aus S3 (oder lokal, je nach Implementierung)
          nextResultUrl = `/api/jobs/${id}/audio`;
        } else {
          await fs.mkdir(path.dirname(localAbs), { recursive: true });
          await fs.writeFile(localAbs, buf);
          nextResultUrl = `/api/jobs/${id}/audio`;
        }
      } catch (e) {
        // Falls Upload/Write schief geht → FAIL
        const msg = e instanceof Error ? e.message : "Store audio failed";
        await prisma.job.update({
          where: { id },
          data: { status: $Enums.JobStatus.FAILED, error: msg },
        });
        return NextResponse.json({ error: msg }, { status: 500 });
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

  // Dauer final wählen (Body > erkannt > bisher)
  const nextDuration =
    typeof body.durationSec === "number" && !Number.isNaN(body.durationSec)
      ? body.durationSec
      : typeof detectedDuration === "number"
      ? detectedDuration
      : job.durationSec ?? undefined;

  // Job abschließen
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
    },
  });

  // Track-Dauer mitziehen (falls es einen Track zu diesem Job gibt)
  if (typeof nextDuration === "number") {
    await prisma.track.updateMany({
      where: { jobId: id },
      data: { durationSeconds: nextDuration },
    });
  }

  return NextResponse.json(updated);
}