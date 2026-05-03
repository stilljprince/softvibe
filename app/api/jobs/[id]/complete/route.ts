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
        similarity_boost: 0.93, // High voice-locking for cross-chapter consistency (was 0.85)
        style: 0.03,            // Near-flat expressiveness to minimise chapter drift (was 0.20)
        use_speaker_boost: false,
      };
    case "meditation":
      return {
        stability: 0.4,
        similarity_boost: 0.9,
        style: 0.05, // Near-flat for breath-paced delivery (was 0.15)
        use_speaker_boost: false,
      };
    case "kids-story":
      return {
        stability: 0.65,
        similarity_boost: 0.92, // Slightly tighter voice-locking (was 0.90)
        style: 0.08,            // Warmer than sleep-story but still controlled (was 0.20)
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

// Strips the title line from sleep-story chapter 1 TTS input.
// The title line (required by the sleep-story prompt structure) is already
// displayed in the UI and adds no value when spoken by TTS. Reading it aloud
// creates a poor cold-start: the autoregressive v3 model warms up on a
// whispered standalone title rather than on real narrative content.
//
// Detection criteria (all must match):
//   - First non-empty line of the chunk
//   - Short (≤ 70 chars, typical title length)
//   - Does NOT end with sentence-ending punctuation (. ! ? , ; :)
//   - Followed immediately by a blank line (own paragraph — not a subtitle/heading)
//
// Returns original text unchanged if no title line is detected.
function stripSleepStoryTitleLine(text: string): string {
  const lines = text.split("\n");
  let firstIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length > 0) { firstIdx = i; break; }
  }
  if (firstIdx < 0) return text;

  const candidate = lines[firstIdx].trim();
  if (candidate.length > 70) return text;
  if (/[.!?,;:]$/.test(candidate)) return text;

  // Must be followed by a blank line (own standalone paragraph)
  const nextLine = lines[firstIdx + 1];
  if (nextLine === undefined || nextLine.trim().length > 0) return text;

  // Strip the title line and any immediately following blank lines
  return lines.slice(firstIdx + 1).join("\n").trimStart();
}

// Softens the first sentence of a sleep-story chapter for TTS v3 stability.
//
// v3's voice mode locks in during the first few tokens. A long, complex opening
// sentence forces it to predict a wide intonation arc before stabilising,
// causing quality wobbles in the first 2-3 seconds of each chapter.
//
// Splits an overly long first sentence (>16 words) at the first coordinating
// conjunction (", and/but/so/yet" — also German ", und/aber/doch") into two
// shorter, independent sentences. Only the first sentence is processed;
// the rest of the chapter is left untouched to preserve natural pacing.
function softenChapterOpening(text: string, wordLimit = 16): string {

  // Find first sentence-ending char (.!?) followed by whitespace or end-of-string.
  let end = -1;
  for (let i = 0; i < text.length; i++) {
    if (".!?".includes(text[i]) && (i === text.length - 1 || /[\s\n]/.test(text[i + 1]))) {
      end = i;
      break;
    }
  }
  if (end < 0) return text;

  const wsLen = text.match(/^\s*/)?.[0].length ?? 0;
  const sentence = text.slice(wsLen, end + 1);
  if (sentence.split(/\s+/).length <= wordLimit) return text;

  // Match the first coordinating conjunction preceded by a comma.
  // .{15,}? ensures at least 15 chars before the split (avoids tiny fragments).
  const m = sentence.match(/^(.{15,}?),\s+(and|but|so|yet|und|aber|doch)\s+(.+)$/i);
  if (!m) return text;

  const before = m[1].trim();
  const after = m[3].trim();
  if (before.split(/\s+/).length < 4 || after.split(/\s+/).length < 4) return text;

  const bDone = /[.!?]$/.test(before) ? before : before + ".";
  const aCap = after.charAt(0).toUpperCase() + after.slice(1);
  return text.slice(0, wsLen) + bDone + "\n" + aCap + text.slice(end + 1);
}

