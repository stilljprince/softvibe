"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type React from "react";
import { useRouter } from "next/navigation";
import { usePlayer, type Chapter } from "@/app/components/player-context";
import { useSVTheme } from "@/app/components/sv-kit";
import SVScene from "@/app/components/sv-scene";

// ─── Types ────────────────────────────────────────────────────────────────────

type Track = {
  id: string;
  title?: string | null;
  prompt?: string | null;
  jobTitle?: string | null;
  url: string;
  createdAt?: string;
  durationSeconds?: number | null;
  isPublic?: boolean | null;
  shareSlug?: string | null;
  storyId?: string | null;
  storyTitle?: string | null;
  partIndex?: number | null;
  partTitle?: string | null;
  preset?: string | null;
  scriptText?: string | null;
};

type SortKey = "newest" | "oldest" | "short" | "long";
type ViewMode = "list" | "grid";

// ─── API response type guards ─────────────────────────────────────────────────

type ItemsResp = { items: Track[]; nextCursor?: string | null };
type OkDataResp = { ok: true; data: { items: Track[]; nextCursor?: string | null } };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function isTrack(v: unknown): v is Track {
  return (
    isRecord(v) &&
    typeof (v as { id?: unknown }).id === "string" &&
    typeof (v as { url?: unknown }).url === "string"
  );
}
function isTrackArray(v: unknown): v is Track[] {
  return Array.isArray(v) && v.every(isTrack);
}
function isItemsResp(v: unknown): v is ItemsResp {
  return isRecord(v) && "items" in v && isTrackArray((v as ItemsResp).items);
}
function isOkDataResp(v: unknown): v is OkDataResp {
  return (
    isRecord(v) &&
    (v as { ok?: unknown }).ok === true &&
    isRecord((v as { data?: unknown }).data) &&
    isTrackArray((v as OkDataResp).data.items)
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getEffectiveTitle(t: Track): string {
  const trackTitle = (t.title ?? "").trim();
  const jobTitle = (t.jobTitle ?? "").trim();
  const promptText = (t.prompt ?? "").trim();
  if (trackTitle && trackTitle !== jobTitle) return trackTitle;
  if (jobTitle) return jobTitle;
  if (trackTitle) return trackTitle;
  if (promptText)
    return promptText.length > 80 ? promptText.slice(0, 77) + "…" : promptText;
  return "(ohne Titel)";
}

function getStoryTitle(t: Track): string {
  if (t.storyTitle?.trim()) return t.storyTitle.trim();
  return getEffectiveTitle(t);
}

function formatDuration(sec: number | null | undefined): string {
  if (!sec || !Number.isFinite(sec) || sec <= 0) return "";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function safeDate(ts?: string): number {
  if (!ts) return 0;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : 0;
}

function getDurSeconds(t: { durationSeconds?: number | string | null }): number {
  const v = t.durationSeconds as unknown;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v === "string") {
    const n = Number((v as string).trim());
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

function getOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin)
    return window.location.origin;
  return process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
}

function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "SoftVibe"
  );
}

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.setAttribute("download", filename);
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Map a preset slug to its display label and whether it is a story-type preset.
const PRESET_META: Record<string, { label: string; isStoryType: boolean }> = {
  "sleep-story":   { label: "Sleep Story",   isStoryType: true  },
  "kids-story":    { label: "Kids Story",     isStoryType: true  },
  "classic-asmr":  { label: "Classic ASMR",  isStoryType: false },
  "meditation":    { label: "Meditation",     isStoryType: false },
};

function resolvePreset(t: Track): { label: string; isStoryType: boolean } {
  const slug = t.preset ?? "";
  return PRESET_META[slug] ?? { label: slug || "—", isStoryType: !!t.storyId };
}

function deriveChapters(storyId: string, allTracks: Track[]): Chapter[] {
  return allTracks
    .filter((t) => t.storyId === storyId && t.url)
    .sort((a, b) => (a.partIndex ?? 0) - (b.partIndex ?? 0))
    .map((t) => ({
      id: t.id,
      url: t.url,
      title: `Kapitel ${(t.partIndex ?? 0) + 1}`,
      partIndex: t.partIndex ?? 0,
      durationSeconds:
        typeof t.durationSeconds === "number" ? t.durationSeconds : undefined,
    }));
}

