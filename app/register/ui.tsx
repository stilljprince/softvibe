// app/register/ui.tsx
"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import SVScene from "@/app/components/sv-scene";
import { useSVTheme, SVHeader } from "@/app/components/sv-kit";
import type React from "react";

export default function RegisterForm() {
  const router = useRouter();
  const { themeKey, themeCfg, cycleTheme, logoSrc } = useSVTheme();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // CSS custom properties supplied to the form so globals.css focus rules are theme-aware
  const formVars = {
    "--sv-auth-focus-border": themeCfg.primaryButtonBg,
    "--sv-auth-focus-ring": `${themeCfg.primaryButtonBg}33`,
    "--sv-auth-input-bg": themeCfg.secondaryButtonBg,
    "--sv-auth-input-color": themeCfg.uiText,
  } as React.CSSProperties;

  // Inline color styles applied directly to each input — no injection lag
  const inputColors: React.CSSProperties = {
    background: themeCfg.secondaryButtonBg,
    color: themeCfg.uiText,
    borderColor: themeCfg.cardBorder,
  };

  return (
    <SVScene theme={themeKey}>
      {/* Logo click cycles the theme — consistent with generate page */}
      <SVHeader
        variant="auth"
        logoSrc={logoSrc}
        onLogoClick={cycleTheme}
      />

      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "80px 24px 32px",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 440,
            borderRadius: 24,
            padding: "28px 28px 24px",
            background: themeCfg.cardBg,
            border: `1px solid ${themeCfg.cardBorder}`,
            boxShadow: themeCfg.cardShadow,
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
          }}
        >
          <p style={{ opacity: 0.55, fontSize: "0.8rem", color: themeCfg.uiSoftText, marginBottom: 4 }}>
            Schön, dass du da bist
          </p>
          <h1
            style={{
              fontSize: "clamp(1.25rem, 2.2vw, 1.5rem)",
              fontWeight: 800,
              margin: "0 0 20px",
              color: themeCfg.uiText,
            }}
          >
            SoftVibe Konto erstellen
          </h1>

          <form
            className="sv-form"
            style={formVars}
            onSubmit={async (e) => {
              e.preventDefault();
              setErr(null);
              setLoading(true);

              const res = await fetch("/api/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, email, password }),
              });

              if (!res.ok) {
                const data = await res.json().catch(() => null);
                setErr(
                  data?.error ?? "Registrierung fehlgeschlagen. Bitte später erneut versuchen."
                );
                setLoading(false);
                return;
              }

              const signInRes = await signIn("credentials", {
                redirect: false,
                email,
                password,
              });

              setLoading(false);

              if (signInRes?.error) {
                router.push("/login");
                return;
              }

              router.push("/account");
            }}
          >
            <div className="sv-form-row">
              <label className="sv-label" htmlFor="name" style={{ color: themeCfg.uiText }}>
                Name
              </label>
              <input
                id="name"
                className="sv-auth-input"
                style={inputColors}
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z. B. Justin"
              />
            </div>

            <div className="sv-form-row">
              <label className="sv-label" htmlFor="email" style={{ color: themeCfg.uiText }}>
                E-Mail
              </label>
              <input
                id="email"
                className="sv-auth-input"
                style={inputColors}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="du@softvibe.app"
              />
            </div>

            <div className="sv-form-row">
              <label className="sv-label" htmlFor="password" style={{ color: themeCfg.uiText }}>
                Passwort
              </label>
              <input
                id="password"
                className="sv-auth-input"
                style={inputColors}
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="mind. 6 Zeichen"
              />
            </div>

            {err && <p className="sv-error">{err}</p>}

            <div className="sv-actions" style={{ justifyContent: "flex-end" }}>
              <button
                type="submit"
                disabled={loading}
                style={{
                  background: themeCfg.primaryButtonBg,
                  color: themeCfg.primaryButtonText,
                  border: "none",
                  borderRadius: 999,
                  padding: "0.55rem 1.3rem",
                  fontWeight: 700,
                  fontSize: "0.88rem",
                  cursor: loading ? "default" : "pointer",
                  opacity: loading ? 0.65 : 1,
                  transition: "opacity .15s ease",
                }}
              >
                {loading ? "Wird erstellt…" : "Konto anlegen"}
              </button>
            </div>
          </form>

          <p className="sv-help" style={{ color: themeCfg.uiSoftText }}>
            Schon ein Konto?{" "}
            <a
              href="/login"
              style={{ color: themeCfg.primaryButtonBg, textDecoration: "none", fontWeight: 700 }}
            >
              Anmelden
            </a>
          </p>
        </div>
      </main>
    </SVScene>
  );
}
