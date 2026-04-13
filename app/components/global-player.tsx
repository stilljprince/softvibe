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
    queue,
    currentQueueId,
    dequeueItem,
    clearQueue,
    nextInQueue,
    prevInQueue,
    playFromQueue,
    reorderQueue,
  } = usePlayer();
  const { themeKey, themeCfg } = useSVTheme();
  const pathname = usePathname();

  const isDark = themeKey === "dark";

  // True only when a multi-chapter story is loaded
  const isStory = !!state.storyId && state.chapters.length > 1;

  // ── Unified prev/next navigation ─────────────────────────────────────────
  const curQueueIdx = currentQueueId ? queue.findIndex((x) => x.queueId === currentQueueId) : -1;
  const hasQueuePrev = curQueueIdx > 0;
  const hasQueueNext = curQueueIdx + 1 < queue.length;
  const upcomingCount = queue.length - (curQueueIdx + 1);

  const canGoPrev = (isStory && state.chapterIndex > 0) || hasQueuePrev;
  const canGoNext = (isStory && state.chapterIndex < state.chapters.length - 1) || hasQueueNext;

  const handlePrev = () => {
    if (isStory && state.chapterIndex > 0) prevChapter();
    else if (hasQueuePrev) prevInQueue();
  };
  const handleNext = () => {
    if (isStory && state.chapterIndex < state.chapters.length - 1) nextChapter();
    else if (hasQueueNext) nextInQueue();
  };

  // Scrub state — position tracked in ref for stale-closure safety
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubPosition, setScrubPosition] = useState(0);
  const scrubPositionRef = useRef(0);

  // Chapter panel (fullscreen only)
  const [chapterPanelOpen, setChapterPanelOpen] = useState(false);

  // Queue drawer
  const [queuePanelOpen, setQueuePanelOpen] = useState(false);
  // Drag-and-drop state for queue reordering
  const dragSourceRef = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

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
      setQueuePanelOpen(false);
    }
  }, [pathname, pause]);

  // Close queue panel when player is cleared
  useEffect(() => {
    if (!state.trackUrl) setQueuePanelOpen(false);
  }, [state.trackUrl]);

  // Auto-close queue drawer when queue empties
  useEffect(() => {
    if (queue.length === 0 && queuePanelOpen) setQueuePanelOpen(false);
  }, [queue.length, queuePanelOpen]);

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

        {/* Controls row — 3-column layout for centered playback */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 16px 12px",
          }}
        >
          {/* Left — title + subtitle(s) */}
          <div style={{ flex: "1 1 0", minWidth: 0 }}>
            {/* Primary: story title or track title */}
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
              {isStory ? (state.storyTitle ?? state.trackTitle ?? "Wird geladen…") : (state.trackTitle ?? "Wird geladen…")}
            </div>

            {isStory ? (
              <>
                {/* Secondary: current chapter position — always shown for stories */}
                <div style={{ fontSize: "0.7rem", color: themeCfg.uiSoftText, marginTop: 1, whiteSpace: "nowrap" }}>
                  Kapitel {state.chapterIndex + 1} von {state.chapters.length}
                </div>
                {/* Tertiary: next step — next chapter, or next queue item after last chapter */}
                {state.chapterIndex < state.chapters.length - 1 ? (
                  <div style={{ fontSize: "0.68rem", color: themeCfg.uiSoftText, marginTop: 1, whiteSpace: "nowrap", opacity: 0.7 }}>
                    Als Nächstes: Kapitel {state.chapterIndex + 2}
                  </div>
                ) : upcomingCount > 0 ? (
                  <div style={{ fontSize: "0.68rem", color: themeCfg.uiSoftText, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: 0.7 }}>
                    Als Nächstes: {queue[curQueueIdx + 1]?.title ?? queue[0]?.title}
                  </div>
                ) : null}
              </>
            ) : upcomingCount > 0 ? (
              <div style={{ fontSize: "0.7rem", color: themeCfg.uiSoftText, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                Als Nächstes: {queue[curQueueIdx + 1]?.title ?? queue[0]?.title}
              </div>
            ) : null}
          </div>

          {/* Center — prev | play/pause | next */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {/* Prev */}
            <button
              type="button"
              onClick={handlePrev}
              aria-label="Zurück"
              style={{
                width: 28, height: 28, borderRadius: "50%",
                background: "transparent",
                border: `1px solid ${themeCfg.secondaryButtonBorder}`,
                color: themeCfg.uiSoftText,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                cursor: canGoPrev ? "pointer" : "default",
                flexShrink: 0,
                opacity: canGoPrev ? 0.8 : 0.25,
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 5v14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                <path d="M20 6.6v10.8c0 .8-.9 1.3-1.6.9l-8.2-5.4c-.7-.5-.7-1.5 0-1.9l8.2-5.4c.7-.4 1.6.1 1.6 1z" fill="currentColor" />
              </svg>
            </button>

            {/* Play / Pause */}
            <button
              type="button"
              onClick={() => (state.isPlaying ? pause() : play())}
              aria-label={state.isPlaying ? "Pause" : "Abspielen"}
              style={{
                width: 34, height: 34, borderRadius: "50%",
                background: themeCfg.primaryButtonBg, color: themeCfg.primaryButtonText,
                border: "none",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", flexShrink: 0,
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

            {/* Next */}
            <button
              type="button"
              onClick={handleNext}
              aria-label="Weiter"
              style={{
                width: 28, height: 28, borderRadius: "50%",
                background: "transparent",
                border: `1px solid ${themeCfg.secondaryButtonBorder}`,
                color: themeCfg.uiSoftText,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                cursor: canGoNext ? "pointer" : "default",
                flexShrink: 0,
                opacity: canGoNext ? 0.8 : 0.25,
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M18 5v14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                <path d="M4 6.6v10.8c0 .8.9 1.3 1.6.9l8.2-5.4c.7-.5.7-1.5 0-1.9L5.6 5.7C4.9 5.3 4 5.8 4 6.6z" fill="currentColor" />
              </svg>
            </button>
          </div>

          {/* Right — time + fullscreen + queue */}
          <div style={{ flex: "1 1 0", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
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
                width: 32, height: 32, borderRadius: "50%",
                background: "transparent",
                border: `1px solid ${themeCfg.secondaryButtonBorder}`,
                color: themeCfg.uiSoftText,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", flexShrink: 0,
              }}
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M1 5V1h4M11 1h4v4M15 11v4h-4M5 15H1v-4" />
              </svg>
            </button>

            {/* Queue toggle */}
            <button
              type="button"
              onClick={() => setQueuePanelOpen((v) => !v)}
              aria-label="Warteschlange"
              style={{
                width: 32, height: 32, borderRadius: "50%",
                background: queuePanelOpen ? themeCfg.secondaryButtonBg : "transparent",
                border: `1px solid ${themeCfg.secondaryButtonBorder}`,
                color: queuePanelOpen ? themeCfg.uiText : themeCfg.uiSoftText,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", flexShrink: 0, position: "relative",
                transition: "background 150ms ease, color 150ms ease",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <rect x="5" y="1" width="11" height="2" rx="1" />
                <rect x="5" y="7" width="11" height="2" rx="1" />
                <rect x="5" y="13" width="7" height="2" rx="1" />
                <circle cx="1.5" cy="2" r="1.5" />
                <circle cx="1.5" cy="8" r="1.5" />
                <circle cx="1.5" cy="14" r="1.5" />
              </svg>
              {upcomingCount > 0 && (
                <span
                  style={{
                    position: "absolute", top: -3, right: -3,
                    minWidth: 14, height: 14, borderRadius: 999,
                    background: themeCfg.primaryButtonBg, color: themeCfg.primaryButtonText,
                    fontSize: "0.55rem", fontWeight: 800,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    padding: "0 3px", lineHeight: 1,
                  }}
                >
                  {upcomingCount > 9 ? "9+" : upcomingCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Queue drawer backdrop ───────────────────────────────────────────── */}
      {/* Always mounted so the fade transition plays on open/close */}
      <div
        aria-hidden="true"
        onClick={() => setQueuePanelOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: state.isFullscreen ? 349 : 249,
          background: "rgba(0,0,0,0.46)",
          opacity: queuePanelOpen ? 1 : 0,
          pointerEvents: queuePanelOpen ? "auto" : "none",
          transition: "opacity 260ms ease",
        }}
      />

      {/* ── Queue drawer ────────────────────────────────────────────────────── */}
      <div
        role="dialog"
        aria-label="Warteschlange"
        aria-modal="true"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(380px, 100vw)",
          zIndex: state.isFullscreen ? 350 : 250,
          display: "flex",
          flexDirection: "column",
          background: isDark ? "rgba(10,15,30,0.97)" : "rgba(248,250,252,0.98)",
          backdropFilter: "blur(28px)",
          WebkitBackdropFilter: "blur(28px)",
          borderLeft: `1px solid ${isDark ? "rgba(148,163,184,0.14)" : "rgba(148,163,184,0.30)"}`,
          boxShadow: isDark
            ? "-8px 0 40px rgba(0,0,0,0.55)"
            : "-8px 0 40px rgba(15,23,42,0.12)",
          transform: queuePanelOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 300ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        {/* Drawer header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "18px 20px 14px",
            flexShrink: 0,
            borderBottom: `1px solid ${isDark ? "rgba(148,163,184,0.10)" : "rgba(148,163,184,0.18)"}`,
          }}
        >
          <span style={{ flex: "1 1 0", fontWeight: 800, fontSize: "0.9rem", color: themeCfg.uiText }}>
            Warteschlange
            {queue.length > 0 && (
              <span style={{ fontWeight: 500, color: themeCfg.uiSoftText, marginLeft: 8, fontSize: "0.82rem" }}>
                {queue.length} {queue.length === 1 ? "Titel" : "Titel"}
              </span>
            )}
          </span>
          {queue.length > 0 && (
            <button
              type="button"
              onClick={clearQueue}
              style={{
                padding: "5px 12px",
                borderRadius: 999,
                border: `1px solid ${isDark ? "rgba(148,163,184,0.22)" : "rgba(148,163,184,0.40)"}`,
                background: "transparent",
                color: themeCfg.uiSoftText,
                fontSize: "0.74rem",
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              Leeren
            </button>
          )}
          <button
            type="button"
            onClick={() => setQueuePanelOpen(false)}
            aria-label="Warteschlange schließen"
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              border: `1px solid ${isDark ? "rgba(148,163,184,0.18)" : "rgba(148,163,184,0.32)"}`,
              background: "transparent",
              color: themeCfg.uiSoftText,
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
              transition: "background 150ms ease",
            }}
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>

        {/* Now playing context */}
        {state.trackTitle && (
          <div
            style={{
              padding: "12px 20px 10px",
              flexShrink: 0,
              borderBottom: `1px solid ${isDark ? "rgba(148,163,184,0.07)" : "rgba(148,163,184,0.13)"}`,
            }}
          >
            <div style={{ fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: themeCfg.uiSoftText, marginBottom: 4 }}>
              Läuft gerade
            </div>
            <div style={{ fontSize: "0.85rem", fontWeight: 600, color: themeCfg.uiText, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {isStory ? (state.storyTitle ?? state.trackTitle) : state.trackTitle}
            </div>
            {isStory && (
              <div style={{ fontSize: "0.72rem", color: themeCfg.uiSoftText, marginTop: 2 }}>
                Kapitel {state.chapterIndex + 1} von {state.chapters.length}
              </div>
            )}
          </div>
        )}

        {/* Queue list */}
        <div style={{ overflowY: "auto", overscrollBehavior: "contain", flex: "1 1 0" }}>
          {queue.length === 0 ? (
            <div
              style={{
                padding: "40px 20px",
                textAlign: "center",
                fontSize: "0.85rem",
                color: themeCfg.uiSoftText,
                lineHeight: 1.6,
              }}
            >
              <div style={{ fontSize: "1.4rem", marginBottom: 10, opacity: 0.4 }}>♪</div>
              Warteschlange ist leer.
            </div>
          ) : (
            <>
              {/* History items — played, shown dimmed, clickable to replay */}
              {curQueueIdx > 0 && (
                <>
                  <div style={{ padding: "12px 20px 6px", fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: themeCfg.uiSoftText }}>
                    Verlauf
                  </div>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, opacity: 0.38 }}>
                    {queue.slice(0, curQueueIdx).map((item, idx) => (
                      <li
                        key={item.queueId}
                        style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px 10px 14px" }}
                      >
                        <span style={{ fontSize: "0.72rem", color: themeCfg.uiSoftText, fontWeight: 600, minWidth: 16, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                          {idx + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => playFromQueue(item.queueId)}
                          style={{ flex: "1 1 0", minWidth: 0, fontSize: "0.875rem", fontWeight: 600, color: themeCfg.uiText, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.35, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
                        >
                          {item.title}
                        </button>
                        <button
                          type="button"
                          onClick={() => dequeueItem(item.queueId)}
                          aria-label={`${item.title} aus Warteschlange entfernen`}
                          style={{ flexShrink: 0, width: 30, height: 30, borderRadius: "50%", border: `1px solid ${isDark ? "rgba(148,163,184,0.16)" : "rgba(148,163,184,0.32)"}`, background: "transparent", color: themeCfg.uiSoftText, cursor: "pointer", display: "grid", placeItems: "center" }}
                        >
                          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M2 2l8 8M10 2l-8 8" /></svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {/* Upcoming items — draggable, clickable to play */}
              {upcomingCount > 0 && (
                <>
                  <div style={{ padding: "12px 20px 6px", fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: themeCfg.uiSoftText }}>
                    Als Nächstes
                    <span style={{ fontWeight: 500, marginLeft: 6, opacity: 0.65 }}>{upcomingCount} {upcomingCount === 1 ? "Titel" : "Titel"}</span>
                  </div>
                  <ul style={{ listStyle: "none", margin: 0, padding: "0 0 100px" }}>
                    {queue.slice(curQueueIdx + 1).map((item, relIdx) => {
                      const absoluteIdx = curQueueIdx + 1 + relIdx;
                      const isDropTarget = dragOverIdx === absoluteIdx;
                      return (
                        <li
                          key={item.queueId}
                          draggable
                          onDragStart={(e) => {
                            dragSourceRef.current = absoluteIdx;
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            if (dragOverIdx !== absoluteIdx) setDragOverIdx(absoluteIdx);
                          }}
                          onDragLeave={(e) => {
                            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverIdx(null);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            const from = dragSourceRef.current;
                            if (from !== null && from !== absoluteIdx) reorderQueue(from, absoluteIdx);
                            dragSourceRef.current = null;
                            setDragOverIdx(null);
                          }}
                          onDragEnd={() => { dragSourceRef.current = null; setDragOverIdx(null); }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            padding: "12px 16px 12px 14px",
                            borderTop: isDropTarget ? `2px solid ${themeCfg.progressColor}` : "2px solid transparent",
                            transition: "border-color 100ms ease, background 100ms ease",
                            cursor: "default",
                          }}
                        >
                          {/* Drag handle */}
                          <span
                            title="Ziehen zum Sortieren"
                            style={{ flexShrink: 0, color: themeCfg.uiSoftText, opacity: 0.4, cursor: "grab", display: "flex", alignItems: "center", padding: "4px 2px", userSelect: "none" }}
                          >
                            <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
                              <circle cx="2.5" cy="2.5" r="1.5" /><circle cx="7.5" cy="2.5" r="1.5" />
                              <circle cx="2.5" cy="7" r="1.5" /><circle cx="7.5" cy="7" r="1.5" />
                              <circle cx="2.5" cy="11.5" r="1.5" /><circle cx="7.5" cy="11.5" r="1.5" />
                            </svg>
                          </span>

                          {/* Index */}
                          <span style={{ fontSize: "0.72rem", color: themeCfg.uiSoftText, fontWeight: 600, minWidth: 16, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                            {absoluteIdx + 1}
                          </span>

                          {/* Title — clickable to play immediately */}
                          <button
                            type="button"
                            onClick={() => playFromQueue(item.queueId)}
                            style={{ flex: "1 1 0", minWidth: 0, fontSize: "0.875rem", fontWeight: 600, color: themeCfg.uiText, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.35, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
                          >
                            {item.title}
                            {item.storyId && (
                              <span style={{ marginLeft: 6, fontSize: "0.7rem", opacity: 0.55, fontWeight: 500 }}>Story</span>
                            )}
                          </button>

                          {/* Remove */}
                          <button
                            type="button"
                            onClick={() => dequeueItem(item.queueId)}
                            aria-label={`${item.title} aus Warteschlange entfernen`}
                            style={{ flexShrink: 0, width: 30, height: 30, borderRadius: "50%", border: `1px solid ${isDark ? "rgba(148,163,184,0.16)" : "rgba(148,163,184,0.32)"}`, background: "transparent", color: themeCfg.uiSoftText, cursor: "pointer", display: "grid", placeItems: "center", transition: "background 120ms ease" }}
                          >
                            <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M2 2l8 8M10 2l-8 8" /></svg>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}

              {/* Played through — no upcoming items left */}
              {upcomingCount === 0 && queue.length > 0 && (
                <div style={{ padding: "24px 20px", textAlign: "center", fontSize: "0.82rem", color: themeCfg.uiSoftText, opacity: 0.6 }}>
                  Warteschlange beendet
                </div>
              )}
            </>
          )}
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
              {/* Top bar: close+queue left, chapters toggle right (story only) */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexShrink: 0,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Left: close + queue */}
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <button
                    type="button"
                    onClick={closeFullscreen}
                    aria-label="Vollbild schließen"
                    style={{
                      width: 40, height: 40, borderRadius: "50%",
                      background: "transparent",
                      border: `1px solid ${themeCfg.secondaryButtonBorder}`,
                      color: themeCfg.uiText,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", fontSize: "1rem",
                    }}
                  >
                    ✕
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setQueuePanelOpen((v) => !v); }}
                    aria-label="Warteschlange"
                    style={{
                      width: 40, height: 40, borderRadius: "50%",
                      background: "transparent",
                      border: `1px solid ${themeCfg.secondaryButtonBorder}`,
                      color: themeCfg.uiSoftText,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", position: "relative",
                      transition: "background 150ms ease",
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                      <rect x="5" y="1" width="11" height="2" rx="1" />
                      <rect x="5" y="7" width="11" height="2" rx="1" />
                      <rect x="5" y="13" width="7" height="2" rx="1" />
                      <circle cx="1.5" cy="2" r="1.5" />
                      <circle cx="1.5" cy="8" r="1.5" />
                      <circle cx="1.5" cy="14" r="1.5" />
                    </svg>
                    {upcomingCount > 0 && (
                      <span style={{ position: "absolute", top: -2, right: -2, minWidth: 13, height: 13, borderRadius: 999, background: themeCfg.primaryButtonBg, color: themeCfg.primaryButtonText, fontSize: "0.5rem", fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 2px", lineHeight: 1 }}>
                        {upcomingCount > 9 ? "9+" : upcomingCount}
                      </span>
                    )}
                  </button>
                </div>

                {/* Chapter list toggle — story only */}
                {isStory && (
                  <button
                    type="button"
                    onClick={() => setChapterPanelOpen((v) => !v)}
                    aria-label="Kapitelübersicht"
                    style={{
                      width: 40, height: 40, borderRadius: "50%",
                      background: chapterPanelOpen ? themeCfg.secondaryButtonBg : "transparent",
                      border: `1px solid ${themeCfg.secondaryButtonBorder}`,
                      color: themeCfg.uiSoftText,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", transition: "background 150ms ease",
                    }}
                  >
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
                  {isStory ? (state.storyTitle ?? state.trackTitle ?? "") : (state.trackTitle ?? "")}
                </div>

                {/* Chapter + next-step subtitles — story only */}
                {isStory && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, marginBottom: 32 }}>
                    <div style={{ fontSize: "0.88rem", color: themeCfg.uiSoftText }}>
                      Kapitel {state.chapterIndex + 1} von {state.chapters.length}
                    </div>
                    {state.chapterIndex < state.chapters.length - 1 ? (
                      <div style={{ fontSize: "0.78rem", color: themeCfg.uiSoftText, opacity: 0.6 }}>
                        Als Nächstes: Kapitel {state.chapterIndex + 2}
                      </div>
                    ) : upcomingCount > 0 ? (
                      <div style={{ fontSize: "0.78rem", color: themeCfg.uiSoftText, opacity: 0.6, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        Als Nächstes: {queue[curQueueIdx + 1]?.title ?? queue[0]?.title}
                      </div>
                    ) : null}
                  </div>
                )}

                {/* Controls cluster */}
                <div
                  style={{ display: "flex", alignItems: "center", gap: 16 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Prev */}
                  <button
                    type="button"
                    onClick={handlePrev}
                    aria-label="Zurück"
                    style={{
                      width: 64, height: 64, borderRadius: "50%",
                      border: "none",
                      background: themeCfg.playButtonBg,
                      boxShadow: "0 14px 34px rgba(0,0,0,0.35)",
                      display: "grid", placeItems: "center",
                      cursor: canGoPrev ? "pointer" : "default",
                      opacity: canGoPrev ? 1 : 0.28,
                      color: themeCfg.playButtonIcon,
                    }}
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M6 5v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M20 6.6v10.8c0 .8-.9 1.3-1.6.9l-8.2-5.4c-.7-.5-.7-1.5 0-1.9l8.2-5.4c.7-.4 1.6.1 1.6 1z" fill="currentColor" opacity="0.95" />
                    </svg>
                  </button>

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

                  {/* Next */}
                  <button
                    type="button"
                    onClick={handleNext}
                    aria-label="Weiter"
                    style={{
                      width: 64, height: 64, borderRadius: "50%",
                      border: "none",
                      background: themeCfg.playButtonBg,
                      boxShadow: "0 14px 34px rgba(0,0,0,0.35)",
                      display: "grid", placeItems: "center",
                      cursor: canGoNext ? "pointer" : "default",
                      opacity: canGoNext ? 1 : 0.28,
                      color: themeCfg.playButtonIcon,
                    }}
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M18 5v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M4 6.6v10.8c0 .8.9 1.3 1.6.9l8.2-5.4c.7-.5.7-1.5 0-1.9L5.6 5.7C4.9 5.3 4 5.8 4 6.6z" fill="currentColor" opacity="0.95" />
                    </svg>
                  </button>
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
                  {/* Section header with inline prev/next */}
                  <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
                    <div style={{ flex: 1, color: themeCfg.uiSoftText, fontSize: "0.85rem", fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase" }}>
                      Kapitel
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        onClick={handlePrev}
                        aria-label="Zurück"
                        style={{ width: 30, height: 30, borderRadius: "50%", border: `1px solid ${themeCfg.secondaryButtonBorder}`, background: "transparent", color: themeCfg.uiSoftText, display: "grid", placeItems: "center", cursor: canGoPrev ? "pointer" : "default", opacity: canGoPrev ? 0.85 : 0.25 }}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M6 5v14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                          <path d="M20 6.6v10.8c0 .8-.9 1.3-1.6.9l-8.2-5.4c-.7-.5-.7-1.5 0-1.9l8.2-5.4c.7-.4 1.6.1 1.6 1z" fill="currentColor" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={handleNext}
                        aria-label="Weiter"
                        style={{ width: 30, height: 30, borderRadius: "50%", border: `1px solid ${themeCfg.secondaryButtonBorder}`, background: "transparent", color: themeCfg.uiSoftText, display: "grid", placeItems: "center", cursor: canGoNext ? "pointer" : "default", opacity: canGoNext ? 0.85 : 0.25 }}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M18 5v14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                          <path d="M4 6.6v10.8c0 .8.9 1.3 1.6.9l8.2-5.4c.7-.5.7-1.5 0-1.9L5.6 5.7C4.9 5.3 4 5.8 4 6.6z" fill="currentColor" />
                        </svg>
                      </button>
                    </div>
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
