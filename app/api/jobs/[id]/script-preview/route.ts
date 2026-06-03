// app/api/jobs/[id]/script-preview/route.ts
//
// Admin-only endpoint: generates the script for a QUEUED job and returns it
// for inspection WITHOUT hitting ElevenLabs. Persists the result to
// job.scriptOverride so a subsequent /complete call uses this exact script.
//
// Guarantee: no TTS, no audio upload, no Track/Story records, no status change.

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { jsonOk, jsonError } from "@/lib/api";
import { buildScriptOpenAI } from "@/lib/script-builder-openai";
import { enforceKidsSafety } from "@/lib/script-builder";
import { resolveVoiceId } from "@/lib/tts/elevenlabs";
import { splitToChunksSafe, getMaxCharsPerRequest } from "@/lib/audio/chunks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mirrors wordTargetFor() wps constants from lib/script-builder-openai.ts.
// classic-asmr depends on voiceStyle; other presets ignore it.
function wpsForPreset(preset: string, voiceStyle?: "soft" | "whisper"): number {
  if (preset === "sleep-story") return 1.95;
  if (preset === "kids-story") return 1.85;
  if (preset === "classic-asmr") return voiceStyle === "whisper" ? 1.18 : 1.25;
  return 1.8; // meditation
}

// Mirrors stripTtsDirectives() from app/api/jobs/[id]/complete/route.ts
// Used here only to compute baseText for chunk splitting.
function stripTtsDirectives(input: string): string {
  let out = input;
  out = out.replace(/```[\s\S]*?```/g, "");
  out = out.replace(/^\s*(system|assistant|developer)\s*:\s*.*$/gim, "");
  out = out.replace(/^\s*\[(voice|style|tone|preset|instructions?)\]\s*:.*$/gim, "");
  out = out.replace(/^\s*(voice|style|tone|preset|instructions?)\s*:\s*.*$/gim, "");
  out = out.replace(/^\s*-{3,}\s*$/gm, "");
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return out.length > 0 ? out : input.trim();
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  // ── Auth ──────────────────────────────────────────────────────────────────
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401);
  }

  // isAdmin lives only in the DB, not the JWT — must check here
  const caller = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isAdmin: true },
  });
  if (!caller?.isAdmin) {
    return jsonError("Forbidden", 403);
  }

  // ── Job lookup ────────────────────────────────────────────────────────────
  const job = await prisma.job.findFirst({
    where: { id, userId: session.user.id },
    select: {
      id: true,
      status: true,
      prompt: true,
      preset: true,
      durationSec: true,
      language: true,
      voiceStyle: true,
      voiceGender: true,
    },
  });

  if (!job) {
    return jsonError("NOT_FOUND", 404);
  }

  if (job.status !== "QUEUED") {
    return jsonError("INVALID_STATE", 409, {
      message: `Job is ${job.status}. Script preview is only available for QUEUED jobs.`,
    });
  }

  // ── Script generation pipeline ────────────────────────────────────────────
  const safePreset =
    job.preset === "classic-asmr" ||
    job.preset === "sleep-story" ||
    job.preset === "meditation" ||
    job.preset === "kids-story"
      ? job.preset
      : "classic-asmr";

  const language: "de" | "en" = job.language === "en" ? "en" : "de";
  const isSleepStory = safePreset === "sleep-story";
  const isKidsStory = safePreset === "kids-story";

  // sleep-story and kids-story always use "soft" delivery regardless of the
  // stored job.voiceStyle, so the WPS target must match that effective style.
  const effectiveStyle: "soft" | "whisper" =
    isSleepStory || isKidsStory
      ? "soft"
      : job.voiceStyle === "whisper"
      ? "whisper"
      : "soft";

  let finalText: string;
  try {
    const out = await buildScriptOpenAI({
      preset: safePreset,
      userPrompt: (job.prompt ?? "").trim(),
      targetDurationSec:
        typeof job.durationSec === "number" ? job.durationSec : undefined,
      voiceStyle: effectiveStyle,
      language,
    });
    finalText = (out?.finalText ?? "").trim();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Script generation failed";
    return jsonError(msg, 500);
  }

  if (!finalText) {
    return jsonError("Script generation returned empty text", 500);
  }

  // Kids safety (mirrors complete route — repair-first mode for AI-generated scripts)
  if (isKidsStory) {
    const safeResult = enforceKidsSafety(finalText, { strict: false });
    if (!safeResult.safe) {
      return jsonError("CONTENT_SAFETY", 422, {
        message: "Story content did not pass kids safety check.",
      });
    }
    finalText = safeResult.text;
  }

  // ── Persist script to scriptOverride (no status change) ───────────────────
  // When /complete is called next, it reads scriptOverride and skips the writer.
  await prisma.job.update({
    where: { id },
    data: { scriptOverride: finalText },
  });

  // ── Compute preview metadata ───────────────────────────────────────────────
  const wordCount = finalText.split(/\s+/).filter(Boolean).length;

  const baseText = stripTtsDirectives(finalText);
  const baseTextWordCount = baseText.split(/\s+/).filter(Boolean).length;

  const maxChars = getMaxCharsPerRequest();
  const chunks = splitToChunksSafe(baseText, maxChars);
  const chunkCount = chunks.length;
  const chunkSizes = chunks.map((c) => c.length);
  const chunkWordCounts = chunks.map(
    (c) => c.split(/\s+/).filter(Boolean).length
  );

  // Voice resolution (sleep-story and kids-story always use "soft" style;
  // effectiveStyle was computed before generation so the WPS target matches).
  const effectiveGender: "female" | "male" =
    job.voiceGender === "male" ? "male" : "female";
  const voiceId = resolveVoiceId(safePreset, effectiveStyle, effectiveGender);

  // Estimated duration (word count / words-per-second for this preset)
  const wps = wpsForPreset(safePreset, effectiveStyle);
  const estimatedDurationSec = Math.round(wordCount / wps);

  // Warm-up text — injected at TTS time for sleep-story chapters 2+, not stored in script
  const warmupText =
    isSleepStory
      ? language === "en"
        ? "Softly, everything lay still and warm."
        : "Leise lag die Nacht um sie."
      : null;

  return jsonOk({
    script: finalText,
    wordCount,
    baseTextWordCount,
    chunkCount,
    chunkSizes,
    chunkWordCounts,
    estimatedDurationSec,
    voiceId,
    language,
    preset: safePreset,
    warmupText,
  });
}
