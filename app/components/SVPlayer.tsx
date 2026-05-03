"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ThemeConfig } from "./sv-kit";

let CURRENT_AUDIO: HTMLAudioElement | null = null;

export default function SVPlayer({
  src,
  themeCfg,
  onPlayingChange,
  onEnded,
  compact = false,
}: {
  src: string;
  themeCfg: ThemeConfig;
  onPlayingChange?: (isPlaying: boolean) => void;
  onEnded?: () => void;
  compact?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1
  const rafRef = useRef<number | null>(null);

  const size = compact ? 92 : 112;
  const inner = compact ? 84 : 104;
  const ringInset = compact ? 8 : 10;

  // progress loop
  useEffect(() => {
    const loop = () => {
      const a = audioRef.current;
      if (a && a.duration && !Number.isNaN(a.duration) && a.duration > 0) {
        const ratio = Math.max(0, Math.min(a.currentTime / a.duration, 1));
        setProgress(ratio);
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

  useEffect(() => {
    onPlayingChange?.(isPlaying);
  }, [isPlaying, onPlayingChange]);

  // events: ended vs pause sauber trennen
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const handleEnded = () => {
      setIsPlaying(false);
      onEnded?.(); // ✅ nur hier Auto-Next triggern
    };

    const handlePause = () => setIsPlaying(false);
    const handlePlay = () => setIsPlaying(true);

    a.addEventListener("ended", handleEnded);
    a.addEventListener("pause", handlePause);
    a.addEventListener("play", handlePlay);

    return () => {
      a.removeEventListener("ended", handleEnded);
      a.removeEventListener("pause", handlePause);
      a.removeEventListener("play", handlePlay);
    };
  }, [onEnded]);

  // wenn src wechselt: progress reset + playing state reset
  useEffect(() => {
    setProgress(0);
    setIsPlaying(false);
  }, [src]);

  const progressDegrees = useMemo(() => progress * 360, [progress]);

  const toggle = async () => {
    const a = audioRef.current;
    if (!a) return;

    // ✅ only one audio at a time
    if (CURRENT_AUDIO && CURRENT_AUDIO !== a) {
      CURRENT_AUDIO.pause();
    }
    CURRENT_AUDIO = a;

    if (a.paused) {
      try {
        await a.play();
      } catch {
        // ignore
      }
    } else {
      a.pause();
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <audio ref={audioRef} src={src} preload="metadata" />

      <div
        style={{
          width: size,
          height: size,
          position: "relative",
          display: "grid",
          placeItems: "center",
        }}
      >
        {/* Progress ring */}
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
              inset: ringInset,
              borderRadius: "50%",
              background:
                themeCfg.uiText === "#0f172a"
                  ? "rgba(248,250,252,0.9)"
                  : "rgba(15,23,42,1)",
            }}
          />
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void toggle();
          }}
          style={{
            width: inner,
            height: inner,
            borderRadius: "50%",
            border: "none",
            background: themeCfg.playButtonBg,
            boxShadow: "0 18px 45px rgba(0,0,0,0.45)",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            position: "relative",
          }}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span
                style={{
                  width: 5,
                  height: 20,
                  borderRadius: 999,
                  background: themeCfg.playButtonIcon,
                }}
              />
              <span
                style={{
                  width: 5,
                  height: 20,
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
                borderTop: "10px solid transparent",
                borderBottom: "10px solid transparent",
                borderLeft: `16px solid ${themeCfg.playButtonIcon}`,
                transform: "translateX(2px)",
              }}
            />
          )}
        </button>
      </div>
    </div>
  );
}