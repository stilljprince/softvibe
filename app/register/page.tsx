// app/register/page.tsx
"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { RegisterSchema, type RegisterInput } from "@/lib/validation/auth";

export default function RegisterPage() {
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(RegisterSchema),
  });

  const onSubmit = async (values: RegisterInput) => {
    setError(null);

    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error ?? "Registrierung fehlgeschlagen");
      return;
    }

    // Auto-Login und zurück auf die Landingpage "/"
    await signIn("credentials", {
      redirect: true,
      email: values.email,
      password: values.password,
      callbackUrl: "/",
    });
  };

  return (
    <main style={{ maxWidth: 420, margin: "48px auto" }}>
      <h1>Konto erstellen</h1>
      <form onSubmit={handleSubmit(onSubmit)}>
        <label>Name</label>
        <input type="text" {...register("name")} />
        {errors.name && <p>{errors.name.message}</p>}

        <label>E-Mail</label>
        <input type="email" {...register("email")} />
        {errors.email && <p>{errors.email.message}</p>}

        <label>Passwort</label>
        <input type="password" {...register("password")} />
        {errors.password && <p>{errors.password.message}</p>}

        {error && <p>{error}</p>}

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Erstelle Konto..." : "Registrieren"}
        </button>
      </form>
    </main>
  );
}
