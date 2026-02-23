"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type React from "react";
import CustomPlayer from "@/app/components/CustomPlayer";
import EmptyState from "../components/EmptyState";
import HeaderCredits from "@/app/components/HeaderCredits";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";

type Track = {
  id: string;
  title?: string | null;
  prompt?: string | null;
  jobTitle?: string | null; // 👈 NEU
  url: string;
  createdAt?: string;
  durationSeconds?: number | null;
  // 🔹 Sharing
  isPublic?: boolean | null;
  shareSlug?: string | null;
  storyId?: string | null;
storyTitle?: string | null;
partIndex?: number | null;
partTitle?: string | null;
};

type TrackItem = {
  id: string;
  title?: string | null;
  url: string;
  durationSeconds?: number | null;
  preset?: string | null;
  createdAt?: string | Date | null;
  // job?: { title?: string | null; prompt?: string | null } | null; // nur falls du mal rel. lädst
};

function displayTrackTitle(t: TrackItem): string {
  const raw = (t.title ?? "").trim();

  // Falls nach Migration mal irgendwas leer sein sollte
  if (!raw) {
    return "SoftVibe Track";
  }

  // Schön kurz halten
  if (raw.length > 80) {
    return raw.slice(0, 77) + "…";
  }
  return raw;
}

type Theme = "light" | "dark" | "pastel";
type SortKey = "newest" | "oldest" | "short" | "long";

// ---- API-Response-Formen ----
type ItemsResp = { items: Track[]; nextCursor?: string | null };
type OkDataResp = { ok: true; data: { items: Track[]; nextCursor?: string | null } };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function isTrack(v: unknown): v is Track {
  return isRecord(v) && typeof (v as { id?: unknown }).id === "string" && typeof (v as { url?: unknown }).url === "string";
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

export default function LibraryClient() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
const [playerRev, setPlayerRev] = useState<Record<string, number>>({});
  // Pagination (neu)
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("newest");

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [openMode, setOpenMode] = useState<"hover" | "click" | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const [toast, setToast] = useState<{ msg: string; kind?: "ok" | "err" } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const showToast = (msg: string, kind: "ok" | "err" = "ok") => {
    setToast({ msg, kind });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2500);
  };

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
  const nextTheme: Record<Theme, Theme> = { light: "dark", dark: "pastel", pastel: "light" };
  const getThemeIcon = () => (theme === "light" ? "🌞" : theme === "dark" ? "🌙" : "🎨");
  const handleToggleTheme = () => setTheme(nextTheme[theme]);
  const getLogo = () =>
    theme === "light"
      ? "/softvibe-logo-light.svg"
      : theme === "dark"
      ? "/softvibe-logo-dark.svg"
      : "/softvibe-logo-pastel.svg";

