// app/register/ui.tsx
"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function RegisterForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <main className="sv-auth">
      <div className="sv-auth__card">
        <p style={{ opacity: 0.6, fontSize: "0.8rem" }}>Schön, dass du da bist ✨</p>
        <h1 className="sv-auth__title">SoftVibe Konto erstellen</h1>

        <form
          className="sv-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr(null);
            setLoading(true);

            // 1) zuerst in unserer eigenen API registrieren
            const res = await fetch("/api/register", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name,
                email,
                password,
              }),
            });

            if (!res.ok) {
              const data = await res.json().catch(() => null);
              setErr(
                data?.error ?? "Registrierung fehlgeschlagen. Bitte später erneut versuchen."
              );
              setLoading(false);
              return;
            }

            // 2) direkt automatisch einloggen
            const signInRes = await signIn("credentials", {
              redirect: false,
              email,
              password,
            });

            setLoading(false);

            if (signInRes?.error) {
              // fallback: zur Loginseite
              router.push("/login");
              return;
            }

            // success: ab ins Konto
            router.push("/account");
          }}
        >
          <div className="sv-form-row">
            <label className="sv-label" htmlFor="name">
              Name
            </label>
            <input
              id="name"
              className="sv-input"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Justin"
            />
          </div>

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
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="mind. 6 Zeichen"
            />
          </div>

          {err ? <p className="sv-error">{err}</p> : null}

          <div className="sv-actions" style={{ justifyContent: "flex-end" }}>
            <button
              type="submit"
              className="sv-btn sv-btn--primary"
              disabled={loading}
            >
              {loading ? "Wird erstellt…" : "Konto anlegen"}
            </button>
          </div>
        </form>

        <p className="sv-help">
          Schon ein Konto?{" "}
          <a className="sv-link" href="/login">
            Anmelden
          </a>
        </p>
      </div>
    </main>
  );
}