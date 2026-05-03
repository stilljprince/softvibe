// app/p/[slug]/PublicPreviewClient.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";

type Props = {
  slug: string;
};

type ThemeKey = "light" | "pastel" | "dark";

type ThemeConfig = {
  background: string;
  uiText: string;
  uiSoftText: string;
  primaryButtonBg: string;
  primaryButtonText: string;
  secondaryButtonBg: string;
  secondaryButtonBorder: string;
  secondaryButtonText: string;
  playButtonBg: string;
  playButtonIcon: string;
  overlayCardBg: string;
  overlayTextMain: string;
  overlayTextSoft: string;
  overlayCtaBg: string;
  overlayCtaText: string;
  overlaySecondaryBg: string;
  overlaySecondaryBorder: string;
  overlaySecondaryText: string;
  progressColor: string;
};

const THEMES: Record<ThemeKey, ThemeConfig> = {
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
    playButtonBg: "rgba(15,23,42,0.92)",
    playButtonIcon: "#f9fafb",
    overlayCardBg: "rgba(248,250,252,0.92)",
    overlayTextMain: "#020617",
    overlayTextSoft: "rgba(15,23,42,0.72)",
    overlayCtaBg: "#111827",
    overlayCtaText: "#f9fafb",
    overlaySecondaryBg: "rgba(255,255,255,0.9)",
    overlaySecondaryBorder: "rgba(148,163,184,0.35)",
    overlaySecondaryText: "#0f172a",
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
    secondaryButtonText: "#1f2933",
    playButtonBg: "rgba(15,23,42,0.9)",
    playButtonIcon: "#f9fafb",
    overlayCardBg: "rgba(248,250,252,0.94)",
    overlayTextMain: "#020617",
    overlayTextSoft: "rgba(15,23,42,0.7)",
    overlayCtaBg: "#4f46e5",
    overlayCtaText: "#f9fafb",
    overlaySecondaryBg: "rgba(255,255,255,0.92)",
    overlaySecondaryBorder: "rgba(148,163,184,0.35)",
    overlaySecondaryText: "#111827",
    progressColor: "#4f46e5",
  },
  dark: {
    // der Darkmode-Gradient, den du mochtest
    background:
      "radial-gradient(circle at 0% 0%, #020617 0, #020617 10%, #0b1120 24%, #111827 42%, #1f2937 65%, #0ea5e9 120%)",
    uiText: "#e5e7eb",
    uiSoftText: "#cbd5f5",
    primaryButtonBg: "#e5e7eb",
    primaryButtonText: "#020617",
    secondaryButtonBg: "rgba(15,23,42,0.9)",
    secondaryButtonBorder: "rgba(148,163,184,0.7)",
    secondaryButtonText: "#e5e7eb",
    playButtonBg: "rgba(15,23,42,0.95)",
    playButtonIcon: "#f9fafb",
    overlayCardBg: "rgba(15,23,42,0.9)",
    overlayTextMain: "#e5e7eb",
    overlayTextSoft: "#cbd5f5",
    overlayCtaBg: "#e5e7eb",
    overlayCtaText: "#020617",
    overlaySecondaryBg: "rgba(15,23,42,0.92)",
    overlaySecondaryBorder: "rgba(15,23,42,0.92)",
    overlaySecondaryText: "#e5e7eb",
    progressColor: "#38bdf8",
  },
};

const PREVIEW_TOTAL_SECONDS = 20;
const FADE_SECONDS = 4;
const FADE_MS = FADE_SECONDS * 1000;
const VISUAL_DELAY_MS = 1800;
const UI_HIDE_DELAY_MS = 2500;