const sp = useSearchParams();
const storyIdFromUrl = (sp.get("story") ?? "").trim();
const isStoryMode = !!storyIdFromUrl;
useEffect(() => {
  if (storyIdFromUrl) {
    void openStory(storyIdFromUrl);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [storyIdFromUrl]);

const [detailTrack, setDetailTrack] = useState<Track | null>(null);

const [storyLoading, setStoryLoading] = useState(false);
const [storyTracks, setStoryTracks] = useState<Track[]>([]);
const [storyMeta, setStoryMeta] = useState<{ id: string; title: string } | null>(null);
const [storyIndex, setStoryIndex] = useState(0);
const router = useRouter();

const navBtnStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid var(--color-nav-bg)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  cursor: "pointer",
  fontWeight: 800,
};



const detailTitle = (() => {
  if (!detailTrack) return "";

  const trackTitle = (detailTrack.title ?? "").trim();
  const jobTitle = (detailTrack.jobTitle ?? "").trim();
  const promptText = (detailTrack.prompt ?? "").trim();

  // 1) Wenn der Track umbenannt wurde (Titel ungleich Job-Titel) → diesen anzeigen
  if (trackTitle && trackTitle !== jobTitle) return trackTitle;

  // 2) Sonst: Job-Titel (das ist dein Formular-Titel)
  if (jobTitle) return jobTitle;

  // 3) Fallback: alter Track-Titel (z. B. migrierte Daten)
  if (trackTitle) return trackTitle;

  // 4) Letzte Rettung: Prompt kurz als Titel
  if (promptText) {
    return promptText.length > 80 ? promptText.slice(0, 80) + "…" : promptText;
  }

  return "(ohne Titel)";
})();

const detailPrompt = (() => {
  if (!detailTrack) return "";

  const promptText = (detailTrack.prompt ?? "").trim();
  const trackTitle = (detailTrack.title ?? "").trim();

  if (promptText) return promptText;

  // Fallback für ganz alte Daten:
  if (trackTitle.length > 80) return trackTitle;

  return "—";
})();

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

  useEffect(() => {
    void loadFirstPage();
  }, []);

  function getOrigin(): string {
    if (typeof window !== "undefined" && window.location?.origin) {
      return window.location.origin;
    }
    return process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  }
  function toAbsoluteUrl(pathOrUrl: string): string {
    if (!pathOrUrl) return getOrigin();
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    const base = getOrigin();
    const p = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
    return `${base}${p}`;
  }

  // ---- Laden (neu: mit Cursor) ----
  const TAKE = 12;

  async function loadFirstPage() {
    setLoading(true);
    try {
      const res = await fetch(`/api/tracks?take=${TAKE}`);
      if (!res.ok) throw new Error(String(res.status));
      const data: unknown = await res.json();

      let list: Track[] = [];
      let cursor: string | null | undefined = null;

      if (isTrackArray(data)) {
        list = data;
        cursor = null;
      } else if (isItemsResp(data)) {
        list = data.items;
        cursor = data.nextCursor ?? null;
      } else if (isOkDataResp(data)) {
        list = data.data.items;
        cursor = data.data.nextCursor ?? null;
      }

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
      const res = await fetch(`/api/tracks?take=${TAKE}&cursor=${encodeURIComponent(nextCursor)}`);
      if (!res.ok) throw new Error(String(res.status));
      const data: unknown = await res.json();

      let list: Track[] = [];
      let cursor: string | null | undefined = null;

      if (isTrackArray(data)) {
        list = data;
        cursor = null;
      } else if (isItemsResp(data)) {
        list = data.items;
        cursor = data.nextCursor ?? null;
      } else if (isOkDataResp(data)) {
        list = data.data.items;
        cursor = data.data.nextCursor ?? null;
      }

      setTracks((prev) => [...prev, ...list]);
      setNextCursor(cursor ?? null);
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
    }
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
      const n = Number(v.trim());
      return Number.isFinite(n) ? n : NaN;
    }
    return NaN;
  }

  const filtered = useMemo<Track[]>(() => {
    const base: Track[] = Array.isArray(tracks) ? tracks : [];
    const needle = q.trim().toLowerCase();

    const afterFilter = !needle
      ? base
      : base.filter((t) => {
          const a = (t.title ?? "").toLowerCase();
          const b = (t.prompt ?? "").toLowerCase();
          return a.includes(needle) || b.includes(needle);
        });

    const arr = [...afterFilter];
    switch (sortKey) {
      case "newest":
        arr.sort((a, b) => safeDate(b.createdAt) - safeDate(a.createdAt));
        break;
      case "oldest":
        arr.sort((a, b) => safeDate(a.createdAt) - safeDate(b.createdAt));
        break;
      case "short":
        arr.sort((a, b) => {
          const da = getDurSeconds(a), db = getDurSeconds(b);
          const aHas = Number.isFinite(da), bHas = Number.isFinite(db);
          if (aHas && bHas) return da - db;
          if (aHas && !bHas) return -1;
          if (!aHas && bHas) return 1;
          return safeDate(b.createdAt) - safeDate(a.createdAt);
        });
        break;
      case "long":
        arr.sort((a, b) => {
          const da = getDurSeconds(a), db = getDurSeconds(b);
          const aHas = Number.isFinite(da), bHas = Number.isFinite(db);
          if (aHas && bHas) return db - da;
          if (aHas && !bHas) return -1;
          if (!aHas && bHas) return 1;
          return safeDate(b.createdAt) - safeDate(a.createdAt);
        });
        break;
    }
    return arr;
  }, [q, tracks, sortKey]);
