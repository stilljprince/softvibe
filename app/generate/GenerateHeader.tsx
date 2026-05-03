// app/generate/GenerateHeader.tsx
"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";

type Theme = "light" | "dark" | "pastel";

type Props = {
  creditsLabel: string;
};

export default function GenerateHeader({ creditsLabel }: Props) {
  const [theme, setTheme] = useState<Theme>("light");
  const [showHeader, setShowHeader] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);

  useEffect(() => {
    const saved = (localStorage.getItem("theme") as Theme | null) ?? "light";
    document.documentElement.className = saved;
    setTheme(saved);
  }, []);

  useEffect(() => {
  const handleScroll = () => {
    const currentY = window.scrollY;

    if (currentY > lastScrollY && currentY > 40) {
      // runter scrollen
      setShowHeader(false);
    } else {
      // hoch scrollen oder nah am Top
      setShowHeader(true);
    }

    setLastScrollY(currentY);
  };

  window.addEventListener("scroll", handleScroll, { passive: true });
  return () => window.removeEventListener("scroll", handleScroll);
}, [lastScrollY]);

  useEffect(() => {
    document.documentElement.className = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  const nextTheme: Record<Theme, Theme> = {
    light: "dark",
    dark: "pastel",
    pastel: "light",
  };

  const getThemeIcon = () => (theme === "light" ? "🌞" : theme === "dark" ? "🌙" : "🎨");

  const getLogo = () =>
    theme === "light"
      ? "/softvibe-logo-light.svg"
      : theme === "dark"
      ? "/softvibe-logo-dark.svg"
      : "/softvibe-logo-pastel.svg";

  const handleToggleTheme = () => {
    setTheme(nextTheme[theme]);
  };

  return (
    <header
  style={{
    position: "fixed",
    top: showHeader ? 0 : -70,
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
    transition: "top 0.2s ease-out",
  }}
>

      {/* Logo links */}
      <div style={{ flex: "0 0 auto" }}>
        <Image src={getLogo()} alt="SoftVibe Logo" width={160} height={50} priority />
      </div>

      {/* Navigation Mitte (Desktop) */}
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
        <Link href="/" style={navLinkStyle}>
          Startseite
        </Link>
        <Link href="/library" style={navLinkStyle}>
          Bibliothek
        </Link>
        <Link href="/pricing" style={navLinkStyle}>
          Credits
        </Link>
        <Link href="/account" style={navLinkStyle}>
          Account
        </Link>
      </nav>

      {/* Rechts: Credits + Theme */}
      <div
        className="desktop-nav"
        style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}
      >
        {/* Credits-Pill */}
        <div
          style={{
            padding: "0.25rem 0.7rem",
            borderRadius: 999,
            background: "color-mix(in oklab, var(--color-card) 90%, var(--color-accent) 10%)",
            border: "1px solid var(--color-nav-bg)",
            fontSize: "0.8rem",
            fontWeight: 600,
          }}
        >
          Credits:{" "}
          <span
            style={{
              fontWeight: 800,
            }}
          >
            {creditsLabel}
          </span>
        </div>

        {/* Theme-Switch */}
        <button
          onClick={handleToggleTheme}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "40px",
            height: "40px",
            borderRadius: "50%",
            background: "var(--color-button-bg)",
            color: "var(--color-button-text)",
            border: "none",
            cursor: "pointer",
            fontSize: "1.25rem",
          }}
          aria-label="Theme wechseln"
          title="Theme wechseln"
        >
          {getThemeIcon()}
        </button>
      </div>

      {/* Mobile: vereinfachter Header (kein zersägtes Layout) */}
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

const navLinkStyle: React.CSSProperties = {
  padding: "0.5rem 1rem",
  borderRadius: 6,
  background: "var(--color-nav-bg)",
  color: "var(--color-nav-text)",
  textDecoration: "none",
  fontWeight: 600,
  fontSize: "0.9rem",
};