export default function PublicPreviewClient({ slug }: Props) {
  const [theme, setTheme] = useState<ThemeKey>("light");
  const [isPlaying, setIsPlaying] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [blurContent, setBlurContent] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [progress, setProgress] = useState(0); // 0–1
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fsHover, setFsHover] = useState(false);
  const [fsActive, setFsActive] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const uiHideTimerRef = useRef<number | null>(null);
  const hasStartedFadeRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const themeCfg = THEMES[theme];

  const logoSrc =
    theme === "dark"
      ? "/softvibe-logo-dark.svg"
      : "/softvibe-logo-pastel.svg";

  // Theme aus localStorage laden
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("sv-preview-theme");
    if (saved === "light" || saved === "pastel" || saved === "dark") {
      setTheme(saved);
    }
  }, []);

  // Theme speichern
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("sv-preview-theme", theme);
  }, [theme]);

  const cycleTheme = () => {
    setTheme((prev) =>
      prev === "light" ? "pastel" : prev === "pastel" ? "dark" : "light"
    );
  };

  // Fullscreen-State synchronisieren
  useEffect(() => {
    if (typeof document === "undefined") return;

    const onFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
    };
  }, []);

  const toggleFullscreen = () => {
    if (typeof document === "undefined") return;
    const el = rootRef.current;
    if (!el) return;

    if (!document.fullscreenElement) {
      void el.requestFullscreen?.();
    } else {
      void document.exitFullscreen?.();
    }
  };

  // UI auto-hide bei Bewegungslosigkeit
  useEffect(() => {
    const scheduleHide = () => {
      if (uiHideTimerRef.current) {
        window.clearTimeout(uiHideTimerRef.current);
      }
      if (!isPlaying) return;
      uiHideTimerRef.current = window.setTimeout(() => {
        setControlsVisible(false);
      }, UI_HIDE_DELAY_MS);
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
      if (uiHideTimerRef.current) {
        window.clearTimeout(uiHideTimerRef.current);
      }
    };
  }, [isPlaying]);

  // Progress über requestAnimationFrame
  useEffect(() => {
    const loop = () => {
      const audio = audioRef.current;
      if (audio) {
        const ratio = Math.max(
          0,
          Math.min(audio.currentTime / PREVIEW_TOTAL_SECONDS, 1)
        );
        setProgress(ratio);
      }
      if (isPlaying && !overlayVisible) {
        rafRef.current = window.requestAnimationFrame(loop);
      }
    };

    if (isPlaying && !overlayVisible) {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = window.requestAnimationFrame(loop);
    } else {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }

    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isPlaying, overlayVisible]);

  // Fade + Overlay Logik
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

    let fadeRaf: number | null = null;
    let visualTimer: number | null = null;

    const startFadeAndOverlay = () => {
      if (hasStartedFadeRef.current) return;
      hasStartedFadeRef.current = true;

      const startVol = audio.volume;
      const startTime = performance.now();

      if (visualTimer !== null) window.clearTimeout(visualTimer);
      visualTimer = window.setTimeout(() => {
        setBlurContent(true);
        setOverlayVisible(true);
      }, VISUAL_DELAY_MS);

      const step = (now: number) => {
        const rawT = Math.min(1, (now - startTime) / FADE_MS);
        const t = easeOut(rawT);
        const vol = startVol * (1 - t);

        audio.volume = Math.max(0, Math.min(1, vol));

        if (rawT < 1 && !audio.paused && !audio.ended) {
          fadeRaf = requestAnimationFrame(step);
        } else {
          if (!audio.paused && !audio.ended) {
            audio.pause();
          }
          if (!Number.isNaN(audio.currentTime)) {
            audio.currentTime = Math.min(
              audio.currentTime,
              PREVIEW_TOTAL_SECONDS
            );
          }
          audio.volume = startVol;
          setIsPlaying(false);
        }
      };

      if (!audio.paused && !audio.ended) {
        fadeRaf = requestAnimationFrame(step);
      }
    };

    const onTimeUpdate = () => {
      if (!audio) return;
      const fadeStart = PREVIEW_TOTAL_SECONDS - FADE_SECONDS;
      if (!hasStartedFadeRef.current && audio.currentTime >= fadeStart) {
        startFadeAndOverlay();
      }
    };

    const onEnded = () => {
      setIsPlaying(false);
      setControlsVisible(true);
      setProgress(1);
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      if (fadeRaf !== null) cancelAnimationFrame(fadeRaf);
      if (visualTimer !== null) window.clearTimeout(visualTimer);
    };
  }, []);

  const togglePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (overlayVisible) return; // nach Preview nicht erneut abspielen

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      setControlsVisible(true);
    } else {
      void audio.play();
      setIsPlaying(true);
      if (audio.currentTime < PREVIEW_TOTAL_SECONDS - FADE_SECONDS) {
        hasStartedFadeRef.current = false;
      }
    }
  };

  const handleBackgroundClick = () => {
    togglePlayPause();
  };

  const rootCursor =
    overlayVisible || controlsVisible ? "default" : "none";

  const progressDegrees = progress * 360;

  return (
    <div
      ref={rootRef}
      style={{
        position: "relative",
        minHeight: "100vh",
        width: "100%",
        overflow: "hidden",
        backgroundImage: themeCfg.background,
        backgroundSize: "260% 260%",
        animation: "svDrift 40s ease-in-out infinite alternate",
        cursor: rootCursor,
      }}
      onClick={handleBackgroundClick}
    >
      <audio ref={audioRef} src={`/api/public/${slug}`} preload="metadata" />

      {/* Sterne + Sternschnuppen nur im Darkmode */}
      {theme === "dark" && (
        <>
          <div className="sv-stars-layer" />
          <div className="sv-shoot sv-shoot-1" />
          <div className="sv-shoot sv-shoot-2" />
          <div className="sv-shoot sv-shoot-3" />
        </>
      )}

      {/* Hauptinhalt (blurbar) */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "20px 20px 28px",
          boxSizing: "border-box",
          filter: blurContent ? "blur(6px)" : "none",
          transition:
            "filter 2600ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {/* HEADER */}
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            opacity: controlsVisible ? 1 : 0,
            transform: controlsVisible
              ? "translateY(0px)"
              : "translateY(-12px)",
            transition:
              "opacity 400ms ease-out, transform 400ms ease-out",
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              cycleTheme();
            }}
            style={{
              border: "none",
              background: "transparent",
              padding: 0,
              cursor: "pointer",
            }}
          >
            <Image
              src={logoSrc}
              alt="SoftVibe Logo"
              width={160}
              height={50}
              priority
            />
          </button>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Link
              href="/login"
              onClick={(e) => e.stopPropagation()}
              style={{
                textDecoration: "none",
                padding: "0.45rem 0.95rem",
                borderRadius: 999,
                border: `1px solid ${themeCfg.secondaryButtonBorder}`,
                background: themeCfg.secondaryButtonBg,
                fontSize: "0.85rem",
                fontWeight: 600,
                color: themeCfg.secondaryButtonText,
                boxShadow: "0 10px 25px rgba(0,0,0,0.25)",
              }}
            >
              Login
            </Link>
            <Link
              href="/register"
              onClick={(e) => e.stopPropagation()}
              style={{
                textDecoration: "none",
                padding: "0.45rem 1.1rem",
                borderRadius: 999,
                background: themeCfg.primaryButtonBg,
                color: themeCfg.primaryButtonText,
                fontSize: "0.85rem",
                fontWeight: 600,
                boxShadow: "0 14px 35px rgba(0,0,0,0.35)",
              }}
            >
              Kostenlos starten
            </Link>
          </div>
        </header>

        {/* CENTER CONTENT */}
        <main
          style={{
            flex: "1 1 auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              opacity: controlsVisible ? 1 : 0,
              transform: controlsVisible
                ? "translateY(0px)"
                : "translateY(-10px)",
              transition:
                "opacity 400ms ease-out, transform 400ms ease-out",
            }}
          >
            <div
              style={{
                fontSize: "0.8rem",
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                fontWeight: 600,
                color: themeCfg.uiSoftText,
                marginBottom: 6,
              }}
            >
              Geteiltes Snippet
            </div>
            <h1
              style={{
                fontSize: "1.6rem",
                fontWeight: 800,
                marginBottom: 6,
                color: themeCfg.uiText,
              }}
            >
              SoftVibe Preview
            </h1>
            <p
              style={{
                fontSize: "0.95rem",
                color: themeCfg.uiSoftText,
                maxWidth: 420,
                margin: "0 auto 20px",
                lineHeight: 1.6,
              }}
            >
              Du hörst eine kurze Vorschau dieses Tracks.
              Tippe oder klicke, um zu pausieren –  
              und erzeuge deine eigenen Sounds direkt in SoftVibe.
            </p>
          </div>

          {/* PLAY / PAUSE mit smooth Progress-Ring */}
          <div
            style={{
              marginTop: 4,
              width: 112,
              height: 112,
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: controlsVisible ? 1 : 0,
              transform: controlsVisible
                ? "translateY(0px)"
                : "translateY(14px)",
              transition:
                "opacity 400ms ease-out, transform 400ms ease-out",
              pointerEvents: "auto",
            }}
          >
            {/* Progress-Ring */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "50%",
                background: `conic-gradient(${themeCfg.progressColor} ${progressDegrees}deg, rgba(255,255,255,0.06) ${progressDegrees}deg)`,
                opacity: isPlaying ? 0.9 : 0.22,
                transition: "opacity 280ms ease-out",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 10,
                  borderRadius: "50%",
                  background:
                    theme === "dark"
                      ? "rgba(15,23,42,1)"
                      : "rgba(248,250,252,0.9)",
                }}
              />
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                togglePlayPause();
              }}
              style={{
                width: 104,
                height: 104,
                borderRadius: "50%",
                border: "none",
                background: themeCfg.playButtonBg,
                boxShadow: "0 18px 45px rgba(0,0,0,0.45)",
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
                position: "relative",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  width: 40,
                  height: 40,
                  borderRadius: 999,
                  border: "none",
                  background: "transparent",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative",
                }}
              >
                {isPlaying ? (
                  <span
                    style={{
                      display: "flex",
                      gap: 5,
                      alignItems: "center",
                      justifyContent: "center",
                      width: 22,
                      height: 22,
                    }}
                  >
                    <span
                      style={{
                        width: 5,
                        height: 18,
                        borderRadius: 999,
                        background: themeCfg.playButtonIcon,
                      }}
                    />
                    <span
                      style={{
                        width: 5,
                        height: 18,
                        borderRadius: 999,
                        background: themeCfg.playButtonIcon,
                      }}
                    />
                  </span>
                ) : (
                  <span
                    style={{
                      width: 0,
                      height: 0,
                      borderTop: "9px solid transparent",
                      borderBottom: "9px solid transparent",
                      borderLeft: `15px solid ${themeCfg.playButtonIcon}`,
                      transform: "translateX(2px)",
                    }}
                  />
                )}
              </span>
            </button>
          </div>
        </main>

        {/* FOOTER */}
        <footer
          style={{
            textAlign: "center",
            fontSize: "0.8rem",
            color: themeCfg.uiSoftText,
            opacity: controlsVisible ? 0.95 : 0,
            transform: controlsVisible
              ? "translateY(0px)"
              : "translateY(8px)",
            transition:
              "opacity 400ms ease-out, transform 400ms ease-out",
          }}
        >
          Vorschau: {PREVIEW_TOTAL_SECONDS} Sekunden · Geteilt mit SoftVibe
        </footer>
      </div>

      {/* OVERLAY */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.55)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          zIndex: 10,
          opacity: overlayVisible ? 1 : 0,
          pointerEvents: overlayVisible ? "auto" : "none",
          transition:
            "opacity 2600ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            maxWidth: 580,
            width: "100%",
            borderRadius: 28,
            padding: 2,
            background:
              theme === "dark"
                ? "radial-gradient(circle at top, rgba(56,189,248,0.24), transparent 68%)"
                : "radial-gradient(circle at top, rgba(244,114,182,0.38), transparent 70%)",
            boxShadow: "0 26px 80px rgba(0,0,0,0.7)",
          }}
        >
          <div
            style={{
              background: themeCfg.overlayCardBg,
              backdropFilter: "blur(18px)",
              borderRadius: 24,
              padding: 26,
              textAlign: "center",
              color: themeCfg.overlayTextMain,
              fontFamily:
                "system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', sans-serif",
              boxShadow:
                theme === "dark"
                  ? "0 20px 55px rgba(15,23,42,0.9)"
                  : "0 18px 48px rgba(15,23,42,0.4)",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 12px",
                borderRadius: 999,
                background:
                  theme === "dark"
                    ? "rgba(15,23,42,0.85)"
                    : "rgba(15,23,42,0.06)",
                color: theme === "dark" ? "#e5e7eb" : "#0f172a",
                fontSize: "0.78rem",
                fontWeight: 600,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                marginBottom: 14,
              }}
            >
              <span>✨</span>
              <span>SoftVibe Preview beendet</span>
            </div>

            <h2
              style={{
                fontSize: "1.6rem",
                fontWeight: 800,
                marginBottom: 10,
                lineHeight: 1.3,
              }}
            >
              Du bist durch die{" "}
              <span style={{ whiteSpace: "nowrap" }}>
                ersten {PREVIEW_TOTAL_SECONDS} Sekunden.
              </span>
            </h2>

            <p
              style={{
                fontSize: "0.96rem",
                lineHeight: 1.7,
                opacity: 0.94,
                color: themeCfg.overlayTextSoft,
                marginBottom: 24,
              }}
            >
              Mit einem kostenlosen Account erzeugst du
              eigene, voll lange ASMR-Tracks –
              abgestimmt auf deine Trigger, dein Tempo  
              und deine Einschlafroutine.
            </p>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                justifyContent: "center",
              }}
            >
              <Link
                href="/register"
                style={{
                  textDecoration: "none",
                  padding: "0.8rem 1.7rem",
                  borderRadius: 999,
                  background: themeCfg.overlayCtaBg,
                  color: themeCfg.overlayCtaText,
                  fontWeight: 700,
                  fontSize: "0.98rem",
                  boxShadow:
                    theme === "dark"
                      ? "0 18px 45px rgba(15,23,42,0.9)"
                      : "0 14px 36px rgba(15,23,42,0.5)",
                  flex: "0 0 auto",
                  animation: "svPulse 3s ease-in-out infinite",
                }}
              >
                Kostenlos starten →
              </Link>

              <Link
                href="/login"
                style={{
                  textDecoration: "none",
                  padding: "0.75rem 1.6rem",
                  borderRadius: 999,
                  border:
                    theme === "dark"
                      ? "1px solid rgba(148,163,184,0.6)"
                      : "1px solid rgba(148,163,184,0.6)",
                  background: themeCfg.overlaySecondaryBg,
                  color: themeCfg.overlaySecondaryText,
                  fontWeight: 600,
                  fontSize: "0.9rem",
                  flex: "0 0 auto",
                }}
              >
                Ich habe schon einen Account
              </Link>
            </div>
          </div>
        </div>
      </div>