async function fetchStoryChapters(storyId: string): Promise<Chapter[]> {
  try {
    const res = await fetch(
      `/api/tracks?storyId=${encodeURIComponent(storyId)}&take=200`,
      { credentials: "include" }
    );
    if (!res.ok) return [];
    const raw: unknown = await res.json().catch(() => null);
    const payload =
      raw && typeof raw === "object" && "data" in (raw as object)
        ? (raw as { data: unknown }).data
        : raw;
    const list: unknown[] = Array.isArray(
      (payload as { items?: unknown })?.items
    )
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
          title: `Kapitel ${partIndex + 1}`,
          partIndex,
          durationSeconds:
            typeof it.durationSeconds === "number"
              ? it.durationSeconds
              : undefined,
        };
      })
      .filter((ch) => ch.id && ch.url)
      .sort((a, b) => a.partIndex - b.partIndex);
  } catch {
    return [];
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LibraryClient() {
  const { state, loadTrack, loadStory, play, pause } = usePlayer();
  const { themeKey, themeCfg, cycleTheme, logoSrc } = useSVTheme();
  const isDark = themeKey === "dark";
  const router = useRouter();

  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [detailTrack, setDetailTrack] = useState<Track | null>(null);

  const [toast, setToast] = useState<{ msg: string; kind?: "ok" | "err" } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const headerCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const downloadingRef = useRef<Set<string>>(new Set());

  // Inline credits for header menu — avoids HeaderCredits CSS-var dependency
  const [creditsCount, setCreditsCount] = useState<number | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    void fetch("/api/account/summary", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((json) => {
        const d = json?.ok === true && json.data ? json.data : json;
        if (d && typeof d === "object" && "credits" in d) {
          setCreditsCount(d.credits as number);
          setIsAdmin(!!(d as { isAdmin?: boolean }).isAdmin);
        }
      })
      .catch(() => null);
  }, []);

  function showToast(msg: string, kind: "ok" | "err" = "ok") {
    setToast({ msg, kind });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2500);
  }

  useEffect(() => { void loadFirstPage(); }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.("[data-menu-root]")) setOpenMenuId(null);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const TAKE = 20;

  async function loadFirstPage() {
    setLoading(true);
    try {
      const res = await fetch(`/api/tracks?take=${TAKE}`);
      if (!res.ok) throw new Error(String(res.status));
      const data: unknown = await res.json();
      let list: Track[] = [];
      let cursor: string | null | undefined = null;
      if (isTrackArray(data)) { list = data; }
      else if (isItemsResp(data)) { list = data.items; cursor = data.nextCursor; }
      else if (isOkDataResp(data)) { list = data.data.items; cursor = data.data.nextCursor; }
      setTracks(list);
      setNextCursor(cursor ?? null);
    } catch {
      setTracks([]);
      setNextCursor(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/tracks?take=${TAKE}&cursor=${encodeURIComponent(nextCursor)}`
      );
      if (!res.ok) throw new Error(String(res.status));
      const data: unknown = await res.json();
      let list: Track[] = [];
      let cursor: string | null | undefined = null;
      if (isTrackArray(data)) { list = data; }
      else if (isItemsResp(data)) { list = data.items; cursor = data.nextCursor; }
      else if (isOkDataResp(data)) { list = data.data.items; cursor = data.data.nextCursor; }
      setTracks((prev) => {
        const seen = new Set(prev.map((t) => t.id));
        return [...prev, ...list.filter((t) => !seen.has(t.id))];
      });
      setNextCursor(cursor ?? null);
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
    }
  }

  // ── Derived state ──────────────────────────────────────────────────────────

  const filtered = useMemo<Track[]>(() => {
    const base = Array.isArray(tracks) ? tracks : [];
    const needle = q.trim().toLowerCase();
    const afterFilter = !needle
      ? base
      : base.filter(
          (t) =>
            (t.title ?? "").toLowerCase().includes(needle) ||
            (t.prompt ?? "").toLowerCase().includes(needle)
        );
    const arr = [...afterFilter];
    switch (sortKey) {
      case "newest": arr.sort((a, b) => safeDate(b.createdAt) - safeDate(a.createdAt)); break;
      case "oldest": arr.sort((a, b) => safeDate(a.createdAt) - safeDate(b.createdAt)); break;
      case "short":
        arr.sort((a, b) => {
          const da = getDurSeconds(a), db = getDurSeconds(b);
          const aH = Number.isFinite(da), bH = Number.isFinite(db);
          if (aH && bH) return da - db;
          return aH ? -1 : bH ? 1 : safeDate(b.createdAt) - safeDate(a.createdAt);
        });
        break;
      case "long":
        arr.sort((a, b) => {
          const da = getDurSeconds(a), db = getDurSeconds(b);
          const aH = Number.isFinite(da), bH = Number.isFinite(db);
          if (aH && bH) return db - da;
          return aH ? -1 : bH ? 1 : safeDate(b.createdAt) - safeDate(a.createdAt);
        });
        break;
    }
    return arr;
  }, [q, tracks, sortKey]);

  const listItems = useMemo<Track[]>(
    () => filtered.filter((t) => !(t.storyId && typeof t.partIndex === "number" && t.partIndex !== 0)),
    [filtered]
  );

  const storyChapterCounts = useMemo<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    for (const t of tracks) {
      if (t.storyId) counts[t.storyId] = (counts[t.storyId] ?? 0) + 1;
    }
    return counts;
  }, [tracks]);

  // ── Playback ───────────────────────────────────────────────────────────────

  function isTrackActive(t: Track): boolean {
    if (t.storyId) return state.storyId === t.storyId;
    return state.trackId === t.id;
  }
  function isTrackPlaying(t: Track): boolean {
    return isTrackActive(t) && state.isPlaying;
  }

  async function handlePlay(t: Track) {
    if (isTrackActive(t)) {
      state.isPlaying ? pause() : play();
      return;
    }
    if (t.storyId) {
      let chapters = deriveChapters(t.storyId, tracks);
      if (chapters.length <= 1) chapters = await fetchStoryChapters(t.storyId);
      if (chapters.length > 0) loadStory(t.storyId, chapters);
      else showToast("Kapitel konnten nicht geladen werden.", "err");
    } else {
      loadTrack(t.url, getEffectiveTitle(t), t.id);
    }
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  function beginEdit(t: Track) {
    setEditingId(t.id);
    setEditingValue((t.title ?? t.prompt ?? "").trim());
    setOpenMenuId(null);
  }
  function cancelEdit() { setEditingId(null); setEditingValue(""); }

  async function saveEdit(id: string) {
    const title = editingValue.trim();
    if (!title) { cancelEdit(); return; }
    const res = await fetch(`/api/tracks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) { showToast("Konnte Titel nicht speichern.", "err"); return; }
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
    showToast("Titel gespeichert.", "ok");
    cancelEdit();
  }

  async function handleDownload(t: Track) {
    const guard = t.storyId ?? t.id;
    if (downloadingRef.current.has(guard)) return;
    downloadingRef.current.add(guard);
    try {
      if (!t.storyId) {
        // Single track — silent download, no toast
        triggerDownload(t.url, sanitizeFilename(getEffectiveTitle(t)) + ".mp3");
        return;
      }

      // Multi-chapter story
      let chapters = deriveChapters(t.storyId, tracks);
      if (chapters.length <= 1) chapters = await fetchStoryChapters(t.storyId);

      if (chapters.length === 0) {
        showToast("Download fehlgeschlagen.", "err");
        return;
      }

      // Single-chapter story → no suffix, no toast
      if (chapters.length === 1) {
        triggerDownload(chapters[0].url, sanitizeFilename(getStoryTitle(t)) + ".mp3");
        return;
      }

      const base = sanitizeFilename(getStoryTitle(t));
      const padWidth = String(chapters.length).length;
      showToast(`${chapters.length} Kapitel werden heruntergeladen…`);

      let skipped = 0;
      for (let i = 0; i < chapters.length; i++) {
        const ch = chapters[i];
        if (!ch.url) { skipped++; continue; }
        const num = String(ch.partIndex + 1).padStart(padWidth, "0");
        triggerDownload(ch.url, `${base} - Kapitel ${num}.mp3`);
        if (i < chapters.length - 1) await delay(180);
      }
      if (skipped > 0) {
        showToast(`${skipped} Kapitel konnten nicht heruntergeladen werden.`, "err");
      }
    } finally {
      downloadingRef.current.delete(guard);
    }
  }

  async function copyLink(t: Track) {
    if (!t.isPublic || !t.shareSlug) {
      showToast('Aktiviere zuerst \u201eÖffentlich teilen\u201c.', "err");
      return;
    }
    const publicUrl = `${getOrigin()}/p/${t.shareSlug}`;
    try {
      if (navigator.clipboard?.writeText)
        await navigator.clipboard.writeText(publicUrl);
      else {
        const tmp = document.createElement("textarea");
        tmp.value = publicUrl;
        document.body.appendChild(tmp);
        tmp.select();
        document.execCommand("copy");
        tmp.remove();
      }
      showToast("Öffentlicher Link kopiert.", "ok");
    } catch {
      showToast("Kopieren fehlgeschlagen.", "err");
    }
  }

  async function toggleShare(t: Track) {
    const want = !t.isPublic;
    const res = await fetch(`/api/tracks/${encodeURIComponent(t.id)}/share`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPublic: want }),
    });
    if (!res.ok) { showToast("Konnte Freigabe nicht ändern.", "err"); return; }
    const raw: unknown = await res.json();
    let isPublic: boolean | undefined;
    let shareSlug: string | null | undefined;
    if (raw && typeof raw === "object") {
      const r = raw as Record<string, unknown>;
      const inner = r.data && typeof r.data === "object"
        ? (r.data as Record<string, unknown>) : r;
      if (typeof inner.isPublic === "boolean") isPublic = inner.isPublic;
      shareSlug = inner.shareSlug as string | null | undefined;
    }
    if (typeof isPublic !== "boolean") {
      showToast("Antwort vom Server war unerwartet.", "err");
      return;
    }
    setTracks((prev) =>
      prev.map((x) => x.id === t.id ? { ...x, isPublic, shareSlug: shareSlug ?? null } : x)
    );
    if (detailTrack?.id === t.id) {
      setDetailTrack((prev) =>
        prev ? { ...prev, isPublic, shareSlug: shareSlug ?? null } : prev
      );
    }
    showToast(want ? "Öffentlich freigegeben." : "Freigabe entfernt.", "ok");
  }

  async function deleteTrack(t: Track) {
    const res = await fetch(`/api/tracks/${encodeURIComponent(t.id)}`, { method: "DELETE" });
    if (!res.ok) { showToast("Löschen fehlgeschlagen.", "err"); return; }
    setTracks((prev) => prev.filter((x) => x.id !== t.id));
    showToast("Gelöscht.", "ok");
  }

  // ── Style constants ────────────────────────────────────────────────────────

  const inputStyle: React.CSSProperties = {
    padding: "10px 14px",
    borderRadius: 999,
    border: `1px solid ${themeCfg.secondaryButtonBorder}`,
    background: isDark ? "rgba(15,23,42,0.6)" : "rgba(255,255,255,0.75)",
    color: themeCfg.uiText,
    fontSize: "0.875rem",
    outline: "none",
  };

  // Active state uses uiText (white in dark, dark in light) — calm, premium, not accent-blue
  const activeBorderColor = themeCfg.uiText;

  // Glass card surface — semi-transparent with blur so the animated SVScene background
  // shows through. Opacity tuned to read as a glass layer, not an opaque block.
  const glassCardBg =
    isDark
      ? "rgba(15,23,42,0.32)"
      : themeKey === "pastel"
      ? "rgba(253,244,255,0.30)"
      : "rgba(255,255,255,0.30)";
  const glassCardBorder =
    isDark ? "rgba(148,163,184,0.32)" : "rgba(148,163,184,0.48)";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SVScene theme={themeKey}>
    <main style={{ minHeight: "100vh", paddingTop: 86, paddingBottom: 120 }}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header
        style={{
          position: "fixed",
          top: 18,
          left: 18,
          right: 18,
          zIndex: 100,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          pointerEvents: "auto",
        }}
      >
        {/* Logo — click cycles theme */}
        <button
          type="button"
          onClick={cycleTheme}
          style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer" }}
          aria-label="Theme wechseln"
          title="Theme wechseln"
        >
          <Image src={logoSrc} alt="SoftVibe" width={160} height={50} priority />
        </button>

        {/* Center — home link */}
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

        {/* Right — menu button with dropdown */}
        <div
          style={{ position: "relative" }}
          onMouseEnter={() => {
            if (headerCloseTimer.current) { clearTimeout(headerCloseTimer.current); headerCloseTimer.current = null; }
            setHeaderMenuOpen(true);
          }}
          onMouseLeave={() => {
            headerCloseTimer.current = setTimeout(() => setHeaderMenuOpen(false), 150);
          }}
        >
          <button
            type="button"
            onClick={() => setHeaderMenuOpen((v) => !v)}
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

          {headerMenuOpen && (
            <div
              style={{
                position: "absolute",
                right: 0,
                top: "calc(100% + 8px)",
                zIndex: 90,
                width: "min(280px, calc(100vw - 36px))",
                padding: 2,
                borderRadius: 26,
                background: isDark
                  ? "radial-gradient(circle at top, rgba(56,189,248,0.18), transparent 68%)"
                  : "radial-gradient(circle at top, rgba(244,114,182,0.22), transparent 70%)",
                boxShadow: "0 26px 80px rgba(0,0,0,0.6)",
              }}
            >
              <div
                style={{
                  background: isDark ? "rgba(15,23,42,0.96)" : "rgba(255,255,255,0.95)",
                  backdropFilter: "blur(24px)",
                  WebkitBackdropFilter: "blur(24px)",
                  border: `1px solid ${themeCfg.cardBorder}`,
                  borderRadius: 24,
                  padding: 16,
                }}
              >
                <div
                  style={{
                    fontSize: "0.72rem",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    fontWeight: 800,
                    color: themeCfg.uiSoftText,
                    marginBottom: 10,
                  }}
                >
                  {themeKey === "dark" ? "☾ Dark" : themeKey === "pastel" ? "✦ Pastel" : "◑ Light"}
                </div>
                {creditsCount !== null && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <span style={{ fontSize: "0.82rem", color: themeCfg.uiSoftText, fontWeight: 600 }}>
                      {isAdmin ? "∞ Credits" : `${creditsCount} Credits`}
                    </span>
                    {!isAdmin && (
                      <a
                        href="/pricing"
                        style={{
                          fontSize: "0.78rem",
                          fontWeight: 600,
                          color: themeCfg.uiText,
                          textDecoration: "none",
                          padding: "4px 12px",
                          borderRadius: 999,
                          border: `1px solid ${themeCfg.secondaryButtonBorder}`,
                          background: "transparent",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Aufladen
                      </a>
                    )}
                  </div>
                )}
                <form action="/api/auth/signout" method="post">
                  <button
                    type="submit"
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 14px",
                      borderRadius: 12,
                      border: `1px solid ${themeCfg.cardBorder}`,
                      background: "transparent",
                      color: themeCfg.uiText,
                      fontWeight: 600,
                      fontSize: "0.875rem",
                      cursor: "pointer",
                    }}
                  >
                    Logout
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <div style={{ width: "min(900px, 100vw - 40px)", margin: "0 auto", padding: "8px 0 40px" }}>

        {/* Page title + CTA */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <h1 style={{ fontSize: "1.45rem", fontWeight: 800, color: themeCfg.uiText, margin: 0 }}>
            Bibliothek
          </h1>
          <Link
            href="/generate"
            style={{
              marginLeft: "auto",
              fontWeight: 700,
              fontSize: "0.875rem",
              textDecoration: "none",
              padding: "8px 18px",
              borderRadius: 999,
              background: themeCfg.primaryButtonBg,
              color: themeCfg.primaryButtonText,
            }}
          >
            + Generieren
          </Link>
        </div>

        {/* Search + sort + view toggle */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Suchen…"
            style={{ ...inputStyle, flex: "1 1 auto" }}
          />

          {/* Sort — pill with custom chevron */}
          <div style={{ position: "relative", flexShrink: 0 }}>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              aria-label="Sortieren"
              style={{
                ...inputStyle,
                fontWeight: 600,
                cursor: "pointer",
                appearance: "none",
                WebkitAppearance: "none",
                paddingRight: 32,
              }}
            >
              <option value="newest">Neueste</option>
              <option value="oldest">Älteste</option>
              <option value="short">Kürzeste</option>
              <option value="long">Längste</option>
            </select>
            <svg
              width="10" height="10" viewBox="0 0 10 6"
              style={{
                position: "absolute",
                right: 12,
                top: "50%",
                transform: "translateY(-50%)",
                pointerEvents: "none",
                color: themeCfg.uiSoftText,
              }}
              fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
            >
              <path d="M1 1l4 4 4-4" />
            </svg>
          </div>

          {/* View toggle */}
          <div
            style={{
              display: "flex",
              border: `1px solid ${themeCfg.secondaryButtonBorder}`,
              borderRadius: 999,
              overflow: "hidden",
              flexShrink: 0,
            }}
          >
            {(["list", "grid"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                aria-label={mode === "list" ? "Listenansicht" : "Rasteransicht"}
                style={{
                  width: 36, height: 36,
                  border: "none",
                  background: viewMode === mode
                    ? themeCfg.primaryButtonBg
                    : "transparent",
                  color: viewMode === mode
                    ? themeCfg.primaryButtonText
                    : themeCfg.uiSoftText,
                  cursor: "pointer",
                  display: "grid",
                  placeItems: "center",
                  transition: "background 150ms ease, color 150ms ease",
                }}
              >
                {mode === "list" ? (
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                    <rect x="0" y="1" width="16" height="2.5" rx="1.25" />
                    <rect x="0" y="6.75" width="16" height="2.5" rx="1.25" />
                    <rect x="0" y="12.5" width="16" height="2.5" rx="1.25" />
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
        </div>

        {/* Track list / grid */}
        {loading ? (
          <p style={{ color: themeCfg.uiSoftText, padding: "20px 0" }}>Lade…</p>
        ) : listItems.length === 0 ? (
          <div
            style={{
              background: glassCardBg,
              backdropFilter: "blur(22px)",
              WebkitBackdropFilter: "blur(22px)",
              border: `1px solid ${glassCardBorder}`,
              borderRadius: 16,
              padding: "32px 24px",
              textAlign: "center",
            }}
          >
            <p style={{ margin: 0, fontWeight: 700, fontSize: "1rem", color: themeCfg.uiText }}>
              Keine Einträge
            </p>
            <p style={{ margin: "8px 0 20px", fontSize: "0.875rem", color: themeCfg.uiSoftText }}>
              Hier landen deine generierten Audios.
            </p>
            <Link
              href="/generate"
              style={{
                display: "inline-block",
                fontWeight: 700,
                fontSize: "0.875rem",
                textDecoration: "none",
                padding: "9px 20px",
                borderRadius: 999,
                background: themeCfg.primaryButtonBg,
                color: themeCfg.primaryButtonText,
              }}
            >
              + Neue Generierung
            </Link>
          </div>
        ) : (
          <>
            <ul
              style={
                viewMode === "grid"
                  ? {
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                      gap: 12,
                      listStyle: "none",
                      margin: 0,
                      padding: 0,
                    }
                  : {
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      listStyle: "none",
                      margin: 0,
                      padding: 0,
                    }
              }
            >
              {listItems.map((t) => {
                const isEditing = editingId === t.id;
                const menuOpen = openMenuId === t.id;
                const isStoryItem = !!t.storyId;
                const chapterCount = isStoryItem ? (storyChapterCounts[t.storyId!] ?? 1) : null;
                const displayTitle = isStoryItem ? getStoryTitle(t) : getEffectiveTitle(t);
                const active = isTrackActive(t);
                const playing = isTrackPlaying(t);
                const dur = getDurSeconds(t);
                const durLabel = Number.isFinite(dur) ? formatDuration(dur) : "";
                const { label: presetLabel, isStoryType } = resolvePreset(t);

                const menuItems = [
                  { label: "Umbenennen", action: () => beginEdit(t) },
                  {
                    label: t.isPublic ? "Freigabe entfernen" : "Öffentlich teilen",
                    action: () => void toggleShare(t),
                  },
                  { label: "Link kopieren", action: () => void copyLink(t) },
                  { label: "Download", action: () => void handleDownload(t) },
                  ...(t.storyId
                    ? [{ label: "Story Player öffnen", action: () => router.push(`/s/${t.storyId}`) }]
                    : [{ label: "Track Player öffnen", action: () => router.push(`/t/${t.id}`) }]),
                  { label: "Details", action: () => setDetailTrack(t) },
                ];

                const metaBadges = (
                  <>
                    {durLabel && (
                      <span style={{ color: themeCfg.uiSoftText }}>{durLabel}</span>
                    )}
                    {isStoryItem && chapterCount && chapterCount > 1 && (
                      <span
                        style={{
                          padding: "1px 7px",
                          borderRadius: 999,
                          background: themeCfg.secondaryButtonBg,
                          border: `1px solid ${themeCfg.secondaryButtonBorder}`,
                          fontSize: "0.7rem",
                          fontWeight: 700,
                          color: themeCfg.uiSoftText,
                        }}
                      >
                        {chapterCount} Kap.
                      </span>
                    )}
                    <span
                      style={{
                        padding: "1px 7px",
                        borderRadius: 999,
                        background: isStoryType
                          ? isDark ? "rgba(56,189,248,0.1)" : "rgba(79,70,229,0.08)"
                          : themeCfg.secondaryButtonBg,
                        border: `1px solid ${isStoryType
                          ? (isDark ? "rgba(56,189,248,0.28)" : "rgba(79,70,229,0.22)")
                          : themeCfg.secondaryButtonBorder}`,
                        fontSize: "0.7rem",
                        fontWeight: 700,
                        color: isStoryType ? themeCfg.progressColor : themeCfg.uiSoftText,
                      }}
                    >
                      {presetLabel}
                    </span>
                    {t.isPublic && (
                      <span style={{ color: themeCfg.progressColor, fontWeight: 600 }}>
                        Öffentlich
                      </span>
                    )}
                  </>
                );

                if (viewMode === "grid") {
                  return (
                    <li
                      key={t.id}
                      style={{
                        position: "relative",
                        zIndex: menuOpen ? 100 : undefined,
                        background: glassCardBg,
                        backdropFilter: "blur(22px)",
                        WebkitBackdropFilter: "blur(22px)",
                        border: `1px solid ${active ? activeBorderColor : glassCardBorder}`,
                        borderRadius: 16,
                        padding: "14px 14px 12px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 0,
                        transition: "border-color 200ms ease",
                        minHeight: 120,
                      }}
                    >
                      {/* Top row: type badge + menu */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                        <div style={{ display: "flex", alignItems: "center" }}>
                          <span
                            style={{
                              padding: "2px 8px",
                              borderRadius: 999,
                              background: isStoryType
                                ? isDark ? "rgba(56,189,248,0.1)" : "rgba(79,70,229,0.08)"
                                : themeCfg.secondaryButtonBg,
                              border: `1px solid ${isStoryType
                                ? (isDark ? "rgba(56,189,248,0.28)" : "rgba(79,70,229,0.22)")
                                : themeCfg.secondaryButtonBorder}`,
                              fontSize: "0.68rem",
                              fontWeight: 700,
                              color: isStoryType ? themeCfg.progressColor : themeCfg.uiSoftText,
                            }}
                          >
                            {presetLabel}
                          </span>
                        </div>
                        <div data-menu-root style={{ position: "relative" }}>
                          <button
                            type="button"
                            aria-label="Aktionen"
                            onClick={() => setOpenMenuId(menuOpen ? null : t.id)}
                            style={{
                              width: 28, height: 28,
                              borderRadius: "50%",
                              border: "none",
                              background: "transparent",
                              color: menuOpen ? themeCfg.uiText : themeCfg.uiSoftText,
                              cursor: "pointer",
                              display: "grid",
                              placeItems: "center",
                              opacity: menuOpen ? 1 : 0.55,
                              transition: "opacity 150ms ease",
                            }}
                          >
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                              <circle cx="8" cy="2.5" r="1.5" />
                              <circle cx="8" cy="8" r="1.5" />
                              <circle cx="8" cy="13.5" r="1.5" />
                            </svg>
                          </button>
                          {menuOpen && (
                            <div style={menuDropdownStyle(isDark, themeCfg)}>
                              {menuItems.map(({ label, action }) => (
                                <button key={label} type="button"
                                  onClick={() => { action(); setOpenMenuId(null); }}
                                  style={menuItemStyle(themeCfg.uiText, themeCfg.cardBorder)}
                                >
                                  {label}
                                </button>
                              ))}
                              <button type="button"
                                onClick={() => { void deleteTrack(t); setOpenMenuId(null); }}
                                style={menuItemStyle("#ef4444", "transparent")}
                              >
                                Löschen
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Title — left-aligned, grows */}
                      <button
                        type="button"
                        onClick={() => setDetailTrack(t)}
                        style={{
                          appearance: "none",
                          background: "transparent",
                          border: "none",
                          padding: 0,
                          cursor: "pointer",
                          fontWeight: 700,
                          fontSize: "0.9rem",
                          color: themeCfg.uiText,
                          textAlign: "left",
                          width: "100%",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                          lineHeight: 1.4,
                          marginBottom: 12,
                          flexGrow: 1,
                        }}
                      >
                        {displayTitle}
                      </button>

                      {/* Bottom row: meta left + play right */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <div style={{
                          fontSize: "0.72rem",
                          display: "flex",
                          gap: 5,
                          alignItems: "center",
                          flexWrap: "wrap",
                          color: themeCfg.uiSoftText,
                          flex: "1 1 0",
                          minWidth: 0,
                        }}>
                          {durLabel && <span>{durLabel}</span>}
                          {isStoryItem && chapterCount && chapterCount > 1 && (
                            <span
                              style={{
                                padding: "1px 6px",
                                borderRadius: 999,
                                background: themeCfg.secondaryButtonBg,
                                border: `1px solid ${themeCfg.secondaryButtonBorder}`,
                                fontSize: "0.68rem",
                                fontWeight: 700,
                                color: themeCfg.uiSoftText,
                              }}
                            >
                              {chapterCount} Kap.
                            </span>
                          )}
                          {t.isPublic && (
                            <span style={{ color: themeCfg.progressColor, fontWeight: 600 }}>Öffentlich</span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => void handlePlay(t)}
                          aria-label={playing ? "Pause" : "Abspielen"}
                          style={{
                            width: 36, height: 36,
                            borderRadius: "50%",
                            border: "none",
                            background: themeCfg.primaryButtonBg,
                            color: themeCfg.primaryButtonText,
                            display: "grid",
                            placeItems: "center",
                            cursor: "pointer",
                            boxShadow: active ? "0 4px 16px rgba(0,0,0,0.22)" : "0 2px 8px rgba(0,0,0,0.12)",
                            flexShrink: 0,
                            transition: "box-shadow 200ms ease",
                          }}
                        >
                          {playing ? (
                            <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor">
                              <rect x="1.5" y="1" width="3.5" height="10" rx="1" />
                              <rect x="7" y="1" width="3.5" height="10" rx="1" />
                            </svg>
                          ) : (
                            <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor">
                              <path d="M2.5 1.8l7 3.7-7 3.7z" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </li>
                  );
                }

                // ── List card ──────────────────────────────────────────────
                return (
                  <li
                    key={t.id}
                    style={{
                      position: "relative",
                      zIndex: menuOpen ? 100 : undefined,
                      background: glassCardBg,
                      backdropFilter: "blur(22px)",
                      WebkitBackdropFilter: "blur(22px)",
                      border: `1px solid ${active ? activeBorderColor : glassCardBorder}`,
                      borderRadius: 14,
                      padding: "14px 18px",
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      transition: "border-color 200ms ease",
                    }}
                  >
                    {/* ▶ Play button */}
                    <button
                      type="button"
                      onClick={() => void handlePlay(t)}
                      aria-label={playing ? "Pause" : "Abspielen"}
                      style={{
                        flexShrink: 0,
                        width: 40, height: 40,
                        borderRadius: "50%",
                        border: "none",
                        background: themeCfg.primaryButtonBg,
                        color: themeCfg.primaryButtonText,
                        display: "grid",
                        placeItems: "center",
                        cursor: "pointer",
                        boxShadow: active ? "0 4px 16px rgba(0,0,0,0.2)" : "none",
                        transition: "box-shadow 200ms ease",
                      }}
                    >
                      {playing ? (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                          <rect x="1.5" y="1" width="3.5" height="10" rx="1" />
                          <rect x="7" y="1" width="3.5" height="10" rx="1" />
                        </svg>
                      ) : (
                        <svg width="12" height="12" viewBox="0 0 11 11" fill="currentColor">
                          <path d="M2.5 1.8l7 3.7-7 3.7z" />
                        </svg>
                      )}
                    </button>

                    {/* Title + meta */}
                    <div style={{ flex: "1 1 0", minWidth: 0 }}>
                      {isEditing ? (
                        <div style={{ display: "flex", gap: 8 }}>
                          <input
                            autoFocus
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { e.preventDefault(); void saveEdit(t.id); }
                              else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
                            }}
                            style={{ ...inputStyle, flex: "1 1 auto", minWidth: 0, fontWeight: 700 }}
                            placeholder="Titel eingeben…"
                          />
                          <button
                            type="button"
                            onClick={() => void saveEdit(t.id)}
                            style={{
                              padding: "6px 14px",
                              borderRadius: 999,
                              border: "none",
                              background: themeCfg.primaryButtonBg,
                              color: themeCfg.primaryButtonText,
                              fontWeight: 700,
                              cursor: "pointer",
                              fontSize: "0.85rem",
                              flexShrink: 0,
                            }}
                          >
                            Speichern
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setDetailTrack(t)}
                            style={{
                              appearance: "none",
                              background: "transparent",
                              border: "none",
                              padding: 0,
                              cursor: "pointer",
                              fontWeight: 700,
                              fontSize: "0.95rem",
                              color: themeCfg.uiText,
                              textAlign: "left",
                              display: "block",
                              width: "100%",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {displayTitle}
                          </button>
                          <div style={{
                            fontSize: "0.77rem",
                            color: themeCfg.uiSoftText,
                            marginTop: 5,
                            display: "flex",
                            gap: 8,
                            alignItems: "center",
                            flexWrap: "wrap",
                          }}>
                            {metaBadges}
                          </div>
                        </>
                      )}
                    </div>

                    {/* ⋮ Menu */}
                    <div data-menu-root style={{ position: "relative", flexShrink: 0 }}>
                      <button
                        type="button"
                        aria-label="Aktionen"
                        onClick={() => setOpenMenuId(menuOpen ? null : t.id)}
                        style={{
                          width: 28, height: 28,
                          borderRadius: "50%",
                          border: "none",
                          background: "transparent",
                          color: menuOpen ? themeCfg.uiText : themeCfg.uiSoftText,
                          cursor: "pointer",
                          display: "grid",
                          placeItems: "center",
                          opacity: menuOpen ? 1 : 0.55,
                          transition: "opacity 150ms ease",
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                          <circle cx="8" cy="2.5" r="1.5" />
                          <circle cx="8" cy="8" r="1.5" />
                          <circle cx="8" cy="13.5" r="1.5" />
                        </svg>
                      </button>
                      {menuOpen && (
                        <div style={menuDropdownStyle(isDark, themeCfg)}>
                          {menuItems.map(({ label, action }) => (
                            <button key={label} type="button"
                              onClick={() => { action(); setOpenMenuId(null); }}
                              style={menuItemStyle(themeCfg.uiText, themeCfg.cardBorder)}
                            >
                              {label}
                            </button>
                          ))}
                          <button type="button"
                            onClick={() => { void deleteTrack(t); setOpenMenuId(null); }}
                            style={menuItemStyle("#ef4444", "transparent")}
                          >
                            Löschen
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Load more */}
            {nextCursor && (
              <div style={{ marginTop: 20, display: "flex", justifyContent: "center" }}>
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  style={{
                    padding: "10px 28px",
                    borderRadius: 999,
                    fontWeight: 700,
                    fontSize: "0.875rem",
                    border: `1px solid ${themeCfg.secondaryButtonBorder}`,
                    background: themeCfg.secondaryButtonBg,
                    color: themeCfg.secondaryButtonText,
                    cursor: loadingMore ? "default" : "pointer",
                    opacity: loadingMore ? 0.6 : 1,
                  }}
                >
                  {loadingMore ? "Lade…" : "Mehr laden"}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Detail modal ──────────────────────────────────────────────────── */}
      {detailTrack && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed", inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16, zIndex: 500,
          }}
          onClick={() => setDetailTrack(null)}
        >
          <div
            style={{
              maxWidth: 520, width: "100%",
              maxHeight: "80vh", overflow: "auto",
              background: isDark ? "rgba(15,23,42,0.97)" : "rgba(255,255,255,0.97)",
              color: themeCfg.uiText,
              borderRadius: 20,
              border: `1px solid ${themeCfg.cardBorder}`,
              boxShadow: themeCfg.cardShadow,
              padding: 24,
              backdropFilter: "blur(24px)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: themeCfg.uiSoftText, marginBottom: 4 }}>
                  {detailTrack.storyId ? "Story" : "Track"}
                </div>
                <h2 style={{ fontSize: "1.1rem", fontWeight: 800, margin: 0, color: themeCfg.uiText, wordBreak: "break-word" }}>
                  {detailTrack.storyId ? getStoryTitle(detailTrack) : getEffectiveTitle(detailTrack)}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setDetailTrack(null)}
                style={{
                  flexShrink: 0, width: 32, height: 32,
                  border: `1px solid ${themeCfg.cardBorder}`,
                  background: "transparent", color: themeCfg.uiSoftText,
                  borderRadius: "50%", cursor: "pointer",
                  display: "grid", placeItems: "center", fontSize: "0.9rem",
                }}
              >
                ✕
              </button>
            </div>

            {/* Meta — creation date shown here */}
            <div style={{ fontSize: "0.82rem", color: themeCfg.uiSoftText, marginBottom: 16, display: "flex", flexWrap: "wrap", gap: 8 }}>
              {detailTrack.createdAt && (
                <span>{new Date(detailTrack.createdAt).toLocaleDateString("de-DE")}</span>
              )}
              {(() => {
                const dur = getDurSeconds(detailTrack);
                return Number.isFinite(dur) ? <span>{formatDuration(dur)}</span> : null;
              })()}
              {detailTrack.isPublic && (
                <span style={{ color: themeCfg.progressColor, fontWeight: 600 }}>Öffentlich</span>
              )}
              {detailTrack.storyId && (storyChapterCounts[detailTrack.storyId] ?? 1) > 1 && (
                <span>{storyChapterCounts[detailTrack.storyId]} Kapitel</span>
              )}
            </div>

            {/* Prompt */}
            {(detailTrack.prompt ?? "").trim() && (
              <div style={{ marginBottom: 16, padding: "12px 14px", borderRadius: 12, background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)", border: `1px solid ${themeCfg.cardBorder}` }}>
                <div style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: themeCfg.uiSoftText, marginBottom: 6 }}>
                  Prompt
                </div>
                <div style={{ fontSize: "0.88rem", color: themeCfg.uiText, whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.6 }}>
                  {detailTrack.prompt}
                </div>
              </div>
            )}

            {/* Script */}
            {(detailTrack.scriptText ?? "").trim() && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: themeCfg.uiSoftText, marginBottom: 6 }}>
                  Skript
                </div>
                <div style={{
                  maxHeight: 220, overflowY: "auto",
                  padding: "12px 14px", borderRadius: 12,
                  background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
                  border: `1px solid ${themeCfg.cardBorder}`,
                  fontSize: "0.85rem", color: themeCfg.uiText,
                  whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.7,
                }}>
                  {detailTrack.scriptText}
                </div>
              </div>
            )}

            {/* Play now */}
            <button
              type="button"
              onClick={() => { void handlePlay(detailTrack); setDetailTrack(null); }}
              style={{
                width: "100%", padding: "13px 20px",
                borderRadius: 999, border: "none",
                background: themeCfg.primaryButtonBg,
                color: themeCfg.primaryButtonText,
                fontWeight: 700, fontSize: "0.95rem", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                gap: 8, marginBottom: 10,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 11 11" fill="currentColor">
                <path d="M2.5 1.8l7 3.7-7 3.7z" />
              </svg>
              Jetzt abspielen
            </button>

            {/* Open in dedicated player */}
            {detailTrack.storyId ? (
              <button type="button"
                onClick={() => { setDetailTrack(null); router.push(`/s/${detailTrack.storyId}`); }}
                style={secondaryBtnStyle(themeCfg)}
              >
                In Story Player öffnen
              </button>
            ) : (
              <button type="button"
                onClick={() => { setDetailTrack(null); router.push(`/t/${detailTrack.id}`); }}
                style={secondaryBtnStyle(themeCfg)}
              >
                In Track Player öffnen
              </button>
            )}

            {/* Variation CTA */}
            {(detailTrack.prompt ?? "").trim() && (() => {
              const isStory = !!detailTrack.storyId;
              const params = new URLSearchParams();
              params.set("prompt", detailTrack.prompt!.trim());
              if (detailTrack.preset) params.set("preset", detailTrack.preset);
              params.set("ref", isStory ? detailTrack.storyId! : detailTrack.id);
              params.set("refType", isStory ? "story" : "track");
              const sourceTitle = isStory ? getStoryTitle(detailTrack) : getEffectiveTitle(detailTrack);
              params.set("sourceTitle", sourceTitle);
              const dur = getDurSeconds(detailTrack);
              if (Number.isFinite(dur) && dur > 0) params.set("durationSec", String(Math.round(dur)));
              return (
                <button type="button"
                  onClick={() => { setDetailTrack(null); router.push(`/generate?${params.toString()}`); }}
                  style={{ ...secondaryBtnStyle(themeCfg), marginTop: 6 }}
                >
                  Neue Version erstellen
                </button>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── Toast ─────────────────────────────────────────────────────────── */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed", right: 16, bottom: 88,
            background: toast.kind === "err"
              ? isDark ? "rgba(185,28,28,0.92)" : "#fee2e2"
              : isDark ? "rgba(15,23,42,0.96)" : "rgba(255,255,255,0.96)",
            color: toast.kind === "err"
              ? isDark ? "#fca5a5" : "#991b1b"
              : themeCfg.uiText,
            border: `1px solid ${themeCfg.cardBorder}`,
            borderRadius: 12,
            boxShadow: themeCfg.cardShadow,
            padding: "10px 16px",
            fontWeight: 600, fontSize: "0.875rem",
            zIndex: 400, backdropFilter: "blur(16px)",
          }}
        >
          {toast.msg}
        </div>
      )}
    </main>
    </SVScene>
  );
}

// ─── Style helpers ─────────────────────────────────────────────────────────────

function menuDropdownStyle(
  isDark: boolean,
  themeCfg: { cardBorder: string; cardShadow: string }
): React.CSSProperties {
  return {
    position: "absolute",
    right: 0,
    top: "calc(100% + 6px)",
    background: isDark ? "rgba(15,23,42,0.97)" : "rgba(255,255,255,0.97)",
    border: `1px solid ${themeCfg.cardBorder}`,
    borderRadius: 12,
    minWidth: 200,
    boxShadow: themeCfg.cardShadow,
    overflow: "hidden",
    zIndex: 200,
    backdropFilter: "blur(16px)",
  };
}

function menuItemStyle(color: string, borderColor: string): React.CSSProperties {
  return {
    width: "100%",
    textAlign: "left",
    padding: "10px 16px",
    background: "transparent",
    border: "none",
    borderBottom: `1px solid ${borderColor}`,
    cursor: "pointer",
    fontWeight: 600,
    fontSize: "0.875rem",
    color,
  };
}

function secondaryBtnStyle(themeCfg: {
  secondaryButtonBg: string;
  secondaryButtonBorder: string;
  secondaryButtonText: string;
}): React.CSSProperties {
  return {
    width: "100%",
    padding: "11px 20px",
    borderRadius: 999,
    border: `1px solid ${themeCfg.secondaryButtonBorder}`,
    background: themeCfg.secondaryButtonBg,
    color: themeCfg.secondaryButtonText,
    fontWeight: 600,
    fontSize: "0.875rem",
    cursor: "pointer",
  };
}
