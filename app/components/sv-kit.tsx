"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";

export type ThemeKey = "light" | "pastel" | "dark";

export type ThemeConfig = {
  background: string;
  uiText: string;
  uiSoftText: string;

  primaryButtonBg: string;
  primaryButtonText: string;
  secondaryButtonBg: string;
  secondaryButtonBorder: string;
  secondaryButtonText: string;

  cardBg: string;
  cardBorder: string;
  cardShadow: string;

  playButtonBg: string;
  playButtonIcon: string;
  progressColor: string;
};

export const THEMES: Record<ThemeKey, ThemeConfig> = {
  light: {
    background:
      "radial-gradient(circle at 0% 0%, #fef3c7 0, #e0f2fe 40%, #e9d5ff 100%)",
    uiText: "#0f172a",
    uiSoftText: "rgba(15,23,42,0.7)",
    primaryButtonBg: "#111827",
    primaryButtonText: "#f9fafb",
    secondaryButtonBg: "rgba(255,255,255,0.85)",
    secondaryButtonBorder: "rgba(148,163,184,0.55)",
    secondaryButtonText: "#0f172a",
    cardBg: "rgba(248,250,252,0.78)",
    cardBorder: "rgba(148,163,184,0.28)",
    cardShadow: "0 26px 80px rgba(0,0,0,0.18)",
    playButtonBg: "rgba(15,23,42,0.92)",
    playButtonIcon: "#f9fafb",
    progressColor: "rgba(15,23,42,0.95)",
  },
  pastel: {
    background:
      "radial-gradient(circle at 0% 0%, #ecfeff 0, #e0f2fe 30%, #f5f3ff 100%)",
    uiText: "#0f172a",
    uiSoftText: "rgba(15,23,42,0.7)",
    primaryButtonBg: "#4f46e5",
    primaryButtonText: "#f9fafb",
    secondaryButtonBg: "rgba(255,255,255,0.9)",
    secondaryButtonBorder: "rgba(148,163,184,0.55)",
    secondaryButtonText: "#111827",
    cardBg: "rgba(248,250,252,0.82)",
    cardBorder: "rgba(148,163,184,0.28)",
    cardShadow: "0 26px 80px rgba(0,0,0,0.18)",
    playButtonBg: "rgba(15,23,42,0.9)",
    playButtonIcon: "#f9fafb",
    progressColor: "#4f46e5",
  },
  dark: {
    background:
      "radial-gradient(circle at 0% 0%, #020617 0, #020617 10%, #0b1120 24%, #111827 42%, #1f2937 65%, #0ea5e9 120%)",
    uiText: "#e5e7eb",
    uiSoftText: "#cbd5f5",
    primaryButtonBg: "#e5e7eb",
    primaryButtonText: "#020617",
    secondaryButtonBg: "rgba(15,23,42,0.9)",
    secondaryButtonBorder: "rgba(148,163,184,0.55)",
    secondaryButtonText: "#e5e7eb",
    cardBg: "rgba(15,23,42,0.78)",
    cardBorder: "rgba(148,163,184,0.18)",
    cardShadow: "0 26px 80px rgba(0,0,0,0.55)",
    playButtonBg: "rgba(15,23,42,0.95)",
    playButtonIcon: "#f9fafb",
    progressColor: "#38bdf8",
  },
};

export function useSVTheme() {
  const [themeKey, setThemeKey] = useState<ThemeKey>("dark");

  useEffect(() => {
    const saved = window.localStorage.getItem("sv-theme");
    if (saved === "light" || saved === "pastel" || saved === "dark") {
      setThemeKey(saved);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("sv-theme", themeKey);
  }, [themeKey]);

  const cycleTheme = () => {
    setThemeKey((prev) =>
      prev === "light" ? "pastel" : prev === "pastel" ? "dark" : "light"
    );
  };

  const cfg = useMemo(() => THEMES[themeKey], [themeKey]);
  const logoSrc =
    themeKey === "dark" ? "/softvibe-logo-dark.svg" : "/softvibe-logo-pastel.svg";

  return { themeKey, themeCfg: cfg, cycleTheme, logoSrc };
}

const UI_HIDE_DELAY_MS = 2500;

export function useAutoHideControls(isPlaying: boolean) {
  const [controlsVisible, setControlsVisible] = useState(true);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const scheduleHide = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (!isPlaying) return;
      timerRef.current = window.setTimeout(() => setControlsVisible(false), UI_HIDE_DELAY_MS);
    };

    const handleMove = () => {
      setControlsVisible(true);
      scheduleHide();
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("keydown", handleMove);

    scheduleHide();

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("keydown", handleMove);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [isPlaying]);

  return { controlsVisible, setControlsVisible };
}

