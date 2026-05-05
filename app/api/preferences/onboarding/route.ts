// app/api/preferences/onboarding/route.ts
//
// POST /api/preferences/onboarding
// Accepts a free-form `answers` JSON blob from the iOS onboarding flow
// alongside an optional pre-mapped `derived` object that already follows the
// PreferencesUpsertSchema. Stores the raw answers (so we can re-derive later
// if the questionnaire schema evolves) and upserts the structured fields.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { jsonOk, jsonError, requireAuth, readJsonSafe } from "@/lib/api";
import { OnboardingSchema } from "@/lib/validation/preferences";
import { buildSummaryMarkdown, serializeProfileForClient } from "@/lib/preferences";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAuth();
  if (!auth) {
    return jsonError("UNAUTHORIZED", 401, { message: "Bitte einloggen." });
  }

  const raw = await readJsonSafe<Record<string, unknown>>(req);
  if (!raw || typeof raw !== "object") {
    return jsonError("BAD_REQUEST", 400, { message: "Ungültiger Body." });
  }

  const parsed = OnboardingSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", 400, {
      message: "Ungültige Eingabe.",
      issues: parsed.error.issues,
    });
  }
  const { answers, derived } = parsed.data;

  const merged = {
    primaryGoal: derived?.primaryGoal ?? null,
    preferredTone: derived?.preferredTone ?? null,
    pacing: derived?.pacing ?? null,
    preferredFormats: derived?.preferredFormats ?? [],
    likedThemes: derived?.likedThemes ?? [],
    dislikedThemes: derived?.dislikedThemes ?? [],
    voicePreference: derived?.voicePreference ?? null,
    directAddressPreference: derived?.directAddressPreference ?? null,
    contentBoundaries: derived?.contentBoundaries ?? [],
    emotionalContext: derived?.emotionalContext ?? null,
    desiredOutcome: derived?.desiredOutcome ?? null,
  };

  const summaryMarkdown = buildSummaryMarkdown(merged) || null;

  const onboardingAnswersJson = answers as Prisma.InputJsonValue;

  const saved = await prisma.userPreferenceProfile.upsert({
    where: { userId: auth.userId },
    create: {
      userId: auth.userId,
      ...merged,
      summaryMarkdown,
      onboardingAnswers: onboardingAnswersJson,
    },
    update: {
      ...merged,
      summaryMarkdown,
      onboardingAnswers: onboardingAnswersJson,
    },
  });

  return jsonOk(serializeProfileForClient(saved), 200);
}