// Appends a soft trailing ellipsis to non-final chapters so the TTS model
// produces a suspended landing rather than a hard stop. Prevents audible
// clicks and the "end of thought" quality at chapter boundaries.
function withSoftEnding(text: string): string {
  const t = text.trimEnd();
  if (t.endsWith("…") || t.endsWith("...")) return text;
  if (t.endsWith(".") || t.endsWith("!") || t.endsWith("?")) return t.slice(0, -1) + "…";
  return t + "…";
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
  const rl = await rateLimit(key, 10, 60_000);
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
      scriptOverride: true,
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

  // Atomic lock: transition QUEUED → PROCESSING before any external API call.
  // Only one request per job can succeed this update. Any concurrent request
  // that sees count === 0 exits immediately — preventing duplicate OpenAI /
  // ElevenLabs calls and race conditions on DB writes.
  {
    const lock = await prisma.job.updateMany({
      where: { id, userId: session.user.id as string, status: $Enums.JobStatus.QUEUED },
      data: { status: $Enums.JobStatus.PROCESSING },
    });

    if (lock.count === 0) {
      // Job is already PROCESSING (concurrent request holds the lock),
      // DONE, or FAILED. Return current state; client polls for final result.
      const current = await prisma.job.findFirst({
        where: { id, userId: session.user.id as string },
        select: {
          id: true, status: true, resultUrl: true, title: true,
          prompt: true, preset: true, durationSec: true, createdAt: true,
        },
      });
      addDebugLog({
        ts: new Date().toISOString(),
        level: "info",
        route: "/api/jobs/[id]/complete POST",
        userId: session.user.id as string,
        message: "Lock not acquired — already processing or in terminal state",
        data: { id, currentStatus: current?.status },
        reqId,
      });
      return jsonOk(current ?? job, 200);
    }
  }

  // ─── Credit refund state ──────────────────────────────────────────────────
  //
  // Business rule: 1 credit was debited atomically at POST /api/jobs creation.
  // We refund it when /complete fails BEFORE ElevenLabs TTS has been called —
  // i.e. the user never received any audio. Once TTS has started (even if it
  // partially fails), no automatic refund is issued because compute cost was
  // already incurred.
  //
  // Idempotency mechanism:
  //   • Job.ttsStartedAt is written to the DB immediately before the first
  //     elevenlabs.speak() call (not an in-memory flag — survives crashes).
  //   • Job.creditRefundedAt is set atomically inside a prisma.$transaction
  //     guarded by WHERE creditRefundedAt IS NULL AND ttsStartedAt IS NULL.
  //     Only one execution ever wins that gate, even across concurrent calls.
  //   • The QUEUED→PROCESSING lock above ensures only one /complete call per
  //     job reaches this code section. The DB gate is an additional belt-and-
  //     suspenders guard that survives function restarts and future code changes.
  //
  // Admins bypass the credit debit at job creation; they are excluded entirely.
  const dbUser = await prisma.user.findFirst({
    where: { id: session.user.id as string },
    select: { isAdmin: true },
  });
  const callerIsAdmin = dbUser?.isAdmin ?? false;

  /**
   * Attempt to refund 1 credit for a pre-TTS failure.
   *
   * Uses an atomic DB transaction:
   *   1. Claim the refund slot by setting Job.creditRefundedAt (only succeeds
   *      if both creditRefundedAt IS NULL and ttsStartedAt IS NULL).
   *   2. If the claim succeeds, increment User.credits by 1.
   *
   * This ensures at most one refund per job, regardless of concurrency or retries.
   * Admin calls are short-circuited before the DB round-trip.
   */
  const tryRefundCredit = async (reason: string): Promise<void> => {
    if (callerIsAdmin) return; // admins are never debited
    try {
      const refunded = await prisma.$transaction(async (tx) => {
        // Atomically claim the refund slot. The WHERE guard is the idempotency key:
        //   creditRefundedAt IS NULL → not already refunded
        //   ttsStartedAt IS NULL     → TTS was never started (no audio rendered)
        const claim = await tx.job.updateMany({
          where: { id, creditRefundedAt: null, ttsStartedAt: null },
          data: { creditRefundedAt: new Date() },
        });
        if (claim.count === 0) return false; // already refunded, or TTS had started

        await tx.user.update({
          where: { id: session.user.id as string },
          data: { credits: { increment: 1 } },
        });
        return true;
      });

      addDebugLog({
        ts: new Date().toISOString(),
        level: "info",
        route: "/api/jobs/[id]/complete POST",
        userId: session.user.id as string,
        message: refunded
          ? `Credit refunded: ${reason}`
          : `Credit refund skipped — already refunded or TTS had started (${reason})`,
        data: { id },
        reqId,
      });
    } catch (refundErr) {
      // Never let a refund failure block the error response returned to the client.
      addDebugLog({
        ts: new Date().toISOString(),
        level: "error",
        route: "/api/jobs/[id]/complete POST",
        userId: session.user.id as string,
        message: "Credit refund transaction failed",
        data: { id, error: String(refundErr) },
        reqId,
      });
    }
  };
  // ─────────────────────────────────────────────────────────────────────────

  let nextResultUrl = body.resultUrl ?? null;
  let detectedDuration: number | undefined;
  let kidsSafetyApplied = false;
  let isMultiChunk = false;
  let completedStoryId: string | null = null;
  let completedChapterCount = 0;
  let capturedScript = "";

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

if (job.scriptOverride && job.scriptOverride.trim() !== "") {
  // Script-override path: use user-provided script directly, skip AI generation.
  // Kids safety and stripTtsDirectives still run below.
  finalText = job.scriptOverride.trim();
} else if (SMOKE_BYPASS_SCRIPT_BUILDER) {
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
    // TTS never started — refund the credit
    await tryRefundCredit("empty script text");
    return jsonError(msg, 500);
  }

  // Non-overridable kids safety post-check
  // Strict mode (block-first, no repair) when the user supplied their own script.
  // Standard mode (repair-first) for AI-generated scripts.
  if (isKidsStory) {
    const isUserEditedScript = !!(job.scriptOverride?.trim());
    const safeResult = enforceKidsSafety(finalText, { strict: isUserEditedScript });
    if (!safeResult.safe) {
      const safetyMsg = isUserEditedScript
        ? "Dein Script enthält Inhalte, die für Kindergeschichten nicht erlaubt sind. Bitte überarbeite den Text."
        : "Story content did not pass safety check after repair attempt.";
      await prisma.job.update({
        where: { id },
        data: { status: $Enums.JobStatus.FAILED, error: safetyMsg },
      });
      // TTS never started — refund the credit so the user can correct and retry
      await tryRefundCredit("content safety rejection (pre-TTS)");
      return jsonError("CONTENT_SAFETY", 422, { message: safetyMsg });
    }
    kidsSafetyApplied = safeResult.text !== finalText;
    finalText = safeResult.text;
  }

  capturedScript = finalText;

  // ✅ TTS-Basistext
  const baseText = stripTtsDirectives(finalText);
  if (isSleepStory) {
    console.log("[DURATION-DEBUG] baseTextWordCount=", baseText.split(/\s+/).filter(Boolean).length);
  }

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
            scriptText: finalText || null,
          },
          select: { id: true },
        });
        storyId = story.id;
      }

      completedStoryId = storyId;
      completedChapterCount = chunks.length;

      console.log("[multi-chunk] preset =", safePreset, "chunks =", chunks.length);
      if (isSleepStory) {
        console.log("[DURATION-DEBUG] chunkWordCounts=", chunks.map((c, i) => `ch${i + 1}:${c.split(/\s+/).filter(Boolean).length}w`).join(" "));
      }

      // Hoist music-metadata import outside the loop — module is cached after first load.
      const { parseBuffer } = await import("music-metadata");
      let totalRenderedSec = 0;

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
          const isLastChapter = partIndex === chunks.length - 1;
          // Apply soft trailing ellipsis on non-final chapters to prevent hard stops
          // and audio artifacts at chapter boundaries.
          let chunkText = isLastChapter ? partBase : withSoftEnding(partBase);

          // Sleep story chapter 1: strip the spoken title line before TTS.
          // The title is already shown in the UI; reading it aloud creates a poor
          // cold-start where v3 warms up on a whispered standalone title instead
          // of real narrative content. Only applied to partIndex 0.
          if (isSleepStory && partIndex === 0) {
            chunkText = stripSleepStoryTitleLine(chunkText);
          }

          // Sleep story: shorten long opening sentences so v3 gets a clean,
          // short first utterance to lock its voice mode on.
          if (isSleepStory) {
            chunkText = softenChapterOpening(chunkText);
          }

          // Sleep story chapters 2+: story-consistent voice-lock warmup.
          // 1) More aggressive sentence splitting (10-word limit vs standard 16)
          //    so the first real sentence is short enough to stay in v3's voice lock.
          // 2) Short, natural, narrative-tone sentence for v3 to stabilise on.
          //    No meta-language about speaking or narration.
          // 3) Joined with \n (not \n\n) so warmup and first real sentence share
          //    the same prosody paragraph — no voice mode re-evaluation.
          if (isSleepStory && partIndex > 0) {
            chunkText = softenChapterOpening(chunkText, 10);
            const warmup = language === "en"
              ? "Softly, everything lay still and warm."
              : "Leise lag die Nacht um sie.";
            chunkText = warmup + "\n" + chunkText;
          }

          let ttsTextPart = isV3
            ? applyV3Prosody({
                preset: safePreset,
                text: chunkText,
                seed: job.id,         // Consistent seed across all chapters of the same story
                chapterIndex: partIndex,
              })
            : chunkText;

          // Final enforcement: guarantee non-final chapters end with a soft
          // continuation marker regardless of what earlier passes produced.
          // Prevents end-of-chapter clicks from hard sentence-stop landings.
          if (!isLastChapter) {
            const t = ttsTextPart.trimEnd();
            if (!t.endsWith("…") && !t.endsWith("...")) {
              ttsTextPart = /[.!?]$/.test(t) ? t.slice(0, -1) + "…" : t + "…";
            }
          }

          // Persist ttsStartedAt on the first chunk only (partIndex === 0).
          // Writing to DB instead of using an in-memory flag means this survives
          // a serverless function crash — the stale-recovery path can read it.
          if (partIndex === 0) {
            await prisma.job.update({
              where: { id },
              data: { ttsStartedAt: new Date() },
            });
          }
          const { audio } = await elevenlabs.speak({
            text: ttsTextPart,
            voiceId,
            modelId: process.env.ELEVENLABS_MODEL_ID ?? "eleven_v3",
            stability: voiceSettings.stability,
            similarityBoost: voiceSettings.similarity_boost,
            style: voiceSettings.style,
            useSpeakerBoost: voiceSettings.use_speaker_boost,
            preset: safePreset,
          });

          const buf = Buffer.from(audio);

          try {
            const meta = await parseBuffer(buf, "audio/mpeg");
            if (meta.format.duration && Number.isFinite(meta.format.duration)) {
              partDuration = Math.round(meta.format.duration);
            }
          } catch {
            /* ignore */
          }
          if (isSleepStory) {
            if (partDuration !== null) totalRenderedSec += partDuration;
            const chunkWords = partBase.split(/\s+/).filter(Boolean).length;
            console.log("[DURATION-DEBUG] ch" + (partIndex + 1) + " rendered=" + (partDuration ?? "?") + "s words=" + chunkWords + " wps=" + (partDuration ? (chunkWords / partDuration).toFixed(2) : "?"));
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
      if (isSleepStory) {
        const fullWordCount = chunks.reduce((sum, c) => sum + c.split(/\s+/).filter(Boolean).length, 0);
        console.log("[DURATION-DEBUG] SUMMARY requestedSec=" + (job.durationSec ?? "?") + " totalRendered=" + totalRenderedSec + "s totalWords=" + fullWordCount + " effectiveWPS=" + (totalRenderedSec > 0 ? (fullWordCount / totalRenderedSec).toFixed(2) : "N/A"));
      }

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
        // TTS never started — refund the credit
        await tryRefundCredit("script too long for single-chunk TTS");
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

      // Persist ttsStartedAt before the ElevenLabs call.
      // DB write instead of in-memory flag — survives serverless function crashes.
      await prisma.job.update({
        where: { id },
        data: { ttsStartedAt: new Date() },
      });
      const { audio } = await elevenlabs.speak({
        text: ttsText,
        voiceId,
        modelId: process.env.ELEVENLABS_MODEL_ID ?? "eleven_v3",
        stability: voiceSettings.stability,
        similarityBoost: voiceSettings.similarity_boost,
        style: voiceSettings.style,
        useSpeakerBoost: voiceSettings.use_speaker_boost,
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
    // Only refund if TTS had not started yet (e.g. OpenAI failure, voiceId error,
    // or exception thrown before the first elevenlabs.speak() call)
    await tryRefundCredit("exception before or during pre-TTS setup");
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
            scriptText: capturedScript || null,
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

  return jsonOk({ ...updated, storyId: completedStoryId, chapterCount: completedChapterCount, kidsSafetyApplied }, 200);
}