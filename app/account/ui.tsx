// app/account/ui.tsx
"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type React from "react";

type AccountUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
};

type JobStatus = "QUEUED" | "PROCESSING" | "DONE" | "FAILED";

type Job = {
  id: string;
  prompt?: string | null;
  preset?: string | null;
  status: JobStatus;
  resultUrl?: string | null;
  createdAt?: string;
  durationSec?: number | null;
};

type Theme = "light" | "dark" | "pastel";

export default function AccountClient({ user }: { user: AccountUser }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);

  // ===== Theme wie Landing =====
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    const saved = (localStorage.getItem("theme") as Theme | null) ?? "light";
    document.documentElement.className = saved;
    setTheme(saved);
  }, []);
  useEffect(() => {
    document.documentElement.className = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);
  const nextTheme: Record<Theme, Theme> = {
    light: "dark",
    dark: "pastel",
    pastel: "light",
  };
  const getThemeIcon = () => {
    if (theme === "light") return "🌞";
    if (theme === "dark") return "🌙";
    return "🎨";
  };
  const handleToggleTheme = () => setTheme(nextTheme[theme]);
  const getLogo = () => {
    if (theme === "light") return "/softvibe-logo-light.svg";
    if (theme === "dark") return "/softvibe-logo-dark.svg";
    return "/softvibe-logo-pastel.svg";
  };

  // ===== letzte 5 Jobs =====
  useEffect(() => {
    const load = async () => {
      setLoadingJobs(true);
      const res = await fetch("/api/jobs?take=5");
      if (res.ok) {
        const data: Job[] = await res.json();
        setJobs(data);
      }
      setLoadingJobs(false);
    };
    void load();
  }, []);

  const initials =
    user.name
      ?.split(" ")
      .map((p) => p[0])
      .join("")
      .toUpperCase() || "SV";

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--color-bg)",
        paddingTop: "64px",
      }}
    >
      {/* ===== Header wie Landing ===== */}
      <header
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0.6rem 1.5rem",
          background: "color-mix(in oklab, var(--color-bg) 90%, transparent)",
          backdropFilter: "blur(10px)",
        }}
      >
        <div style={{ flex: "0 0 auto" }}>
          <Image src={getLogo()} alt="SoftVibe Logo" width={160} height={50} priority />
        </div>

        <nav
          className="desktop-nav"
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            display: "flex",
            gap: "1rem",
          }}
        >
          <Link href="/#features" style={navLinkStyle}>
            Features
          </Link>
          <Link href="/#about" style={navLinkStyle}>
            Über uns
          </Link>
          <Link href="/#contact" style={navLinkStyle}>
            Kontakt
          </Link>
          <Link href="/" style={navLinkStyle}>
            Startseite
          </Link>
        </nav>

        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button
            onClick={handleToggleTheme}
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: "var(--color-button-bg)",
              color: "var(--color-button-text)",
              border: "none",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              fontSize: "1.25rem",
            }}
            aria-label="Theme wechseln"
            title="Theme wechseln"
          >
            {getThemeIcon()}
          </button>

          <form action="/api/auth/signout" method="post">
            <button
              type="submit"
              style={{
                background: "var(--color-accent)",
                color: "#fff",
                border: "none",
                borderRadius: 999,
                padding: "0.4rem 0.9rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Logout
            </button>
          </form>
        </div>

        <style jsx>{`
          @media (max-width: 880px) {
            .desktop-nav {
              display: none !important;
            }
          }
        `}</style>
      </header>

      {/* ===== Inhalt: breit ===== */}
      <div
        style={{
          width: "100%",
          maxWidth: "min(1650px, 100vw - 1.5rem)",
          margin: "1.5rem auto 0",
          paddingBottom: "3rem",
        }}
      >
        <div
          style={{
            width: "100%",
            background: "var(--color-card)",
            border: "1px solid var(--color-nav-bg)",
            borderRadius: 20,
            boxShadow: "0 14px 30px rgba(0,0,0,0.035)",
            overflow: "hidden",
            display: "grid",
            gridTemplateColumns: "0.35fr 0.65fr",
            gap: 0,
          }}
        >
          {/* ===== linke Spalte ===== */}
          <div
            style={{
              padding: "1.25rem 1.5rem 1.5rem",
              background:
                "linear-gradient(160deg, color-mix(in oklab, var(--color-accent) 16%, var(--color-card)) 0%, var(--color-card) 70%)",
            }}
          >
            <div style={{ display: "flex", gap: "1rem", alignItems: "center", marginBottom: "1rem" }}>
              <div>
                {user.image ? (
                  <Image
                    src={user.image}
                    alt={user.name}
                    width={70}
                    height={70}
                    style={{
                      borderRadius: "999px",
                      objectFit: "cover",
                      border: "3px solid rgba(255,255,255,0.5)",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 70,
                      height: 70,
                      borderRadius: "999px",
                      background: "rgba(0,0,0,0.12)",
                      border: "3px solid rgba(255,255,255,0.5)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                      fontWeight: 700,
                      fontSize: "1.2rem",
                    }}
                  >
                    {initials}
                  </div>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: "0.7rem", opacity: 0.7, marginBottom: 3 }}>
                  Dein SoftVibe-Konto
                </p>
                <h1 style={{ fontSize: "1.25rem", fontWeight: 700, lineHeight: 1.05 }}>
                  {user.name}
                </h1>
                <p style={{ opacity: 0.9, overflowWrap: "anywhere" }}>{user.email}</p>
              </div>
            </div>

            <section>
              <h2
                style={{
                  fontSize: "0.9rem",
                  fontWeight: 700,
                  marginBottom: "0.5rem",
                }}
              >
                Persönliche Daten
              </h2>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr",
                  gap: "0.6rem",
                }}
              >
                <Field label="Name" value={user.name} />
                <Field label="E-Mail" value={user.email} mono />
                <Field label="User-ID" value={user.id} mono />
              </div>
            </section>
          </div>

          {/* ===== rechte Spalte – mit Verlauf 10% ===== */}
          <div
            style={{
              padding: "1.25rem 1.5rem 1.5rem",
              background:
                "linear-gradient(160deg, color-mix(in oklab, var(--color-accent) 10%, var(--color-card)) 0%, var(--color-card) 70%)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "1rem",
                marginBottom: "0.75rem",
              }}
            >
              <h2 style={{ fontSize: "1rem", fontWeight: 700 }}>
                Deine letzten Generierungen
              </h2>
              <Link
                href="/generate"
                style={{
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  color: "var(--color-accent)",
                  textDecoration: "none",
                }}
              >
                neue Generierung →
              </Link>
            </div>

            {loadingJobs ? (
              <p style={{ opacity: 0.6, fontSize: "0.85rem" }}>Lade…</p>
            ) : jobs.length === 0 ? (
              <p style={{ opacity: 0.6, fontSize: "0.85rem" }}>
                Noch keine Generierungen. Erstelle eine über „Generieren“.
              </p>
            ) : (
              <ul
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.6rem",
                }}
              >
                {jobs.map((job) => (
                  <li
                    key={job.id}
                    style={{
                      background:
                        "color-mix(in oklab, var(--color-card) 95%, var(--color-bg))",
                      border: "1px solid rgba(0,0,0,0.018)",
                      borderRadius: 12,
                      padding: "0.7rem 0.75rem 0.6rem",
                      display: "flex",
                      gap: "0.75rem",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          overflowWrap: "anywhere",
                          wordBreak: "break-word",
                        }}
                      >
                        {job.prompt && job.prompt.trim() !== ""
                          ? job.prompt
                          : "(ohne Prompt)"}
                      </div>
                      <div style={{ fontSize: "0.72rem", opacity: 0.6 }}>
                        {job.preset || "—"}
                        {job.durationSec ? ` · ${job.durationSec}s` : ""}
                        {job.createdAt
                          ? ` · ${new Date(job.createdAt).toLocaleString("de-DE")}`
                          : ""}
                      </div>
                    </div>

                    <StatusPill status={job.status} />

                    {job.status === "DONE" && job.resultUrl ? (
                      <audio controls src={job.resultUrl} style={{ width: 170 }} />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

const navLinkStyle: React.CSSProperties = {
  padding: "0.4rem 0.85rem",
  borderRadius: 6,
  background: "var(--color-nav-bg)",
  color: "var(--color-nav-text)",
  textDecoration: "none",
  fontWeight: 600,
  fontSize: "0.9rem",
};

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        background: "color-mix(in oklab, var(--color-card) 96%, var(--color-bg))",
        border: "1px solid rgba(0,0,0,0.01)",
        borderRadius: 14,
        padding: "0.5rem 0.6rem 0.55rem",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        minHeight: 52,
      }}
    >
      <span style={{ opacity: 0.55, fontSize: "0.7rem" }}>{label}</span>
      <span
        style={{
          fontWeight: 600,
          fontFamily: mono
            ? "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas"
            : undefined,
          overflowWrap: "anywhere",
          wordBreak: "break-word",
        }}
      >
        {value || "—"}
      </span>
    </div>
  );
}

function StatusPill({ status }: { status: JobStatus }) {
  const label =
    status === "QUEUED"
      ? "Wartend"
      : status === "PROCESSING"
      ? "In Bearbeitung"
      : status === "DONE"
      ? "Fertig"
      : "Fehlgeschlagen";

  const bg =
    status === "DONE"
      ? "color-mix(in oklab, var(--color-accent) 30%, transparent)"
      : status === "FAILED"
      ? "#fee2e2"
      : "rgba(0,0,0,0.04)";

  const color = status === "FAILED" ? "#7f1d1d" : "inherit";

  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 10px 4px",
        borderRadius: 999,
        fontSize: "0.7rem",
        fontWeight: 600,
        background: bg,
        color,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}