// app/generate/ui.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type React from "react";

import { useSVTheme, SVCard, type ThemeConfig } from "@/app/components/sv-kit";
import SVScene from "@/app/components/sv-scene";
import { usePlayer, type Chapter } from "@/app/components/player-context";

const PRESETS = [
  { id: "sleep-story",  label: "Sleep Story",  desc: "Calm · Slow" },
  { id: "kids-story",   label: "Kids Story",   desc: "Gentle · Safe" },
  { id: "classic-asmr", label: "Classic ASMR", desc: "Whisper · Tapping" },
  { id: "meditation",   label: "Meditation",   desc: "Breath · Soft Tone" },
];

// ── Suggestion pills — static V1 ─────────────────────────────────────────────
// Each entry sets prompt + preset on click. No auto-generation.
// Future: extend with history-based, refreshable, or AI-generated suggestions.
const SUGGESTIONS: { label: string; prompt: string; preset: string }[] = [
  {
    label: "Sanfte Einschlafgeschichte",
    prompt: "Eine sanfte Einschlafgeschichte über einen ruhigen Abend, der langsam in einen tiefen, erholsamen Schlaf gleitet",
    preset: "sleep-story",
  },
  {
    label: "Ruhige persönliche Aufmerksamkeit",
    prompt: "Eine ruhige, persönliche ASMR-Session mit sanfter Stimme und achtsamer Aufmerksamkeit",
    preset: "classic-asmr",
  },
  {
    label: "Kurze Atemmeditation",
    prompt: "Eine kurze Atemmeditation zum Loslassen von Anspannung und Ankommen im Moment",
    preset: "meditation",
  },
  {
    label: "Langsame ASMR-Session",
    prompt: "Eine langsame, beruhigende ASMR-Session mit weicher Stimme und ruhigem Tempo",
    preset: "classic-asmr",
  },
  {
    label: "Gute-Nacht für Kinder",
    prompt: "Eine freundliche Gute-Nacht-Geschichte für Kinder über ein kleines Tier, das seinen Schlafplatz findet",
    preset: "kids-story",
  },
  {
    label: "Körperscan zum Einschlafen",
    prompt: "Eine geführte Körperscan-Meditation, die Schritt für Schritt zu tiefer Entspannung und Schlaf führt",
    preset: "meditation",
  },
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
  title?: string | null;
  language?: "de" | "en" | null;
  storyId?: string | null;
  chapterCount?: number | null;
};

type AccountSummary = {
  credits: number;
  isAdmin: boolean;
  hasSubscription: boolean;
};

const PAGE_SIZE = 10;

type CreditsResponse =
  | { credits: number }
  | { ok: true; data: { credits: number } };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function formatSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

// Fetches and maps chapter list for a story job.
// Returns [] on any failure — caller decides how to surface errors.
async function fetchStoryChapters(storyId: string): Promise<Chapter[]> {
  try {
    const res = await fetch(
      `/api/tracks?storyId=${encodeURIComponent(storyId)}&take=200`,
      { credentials: "include" },
    );
    if (!res.ok) {
      console.error(`fetchStoryChapters: HTTP ${res.status} for story ${storyId}`);
      return [];
    }
    const raw: unknown = await res.json().catch(() => null);
    const payload =
      raw && typeof raw === "object" && "data" in (raw as object)
        ? (raw as { data: unknown }).data
        : raw;
    const list: unknown[] = Array.isArray((payload as { items?: unknown })?.items)
      ? (payload as { items: unknown[] }).items
      : Array.isArray(payload)
      ? (payload as unknown[])
      : [];

    return list
      .map((item) => {
        const it = item as Record<string, unknown>;
        const partIndex = typeof it.partIndex === "number" ? it.partIndex : 0;
        return {
          id: String(it.id ?? ""),
          url: String(it.url ?? ""),
          // Use per-chapter label; the story title is shown separately in the player UI
          title: `Kapitel ${partIndex + 1}`,
          partIndex,
          durationSeconds:
            typeof it.durationSeconds === "number" ? it.durationSeconds : undefined,
        };
      })
      .filter((ch) => ch.id && ch.url)
      .sort((a, b) => a.partIndex - b.partIndex);
  } catch (err) {
    console.error("fetchStoryChapters: unexpected error", err);
    return [];
  }
}

type GenerateClientProps = {
  initialPrompt?: string;
  initialPreset?: string;
  initialRef?: string;
  initialRefType?: string;
  initialSourceTitle?: string;
  initialDurationMin?: number;
};

