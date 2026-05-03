// app/error.tsx
"use client";

export default function Error(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { error, reset } = props;

  return (
    <main style={{ maxWidth: 860, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 800, marginBottom: 8 }}>Upsi – Fehler</h1>
      <p style={{ opacity: 0.7, whiteSpace: "pre-wrap" }}>
        {error?.message || "Es ist ein unerwarteter Fehler aufgetreten."}
      </p>
      <div style={{ marginTop: 16 }}>
        <button
          onClick={() => reset()}
          className="sv-btn sv-btn--primary"
          style={{ padding: "10px 14px", fontWeight: 700 }}
        >
          Nochmal versuchen
        </button>
      </div>
      {error?.digest ? (
        <p style={{ opacity: 0.5, fontSize: ".8rem", marginTop: 10 }}>Fehler-ID: {error.digest}</p>
      ) : null}
    </main>
  );
}