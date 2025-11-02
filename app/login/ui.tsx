// app/login/ui.tsx
"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";

export default function LoginForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const callbackUrl = searchParams.get("callbackUrl") || "/account";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <main className="sv-auth">
      <div className="sv-auth__card">
        <p style={{ opacity: 0.6, fontSize: "0.8rem" }}>Willkommen zurück 👋</p>
        <h1 className="sv-auth__title">Bei SoftVibe anmelden</h1>

        <form
          className="sv-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr(null);
            setLoading(true);

            const res = await signIn("credentials", {
              redirect: false,
              email,
              password,
              callbackUrl,
            });

            setLoading(false);

            if (res?.error) {
              setErr(res.error);
              return;
            }

            // success → weiterleiten
            router.push(callbackUrl);
          }}
        >
          <div className="sv-form-row">
            <label className="sv-label" htmlFor="email">
              E-Mail
            </label>
            <input
              id="email"
              className="sv-input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="du@softvibe.app"
            />
          </div>

          <div className="sv-form-row">
            <label className="sv-label" htmlFor="password">
              Passwort
            </label>
            <input
              id="password"
              className="sv-input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {err ? <p className="sv-error">{err}</p> : null}

          <div className="sv-actions" style={{ justifyContent: "flex-end" }}>
            <button
              type="submit"
              className="sv-btn sv-btn--primary"
              disabled={loading}
            >
              {loading ? "Anmelden…" : "Anmelden"}
            </button>
          </div>
        </form>

        <p className="sv-help">
          Noch keinen Account?{" "}
          <a className="sv-link" href="/register">
            Registrieren
          </a>
        </p>
      </div>
    </main>
  );
}