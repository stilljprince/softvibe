// app/agb/page.tsx
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Allgemeine Geschäftsbedingungen | SoftVibe",
  description: "Allgemeine Geschäftsbedingungen von SoftVibe.",
};

export default function AgbPage() {
  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: "0 16px" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <h1 style={{ fontSize: "1.8rem", fontWeight: 800, margin: 0 }}>Allgemeine Geschäftsbedingungen</h1>
        <Link
          href="/"
          style={{ marginLeft: "auto", textDecoration: "none", fontWeight: 700, color: "var(--color-accent)" }}
        >
          Zurück zur Startseite
        </Link>
      </header>

      <section
        style={{
          background: "var(--color-card)",
          color: "var(--color-text)",
          border: "1px solid var(--color-nav-bg)",
          borderRadius: 16,
          padding: 20,
          boxShadow: "0 10px 24px rgba(0,0,0,.06)",
          lineHeight: 1.7,
        }}
      >
        <p style={{ marginTop: 0 }}>
          Diese Seite befindet sich aktuell in der finalen rechtlichen Ausarbeitung und wird vor
          dem öffentlichen Release vervollständigt.
        </p>
        <p style={{ marginBottom: 0, opacity: 0.85 }}>
          SoftVibe befindet sich derzeit in einer privaten Friends-&amp;-Family-Testphase.
        </p>
      </section>
    </main>
  );
}
