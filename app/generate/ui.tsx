// app/generate/ui.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type React from "react";

import CustomPlayer from "@/app/components/CustomPlayer";

const PRESETS = [
  { id: "classic-asmr", label: "Classic ASMR",  desc: "Whisper · Tapping" },
  { id: "sleep-story",  label: "Sleep Story",   desc: "Calm · Slow" },
  { id: "meditation",   label: "Meditation",    desc: "Breath · Soft Tone" },
  { id: "kids-story",   label: "Kids Story",    desc: "Gentle · Safe" },
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
  title?: string | null; // 👈 dazu
  language?: "de" | "en" | null; // ✅ neu
  storyId?: string | null;
  chapterCount?: number | null;
};

type AccountSummary = {
  credits: number;
  isAdmin: boolean;
  hasSubscription: boolean;
};

type Theme = "light" | "dark" | "pastel";

const PAGE_SIZE = 10;

// API-Shape für /api/account/credits
type CreditsResponse =
  | { credits: number }
  | { ok: true; data: { credits: number } };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export default function GenerateClient() {
  const [preset, setPreset] = useState<string>(PRESETS[0].id);
  const [title, setTitle] = useState("");
  const [rawPrompt, setRawPrompt] = useState("");
  const [improvedPrompt, setImprovedPrompt] = useState<string | null>(null);
  const [isImproving, setIsImproving] = useState(false);
  const [durationSec, setDurationSec] = useState<number | "">("");
  const [job, setJob] = useState<Job | null>(null);
  const [polling, setPolling] = useState(false);
  const [jobList, setJobList] = useState<Job[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [accountSummary, setAccountSummary] = useState<AccountSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [voiceStyle, setVoiceStyle] = useState<"soft" | "whisper">("soft");
  const [voiceGender, setVoiceGender] = useState<"female" | "male">("female");

  // Credits aus eigener API; verwenden wir bevorzugt im Header
  const [credits, setCredits] = useState<number | null>(null);

  const [language, setLanguage] = useState<"de" | "en">("de");
  // ---------- Toast ----------
  const [toast, setToast] = useState<{ msg: string; kind?: "ok" | "err" | "info" } | null>(null);
  const [retryLeft, setRetryLeft] = useState<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  function showToast(msg: string, kind: "ok" | "err" | "info" = "info", autoHideMs = 2500) {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    setToast({ msg, kind });
    if (autoHideMs > 0) {
      hideTimerRef.current = window.setTimeout(() => setToast(null), autoHideMs);
    }
  }

  function startRetryCountdown(totalSeconds: number) {
    if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
    setRetryLeft(totalSeconds);
    setToast({ msg: `Zu viele Anfragen. Bitte warte ${totalSeconds}s …`, kind: "info" });
    const tick = () => {
      setRetryLeft((prev) => {
        const next = typeof prev === "number" ? prev - 1 : totalSeconds - 1;
        if (next <= 0) {
          setToast(null);
          retryTimerRef.current && window.clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
          return 0;
        }
        setToast({ msg: `Zu viele Anfragen. Bitte warte ${next}s …`, kind: "info" });
        retryTimerRef.current = window.setTimeout(tick, 1000);
        return next;
      });
    };
    retryTimerRef.current = window.setTimeout(tick, 1000);
  }

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, []);
  // ---------- Ende Toast ----------

  async function improvePrompt() {
    if (rawPrompt.trim().length < 3 || isImproving) return;
    setIsImproving(true);
    try {
      const res = await fetch("/api/prompt-improve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: rawPrompt, preset }),
        credentials: "include",
      });
      if (res.status === 401) {
        showToast("Bitte einloggen, um Prompt zu verbessern.", "err", 4000);
        return;
      }
      if (res.status === 429) {
        showToast("Zu viele Anfragen. Bitte warte.", "info");
        return;
      }
      if (!res.ok) {
        showToast("Prompt-Verbesserung fehlgeschlagen.", "err");
        return;
      }
      // NOTE: lib/api.ts jsonOk always wraps its argument as { ok: true, data: <payload> }.
      // The route returns jsonOk({ improvedPrompt }), so the wire format is
      // { ok: true, data: { improvedPrompt: "..." } } — NOT { improvedPrompt: "..." } at the top level.
      // Read from json.data.improvedPrompt, not json.improvedPrompt directly.
      const json = (await res.json()) as {
        ok?: boolean;
        data?: { improvedPrompt?: string };
        improvedPrompt?: string;
      };
      const improved = json.data?.improvedPrompt ?? json.improvedPrompt ?? "";
      if (improved) {
        setImprovedPrompt(improved);
      } else {
        showToast("Kein verbesserter Prompt erhalten.", "err");
      }
    } catch {
      showToast("Prompt-Verbesserung fehlgeschlagen.", "err");
    } finally {
      setIsImproving(false);
    }
  }

  const canSubmit = useMemo(() => {
    const titleOk = title.trim().length >= 3;
    const promptOk = rawPrompt.trim().length >= 3;
    if (!titleOk || !promptOk) return false;

    // Wenn wir noch keine Summary haben (lädt), Button nicht blocken
    if (!accountSummary) return true;

    // Admin darf immer
    if (accountSummary.isAdmin) return true;

    // Normale User brauchen Credits > 0
    return accountSummary.credits > 0;
  }, [title, rawPrompt, accountSummary]);

  useEffect(() => {
    void loadJobs(0);
  }, []);

  useEffect(() => {
    void refreshCredits();
  }, []);

  async function refreshCredits() {
    try {
      const res = await fetch("/api/account/credits");
      if (!res.ok) return;
      const raw: unknown = await res.json();

      let value: number | null = null;

      // Variante 1: { credits: number }
      if (isRecord(raw) && typeof raw.credits === "number") {
        value = raw.credits;
      }
      // Variante 2: { ok:true, data:{ credits:number } }
      else if (
        isRecord(raw) &&
        "data" in raw &&
        isRecord((raw as { data?: unknown }).data) &&
        typeof (raw as { data: { credits?: unknown } }).data.credits === "number"
      ) {
        value = (raw as { data: { credits: number } }).data.credits;
      }

      if (typeof value === "number") {
        setCredits(value);
      }
    } catch {
      // Fehler still ignorieren, UI bleibt wie vorher
    }
  }

  useEffect(() => {
    const loadSummary = async () => {
      setLoadingSummary(true);
      try {
        const res = await fetch("/api/account/summary");
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        // Backend gibt { ok:true, data:{ credits, isAdmin, hasSubscription } }
        const payload = (data && data.data) || data;

        setAccountSummary({
          credits: typeof payload.credits === "number" ? payload.credits : 0,
          isAdmin: !!payload.isAdmin,
          hasSubscription: !!payload.hasSubscription,
        });
      } catch {
        setAccountSummary(null);
      } finally {
        setLoadingSummary(false);
      }
    };
    void loadSummary();
  }, []);

  // Hilfs-Normalizer für Responses (unterstützt Array oder {data:[...]})
  function extractList<T>(json: unknown): T[] {
    if (Array.isArray(json)) return json as T[];
    if (json && typeof json === "object") {
      const maybe = (json as Record<string, unknown>).data;
      if (Array.isArray(maybe)) return maybe as T[];
    }
    return [];
  }

  function extractItem<T>(json: unknown): T | null {
    if (json && typeof json === "object") {
      const rec = json as Record<string, unknown>;
      if ("data" in rec) {
        const d = rec.data;
        if (d && typeof d === "object") return d as T;
        return null;
      }
      return json as T;
    }
    return null;
  }

  async function loadJobs(skip: number) {
    setLoadingList(true);
    try {
      const res = await fetch(`/api/jobs?take=${PAGE_SIZE}&skip=${skip}`, {
        credentials: "include",
      });
      if (!res.ok) {
        // z. B. 401 → leer rendern
        setJobList(skip === 0 ? [] : (prev) => prev);
        setHasMore(false);
        return;
      }
      const json = await res.json().catch(() => null);
      const list = extractList<Job>(json);

      if (skip === 0) {
        setJobList(list);
      } else {
        setJobList((prev) => [...prev, ...list]);
      }
      setHasMore(list.length === PAGE_SIZE);
    } finally {
      setLoadingList(false);
    }
  }

      async function createJob() {
   const body: {
  title: string;
  preset: string;
  prompt: string;
  language: "de" | "en";
  durationSec?: number;
  voiceStyle: "soft" | "whisper";
  voiceGender: "female" | "male";
} = {
  title: title.trim().length > 0 ? title.trim() : "",
  preset,
  prompt: rawPrompt,
  language,
  voiceStyle,
  voiceGender,
};

    if (typeof durationSec === "number" && !Number.isNaN(durationSec)) {
      body.durationSec = durationSec;
    }

    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "include",
    });

    if (res.status === 429) {
      // Retry-After lesen (Sekunden)
      const ra = res.headers.get("Retry-After");
      const secsFromHeader = ra ? Number(ra) : NaN;
      let fallbackSeconds = 30;
      try {
        const data = (await res.json()) as {
          retryAfter?: number;
          error?: string;
          message?: string;
        } | null;
        if (data?.retryAfter && Number.isFinite(data.retryAfter)) {
          fallbackSeconds = Math.max(1, Math.floor(data.retryAfter));
        }
      } catch {
        /* ignore */
      }

      const seconds =
        Number.isFinite(secsFromHeader) && secsFromHeader > 0
          ? Math.floor(secsFromHeader)
          : fallbackSeconds;

      startRetryCountdown(seconds);
      return;
    }

    // 🔹 Speziell: keine Credits
    if (res.status === 402) {
      let msg = "Du hast keine Credits mehr. Bitte lade Credits nach.";
      try {
        const data = (await res.json()) as { message?: string };
        if (data?.message) msg = data.message;
      } catch {
        /* ignore */
      }
      showToast(msg, "err");

      // Credits im Frontend sicher auf 0 setzen
      setAccountSummary((prev) =>
        prev && !prev.isAdmin ? { ...prev, credits: 0 } : prev
      );
      setCredits(0);
      return;
    }

    if (!res.ok) {
      showToast("Konnte Job nicht anlegen.", "err");
      return;
    }

    const data: Job = await res.json();
    setJob(data);
    setPolling(true);
    void loadJobs(0);
    void refreshCredits(); // 👈 Credits nach Abbuchung neu holen

    // 🔹 Credits lokal runterzählen (1 Credit pro Job)
    setAccountSummary((prev) => {
      if (!prev || prev.isAdmin) return prev;
      const nextCredits = Math.max(0, prev.credits - 1);
      return { ...prev, credits: nextCredits };
    });

    showToast("Job erstellt.", "ok");

        // 🔹 NEU: Für Nicht-Admins Job direkt „abschließen“ (Worker simulieren)
