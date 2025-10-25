"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoginSchema, type LoginInput } from "@/lib/validation/auth";

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Lade Login…</div>}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams(); // ✅ innerhalb Suspense
  const callbackUrl = searchParams.get("callbackUrl") || "/";

  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(LoginSchema) });

  const onSubmit = async (values: LoginInput) => {
    setError(null);
    const res = await signIn("credentials", {
      redirect: false,
      email: values.email,
      password: values.password,
      callbackUrl,
    });

    if (res?.ok) {
      router.push(callbackUrl);
      router.refresh();
    } else {
      setError("E-Mail oder Passwort ist falsch.");
    }
  };

  return (
    <main className="sv-auth">
      <section className="sv-auth__card" aria-labelledby="login-title">
        <h1 id="login-title" className="sv-auth__title">Anmelden</h1>

        <form className="sv-form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="sv-form-row">
            <label className="sv-label">E-Mail</label>
            <input type="email" className="sv-input" {...register("email")} />
            {errors.email && <p className="sv-error">{errors.email.message}</p>}
          </div>

          <div className="sv-form-row">
            <label className="sv-label">Passwort</label>
            <input type="password" className="sv-input" {...register("password")} />
            {errors.password && <p className="sv-error">{errors.password.message}</p>}
          </div>

          {error && <p className="sv-error" role="alert">{error}</p>}

          <div className="sv-actions">
            <button type="submit" className="sv-btn sv-btn--primary" disabled={isSubmitting}>
              {isSubmitting ? "Einloggen…" : "Einloggen"}
            </button>
          </div>
        </form>

        <p className="sv-help">
          Noch kein Konto?{" "}
          <Link href="/register" className="sv-link">Registrieren</Link>
        </p>
      </section>
    </main>
  );
}