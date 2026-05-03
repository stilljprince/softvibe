// app/datenschutz/page.tsx
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Datenschutz | SoftVibe",
  description:
    "Informationen zum Datenschutz bei SoftVibe: Verantwortlicher, Datenarten, Zwecke, Rechtsgrundlagen, Speicherdauer und Betroffenenrechte.",
};

export default function DatenschutzPage() {
  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: "0 16px" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <h1 style={{ fontSize: "1.8rem", fontWeight: 800, margin: 0 }}>Datenschutz</h1>
        <Link
          href="/"
          style={{
            marginLeft: "auto",
            textDecoration: "none",
            fontWeight: 700,
            color: "var(--color-accent)",
          }}
        >
          ← Zur Startseite
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
        }}
      >
        <p style={{ opacity: 0.7, marginTop: 0 }}>Stand: {new Date().toLocaleDateString("de-DE")}</p>

        <h2 style={{ fontSize: "1.2rem", fontWeight: 800 }}>1. Verantwortlicher</h2>
        <p>
          SoftVibe (Betreiber) – Kontaktdaten siehe Impressum oder Kontaktbereich der Website.
        </p>

        <h2 style={{ fontSize: "1.2rem", fontWeight: 800 }}>2. Verarbeitete Daten</h2>
        <ul>
          <li>Account-Daten (E-Mail, Name, Anmeldedaten)</li>
          <li>Nutzungsdaten (erstellte Audio-Jobs, Titel, Dauer, Zeitstempel)</li>
          <li>Technische Daten (IP-Adresse, Logfiles, Cookies/Session)</li>
        </ul>

        <h2 style={{ fontSize: "1.2rem", fontWeight: 800 }}>3. Zwecke & Rechtsgrundlagen</h2>
        <ul>
          <li>Bereitstellung der Plattform und Funktionen (Art. 6 Abs. 1 lit. b DSGVO)</li>
          <li>Technischer Betrieb/Sicherheit (Art. 6 Abs. 1 lit. f DSGVO)</li>
          <li>Einwilligungsbasierte Funktionen, z. B. optionale Cookies (Art. 6 Abs. 1 lit. a DSGVO)</li>
        </ul>

        <h2 style={{ fontSize: "1.2rem", fontWeight: 800 }}>4. Speicherdauer</h2>
        <p>
          Personenbezogene Daten werden nur so lange gespeichert, wie es für die jeweiligen Zwecke
          erforderlich ist oder gesetzliche Pflichten bestehen.
        </p>

        <h2 style={{ fontSize: "1.2rem", fontWeight: 800 }}>5. Weitergabe an Dritte</h2>
        <p>
          Technische Dienstleister (z. B. Hosting, Audio-Generierung, Storage) werden eingesetzt.
          Mit allen bestehen entsprechende Auftragsverarbeitungsverträge, soweit erforderlich.
        </p>

        <h2 style={{ fontSize: "1.2rem", fontWeight: 800 }}>6. Rechte der Betroffenen</h2>
        <ul>
          <li>Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit</li>
          <li>Widerspruch gegen Verarbeitungen auf Grundlage berechtigter Interessen</li>
          <li>Widerruf von Einwilligungen mit Wirkung für die Zukunft</li>
          <li>Beschwerderecht bei einer Aufsichtsbehörde</li>
        </ul>

        <h2 style={{ fontSize: "1.2rem", fontWeight: 800 }}>7. Kontakt</h2>
        <p>
          Für Datenschutzanfragen nutze bitte den{" "}
          <Link href="/#contact" style={{ color: "var(--color-accent)", fontWeight: 700 }}>
            Kontaktbereich
          </Link>{" "}
          oder die im Impressum hinterlegten Kontaktdaten.
        </p>
      </section>
    </main>
  );
}