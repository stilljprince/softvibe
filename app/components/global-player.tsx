// app/components/global-player.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { usePlayer } from "./player-context";
import { useSVTheme } from "./sv-kit";

// Pages with their own full-page player UI.
// The global bottom bar is hidden here, and playback is paused automatically
// when the user navigates to them.
// Known temporary: full cross-page exclusivity resolved in Phase 2.
const HIDDEN_PATHS = ["/s/", "/t/"];

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function GlobalPlayer() {
  const { state, play, pause, seek, openFullscreen, closeFullscreen } = usePlayer();
  const { themeKey, themeCfg } = useSVTheme();
  const pathname = usePathname();

  // Scrub state — position is tracked in a ref for use inside window-level
  // event listeners without stale closure issues, and mirrored to state for rendering.
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubPosition, setScrubPosition] = useState(0);
  const scrubPositionRef = useRef(0);

  const isDark = themeKey === "dark";

  // ── Exclusivity: pause when navigating to a dedicated player page ──────────
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

  if (!state.trackUrl || hidden) return null;

  const liveProgress = state.duration > 0 ? state.currentTime / state.duration : 0;
  const displayProgress = scrubbing ? scrubPosition : liveProgress;
  const displayTime = scrubbing
    ? scrubPosition * state.duration
    : state.currentTime;

  // ── Shared scrub handlers — used for both bottom bar and fullscreen ────────
  // Uses div + window listeners (same pattern as /s/[id]) so there are no
  // range-input rendering artefacts and the visual is fully under our control.

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

  const trackBg = isDark ? "rgba(148,163,184,0.18)" : "rgba(148,163,184,0.28)";

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
        {/* Scrub strip — at the top edge of the bar.
            12px tap target with the 3px visual bar at its bottom edge.
            Fully separated from the controls row below. */}
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

        {/* Controls row — padding-top clears the 12px scrub tap target */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 16px 12px",
          }}
        >
          {/* Title */}
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
          </div>

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
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 300,
            background: isDark
              ? "radial-gradient(circle at 0% 0%, #020617 0, #020617 10%, #0b1120 24%, #111827 42%, #1f2937 65%, #0ea5e9 120%)"
              : "radial-gradient(circle at 0% 0%, #fef3c7 0, #e0f2fe 40%, #e9d5ff 100%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "40px 32px",
          }}
        >
          {/* Close */}
          <button
            type="button"
            onClick={closeFullscreen}
            aria-label="Vollbild schließen"
            style={{
              position: "absolute",
              top: 20,
              right: 20,
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

          {/* Title */}
          <div
            style={{
              fontSize: "clamp(1.2rem, 4vw, 1.6rem)",
              fontWeight: 750,
              color: themeCfg.uiText,
              letterSpacing: "-0.02em",
              textAlign: "center",
              maxWidth: 560,
              marginBottom: 36,
              lineHeight: 1.3,
            }}
          >
            {state.trackTitle ?? ""}
          </div>

          {/* Large play / pause */}
          <button
            type="button"
            onClick={() => (state.isPlaying ? pause() : play())}
            aria-label={state.isPlaying ? "Pause" : "Abspielen"}
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              background: themeCfg.primaryButtonBg,
              color: themeCfg.primaryButtonText,
              border: "none",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              boxShadow: "0 14px 40px rgba(0,0,0,0.4)",
              marginBottom: 40,
            }}
          >
            {state.isPlaying ? (
              <svg width="22" height="22" viewBox="0 0 14 14" fill="currentColor">
                <rect x="2" y="1" width="4" height="12" rx="1" />
                <rect x="8" y="1" width="4" height="12" rx="1" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 11 11" fill="currentColor">
                <path d="M2.5 1.8l7 3.7-7 3.7z" />
              </svg>
            )}
          </button>

          {/* Scrub + time — div-based, same pattern as bottom bar */}
          <div style={{ width: "100%", maxWidth: 480 }}>
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
      )}
    </>
  );
}
