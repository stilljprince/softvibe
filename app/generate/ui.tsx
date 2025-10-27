"use client";

import { useEffect, useMemo, useState } from "react";

const PRESETS = [
  { id: "classic-asmr", label: "Classic ASMR (Whisper, Tapping)" },
  { id: "sleep-story", label: "Sleep Story (Calm, Slow)" },
  { id: "meditation", label: "Meditation (Breath, Soft Tone)" },
];

type Job = { id: string; status: "QUEUED"|"PROCESSING"|"DONE"|"FAILED"; resultUrl?: string|null; error?: string|null };

export default function GenerateClient() {
  const [preset, setPreset] = useState<string>(PRESETS[0].id);
  const [prompt, setPrompt] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [polling, setPolling] = useState(false);

  const canSubmit = useMemo(() => prompt.trim().length >= 3, [prompt]);

  async function createJob() {
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preset, prompt }),
    });
    if (!res.ok) {
      alert("Konnte Job nicht anlegen.");
      return;
    }
    const data: Job = await res.json();
    setJob(data);
    setPolling(true);
  }

  // simples Polling alle 2s
  useEffect(() => {
    if (!job || !polling) return;
    const id = setInterval(async () => {
      const res = await fetch(`/api/jobs/${job.id}`);
      if (!res.ok) return;
      const fresh: Job = await res.json();
      setJob(fresh);
      if (fresh.status === "DONE" || fresh.status === "FAILED") {
        setPolling(false);
      }
    }, 2000);
    return () => clearInterval(id);
  }, [job, polling]);

  return (
    <main style={{ maxWidth: 840, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 800, marginBottom: 12 }}>Generieren</h1>

      <section
        style={{
          background: "var(--color-card)",
          border: "1px solid var(--color-nav-bg)",
          borderRadius: 16,
          boxShadow: "0 10px 24px rgba(0,0,0,.06)",
          padding: 16,
        }}
      >
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <label className="sv-label">Preset</label>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
              className="sv-input"
            >
              {PRESETS.map(p => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="sv-label">Prompt</label>
            <textarea
              className="sv-input"
              rows={4}
              placeholder="Beschreibe, was du hören möchtest (z. B. „sanftes Flüstern mit leichten Tapping-Geräuschen…“)"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>

          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            <button
              className="sv-btn"
              type="button"
              onClick={async () => {
                if (!job) return;
                await fetch(`/api/jobs/${job.id}/complete`, { method: "POST" });
                // Poller nimmt den neuen Status beim nächsten Tick mit
                setPolling(true);
              }}
              disabled={!job || job.status === "DONE"}
              title="Mock: Job sofort abschließen (nur Dev)"
            >
              Simulation abschließen
            </button>

            <button
              className="sv-btn sv-btn--primary"
              type="button"
              onClick={createJob}
              disabled={!canSubmit}
            >
              Generieren
            </button>
          </div>
        </div>
      </section>

      {/* Status / Ergebnis */}
      {job && (
        <section style={{ marginTop: 16 }}>
          <StatusCard job={job} />
        </section>
      )}
    </main>
  );
}

function StatusCard({ job }: { job: Job }) {
  return (
    <div
      style={{
        background: "var(--color-card)",
        border: "1px solid var(--color-nav-bg)",
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>Job: {job.id}</strong>
        <span>Status: {label(job.status)}</span>
      </div>

      {job.status === "DONE" && job.resultUrl && (
        <div style={{ marginTop: 12 }}>
          <audio controls src={job.resultUrl} style={{ width: "100%" }} />
        </div>
      )}

      {job.status === "FAILED" && (
        <p style={{ color: "#e11d48", fontWeight: 600, marginTop: 8 }}>
          Fehlgeschlagen: {job.error ?? "Unbekannter Fehler"}
        </p>
      )}
    </div>
  );
}

function label(s: Job["status"]) {
  switch (s) {
    case "QUEUED": return "Warteschlange";
    case "PROCESSING": return "In Bearbeitung";
    case "DONE": return "Fertig";
    case "FAILED": return "Fehlgeschlagen";
  }
}