export default function GenerateClient({
  initialPrompt,
  initialPreset,
  initialRef,
  initialRefType,
  initialSourceTitle,
  initialDurationMin,
}: GenerateClientProps) {
  const validPreset = PRESETS.find((p) => p.id === initialPreset)?.id ?? PRESETS[0].id;
  const [preset, setPreset] = useState<string>(validPreset);
  const [title, setTitle] = useState(initialSourceTitle ?? "");
  const [rawPrompt, setRawPrompt] = useState(initialPrompt ?? "");
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);
  const [improvedPrompt, setImprovedPrompt] = useState<string | null>(null);
  const [isImproving, setIsImproving] = useState(false);
  const [durationMin, setDurationMin] = useState<number | "">(initialDurationMin ?? "");

  // Variation context
  const [variationSourceTitle, setVariationSourceTitle] = useState<string | null>(initialSourceTitle ?? null);
  const [variationScript, setVariationScript] = useState<string | null>(null);
  const [scriptPanelOpen, setScriptPanelOpen] = useState(false);

  // Script edit mode (only active when variationScript is loaded)
  const [scriptEditMode, setScriptEditMode] = useState(false);
  const [editedScript, setEditedScript] = useState("");
  const [scriptSafetyError, setScriptSafetyError] = useState<string | null>(null);
  const [exitScriptConfirm, setExitScriptConfirm] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [polling, setPolling] = useState(false);
  const [jobList, setJobList] = useState<Job[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [accountSummary, setAccountSummary] = useState<AccountSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [voiceStyle, setVoiceStyle] = useState<"soft" | "whisper">("soft");
  const [voiceGender, setVoiceGender] = useState<"female" | "male">("female");
  const [credits, setCredits] = useState<number | null>(null);
  const [language, setLanguage] = useState<"de" | "en">("de");
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [openJobMenu, setOpenJobMenu] = useState<string | null>(null);

  // Global player
  const { loadTrack, loadStory } = usePlayer();

  // Theme — shared with player pages
  const { themeKey, themeCfg, cycleTheme, logoSrc } = useSVTheme();

  // Keep CSS variable classes in sync so sv-btn / sv-input / sv-label CSS classes still work
  useEffect(() => {
    document.documentElement.className = themeKey;
  }, [themeKey]);

  const isDark = themeKey === "dark";

  // ---------- Toast ----------
  const [toast, setToast] = useState<{ msg: string; kind?: "ok" | "err" | "info" } | null>(null);
  const [retryLeft, setRetryLeft] = useState<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const scriptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);

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
    if (scriptEditMode) {
      // In script-edit mode: title required + non-empty edited script
      if (!titleOk || editedScript.trim().length < 10) return false;
    } else {
      const promptOk = rawPrompt.trim().length >= 3;
      if (!titleOk || !promptOk) return false;
    }
    if (!accountSummary) return true;
    if (accountSummary.isAdmin) return true;
    return accountSummary.credits > 0;
  }, [title, rawPrompt, scriptEditMode, editedScript, accountSummary]);

  useEffect(() => {
    void loadJobs(0);
  }, []);

  useEffect(() => {
    void refreshCredits();
  }, []);

  // Load reference data for variation flow
  useEffect(() => {
    if (!initialRef || !initialRefType) return;
    const url =
      initialRefType === "story"
        ? `/api/stories/${encodeURIComponent(initialRef)}`
        : `/api/tracks/${encodeURIComponent(initialRef)}`;
    void fetch(url, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((raw: unknown) => {
        if (!raw || typeof raw !== "object") return;
        const payload =
          (raw as { ok?: boolean; data?: unknown }).ok === true
            ? (raw as { data: unknown }).data
            : raw;
        if (!payload || typeof payload !== "object") return;
        const d = payload as Record<string, unknown>;
        if (typeof d.scriptText === "string" && d.scriptText.trim()) {
          setVariationScript(d.scriptText.trim());
        }
      })
      .catch(() => null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshCredits() {
    try {
      const res = await fetch("/api/account/credits");
      if (!res.ok) return;
      const raw: unknown = await res.json();

      let value: number | null = null;

      if (isRecord(raw) && typeof raw.credits === "number") {
        value = raw.credits;
      } else if (
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
      // ignore
    }
  }

  useEffect(() => {
    const loadSummary = async () => {
      setLoadingSummary(true);
      try {
        const res = await fetch("/api/account/summary");
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
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
      scriptOverride?: string;
    } = {
      title: title.trim().length > 0 ? title.trim() : "",
      preset,
      prompt: rawPrompt,
      language,
      voiceStyle,
      voiceGender,
      ...(scriptEditMode && editedScript.trim() ? { scriptOverride: editedScript.trim() } : {}),
    };

    if (typeof durationMin === "number" && !Number.isNaN(durationMin)) {
      body.durationSec = durationMin * 60;
    }

    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "include",
    });

    if (res.status === 429) {
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

    if (res.status === 402) {
      let msg = "Du hast keine Credits mehr. Bitte lade Credits nach.";
      try {
        const data = (await res.json()) as { message?: string };
        if (data?.message) msg = data.message;
      } catch {
        /* ignore */
      }
      showToast(msg, "err");
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
    void refreshCredits();

    setAccountSummary((prev) => {
      if (!prev || prev.isAdmin) return prev;
      const nextCredits = Math.max(0, prev.credits - 1);
      return { ...prev, credits: nextCredits };
    });

    showToast("Job erstellt.", "ok");

    if (!accountSummary?.isAdmin) {
      try {
        const completeRes = await fetch(`/api/jobs/${data.id}/complete`, {
          method: "POST",
          credentials: "include",
        });

        if (!completeRes.ok) {
          if (completeRes.status === 422) {
            try {
              const errBody = (await completeRes.json()) as { error?: string; message?: string; data?: { message?: string } } | null;
              const isSafety = errBody?.error === "CONTENT_SAFETY";
              if (isSafety && scriptEditMode) {
                const msg = errBody?.data?.message ?? errBody?.message ?? "Dein Script enthält unerlaubte Inhalte. Bitte überarbeite den Text.";
                setScriptSafetyError(msg);
                setPolling(false);
                return;
              }
            } catch { /* ignore */ }
          }
          console.error("Auto-Complete für Job fehlgeschlagen:", completeRes.status);
          return;
        }

        const rawComplete: unknown = await completeRes.json().catch(() => null);
        const completed = extractItem<Job>(rawComplete);

        if (completed) {
          setJob(completed);
          setPolling(false);
          void loadJobs(0);
          if ((completed as Record<string, unknown>).kidsSafetyApplied) {
            showToast("Dein Inhalt wurde für Kids Story angepasst.", "info", 5000);
          }

          const trimmedTitle = title.trim();
          const playerTitle = trimmedTitle.length > 0 ? trimmedTitle : displayJobTitle(completed);

          // Load the finished audio into the global bottom player.
          // Multi-chapter stories use loadStory(); single tracks use loadTrack().
          const isCompletedStory =
            !!completed.storyId && (completed.chapterCount ?? 0) > 1;
          if (isCompletedStory) {
            const chapters = await fetchStoryChapters(completed.storyId!);
            if (chapters.length > 0) {
              loadStory(completed.storyId!, chapters, undefined, playerTitle);
            } else {
              // Auto-complete is silent from the user's perspective; log so it's traceable.
              console.error(
                "fetchStoryChapters returned empty list for job",
                completed.id,
              );
            }
          } else if (completed.resultUrl) {
            loadTrack(completed.resultUrl, playerTitle, completed.id);
          }

          try {
            await fetch("/api/tracks", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                jobId: completed.id,
                title: trimmedTitle.length > 0 ? trimmedTitle : undefined,
              }),
            });
          } catch (e) {
            console.error("Track-Titel konnte nicht gesetzt werden:", e);
          }
        }
      } catch (err) {
        console.error("Fehler beim Auto-Complete:", err);
      }
    }
  }

  useEffect(() => {
    if (!job || !polling) return;

    const intervalId = window.setInterval(async () => {
      const res = await fetch(`/api/jobs/${job.id}`, { credentials: "include" });
      if (!res.ok) return;

      const fresh = await res.json().catch(() => null);
      const next = extractItem<Job>(fresh);
      if (!next) return;

      setJob(next);

      if (next.status === "DONE") {
        const trimmedTitle = title.trim();
        if (trimmedTitle.length > 0) {
          try {
            await fetch("/api/tracks", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ jobId: next.id, title: trimmedTitle }),
            });
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

  useEffect(() => {
    let current: HTMLAudioElement | null = null;
    const handlePlay = (event: Event) => {
      const target = event.target as HTMLAudioElement | null;
      if (!target || target.tagName !== "AUDIO") return;
      if (current && current !== target && !current.paused) current.pause();
      current = target;
    };
    document.addEventListener("play", handlePlay, true);
    return () => {
      document.removeEventListener("play", handlePlay, true);
      current = null;
    };
  }, []);

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

  const isAdmin = accountSummary?.isAdmin === true;

  const displayJobTitle = (j: Job): string => {
    const anyJob = j as unknown as { title?: string | null };
    const raw = (anyJob.title ?? j.prompt ?? "").trim();
    if (raw.length === 0) return "(ohne Titel)";
    return raw.length > 120 ? raw.slice(0, 117) + "…" : raw;
  };

  const isSubmitDisabled = !canSubmit || (typeof retryLeft === "number" && retryLeft > 0);

  // glassPanel — matches Home page exactly (no borderRadius — add it at use site)
  const glassPanel = useMemo((): React.CSSProperties => {
    return {
      background: isDark ? "rgba(15,23,42,0.52)" : "rgba(248,250,252,0.62)",
      border: isDark ? "1px solid rgba(148,163,184,0.22)" : "1px solid rgba(148,163,184,0.28)",
      color: themeCfg.uiText,
      backdropFilter: "blur(18px)",
      WebkitBackdropFilter: "blur(18px)",
      boxShadow: isDark ? "0 26px 80px rgba(0,0,0,0.55)" : "0 22px 60px rgba(15,23,42,0.25)",
    };
  }, [themeKey, themeCfg.uiText]);

  return (
    <SVScene theme={themeKey}>
      <style>{`.sv-no-spinner::-webkit-outer-spin-button,.sv-no-spinner::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}.sv-no-spinner{-moz-appearance:textfield}`}</style>
      <main style={{ color: themeCfg.uiText, minHeight: "100vh", overflowX: "hidden" }}>
        {/* ===== Header — floating inset, matches Home exactly ===== */}
        <header
          style={{
            position: "fixed",
            top: 18,
            left: 18,
            right: 18,
            zIndex: 30,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            pointerEvents: "auto",
          }}
        >
          {/* Logo — clicking cycles the theme */}
          <button
            type="button"
            onClick={cycleTheme}
            style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer" }}
            aria-label="Theme wechseln"
            title="Theme wechseln"
          >
            <Image src={logoSrc} alt="SoftVibe Logo" width={160} height={50} priority />
          </button>

          {/* Home — absolutely centered in header */}
          <Link
            href="/"
            title="Startseite"
            style={{
              position: "absolute",
              left: "50%",
              transform: "translateX(-50%)",
              width: 40,
              height: 40,
              borderRadius: 999,
              border: `1px solid ${themeCfg.secondaryButtonBorder}`,
              background: themeCfg.secondaryButtonBg,
              color: themeCfg.secondaryButtonText,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              textDecoration: "none",
              boxShadow: "0 8px 20px rgba(0,0,0,0.2)",
              flexShrink: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 2.5L2 9h2.5v8.5h5V13h1v4.5h5V9H18L10 2.5z" />
            </svg>
          </Link>

          {/* Menu — hover-based shared wrapper */}
          <div
            style={{ position: "relative" }}
            onMouseEnter={() => setMenuOpen(true)}
            onMouseLeave={() => setMenuOpen(false)}
          >
            <button
              type="button"
              style={{
                width: 40,
                height: 40,
                borderRadius: 999,
                border: `1px solid ${themeCfg.secondaryButtonBorder}`,
                background: themeCfg.secondaryButtonBg,
                color: themeCfg.secondaryButtonText,
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
                boxShadow: "0 10px 25px rgba(0,0,0,0.25)",
                fontWeight: 900,
              }}
              aria-label="Menü"
              title="Menü"
            >
              ☰
            </button>

            {menuOpen && (
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 8px)",
                  zIndex: 90,
                  width: "min(360px, calc(100vw - 28px))",
                  padding: 2,
                  borderRadius: 26,
                  background:
                    themeKey === "dark"
                      ? "radial-gradient(circle at top, rgba(56,189,248,0.22), transparent 68%)"
                      : "radial-gradient(circle at top, rgba(244,114,182,0.32), transparent 70%)",
                  boxShadow: "0 26px 80px rgba(0,0,0,0.7)",
                }}
              >
                <div style={{ ...glassPanel, padding: 16, borderRadius: 24 }}>
                  {/* Header row */}
                  <div style={{ fontSize: "0.8rem", letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 800, color: themeCfg.uiSoftText, marginBottom: 10 }}>
                    Menü
                  </div>

                  {/* Credits */}
                  <div style={{ fontSize: "0.78rem", color: themeCfg.uiSoftText, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                    {accountSummary?.isAdmin ? "∞ Credits" : `${creditsLabel} Credits`}
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
                    {[
                      { label: "Features", href: "/#features" },
                      { label: "Über SoftVibe", href: "/#about" },
                      { label: "Kontakt", href: "/#contact" },
                    ].map((x) => (
                      <Link
                        key={x.href}
                        href={x.href}
                        onClick={() => setMenuOpen(false)}
                        style={{ ...pillStyle(themeCfg, "secondary"), width: "100%", textAlign: "left" as const, display: "block" }}
                      >
                        {x.label}
                      </Link>
                    ))}

                    <div style={{ height: 1, background: "rgba(148,163,184,0.25)", margin: "4px 0" }} />

                    <Link
                      href="/library"
                      onClick={() => setMenuOpen(false)}
                      style={{ ...pillStyle(themeCfg, "secondary"), width: "100%", textAlign: "left" as const, display: "block" }}
                    >
                      Library
                    </Link>

                    <div style={{ height: 1, background: "rgba(148,163,184,0.25)", margin: "4px 0" }} />

                    <form action="/api/auth/signout" method="post">
                      <button
                        type="submit"
                        style={{ ...pillStyle(themeCfg, "secondary"), width: "100%", textAlign: "left" as const }}
                      >
                        Logout
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            )}
          </div>
        </header>

        {/* ===== Page Content — matches SVScene content structure ===== */}
        <div style={{ position: "relative", zIndex: 10 }}>
        <div
          style={{
            maxWidth: "min(980px, 100vw - 36px)",
            margin: "0 auto",
            padding: "88px 18px 100px",
          }}
        >
          {/* ===== Generation Card ===== */}
          <div style={{ padding: "0 4px" }}>
            {/* Card hero — left-aligned title + subtitle */}
            <div style={{ textAlign: "left", marginBottom: 32 }}>
              <h1
                style={{
                  fontSize: "1.9rem",
                  fontWeight: 850,
                  margin: "0 0 8px",
                  letterSpacing: "-0.02em",
                  color: themeCfg.uiText,
                }}
              >
                Generieren
              </h1>
              <p style={{ fontSize: "0.92rem", color: themeCfg.uiSoftText, margin: 0, lineHeight: 1.5 }}>
                Erstelle deinen persönlichen Entspannungs-Sound in wenigen Minuten.
              </p>
            </div>

            <div style={{ display: "grid", gap: 22 }}>

              {/* Variation banner */}
              {variationSourceTitle && (
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: 12, padding: "10px 16px", borderRadius: 12,
                  background: isDark ? "rgba(139,92,246,0.12)" : "rgba(139,92,246,0.08)",
                  border: `1px solid ${isDark ? "rgba(139,92,246,0.28)" : "rgba(139,92,246,0.22)"}`,
                }}>
                  <span style={{ fontSize: "0.82rem", color: themeCfg.uiText, fontWeight: 600 }}>
                    <span style={{ color: themeCfg.uiSoftText, fontWeight: 400 }}>Variation von </span>
                    {variationSourceTitle}
                  </span>
                  <button
                    type="button"
                    onClick={() => setVariationSourceTitle(null)}
                    style={{ flexShrink: 0, background: "transparent", border: "none", color: themeCfg.uiSoftText, cursor: "pointer", fontSize: "0.9rem", lineHeight: 1, padding: 2 }}
                    title="Schließen"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Original script reference + edit mode */}
              {variationScript && (
                <div style={{
                  borderRadius: 12,
                  border: `1px solid ${scriptEditMode
                    ? (isDark ? "rgba(251,191,36,0.45)" : "rgba(217,119,6,0.35)")
                    : themeCfg.cardBorder}`,
                  overflow: "hidden",
                  transition: "border-color 200ms ease",
                }}>
                  {/* Panel header */}
                  <div style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "10px 14px",
                    background: scriptEditMode
                      ? (isDark ? "rgba(251,191,36,0.08)" : "rgba(217,119,6,0.06)")
                      : (isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)"),
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => { if (!scriptEditMode) setScriptPanelOpen((v) => !v); }}
                        style={{
                          background: "transparent", border: "none", cursor: scriptEditMode ? "default" : "pointer",
                          color: themeCfg.uiSoftText, fontSize: "0.78rem", fontWeight: 700,
                          letterSpacing: "0.08em", textTransform: "uppercase" as const, padding: 0,
                          display: "flex", alignItems: "center", gap: 6,
                        }}
                      >
                        {!scriptEditMode && <span style={{ fontSize: "0.72rem" }}>{scriptPanelOpen ? "▲" : "▼"}</span>}
                        <span>{scriptEditMode ? "Skript bearbeiten" : "Originales Skript"}</span>
                      </button>
                      {scriptEditMode && (
                        <span style={{
                          fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.08em",
                          textTransform: "uppercase" as const,
                          padding: "2px 7px", borderRadius: 999,
                          background: isDark ? "rgba(251,191,36,0.18)" : "rgba(217,119,6,0.12)",
                          color: isDark ? "rgb(251,191,36)" : "rgb(161,71,8)",
                        }}>
                          Script-Modus
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {scriptEditMode ? (
                        <button
                          type="button"
                          onClick={() => {
                            const hasEdits = editedScript !== variationScript;
                            if (hasEdits) {
                              setExitScriptConfirm(true);
                            } else {
                              setScriptEditMode(false);
                              setEditedScript("");
                              setScriptSafetyError(null);
                            }
                          }}
                          style={{
                            background: "transparent", border: "none", cursor: "pointer",
                            color: themeCfg.uiSoftText, fontSize: "0.78rem", fontWeight: 600,
                            padding: 0, textDecoration: "underline",
                          }}
                        >
                          Zurück zum Prompt
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setScriptEditMode(true);
                            setEditedScript(variationScript);
                            setScriptPanelOpen(false);
                            setExitScriptConfirm(false);
                            setTimeout(() => scriptTextareaRef.current?.focus(), 50);
                          }}
                          style={{
                            background: "transparent", border: `1px solid ${themeCfg.cardBorder}`,
                            borderRadius: 999, cursor: "pointer",
                            color: themeCfg.uiText, fontSize: "0.75rem", fontWeight: 600,
                            padding: "3px 10px",
                          }}
                        >
                          Skript bearbeiten
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Read-only view */}
                  {!scriptEditMode && scriptPanelOpen && (
                    <div style={{
                      maxHeight: 240, overflowY: "auto",
                      padding: "12px 14px",
                      background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)",
                      fontSize: "0.84rem", color: themeCfg.uiText,
                      whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.7,
                    }}>
                      {variationScript}
                    </div>
                  )}

                  {/* Editable textarea */}
                  {scriptEditMode && (
                    <div style={{ padding: "12px 14px 10px", background: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)" }}>
                      <textarea
                        ref={scriptTextareaRef}
                        rows={12}
                        value={editedScript}
                        onChange={(e) => { setEditedScript(e.target.value); if (scriptSafetyError) setScriptSafetyError(null); }}
                        style={{
                          ...svInputStyle(themeKey, true),
                          resize: "vertical" as const,
                          minHeight: 200,
                          fontFamily: "inherit",
                          fontSize: "0.84rem",
                          lineHeight: 1.7,
                        }}
                        placeholder="Skript hier bearbeiten …"
                      />
                      {scriptSafetyError && (
                        <div style={{
                          marginTop: 8,
                          padding: "8px 12px",
                          borderRadius: 8,
                          background: isDark ? "rgba(239,68,68,0.12)" : "rgba(239,68,68,0.08)",
                          border: "1px solid rgba(239,68,68,0.4)",
                          color: isDark ? "#fca5a5" : "#b91c1c",
                          fontSize: "0.8rem",
                          lineHeight: 1.5,
                        }}>
                          {scriptSafetyError}
                        </div>
                      )}
                      {exitScriptConfirm && (
                        <div style={{
                          marginTop: 8,
                          padding: "10px 12px",
                          borderRadius: 8,
                          background: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
                          border: `1px solid ${themeCfg.cardBorder}`,
                          fontSize: "0.8rem",
                          color: themeCfg.uiText,
                          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                        }}>
                          <span>Änderungen verwerfen und zum Prompt wechseln?</span>
                          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                            <button
                              type="button"
                              onClick={() => { setScriptEditMode(false); setEditedScript(""); setScriptSafetyError(null); setExitScriptConfirm(false); }}
                              style={{ padding: "3px 10px", borderRadius: 999, border: "none", background: themeCfg.primaryButtonBg, color: themeCfg.primaryButtonText, fontSize: "0.78rem", fontWeight: 700, cursor: "pointer" }}
                            >
                              Verwerfen
                            </button>
                            <button
                              type="button"
                              onClick={() => setExitScriptConfirm(false)}
                              style={{ padding: "3px 10px", borderRadius: 999, border: `1px solid ${themeCfg.cardBorder}`, background: "transparent", color: themeCfg.uiSoftText, fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" }}
                            >
                              Abbrechen
                            </button>
                          </div>
                        </div>
                      )}
                      <div style={{
                        display: "flex", justifyContent: "flex-end",
                        fontSize: "0.72rem", marginTop: 4,
                        color: editedScript.length > 2000
                          ? "#e11d48"
                          : editedScript.length > 1800
                          ? (isDark ? "rgb(251,191,36)" : "rgb(161,71,8)")
                          : themeCfg.uiSoftText,
                        fontWeight: editedScript.length > 1800 ? 700 : 400,
                      }}>
                        {editedScript.length} / 2500 Zeichen
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Preset — flex wrap, only active expands */}
              <div>
                <label className="sv-label" style={{ display: "block", marginBottom: 8 }}>
                  Welches Preset?
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {PRESETS.map((p) => {
                    const isActive = preset === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPreset(p.id)}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: isActive ? "0.6rem 1.2rem" : "0.38rem 0.9rem",
                          borderRadius: 999,
                          border: `1.5px solid ${isActive ? themeCfg.primaryButtonBg : themeCfg.cardBorder}`,
                          background: isActive ? themeCfg.primaryButtonBg : "transparent",
                          color: isActive ? themeCfg.primaryButtonText : themeCfg.uiText,
                          cursor: "pointer",
                          transition: "border-color 150ms ease, background 150ms ease, padding 150ms ease, color 150ms ease, box-shadow 150ms ease",
                          textAlign: "center",
                          flexShrink: 0,
                          boxShadow: isActive ? "0 8px 24px rgba(0,0,0,0.3)" : "none",
                        }}
                      >
                        <span style={{ fontWeight: isActive ? 700 : 600, fontSize: "0.85rem" }}>{p.label}</span>
                        {isActive && (
                          <span style={{ fontSize: "0.72rem", color: themeCfg.primaryButtonText, opacity: 0.72, marginTop: 3 }}>{p.desc}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Language + Voice controls — pill rows */}
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
                <div>
                  <label className="sv-label" style={{ display: "block", marginBottom: 8 }}>In welcher Sprache?</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    {(["de", "en"] as const).map((lang) => {
                      const active = language === lang;
                      return (
                        <button key={lang} type="button" onClick={() => setLanguage(lang)}
                          style={{
                            padding: "0.38rem 0.85rem", borderRadius: 999,
                            border: active ? "none" : `1px solid ${themeCfg.secondaryButtonBorder}`,
                            background: active ? themeCfg.primaryButtonBg : themeCfg.secondaryButtonBg,
                            color: active ? themeCfg.primaryButtonText : themeCfg.secondaryButtonText,
                            fontSize: "0.85rem", fontWeight: 700, cursor: "pointer",
                            boxShadow: active ? "0 14px 35px rgba(0,0,0,0.35)" : "0 8px 20px rgba(0,0,0,0.18)",
                            transition: "background 150ms ease",
                          }}
                        >
                          {lang === "de" ? "Deutsch" : "English"}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="sv-label" style={{ display: "block", marginBottom: 8 }}>Stimme</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    {(["female", "male"] as const).map((g) => {
                      const active = voiceGender === g;
                      return (
                        <button key={g} type="button" onClick={() => setVoiceGender(g)}
                          style={{
                            padding: "0.38rem 0.85rem", borderRadius: 999,
                            border: active ? "none" : `1px solid ${themeCfg.secondaryButtonBorder}`,
                            background: active ? themeCfg.primaryButtonBg : themeCfg.secondaryButtonBg,
                            color: active ? themeCfg.primaryButtonText : themeCfg.secondaryButtonText,
                            fontSize: "0.85rem", fontWeight: 700, cursor: "pointer",
                            boxShadow: active ? "0 14px 35px rgba(0,0,0,0.35)" : "0 8px 20px rgba(0,0,0,0.18)",
                            transition: "background 150ms ease",
                          }}
                        >
                          {g === "female" ? "Weiblich" : "Männlich"}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {preset === "classic-asmr" && (
                  <div>
                    <label className="sv-label" style={{ display: "block", marginBottom: 8 }}>Klangstil</label>
                    <div style={{ display: "flex", gap: 6 }}>
                      {(["soft", "whisper"] as const).map((s) => {
                        const active = voiceStyle === s;
                        return (
                          <button key={s} type="button" onClick={() => setVoiceStyle(s)}
                            style={{
                              padding: "0.38rem 0.85rem", borderRadius: 999,
                              border: active ? "none" : `1px solid ${themeCfg.secondaryButtonBorder}`,
                              background: active ? themeCfg.primaryButtonBg : themeCfg.secondaryButtonBg,
                              color: active ? themeCfg.primaryButtonText : themeCfg.secondaryButtonText,
                              fontSize: "0.85rem", fontWeight: 700, cursor: "pointer",
                              boxShadow: active ? "0 14px 35px rgba(0,0,0,0.35)" : "0 8px 20px rgba(0,0,0,0.18)",
                              transition: "background 150ms ease",
                            }}
                          >
                            {s === "soft" ? "Soft" : "Whisper"}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Title */}
              <div>
                <label className="sv-label" style={{ display: "block", marginBottom: 8 }}>
                  Wie soll die Audio heißen?{" "}
                  <span style={{ color: themeCfg.uiSoftText, fontWeight: 400 }}>— erscheint in der Bibliothek</span>
                </label>
                <input
                  type="text"
                  maxLength={140}
                  placeholder='z. B. "Sanfter Regen – 10 min"'
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  style={svInputStyle(themeKey)}
                />
                {scriptEditMode && (
                  <p style={{ fontSize: "0.78rem", color: themeCfg.uiSoftText, marginTop: 6, marginBottom: 0 }}>
                    Dein bearbeitetes Skript wird direkt verwendet.
                  </p>
                )}
              </div>

              {/* Prompt — hidden in script mode */}
              {!scriptEditMode && <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <label className="sv-label" style={{ margin: 0, fontSize: "0.95rem" }}>
                    Was möchtest du hören?
                  </label>
                  <button
                    type="button"
                    onClick={() => void improvePrompt()}
                    disabled={rawPrompt.trim().length < 3 || isImproving}
                    style={{
                      padding: "0.3rem 0.8rem", borderRadius: 999,
                      border: `1px solid ${themeCfg.secondaryButtonBorder}`,
                      background: themeCfg.secondaryButtonBg,
                      color: themeCfg.secondaryButtonText,
                      fontSize: "0.78rem", fontWeight: 650,
                      cursor: rawPrompt.trim().length < 3 || isImproving ? "not-allowed" : "pointer",
                      opacity: rawPrompt.trim().length < 3 || isImproving ? 0.45 : 1,
                      transition: "opacity 150ms ease",
                    }}
                  >
                    {isImproving ? "…" : "Verbessern"}
                  </button>
                </div>
                <textarea
                  ref={promptTextareaRef}
                  rows={5}
                  placeholder="Beschreibe, was du hören möchtest …"
                  value={rawPrompt}
                  onChange={(e) => setRawPrompt(e.target.value)}
                  style={svInputStyle(themeKey, true)}
                />

                {/* Suggestion pills — only shown when prompt is empty */}
                {!rawPrompt.trim() && (
                  <div style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      onClick={() => setSuggestionsOpen((o) => !o)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        background: "transparent",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        color: themeCfg.uiSoftText,
                        fontSize: "0.78rem",
                        fontWeight: 600,
                        letterSpacing: "0.02em",
                        marginBottom: suggestionsOpen ? 10 : 0,
                      }}
                    >
                      Ideen gefällig?
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="none"
                        style={{
                          transition: "transform 250ms ease",
                          transform: suggestionsOpen ? "rotate(180deg)" : "rotate(0deg)",
                        }}
                      >
                        <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    {suggestionsOpen && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {SUGGESTIONS.map((s) => (
                          <button
                            key={s.label}
                            type="button"
                            onClick={() => {
                              setRawPrompt(s.prompt);
                              setPreset(s.preset);
                              setImprovedPrompt(null);
                              promptTextareaRef.current?.focus();
                            }}
                            style={{
                              padding: "0.35rem 0.85rem",
                              borderRadius: 999,
                              border: `1px solid ${themeCfg.secondaryButtonBorder}`,
                              background: themeCfg.secondaryButtonBg,
                              color: themeCfg.secondaryButtonText,
                              fontSize: "0.82rem",
                              fontWeight: 650,
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                            }}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {improvedPrompt !== null && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: "14px 16px",
                      borderRadius: 14,
                      ...glassPanel,
                    }}
                  >
                    <label className="sv-label" style={{ display: "block", marginBottom: 8 }}>
                      Verbesserter Prompt{" "}
                      <span style={{ fontWeight: 400, color: themeCfg.uiSoftText }}>(bearbeitbar)</span>
                    </label>
                    <textarea
                      rows={3}
                      value={improvedPrompt}
                      onChange={(e) => setImprovedPrompt(e.target.value)}
                      style={svInputStyle(themeKey, true)}
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <button
                        type="button"
                        onClick={() => {
                          setRawPrompt(improvedPrompt);
                          setImprovedPrompt(null);
                        }}
                        style={{
                          padding: "0.42rem 0.95rem",
                          borderRadius: 999,
                          border: "none",
                          background: themeCfg.primaryButtonBg,
                          color: themeCfg.primaryButtonText,
                          fontSize: "0.85rem",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        Übernehmen
                      </button>
                      <button
                        type="button"
                        onClick={() => setImprovedPrompt(null)}
                        style={{
                          padding: "0.42rem 0.95rem",
                          borderRadius: 999,
                          border: `1px solid ${themeCfg.secondaryButtonBorder}`,
                          background: themeCfg.secondaryButtonBg,
                          color: themeCfg.secondaryButtonText,
                          fontSize: "0.85rem",
                          fontWeight: 650,
                          cursor: "pointer",
                        }}
                      >
                        Verwerfen
                      </button>
                    </div>
                  </div>
                )}
              </div>}

              {/* Duration — hidden in script mode */}
              {!scriptEditMode && <div>
                <label className="sv-label" style={{ display: "block", marginBottom: 8 }}>Wie lang?</label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  className="sv-no-spinner"
                  style={{ ...svInputStyle(themeKey), maxWidth: 140 }}
                  value={durationMin}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "") {
                      setDurationMin("");
                    } else {
                      setDurationMin(Number(v));
                    }
                  }}
                  placeholder="z. B. 10 Min."
                />
                <p style={{ fontSize: "0.78rem", color: themeCfg.uiSoftText, marginTop: 6 }}>
                  Typischer Bereich: 1–30 Minuten
                </p>
              </div>}

              {/* Credits warning — only when depleted */}
              {accountSummary && !accountSummary.isAdmin && accountSummary.credits <= 0 && (
                <p style={{ fontSize: "0.85rem", color: themeCfg.uiSoftText, margin: 0 }}>
                  Keine Credits verfügbar.{" "}
                  <Link
                    href="/billing"
                    style={{ color: themeCfg.uiText, textDecoration: "underline", fontWeight: 600 }}
                  >
                    Credits aufladen
                  </Link>
                </p>
              )}

              {/* Actions */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 4 }}>
                <button
                  type="button"
                  onClick={createJob}
                  disabled={isSubmitDisabled}
                  title={
                    typeof retryLeft === "number" && retryLeft > 0
                      ? `Warte ${retryLeft}s…`
                      : undefined
                  }
                  style={{
                    width: "100%",
                    padding: "0.75rem 1.5rem",
                    fontSize: "1rem",
                    fontWeight: 700,
                    background: themeCfg.primaryButtonBg,
                    color: themeCfg.primaryButtonText,
                    border: "none",
                    borderRadius: 999,
                    cursor: isSubmitDisabled ? "not-allowed" : "pointer",
                    opacity: isSubmitDisabled ? 0.55 : 1,
                    transition: "opacity 150ms ease",
                    boxShadow: "0 14px 35px rgba(0,0,0,0.35)",
                  }}
                >
                  {typeof retryLeft === "number" && retryLeft > 0
                    ? `Warte ${retryLeft}s…`
                    : scriptEditMode ? "Mit Script generieren" : "Generieren"}
                </button>

                {isAdmin && (
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
                    style={{ width: "100%" }}
                  >
                    Simulation abschließen
                  </button>
                )}
              </div>

            </div>
          </div>

          {/* ===== Current Job ===== */}
          {job && (
            <section style={{ marginTop: 56 }}>
              <h2
                style={{
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  margin: "0 0 12px",
                  color: themeCfg.uiSoftText,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                }}
              >
                Aktuelle Generierung
              </h2>
              <StatusCard
                job={job}
                isAdmin={!!accountSummary?.isAdmin}
                themeCfg={themeCfg}
                title={(() => {
                  const uiTitle = title.trim();
                  if (uiTitle) return uiTitle;
                  const anyJob = job as unknown as { title?: string | null };
                  const jobTitle = anyJob.title?.trim();
                  if (jobTitle) return jobTitle;
                  return displayJobTitle(job);
                })()}
                onPlay={
                  job.status === "DONE" &&
                  (job.resultUrl || (!!job.storyId && (job.chapterCount ?? 0) > 1))
                    ? () => {
                        const playerTitle =
                          title.trim().length > 0 ? title.trim() : displayJobTitle(job);
                        if (job.storyId && (job.chapterCount ?? 0) > 1) {
                          void fetchStoryChapters(job.storyId).then((chapters) => {
                            if (chapters.length > 0) {
                              loadStory(job.storyId!, chapters, undefined, playerTitle);
                            } else {
                              showToast("Kapitel konnten nicht geladen werden.", "err");
                            }
                          });
                        } else if (job.resultUrl) {
                          loadTrack(job.resultUrl, playerTitle, job.id);
                        }
                      }
                    : undefined
                }
              />
            </section>
          )}

          {/* ===== Recent Jobs ===== */}
          <section style={{ marginTop: 56 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                marginBottom: 16,
              }}
            >
              <h2
                style={{
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  margin: 0,
                  color: themeCfg.uiSoftText,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                }}
              >
                Deine letzten Jobs
              </h2>

              {/* Right side: view toggle + library link */}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {/* List / Grid toggle */}
                <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: `1px solid ${themeCfg.cardBorder}` }}>
                  {(["list", "grid"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setViewMode(mode)}
                      title={mode === "list" ? "Listenansicht" : "Kachelansicht"}
                      style={{
                        width: 32, height: 28,
                        border: "none",
                        background: viewMode === mode ? themeCfg.secondaryButtonBg : "transparent",
                        color: viewMode === mode ? themeCfg.uiText : themeCfg.uiSoftText,
                        cursor: "pointer",
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        transition: "background 120ms ease",
                      }}
                    >
                      {mode === "list" ? (
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                          <rect x="0" y="2" width="16" height="2.5" rx="1.25" />
                          <rect x="0" y="6.75" width="16" height="2.5" rx="1.25" />
                          <rect x="0" y="11.5" width="16" height="2.5" rx="1.25" />
                        </svg>
                      ) : (
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                          <rect x="0" y="0" width="6.5" height="6.5" rx="1.5" />
                          <rect x="9.5" y="0" width="6.5" height="6.5" rx="1.5" />
                          <rect x="0" y="9.5" width="6.5" height="6.5" rx="1.5" />
                          <rect x="9.5" y="9.5" width="6.5" height="6.5" rx="1.5" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>

                <Link
                  href="/library"
                  style={{
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    textDecoration: "none",
                    padding: "0.4rem 0.85rem",
                    borderRadius: 999,
                    border: `1px solid ${themeCfg.cardBorder}`,
                    background: themeCfg.cardBg,
                    color: themeCfg.uiText,
                    backdropFilter: "blur(10px)",
                    WebkitBackdropFilter: "blur(10px)",
                  }}
                >
                  Bibliothek →
                </Link>
              </div>
            </div>

            {!Array.isArray(jobList) || jobList.length === 0 ? (
              <p style={{ color: themeCfg.uiSoftText, fontSize: "0.9rem" }}>
                {loadingList ? "Lade…" : "Noch keine Jobs gefunden."}
              </p>
            ) : viewMode === "list" ? (
              /* ── List view ── */
              <ul style={{ display: "flex", flexDirection: "column", gap: 8, listStyle: "none", margin: 0, padding: 0 }}>
                {jobList.map((j) => {
                  const isStory = typeof j.chapterCount === "number" && j.chapterCount > 1 && !!j.storyId;
                  const meta = [
                    j.preset,
                    j.durationSec ? formatSec(j.durationSec) : null,
                    typeof j.chapterCount === "number" && j.chapterCount > 1 ? `${j.chapterCount} Kap.` : null,
                    isAdmin && j.language ? j.language.toUpperCase() : null,
                    isAdmin && j.createdAt ? new Date(j.createdAt).toLocaleString("de-DE") : null,
                  ].filter(Boolean).join(" · ");

                  return (
                    <li key={j.id} style={{ listStyle: "none", position: "relative", zIndex: openJobMenu === j.id ? 100 : undefined }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderRadius: 14, ...glassPanel }}>
                        {/* Play button — left, 44px fixed slot */}
                        <div style={{ flexShrink: 0, width: 44, height: 44, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                          {j.status === "DONE" && (
                            isStory ? (
                              <a href={`/s/${j.storyId}`} title="Story öffnen"
                                style={{ width: 44, height: 44, borderRadius: "50%", background: themeCfg.primaryButtonBg, color: themeCfg.primaryButtonText, display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none", boxShadow: "0 8px 20px rgba(0,0,0,0.25)" }}>
                                <svg width="16" height="16" viewBox="0 0 11 11" fill="currentColor"><path d="M2.5 1.8l7 3.7-7 3.7z" /></svg>
                              </a>
                            ) : j.resultUrl ? (
                              <button type="button" onClick={() => loadTrack(j.resultUrl!, displayJobTitle(j), j.id)} title="Abspielen"
                                style={{ width: 44, height: 44, borderRadius: "50%", background: themeCfg.primaryButtonBg, color: themeCfg.primaryButtonText, border: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 8px 20px rgba(0,0,0,0.25)" }}>
                                <svg width="16" height="16" viewBox="0 0 11 11" fill="currentColor"><path d="M2.5 1.8l7 3.7-7 3.7z" /></svg>
                              </button>
                            ) : null
                          )}
                        </div>
                        {/* Title + meta/badge — center */}
                        <div style={{ flex: "1 1 0", minWidth: 0, overflow: "hidden" }}>
                          <div style={{ fontWeight: 600, fontSize: "0.88rem", color: themeCfg.uiText, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {displayJobTitle(j)}
                          </div>
                          {j.status !== "DONE" ? (
                            <div style={{ marginTop: 4 }}>
                              <StatusPill status={j.status} themeCfg={themeCfg} />
                            </div>
                          ) : meta ? (
                            <div style={{ fontSize: "0.72rem", color: themeCfg.uiSoftText, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {meta}
                            </div>
                          ) : null}
                        </div>
                        {/* Three-dot menu — right */}
                        <div style={{ position: "relative", flexShrink: 0 }}>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setOpenJobMenu(openJobMenu === j.id ? null : j.id); }}
                            title="Optionen"
                            style={{ width: 32, height: 32, borderRadius: "50%", border: `1px solid ${themeCfg.cardBorder}`, background: "transparent", color: themeCfg.uiSoftText, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: "1.1rem", letterSpacing: "0.05em" }}
                          >
                            ⋯
                          </button>
                          {openJobMenu === j.id && (
                            <>
                              <div
                                onClick={() => setOpenJobMenu(null)}
                                style={{ position: "fixed", inset: 0, zIndex: 40 }}
                              />
                              <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 300, minWidth: 140, borderRadius: 12, ...glassPanel, padding: "6px 0", overflow: "hidden" }}>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); void deleteJob(j.id); setOpenJobMenu(null); }}
                                  style={{ width: "100%", padding: "9px 16px", background: "transparent", border: "none", color: "#e11d48", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", textAlign: "left" as const }}
                                >
                                  Löschen
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              /* ── Grid view ── */
              <ul style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, listStyle: "none", margin: 0, padding: 0 }}>
                {jobList.map((j) => {
                  const isStory = typeof j.chapterCount === "number" && j.chapterCount > 1 && !!j.storyId;
                  const meta = [
                    j.preset,
                    j.durationSec ? formatSec(j.durationSec) : null,
                    typeof j.chapterCount === "number" && j.chapterCount > 1 ? `${j.chapterCount} Kap.` : null,
                  ].filter(Boolean).join(" · ");

                  return (
                    <li key={j.id} style={{ listStyle: "none", position: "relative", zIndex: openJobMenu === j.id ? 100 : undefined }}>
                      <div style={{ padding: "14px 14px 12px", borderRadius: 14, ...glassPanel, display: "flex", flexDirection: "column", gap: 10, minHeight: 110 }}>
                        {/* Title */}
                        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: "0.84rem", color: themeCfg.uiText, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>
                            {displayJobTitle(j)}
                          </div>
                          {meta && (
                            <div style={{ fontSize: "0.7rem", color: themeCfg.uiSoftText, marginTop: 4 }}>
                              {meta}
                            </div>
                          )}
                        </div>
                        {/* Actions row */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          {j.status === "DONE" ? (
                            isStory ? (
                              <a href={`/s/${j.storyId}`} title="Story öffnen"
                                style={{ width: 40, height: 40, borderRadius: "50%", background: themeCfg.primaryButtonBg, color: themeCfg.primaryButtonText, display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none", boxShadow: "0 6px 16px rgba(0,0,0,0.2)" }}>
                                <svg width="14" height="14" viewBox="0 0 11 11" fill="currentColor"><path d="M2.5 1.8l7 3.7-7 3.7z" /></svg>
                              </a>
                            ) : j.resultUrl ? (
                              <button type="button" onClick={() => loadTrack(j.resultUrl!, displayJobTitle(j), j.id)} title="Abspielen"
                                style={{ width: 40, height: 40, borderRadius: "50%", background: themeCfg.primaryButtonBg, color: themeCfg.primaryButtonText, border: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 6px 16px rgba(0,0,0,0.2)" }}>
                                <svg width="14" height="14" viewBox="0 0 11 11" fill="currentColor"><path d="M2.5 1.8l7 3.7-7 3.7z" /></svg>
                              </button>
                            ) : <div style={{ width: 40 }} />
                          ) : (
                            <StatusPill status={j.status} themeCfg={themeCfg} />
                          )}
                          {/* Three-dot menu */}
                          <div style={{ position: "relative", flexShrink: 0 }}>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setOpenJobMenu(openJobMenu === j.id ? null : j.id); }}
                              title="Optionen"
                              style={{ width: 32, height: 32, borderRadius: "50%", border: `1px solid ${themeCfg.cardBorder}`, background: "transparent", color: themeCfg.uiSoftText, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: "1.1rem" }}
                            >
                              ⋯
                            </button>
                            {openJobMenu === j.id && (
                              <>
                                <div
                                  onClick={() => setOpenJobMenu(null)}
                                  style={{ position: "fixed", inset: 0, zIndex: 40 }}
                                />
                                <div style={{ position: "absolute", right: 0, bottom: "calc(100% + 6px)", zIndex: 300, minWidth: 140, borderRadius: 12, ...glassPanel, padding: "6px 0", overflow: "hidden" }}>
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); void deleteJob(j.id); setOpenJobMenu(null); }}
                                    style={{ width: "100%", padding: "9px 16px", background: "transparent", border: "none", color: "#e11d48", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", textAlign: "left" as const }}
                                  >
                                    Löschen
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {Array.isArray(jobList) && hasMore && (
              <div style={{ marginTop: 14 }}>
                <button
                  type="button"
                  onClick={() => void loadJobs(jobList.length)}
                  disabled={loadingList}
                  style={{ ...pillStyle(themeCfg, "secondary") }}
                >
                  {loadingList ? "Lade…" : "Mehr laden"}
                </button>
              </div>
            )}
          </section>
        </div>
        </div>

        {/* ===== Toast ===== */}
        {toast && (
          <div
            role="status"
            aria-live="polite"
            style={{
              position: "fixed",
              right: 20,
              bottom: 96,
              background:
                toast.kind === "err" ? "rgba(239,68,68,0.18)"
                : toast.kind === "ok" ? "rgba(22,163,74,0.18)"
                : glassPanel.background,
              color: themeCfg.uiText,
              border: `1px solid ${
                toast.kind === "err" ? "rgba(239,68,68,0.45)"
                : toast.kind === "ok" ? "rgba(22,163,74,0.45)"
                : glassPanel.border
              }`,
              borderRadius: 14,
              boxShadow: glassPanel.boxShadow,
              backdropFilter: "blur(18px)",
              WebkitBackdropFilter: "blur(18px)",
              padding: "12px 16px",
              fontWeight: 600,
              fontSize: "0.9rem",
              zIndex: 1000,
              maxWidth: 360,
            }}
          >
            {toast.msg}
          </div>
        )}
      </main>
    </SVScene>
  );
}

function StatusCard({
  job,
  isAdmin,
  title,
  themeCfg,
  onPlay,
}: {
  job: Job;
  isAdmin: boolean;
  title: string;
  themeCfg: ThemeConfig;
  onPlay?: () => void;
}) {
  const headerTitle = isAdmin ? `Job: ${job.id}` : title;
  return (
    <SVCard themeCfg={themeCfg}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <p style={{ fontWeight: 700, fontSize: "1rem", margin: "0 0 4px", color: themeCfg.uiText }}>
            {headerTitle}
          </p>
          <div style={{ fontSize: "0.8rem", color: themeCfg.uiSoftText }}>
            {job.preset && <span>{job.preset}</span>}
            {job.durationSec ? <span> · {formatSec(job.durationSec)}</span> : null}
          </div>
        </div>
        {job.status === "DONE" && job.resultUrl && onPlay ? (
          <button
            type="button"
            onClick={onPlay}
            aria-label="Abspielen"
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: themeCfg.primaryButtonBg,
              color: themeCfg.primaryButtonText,
              border: "none",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flexShrink: 0,
              boxShadow: "0 8px 20px rgba(0,0,0,0.25)",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 11 11" fill="currentColor">
              <path d="M2.5 1.8l7 3.7-7 3.7z" />
            </svg>
          </button>
        ) : (
          <StatusPill status={job.status} themeCfg={themeCfg} />
        )}
      </div>

      {(job.status === "QUEUED" || job.status === "PROCESSING") && (
        <p style={{ fontSize: "0.85rem", color: themeCfg.uiSoftText, margin: "14px 0 0" }}>
          Generierung läuft…
        </p>
      )}

      {job.status === "FAILED" && (
        <p
          style={{
            color: "#e11d48",
            fontWeight: 600,
            margin: "14px 0 0",
            fontSize: "0.9rem",
          }}
        >
          {job.error ?? "Fehlgeschlagen"}
        </p>
      )}
    </SVCard>
  );
}

function StatusPill({ status, themeCfg }: { status: JobStatus; themeCfg: ThemeConfig }) {
  if (status === "DONE") return null;

  const label =
    status === "QUEUED"
      ? "Warteschlange"
      : status === "PROCESSING"
      ? "In Bearbeitung"
      : "Fehlgeschlagen";

  const bg = status === "FAILED" ? "rgba(254,202,202,0.9)" : themeCfg.cardBg;
  const color = status === "FAILED" ? "#7f1d1d" : themeCfg.uiSoftText;

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
        whiteSpace: "nowrap",
        border: `1px solid ${themeCfg.cardBorder}`,
      }}
    >
      {label}
    </span>
  );
}

// pillStyle — matches Home page exactly
function pillStyle(cfg: ThemeConfig, variant: "primary" | "secondary"): React.CSSProperties {
  if (variant === "primary") {
    return {
      textDecoration: "none",
      padding: "0.55rem 1.15rem",
      borderRadius: 999,
      background: cfg.primaryButtonBg,
      color: cfg.primaryButtonText,
      fontSize: "0.88rem",
      fontWeight: 700,
      boxShadow: "0 14px 35px rgba(0,0,0,0.35)",
      border: "none",
      cursor: "pointer",
      whiteSpace: "nowrap" as const,
    };
  }
  return {
    textDecoration: "none",
    padding: "0.55rem 1.05rem",
    borderRadius: 999,
    border: `1px solid ${cfg.secondaryButtonBorder}`,
    background: cfg.secondaryButtonBg,
    color: cfg.secondaryButtonText,
    fontSize: "0.85rem",
    fontWeight: 650,
    boxShadow: "0 10px 25px rgba(0,0,0,0.25)",
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  };
}

// svInputStyle — matches Home page inputStyle()
function svInputStyle(theme: string, isTextarea = false): React.CSSProperties {
  return {
    width: "100%",
    padding: isTextarea ? "0.85rem 0.95rem" : "0.8rem 0.95rem",
    borderRadius: 14,
    border: theme === "dark" ? "1px solid rgba(148,163,184,0.22)" : "1px solid rgba(148,163,184,0.3)",
    background: theme === "dark" ? "rgba(15,23,42,0.22)" : "rgba(255,255,255,0.22)",
    color: theme === "dark" ? "#e5e7eb" : "#0f172a",
    outline: "none",
    fontSize: "0.95rem",
    lineHeight: 1.5,
    boxSizing: "border-box" as const,
    resize: isTextarea ? ("vertical" as const) : undefined,
  };
}