{/* Floating Fullscreen Toggle unten rechts */}
<button
  type="button"
  onClick={(e) => {
    e.stopPropagation();
    toggleFullscreen();
  }}
  onMouseEnter={() => setFsHover(true)}
  onMouseLeave={() => {
    setFsHover(false);
    setFsActive(false);
  }}
  onMouseDown={() => setFsActive(true)}
  onMouseUp={() => setFsActive(false)}
  title={isFullscreen ? "Fullscreen verlassen" : "Fullscreen"}
  aria-label={isFullscreen ? "Fullscreen verlassen" : "Fullscreen"}
  style={{
    position: "fixed",
    right: 20,
    bottom: 20,
    zIndex: 30, // sicher über Overlay (falls das 10–20 nutzt)
    width: 40,
    height: 40,
    borderRadius: 999,
    border: "none",
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
    background:
      theme === "dark"
        ? "rgba(15,23,42,0.95)"
        : "rgba(255,255,255,0.92)",
    color: theme === "dark" ? "#e5e7eb" : "#0f172a",
    // 🔥 Immer bedienbar – auch bei Overlay
    opacity: overlayVisible
      ? 0.98
      : controlsVisible
      ? 0.95
      : 0,
    pointerEvents: "auto",
    boxShadow: fsHover
      ? theme === "dark"
        ? "0 16px 40px rgba(15,23,42,0.9)"
        : "0 14px 36px rgba(15,23,42,0.55)"
      : "0 10px 28px rgba(0,0,0,0.45)",
    transform: `translateY(${controlsVisible ? 0 : 12}px) scale(${
      fsActive ? 0.96 : fsHover ? 1.04 : 1
    })`,
    transition:
      "opacity 200ms ease-out, transform 220ms cubic-bezier(0.19,1,0.22,1), box-shadow 220ms ease-out, background 200ms ease-out",
  }}