export function SVPage({
  themeCfg,
  children,
}: {
  themeCfg: ThemeConfig;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        overflow: "hidden",
        backgroundImage: themeCfg.background,
        backgroundSize: "260% 260%",
        animation: "svDrift 40s ease-in-out infinite alternate",
      }}
    >
      {children}
      <style jsx global>{`
        @keyframes svDrift {
          0% { background-position: 0% 0%; }
          50% { background-position: 90% 40%; }
          100% { background-position: 0% 100%; }
        }
      `}</style>
    </div>
  );
}

export function SVHeader({
  logoSrc,
  onLogoClick,
  right,
  controlsVisible,
}: {
  logoSrc: string;
  onLogoClick: () => void;
  right?: React.ReactNode;
  controlsVisible: boolean;
}) {
  return (
    <header
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        opacity: controlsVisible ? 1 : 0,
        transform: controlsVisible ? "translateY(0px)" : "translateY(-12px)",
        transition: "opacity 400ms ease-out, transform 400ms ease-out",
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onLogoClick();
        }}
        style={{
          border: "none",
          background: "transparent",
          padding: 0,
          cursor: "pointer",
        }}
      >
        <Image src={logoSrc} alt="SoftVibe Logo" width={160} height={50} priority />
      </button>

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>{right}</div>
    </header>
  );
}

export function SVCard({
  themeCfg,
  children,
  visible = true,
}: {
  themeCfg: ThemeConfig;
  children: React.ReactNode;
  visible?: boolean;
}) {
  return (
    <div
      style={{
        borderRadius: 24,
        padding: 22,
        background: themeCfg.cardBg,
        border: `1px solid ${themeCfg.cardBorder}`,
        boxShadow: themeCfg.cardShadow,
        backdropFilter: "blur(14px)",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0px)" : "translateY(10px)",
        transition: "opacity 400ms ease-out, transform 400ms ease-out",
      }}
    >
      {children}
    </div>
  );
}

export function SVPillButton({
  themeCfg,
  kind = "secondary",
  children,
  onClick,
}: {
  themeCfg: ThemeConfig;
  kind?: "primary" | "secondary";
  children: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}) {
  const isPrimary = kind === "primary";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: isPrimary ? "none" : `1px solid ${themeCfg.secondaryButtonBorder}`,
        background: isPrimary ? themeCfg.primaryButtonBg : themeCfg.secondaryButtonBg,
        color: isPrimary ? themeCfg.primaryButtonText : themeCfg.secondaryButtonText,
        padding: isPrimary ? "0.55rem 1.15rem" : "0.5rem 1.05rem",
        borderRadius: 999,
        fontSize: "0.88rem",
        fontWeight: 700,
        cursor: "pointer",
        boxShadow: isPrimary
          ? "0 14px 35px rgba(0,0,0,0.35)"
          : "0 10px 25px rgba(0,0,0,0.18)",
      }}
    >
      {children}
    </button>
  );
}

export function SVLabel({ themeCfg, children }: { themeCfg: ThemeConfig; children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: "0.8rem",
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        fontWeight: 700,
        color: themeCfg.uiSoftText,
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

export function SVTitle({ themeCfg, children }: { themeCfg: ThemeConfig; children: React.ReactNode }) {
  return (
    <h1
      style={{
        fontSize: "1.6rem",
        fontWeight: 850,
        margin: 0,
        color: themeCfg.uiText,
      }}
    >
      {children}
    </h1>
  );
}

export function SVMeta({ themeCfg, children }: { themeCfg: ThemeConfig; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 6, color: themeCfg.uiSoftText, fontSize: "0.92rem" }}>
      {children}
    </div>
  );
}