"use client";

import * as React from "react";

type Props = {
  url: string;
  label?: string;
  title?: string;
};

export default function ShareButton({ url, label = "Teilen", title }: Props) {
  async function onShare() {
    try {
      if (navigator.share) {
        await navigator.share({ url, title });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        alert("Link kopiert.");
      } else {
        // Fallback
        const ta = document.createElement("textarea");
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        alert("Link kopiert.");
      }
    } catch {
      /* Nutzer abgebrochen o.Ä. – kein Hard-Error nötig */
    }
  }

  return (
    <button
      type="button"
      onClick={onShare}
      style={{
        textDecoration: "none",
        fontWeight: 700,
        padding: "8px 12px",
        borderRadius: 999,
        border: "1px solid var(--color-nav-bg)",
        background: "var(--color-card)",
        color: "var(--color-text)",
        cursor: "pointer",
      }}
      aria-label={label}
      title={label}
    >
      {label}
    </button>
  );
}