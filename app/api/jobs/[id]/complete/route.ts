// app/api/jobs/[id]/complete/route.ts
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { $Enums } from "@prisma/client";
import path from "node:path";
import fs from "node:fs/promises";
import { rateLimit, clientIpFromRequest } from "@/lib/rate";
import { uploadMP3ToS3, s3KeyForJob, hasS3Env, s3ObjectExists } from "@/lib/s3";
import { addDebugLog } from "@/lib/debug-log";
import { headers as nextHeaders } from "next/headers";
import { jsonOk, jsonError } from "@/lib/api";
import { makeTitleFromPrompt } from "@/lib/title";
import { buildScriptV2, enforceKidsSafety } from "@/lib/script-builder";
import { buildScriptOpenAI } from "@/lib/script-builder-openai";
import { applyV3Prosody } from "@/lib/tts/prosody-v3";
import { s3KeyForJobPart } from "@/lib/s3";
import { splitToChunksSafe, getMaxCharsPerRequest } from "@/lib/audio/chunks";
console.log("[prosody] typeof applyV3Prosody =", typeof applyV3Prosody);

// 🔹 ElevenLabs-Adapter & Voice-Resolver
import { elevenlabs, resolveVoiceId } from "@/lib/tts/elevenlabs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";




type CompleteBody = {
  resultUrl?: string;
  durationSec?: number;
  error?: string;
};



