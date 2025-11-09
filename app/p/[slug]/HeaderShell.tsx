// app/p/[slug]/HeaderShell.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Theme = "light" | "dark" | "pastel";

export default function HeaderShell({
  loggedIn,
  slug,
}: {
  loggedIn: boolean;
  slug: string;
}) {
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

  const logoSrc = useMemo(() => {
    if (theme === "light") return "/softvibe-logo-light.svg";
    if (theme === "dark") return "/softvibe-logo-dark.svg";
    return "/softvibe-logo-pastel.svg";
  }, [theme]);

  return (
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
          onClick={() => setTheme(nextTheme[theme])}
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