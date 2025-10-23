// lib/validation/auth.ts
import { z } from "zod";

export const RegisterSchema = z.object({
  name: z.string().min(1, "Bitte Name eingeben").max(50),
  email: z.string().email(),
  password: z.string().min(6, "Mind. 6 Zeichen"),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Bitte Passwort eingeben"),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
