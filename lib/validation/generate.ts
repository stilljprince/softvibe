// lib/validation/generate.ts
import { z } from "zod";

export const CreateJobSchema = z.object({
  title: z
    .string()
    .min(3, "Titel muss mindestens 3 Zeichen haben.")
    .max(140, "Titel darf max. 140 Zeichen haben."),
  prompt: z.string().min(3, "Prompt zu kurz"),
  preset: z.string().trim().min(1).optional().nullable(),
  durationSec: z
    .union([z.number(), z.string()])
    .optional()
    .nullable()
    .transform((v) => {
      if (v === null || v === undefined || v === "") return undefined;
      const n = typeof v === "string" ? Number(v) : v;
      return Number.isFinite(n) ? n : undefined;
    })
    .refine((v) => v === undefined || (Number.isInteger(v) && v >= 30 && v <= 1800), {
      message: "durationSec muss zwischen 30–1800 Sekunden liegen",
    }),
});