function settingsForPreset(preset?: string) {
  switch (preset) {
    case "classic-asmr":
      return {
        stability: 0.18,
        similarity_boost: 0.55,
        style: 0.05,
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
    case "kids-story":
      return {
        stability: 0.65,
        similarity_boost: 0.90,
        style: 0.35,
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

/**
 * Entfernt "Meta/Anweisungen" aus dem Prompt, damit ElevenLabs diese nicht mit vorliest.
 * (ElevenLabs liest alles 1:1, deshalb muss das vor dem TTS-Call bereinigt werden.)
 */
function stripTtsDirectives(input: string): string {
  let out = input;

  // fenced code blocks
  out = out.replace(/```[\s\S]*?```/g, "");

  // chat-role style lines
  out = out.replace(/^\s*(system|assistant|developer)\s*:\s*.*$/gim, "");

  // directive lines, e.g. [voice]: ..., voice: ..., instructions: ...
  out = out.replace(
    /^\s*\[(voice|style|tone|preset|instructions?)\]\s*:.*$/gim,
    ""
  );
  out = out.replace(
    /^\s*(voice|style|tone|preset|instructions?)\s*:\s*.*$/gim,
    ""
  );

  // separator lines
  out = out.replace(/^\s*-{3,}\s*$/gm, "");

  // normalize spacing
  out = out.replace(/\n{3,}/g, "\n\n");

  out = out.trim();
  return out.length > 0 ? out : input.trim();
}

// Für local speichern analog:
function localAbsForJobPart(baseDirAbs: string, jobId: string, partIndex: number) {
  const n = String(partIndex + 1).padStart(3, "0");
  return `${baseDirAbs}/${jobId}/part-${n}.mp3`;
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
      title: true,
      prompt: true,
      preset: true,
      durationSec: true,
      createdAt: true,
      language: true,
      voiceStyle: true,
      voiceGender: true,
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
console.log("COMPLETE language:", job?.id, job?.language);

  // Idempotency: if already DONE, return existing data without re-running generation.
  // FAILED or QUEUED jobs continue through the handler normally.
  if (job.status === $Enums.JobStatus.DONE && job.resultUrl) {
    return jsonOk(job, 200);
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
        title: true,
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
  let kidsSafetyApplied = false;
  let isMultiChunk = false;

  const localRel = `/generated/${id}.mp3`;
  const localAbs = path.join(
    process.cwd(),
    "public",
    "generated",
    `${id}.mp3`
  );

if (!nextResultUrl) {
  const preset = job.preset ?? undefined;
  const voiceSettings = settingsForPreset(preset);

  const safePreset =
    preset === "classic-asmr" || preset === "sleep-story" || preset === "meditation" || preset === "kids-story"
      ? preset
      : "classic-asmr";
const isSleepStory = safePreset === "sleep-story";
const isKidsStory = safePreset === "kids-story";

// Sleep story and kids story: always soft spoken (no whisper), regardless of UI setting
const voiceStyle =
  isSleepStory || isKidsStory ? "soft" : (job.voiceStyle === "whisper" ? "whisper" : "soft");

// Gender bleibt wie gewählt (fallback female)
const voiceGender =
  job.voiceGender === "male" ? "male" : "female";

console.log("[SLEEP-STORY RULES]", { safePreset, isSleepStory, voiceStyle, voiceGender });  
      
  const language = job.language === "en" ? "en" : "de";

  console.log("[PRESET INPUT]", {
    jobId: job.id,
    preset: job.preset,
    language: job.language,
    voiceStyle: job.voiceStyle,
    voiceGender: job.voiceGender,
  });

const SMOKE_BYPASS_SCRIPT_BUILDER = process.env.SMOKE_BYPASS_SCRIPT_BUILDER === "1";

let finalText = "";

if (SMOKE_BYPASS_SCRIPT_BUILDER) {
  finalText = ((job.prompt ?? "") as string).trim();
} else {
  const out = await buildScriptOpenAI({
    preset: safePreset,
    userPrompt: (job.prompt ?? "").trim(),
    targetDurationSec: typeof job.durationSec === "number" ? job.durationSec : undefined,
    language,
  });

  finalText = (out?.finalText ?? "").trim();
}

console.log("[SLEEP CHECK] preset=", safePreset, "hasYou=", /\byou\b/i.test(finalText));
console.log("[SLEEP CHECK] firstLine=", finalText.split("\n")[0]);

  if (!finalText) {
    const msg = "Script generation returned empty text";
    await prisma.job.update({
      where: { id },
      data: { status: $Enums.JobStatus.FAILED, error: msg },
    });
    return jsonError(msg, 500);
  }

  // Non-overridable kids safety post-check (repair-first, fail-second)
  if (isKidsStory) {
    const safeResult = enforceKidsSafety(finalText);
    if (!safeResult.safe) {
      const safetyMsg = "Story content did not pass safety check after repair attempt.";
      await prisma.job.update({
        where: { id },
        data: { status: $Enums.JobStatus.FAILED, error: safetyMsg },
      });
      return jsonError("CONTENT_SAFETY", 422, { message: safetyMsg });
    }
    kidsSafetyApplied = safeResult.text !== finalText;
    finalText = safeResult.text;
  }

  // ✅ TTS-Basistext
  const baseText = stripTtsDirectives(finalText);

  const isV3 = (process.env.ELEVENLABS_MODEL_ID ?? "").includes("eleven_v3");
  



  console.log("[VOICE RESOLUTION INPUT]", { preset: safePreset, voiceStyle, voiceGender });

  const voiceId = resolveVoiceId(safePreset, voiceStyle, voiceGender);

  console.log("[VOICE RESOLUTION OUTPUT]", { voiceId });
  console.log("[voice] using voiceId =", voiceId);

  if (voiceId === "soft" || voiceId === "whisper") {
    throw new Error(`[BUG] voiceId is variant (${voiceId}) not an ElevenLabs voice id`);
  }

  const t0 = Date.now();

  try {
    // =========================================================
    // ✅ SLEEP-STORY / KIDS-STORY: MULTI-CHUNK path only when >1 chunk
    // =========================================================
    const allChunks = (isSleepStory || isKidsStory)
      ? splitToChunksSafe(baseText, getMaxCharsPerRequest())
      : null;

    isMultiChunk = !!(allChunks && allChunks.length > 1);

    if (isMultiChunk) {
      const chunks = allChunks!;

      // Story idempotency: reuse storyId if a previous run already created tracks for this job
      const existingTrack = await prisma.track.findFirst({
        where: { jobId: id, storyId: { not: null } },
        select: { storyId: true },
      });
      let storyId: string;
      if (existingTrack?.storyId) {
        storyId = existingTrack.storyId;
      } else {
        const story = await prisma.story.create({
          data: {
            userId: session.user.id as string,
            title: job.title?.trim() || (isSleepStory ? "Sleep Story" : "Kids Story"),
            preset: safePreset,
            language: job.language ?? null,
          },
          select: { id: true },
        });
        storyId = story.id;
      }

      console.log("[multi-chunk] preset =", safePreset, "chunks =", chunks.length);

      for (let partIndex = 0; partIndex < chunks.length; partIndex++) {
        const partBase = chunks[partIndex];
        const partKey = s3KeyForJobPart(id, partIndex);
        const partsAbsRoot = path.dirname(localAbs);
        const partAbs = localAbsForJobPart(partsAbsRoot, id, partIndex);

        // Idempotency: skip TTS+upload if audio already stored
        const audioAlreadyStored = hasS3Env()
          ? await s3ObjectExists(partKey)
          : await fs.access(partAbs).then(() => true).catch(() => false);

        let partDuration: number | null = null;

        if (!audioAlreadyStored) {
          const ttsTextPart = isV3
            ? applyV3Prosody({
                preset: safePreset,
                text: partBase,
                seed: `${job.id}:${partIndex}`,
              })
            : partBase;

          const { audio } = await elevenlabs.speak({
            text: ttsTextPart,
            voiceId,
            modelId: process.env.ELEVENLABS_MODEL_ID ?? "eleven_v3",
            stability: 0.1,
            similarityBoost: 0.62,
            style: 0.25,
            useSpeakerBoost: true,
            preset: safePreset,
          });

          const buf = Buffer.from(audio);

          // Extract duration for this chapter
          try {
            const { parseBuffer } = await import("music-metadata");
            const meta = await parseBuffer(buf, "audio/mpeg");
            if (meta.format.duration && Number.isFinite(meta.format.duration)) {
              partDuration = Math.round(meta.format.duration);
            }
          } catch {
            /* ignore */
          }

          try {
            if (hasS3Env()) {
              await uploadMP3ToS3(partKey, buf);
            } else {
              await fs.mkdir(path.dirname(partAbs), { recursive: true });
              await fs.writeFile(partAbs, buf);
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : "Store audio failed";
            await prisma.job.update({
              where: { id },
              data: { status: $Enums.JobStatus.FAILED, error: msg },
            });
            return jsonError(msg, 500);
          }
        }

        const partUrl = `/api/jobs/${id}/audio?part=${partIndex + 1}`;
        const baseTitle = job.title?.trim() || (isSleepStory ? "Sleep Story" : "Kids Story");
        const partTitle = `Chapter ${partIndex + 1}/${chunks.length}`;

        console.log("[STORY TRACK]", {
          jobId: job.id,
          storyId,
          partIndex,
          partTitle,
          textLength: partBase.length,
          url: partUrl,
        });

        // Upsert track (idempotent on storyId + partIndex)
        await prisma.track.upsert({
          where: { storyId_partIndex: { storyId, partIndex } },
          update: {
            url: partUrl,
            title: `${baseTitle} — ${partTitle}`,
            ...(partDuration !== null ? { durationSeconds: partDuration } : {}),
          },
          create: {
            userId: session.user.id as string,
            jobId: id,
            title: `${baseTitle} — ${partTitle}`,
            url: partUrl,
            durationSeconds: partDuration,
            storyId,
            partIndex,
            partTitle,
          },
        });
      }

      console.log("[tts] multi-chunk total speak ms =", Date.now() - t0);

      nextResultUrl = `/api/jobs/${id}/audio?part=1`;
      console.log("[multi-chunk] done, firstUrl =", nextResultUrl);
      detectedDuration = undefined as unknown as number;
    } else {
      // =========================================================
      // ✅ Single MP3 path (classic-asmr, meditation, or short sleep/kids story)
      // =========================================================
      // Mode 1b: fail if script exceeds per-request character limit (no stitcher available)
      const maxChars = getMaxCharsPerRequest();
      if (baseText.length > maxChars) {
        const msg = `Der generierte Text ist zu lang für eine einzelne Audio-Datei (${baseText.length} Zeichen, Maximum ${maxChars}). Bitte kürze deinen Prompt oder wähle einen kürzeren Inhalt.`;
        await prisma.job.update({
          where: { id },
          data: { status: $Enums.JobStatus.FAILED, error: msg },
        });
        return jsonError(msg, 422);
      }

     const ttsText = isV3
  ? applyV3Prosody({
      preset: safePreset,
      text: baseText,     // ✅ korrekt für deine Signatur
      seed: job.id,
    })
  : baseText;

      console.log("[tts] v3 text preview:\n", ttsText.slice(0, 260));

      const { audio } = await elevenlabs.speak({
        text: ttsText,
        voiceId,
        modelId: process.env.ELEVENLABS_MODEL_ID ?? "eleven_v3",
        stability: 0.1,
        similarityBoost: 0.62,
        style: 0.25,
        useSpeakerBoost: true,
        
        preset: safePreset,
      });

      console.log("[tts] speak ms =", Date.now() - t0);

      const buf = Buffer.from(audio);

      // Dauer bestimmen (music-metadata)
      try {
        const { parseBuffer } = await import("music-metadata");
        const meta = await parseBuffer(buf, "audio/mpeg");
        if (meta.format.duration && Number.isFinite(meta.format.duration)) {
          detectedDuration = Math.round(meta.format.duration);
        }
      } catch {
        /* ignore */
      }

      // MP3 speichern (S3 oder lokal)
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
        return jsonError(msg, 500);
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "TTS failed";
    await prisma.job.update({
      where: { id },
      data: { status: $Enums.JobStatus.FAILED, error: msg },
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
      title: true,
      prompt: true,
      preset: true,
      createdAt: true,
    },
  });

  // Only update track durations in bulk for single-chunk jobs.
  // Multi-chunk jobs store per-chapter durations during TTS; overwriting with job.durationSec would corrupt them.
  if (!isMultiChunk && typeof nextDuration === "number") {
    await prisma.track.updateMany({
      where: { jobId: id },
      data: { durationSeconds: nextDuration },
    });
  }

  /* 👇 Single-chunk only: create/update the track record if missing.
     Multi-chunk jobs: tracks are fully managed by the upsert loop above. */
  if (!isMultiChunk) { try {
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
  } }
console.log("[SLEEP-STORY CHECK]", {
  jobId: job.id,
  preset: job.preset,
  voiceStyle: job.voiceStyle,
  voiceGender: job.voiceGender,
  modelId: process.env.ELEVENLABS_MODEL_ID,
});

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

  return jsonOk({ ...updated, kidsSafetyApplied }, 200);
}