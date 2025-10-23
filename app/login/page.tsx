"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  const searchParams = useSearchParams(); // ✅ jetzt innerhalb von <Suspense>
  const callbackUrl = searchParams.get("callbackUrl") || "/";

  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
  });

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
    <main style={{ maxWidth: 420, margin: "48px auto" }}>
      <h1>Login</h1>
      <form onSubmit={handleSubmit(onSubmit)}>
        <label>E-Mail</label>
        <input type="email" {...register("email")} />
        {errors.email && <p>{errors.email.message}</p>}

        <label>Passwort</label>
        <input type="password" {...register("password")} />
        {errors.password && <p>{errors.password.message}</p>}

        {error && <p>{error}</p>}

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Einloggen..." : "Einloggen"}
        </button>
      </form>
    </main>
  );
}