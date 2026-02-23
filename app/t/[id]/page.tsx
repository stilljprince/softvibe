// app/t/[id]/page.tsx
"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { THEMES, type ThemeKey } from "@/app/components/sv-kit";

type TrackDetail = {
  id: string;
  title: string;
  url: string;
  createdAt?: string;
  durationSeconds?: number | null;
  jobTitle?: string | null;
  storyId?: string | null;
};

const UI_HIDE_DELAY_MS = 2500;

let CURRENT_AUDIO: HTMLAudioElement | null = null;

function formatTime(seconds?: number | null) {
  if (!seconds || seconds <= 0) return "—";
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export default function TrackPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  // Theme
  const [theme, setTheme] = useState<ThemeKey>("dark");
  const themeCfg = THEMES[theme];
  const logoSrc =
    theme === "dark" ? "/softvibe-logo-dark.svg" : "/softvibe-logo-pastel.svg";

  useEffect(() => {
    const saved = window.localStorage.getItem("sv-theme");
    if (saved === "light" || saved === "pastel" || saved === "dark") {
      setTheme(saved);
    }
  }, []);
  useEffect(() => {
    window.localStorage.setItem("sv-theme", theme);
  }, [theme]);

  const cycleTheme = () => {
    setTheme((prev) =>
      prev === "light" ? "pastel" : prev === "pastel" ? "dark" : "light"
    );
  };

  // Fullscreen
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fsHover, setFsHover] = useState(false);
  const [fsActive, setFsActive] = useState(false);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const toggleFullscreen = () => {
    const el = rootRef.current;
    if (!el) return;
    if (!document.fullscreenElement) void el.requestFullscreen?.();
    else void document.exitFullscreen?.();
  };

  // Track data
  const [t, setT] = useState<TrackDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Audio
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1
  const rafRef = useRef<number | null>(null);

  // UI auto-hide
  const [controlsVisible, setControlsVisible] = useState(true);
  const uiHideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const scheduleHide = () => {
      if (uiHideTimerRef.current) window.clearTimeout(uiHideTimerRef.current);
      if (!isPlaying) return;
      uiHideTimerRef.current = window.setTimeout(
        () => setControlsVisible(false),
        UI_HIDE_DELAY_MS
      );
    };

    const onActivity = () => {
      setControlsVisible(true);
      scheduleHide();
    };

    window.addEventListener("mousemove", onActivity);
    window.addEventListener("keydown", onActivity);
    window.addEventListener("scroll", onActivity, { passive: true }); // ✅ scroll counts

    scheduleHide();

    return () => {
      window.removeEventListener("mousemove", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("scroll", onActivity);
      if (uiHideTimerRef.current) window.clearTimeout(uiHideTimerRef.current);
    };
  }, [isPlaying]);

  // Cursor hide (global class on <html>)
  useEffect(() => {
    const cls = "sv-hide-cursor";
    const el = document.documentElement;
    if (!controlsVisible) el.classList.add(cls);
    else el.classList.remove(cls);
    return () => el.classList.remove(cls);
  }, [controlsVisible]);

  // Fetch track
  useEffect(() => {
    let mounted = true;

    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/tracks/${encodeURIComponent(id)}`, {
          cache: "no-store",
        });

        if (!res.ok) {
          router.push("/library");
          return;
        }

        const raw = await res.json();
        const data = raw?.data ?? raw;
        if (!mounted) return;

        // If it's a chapter -> go to story page
        if (data?.storyId) {
          router.push(`/s/${data.storyId}`);
          return;
        }

        setT(data as TrackDetail);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [id, router]);

  // Apply audio src when loaded
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !t?.url) return;

    a.pause();
    setIsPlaying(false);
    setProgress(0);

    if (CURRENT_AUDIO && CURRENT_AUDIO !== a) CURRENT_AUDIO.pause();
    CURRENT_AUDIO = a;

    a.src = t.url;
    a.load();
  }, [t?.url]);

  // Progress loop
  useEffect(() => {
    const loop = () => {
      const a = audioRef.current;
      if (a && a.duration && !Number.isNaN(a.duration) && a.duration > 0) {
        setProgress(Math.max(0, Math.min(a.currentTime / a.duration, 1)));
      } else {
        setProgress(0);
      }
      if (isPlaying) rafRef.current = window.requestAnimationFrame(loop);
    };

    if (isPlaying) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = window.requestAnimationFrame(loop);
    } else {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [isPlaying]);

  // Audio events
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setControlsVisible(true);
    };

    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);

    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
    };
  }, []);

  const togglePlayPause = () => {
    const a = audioRef.current;
    if (!a || !t?.url) return;

    // only one audio at a time
    if (CURRENT_AUDIO && CURRENT_AUDIO !== a) CURRENT_AUDIO.pause();
    CURRENT_AUDIO = a;

    if (a.paused) {
      void a.play().catch(() => {});
      setIsPlaying(true);
    } else {
      a.pause();
      setIsPlaying(false);
      setControlsVisible(true);
    }
  };

  // Background click toggles play/pause
  const handleBackgroundClick = () => {
    if (!t?.url) return;
    togglePlayPause();
  };

  const title = useMemo(() => {
    if (!t) return "Track";
    return (t.jobTitle ?? t.title ?? "Track").trim();
  }, [t]);

  const progressDegrees = progress * 360;

  const footerText = useMemo(() => {
    if (loading) return "—";
    return `Länge: ${formatTime(t?.durationSeconds ?? null)} · SoftVibe`;
  }, [loading, t?.durationSeconds]);

  return (
    <div ref={rootRef} onClick={handleBackgroundClick}>
      {/* Fixed Background */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 0,
          backgroundImage: themeCfg.background,
          backgroundSize: "260% 260%",
          animation: "svDrift 40s ease-in-out infinite alternate",
        }}
      />

      {/* Stars */}
      {theme === "dark" && (
        <>
          <div className="sv-stars-layer" />
          <div className="sv-shoot sv-shoot-1" />
          <div className="sv-shoot sv-shoot-2" />
          <div className="sv-shoot sv-shoot-3" />
        </>
      )}

      {/* Invisible scroll area (keeps “scroll gesture”), nothing else moves */}
      <div style={{ position: "relative", zIndex: 1, height: "135vh" }} />

      {/* Audio */}
      <audio ref={audioRef} preload="metadata" />

      {/* Fixed header (static) */}
      <header
        style={{
          position: "fixed",
          top: 20,
          left: 20,
          right: 20,
          zIndex: 20,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          opacity: controlsVisible ? 1 : 0,
          transform: controlsVisible ? "translateY(0px)" : "translateY(-12px)",
          transition: "opacity 400ms ease-out, transform 400ms ease-out",
          pointerEvents: controlsVisible ? "auto" : "none",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={cycleTheme}
          style={{
            border: "none",
            background: "transparent",
            padding: 0,
            cursor: "pointer",
          }}
        >
          <Image src={logoSrc} alt="SoftVibe Logo" width={160} height={50} priority />
        </button>

        <button
          type="button"
          onClick={() => router.push("/library")}
          style={{
            border: `1px solid ${themeCfg.secondaryButtonBorder}`,
            background: themeCfg.secondaryButtonBg,
            color: themeCfg.secondaryButtonText,
            padding: "0.45rem 0.95rem",
            borderRadius: 999,
            fontSize: "0.85rem",
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: "0 10px 25px rgba(0,0,0,0.25)",
          }}
        >
          ← Library
        </button>
      </header>

      {/* Fixed hero (static, slightly higher) */}
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          top: "50%",
          transform: "translateY(-56%)",
          zIndex: 18,
          pointerEvents: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 20px", textAlign: "center" }}>
          <div
            style={{
              opacity: controlsVisible ? 1 : 0,
              transform: controlsVisible ? "translateY(0px)" : "translateY(-10px)",
              transition: "opacity 400ms ease-out, transform 400ms ease-out",
              pointerEvents: "none",
            }}
          >
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
              Track
            </div>

            <h1
              style={{
                fontSize: "1.65rem",
                fontWeight: 850,
                margin: 0,
                marginBottom: 6,
                color: themeCfg.uiText,
              }}
            >
              {loading ? "Lade…" : title}
            </h1>

            <p
              style={{
                fontSize: "0.95rem",
                color: themeCfg.uiSoftText,
                maxWidth: 520,
                margin: "0 auto 16px",
                lineHeight: 1.6,
              }}
            >
              Tippe oder klicke, um zu pausieren.
            </p>
          </div>

          {/* Play cluster */}
          <div
            id="sv-controls"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: controlsVisible ? 1 : 0,
              transform: controlsVisible ? "translateY(0px)" : "translateY(14px)",
              transition: "opacity 400ms ease-out, transform 400ms ease-out",
              pointerEvents: controlsVisible ? "auto" : "none",
              zIndex: 50,
              position: "relative",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                width: 112,
                height: 112,
                position: "relative",
                display: "grid",
                placeItems: "center",
              }}
            >
              {/* Progress ring (must never block clicks) */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  background: `conic-gradient(${themeCfg.progressColor} ${progressDegrees}deg, rgba(255,255,255,0.06) ${progressDegrees}deg)`,
                  opacity: isPlaying ? 0.9 : 0.22,
                  transition: "opacity 280ms ease-out",
                  pointerEvents: "none",
                  zIndex: 0,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 10,
                    borderRadius: "50%",
                    background: theme === "dark" ? "rgba(15,23,42,1)" : "rgba(248,250,252,0.9)",
                    pointerEvents: "none",
                  }}
                />
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  togglePlayPause();
                }}
                aria-label={isPlaying ? "Pause" : "Play"}
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
                  opacity: t?.url ? 1 : 0.65,
                  position: "relative",
                  zIndex: 2,
                }}
              >
                {isPlaying ? (
                  <span style={{ display: "flex", gap: 5, alignItems: "center" }}>
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
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom footer */}
      <footer
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 18,
          zIndex: 20,
          textAlign: "center",
          fontSize: "0.82rem",
          color: themeCfg.uiSoftText,
          opacity: controlsVisible ? 0.95 : 0,
          transform: controlsVisible ? "translateY(0px)" : "translateY(8px)",
          transition: "opacity 240ms ease-out, transform 240ms ease-out",
          pointerEvents: "none",
        }}
      >
        {footerText}
      </footer>

      {/* Fullscreen toggle */}
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
          zIndex: 30,
          width: 40,
          height: 40,
          borderRadius: 999,
          border: "none",
          cursor: "pointer",
          display: "grid",
          placeItems: "center",
          background: theme === "dark" ? "rgba(15,23,42,0.95)" : "rgba(255,255,255,0.92)",
          color: theme === "dark" ? "#e5e7eb" : "#0f172a",
          opacity: controlsVisible ? 0.95 : 0,
          pointerEvents: "auto",
          boxShadow: fsHover
            ? theme === "dark"
              ? "0 16px 40px rgba(15,23,42,0.9)"
              : "0 14px 36px rgba(15,23,42,0.55)"
            : "0 10px 28px rgba(0,0,0,0.45)",
          transform: `translateY(${controlsVisible ? 0 : 12}px) scale(${fsActive ? 0.96 : fsHover ? 1.04 : 1})`,
          transition:
            "opacity 200ms ease-out, transform 220ms cubic-bezier(0.19,1,0.22,1), box-shadow 220ms ease-out, background 200ms ease-out",
        }}
      >
        <span
          style={{
            userSelect: "none",
            transform: isFullscreen ? "scale(1) rotate(180deg)" : "scale(1.32) rotate(0deg)",
            transition: "transform 420ms cubic-bezier(0.19, 1, 0.22, 1)",
            fontSize: isFullscreen ? 18 : 22,
            lineHeight: 1,
          }}
        >
          ⛶
        </span>
      </button>

      {/* Background drift + stars + shooting stars */}
      <style jsx global>{`
        @keyframes svDrift {
          0% { background-position: 0% 0%; }
          50% { background-position: 90% 40%; }
          100% { background-position: 0% 100%; }
        }

        .sv-stars-layer {
          position: fixed;
          inset: -40px;
          pointer-events: none;
          z-index: 0;
          background-repeat: no-repeat;
          opacity: 0.9;
          mix-blend-mode: screen;
          background-image:
            radial-gradient(1px 1px at 6% 8%, rgba(248, 250, 252, 1) 0, transparent 60%),
            radial-gradient(1px 1px at 14% 16%, rgba(226, 232, 240, 0.98) 0, transparent 60%),
            radial-gradient(1px 1px at 22% 10%, rgba(248, 250, 252, 0.98) 0, transparent 60%),
            radial-gradient(1px 1px at 32% 20%, rgba(148, 163, 184, 0.95) 0, transparent 60%),
            radial-gradient(1px 1px at 44% 14%, rgba(226, 232, 240, 0.98) 0, transparent 60%),
            radial-gradient(1px 1px at 56% 18%, rgba(248, 250, 252, 0.95) 0, transparent 60%),
            radial-gradient(1px 1px at 68% 12%, rgba(148, 163, 184, 0.95) 0, transparent 60%),
            radial-gradient(1px 1px at 80% 18%, rgba(248, 250, 252, 0.95) 0, transparent 60%);
          animation: svStarsTwinkle 48s ease-in-out infinite alternate;
        }

        @keyframes svStarsTwinkle {
          0% { opacity: 0.5; transform: translate3d(0,0,0); }
          50% { opacity: 0.9; transform: translate3d(-6px,-8px,0); }
          100% { opacity: 0.55; transform: translate3d(4px,6px,0); }
        }

        .sv-shoot {
          position: fixed;
          width: 6px;
          height: 6px;
          pointer-events: none;
          opacity: 0;
          z-index: 0;
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
        }
        .sv-shoot-1 { top: 10%; left: -20%; transform: rotate(8deg); animation: svShoot1 34s linear infinite; }
        .sv-shoot-2 { top: 18%; right: -25%; transform: rotate(190deg); animation: svShoot2 46s linear infinite; }
        .sv-shoot-3 { top: 24%; left: -18%; transform: rotate(12deg); animation: svShoot3 52s linear infinite; }

        @keyframes svShoot1 {
          0% { opacity: 0; }
          72% { opacity: 0; left: -20%; top: 10%; }
          76% { opacity: 0.25; left: 10%; top: 9%; }
          80% { opacity: 0.15; left: 32%; top: 11%; }
          84% { opacity: 0; left: 54%; top: 13%; }
          100% { opacity: 0; }
        }
        @keyframes svShoot2 {
          0% { opacity: 0; }
          78% { opacity: 0; right: -25%; top: 18%; }
          82% { opacity: 0.22; right: 8%; top: 17%; }
          86% { opacity: 0.12; right: 32%; top: 19%; }
          90% { opacity: 0; right: 58%; top: 22%; }
          100% { opacity: 0; }
        }
        @keyframes svShoot3 {
          0% { opacity: 0; }
          68% { opacity: 0; left: -18%; top: 24%; }
          72% { opacity: 0.24; left: 8%; top: 22%; }
          77% { opacity: 0.14; left: 28%; top: 24%; }
          82% { opacity: 0; left: 48%; top: 26%; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}