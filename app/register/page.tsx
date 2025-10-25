"use client";

import Link from "next/link";
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
  } = useForm<RegisterInput>({ resolver: zodResolver(RegisterSchema) });

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

    // Auto-Login & zurück auf die Landingpage
    await signIn("credentials", {
      redirect: true,
      email: values.email,
      password: values.password,
      callbackUrl: "/",
    });
  };

  return (
    <main className="sv-auth">
      <section className="sv-auth__card" aria-labelledby="register-title">
        <h1 id="register-title" className="sv-auth__title">Konto erstellen</h1>

        <form className="sv-form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="sv-form-row">
            <label className="sv-label">Name</label>
            <input type="text" className="sv-input" {...register("name")} />
            {errors.name && <p className="sv-error">{errors.name.message}</p>}
          </div>

          <div className="sv-form-row">
            <label className="sv-label">E-Mail</label>
            <input type="email" className="sv-input" {...register("email")} />
            {errors.email && <p className="sv-error">{errors.email.message}</p>}
          </div>

          <div className="sv-form-row">
            <label className="sv-label">Passwort</label>
            <input type="password" className="sv-input" {...register("password")} />
            <p className="sv-help">Mind. 8 Zeichen, möglichst sicher.</p>
            {errors.password && <p className="sv-error">{errors.password.message}</p>}
          </div>

          {error && <p className="sv-error" role="alert">{error}</p>}

          <div className="sv-actions">
            <button type="submit" className="sv-btn sv-btn--primary" disabled={isSubmitting}>
              {isSubmitting ? "Erstelle Konto…" : "Registrieren"}
            </button>
          </div>
        </form>

        <p className="sv-help">
          Bereits ein Konto?{" "}
          <Link href="/login" className="sv-link">Anmelden</Link>
        </p>
      </section>
    </main>
  );
}
