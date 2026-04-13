"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { THEMES, type ThemeKey } from "@/app/components/sv-kit";

type Chapter = {
  id: string;
  url: string;
  durationSeconds?: number | null;
  storyTitle?: string | null;
  partIndex?: number | null;
};

let CURRENT_AUDIO: HTMLAudioElement | null = null;

const UI_HIDE_DELAY_MS = 2500;
const CHAPTER_PAUSE_MS = 500;
const FIRST_CHAPTER_PAUSE_MS = 900; // first boundary is narratively weaker — needs more breathing room



function formatTime(seconds?: number | null) {
  if (!seconds || seconds <= 0) return "—";
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function IconSkipPrev({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 5v14" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path
        d="M20 6.6v10.8c0 .8-.9 1.3-1.6.9l-8.2-5.4c-.7-.5-.7-1.5 0-1.9l8.2-5.4c.7-.4 1.6.1 1.6 1z"
        fill={color}
        opacity="0.95"
      />
    </svg>
  );
}

function IconSkipNext({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18 5v14" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path
        d="M4 6.6v10.8c0 .8.9 1.3 1.6.9l8.2-5.4c.7-.5.7-1.5 0-1.9L5.6 5.7C4.9 5.3 4 5.8 4 6.6z"
        fill={color}
        opacity="0.95"
      />
    </svg>
  );
}

export default function StoryClient({ storyId }: { storyId: string }) {
  const router = useRouter();

  // Theme
  const [theme, setTheme] = useState<ThemeKey>("dark");
  const themeCfg = THEMES[theme];
  const logoSrc = theme === "dark" ? "/softvibe-logo-dark.svg" : "/softvibe-logo-pastel.svg";

  useEffect(() => {
    const saved = window.localStorage.getItem("sv-theme");
    if (saved === "light" || saved === "pastel" || saved === "dark") setTheme(saved);
  }, []);
  useEffect(() => {
    window.localStorage.setItem("sv-theme", theme);
  }, [theme]);

  const cycleTheme = () => {
    setTheme((p) => (p === "light" ? "pastel" : p === "pastel" ? "dark" : "light"));
  };

  // Fullscreen
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fsHover, setFsHover] = useState(false);
  const [fsActive, setFsActive] = useState(false);

                    const onBackgroundClick = () => {
                    // wenn panel offen: panel zu (aber nicht play togglen)
                    if (panelVisible) {
                        setPanelVisible(false);
                        return;
                    }
                    togglePlayPause();
                    };

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

  // Chapters (preload on mount!)
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loadingChapters, setLoadingChapters] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);

  // Panel: visible by default, closes on play OR clicking outside panel
  const [panelVisible, setPanelVisible] = useState(true);

  // Persist last played chapter per story
  const storageKey = useMemo(() => `sv-story-last:${storyId}`, [storyId]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      setLoadingChapters(true);
      try {
        const res = await fetch(
          `/api/tracks?storyId=${encodeURIComponent(storyId)}&take=200`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          router.push("/library");
          return;
        }

        const raw = await res.json();
        const data = raw?.data ?? raw;
        const items: Chapter[] = Array.isArray(data?.items)
          ? data.items
          : Array.isArray(data)
          ? data
          : [];

        items.sort((a, b) => (a.partIndex ?? 0) - (b.partIndex ?? 0));
        if (!mounted) return;

        setChapters(items);

        // restore last idx
        const saved = window.localStorage.getItem(storageKey);
        const savedIdx = saved ? Number(saved) : NaN;
        const initialIdx =
          Number.isFinite(savedIdx) && savedIdx >= 0 && savedIdx < items.length ? savedIdx : 0;

        setActiveIdx(initialIdx);
      } finally {
        if (mounted) setLoadingChapters(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [router, storyId, storageKey]);

  // Audio
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const preloadRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const wasPlayingRef = useRef(false);
  const [progress, setProgress] = useState(0);
  const scrubDraggingRef = useRef(false);
  // Set to true by onEnded when the chapter transition is handled imperatively.
  // Tells the "Apply src" effect to skip its reload for that chapter change.
  const skipNextLoadRef = useRef(false);
  // Kept in sync with activeIdx/chapters so zero-dep event handlers can read
  // current values without stale closures.
  const isLastChapterRef = useRef(false);
  const currentChapterDurationRef = useRef<number>(0);
  // Timer and RAF handles for the end-of-chapter volume ramp.
  const rampTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rampRafRef = useRef<number | null>(null);
  // Timer handle for the intentional inter-chapter pause.
  const chapterPauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // UI auto-hide
  const [controlsVisible, setControlsVisible] = useState(true);
  const uiHideTimerRef = useRef<number | null>(null);

  useEffect(() => {
  const scheduleHide = () => {
    if (uiHideTimerRef.current) window.clearTimeout(uiHideTimerRef.current);
    if (!isPlaying) return;
    uiHideTimerRef.current = window.setTimeout(() => setControlsVisible(false), UI_HIDE_DELAY_MS);
  };


  
  const onActivity = () => {
    setControlsVisible(true);
    scheduleHide();
  };

  window.addEventListener("mousemove", onActivity);
  window.addEventListener("keydown", onActivity);
  window.addEventListener("scroll", onActivity, { passive: true }); // ✅ scroll zählt als Aktivität

  scheduleHide();

  return () => {
    window.removeEventListener("mousemove", onActivity);
    window.removeEventListener("keydown", onActivity);
    window.removeEventListener("scroll", onActivity); // ✅ kein any
    if (uiHideTimerRef.current) window.clearTimeout(uiHideTimerRef.current);
  };
}, [isPlaying]);

useEffect(() => {
  const cls = "sv-hide-cursor";
  const el = document.documentElement; // <html>

  if (!controlsVisible) el.classList.add(cls);
  else el.classList.remove(cls);

  return () => el.classList.remove(cls);
}, [controlsVisible]);

  const storyTitle = useMemo(() => (chapters[0]?.storyTitle ?? "Story").trim(), [chapters]);
  const active = chapters[activeIdx];
  // Keep refs synchronous with render so zero-dep event handlers read current values.
  isLastChapterRef.current = activeIdx >= chapters.length - 1;
  currentChapterDurationRef.current = chapters[activeIdx]?.durationSeconds ?? 0;

useEffect(() => {
  if (!panelVisible) return;

  const onDown = (e: MouseEvent) => {
    const panel = document.getElementById("sv-chapter-panel");
    const controls = document.getElementById("sv-controls");

    // Klick im Panel => nichts
    if (panel && panel.contains(e.target as Node)) return;

    // Klick in Controls/Header => nichts (sonst killt es den Play-Click)
    if (controls && controls.contains(e.target as Node)) return;

    // sonst schließen
    setPanelVisible(false);
  };

  window.addEventListener("mousedown", onDown);
  return () => window.removeEventListener("mousedown", onDown);
}, [panelVisible]);

  // Preload the next chapter while the current one plays so chapter transitions
  // are instant rather than waiting for a cold network load.
  useEffect(() => {
    const next = chapters[activeIdx + 1];
    const pre = preloadRef.current;
    if (!pre || !next?.url) return;
    if (pre.src !== next.url) {
      pre.src = next.url;
      pre.load();
    }
  }, [chapters, activeIdx]);

  // Apply src whenever active changes (preload should happen automatically)
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !active?.url) return;

    // Automatic chapter transition: onEnded already set src + called load() + play()
    // imperatively on the same tick as the ended event. Skip the duplicate reload here
    // to avoid an unnecessary network round-trip and audible gap.
    if (skipNextLoadRef.current) {
      skipNextLoadRef.current = false;
      window.localStorage.setItem(storageKey, String(activeIdx));
      return;
    }

    // Manual chapter change or initial load — perform a full reload.
    const shouldAutoPlay = wasPlayingRef.current;

    a.pause();
    setIsPlaying(false);
    setProgress(0);

    if (CURRENT_AUDIO && CURRENT_AUDIO !== a) CURRENT_AUDIO.pause();
    CURRENT_AUDIO = a;

    a.src = active.url;
    a.load();

    if (shouldAutoPlay) {
      void a.play().catch(() => {});
      setIsPlaying(true);
    }
  }, [active?.url, activeIdx, storageKey]);

  // Audio events + auto-next
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    // Cancel any in-flight ramp timer or RAF loop.
    const cancelFade = () => {
      if (rampTimerRef.current !== null) { clearTimeout(rampTimerRef.current); rampTimerRef.current = null; }
      if (rampRafRef.current !== null) { cancelAnimationFrame(rampRafRef.current); rampRafRef.current = null; }
    };

    const cancelChapterPause = () => {
      if (chapterPauseTimerRef.current !== null) {
        clearTimeout(chapterPauseTimerRef.current);
        chapterPauseTimerRef.current = null;
      }
    };

    // Schedule a smooth RAF-based volume ramp starting 1s before chapter end.
    // Keyed off durationSeconds from chapter metadata (server-computed via music-metadata),
    // so it is reliable on the FIRST play — unlike audio.duration which may not be
    // available until the audio file is fully parsed by the browser.
    const scheduleFade = (durationSec: number) => {
      cancelFade();
      if (isLastChapterRef.current || durationSec <= 1.5) return;
      // Conservative: 0.5s fade (was 1.0s) to reduce the window where durationSeconds
      // undershooting real playback duration causes dead air.
      // Floor at 0.08 (not 0) — audio stays nearly inaudible until onEnded fires,
      // preventing multi-second silence if the fade completes before the audio ends.
      const RAMP_SEC = 0.5;
      const RAMP_FLOOR = 0.08;
      const delayMs = Math.max(0, (durationSec - RAMP_SEC) * 1000);
      rampTimerRef.current = setTimeout(() => {
        rampTimerRef.current = null;
        if (isLastChapterRef.current) return; // chapter may have changed
        const rampStart = performance.now();
        const rampMs = RAMP_SEC * 1000;
        const tick = () => {
          const t = Math.min(1, (performance.now() - rampStart) / rampMs);
          a.volume = Math.max(RAMP_FLOOR, 1 - t);
          if (t < 1) { rampRafRef.current = requestAnimationFrame(tick); }
          else { rampRafRef.current = null; }
        };
        rampRafRef.current = requestAnimationFrame(tick);
      }, delayMs);
    };

    const onPlay = () => {
      setIsPlaying(true);
      // Schedule the fade every time playback (re)starts so it works on first play.
      scheduleFade(currentChapterDurationRef.current);
    };

    const onPause = () => setIsPlaying(false);

    const onEnded = () => {
      cancelFade();
      cancelChapterPause(); // defensive: clear any orphaned timer
      setProgress(0);
      if (activeIdx < chapters.length - 1) {
        const nextIdx = activeIdx + 1;
        const nextChapter = chapters[nextIdx];
        if (a && nextChapter?.url) {
          a.volume = 1;
          skipNextLoadRef.current = true;
          a.src = nextChapter.url;
          a.load(); // buffer immediately — don't wait for the pause timer
          wasPlayingRef.current = true;

          // Intentional pause before next chapter starts. a.load() fires now so
          // the browser has time to buffer before playback begins.
          // First transition gets a longer pause — the narrative boundary at ~2500
          // chars is typically weaker than later splits.
          const pauseMs = activeIdx === 0 ? FIRST_CHAPTER_PAUSE_MS : CHAPTER_PAUSE_MS;
          chapterPauseTimerRef.current = setTimeout(() => {
            chapterPauseTimerRef.current = null;
            // Guard: only play if user hasn't paused or skipped during the gap.
            if (wasPlayingRef.current && a.src === nextChapter.url) {
              void a.play().catch(() => {});
              setIsPlaying(true);
            }
          }, pauseMs);
        }
        setActiveIdx(nextIdx); // update chapter indicator immediately
      } else {
        setIsPlaying(false);
        wasPlayingRef.current = false;
        setControlsVisible(true);
      }
    };

    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);
    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
      cancelFade();
      // NOTE: do NOT cancel chapterPauseTimerRef here — onEnded sets the timer
      // and then updates activeIdx, which triggers this cleanup. Cancelling here
      // kills the play() call before it fires. The timer is already guarded and
      // cancelled in togglePlayPause, skip, and selectChapterAndPlay.
    };
  }, [activeIdx, chapters.length]);

  // Clean up the chapter-pause timer on unmount only (empty deps).
  useEffect(() => {
    return () => {
      if (chapterPauseTimerRef.current !== null) {
        clearTimeout(chapterPauseTimerRef.current);
        chapterPauseTimerRef.current = null;
      }
    };
  }, []);


                    // ✅ Panel via scroll (manual/scroll)
                    useEffect(() => {
                    let lastY = window.scrollY || 0;

                    const onScroll = () => {
                        const y = window.scrollY || 0;
                        const delta = y - lastY;

                        // kleine Zitterbewegungen ignorieren
                        if (Math.abs(delta) < 2) return;

                        // runter scrollen => Panel auf
                        if (delta > 0) setPanelVisible(true);

                        // hoch scrollen => Panel zu (wenn du wieder Richtung top gehst)
                        if (delta < 0 && y < 60) setPanelVisible(false);

                        lastY = y;
                    };

                    window.addEventListener("scroll", onScroll, { passive: true });
                    return () => window.removeEventListener("scroll", onScroll);
                    }, []);



  // Progress tracking via timeupdate — driven by the audio element directly,
  // not by isPlaying state. Immune to chapter-switch state sync races.
  // Also provides a backup ramp for chapters whose durationSeconds is missing or zero,
  // i.e. cases where the timer-based ramp (scheduleFade) couldn't activate.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTimeUpdate = () => {
      if (a.duration && !Number.isNaN(a.duration) && a.duration > 0) {
        setProgress(Math.max(0, Math.min(a.currentTime / a.duration, 1)));
        // Backup ramp: activates only when no timer or RAF ramp is running AND
        // durationSeconds was not available (so scheduleFade never fired).
        // Uses audio.duration which IS reliable once the browser has parsed the file.
        // This covers the edge case; the primary ramp is the timer in scheduleFade.
        if (
          !isLastChapterRef.current &&
          rampTimerRef.current === null &&
          rampRafRef.current === null &&
          a.volume > 0.05
        ) {
          const remaining = a.duration - a.currentTime;
          if (remaining < 0.8 && remaining >= 0) {
            // Math.min ensures we only ever decrease volume here, never increase it.
            // Without this, the backup ramp could boost volume back up after the
            // primary ramp has already faded it down.
            a.volume = Math.min(a.volume, Math.max(0, remaining / 0.8));
          }
        }
      }
    };
    a.addEventListener("timeupdate", onTimeUpdate);
    return () => a.removeEventListener("timeupdate", onTimeUpdate);
  }, []);

  const togglePlayPause = () => {
    const a = audioRef.current;
    if (!a) return;

    // Cancel any pending chapter-pause timer so toggle takes effect immediately.
    if (chapterPauseTimerRef.current !== null) {
      clearTimeout(chapterPauseTimerRef.current);
      chapterPauseTimerRef.current = null;
    }

    // panel soll weg, wenn play gedrückt wird
    setPanelVisible(false);

    if (!active?.url) return; // noch nicht geladen

    if (CURRENT_AUDIO && CURRENT_AUDIO !== a) CURRENT_AUDIO.pause();
    CURRENT_AUDIO = a;

    if (a.paused) {
      wasPlayingRef.current = true;
      void a.play().catch(() => {});
      setIsPlaying(true);
    } else {
      wasPlayingRef.current = false;
      a.pause();
      setIsPlaying(false);
      setControlsVisible(true);
    }
  };

  const skip = (dir: -1 | 1) => {
    if (chapterPauseTimerRef.current !== null) {
      clearTimeout(chapterPauseTimerRef.current);
      chapterPauseTimerRef.current = null;
    }
    if (!chapters.length) return;
    const next = Math.max(0, Math.min(activeIdx + dir, chapters.length - 1));
    if (next === activeIdx) return;
    wasPlayingRef.current = true;
    setActiveIdx(next);
  };

  const selectChapterAndPlay = (idx: number) => {
    if (chapterPauseTimerRef.current !== null) {
      clearTimeout(chapterPauseTimerRef.current);
      chapterPauseTimerRef.current = null;
    }
    if (idx < 0 || idx >= chapters.length) return;

    // ✅ wichtig: Play bleibt bedienbar. Panel geht weg.
    setPanelVisible(false);

    wasPlayingRef.current = true;
    setActiveIdx(idx);
  };

  const progressDegrees = progress * 360;

  const ringOuter = 112;
  const ringInner = 104;

  // Hero a bit higher: previously ~ -42%; move up ~10-15% -> -56% feels right
  const HERO_TRANSLATE_Y = "-56%";

  // Panel position: ensure it stays BELOW hero and never overlaps.
  // We'll anchor it to a fixed "top" that is below hero cluster.
  // Use a clamp-like approach: top = 50% + something, but enough to avoid overlap.
  const PANEL_TOP = "calc(50% + 165px)";

  // Footer: hide when panel visible or loading to avoid conflict
  const footerVisible = controlsVisible && !panelVisible && !loadingChapters;

  return (
    <div ref={rootRef} onClick={onBackgroundClick}>
      {/* Fixed Background */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 0,
          backgroundImage: themeCfg.background,
          backgroundSize: "260% 260%",
          animation: "svDrift 40s ease-in-out infinite alternate",
          cursor: controlsVisible ? "default" : "none",
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

      {/* Audio — preload="auto" buffers the full chapter; the hidden element buffers the next. */}
      <audio ref={audioRef} preload="auto" />
      <audio ref={preloadRef} preload="auto" style={{ display: "none" }} />

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
          style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer" }}
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
          transform: `translateY(${HERO_TRANSLATE_Y})`,
          zIndex: 18,
          pointerEvents: "auto",
        }}
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
              Story
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
              {storyTitle}
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
              {loadingChapters ? "Lade Kapitel…" : chapters.length ? `Kapitel ${activeIdx + 1}` : "—"}
            </p>
          </div>

          {/* player cluster */}
          <div
          id="sv-controls"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 12,
              opacity: controlsVisible ? 1 : 0,
              transform: controlsVisible ? "translateY(0px)" : "translateY(14px)",
              transition: "opacity 400ms ease-out, transform 400ms ease-out",
              pointerEvents: controlsVisible ? "auto" : "none",
              zIndex: 50,
              position: "relative",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => skip(-1)}
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
                cursor: "pointer",
                opacity: chapters.length && activeIdx > 0 ? 1 : 0.55,
              }}
            >
              <IconSkipPrev color={themeCfg.playButtonIcon} />
            </button>

            <div
              style={{
                width: ringOuter,
                height: ringOuter,
                position: "relative",
                display: "grid",
                placeItems: "center",
              }}
            >
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
                onClick={togglePlayPause}
                aria-label={isPlaying ? "Pause" : "Play"}
                style={{
                  width: ringInner,
                  height: ringInner,
                  borderRadius: "50%",
                  border: "none",
                  background: themeCfg.playButtonBg,
                  boxShadow: "0 18px 45px rgba(0,0,0,0.45)",
                  display: "grid",
                  placeItems: "center",
                  cursor: "pointer",
                  opacity: chapters.length ? 1 : 0.65,
                  position: "relative",
                  zIndex: 2,
                }}
              >
                {isPlaying ? (
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

            <button
              type="button"
              onClick={() => skip(1)}
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
                cursor: "pointer",
                opacity: chapters.length && activeIdx < chapters.length - 1 ? 1 : 0.55,
              }}
            >
              <IconSkipNext color={themeCfg.playButtonIcon} />
            </button>
          </div>
        </div>
      </div>

    

      {/* Panel UNDER the playbutton, never overlaps it */}
      <div
      id="sv-chapter-panel"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          top: PANEL_TOP,
          zIndex: 21,
          pointerEvents: panelVisible ? "auto" : "none",
          opacity: panelVisible ? 1 : 0,
          transform: panelVisible ? "translateY(0px)" : "translateY(10px)",
          transition: "opacity 280ms ease-out, transform 280ms ease-out",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 20px" }}>
          <div
            style={{
            boxSizing: "border-box",
padding: 18,
paddingTop: 20,
paddingBottom: 22,
maxHeight: "44vh",          // vorher 38vh
overflowY: "auto",
overscrollBehavior: "contain",
            }}
          >
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

            {loadingChapters ? (
              <div style={{ color: themeCfg.uiSoftText, padding: "10px 6px" }}>Lade Kapitel…</div>
            ) : chapters.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {chapters.map((c, idx) => {
                  const isActive = idx === activeIdx;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => selectChapterAndPlay(idx)}
                      style={{
                        border: `1px solid ${isActive ? themeCfg.secondaryButtonBorder : "rgba(148,163,184,0.25)"}`,
                        background: isActive
                          ? themeCfg.secondaryButtonBg
                          : theme === "dark"
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
                      <div style={{ color: themeCfg.uiSoftText, fontWeight: 700 }}>
                        {formatTime(c.durationSeconds ?? null)}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div style={{ color: themeCfg.uiSoftText, padding: "10px 6px" }}>Keine Kapitel gefunden.</div>
            )}
          </div>
        </div>
      </div>

      {/* Thin scrub bar — 12px hit target, 3px visual, auto-hides with controls */}
      <div
        style={{
          position: "fixed",
          bottom: 4,
          left: 0,
          right: 0,
          height: 12,
          cursor: "pointer",
          zIndex: 19,
          opacity: controlsVisible ? 1 : 0,
          pointerEvents: controlsVisible ? "auto" : "none",
          transition: "opacity 300ms ease-out",
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          scrubDraggingRef.current = true;
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          if (audioRef.current && Number.isFinite(audioRef.current.duration)) {
            audioRef.current.currentTime = ratio * audioRef.current.duration;
          }
          const onMouseMove = (me: MouseEvent) => {
            if (!scrubDraggingRef.current) return;
            const r2 = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
            if (audioRef.current && Number.isFinite(audioRef.current.duration)) {
              audioRef.current.currentTime = r2 * audioRef.current.duration;
            }
          };
          const onMouseUp = () => {
            scrubDraggingRef.current = false;
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
          };
          window.addEventListener("mousemove", onMouseMove);
          window.addEventListener("mouseup", onMouseUp);
        }}
      >
        {/* Track: absolute so left:0/right:0 guarantee full viewport width */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 3,
            background: "rgba(255,255,255,0.07)",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progress * 100}%`,
              background: themeCfg.progressColor,
              transition: scrubDraggingRef.current ? "none" : "width 80ms linear",
            }}
          />
        </div>
      </div>

      {/* Bottom footer: story length + SoftVibe (hidden if panel visible/loading) */}
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
          opacity: footerVisible ? 0.95 : 0,
          transform: footerVisible ? "translateY(0px)" : "translateY(8px)",
          transition: "opacity 240ms ease-out, transform 240ms ease-out",
          pointerEvents: "none",
        }}
      >
        {active?.durationSeconds
          ? `Länge: ${formatTime(active.durationSeconds ?? null)} · SoftVibe`
          : "SoftVibe"}
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

      {/* Background drift + stars */}
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