>
  <span
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      userSelect: "none",
      transform: isFullscreen
        ? "scale(1) rotate(180deg)"
        : "scale(1.32) rotate(0deg)",
      transition: "transform 420ms cubic-bezier(0.19, 1, 0.22, 1)",
      fontSize: isFullscreen ? 18 : 22,
      lineHeight: 1,
    }}
  >
    ⛶
  </span>
</button>
      {/* Background Drift + Pulse + Stars + dezente Shooting Stars */}
      <style jsx global>{`
       .sv-fs-btn:hover {
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.55);
}
       @keyframes svDrift {
          0% {
            background-position: 0% 0%;
          }
          50% {
            background-position: 90% 40%;
          }
          100% {
            background-position: 0% 100%;
          }
        }

        @keyframes svPulse {
          0% {
            transform: translateY(0px) scale(1);
            box-shadow: 0 0 0 rgba(0, 0, 0, 0);
          }
          50% {
            transform: translateY(-1.5px) scale(1.02);
            box-shadow: 0 0 26px rgba(15, 23, 42, 0.4);
          }
          100% {
            transform: translateY(0px) scale(1);
            box-shadow: 0 0 0 rgba(0, 0, 0, 0);
          }
        }

        @keyframes svStarsTwinkle {
          0% {
            opacity: 0.5;
            transform: translate3d(0, 0, 0);
          }
          50% {
            opacity: 0.9;
            transform: translate3d(-6px, -8px, 0);
          }
          100% {
            opacity: 0.55;
            transform: translate3d(4px, 6px, 0);
          }
        }

        @keyframes svNebulaDrift {
          0% {
            transform: translate3d(0, 0, 0) scale(1);
            opacity: 0.38;
          }
          50% {
            transform: translate3d(-20px, -12px, 0) scale(1.05);
            opacity: 0.52;
          }
          100% {
            transform: translate3d(18px, 14px, 0) scale(1.03);
            opacity: 0.4;
          }
        }

        /* ───────── Fullscreen Icons ───────── */

        .sv-fs-enter {
          font-size: 16px;
          line-height: 1;
          display: inline-block;
          text-align: center;
        }

        .sv-fs-exit {
          position: absolute;
          inset: 0;
          margin: auto;
          width: 18px;
          height: 18px;
        }

        .sv-fs-exit-corner {
          position: absolute;
          width: 9px;
          height: 9px;
          border-radius: 2px;
          border: 2px solid currentColor;
        }

        /* oben links – Ecke zeigt nach innen */
        .sv-fs-exit-tl {
          top: 0;
          left: 0;
          border-right: none;
          border-bottom: none;
        }

        /* oben rechts – Ecke zeigt nach innen */
        .sv-fs-exit-tr {
          top: 0;
          right: 0;
          border-left: none;
          border-bottom: none;
        }

        /* unten links – Ecke zeigt nach innen */
        .sv-fs-exit-bl {
          bottom: 0;
          left: 0;
          border-right: none;
          border-top: none;
        }

        /* unten rechts – Ecke zeigt nach innen */
        .sv-fs-exit-br {
          bottom: 0;
          right: 0;
          border-left: none;
          border-top: none;
        }

        /* Starfield-Layer (keine Kacheln, weiche Verteilung über den Screen) */
        .sv-stars-layer {
          position: absolute;
          inset: -40px;
          pointer-events: none;
          z-index: 0;
          background-repeat: no-repeat;
          opacity: 0.9;
          mix-blend-mode: screen;
          background-image:
            radial-gradient(
              1px 1px at 6% 8%,
              rgba(248, 250, 252, 1) 0,
              transparent 60%
            ),
            radial-gradient(
              1px 1px at 14% 16%,
              rgba(226, 232, 240, 0.98) 0,
              transparent 60%
            ),
            radial-gradient(
              1px 1px at 22% 10%,
              rgba(248, 250, 252, 0.98) 0,
              transparent 60%
            ),
            radial-gradient(
              1px 1px at 32% 20%,
              rgba(148, 163, 184, 0.95) 0,
              transparent 60%
            ),
            radial-gradient(
              1px 1px at 44% 14%,
              rgba(226, 232, 240, 0.98) 0,
              transparent 60%
            ),
            radial-gradient(
              1px 1px at 56% 18%,
              rgba(248, 250, 252, 0.95) 0,
              transparent 60%
            ),
            radial-gradient(
              1px 1px at 68% 12%,
              rgba(148, 163, 184, 0.95) 0,
              transparent 60%
            ),
            radial-gradient(
              1px 1px at 80% 18%,
              rgba(248, 250, 252, 0.95) 0,
              transparent 60%
            ),
            radial-gradient(
              2px 2px at 20% 8%,
              rgba(248, 250, 252, 1) 0,
              transparent 60%
            ),
            radial-gradient(
              2px 2px at 52% 16%,
              rgba(226, 232, 240, 0.95) 0,
              transparent 60%
            ),
            radial-gradient(
              2px 2px at 76% 10%,
              rgba(248, 250, 252, 1) 0,
              transparent 60%
            ),
            radial-gradient(
              1px 1px at 10% 32%,
              rgba(226, 232, 240, 0.9) 0,
              transparent 60%
            ),
            radial-gradient(
              1px 1px at 24% 38%,
              rgba(248, 250, 252, 0.95) 0,
              transparent 60%
            ),
            radial-gradient(
              1px 1px at 38% 34%,
              rgba(148, 163, 184, 0.9) 0,
              transparent 60%
            ),
            radial-gradient(
              1px 1px at 52% 30%,
              rgba(226, 232, 240, 0.9) 0,
              transparent 60%
            ),
            radial-gradient(
              1px 1px at 66% 36%,
              rgba(248, 250, 252, 0.9) 0,
              transparent 60%
            ),
            radial-gradient(
              1px 1px at 80% 32%,
              rgba(148, 163, 184, 0.85) 0,
              transparent 60%
            ),
            radial-gradient(
              2px 2px at 30% 40%,
              rgba(248, 250, 252, 0.9) 0,
              transparent 65%
            ),
            radial-gradient(
              2px 2px at 62% 44%,
              rgba(226, 232, 240, 0.9) 0,
              transparent 65%
            ),
            radial-gradient(
              1px 1px at 14% 54%,
              rgba(226, 232, 240, 0.8) 0,
              transparent 60%
            ),
            radial-gradient(
              1px 1px at 30% 60%,
              rgba(248, 250, 252, 0.85) 0,
              transparent 60%
            ),
            radial-gradient(
              1px 1px at 46% 56%,
              rgba(148, 163, 184, 0.8) 0,
              transparent 60%
            ),
            radial-gradient(
              1px 1px at 60% 62%,
              rgba(226, 232, 240, 0.8) 0,
              transparent 60%
            ),
            radial-gradient(
              1px 1px at 74% 58%,
              rgba(248, 250, 252, 0.82) 0,
              transparent 60%
            ),
            radial-gradient(
              1px 1px at 20% 70%,
              rgba(226, 232, 240, 0.78) 0,
              transparent 60%
            ),
            radial-gradient(
              1px 1px at 42% 74%,
              rgba(248, 250, 252, 0.82) 0,
              transparent 60%
            ),
            radial-gradient(
              1px 1px at 68% 72%,
              rgba(148, 163, 184, 0.75) 0,
              transparent 60%
            );
          animation: svStarsTwinkle 48s ease-in-out infinite alternate;
        }

        /* Dezente Sternschnuppen → kleine Punkte (deine „zufrieden“-Version) */
        .sv-shoot {
          position: absolute;
          width: 6px;
          height: 6px;
          pointer-events: none;
          opacity: 0;
        }

        .sv-shoot::before {
          content: none;
        }

        .sv-shoot::after {
          content: "";
          position: absolute;
          inset: 0;
          margin: auto;
          width: 4px;
          height: 4px;
          border-radius: 999px;
          background: rgba(248, 250, 252, 0.85);
          box-shadow: none;
        }

        .sv-shoot-1 {
          top: 10%;
          left: -20%;
          transform: rotate(8deg);
          animation: svShoot1 34s linear infinite;
        }

        .sv-shoot-2 {
          top: 18%;
          right: -25%;
          transform: rotate(190deg);
          animation: svShoot2 46s linear infinite;
        }

        .sv-shoot-3 {
          top: 24%;
          left: -18%;
          transform: rotate(12deg);
          animation: svShoot3 52s linear infinite;
        }

        @keyframes svShoot1 {
          0% {
            opacity: 0;
          }
          72% {
            opacity: 0;
            left: -20%;
            top: 10%;
          }
          76% {
            opacity: 0.25;
            left: 10%;
            top: 9%;
          }
          80% {
            opacity: 0.15;
            left: 32%;
            top: 11%;
          }
          84% {
            opacity: 0;
            left: 54%;
            top: 13%;
          }
          100% {
            opacity: 0;
          }
        }

        @keyframes svShoot2 {
          0% {
            opacity: 0;
          }
          78% {
            opacity: 0;
            right: -25%;
            top: 18%;
          }
          82% {
            opacity: 0.22;
            right: 8%;
            top: 17%;
          }
          86% {
            opacity: 0.12;
            right: 32%;
            top: 19%;
          }
          90% {
            opacity: 0;
            right: 58%;
            top: 22%;
          }
          100% {
            opacity: 0;
          }
        }

        @keyframes svShoot3 {
          0% {
            opacity: 0;
          }
          68% {
            opacity: 0;
            left: -18%;
            top: 24%;
          }
          72% {
            opacity: 0.24;
            left: 8%;
            top: 22%;
          }
          77% {
            opacity: 0.14;
            left: 28%;
            top: 24%;
          }
          82% {
            opacity: 0;
            left: 48%;
            top: 26%;
          }
          100% {
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}