import { z } from "zod";

export const CreateJobSchema = z.object({
  prompt: z.string().min(3, "Bitte gib einen Prompt mit mindestens 3 Zeichen ein."),
  preset: z.string().optional(),
});

export type CreateJobInput = z.infer<typeof CreateJobSchema>;