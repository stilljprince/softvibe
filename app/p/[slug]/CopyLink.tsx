// app/p/[slug]/CopyLink.tsx
"use client";

export default function CopyLink({
  url,
  onCopied,
  onError,
}: {
  url: string;
  onCopied?: () => void;
  onError?: () => void;
}) {
  async function onCopy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const t = document.createElement("textarea");
        t.value = url;
        document.body.appendChild(t);
        t.select();
        document.execCommand("copy");
        t.remove();
      }
      onCopied?.();
    } catch {
      onError?.();
    }
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      style={{
        padding: "8px 12px",
        borderRadius: 999,
        border: "1px solid var(--color-nav-bg)",
        background: "var(--color-card)",
        color: "var(--color-text)",
        fontWeight: 700,
        cursor: "pointer",
      }}
      aria-label="Link kopieren"
      title="Link kopieren"
    >
      Link kopieren
    </button>
  );
}