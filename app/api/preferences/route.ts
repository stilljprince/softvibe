// app/api/preferences/route.ts
//
// Read + upsert the authenticated user's preference profile.
// GET  /api/preferences           -> returns the profile (or empty defaults)
// PUT  /api/preferences           -> partial upsert of structured fields
//                                    (server re-derives summaryMarkdown)
//
// Auth: requireAuth() — the user can only read/write their own profile.
// Privacy: profile is never exposed publicly.

import { prisma } from "@/lib/prisma";
import { jsonOk, jsonError, requireAuth, readJsonSafe } from "@/lib/api";
import { PreferencesUpsertSchema } from "@/lib/validation/preferences";
import { buildSummaryMarkdown, serializeProfileForClient } from "@/lib/preferences";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const auth = await requireAuth();
  if (!auth) {
    return jsonError("UNAUTHORIZED", 401, { message: "Bitte einloggen." });
  }

  const profile = await prisma.userPreferenceProfile.findUnique({
    where: { userId: auth.userId },
  });

  return jsonOk(serializeProfileForClient(profile), 200);
}

export async function PUT(req: Request): Promise<Response> {
  const auth = await requireAuth();
  if (!auth) {
    return jsonError("UNAUTHORIZED", 401, { message: "Bitte einloggen." });
  }

  const raw = await readJsonSafe<Record<string, unknown>>(req);
  if (!raw || typeof raw !== "object") {
    return jsonError("BAD_REQUEST", 400, { message: "Ungültiger Body." });
  }

  const parsed = PreferencesUpsertSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", 400, {
      message: "Ungültige Eingabe.",
      issues: parsed.error.issues,
    });
  }
  const input = parsed.data;

  // Build a partial update record by only including provided fields.
  const update: Record<string, unknown> = {};
  if (input.primaryGoal !== undefined) update.primaryGoal = input.primaryGoal;
  if (input.preferredTone !== undefined) update.preferredTone = input.preferredTone;
  if (input.pacing !== undefined) update.pacing = input.pacing;
  if (input.preferredFormats !== undefined) update.preferredFormats = input.preferredFormats;
  if (input.likedThemes !== undefined) update.likedThemes = input.likedThemes;
  if (input.dislikedThemes !== undefined) update.dislikedThemes = input.dislikedThemes;
  if (input.voicePreference !== undefined) update.voicePreference = input.voicePreference;
  if (input.directAddressPreference !== undefined) {
    update.directAddressPreference = input.directAddressPreference;
  }
  if (input.contentBoundaries !== undefined) update.contentBoundaries = input.contentBoundaries;
  if (input.emotionalContext !== undefined) update.emotionalContext = input.emotionalContext;
  if (input.desiredOutcome !== undefined) update.desiredOutcome = input.desiredOutcome;

  // Pull the existing row so we can re-derive a fresh summaryMarkdown from the
  // merged structured fields. (Single round-trip with the upsert below.)
  const existing = await prisma.userPreferenceProfile.findUnique({
    where: { userId: auth.userId },
  });

  const merged = {
    primaryGoal: (update.primaryGoal as string | null | undefined) ?? existing?.primaryGoal ?? null,
    preferredTone:
      (update.preferredTone as string | null | undefined) ?? existing?.preferredTone ?? null,
    pacing: (update.pacing as string | null | undefined) ?? existing?.pacing ?? null,
    preferredFormats:
      (update.preferredFormats as string[] | undefined) ?? existing?.preferredFormats ?? [],
    likedThemes: (update.likedThemes as string[] | undefined) ?? existing?.likedThemes ?? [],
    dislikedThemes:
      (update.dislikedThemes as string[] | undefined) ?? existing?.dislikedThemes ?? [],
    voicePreference:
      (update.voicePreference as string | null | undefined) ?? existing?.voicePreference ?? null,
    directAddressPreference:
      (update.directAddressPreference as string | null | undefined) ??
      existing?.directAddressPreference ??
      null,
    contentBoundaries:
      (update.contentBoundaries as string[] | undefined) ?? existing?.contentBoundaries ?? [],
    emotionalContext:
      (update.emotionalContext as string | null | undefined) ?? existing?.emotionalContext ?? null,
    desiredOutcome:
      (update.desiredOutcome as string | null | undefined) ?? existing?.desiredOutcome ?? null,
  };

  const summaryMarkdown = buildSummaryMarkdown(merged) || null;
  update.summaryMarkdown = summaryMarkdown;

  const saved = await prisma.userPreferenceProfile.upsert({
    where: { userId: auth.userId },
    create: {
      userId: auth.userId,
      primaryGoal: merged.primaryGoal,
      preferredTone: merged.preferredTone,
      pacing: merged.pacing,
      preferredFormats: merged.preferredFormats,
      likedThemes: merged.likedThemes,
      dislikedThemes: merged.dislikedThemes,
      voicePreference: merged.voicePreference,
      directAddressPreference: merged.directAddressPreference,
      contentBoundaries: merged.contentBoundaries,
      emotionalContext: merged.emotionalContext,
      desiredOutcome: merged.desiredOutcome,
      summaryMarkdown,
    },
    update,
  });

  return jsonOk(serializeProfileForClient(saved), 200);
}
