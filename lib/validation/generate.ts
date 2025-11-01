// lib/validation/generate.ts
import { z } from "zod";

export const CreateJobSchema = z.object({
  prompt: z.string().min(3, "Bitte gib mindestens 3 Zeichen ein."),
  preset: z.string().min(1, "Preset fehlt."),
  durationSec: z
    .number()
    .int()
    .min(30, "Mindestens 30 Sekunden.")
    .max(1800, "Maximal 30 Minuten.")
    .optional(),
});

export type CreateJobInput = z.infer<typeof CreateJobSchema>;