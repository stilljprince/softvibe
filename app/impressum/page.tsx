// app/impressum/page.tsx
export const runtime = "edge";

export default function ImpressumPage() {
  return (
    <main style={{ maxWidth: 860, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: "1.6rem", fontWeight: 800, marginBottom: 12 }}>Impressum</h1>
      <p style={{ opacity: 0.75, marginBottom: 8 }}>
        Verantwortlich für den Inhalt dieser Website:
      </p>

      <div style={{ lineHeight: 1.6 }}>
        <p><strong>SoftVibe (Platzhalter)</strong></p>
        <p>Straße Nr.<br />PLZ Ort<br />Land</p>
        <p>E-Mail: kontakt@softvibe.app</p>
        <p>USt-ID: DE… (sofern vorhanden)</p>
      </div>

      <p style={{ opacity: 0.7, marginTop: 16, fontSize: ".9rem" }}>
        Hinweis: Dies ist eine Beispielseite und ersetzt keine Rechtsberatung.
      </p>
    </main>
  );
}