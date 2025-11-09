// app/components/CustomPlayer.tsx
"use client";

import { useRef, useState } from "react";

type Props = {
  src: string;
  title?: string;       // <- neu, optional
  className?: string;
};

export default function CustomPlayer({ src, title, className }: Props) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  return (
    <div
      className={className}
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 8,
        alignItems: "center",
        background: "var(--color-card)",
        border: "1px solid var(--color-nav-bg)",
        borderRadius: 12,
        padding: "8px 10px",
      }}
    >
      <button
        type="button"
        aria-label={playing ? "Pause" : "Play"}
        onClick={() => {
          const el = ref.current;
          if (!el) return;
          if (el.paused) el.play();
          else el.pause();
        }}
        onMouseDown={(e) => e.preventDefault()}
        style={{
          width: 36,
          height: 36,
          borderRadius: 999,
          border: "1px solid var(--color-nav-bg)",
          background: "var(--color-bg)",
          cursor: "pointer",
          fontWeight: 700,
        }}
      >
        {playing ? "⏸" : "▶︎"}
      </button>

      <div style={{ minWidth: 0 }}>
        {title ? (
          <div
            style={{
              fontSize: "0.9rem",
              fontWeight: 700,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginBottom: 4,
            }}
            title={title}
          >
            {title}
          </div>
        ) : null}

        <audio
          ref={ref}
          src={src}
          preload="none"
          controls
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          style={{ width: "100%" }}
          controlsList="nodownload noplaybackrate noremoteplayback"
        />
      </div>

      <a
        href={src}
        download
        style={{ fontWeight: 700, textDecoration: "none", color: "var(--color-accent)" }}
        aria-label="Download"
        title="Download"
      >
        ⇩
      </a>
    </div>
  );
}