"use client";

import React, { useEffect, useRef, useState } from "react";

type CustomPlayerProps = {
  src: string;
  preload?: "none" | "metadata" | "auto";
  showTitle?: boolean;
  title?: string;
  durationSeconds?: number | null;
  maxWidth?: number;
};

// 🔹 globaler Audio-Ref pro Bundle – sorgt dafür, dass nur EIN Audio spielt
let currentAudio: HTMLAudioElement | null = null;

function formatTime(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) return "0:00";
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const CustomPlayer: React.FC<CustomPlayerProps> = ({
  src,
  preload = "metadata",
  showTitle = false,
  title,
  durationSeconds,
  maxWidth,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0–100
  const [duration, setDuration] = useState<number | null>(
    durationSeconds && Number.isFinite(durationSeconds) ? durationSeconds : null
  );
  const [hasError, setHasError] = useState(false);

  const isDisabled = !src || hasError;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handlePlay = () => {
      // andere Instanz pausieren
      if (currentAudio && currentAudio !== audio && !currentAudio.paused) {
        currentAudio.pause();
      }
      currentAudio = audio;
      setIsPlaying(true);
    };

    const handlePause = () => {
      setIsPlaying(false);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setProgress(0);
    };

    const handleTimeUpdate = () => {
      if (!audio.duration || Number.isNaN(audio.duration)) return;
      const p = (audio.currentTime / audio.duration) * 100;
      setProgress(p);
      if (duration == null) {
        setDuration(audio.duration);
      }
    };

    const handleLoadedMetadata = () => {
      if (!Number.isNaN(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    const handleError = () => {
      setHasError(true);
      setIsPlaying(false);
      setProgress(0);
    };

    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("error", handleError);

    return () => {
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("error", handleError);

      if (currentAudio === audio) {
        currentAudio = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]); // bei neuem src Listener neu binden

  const handleTogglePlay = async () => {
    if (isDisabled) return;
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      try {
        await audio.play();
      } catch (err) {
        console.error("Audio play error:", err);
      }
    } else {
      audio.pause();
    }
  };

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isDisabled) return;
    const audio = audioRef.current;
    if (!audio || !audio.duration || Number.isNaN(audio.duration)) return;

    const value = Number(e.target.value);
    const clamped = Math.min(100, Math.max(0, value));
    audio.currentTime = (clamped / 100) * audio.duration;
    setProgress(clamped);
  };

  const effectiveTitle = title ?? (showTitle ? "SoftVibe Audio" : "");

  const borderColor = isPlaying
    ? "color-mix(in oklab, var(--color-accent) 35%, var(--color-nav-bg))"
    : "var(--color-nav-bg)";

  const bgColor = isDisabled
    ? "color-mix(in oklab, var(--color-card) 90%, rgba(0,0,0,0.04))"
    : "var(--color-card)";

  const playBg = isDisabled
    ? "color-mix(in oklab, var(--color-accent) 40%, rgba(255,255,255,0.7))"
    : "var(--color-accent)";

  return (
        <div
      style={{
        borderRadius: 999,
        border: `1px solid ${borderColor}`,
        background: bgColor,
        padding: "6px 10px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        boxShadow: "0 6px 18px rgba(0,0,0,0.04)",
        width: "100%",                // 👉 nimmt volle Breite des Containers
        ...(maxWidth ? { maxWidth } : {}), // 👉 nur begrenzen, wenn explizit gesetzt
        opacity: isDisabled ? 0.6 : 1,
      }}
    >
      <button
        type="button"
        onClick={handleTogglePlay}
        aria-label={isPlaying ? "Pause" : "Play"}
        disabled={isDisabled}
        style={{
          width: 32,
          height: 32,
          borderRadius: 999,
          border: "none",
          background: playBg,
          color: "#fff",
          display: "grid",
          placeItems: "center",
          cursor: isDisabled ? "default" : "pointer",
          flexShrink: 0,
        }}
      >
        {isPlaying ? (
          <span
            style={{
              display: "flex",
              gap: 3,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                width: 3,
                height: 14,
                background: "#fff",
                borderRadius: 999,
              }}
            />
            <span
              style={{
                width: 3,
                height: 14,
                background: "#fff",
                borderRadius: 999,
              }}
            />
          </span>
        ) : (
          <span
            style={{
              display: "inline-block",
              width: 0,
              height: 0,
              borderTop: "7px solid transparent",
              borderBottom: "7px solid transparent",
              borderLeft: "11px solid #fff",
              marginLeft: 2,
            }}
          />
        )}
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        {showTitle && effectiveTitle && (
          <div
            style={{
              fontSize: "0.8rem",
              fontWeight: 600,
              color: "var(--color-text)",
              marginBottom: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={effectiveTitle}
          >
            {effectiveTitle}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="range"
            min={0}
            max={100}
            value={progress}
            onChange={handleScrub}
            aria-label="Spulen"
            disabled={isDisabled}
            style={{
              flex: 1,
              appearance: "none",
              height: 4,
              borderRadius: 999,
              background: "rgba(0,0,0,0.06)",
              outline: "none",
              cursor: isDisabled ? "default" : "pointer",
            }}
          />
          <span
            style={{
              fontSize: "0.72rem",
              minWidth: 40,
              textAlign: "right",
              opacity: 0.7,
              fontVariantNumeric: "tabular-nums",
              color: "var(--color-text)",
            }}
          >
            {formatTime(duration)}
          </span>
        </div>

        {hasError && (
          <div
            style={{
              marginTop: 4,
              fontSize: "0.7rem",
              color: "#b91c1c",
              opacity: 0.85,
            }}
          >
            Audio nicht verfügbar.
          </div>
        )}
      </div>

      {/* Hidden native audio – macht eigentliche Wiedergabe */}
      <audio
        ref={audioRef}
        src={src}
        preload={preload}
        style={{ display: "none" }}
      />
    </div>
  );
};

export default CustomPlayer;