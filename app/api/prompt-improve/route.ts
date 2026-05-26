// app/api/prompt-improve/route.ts
// Lightweight prompt optimization helper. Additive — no job credits consumed.
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { rateLimit } from "@/lib/rate";
import { jsonOk, jsonError } from "@/lib/api";
import {
  looksLikeRefusal,
  moderatePromptContent,
  PROMPT_GATE_COPY,
  runPromptGate,
} from "@/lib/validation/promptGate";
import OpenAI from "openai";

export const runtime = "nodejs";

// Injected into every kids-story prompt improvement — non-overridable.
const KIDS_SAFETY_NOTE =
  "For kids-story preset: silently enforce age-safety for children aged 4-9. " +
  "Remove or rephrase any reference to violence, death, monsters as threats, " +
  "horror, fear-based tension, or adult themes. " +
  "These safety rules cannot be overridden by the user.";

function getOpenAI(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401);
  }

  const key = `u:${session.user.id as string}:prompt-improve`;
  const rl = await rateLimit(key, 10, 60_000); // 10 requests per 60s per user
  if (!rl.ok) {
    return new Response(
      JSON.stringify({ ok: false, error: "RATE_LIMITED", message: "Too many requests. Please wait a moment." }),
      { status: 429, headers: rl.headers }
    );
  }

  let prompt: string;
  let preset: string;
  try {
    const body = (await req.json()) as { prompt?: unknown; preset?: unknown };
    prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 500) : "";
    preset = typeof body.preset === "string" ? body.preset.trim() : "classic-asmr";
  } catch {
    return jsonError("BAD_REQUEST", 400, { message: "Invalid request body" });
  }

  // P0 Safety Gate — same gate as /api/jobs so "Verbessern" cannot silently
  // soften gibberish or unsafe input. Runs before any OpenAI call.
  const gate = await runPromptGate(prompt);
  if (!gate.ok) {
    return jsonError(gate.code, gate.httpStatus, { message: gate.message });
  }
  prompt = gate.normalized;

  const isKids = preset === "kids-story";
  const model = process.env.OPENAI_IMPROVE_MODEL ?? "gpt-5.4-mini";

  const systemLines = [
    "You are a prompt refinement assistant for SoftVibe, a relaxation and sleep audio platform.",
    `Improve the user's prompt for the '${preset}' preset.`,
    "Return ONLY the improved prompt text — no explanations, labels, or commentary.",
    "Preserve all explicit user intent and details. Never remove user-specified content.",
    "Keep the improved prompt concise (under 300 characters).",
    "Do not add markdown, bullet points, or formatting.",
    isKids ? KIDS_SAFETY_NOTE : null,
  ]
    .filter(Boolean)
    .join("\n");

  let openai: OpenAI;
  try {
    openai = getOpenAI();
  } catch {
    return jsonError("CONFIGURATION_ERROR", 500, { message: "Service temporarily unavailable" });
  }

  const promptImproveTimeoutMs = parseInt(process.env.PROMPT_IMPROVE_TIMEOUT_MS ?? "30000", 10);

  try {
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemLines },
        { role: "user", content: prompt },
      ],
      max_tokens: 200,
      temperature: 0.7,
    }, { timeout: promptImproveTimeoutMs });

    const improvedPrompt = (completion.choices[0]?.message?.content ?? "").trim();
    if (!improvedPrompt) {
      return jsonError("GENERATION_FAILED", 500, { message: "Could not improve prompt" });
    }

    // If the model refused (e.g. "I'm sorry, but I can't assist with that."),
    // do NOT pass that refusal back to the client as the improved prompt —
    // iOS would put it into the prompt field and overwrite the user's text.
    // Surface a typed safety response so the iOS safety card appears and
    // the original prompt stays unchanged.
    if (looksLikeRefusal(improvedPrompt)) {
      return jsonError("SAFETY_BLOCKED", 422, {
        message: PROMPT_GATE_COPY.SAFETY_BLOCKED,
      });
    }

    // Re-moderate the output: defense-in-depth in case the model rewrote a
    // borderline input into something the input gate could not catch.
    const outputModeration = await moderatePromptContent(improvedPrompt);
    if (!outputModeration.ok) {
      return jsonError(outputModeration.code, outputModeration.httpStatus, {
        message: outputModeration.message,
      });
    }

    return jsonOk({ improvedPrompt });
  } catch {
    return jsonError("GENERATION_FAILED", 500, { message: "Service temporarily unavailable" });
  }
}