if (!accountSummary?.isAdmin) {
  try {
    const completeRes = await fetch(`/api/jobs/${data.id}/complete`, {
      method: "POST",
      credentials: "include",
    });

    if (!completeRes.ok) {
      console.error(
        "Auto-Complete für Job fehlgeschlagen:",
        completeRes.status
      );
      return;
    }

    const rawComplete: unknown = await completeRes.json().catch(() => null);
    const completed = extractItem<Job>(rawComplete);

    if (completed) {
      setJob(completed);

      // 🔹 WICHTIG: Track-Titel nachziehen / updaten
      const trimmedTitle = title.trim();

      try {
        await fetch("/api/tracks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            jobId: completed.id,
            // nur senden, wenn wirklich etwas eingetragen wurde
            title: trimmedTitle.length > 0 ? trimmedTitle : undefined,
          }),
        });
        // Fehler hier sind nicht kritisch – Track existiert trotzdem,
        // nur der Titel bleibt dann halt wie vorher.
      } catch (e) {
        console.error("Track-Titel konnte nicht gesetzt werden:", e);
      }
    }
  } catch (err) {
    console.error("Fehler beim Auto-Complete:", err);
  }
}
  }

 // Polling
useEffect(() => {
  if (!job || !polling) return;

  const intervalId = window.setInterval(async () => {
    const res = await fetch(`/api/jobs/${job.id}`, {
      credentials: "include",
    });
    if (!res.ok) return;

    const fresh = await res.json().catch(() => null);
    const next = extractItem<Job>(fresh);
    if (!next) return;

    setJob(next);

    // 🔹 Sobald der Job fertig ist, Track-Titel nachziehen
    if (next.status === "DONE") {
      const trimmedTitle = title.trim();

      if (trimmedTitle.length > 0) {
        try {
          await fetch("/api/tracks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              jobId: next.id,
              title: trimmedTitle,
            }),
          });
          // /api/tracks:
          // - legt neuen Track an ODER
          // - updated bestehenden Track-Titel auf trimmedTitle
        } catch (e) {
          console.error("Konnte Track-Titel nach Abschluss nicht setzen:", e);
        }
      }
    }

    if (next.status === "DONE" || next.status === "FAILED") {
      setPolling(false);
      void loadJobs(0);
    }
  }, 2000);

  return () => window.clearInterval(intervalId);
}, [job, polling, title]);

  async function deleteJob(id: string) {
    const res = await fetch(`/api/jobs/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.status === 204) {
      setJobList((prev) => prev.filter((j) => j.id !== id));
      if (job?.id === id) setJob(null);
      showToast("Gelöscht.", "ok");
    } else {
      showToast("Konnte Job nicht löschen.", "err");
    }
  }

  // Credits-Anzeige im Header (aktuell ungenutzt, aber lassen wir für später drin)
  const effectiveCredits =
    accountSummary?.isAdmin
      ? null
      : credits !== null
      ? credits
      : accountSummary
      ? accountSummary.credits
      : null;

  const creditsLabel =
    accountSummary?.isAdmin
      ? "∞"
      : effectiveCredits !== null
      ? String(effectiveCredits)
      : loadingSummary
      ? "…"
      : "–";

  // ===== Theme + Header wie Landing =====
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    const saved = (localStorage.getItem("theme") as Theme | null) ?? "light";
    document.documentElement.className = saved;
    setTheme(saved);
  }, []);
  useEffect(() => {
    document.documentElement.className = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);
  const nextTheme: Record<Theme, Theme> = {
    light: "dark",
    dark: "pastel",
    pastel: "light",
  };
  const getThemeIcon = () =>
    theme === "light" ? "🌞" : theme === "dark" ? "🌙" : "🎨";
  const handleToggleTheme = () => setTheme(nextTheme[theme]);
  const getLogo = () =>
    theme === "light"
      ? "/softvibe-logo-light.svg"
      : theme === "dark"
      ? "/softvibe-logo-dark.svg"
      : "/softvibe-logo-pastel.svg";

  // 🔹 Globaler Audio-Guard: nur ein <audio> gleichzeitig auf der Seite
  useEffect(() => {
    let current: HTMLAudioElement | null = null;

    const handlePlay = (event: Event) => {
      const target = event.target as HTMLAudioElement | null;
      if (!target || target.tagName !== "AUDIO") return;

      if (current && current !== target && !current.paused) {
        current.pause();
      }
      current = target;
    };

    document.addEventListener("play", handlePlay, true); // capture-Phase

    return () => {
      document.removeEventListener("play", handlePlay, true);
      current = null;
    };
  }, []);

                                                            const isAdmin = accountSummary?.isAdmin === true;
                                                              const displayJobTitle = (j: Job): string => {
                                                            // Falls der Job vom Backend schon ein title-Feld hat, dieses nehmen,
                                                            // sonst Prompt, sonst Fallback
                                                            const anyJob = j as unknown as { title?: string | null };
                                                            const raw = (anyJob.title ?? j.prompt ?? "").trim();
                                                            if (raw.length === 0) return "(ohne Titel)";
                                                            // Optional leicht begrenzen, damit der Header nicht explodiert:
                                                            return raw.length > 120 ? raw.slice(0, 117) + "…" : raw;
                                                          };
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--color-bg)",
        paddingTop: 64,
        width: "100%",
      }}
    >
      {/* ===== Header wie Account/Landing ===== */}
      <header
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0.6rem 1.5rem",
          background: "color-mix(in oklab, var(--color-bg) 90%, transparent)",
          backdropFilter: "blur(10px)",
        }}
      >
        <div style={{ flex: "0 0 auto" }}>
          <Image
            src={getLogo()}
            alt="SoftVibe Logo"
            width={160}
            height={50}
            priority
          />
        </div>

        <nav
          className="desktop-nav"
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            display: "flex",
            gap: "1rem",
          }}
        >
          <Link href="/#features" style={navLinkStyle}>
            Features
          </Link>
          <Link href="/#about" style={navLinkStyle}>
            Über uns
          </Link>
          <Link href="/#contact" style={navLinkStyle}>
            Kontakt
          </Link>
          <Link href="/" style={navLinkStyle}>
            Startseite
          </Link>
        </nav>

        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                {/* Credits im Header – direkt aus State, immer synchron mit unten */}
                <div
                  style={{
                    minWidth: 60,
                    textAlign: "center",
                    padding: "0.3rem 0.7rem",
                    borderRadius: 999,
                    border: "1px solid var(--color-nav-bg)",
                    background: "var(--color-card)",
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                  }}
                  title="Verfügbare Credits"
                >
                  {accountSummary?.isAdmin ? "∞ Credits" : `${creditsLabel} Credits`}
                </div>

          <button
            onClick={handleToggleTheme}
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: "var(--color-button-bg)",
              color: "var(--color-button-text)",
              border: "none",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              fontSize: "1.25rem",
            }}
            aria-label="Theme wechseln"
            title="Theme wechseln"
          >
            {getThemeIcon()}
          </button>

          <form action="/api/auth/signout" method="post">
            <button
              type="submit"
              style={{
                background: "var(--color-accent)",
                color: "#fff",
                border: "none",
                borderRadius: 999,
                padding: "0.4rem 0.9rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Logout
            </button>
          </form>
        </div>

        <style jsx>{`
          @media (max-width: 880px) {
            .desktop-nav {
              display: none !important;
            }
          }
        `}</style>
      </header>

      {/* Inhalt */}
      <div
        style={{
          width: "100%",
          maxWidth: "min(840px, 100vw - 32px)",
          margin: "40px auto",
          padding: "0 16px",
        }}
      >
        <h1
          style={{
            fontSize: "1.8rem",
            fontWeight: 800,
            marginBottom: 12,
          }}
        >
          Generieren
        </h1>

        {/* Formular */}
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
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`sv-btn${preset === p.id ? " sv-btn--primary" : ""}`}
                    onClick={() => setPreset(p.id)}
                    style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", padding: "6px 14px" }}
                  >
                    <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{p.label}</span>
                    <span style={{ fontSize: "0.72rem", opacity: 0.65, marginTop: 1 }}>{p.desc}</span>
                  </button>
                ))}
              </div>
            </div>


<div>
  <label className="sv-label">Voice Style</label>
  <select
    value={voiceStyle}
onChange={(e) => setVoiceStyle(e.target.value as "soft" | "whisper")}
    className="sv-input"
  >
    <option value="soft">Soft spoken (weniger Whisper)</option>
    <option value="whisper">Full whisper (nah am Mikro)</option>
  </select>
</div>
<div>
  <label className="sv-label">Voice Gender</label>
  <select
    value={voiceGender}
    onChange={(e) => setVoiceGender(e.target.value as "female" | "male")}
    className="sv-input"
  >
    <option value="female">Female</option>
    <option value="male">Male</option>
  </select>
</div>

 <div>
    <label className="sv-label">Sprache</label>
    <div style={{ display: "flex", gap: 8 }}>
      <button
        type="button"
        className={`sv-btn ${language === "de" ? "sv-btn--primary" : ""}`}
        onClick={() => setLanguage("de")}
      >
        Deutsch
      </button>
      <button
        type="button"
        className={`sv-btn ${language === "en" ? "sv-btn--primary" : ""}`}
        onClick={() => setLanguage("en")}
      >
        English
      </button>
    </div>
    <p style={{ fontSize: "0.75rem", opacity: 0.6, marginTop: 4 }}>
      Test: gleiche Voice, aber anderes Script in DE/EN.
    </p>
  </div>

            {/* 🔹 NEU: Titel */}
            <div>
              <label className="sv-label">
                Titel{" "}
                <span style={{ opacity: 0.5 }}>
                  (wird in Bibliothek & Account angezeigt)
                </span>
              </label>
              <input
                className="sv-input"
                type="text"
                maxLength={140}
                placeholder='z. B. "Soft whisper tapping – 10 min"'
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <label className="sv-label" style={{ margin: 0 }}>Prompt</label>
                <button
                  type="button"
                  className="sv-btn"
                  style={{ fontSize: "0.78rem", padding: "3px 10px" }}
                  onClick={() => void improvePrompt()}
                  disabled={rawPrompt.trim().length < 3 || isImproving}
                >
                  {isImproving ? "…" : "Verbessern"}
                </button>
              </div>
              <textarea
                className="sv-input"
                rows={4}
                placeholder='Beschreibe, was du hören möchtest (z. B. "sanftes Flüstern…")'
                value={rawPrompt}
                onChange={(e) => setRawPrompt(e.target.value)}
              />
              {improvedPrompt !== null && (
                <div
                  style={{
                    marginTop: 8,
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--color-nav-bg)",
                    background: "color-mix(in oklab, var(--color-card) 92%, var(--color-accent))",
                  }}
                >
                  <label className="sv-label" style={{ display: "block", marginBottom: 6 }}>
                    Verbesserter Prompt{" "}
                    <span style={{ fontWeight: 400, opacity: 0.55 }}>(bearbeitbar)</span>
                  </label>
                  <textarea
                    className="sv-input"
                    rows={3}
                    value={improvedPrompt}
                    onChange={(e) => setImprovedPrompt(e.target.value)}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button
                      type="button"
                      className="sv-btn sv-btn--primary"
                      onClick={() => { setRawPrompt(improvedPrompt); setImprovedPrompt(null); }}
                    >
                      Übernehmen
                    </button>
                    <button
                      type="button"
                      className="sv-btn"
                      onClick={() => setImprovedPrompt(null)}
                    >
                      Verwerfen
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Dauer */}
            <div>
              <label className="sv-label">
                Dauer (Sekunden){" "}
                <span style={{ opacity: 0.5 }}>(optional)</span>
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
              <p
                style={{
                  fontSize: "0.75rem",
                  opacity: 0.6,
                  marginTop: 4,
                }}
              >
                30–1800 Sekunden.
              </p>
            </div>

            {accountSummary && !accountSummary.isAdmin && (
              <p
                style={{
                  fontSize: "0.8rem",
                  opacity: 0.75,
                  marginTop: 4,
                }}
              >
                Credits: <strong>{accountSummary.credits}</strong>
                {accountSummary.credits <= 0 && (
                  <>
                    {" "}
                    – keine Credits verfügbar.{" "}
                    <Link
                      href="/billing"
                      style={{
                        textDecoration: "underline",
                        fontWeight: 600,
                      }}
                    >
                      Credits aufladen
                    </Link>
                  </>
                )}
              </p>
            )}

                                    <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              {/* 🔹 Admins sehen weiterhin den Simulations-Button */}
              {accountSummary?.isAdmin && (
                <button
                  className="sv-btn"
                  type="button"
                  onClick={async () => {
                    if (!job) return;
                    await fetch(`/api/jobs/${job.id}/complete`, {
                      method: "POST",
                      credentials: "include",
                    });
                    setPolling(true);
                  }}
                  disabled={!job || job.status === "DONE"}
                >
                  Simulation abschließen
                </button>
              )}

              {/* 🔹 Haupt-CTA: Generieren (für alle) */}
              <button
                className="sv-btn sv-btn--primary"
                type="button"
                onClick={createJob}
                disabled={!canSubmit || (typeof retryLeft === "number" && retryLeft > 0)}
                title={
                  typeof retryLeft === "number" && retryLeft > 0
                    ? `Warte ${retryLeft}s…`
                    : undefined
                }
              >
                {typeof retryLeft === "number" && retryLeft > 0
                  ? `Warte ${retryLeft}s…`
                  : "Generieren"}
              </button>
            </div>
          </div>
        </section>

        {/* Aktueller Job */}
        {job && (
                <section style={{ marginTop: 16 }}>
                  <StatusCard
                    job={job}
                    isAdmin={!!accountSummary?.isAdmin}
                    title={(() => {
                      // 1) Bevorzugt immer das, was du im Titel-Input eingegeben hast
                      const uiTitle = title.trim();
                      if (uiTitle) return uiTitle;

                      // 2) Falls aus irgendeinem Grund kein Input-Titel (z.B. alter Job):
                      //    versuch aus dem Job-Objekt den Titel zu ziehen
                      const anyJob = job as unknown as { title?: string | null };
                      const jobTitle = anyJob.title?.trim();
                      if (jobTitle) return jobTitle;

                      // 3) Fallback: unsere kompakte Darstellung (Prompt o.Ä.)
                      return displayJobTitle(job);
                    })()}
                  />
                </section>
              )}

        {/* Liste */}
        <section style={{ marginTop: 24 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 8,
            }}
          >
            <h2 style={{ fontSize: "1.1rem", fontWeight: 700, margin: 0 }}>
              Deine letzten Jobs
            </h2>
            <Link
              href="/library"
              style={{
                fontSize: "0.85rem",
                fontWeight: 600,
                textDecoration: "none",
                padding: "0.4rem 0.85rem",
                borderRadius: 999,
                border: "1px solid var(--color-nav-bg)",
                background: "var(--color-card)",
              }}
            >
              Zur Bibliothek →
            </Link>
          </div>
          {!Array.isArray(jobList) || jobList.length === 0 ? (
            <p style={{ opacity: 0.7 }}>Noch keine Jobs gefunden.</p>
          ) : (
            <ul
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
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
                    <div
                      style={{
                        fontWeight: 600,
                        overflowWrap: "anywhere",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      {displayJobTitle(j)}
                    </div>
                    <div
                      style={{
                        fontSize: "0.75rem",
                        opacity: 0.7,
                      }}
                    >
                      {j.preset || "—"}
                      {j.language ? ` · ${j.language.toUpperCase()}` : ""}
                      {j.durationSec ? ` · ${j.durationSec}s` : ""}
                      {j.createdAt
                        ? ` · ${new Date(j.createdAt).toLocaleString(
                            "de-DE"
                          )}`
                        : ""}
                      {typeof j.chapterCount === "number" && j.chapterCount > 1
  ? ` · ${j.chapterCount} Kapitel`
  : ""}  
                        
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      flexShrink: 0,
                    }}
                  >
                    <StatusPill status={j.status} />
                    {j.status === "DONE" && j.resultUrl ? (
  typeof j.chapterCount === "number" && j.chapterCount > 1 ? (
    // Story: kein Mini-Player, stattdessen Album-CTA
    j.storyId ? (
      <a
        href={`/s/${j.storyId}`}
        className="sv-btn"
        style={{ padding: "4px 10px", textDecoration: "none", display: "inline-flex", alignItems: "center" }}
      >
        ▶ Album abspielen
      </a>
    ) : null
  ) : (
    // Normal: Mini-Player
    <CustomPlayer
      src={j.resultUrl}
      preload="metadata"
      showTitle={false}
      maxWidth={190}
    />
  )
) : null}
                    {typeof j.chapterCount === "number" && j.chapterCount > 1 && j.storyId ? (
  <a
    href={`/s/${j.storyId}`}
    className="sv-btn"
    style={{ padding: "4px 10px", textDecoration: "none", display: "inline-flex", alignItems: "center" }}
  >
    Album öffnen
  </a>
) : null}
                    <button
                      type="button"
                      onClick={() => void deleteJob(j.id)}
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
          {Array.isArray(jobList) && hasMore && (
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                onClick={() => void loadJobs(jobList.length)}
                className="sv-btn"
                disabled={loadingList}
              >
                {loadingList ? "Lade…" : "Mehr laden"}
              </button>
            </div>
          )}
        </section>

        {/* Toast-UI */}
        {toast && (
          <div
            role="status"
            aria-live="polite"
            style={{
              position: "fixed",
              right: 16,
              bottom: 16,
              background:
                toast.kind === "err"
                  ? "color-mix(in oklab, #ef4444 30%, var(--color-card))"
                  : toast.kind === "ok"
                  ? "color-mix(in oklab, #16a34a 24%, var(--color-card))"
                  : "color-mix(in oklab, var(--color-accent) 20%, var(--color-card))",
              color: "var(--color-text)",
              border: "1px solid var(--color-nav-bg)",
              borderRadius: 12,
              boxShadow: "0 10px 24px rgba(0,0,0,.14)",
              padding: "10px 12px",
              fontWeight: 600,
              zIndex: 1000,
              maxWidth: 360,
            }}
          >
            {toast.msg}
          </div>
        )}
      </div>
    </main>
  );
}

function StatusCard({
  job,
  isAdmin,
  title,
}: {
  job: Job;
  isAdmin: boolean;
  title: string;
}) {
    const headerTitle = isAdmin ? `Job: ${job.id}` : title;
  return (
    <div
      style={{
        background: "var(--color-card)",
        border: "1px solid var(--color-nav-bg)",
        borderRadius: 12,
        padding: 16,
      }}
    >
            <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <strong>{headerTitle}</strong>
        <StatusPill status={job.status} />
      </div>
      {job.durationSec ? (
        <p
          style={{
            marginTop: 6,
            fontSize: "0.8rem",
            opacity: 0.75,
          }}
        >
          Dauer: {job.durationSec}s
        </p>
      ) : null}
      {job.status === "DONE" && job.resultUrl && (
        <div style={{ marginTop: 12 }}>
          <CustomPlayer src={job.resultUrl} preload="auto" showTitle={false} />
        </div>
      )}
      {job.status === "FAILED" && (
        <p
          style={{
            color: "#e11d48",
            fontWeight: 600,
            marginTop: 8,
          }}
        >
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

const navLinkStyle: React.CSSProperties = {
  padding: "0.4rem 0.85rem",
  borderRadius: 6,
  background: "var(--color-nav-bg)",
  color: "var(--color-nav-text)",
  textDecoration: "none",
  fontWeight: 600,
  fontSize: "0.9rem",
};