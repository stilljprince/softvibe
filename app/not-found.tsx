// app/not-found.tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--color-bg)",
        color: "var(--color-text)",
        display: "grid",
        placeItems: "center",
        padding: "40px 16px",
      }}
    >
      <section
        style={{
          width: "min(880px, 100%)",
          background: "var(--color-card)",
          border: "1px solid var(--color-nav-bg)",
          borderRadius: 16,
          boxShadow: "0 12px 28px rgba(0,0,0,.06)",
          padding: 24,
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: "1.6rem", fontWeight: 900, marginBottom: 6 }}>
          Seite nicht gefunden
        </h1>
        <p style={{ opacity: 0.7, marginBottom: 14 }}>
          Die angeforderte Seite existiert nicht oder ist nicht mehr verfügbar.
        </p>
        <Link
          href="/"
          style={{
            display: "inline-block",
            textDecoration: "none",
            fontWeight: 700,
            padding: "10px 14px",
            borderRadius: 999,
            border: "1px solid var(--color-nav-bg)",
            background: "var(--color-card)",
            color: "var(--color-text)",
          }}
        >
          ← Zur Startseite
        </Link>
      </section>
    </main>
  );
}