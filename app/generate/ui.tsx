// app/generate/ui.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

const PRESETS = [
  { id: "classic-asmr", label: "Classic ASMR (Whisper, Tapping)" },
  { id: "sleep-story", label: "Sleep Story (Calm, Slow)" },
  { id: "meditation", label: "Meditation (Breath, Soft Tone)" },
];

type JobStatus = "QUEUED" | "PROCESSING" | "DONE" | "FAILED";

type Job = {
  id: string;
  status: JobStatus;
  resultUrl?: string | null;
  error?: string | null;
  prompt?: string | null;
  preset?: string | null;
  durationSec?: number | null;
  createdAt?: string;
};

const PAGE_SIZE = 10;

export default function GenerateClient() {
  const [preset, setPreset] = useState<string>(PRESETS[0].id);
  const [prompt, setPrompt] = useState("");
  const [durationSec, setDurationSec] = useState<number | "">("");
  const [job, setJob] = useState<Job | null>(null);
  const [polling, setPolling] = useState(false);

  // Liste + Paging
  const [jobList, setJobList] = useState<Job[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingList, setLoadingList] = useState(false);

  const canSubmit = useMemo(() => prompt.trim().length >= 3, [prompt]);

  // ---------- Persistenz in localStorage (Preset/Prompt/Dauer) ----------
  const LS_PRESET = "sv_generate_preset";
  const LS_PROMPT = "sv_generate_prompt";
  const LS_DURATION = "sv_generate_duration";

  // Beim Mount aus localStorage laden
  useEffect(() => {
    try {
      const p = localStorage.getItem(LS_PRESET);
      const pr = localStorage.getItem(LS_PROMPT);
      const d = localStorage.getItem(LS_DURATION);

      if (p) setPreset(p);
      if (pr) setPrompt(pr);
      if (d !== null && d !== "") {
        const n = Number(d);
        if (!Number.isNaN(n)) setDurationSec(n);
      }
    } catch {
      // ignore
    }
  }, []);

  // Änderungen speichern
  useEffect(() => {
    try {
      localStorage.setItem(LS_PRESET, preset);
    } catch {}
  }, [preset]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_PROMPT, prompt);
    } catch {}
  }, [prompt]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_DURATION, durationSec === "" ? "" : String(durationSec));
    } catch {}
  }, [durationSec]);

  // ---------------------------------------------------------------------

  useEffect(() => {
    void loadJobs(0);
  }, []);

  async function loadJobs(skip: number) {
    setLoadingList(true);
    const res = await fetch(`/api/jobs?take=${PAGE_SIZE}&skip=${skip}`);
    if (!res.ok) {
      setLoadingList(false);
      return;
    }
    const data: Job[] = await res.json();
    if (skip === 0) {
      setJobList(data);
    } else {
      setJobList((prev) => [...prev, ...data]);
    }
    setHasMore(data.length === PAGE_SIZE);
    setLoadingList(false);
  }

  async function createJob() {
    const body: {
      preset: string;
      prompt: string;
      durationSec?: number;
    } = {
      preset,
      prompt,
    };

    if (typeof durationSec === "number" && !Number.isNaN(durationSec)) {
      body.durationSec = durationSec;
    }

    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      const data = await res.json().catch(() => null);
      if (data?.error === "TOO_MANY_OPEN_JOBS") {
        alert(
          data?.message ??
            "Du hast schon zu viele offene Jobs. Bitte warte, bis einer fertig ist."
        );
      } else {
        alert("Zu viele Anfragen. Bitte kurz warten.");
      }
      return;
    }

    if (!res.ok) {
      alert("Konnte Job nicht anlegen.");
      return;
    }

    const data: Job = await res.json();
    setJob(data);
    setPolling(true);
    // Liste neu laden (auf Seite 0)
    void loadJobs(0);
  }

  // Polling für aktuellen Job
  useEffect(() => {
    if (!job || !polling) return;
    const id = setInterval(async () => {
      const res = await fetch(`/api/jobs/${job.id}`);
      if (!res.ok) return;
      const fresh: Job = await res.json();
      setJob(fresh);
      if (fresh.status === "DONE" || fresh.status === "FAILED") {
        setPolling(false);
        void loadJobs(0);
      }
    }, 2000);
    return () => clearInterval(id);
  }, [job, polling]);

  // Job löschen
  async function deleteJob(id: string) {
    const res = await fetch(`/api/jobs/${id}`, {
      method: "DELETE",
    });
    if (res.status === 204) {
      setJobList((prev) => prev.filter((j) => j.id !== id));
      if (job?.id === id) setJob(null);
    } else {
      alert("Konnte Job nicht löschen.");
    }
  }

  return (
    <main style={{ maxWidth: 840, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 800, marginBottom: 12 }}>
        Generieren
      </h1>

      {/* Formular-Karte */}
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
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="sv-label">Prompt</label>
            <textarea
              className="sv-input"
              rows={4}
              placeholder='Beschreibe, was du hören möchtest (z. B. "sanftes Flüstern…")'
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>

          {/* Dauer */}
          <div>
            <label className="sv-label">
              Dauer (Sekunden) <span style={{ opacity: 0.5 }}>(optional)</span>
            </label>
            <input
              type="number"
              min={30}
              max={1800}
              className="sv-input"
              value={durationSec}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") {
                  setDurationSec("");
                } else {
                  setDurationSec(Number(v));
                }
              }}
              placeholder="z. B. 120"
            />
            <p style={{ fontSize: "0.75rem", opacity: 0.6, marginTop: 4 }}>
              30–1800 Sekunden.
            </p>
          </div>

          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            <button
              className="sv-btn"
              type="button"
              onClick={async () => {
                if (!job) return;
                await fetch(`/api/jobs/${job.id}/complete`, { method: "POST" });
                setPolling(true);
              }}
              disabled={!job || job.status === "DONE"}
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

      {/* Aktueller Job */}
      {job && (
        <section style={{ marginTop: 16 }}>
          <StatusCard job={job} />
        </section>
      )}

      {/* Job-Liste */}
      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 8 }}>
          Deine letzten Jobs
        </h2>

        {/* Skeletons wenn erste Seite lädt */}
        {loadingList && jobList.length === 0 ? (
          <ul style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[0, 1, 2].map((i) => (
              <li
                key={i}
                style={{
                  background: "var(--color-card)",
                  border: "1px solid var(--color-nav-bg)",
                  borderRadius: 10,
                  padding: "10px 12px",
                }}
              >
                <div
                  style={{
                    height: 14,
                    width: "60%",
                    borderRadius: 6,
                    background: "linear-gradient(90deg, #eee, #f6f6f6, #eee)",
                    backgroundSize: "200% 100%",
                    animation: "svShine 1.2s linear infinite",
                  }}
                />
                <div
                  style={{
                    height: 10,
                    width: "35%",
                    marginTop: 8,
                    borderRadius: 6,
                    background: "linear-gradient(90deg, #eee, #f6f6f6, #eee)",
                    backgroundSize: "200% 100%",
                    animation: "svShine 1.2s linear infinite",
                  }}
                />
              </li>
            ))}
            <style jsx>{`
              @keyframes svShine {
                0% {
                  background-position: 0 0;
                }
                100% {
                  background-position: 200% 0;
                }
              }
            `}</style>
          </ul>
        ) : jobList.length === 0 ? (
          <p style={{ opacity: 0.7 }}>Noch keine Jobs gefunden.</p>
        ) : (
          <ul style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {jobList.map((j) => (
              <li
                key={j.id}
                style={{
                  background: "var(--color-card)",
                  border: "1px solid var(--color-nav-bg)",
                  borderRadius: 10,
                  padding: "10px 12px",
                  display: "flex",
                  gap: 14,
                  alignItems: "center",
                }}
              >
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>
                    {j.prompt && j.prompt.trim() !== "" ? j.prompt : "(ohne Prompt)"}
                  </div>
                  <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>
                    {j.preset || "—"}
                    {j.durationSec ? ` · ${j.durationSec}s` : ""}
                    {j.createdAt
                      ? ` · ${new Date(j.createdAt).toLocaleString("de-DE")}`
                      : ""}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <StatusPill status={j.status} />
                  {j.status === "DONE" && j.resultUrl ? (
                    <audio controls src={j.resultUrl} style={{ width: 140 }} />
                  ) : null}

                  {/* löschen */}
                  <button
                    type="button"
                    onClick={() => deleteJob(j.id)}
                    className="sv-btn"
                    style={{ padding: "4px 10px" }}
                  >
                    Löschen
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {hasMore && (
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              onClick={() => loadJobs(jobList.length)}
              className="sv-btn"
              disabled={loadingList}
            >
              {loadingList ? "Lade…" : "Mehr laden"}
            </button>
          </div>
        )}
      </section>
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
        <StatusPill status={job.status} />
      </div>

      {job.durationSec ? (
        <p style={{ marginTop: 6, fontSize: "0.8rem", opacity: 0.75 }}>
          Dauer: {job.durationSec}s
        </p>
      ) : null}

      {job.status === "DONE" && job.resultUrl && (
        <div style={{ marginTop: 12 }}>
          <audio controls src={job.resultUrl} style={{ width: "100%" }} />
        </div>
      )}

      {job.status === "FAILED" && (
        <p style={{ color: "#e11d48", fontWeight: 600, marginTop: 8 }}>
          {job.error ?? "Fehlgeschlagen"}
        </p>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: JobStatus }) {
  const label =
    status === "QUEUED"
      ? "Warteschlange"
      : status === "PROCESSING"
      ? "In Bearbeitung"
      : status === "DONE"
      ? "Fertig"
      : "Fehlgeschlagen";

  const bg =
    status === "DONE"
      ? "color-mix(in oklab, var(--color-accent) 35%, transparent)"
      : status === "FAILED"
      ? "#fee2e2"
      : "color-mix(in oklab, var(--color-card) 85%, #000 15%)";

  const color = status === "FAILED" ? "#7f1d1d" : "inherit";

  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: "0.75rem",
        fontWeight: 600,
        background: bg,
        color,
      }}
    >
      {label}
    </span>
  );
}