const listItems: Track[] = isStoryMode ? storyTracks : filtered;

  function beginEdit(t: Track) {
    const start = (t.title ?? t.prompt ?? "").trim();
    setEditingId(t.id);
    setEditingValue(start);
    setOpenMenuId(null);
    setOpenMode(null);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditingValue("");
  }
  async function saveEdit(id: string) {
    const title = editingValue.trim();
    if (!title) {
      cancelEdit();
      return;
    }
    const res = await fetch(`/api/tracks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) {
      showToast("Konnte Titel nicht speichern.", "err");
      return;
    }
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
    showToast("Titel gespeichert.", "ok");
    cancelEdit();
  }

  function downloadTrack(t: Track) {
    const a = document.createElement("a");
    a.href = t.url;
    a.setAttribute("download", `${(t.title || t.prompt || "softvibe")}.mp3`);
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

function unwrapJsonOk<T>(raw: unknown): T {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid JSON response");
  }

  // jsonOk(...) liefert oft { ok: true, data: ... }
  const obj = raw as Record<string, unknown>;
  const data = obj.data;

  return (data !== undefined ? data : obj) as T;
}

 async function copyLink(t: Track) {
  try {
    if (!t.isPublic || !t.shareSlug) {
      showToast("Aktiviere zuerst „Öffentlich teilen“.", "err");
      return;
    }

    const publicUrl = `${getOrigin()}/p/${t.shareSlug}`;

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(publicUrl);
    } else {
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

type StoryTracksResponse = {
  story: { id: string; title: string };
  tracks: Track[];
};

async function openStory(storyId: string) {
  setStoryLoading(true);
  try {
    // ✅ benutzt deinen bestehenden tracks endpoint, der storyId/partIndex/partTitle schon liefert
    const res = await fetch(`/api/tracks?storyId=${encodeURIComponent(storyId)}&take=200`);
    if (!res.ok) throw new Error("story fetch failed");
    const raw: unknown = await res.json();

    // jsonOk entpacken, ohne any
    const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const inner =
      r.data && typeof r.data === "object"
        ? (r.data as Record<string, unknown>)
        : r;

    const itemsRaw = Array.isArray(inner.items) ? inner.items : [];
    const items = itemsRaw.filter((x): x is Track => !!x && typeof x === "object") as Track[];

    // sort by partIndex
    const sorted = [...items].sort((a, b) => (a.partIndex ?? 0) - (b.partIndex ?? 0));

    setStoryTracks(sorted);
    setStoryIndex(0);

    // meta: Titel aus erstem Track ableiten
    const title = (sorted[0]?.storyTitle ?? "Story").trim();
    setStoryMeta({ id: storyId, title });
  } finally {
    setStoryLoading(false);
  }
}

function handleStoryEnded() {
  setStoryIndex((i) => {
    const next = i + 1;
    return next >= storyTracks.length ? i : next;
  });
}

  async function toggleShare(t: Track) {
  const want = !t.isPublic;
  const res = await fetch(`/api/tracks/${encodeURIComponent(t.id)}/share`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isPublic: want }),
  });

  if (!res.ok) {
    showToast("Konnte Freigabe nicht ändern.", "err");
    return;
  }

  const raw: unknown = await res.json();

  // jsonOk entpacken: entweder { ok, data:{...} } oder direkt { isPublic, shareSlug }
  let isPublic: boolean | undefined;
  let shareSlug: string | null | undefined;

  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    const inner =
      r.data && typeof r.data === "object"
        ? (r.data as Record<string, unknown>)
        : r;

    if (typeof inner.isPublic === "boolean") {
      isPublic = inner.isPublic;
    }
    if (
      typeof inner.shareSlug === "string" ||
      inner.shareSlug === null ||
      typeof inner.shareSlug === "undefined"
    ) {
      shareSlug = inner.shareSlug as string | null | undefined;
    }
  }

  if (typeof isPublic !== "boolean") {
    showToast("Antwort vom Server war unerwartet.", "err");
    return;
  }

  setTracks((prev) =>
    prev.map((x) =>
      x.id === t.id
        ? {
            ...x,
            isPublic,
            shareSlug: shareSlug ?? null,
          }
        : x
    )
  );

if (detailTrack?.id === t.id) {
  setDetailTrack((prev) =>
    prev ? { ...prev, isPublic, shareSlug: shareSlug ?? null } : prev
  );
}

  if (!isPublic) {
  setPlayerRev((prev) => ({
    ...prev,
    [t.id]: (prev[t.id] ?? 0) + 1,
  }));
}


  showToast(want ? "Öffentlich freigegeben." : "Freigabe entfernt.", "ok");
}

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (!target.closest?.("[data-menu-root]")) {
        setOpenMenuId(null);
        setOpenMode(null);
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

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
          <Image src={getLogo()} alt="SoftVibe Logo" width={160} height={50} priority />
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
          <HeaderCredits />

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
          width: "min(980px, 100vw - 32px)",
          maxWidth: "none",
          margin: "40px auto",
          padding: "0 16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <h1 style={{ fontSize: "1.6rem", fontWeight: 800 }}>Deine Bibliothek</h1>
          <Link
            href="/generate"
            style={{
              marginLeft: "auto",
              fontWeight: 600,
              textDecoration: "none",
              padding: "8px 12px",
              borderRadius: 10,
              background: "var(--color-accent)",
              color: "#fff",
            }}
          >
            + Neue Generierung
          </Link>
        </div>

        {/* Suche + Sortierung */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Suchen nach Titel oder Prompt…"
            style={{
              flex: "1 1 auto",
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid var(--color-nav-bg)",
              background: "var(--color-bg)",
              color: "var(--color-text)",
            }}
          />
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            aria-label="Sortieren"
            style={{
              flex: "0 0 auto",
              padding: "12px 12px",
              borderRadius: 12,
              border: "1px solid var(--color-nav-bg)",
              background: "var(--color-card)",
              color: "var(--color-text)",
              fontWeight: 600,
            }}
          >
            <option value="newest">Neueste zuerst</option>
            <option value="oldest">Älteste zuerst</option>
            <option value="short">Kürzeste zuerst</option>
            <option value="long">Längste zuerst</option>
          </select>
        </div>

        {/* Liste */}
        {loading ? (
          <p style={{ opacity: 0.65 }}>Lade…</p>
       ) : listItems.length === 0 ? (
          <EmptyState
            title="Keine Einträge"
            hint="Hier landen deine generierten Audios."
            action={{ href: "/generate", label: "+ Neue Generierung" }}
          />
        ) : (
          <>
           

{isStoryMode && (
  <div
    style={{
      marginBottom: 14,
      border: "1px solid var(--color-nav-bg)",
      borderRadius: 12,
      background: "var(--color-card)",
      padding: 12,
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <Link
        href="/library"
        style={{
          padding: "8px 10px",
          borderRadius: 10,
          border: "1px solid var(--color-nav-bg)",
          background: "var(--color-bg)",
          color: "var(--color-text)",
          fontWeight: 800,
          textDecoration: "none",
        }}
      >
        ← Zurück
      </Link>

      <div style={{ fontWeight: 900 }}>
        {storyMeta?.title ?? "Story"} · {storyTracks.length} Kapitel
      </div>
    </div>

    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: "0.85rem", opacity: 0.8, marginBottom: 8 }}>
        Chapter {storyIndex + 1}/{storyTracks.length}:{" "}
        {storyTracks[storyIndex]?.partTitle ?? ""}
      </div>

      <CustomPlayer
        key={`story:${storyMeta?.id ?? "x"}:${storyIndex}`} // wichtig
        src={storyTracks[storyIndex]?.url ?? ""}
        preload="auto"
        showTitle={false}
        autoPlay={true}
        onEnded={handleStoryEnded}
      />
    </div>

    <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
      <button
        disabled={storyIndex <= 0}
        onClick={() => setStoryIndex((i) => Math.max(0, i - 1))}
        style={navBtnStyle}
      >
        ◀︎ Zurück
      </button>

      <button
        disabled={storyIndex >= storyTracks.length - 1}
        onClick={() => setStoryIndex((i) => Math.min(storyTracks.length - 1, i + 1))}
        style={navBtnStyle}
      >
        Weiter ▶︎
      </button>
    </div>
  </div>
)}
            <ul style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {listItems.map((t) => {
  const isEditing = editingId === t.id;
  const isActive = openMenuId === t.id;
  const isHovering = hoverId === t.id;

  const trackTitle = (t.title ?? "").trim();
  const jobTitle = (t.jobTitle ?? "").trim();
  const promptText = (t.prompt ?? "").trim();
const isChapter = t.storyId && typeof t.partIndex === "number";

// nur im "normalen" Library-Mode wollen wir nur Chapter 1 sehen,
// damit die Liste nicht zugemüllt wird.
if (!isStoryMode && isChapter && t.partIndex !== 0) {
  return null;
}

  const effectiveTitle =
    trackTitle && trackTitle !== jobTitle
      ? trackTitle
      : jobTitle
      ? jobTitle
      : trackTitle
      ? trackTitle
      : promptText
      ? promptText.length > 80
        ? promptText.slice(0, 77) + "…"
        : promptText
      : "(ohne Titel)";
                return (
                  <li
                    key={t.id}
                    style={{
                      background: "var(--color-card)",
                      border: "1px solid var(--color-nav-bg)",
                      borderRadius: 12,
                      padding: "10px 12px",
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      columnGap: 12,
                    }}
                  >
                    {/* linke Spalte */}
                    <div style={{ minWidth: 0, gridColumn: "1 / 2" }}>
                      {/* Titel */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {isEditing ? (
                          <>
                            <input
                              autoFocus
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void saveEdit(t.id);
                                } else if (e.key === "Escape") {
                                  e.preventDefault();
                                  cancelEdit();
                                }
                              }}
                              style={{
                                flex: "1 1 auto",
                                minWidth: 0,
                                padding: "8px 10px",
                                borderRadius: 10,
                                border: "1px solid var(--color-nav-bg)",
                                background: "var(--color-bg)",
                                color: "var(--color-text)",
                                fontWeight: 700,
                              }}
                              placeholder="Titel eingeben…"
                            />
                            <button
                              onClick={() => void saveEdit(t.id)}
                              style={{
                                padding: "8px 12px",
                                borderRadius: 10,
                                border: "1px solid var(--color-nav-bg)",
                                background: "var(--color-accent)",
                                color: "#fff",
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              Speichern
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => router.push(`/t/${t.id}`)}
                            title="Titel bearbeiten"
                            style={{
                              appearance: "none",
                              background: "transparent",
                              border: "none",
                              padding: 0,
                              margin: 0,
                              cursor: "text",
                              fontWeight: 700,
                              color: "var(--color-text)",
                              textAlign: "left",
                              overflowWrap: "anywhere",
                              wordBreak: "break-word",
                              fontSize: "1rem",
                            }}
                          >
                            {effectiveTitle}
                          </button>
                        )}
                      </div>
      
                      {/* Meta */}
                      <div style={{ fontSize: "0.78rem", opacity: 0.65, marginTop: 2 }}>
                        {t.durationSeconds ? `${t.durationSeconds}s · ` : ""}
                        {t.createdAt ? new Date(t.createdAt).toLocaleString("de-DE") : ""}
                        {t.isPublic ? " · Öffentlich" : ""}
                        {t.storyId && typeof t.partIndex === "number"
  ? ` · Chapter ${t.partIndex + 1}`
  : ""}
                      </div>
                      {/* Player */}
{/* Player */}
<div style={{ marginTop: 10 }}>
  <CustomPlayer
    key={`${t.id}:${playerRev[t.id] ?? 0}`}
    src={t.url}
    preload="auto"
    showTitle={false}
  />
</div>
                    </div>

                    {/* rechte Spalte: Menü */}
                    <div
                      data-menu-root
                      style={{ gridColumn: "2 / 3", position: "relative", display: "inline-block" }}
                      onMouseLeave={() => {
                        setHoverId((prev) => (prev === t.id ? null : prev));
                        if (openMode === "hover") {
                          setOpenMenuId(null);
                          setOpenMode(null);
                        }
                      }}
                    >
                      <div
                        onMouseEnter={() => {
                          setHoverId(t.id);
                          if (openMode !== "click") {
                            setOpenMenuId(t.id);
                            setOpenMode("hover");
                          }
                        }}
                        style={{ display: "inline-block" }}
                      >
                        <button
                          aria-label="Aktionen"
                          onClick={() => {
                            if (openMenuId === t.id && openMode === "hover") {
                              setOpenMode("click");
                            } else if (openMenuId === t.id && openMode === "click") {
                              setOpenMenuId(null);
                              setOpenMode(null);
                            } else {
                              setOpenMenuId(t.id);
                              setOpenMode("click");
                            }
                          }}
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 8,
                            border: "1px solid var(--color-nav-bg)",
                            background: "var(--color-card)",
                            cursor: "pointer",
                            fontSize: 18,
                            lineHeight: 1,
                            display: "grid",
                            placeItems: "center",
                            color: "var(--color-text)",
                            boxShadow: "0 2px 6px rgba(0,0,0,.06)",
                          }}
                          title="Aktionen"
                        >
                          <span
                            style={{
                              display: "inline-block",
                              width: 16,
                              height: 2,
                              background: "var(--color-text)",
                              boxShadow: "0 1px 0 rgba(0,0,0,.25)",
                              position: "relative",
                            }}
                          >
                            <span
                              style={{
                                position: "absolute",
                                left: 0,
                                right: 0,
                                top: -6,
                                height: 2,
                                background: "var(--color-text)",
                                boxShadow: "0 1px 0 rgba(0,0,0,.25)",
                                content: '""',
                                display: "block",
                              }}
                            />
                            <span
                              style={{
                                position: "absolute",
                                left: 0,
                                right: 0,
                                top: 6,
                                height: 2,
                                background: "var(--color-text)",
                                boxShadow: "0 1px 0 rgba(0,0,0,.25)",
                                content: '""',
                                display: "block",
                              }}
                            />
                          </span>
                        </button>
                      </div>

                      {(isActive || isHovering) && (
                        <div style={{ position: "absolute", top: 0, left: "100%", width: 10, height: 36 }} />
                      )}

                      {openMenuId === t.id && (
                        <div
                          style={{
                            position: "absolute",
                            left: "calc(100% + 8px)",
                            top: 0,
                            background: "var(--color-card)",
                            color: "#000",
                            border: "1px solid var(--color-nav-bg)",
                            borderRadius: 10,
                            minWidth: 210,
                            boxShadow: "0 8px 18px rgba(0,0,0,.08)",
                            overflow: "hidden",
                            zIndex: 10,
                          }}
                        >
                          <button onClick={() => beginEdit(t)} style={menuItemStyle}>
                            Umbenennen
                          </button>

                          <button
                            onClick={() => {
                              void toggleShare(t);
                              if (openMode === "hover") {
                                setOpenMenuId(null);
                                setOpenMode(null);
                              }
                            }}
                            style={menuItemStyle}
                          >
                            {t.isPublic ? "Freigabe entfernen" : "Öffentlich teilen"}
                          </button>

                          <button
                            onClick={() => {
                              void copyLink(t);
                              if (openMode === "hover") {
                                setOpenMenuId(null);
                                setOpenMode(null);
                              }
                            }}
                            style={menuItemStyle}
                          >
                            Link kopieren
                          </button>

                          <button
                            onClick={() => {
                              downloadTrack(t);
                              if (openMode === "hover") {
                                setOpenMenuId(null);
                                setOpenMode(null);
                              }
                            }}
                            style={menuItemStyle}
                          >
                            Download
                          </button>

{t.storyId ? (
  <button
    onClick={() => {
      router.push(`/library?story=${encodeURIComponent(t.storyId!)}`);
      setOpenMenuId(null);
      setOpenMode(null);
    }}
    style={menuItemStyle}
  >
    Album öffnen
  </button>
) : null}

{/* 🔹 NEU: Details ansehen */}
    <button
      onClick={() => {
        setDetailTrack(t);
        setOpenMenuId(null);
        setOpenMode(null);
      }}
      style={menuItemStyle}
    >
      Details ansehen
    </button>

                          <button
                            onClick={() => {
                              void (async () => {
                                const res = await fetch(`/api/tracks/${encodeURIComponent(t.id)}`, { method: "DELETE" });
                                if (!res.ok) {
                                  showToast("Löschen fehlgeschlagen.", "err");
                                  return;
                                }
                                setTracks((prev) => prev.filter((x) => x.id !== t.id));
                                showToast("Gelöscht.", "ok");
                                // 🔸 Für „Sync“ mit Generate/Account gilt:
                                // Der Backend-DELETE muss auch den zugehörigen Job aufräumen,
                                // damit /api/jobs und /api/tracks konsistent sind.
                              })();
                              setOpenMenuId(null);
                              setOpenMode(null);
                            }}
                            style={{ ...menuItemStyle, color: "#b91c1c" }}
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

{/* ✅ DETAIL PANEL (NEU) */}
{detailTrack && (
  <div
    style={{
      marginTop: 14,
      border: "1px solid var(--color-nav-bg)",
      borderRadius: 12,
      background: "var(--color-card)",
      padding: 12,
    }}
  >
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
      <div style={{ fontWeight: 800 }}>{(detailTrack.title ?? "").trim() || "Details"}</div>
      <button
        onClick={() => setDetailTrack(null)}
        style={{
          padding: "6px 10px",
          borderRadius: 10,
          border: "1px solid var(--color-nav-bg)",
          background: "var(--color-bg)",
          cursor: "pointer",
          fontWeight: 700,
        }}
      >
        Schließen
      </button>
    </div>

    <div style={{ fontSize: "0.85rem", opacity: 0.8, marginTop: 6 }}>
      {detailTrack.createdAt ? new Date(detailTrack.createdAt).toLocaleString("de-DE") : null}
      {detailTrack.durationSeconds ? ` · ${detailTrack.durationSeconds}s` : ""}
      {detailTrack.isPublic ? " · Öffentlich" : ""}
      {detailTrack.partTitle ? ` · ${detailTrack.partTitle}` : ""}
    </div>

    {/* ✅ Story-Button nur wenn Story */}
    {detailTrack.storyId ? (
      <div style={{ marginTop: 12 }}>
        <button
          onClick={() => {
  const sid = detailTrack.storyId;
  if (!sid) return;
  setDetailTrack(null); // Modal schließen
  router.push(`/library?story=${encodeURIComponent(sid)}`);
}}
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid var(--color-nav-bg)",
            background: "var(--color-bg)",
            color: "var(--color-text)",
            fontWeight: 800,
            cursor: "pointer",
            width: "100%",
            textAlign: "left",
          }}
        >
          Kapitel laden
        </button>

        {storyLoading ? (
          <div style={{ marginTop: 10, opacity: 0.7 }}>Lade Kapitel…</div>
        ) : storyTracks.length ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: "0.85rem", opacity: 0.8, marginBottom: 8 }}>
              {storyMeta?.title ?? "Story"} · Chapter {storyIndex + 1}/{storyTracks.length}
            </div>

            <CustomPlayer
              key={`${storyMeta?.id ?? "story"}:${storyIndex}:${playerRev[storyMeta?.id ?? "story"] ?? 0}`}
              src={storyTracks[storyIndex]?.url ?? ""}
              preload="auto"
              showTitle={false}
              autoPlay={true}
              onEnded={handleStoryEnded}
            />

            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <button
                disabled={storyIndex <= 0}
                onClick={() => setStoryIndex((i) => Math.max(0, i - 1))}
                style={navBtnStyle}
              >
                ◀︎ Zurück
              </button>

              <button
                disabled={storyIndex >= storyTracks.length - 1}
                onClick={() => setStoryIndex((i) => Math.min(storyTracks.length - 1, i + 1))}
                style={navBtnStyle}
              >
                Weiter ▶︎
              </button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 10, opacity: 0.7 }}>Noch keine Kapitel geladen.</div>
        )}
      </div>
    ) : (
      <div style={{ marginTop: 12 }}>
        <CustomPlayer src={detailTrack.url} preload="auto" showTitle={false} />
      </div>
    )}
  </div>
)}

            {/* Load more (neu) */}
            {nextCursor && (
              <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  className="sv-btn"
                  style={{
                    padding: "10px 14px",
                    borderRadius: 12,
                    fontWeight: 700,
                    border: "1px solid var(--color-nav-bg)",
                    background: "var(--color-card)",
                    color: "var(--color-text)",
                  }}
                  disabled={loadingMore}
                >
                  {loadingMore ? "Lade…" : "Mehr laden"}
                </button>
              </div>
            )}
          </>
        )}
      </div>

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
                : "color-mix(in oklab, var(--color-accent) 20%, var(--color-card))",
            color: "var(--color-text)",
            border: "1px solid var(--color-nav-bg)",
            borderRadius: 12,
            boxShadow: "0 10px 24px rgba(0,0,0,.14)",
            padding: "10px 12px",
            fontWeight: 600,
            zIndex: 1000,
          }}
        >
          {toast.msg}
        </div>
      )}

      {/* 🔹 NEU: Detail-Modal */}
      {detailTrack && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.36)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 1100,
          }}
          onClick={() => setDetailTrack(null)}
        >
          <div
            style={{
              maxWidth: 560,
              width: "100%",
              maxHeight: "80vh",
              overflow: "auto",
              background: "var(--color-card)",
              color: "var(--color-text)",
              borderRadius: 16,
              border: "1px solid var(--color-nav-bg)",
              boxShadow: "0 20px 40px rgba(0,0,0,.25)",
              padding: 16,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                marginBottom: 8,
              }}
            >
              <h2
                style={{
                  fontSize: "1rem",
                  fontWeight: 800,
                  margin: 0,
                }}
              >
                Track-Details
              </h2>
              <button
                type="button"
                onClick={() => setDetailTrack(null)}
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: 20,
                  lineHeight: 1,
                }}
                aria-label="Schließen"
              >
                ×
              </button>
            </div>

            <div style={{ fontSize: "0.85rem", opacity: 0.8, marginBottom: 8 }}>
              {detailTrack.createdAt
                ? new Date(detailTrack.createdAt).toLocaleString("de-DE")
                : null}
              {detailTrack.durationSeconds
                ? ` · ${detailTrack.durationSeconds}s`
                : ""}
              {detailTrack.isPublic ? " · Öffentlich" : ""}
            </div>

            <div
              style={{
                marginBottom: 10,
                padding: "8px 10px",
                borderRadius: 10,
                background: "color-mix(in oklab, var(--color-bg) 85%, var(--color-card))",
                border: "1px solid var(--color-nav-bg)",
              }}
            >
              <div
                style={{
                  fontSize: "0.8rem",
                  opacity: 0.65,
                  marginBottom: 4,
                }}
              >
                Titel
              </div>
              <div style={{ fontWeight: 700, wordBreak: "break-word" }}>
                {detailTitle}
              </div>
            </div>

            <div
              style={{
                marginBottom: 10,
                padding: "8px 10px",
                borderRadius: 10,
                background: "color-mix(in oklab, var(--color-bg) 85%, var(--color-card))",
                border: "1px solid var(--color-nav-bg)",
              }}
            >
              <div
                style={{
                  fontSize: "0.8rem",
                  opacity: 0.65,
                  marginBottom: 4,
                }}
              >
                Prompt
              </div>
              <div
                  style={{
                    fontSize: "0.9rem",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {detailPrompt}
                </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <CustomPlayer
                src={detailTrack.url}
                preload="auto"
                showTitle={false}
              />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

const menuItemStyle: React.CSSProperties = {
  width: "100%",
  textAlign: "left",
  padding: "10px 12px",
  background: "transparent",
  border: "none",
  borderBottom: "1px solid var(--color-nav-bg)",
  cursor: "pointer",
  fontWeight: 700,
  color: "#001",
};

const navLinkStyle: React.CSSProperties = {
  padding: "0.4rem 0.85rem",
  borderRadius: 6,
  background: "var(--color-nav-bg)",
  color: "var(--color-nav-text)",
  textDecoration: "none",
  fontWeight: 600,
  fontSize: "0.9rem",
};