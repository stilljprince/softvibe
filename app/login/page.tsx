"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import Image from "next/image";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (provider: "github" | "google") => {
    try {
      setLoading(true);
      setError(null);
      await signIn(provider, { callbackUrl: "/" });
    } catch (err) {
      console.error(err);
      setError("Fehler bei der Anmeldung. Bitte versuche es erneut.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-bg)",
        color: "var(--color-text)",
        padding: "2rem",
      }}
    >
      <div
        style={{
          background: "var(--color-card)",
          padding: "2rem 3rem",
          borderRadius: "16px",
          boxShadow: "0 6px 20px rgba(0,0,0,0.08)",
          maxWidth: "420px",
          width: "100%",
          textAlign: "center",
        }}
      >
        {/* Logo */}
        <div style={{ marginBottom: "1rem" }}>
          <Image
            src="/softvibe-logo-pastel.svg"
            alt="SoftVibe Logo"
            width={140}
            height={40}
          />
        </div>

        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, marginBottom: "1rem" }}>
          Willkommen zurück 👋
        </h1>
        <p style={{ marginBottom: "2rem", fontSize: "1rem", opacity: 0.8 }}>
          Melde dich an, um dein persönliches SoftVibe-Erlebnis zu starten.
        </p>

        {/* Login Buttons */}
        <button
          onClick={() => handleLogin("github")}
          disabled={loading}
          style={{
            width: "100%",
            padding: "0.75rem",
            borderRadius: "8px",
            background: "#24292e",
            color: "#fff",
            fontWeight: 600,
            border: "none",
            cursor: loading ? "not-allowed" : "pointer",
            marginBottom: "1rem",
            transition: "all 0.2s ease",
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget as HTMLButtonElement;
            if (!loading) el.style.filter = "brightness(90%)";
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLButtonElement;
            el.style.filter = "brightness(100%)";
          }}
        >
          {loading ? "Anmelden..." : "Mit GitHub anmelden"}
        </button>

        <button
          onClick={() => handleLogin("google")}
          disabled={loading}
          style={{
            width: "100%",
            padding: "0.75rem",
            borderRadius: "8px",
            background: "#db4437",
            color: "#fff",
            fontWeight: 600,
            border: "none",
            cursor: loading ? "not-allowed" : "pointer",
            marginBottom: "1rem",
            transition: "all 0.2s ease",
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget as HTMLButtonElement;
            if (!loading) el.style.filter = "brightness(90%)";
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLButtonElement;
            el.style.filter = "brightness(100%)";
          }}
        >
          {loading ? "Anmelden..." : "Mit Google anmelden"}
        </button>

        {/* Fehlermeldung */}
        {error && (
          <p style={{ color: "red", marginTop: "1rem", fontWeight: 500 }}>
            {error}
          </p>
        )}

        {/* Hinweis */}
        <p style={{ marginTop: "2rem", fontSize: "0.9rem", opacity: 0.7 }}>
          Mit deiner Anmeldung stimmst du unseren{" "}
          <a href="#" style={{ color: "var(--color-accent)" }}>
            Nutzungsbedingungen
          </a>{" "}
          und{" "}
          <a href="#" style={{ color: "var(--color-accent)" }}>
            Datenschutzrichtlinien
          </a>{" "}
          zu.
        </p>
      </div>
    </main>
  );
}