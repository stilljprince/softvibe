// app/components/global-player.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { usePlayer } from "./player-context";
import { useSVTheme, useAutoHideControls } from "./sv-kit";

// Pages with their own full-page player UI.
// The global bottom bar is hidden here, and playback is paused automatically
// when the user navigates to them.
const HIDDEN_PATHS = ["/s/", "/t/"];

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function GlobalPlayer() {
  const {
    state,
    audioEl,
    play,
    pause,
    seek,
    openFullscreen,
    closeFullscreen,
    prevChapter,
    nextChapter,
    goToChapter,
  } = usePlayer();
  const { themeKey, themeCfg } = useSVTheme();
  const pathname = usePathname();

  const isDark = themeKey === "dark";

  // True only when a multi-chapter story is loaded
  const isStory = !!state.storyId && state.chapters.length > 1;

  // Scrub state — position tracked in ref for stale-closure safety
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubPosition, setScrubPosition] = useState(0);
  const scrubPositionRef = useRef(0);

  // Chapter panel (fullscreen only)
  const [chapterPanelOpen, setChapterPanelOpen] = useState(false);

  // RAF-based smooth progress for the fullscreen ring (60 fps)
  const [rafProgress, setRafProgress] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!state.isPlaying || !state.isFullscreen) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }
    const loop = () => {
      const a = audioEl.current;
      if (a && Number.isFinite(a.duration) && a.duration > 0) {
        setRafProgress(Math.max(0, Math.min(a.currentTime / a.duration, 1)));
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [state.isPlaying, state.isFullscreen, audioEl]);

  // Auto-hide controls when fullscreen is open and playing
  const { controlsVisible } = useAutoHideControls(state.isPlaying && state.isFullscreen);

  // Close chapter panel when controls auto-hide or fullscreen closes
  useEffect(() => {
    if (!controlsVisible) setChapterPanelOpen(false);
  }, [controlsVisible]);

  useEffect(() => {
    if (!state.isFullscreen) setChapterPanelOpen(false);
  }, [state.isFullscreen]);

  // Exclusivity: pause when navigating to a dedicated player page
  useEffect(() => {
    if (HIDDEN_PATHS.some((p) => pathname.startsWith(p))) {
      pause();
    }
  }, [pathname, pause]);

  const hidden = HIDDEN_PATHS.some((p) => pathname.startsWith(p));

  const glass = useMemo(
    () => ({
      background: isDark ? "rgba(15,23,42,0.72)" : "rgba(248,250,252,0.85)",
      backdropFilter: "blur(24px)",
      WebkitBackdropFilter: "blur(24px)",
      boxShadow: isDark
        ? "0 -4px 24px rgba(0,0,0,0.4)"
        : "0 -4px 20px rgba(15,23,42,0.10)",
    }),
    [isDark],
  );

  // Background click: dismiss chapter panel first; only toggle play if panel was already closed.
  const handleBackgroundClick = () => {
    if (chapterPanelOpen) {
      setChapterPanelOpen(false);
      return;
    }
    state.isPlaying ? pause() : play();
  };

  if (!state.trackUrl || hidden) return null;

  const liveProgress = state.duration > 0 ? state.currentTime / state.duration : 0;
  const displayProgress = scrubbing ? scrubPosition : liveProgress;
  const displayTime = scrubbing ? scrubPosition * state.duration : state.currentTime;

  // Ring uses RAF-smooth progress when fullscreen+playing; otherwise falls back to state-based.
  const ringProgress =
    state.isPlaying && state.isFullscreen ? rafProgress : liveProgress;
  const progressDegrees = ringProgress * 360;
  const trackBg = isDark ? "rgba(148,163,184,0.18)" : "rgba(148,163,184,0.28)";

  // ── Shared scrub handlers ────────────────────────────────────────────────
  const handleScrubMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const duration = state.duration;
    const toRatio = (x: number) =>
      Math.max(0, Math.min(1, (x - rect.left) / rect.width));

    const initial = toRatio(e.clientX);
    scrubPositionRef.current = initial;
    setScrubbing(true);
    setScrubPosition(initial);

    const onMove = (me: MouseEvent) => {
      const r = toRatio(me.clientX);
      scrubPositionRef.current = r;
      setScrubPosition(r);
    };
    const onUp = () => {
      seek(scrubPositionRef.current * duration);
      setScrubbing(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleScrubTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const duration = state.duration;
    const toRatio = (x: number) =>
      Math.max(0, Math.min(1, (x - rect.left) / rect.width));

    const initial = toRatio(e.touches[0].clientX);
    scrubPositionRef.current = initial;
    setScrubbing(true);
    setScrubPosition(initial);

    const onMove = (te: TouchEvent) => {
      const r = toRatio(te.touches[0].clientX);
      scrubPositionRef.current = r;
      setScrubPosition(r);
    };
    const onEnd = () => {
      seek(scrubPositionRef.current * duration);
      setScrubbing(false);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
    window.addEventListener("touchmove", onMove);
    window.addEventListener("touchend", onEnd);
  };

  return (
    <>
      {/* ── Bottom bar ─────────────────────────────────────────────────────── */}
      <div
        role="region"
        aria-label="Globaler Player"
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 200,
          ...glass,
        }}
      >
        {/* Scrub strip — 12px tap target at the top edge, 3px visual bar inside */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 12,
            cursor: "pointer",
          }}
          onMouseDown={handleScrubMouseDown}
          onTouchStart={handleScrubTouchStart}
        >
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: 3,
              background: trackBg,
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${displayProgress * 100}%`,
                background: themeCfg.progressColor,
                transition: scrubbing ? "none" : "width 80ms linear",
              }}
            />
          </div>
        </div>

        {/* Controls row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 16px 12px",
          }}
        >
          {/* Title + chapter subtitle (story only) */}
          <div style={{ flex: "1 1 0", minWidth: 0 }}>
            <div
              style={{
                fontWeight: 600,
                fontSize: "0.85rem",
                color: themeCfg.uiText,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {state.trackTitle ?? "Wird geladen…"}
            </div>
            {isStory && (
              <div
                style={{
                  fontSize: "0.7rem",
                  color: themeCfg.uiSoftText,
                  marginTop: 1,
                  whiteSpace: "nowrap",
                }}
              >
                Kapitel {state.chapterIndex + 1} / {state.chapters.length}
              </div>
            )}
          </div>

          {/* Skip prev — story only */}
          {isStory && (
            <button
              type="button"
              onClick={prevChapter}
              aria-label="Vorheriges Kapitel"
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "transparent",
                border: `1px solid ${themeCfg.secondaryButtonBorder}`,
                color: themeCfg.uiSoftText,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: state.chapterIndex === 0 ? "default" : "pointer",
                flexShrink: 0,
                opacity: state.chapterIndex === 0 ? 0.3 : 0.8,
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 5v14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                <path d="M20 6.6v10.8c0 .8-.9 1.3-1.6.9l-8.2-5.4c-.7-.5-.7-1.5 0-1.9l8.2-5.4c.7-.4 1.6.1 1.6 1z" fill="currentColor" />
              </svg>
            </button>
          )}

          {/* Play / Pause */}
          <button
            type="button"
            onClick={() => (state.isPlaying ? pause() : play())}
            aria-label={state.isPlaying ? "Pause" : "Abspielen"}
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              background: themeCfg.primaryButtonBg,
              color: themeCfg.primaryButtonText,
              border: "none",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flexShrink: 0,
              boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
            }}
          >
            {state.isPlaying ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <rect x="2" y="1" width="4" height="12" rx="1" />
                <rect x="8" y="1" width="4" height="12" rx="1" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 11 11" fill="currentColor">
                <path d="M2.5 1.8l7 3.7-7 3.7z" />
              </svg>
            )}
          </button>

          {/* Skip next — story only */}
          {isStory && (
            <button
              type="button"
              onClick={nextChapter}
              aria-label="Nächstes Kapitel"
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "transparent",
                border: `1px solid ${themeCfg.secondaryButtonBorder}`,
                color: themeCfg.uiSoftText,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                cursor:
                  state.chapterIndex >= state.chapters.length - 1 ? "default" : "pointer",
                flexShrink: 0,
                opacity: state.chapterIndex >= state.chapters.length - 1 ? 0.3 : 0.8,
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M18 5v14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                <path d="M4 6.6v10.8c0 .8.9 1.3 1.6.9l8.2-5.4c.7-.5.7-1.5 0-1.9L5.6 5.7C4.9 5.3 4 5.8 4 6.6z" fill="currentColor" />
              </svg>
            </button>
          )}

          {/* Elapsed / total */}
          <div
            style={{
              fontSize: "0.72rem",
              color: themeCfg.uiSoftText,
              fontVariantNumeric: "tabular-nums",
              flexShrink: 0,
              whiteSpace: "nowrap",
            }}
          >
            {formatTime(displayTime)} / {formatTime(state.duration)}
          </div>

          {/* Fullscreen */}
          <button
            type="button"
            onClick={openFullscreen}
            aria-label="Vollbild öffnen"
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "transparent",
              border: `1px solid ${themeCfg.secondaryButtonBorder}`,
              color: themeCfg.uiSoftText,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="M1 5V1h4M11 1h4v4M15 11v4h-4M5 15H1v-4" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Fullscreen overlay ─────────────────────────────────────────────── */}
      {state.isFullscreen && (
        <>
          {/* Self-contained animation + stars CSS — does not depend on SVScene being on the page */}
          <style>{`
            @keyframes gpDrift {
              0%   { background-position: 0% 0%; }
              50%  { background-position: 90% 40%; }
              100% { background-position: 0% 100%; }
            }
            @keyframes gpStarsTwinkle {
              0%   { opacity: 0.5;  transform: translate3d(0,0,0); }
              50%  { opacity: 0.9;  transform: translate3d(-6px,-8px,0); }
              100% { opacity: 0.55; transform: translate3d(4px,6px,0); }
            }
            .gp-stars {
              position: absolute;
              inset: -40px;
              pointer-events: none;
              z-index: 1;
              background-repeat: no-repeat;
              opacity: 0.9;
              mix-blend-mode: screen;
              background-image:
                radial-gradient(1px 1px at  6%  8%, rgba(248,250,252,1.00) 0, transparent 60%),
                radial-gradient(1px 1px at 14% 16%, rgba(226,232,240,0.98) 0, transparent 60%),
                radial-gradient(1px 1px at 22% 10%, rgba(248,250,252,0.98) 0, transparent 60%),
                radial-gradient(1px 1px at 32% 20%, rgba(148,163,184,0.95) 0, transparent 60%),
                radial-gradient(1px 1px at 44% 14%, rgba(226,232,240,0.98) 0, transparent 60%),
                radial-gradient(1px 1px at 56% 18%, rgba(248,250,252,0.95) 0, transparent 60%),
                radial-gradient(1px 1px at 68% 12%, rgba(148,163,184,0.95) 0, transparent 60%),
                radial-gradient(1px 1px at 80% 18%, rgba(248,250,252,0.95) 0, transparent 60%);
              animation: gpStarsTwinkle 48s ease-in-out infinite alternate;
            }
          `}</style>

          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 300,
              overflow: "hidden",
            }}
            onClick={handleBackgroundClick}
          >
            {/* Animated background — reuses themeCfg.background (same gradient used by SVScene/SVPage) */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage: themeCfg.background,
                backgroundSize: "260% 260%",
                animation: "gpDrift 40s ease-in-out infinite alternate",
              }}
            />

            {/* Stars — dark theme only */}
            {isDark && <div className="gp-stars" />}

            {/* Controls layer — auto-hides when playing */}
            <div
              style={{
                position: "relative",
                zIndex: 2,
                height: "100%",
                display: "flex",
                flexDirection: "column",
                padding: "20px 24px 0",
                boxSizing: "border-box",
                opacity: controlsVisible ? 1 : 0,
                transition: "opacity 400ms ease-out",
                pointerEvents: controlsVisible ? "auto" : "none",
              }}
            >
              {/* Top bar: close left, chapters toggle right (story only) */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexShrink: 0,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={closeFullscreen}
                  aria-label="Vollbild schließen"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    background: "transparent",
                    border: `1px solid ${themeCfg.secondaryButtonBorder}`,
                    color: themeCfg.uiText,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    fontSize: "1rem",
                  }}
                >
                  ✕
                </button>

                {/* Chapter list toggle — story only */}
                {isStory && (
                  <button
                    type="button"
                    onClick={() => setChapterPanelOpen((v) => !v)}
                    aria-label="Kapitelübersicht"
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: "50%",
                      background: chapterPanelOpen ? themeCfg.secondaryButtonBg : "transparent",
                      border: `1px solid ${themeCfg.secondaryButtonBorder}`,
                      color: themeCfg.uiSoftText,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      transition: "background 150ms ease",
                    }}
                  >
                    {/* List icon */}
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <rect x="0" y="1" width="16" height="2.2" rx="1.1" />
                      <rect x="0" y="7" width="16" height="2.2" rx="1.1" />
                      <rect x="0" y="13" width="10" height="2.2" rx="1.1" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Hero — fills remaining space, centered */}
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {/* Title */}
                <div
                  style={{
                    fontSize: "clamp(1.1rem, 4vw, 1.55rem)",
                    fontWeight: 750,
                    color: themeCfg.uiText,
                    letterSpacing: "-0.02em",
                    textAlign: "center",
                    maxWidth: 560,
                    lineHeight: 1.3,
                    marginBottom: isStory ? 6 : 32,
                  }}
                >
                  {state.trackTitle ?? ""}
                </div>

                {/* Chapter subtitle — story only */}
                {isStory && (
                  <div
                    style={{
                      fontSize: "0.88rem",
                      color: themeCfg.uiSoftText,
                      marginBottom: 32,
                    }}
                  >
                    Kapitel {state.chapterIndex + 1} / {state.chapters.length}
                  </div>
                )}

                {/* Controls cluster */}
                <div
                  style={{ display: "flex", alignItems: "center", gap: 16 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Skip prev — story only */}
                  {isStory && (
                    <button
                      type="button"
                      onClick={prevChapter}
                      aria-label="Vorheriges Kapitel"
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: "50%",
                        border: "none",
                        background: themeCfg.playButtonBg,
                        boxShadow: "0 14px 34px rgba(0,0,0,0.35)",
                        display: "grid",
                        placeItems: "center",
                        cursor: state.chapterIndex === 0 ? "default" : "pointer",
                        opacity: state.chapterIndex === 0 ? 0.45 : 1,
                        color: themeCfg.playButtonIcon,
                      }}
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M6 5v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M20 6.6v10.8c0 .8-.9 1.3-1.6.9l-8.2-5.4c-.7-.5-.7-1.5 0-1.9l8.2-5.4c.7-.4 1.6.1 1.6 1z" fill="currentColor" opacity="0.95" />
                      </svg>
                    </button>
                  )}

                  {/* Conic-gradient progress ring + central play/pause */}
                  <div
                    style={{
                      width: 112,
                      height: 112,
                      position: "relative",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    {/* Ring */}
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        borderRadius: "50%",
                        background: `conic-gradient(${themeCfg.progressColor} ${progressDegrees}deg, ${trackBg} ${progressDegrees}deg)`,
                        opacity: state.isPlaying ? 0.9 : 0.22,
                        transition: "opacity 280ms ease-out",
                        pointerEvents: "none",
                        zIndex: 0,
                      }}
                    >
                      {/* Inner cutout — matches the page background feel */}
                      <div
                        style={{
                          position: "absolute",
                          inset: 10,
                          borderRadius: "50%",
                          background: isDark
                            ? "rgba(15,23,42,1)"
                            : "rgba(248,250,252,0.95)",
                          pointerEvents: "none",
                        }}
                      />
                    </div>

                    {/* Play / Pause */}
                    <button
                      type="button"
                      onClick={() => {
                        setChapterPanelOpen(false);
                        state.isPlaying ? pause() : play();
                      }}
                      aria-label={state.isPlaying ? "Pause" : "Abspielen"}
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
                        zIndex: 2,
                      }}
                    >
                      {state.isPlaying ? (
                        <span style={{ display: "flex", gap: 5, alignItems: "center" }}>
                          <span style={{ width: 5, height: 18, borderRadius: 999, background: themeCfg.playButtonIcon }} />
                          <span style={{ width: 5, height: 18, borderRadius: 999, background: themeCfg.playButtonIcon }} />
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

                  {/* Skip next — story only */}
                  {isStory && (
                    <button
                      type="button"
                      onClick={nextChapter}
                      aria-label="Nächstes Kapitel"
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: "50%",
                        border: "none",
                        background: themeCfg.playButtonBg,
                        boxShadow: "0 14px 34px rgba(0,0,0,0.35)",
                        display: "grid",
                        placeItems: "center",
                        cursor:
                          state.chapterIndex >= state.chapters.length - 1
                            ? "default"
                            : "pointer",
                        opacity:
                          state.chapterIndex >= state.chapters.length - 1 ? 0.45 : 1,
                        color: themeCfg.playButtonIcon,
                      }}
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M18 5v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M4 6.6v10.8c0 .8.9 1.3 1.6.9l8.2-5.4c.7-.5.7-1.5 0-1.9L5.6 5.7C4.9 5.3 4 5.8 4 6.6z" fill="currentColor" opacity="0.95" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>

              {/* Scrub bar + time — above bottom safe area */}
              <div
                style={{ padding: "0 0 36px" }}
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  style={{ height: 20, cursor: "pointer", display: "flex", alignItems: "center" }}
                  onMouseDown={handleScrubMouseDown}
                  onTouchStart={handleScrubTouchStart}
                >
                  <div
                    style={{
                      width: "100%",
                      height: 4,
                      borderRadius: 999,
                      background: trackBg,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${displayProgress * 100}%`,
                        background: themeCfg.progressColor,
                        transition: scrubbing ? "none" : "width 80ms linear",
                      }}
                    />
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "0.8rem",
                    color: themeCfg.uiSoftText,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  <span>{formatTime(displayTime)}</span>
                  <span>{formatTime(state.duration)}</span>
                </div>
              </div>
            </div>

            {/* Chapter panel — slides in from bottom, story only */}
            {isStory && (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 88,
                  zIndex: 10,
                  padding: "0 20px 28px",
                  opacity: chapterPanelOpen ? 1 : 0,
                  transform: chapterPanelOpen ? "translateY(0)" : "translateY(16px)",
                  transition: "opacity 280ms ease-out, transform 280ms ease-out",
                  pointerEvents: chapterPanelOpen ? "auto" : "none",
                  boxSizing: "border-box",
                  cursor: "default",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  style={{
                    boxSizing: "border-box",
                    padding: 18,
                    paddingTop: 20,
                    paddingBottom: 22,
                    maxHeight: "44vh",
                    overflowY: "auto",
                    overscrollBehavior: "contain",
                  }}
                >
                  {/* Section header */}
                  <div
                    style={{
                      color: themeCfg.uiSoftText,
                      fontSize: "0.85rem",
                      fontWeight: 800,
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      marginBottom: 12,
                    }}
                  >
                    Kapitel
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {state.chapters.map((ch, idx) => {
                      const isActive = idx === state.chapterIndex;
                      return (
                        <button
                          key={ch.id}
                          type="button"
                          onClick={() => {
                            goToChapter(idx);
                            setChapterPanelOpen(false);
                          }}
                          style={{
                            border: `1px solid ${
                              isActive
                                ? themeCfg.secondaryButtonBorder
                                : "rgba(148,163,184,0.25)"
                            }`,
                            background: isActive
                              ? themeCfg.secondaryButtonBg
                              : isDark
                              ? "rgba(15,23,42,0.10)"
                              : "rgba(255,255,255,0.18)",
                            borderRadius: 999,
                            padding: "12px 16px",
                            cursor: "pointer",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            color: isActive ? themeCfg.secondaryButtonText : themeCfg.uiText,
                          }}
                        >
                          <div style={{ fontWeight: 900 }}>{idx + 1}</div>
                          {ch.durationSeconds ? (
                            <div
                              style={{
                                color: themeCfg.uiSoftText,
                                fontWeight: 700,
                                fontVariantNumeric: "tabular-nums",
                                fontSize: "0.9rem",
                              }}
                            >
                              {formatTime(ch.durationSeconds)}
                            </div>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
