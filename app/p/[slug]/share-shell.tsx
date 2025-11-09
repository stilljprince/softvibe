// app/p/[slug]/share-shell.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import CopyLink from "./CopyLink";

type Theme = "light" | "dark" | "pastel";

export default function ShareShell(props: {
  loggedIn: boolean;
  slug: string;
  title: string;
  metaLine: string;
  publicPageUrl: string;
  streamUrl: string;
}) {
  const { loggedIn, slug, title, metaLine, publicPageUrl, streamUrl } = props;

  // Theme (wie Landing)
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
  const nextTheme: Record<Theme, Theme> = { light: "dark", dark: "pastel", pastel: "light" };
  const handleToggleTheme = () => setTheme(nextTheme[theme]);
  const logoSrc = useMemo(() => {
    if (theme === "light") return "/softvibe-logo-light.svg";
    if (theme === "dark") return "/softvibe-logo-dark.svg";
    return "/softvibe-logo-pastel.svg";
  }, [theme]);

  // Eigener Toast (wie Library/Account-Stil)
  const [toast, setToast] = useState<{ msg: string; kind?: "ok" | "err" } | null>(null);
  useEffect(() => {
    let t: number | undefined;
    if (toast) t = window.setTimeout(() => setToast(null), 2200);
    return () => (t ? window.clearTimeout(t) : undefined);
  }, [toast]);
  const showToast = (msg: string, kind: "ok" | "err" = "ok") => setToast({ msg, kind });

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--color-bg)",
        color: "var(--color-text)",
        paddingTop: 64,
        paddingLeft: 16,
        paddingRight: 16,
        paddingBottom: 40,
      }}
    >
      {/* Header wie Landing */}
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
          borderBottom: "1px solid var(--color-nav-bg)",
        }}
      >
        <Link href="/" aria-label="Startseite" title="Startseite" style={{ display: "inline-flex" }}>
          {/* bewusst <img>, da Header klein ist und du das bereits so nutzt */}
          <img src={logoSrc} alt="SoftVibe Logo" width={150} height={44} />
        </Link>

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

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={handleToggleTheme}
            style={themeBtn}
            aria-label="Theme wechseln"
            title="Theme wechseln"
          >
            {theme === "light" ? "🌞" : theme === "dark" ? "🌙" : "🎨"}
          </button>

          {loggedIn ? (
            <>
              <Link href="/generate" style={pillLink}>
                Generieren
              </Link>
              <Link href="/library" style={pillLink}>
                Bibliothek
              </Link>
            </>
          ) : (
            <Link
              href={`/login?callbackUrl=${encodeURIComponent(`/p/${slug}`)}`}
              style={{ ...pillLink, background: "var(--color-accent)", color: "#fff", border: "none" }}
            >
              Anmelden
            </Link>
          )}
        </div>

        <style jsx>{`
          @media (max-width: 880px) {
            .desktop-nav {
              display: none !important;
            }
          }
        `}</style>
      </header>

      {/* Card */}
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <section
          style={{
            background: "var(--color-card)",
            border: "1px solid var(--color-nav-bg)",
            borderRadius: 18,
            boxShadow: "0 12px 28px rgba(0,0,0,.06)",
            padding: 18,
          }}
        >
          <h1 style={{ fontSize: "1.4rem", fontWeight: 800, marginBottom: 6, lineHeight: 1.1 }}>
            {title}
          </h1>
          <p style={{ fontSize: ".85rem", opacity: 0.7 }}>{metaLine}</p>

          {/* Player */}
          <div style={{ marginTop: 14 }}>
            <audio
              controls
              preload="none"
              src={streamUrl}
              style={{ width: "100%" }}
              controlsList="nodownload noplaybackrate noremoteplayback"
            />
          </div>

          {/* Hinweis, falls ausgeloggt */}
          {!loggedIn ? (
            <div
              style={{
                marginTop: 12,
                padding: "10px 12px",
                borderRadius: 12,
                background: "color-mix(in oklab, var(--color-card) 85%, #000 15%)",
                border: "1px solid var(--color-nav-bg)",
              }}
            >
              <p style={{ margin: 0, lineHeight: 1.35 }}>
                Du bist nicht angemeldet. Der Stream ist geschützt und erfordert ein SoftVibe-Konto.{" "}
                <Link
                  href={`/login?callbackUrl=${encodeURIComponent(`/p/${slug}`)}`}
                  style={{ fontWeight: 700, color: "var(--color-accent)", textDecoration: "none" }}
                >
                  Jetzt anmelden →
                </Link>
              </p>
            </div>
          ) : null}

          {/* Copy-Link */}
          <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <CopyLink
              url={publicPageUrl}
              onCopied={() => showToast("Link kopiert.", "ok")}
              onError={() => showToast("Konnte Link nicht kopieren.", "err")}
            />
            <Link href="/" style={{ ...pillLink, background: "transparent", color: "var(--color-text)" }}>
              ← Zur Startseite
            </Link>
          </div>
        </section>

        <p style={{ opacity: 0.55, marginTop: 14, fontSize: ".85rem", textAlign: "center" }}>
          Geteilter Link · Sicherer Stream via SoftVibe
        </p>
      </div>

      {/* Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            right: 16,
            bottom: 16,
            background:
              toast.kind === "err"
                ? "color-mix(in oklab, #ef4444 30%, var(--color-card))"
                : "color-mix(in oklab, var(--color-accent) 20%, var(--color-card))",
            color: "var(--color-text)",
            border: "1px solid var(--color-nav-bg)",
            borderRadius: 12,
            boxShadow: "0 10px 24px rgba(0,0,0,.14)",
            padding: "10px 12px",
            fontWeight: 600,
            zIndex: 1000,
          }}
        >
          {toast.msg}
        </div>
      )}
    </main>
  );
}

const pillLink: React.CSSProperties = {
  textDecoration: "none",
  fontWeight: 700,
  padding: "8px 12px",
  borderRadius: 999,
  border: "1px solid var(--color-nav-bg)",
  background: "var(--color-card)",
  color: "var(--color-text)",
  display: "inline-block",
};

const navLinkStyle: React.CSSProperties = {
  padding: "0.4rem 0.85rem",
  borderRadius: 6,
  background: "var(--color-nav-bg)",
  color: "var(--color-nav-text)",
  textDecoration: "none",
  fontWeight: 600,
  fontSize: "0.9rem",
};

const themeBtn: React.CSSProperties = {
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
};