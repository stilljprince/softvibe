"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type React from "react";
import { useRouter } from "next/navigation";
import { usePlayer, type Chapter } from "@/app/components/player-context";
import { useSVTheme } from "@/app/components/sv-kit";
import SVScene from "@/app/components/sv-scene";
import { PLAYLIST_COVERS, getPlaylistCover } from "@/lib/playlist-covers";

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
};

type SortKey = "newest" | "oldest" | "short" | "long";
type ViewMode = "list" | "grid";
type LibraryView = "recent" | "playlists";

type ManualPlaylist = {
  id: string;
  name: string;
  pinned: boolean;
  position: number;
  coverKey: string | null;
  createdAt: string;
  itemCount: number;
};

type ManualPlaylistItem = {
  id: string;       // PlaylistItem.id
  position: number;
  track: Track;
};

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

// System-defined visual identity for auto playlists.
// Not user-editable — each preset has a stable, mood-matched gradient.
const AUTO_PLAYLIST_COVERS: Record<string, {
  gradient: string; accent: string; fg: string; softFg: string;
}> = {
  "sleep-story": {
    gradient: "linear-gradient(135deg, #020617 0%, #0f172a 55%, #1e1b4b 100%)",
    accent: "#818cf8",
    fg: "rgba(255,255,255,0.92)",
    softFg: "rgba(255,255,255,0.55)",
  },
  "kids-story": {
    gradient: "linear-gradient(135deg, #0f0519 0%, #2d1b69 55%, #5b21b6 100%)",
    accent: "#a78bfa",
    fg: "rgba(255,255,255,0.92)",
    softFg: "rgba(255,255,255,0.55)",
  },
  "meditation": {
    gradient: "linear-gradient(135deg, #012827 0%, #0d4b4b 55%, #0e7490 100%)",
    accent: "#2dd4bf",
    fg: "rgba(255,255,255,0.92)",
    softFg: "rgba(255,255,255,0.55)",
  },
  "classic-asmr": {
    gradient: "linear-gradient(135deg, #1c0a00 0%, #431407 55%, #92400e 100%)",
    accent: "#fbbf24",
    fg: "rgba(255,255,255,0.92)",
    softFg: "rgba(255,255,255,0.55)",
  },
  "__other__": {
    gradient: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
    accent: "#64748b",
    fg: "rgba(255,255,255,0.88)",
    softFg: "rgba(255,255,255,0.5)",
  },
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
  const { state, loadTrack, loadStory, play, pause, enqueue, enqueueBatch, clearQueue, playBatch } = usePlayer();
  const { themeKey, themeCfg, cycleTheme, logoSrc } = useSVTheme();
  const isDark = themeKey === "dark";
  const router = useRouter();

  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);

  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [libraryView, setLibraryView] = useState<LibraryView>("recent");
  const [openPlaylistSlug, setOpenPlaylistSlug] = useState<string | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [detailTrack, setDetailTrack] = useState<Track | null>(null);
  const [detailScriptText, setDetailScriptText] = useState<string | null>(null);

  const [toast, setToast] = useState<{ msg: string; kind?: "ok" | "err" } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const headerCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const downloadingRef = useRef<Set<string>>(new Set());

  // Inline credits for header menu — avoids HeaderCredits CSS-var dependency
  const [creditsCount, setCreditsCount] = useState<number | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // ── Manual playlists ─────────────────────────────────────────────────────────
  const [manualPlaylists, setManualPlaylists] = useState<ManualPlaylist[]>([]);
  const [manualPlaylistsLoaded, setManualPlaylistsLoaded] = useState(false);
  const [openManualPlaylistId, setOpenManualPlaylistId] = useState<string | null>(null);
  const [manualPlaylistItems, setManualPlaylistItems] = useState<ManualPlaylistItem[]>([]);
  const [manualPlaylistItemsLoading, setManualPlaylistItemsLoading] = useState(false);
  const [draggedPlId, setDraggedPlId] = useState<string | null>(null);
  const [dragOverPlId, setDragOverPlId] = useState<string | null>(null);
  const [coverPickerPlaylistId, setCoverPickerPlaylistId] = useState<string | null>(null);

  // create / rename flows
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [renamingPlaylistId, setRenamingPlaylistId] = useState<string | null>(null);
  const [renamingPlaylistValue, setRenamingPlaylistValue] = useState("");

  // add-to-playlist picker
  const [addToPlaylistTrack, setAddToPlaylistTrack] = useState<Track | null>(null);
  const [newPlaylistInPicker, setNewPlaylistInPicker] = useState("");
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
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

  useEffect(() => { void loadAllTracks(); }, []);

  // Load manual playlists whenever the playlists view becomes active
  useEffect(() => {
    if (libraryView === "playlists" && !manualPlaylistsLoaded) {
      void loadManualPlaylists();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryView]);

  // When a manual playlist is opened, fetch its items
  useEffect(() => {
    if (openManualPlaylistId) void loadManualPlaylistItems(openManualPlaylistId);
    else setManualPlaylistItems([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openManualPlaylistId]);

  // When the add-to-playlist picker opens, fetch playlists — each step logged for diagnosis
  useEffect(() => {
    if (!addToPlaylistTrack) {
      setPickerError(null);
      return;
    }
    let active = true;
    setPickerLoading(true);
    setPickerError(null);
    (async () => {
      try {
        const r = await fetch("/api/playlists", { credentials: "include" });
        if (!active) return;
        if (!r.ok) {
          setPickerError(`HTTP ${r.status}`);
          return;
        }
        const json: unknown = await r.json();
        if (!active) return;
        const j = json as Record<string, unknown> | null;
        const pls = j?.ok === true
          ? (j.data as Record<string, unknown> | undefined)?.playlists
          : j?.playlists;
        if (Array.isArray(pls)) {
          setManualPlaylists(pls as ManualPlaylist[]);
          setManualPlaylistsLoaded(true);
        }
      } catch (err) {
        if (active) setPickerError(String(err));
      } finally {
        if (active) setPickerLoading(false);
      }
    })();
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addToPlaylistTrack]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.("[data-menu-root]")) setOpenMenuId(null);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  // Lazy-load scriptText when a detail modal opens.
  // The list endpoint no longer carries scriptText to keep list responses lean.
  // The detail endpoint (GET /api/tracks/[id]) always includes it.
  useEffect(() => {
    if (!detailTrack?.id) {
      setDetailScriptText(null);
      return;
    }
    void fetch(`/api/tracks/${detailTrack.id}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((raw: unknown) => {
        const payload = (raw as { ok?: boolean; data?: { scriptText?: string | null } } | null);
        const text = payload?.ok === true
          ? (payload.data as { scriptText?: string | null } | undefined)?.scriptText
          : (raw as { scriptText?: string | null } | null)?.scriptText;
        setDetailScriptText(typeof text === "string" && text.trim() ? text.trim() : null);
      })
      .catch(() => setDetailScriptText(null));
  }, [detailTrack?.id]);

  // ── Data fetching ──────────────────────────────────────────────────────────

  // Loads all library metadata in one pass (paginating automatically).
  // Each page is 200 items — enough to cover virtually any library in one request.
  // Audio loading remains lazy and only happens when the user presses play.
  async function loadAllTracks() {
    setLoading(true);
    const collected: Track[] = [];
    let cursor: string | null = null;
    try {
      do {
        const url = cursor
          ? `/api/tracks?take=200&cursor=${encodeURIComponent(cursor)}`
          : `/api/tracks?take=200`;
        const res = await fetch(url);
        if (!res.ok) break;
        const data: unknown = await res.json();
        let list: Track[] = [];
        let nextCur: string | null | undefined = null;
        if (isTrackArray(data)) { list = data; }
        else if (isItemsResp(data)) { list = data.items; nextCur = data.nextCursor; }
        else if (isOkDataResp(data)) { list = data.data.items; nextCur = data.data.nextCursor; }
        for (const t of list) collected.push(t);
        cursor = nextCur ?? null;
        // Show first batch immediately so the page is never blank
        if (collected.length > 0) {
          setTracks([...collected]);
          setLoading(false);
        }
      } while (cursor);
    } catch {
      // show whatever was collected so far
    }
    setTracks([...collected]);
    setLoading(false);
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

  // Playlist grouping uses the raw track list (no search filter, no sort)
  // so groups don't shift when the user types in the search box.
  // Only the same chapter-deduplication as listItems is applied.
  const playlistBaseItems = useMemo<Track[]>(
    () => tracks.filter((t) => !(t.storyId && typeof t.partIndex === "number" && t.partIndex !== 0)),
    [tracks]
  );

  const playlistGroups = useMemo(() => {
    const ORDER = ["sleep-story", "kids-story", "meditation", "classic-asmr"];
    const buckets = new Map<string, Track[]>();
    for (const slug of ORDER) buckets.set(slug, []);
    const other: Track[] = [];
    for (const t of playlistBaseItems) {
      const slug = t.preset ?? "";
      if (buckets.has(slug)) buckets.get(slug)!.push(t);
      else other.push(t);
    }
    // Core presets always included — empty groups still render as tiles
    const result: { slug: string; label: string; tracks: Track[] }[] = [];
    for (const slug of ORDER) {
      result.push({ slug, label: PRESET_META[slug]?.label ?? slug, tracks: buckets.get(slug)! });
    }
    // "Weitere" only shown when unknown-preset tracks actually exist
    if (other.length > 0) result.push({ slug: "__other__", label: "Weitere", tracks: other });
    return result;
  }, [playlistBaseItems]);

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
      // Use locally-derived chapters immediately — no network wait.
      // Only fetch when we have nothing in memory at all.
      const chapters = deriveChapters(t.storyId, tracks);
      if (chapters.length > 0) {
        loadStory(t.storyId, chapters, undefined, getStoryTitle(t));
      } else {
        const fetched = await fetchStoryChapters(t.storyId);
        if (fetched.length > 0) loadStory(t.storyId, fetched, undefined, getStoryTitle(t));
        else showToast("Kapitel konnten nicht geladen werden.", "err");
      }
    } else {
      loadTrack(t.url, getEffectiveTitle(t), t.id);
    }
  }

  // ── Queue ───────────────────────────────────────────────────────────────────

  function handleAddToQueue(t: Track) {
    const title = t.storyId ? getStoryTitle(t) : getEffectiveTitle(t);
    if (t.storyId) {
      const chs = deriveChapters(t.storyId, tracks);
      enqueue({ trackId: t.id, trackUrl: t.url, title, storyId: chs.length > 1 ? t.storyId : null, chapters: chs.length > 1 ? chs : undefined });
    } else {
      enqueue({ trackId: t.id, trackUrl: t.url, title, storyId: null });
    }
    showToast("Zur Warteschlange hinzugefügt.");
  }

  function handlePlayPlaylist(group: { slug: string; tracks: Track[] }) {
    if (group.tracks.length === 0) return;
    // Build queue synchronously from already-loaded tracks — no network wait.
    const syncItems = group.tracks.map((item) => {
      const itemTitle = item.storyId ? getStoryTitle(item) : getEffectiveTitle(item);
      if (!item.storyId) return { trackId: item.id, trackUrl: item.url, title: itemTitle, storyId: null as string | null, chapters: undefined };
      const chs = deriveChapters(item.storyId, tracks);
      return {
        trackId: item.id,
        trackUrl: item.url,
        title: itemTitle,
        storyId: chs.length > 1 ? (item.storyId ?? null) : null,
        chapters: chs.length > 1 ? chs : undefined,
      };
    });
    playBatch(syncItems, 0);
    showToast("Playlist wird abgespielt.");
  }

  // Plays a specific track within a playlist, queuing the full playlist so earlier
  // items appear as history and later items appear as upcoming.
  function handlePlayFromPlaylist(t: Track, group: { slug: string; tracks: Track[] }) {
    if (isTrackActive(t)) {
      state.isPlaying ? pause() : play();
      return;
    }
    const clickedIdx = group.tracks.findIndex((item) => item.id === t.id);
    if (clickedIdx === -1) { void handlePlay(t); return; }

    // Build full playlist queue synchronously — playback starts immediately.
    const allItems = group.tracks.map((item) => {
      const itemTitle = item.storyId ? getStoryTitle(item) : getEffectiveTitle(item);
      if (!item.storyId) return { trackId: item.id, trackUrl: item.url, title: itemTitle, storyId: null as string | null, chapters: undefined };
      const chs = deriveChapters(item.storyId, tracks);
      return {
        trackId: item.id,
        trackUrl: item.url,
        title: itemTitle,
        storyId: chs.length > 1 ? (item.storyId ?? null) : null,
        chapters: chs.length > 1 ? chs : undefined,
      };
    });
    playBatch(allItems, clickedIdx);
  }

  // ── Manual playlist CRUD ────────────────────────────────────────────────────

  // ── Sorted playlist views (recomputed each render) ────────────────────────
  const pinnedManualPlaylists = manualPlaylists.filter((p) => p.pinned).sort((a, b) => a.position - b.position);
  const unpinnedManualPlaylists = manualPlaylists.filter((p) => !p.pinned).sort((a, b) => a.position - b.position);
  const sortedManualPlaylists = [...pinnedManualPlaylists, ...unpinnedManualPlaylists];

  async function loadManualPlaylists() {
    try {
      const res = await fetch("/api/playlists", { credentials: "include" });
      if (!res.ok) return;
      const json = await res.json().catch(() => null);
      const pls = json?.ok === true ? json.data?.playlists : json?.playlists;
      if (Array.isArray(pls)) {
        setManualPlaylists(pls as ManualPlaylist[]);
        setManualPlaylistsLoaded(true);
      }
    } catch { /* silent */ }
  }

  async function loadManualPlaylistItems(playlistId: string) {
    setManualPlaylistItemsLoading(true);
    try {
      const res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}/items`, { credentials: "include" });
      if (!res.ok) return;
      const json = await res.json().catch(() => null);
      const items = json?.ok === true ? json.data?.items : json?.items;
      if (Array.isArray(items)) setManualPlaylistItems(items as ManualPlaylistItem[]);
    } catch { /* silent */ }
    finally { setManualPlaylistItemsLoading(false); }
  }

  async function createPlaylist(name: string) {
    const res = await fetch("/api/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name }),
    });
    if (!res.ok) { showToast("Playlist konnte nicht erstellt werden.", "err"); return null; }
    const json = await res.json().catch(() => null);
    const pl = json?.ok === true ? json.data?.playlist : json?.playlist;
    if (!pl) return null;
    setManualPlaylists((prev) => [...prev, pl as ManualPlaylist]);
    setManualPlaylistsLoaded(true);
    return pl as ManualPlaylist;
  }

  async function renamePlaylist(id: string, name: string) {
    const res = await fetch(`/api/playlists/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name }),
    });
    if (!res.ok) { showToast("Umbenennen fehlgeschlagen.", "err"); return; }
    setManualPlaylists((prev) => prev.map((pl) => pl.id === id ? { ...pl, name } : pl));
    showToast("Playlist umbenannt.");
  }

  async function deletePlaylist(id: string) {
    const res = await fetch(`/api/playlists/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok) { showToast("Löschen fehlgeschlagen.", "err"); return; }
    setManualPlaylists((prev) => prev.filter((pl) => pl.id !== id));
    if (openManualPlaylistId === id) setOpenManualPlaylistId(null);
    showToast("Playlist gelöscht.");
  }

  async function addToPlaylist(playlistId: string, trackId: string) {
    const res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ trackId }),
    });
    if (res.status === 409) { showToast("Bereits in dieser Playlist."); return; }
    if (!res.ok) { showToast("Konnte nicht hinzugefügt werden.", "err"); return; }
    setManualPlaylists((prev) =>
      prev.map((pl) => pl.id === playlistId ? { ...pl, itemCount: pl.itemCount + 1 } : pl)
    );
    showToast("Zur Playlist hinzugefügt.");
    // Refresh items if this playlist is currently open
    if (openManualPlaylistId === playlistId) void loadManualPlaylistItems(playlistId);
  }

  async function removeFromPlaylist(playlistId: string, itemId: string) {
    const res = await fetch(
      `/api/playlists/${encodeURIComponent(playlistId)}/items/${encodeURIComponent(itemId)}`,
      { method: "DELETE", credentials: "include" }
    );
    if (!res.ok) { showToast("Entfernen fehlgeschlagen.", "err"); return; }
    setManualPlaylistItems((prev) => prev.filter((i) => i.id !== itemId));
    setManualPlaylists((prev) =>
      prev.map((pl) => pl.id === playlistId ? { ...pl, itemCount: Math.max(0, pl.itemCount - 1) } : pl)
    );
  }

  async function togglePin(id: string) {
    const pl = manualPlaylists.find((p) => p.id === id);
    if (!pl) return;
    const newPinned = !pl.pinned;
    const res = await fetch(`/api/playlists/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ pinned: newPinned }),
    });
    if (!res.ok) { showToast("Fehler beim Anpinnen.", "err"); return; }
    setManualPlaylists((prev) => prev.map((p) => p.id === id ? { ...p, pinned: newPinned } : p));
    showToast(newPinned ? "Playlist angepinnt." : "Playlist gelöst.");
  }

  async function setCoverForPlaylist(playlistId: string, coverKey: string | null) {
    const res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ coverKey }),
    });
    if (!res.ok) { showToast("Cover konnte nicht gespeichert werden.", "err"); return; }
    setManualPlaylists((prev) =>
      prev.map((p) => p.id === playlistId ? { ...p, coverKey } : p)
    );
    setCoverPickerPlaylistId(null);
  }

  async function reorderPlaylists(reordered: ManualPlaylist[]) {
    const positionMap = new Map(reordered.map((p, i) => [p.id, i]));
    setManualPlaylists((prev) =>
      prev.map((p) => positionMap.has(p.id) ? { ...p, position: positionMap.get(p.id)! } : p)
    );
    const items = reordered.map((p, i) => ({ id: p.id, position: i }));
    const res = await fetch("/api/playlists/positions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ items }),
    });
    if (!res.ok) {
      showToast("Reihenfolge konnte nicht gespeichert werden.", "err");
      void loadManualPlaylists();
    }
  }

  function handlePlaylistDrop(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    const draggedPl = manualPlaylists.find((p) => p.id === draggedId);
    const targetPl = manualPlaylists.find((p) => p.id === targetId);
    if (!draggedPl || !targetPl || draggedPl.pinned !== targetPl.pinned) return;
    const group = draggedPl.pinned ? pinnedManualPlaylists : unpinnedManualPlaylists;
    const from = group.findIndex((p) => p.id === draggedId);
    const to = group.findIndex((p) => p.id === targetId);
    if (from === to || from === -1 || to === -1) return;
    const reordered = [...group];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    void reorderPlaylists(reordered);
  }

  function handlePlayManualPlaylist(items: ManualPlaylistItem[], startIdx = 0) {
    if (items.length === 0) return;
    const target = items[startIdx].track;
    if (isTrackActive(target)) { state.isPlaying ? pause() : play(); return; }

    // Synchronous build — no network wait before playback starts.
    const allItems = items.map((item) => {
      const t = item.track;
      const title = t.storyId ? getStoryTitle(t) : getEffectiveTitle(t);
      if (!t.storyId) return { trackId: t.id, trackUrl: t.url, title, storyId: null as string | null, chapters: undefined };
      const chs = deriveChapters(t.storyId, tracks);
      return {
        trackId: t.id, trackUrl: t.url, title,
        storyId: chs.length > 1 ? (t.storyId ?? null) : null,
        chapters: chs.length > 1 ? chs : undefined,
      };
    });
    playBatch(allItems, startIdx);
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

  // ── Shared playlist list-row renderer (used in both list & grid overview) ──

  const renderPlaylistTrackRow = (t: Track, idx: number, total: number, group?: { slug: string; tracks: Track[] }) => {
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
    const isLast = idx === total - 1;

    const menuItems = [
      { label: "Umbenennen", action: () => beginEdit(t) },
      { label: "Zur Warteschlange hinzufügen", action: () => void handleAddToQueue(t) },
      { label: "Zu Playlist hinzufügen", action: () => setAddToPlaylistTrack(t) },
      { label: t.isPublic ? "Freigabe entfernen" : "Öffentlich teilen", action: () => void toggleShare(t) },
      { label: "Link kopieren", action: () => void copyLink(t) },
      { label: "Download", action: () => void handleDownload(t) },
      ...(t.storyId
        ? [{ label: "Story Player öffnen", action: () => router.push(`/s/${t.storyId}`) }]
        : [{ label: "Track Player öffnen", action: () => router.push(`/t/${t.id}`) }]),
      { label: "Details", action: () => setDetailTrack(t) },
    ];

    return (
      <li
        key={t.id}
        className="sv-pl-row"
        style={{
          position: "relative",
          zIndex: menuOpen ? 100 : undefined,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "9px 16px",
          background: active ? (isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)") : "transparent",
          borderRadius: isLast ? "0 0 12px 12px" : 0,
          transition: "background 100ms ease",
        }}
      >
        <button type="button" onClick={() => group ? void handlePlayFromPlaylist(t, group) : void handlePlay(t)} aria-label={playing ? "Pause" : "Abspielen"}
          style={{ flexShrink: 0, width: 32, height: 32, borderRadius: "50%", border: "none", background: active ? themeCfg.primaryButtonBg : (isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)"), color: active ? themeCfg.primaryButtonText : themeCfg.uiText, display: "grid", placeItems: "center", cursor: "pointer", transition: "background 150ms ease" }}
        >
          {playing
            ? <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><rect x="1.5" y="1" width="3.5" height="10" rx="1" /><rect x="7" y="1" width="3.5" height="10" rx="1" /></svg>
            : <svg width="10" height="10" viewBox="0 0 11 11" fill="currentColor"><path d="M2.5 1.8l7 3.7-7 3.7z" /></svg>}
        </button>

        <div style={{ flex: "1 1 0", minWidth: 0 }}>
          {isEditing ? (
            <div style={{ display: "flex", gap: 8 }}>
              <input autoFocus value={editingValue} onChange={(e) => setEditingValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void saveEdit(t.id); } else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); } }}
                style={{ ...inputStyle, flex: "1 1 auto", minWidth: 0, fontWeight: 700 }} placeholder="Titel eingeben…"
              />
              <button type="button" onClick={() => void saveEdit(t.id)} style={{ padding: "6px 14px", borderRadius: 999, border: "none", background: themeCfg.primaryButtonBg, color: themeCfg.primaryButtonText, fontWeight: 700, cursor: "pointer", fontSize: "0.85rem", flexShrink: 0 }}>
                Speichern
              </button>
            </div>
          ) : (
            <>
              <button type="button" onClick={() => setDetailTrack(t)}
                style={{ appearance: "none", background: "transparent", border: "none", padding: 0, cursor: "pointer", fontWeight: 600, fontSize: "0.9rem", color: themeCfg.uiText, textAlign: "left", display: "block", width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {displayTitle}
              </button>
              <div style={{ fontSize: "0.74rem", color: themeCfg.uiSoftText, marginTop: 2, display: "flex", gap: 6, alignItems: "center" }}>
                {durLabel && <span>{durLabel}</span>}
                {isStoryItem && chapterCount && chapterCount > 1 && (
                  <span style={{ padding: "0 5px", borderRadius: 999, background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", border: `1px solid ${glassCardBorder}`, fontSize: "0.67rem", fontWeight: 700 }}>
                    {chapterCount} Kap.
                  </span>
                )}
                {presetLabel && !isStoryType && <span style={{ opacity: 0.65 }}>{presetLabel}</span>}
                {t.isPublic && <span style={{ color: themeCfg.progressColor, fontWeight: 600 }}>Öffentlich</span>}
              </div>
            </>
          )}
        </div>

        <div data-menu-root style={{ position: "relative", flexShrink: 0 }}>
          <button type="button" aria-label="Aktionen" onClick={() => setOpenMenuId(menuOpen ? null : t.id)}
            style={{ width: 28, height: 28, borderRadius: "50%", border: "none", background: "transparent", color: menuOpen ? themeCfg.uiText : themeCfg.uiSoftText, cursor: "pointer", display: "grid", placeItems: "center", opacity: menuOpen ? 1 : 0.5, transition: "opacity 150ms ease" }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="2.5" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="8" cy="13.5" r="1.5" /></svg>
          </button>
          {menuOpen && (
            <div style={menuDropdownStyle(isDark, themeCfg)}>
              {menuItems.map(({ label, action }) => (
                <button key={label} type="button" onClick={() => { action(); setOpenMenuId(null); }} style={menuItemStyle(themeCfg.uiText, themeCfg.cardBorder)}>{label}</button>
              ))}
              <button type="button" onClick={() => { void deleteTrack(t); setOpenMenuId(null); }} style={menuItemStyle("#ef4444", "transparent")}>Löschen</button>
            </div>
          )}
        </div>
      </li>
    );
  };

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
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
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

        {/* View toggle — Zuletzt erstellt / Playlists */}
        <div style={{ display: "flex", marginBottom: 20, borderBottom: `1px solid ${glassCardBorder}` }}>
          {(["recent", "playlists"] as LibraryView[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setLibraryView(v)}
              style={{
                padding: "8px 0",
                marginRight: 24,
                marginBottom: -1,
                background: "transparent",
                border: "none",
                borderBottom: `2px solid ${libraryView === v ? themeCfg.uiText : "transparent"}`,
                color: libraryView === v ? themeCfg.uiText : themeCfg.uiSoftText,
                fontWeight: libraryView === v ? 700 : 600,
                fontSize: "0.875rem",
                cursor: "pointer",
                transition: "color 150ms ease, border-color 150ms ease",
              }}
            >
              {v === "recent" ? "Zuletzt erstellt" : "Playlists"}
            </button>
          ))}
        </div>

        {/* ── Recent view ──────────────────────────────────────────────── */}
        {libraryView === "recent" && (<>

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
                  { label: "Zur Warteschlange hinzufügen", action: () => void handleAddToQueue(t) },
                  { label: "Zu Playlist hinzufügen", action: () => setAddToPlaylistTrack(t) },
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

          </>
        )}

        </>)}

        {/* ── Playlists view ────────────────────────────────────────────────── */}
        {libraryView === "playlists" && (
          <div>
            <style>{`.sv-pl-row:hover { background: ${isDark ? "rgba(255,255,255,0.045)" : "rgba(0,0,0,0.035)"}; }`}</style>

            {loading ? (
              <p style={{ color: themeCfg.uiSoftText, padding: "20px 0" }}>Lade…</p>
            ) : (
              <>
                {/* ── Fixed tile grid — all core presets always visible ── */}
                {(() => {
                  const openAutoIdx = playlistGroups.findIndex(g => g.slug === openPlaylistSlug);
                  return (
                  <ul style={{ listStyle: "none", margin: "0 0 14px", padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
                  {playlistGroups.map((group, groupIdx) => {
                    const isOpen = openPlaylistSlug === group.slug;
                    const isEmpty = group.tracks.length === 0;
                    const autoCover = AUTO_PLAYLIST_COVERS[group.slug] ?? null;
                    const isPassive = !isOpen && !!(openPlaylistSlug || openManualPlaylistId);
                    // Persistent open-state offset: while a playlist is open all other tiles
                    // sit slightly lower. Tiles before shift 5px; tiles after shift 8px.
                    // The CSS transition animates this in/out as playlists open and close.
                    const autoTileOffset = (openAutoIdx >= 0 && !isOpen) ? (groupIdx < openAutoIdx ? 5 : 8) : 0;
                    const tileBg = autoCover
                      ? `linear-gradient(to top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.06) 50%, transparent 100%), ${autoCover.gradient}`
                      : glassCardBg;
                    const tileFg = autoCover ? autoCover.fg : themeCfg.uiText;
                    const tileSoftFg = autoCover ? autoCover.softFg : themeCfg.uiSoftText;
                    const tileBorder = isOpen
                      ? (autoCover ? autoCover.accent : `${themeCfg.uiText}44`)
                      : autoCover ? "rgba(255,255,255,0.12)" : glassCardBorder;
                    return (
                      <li
                        key={`auto-${group.slug}`}
                        className="sv-pl-auto-tile"
                        style={{
                          aspectRatio: "1 / 0.88",
                          opacity: isEmpty ? 0.55 : isPassive ? 0.6 : 1,
                          transform: `translateY(${autoTileOffset}px)`,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => { setOpenPlaylistSlug(isOpen ? null : group.slug); setOpenManualPlaylistId(null); }}
                          style={{
                            width: "100%",
                            height: "100%",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-start",
                            padding: "18px 16px 14px",
                            borderRadius: 16,
                            background: tileBg,
                            backdropFilter: autoCover ? "none" : "blur(18px)",
                            WebkitBackdropFilter: autoCover ? "none" : "blur(18px)",
                            border: `1px solid ${tileBorder}`,
                            cursor: "pointer",
                            textAlign: "left",
                            transition: "border-color 200ms ease, box-shadow 200ms ease",
                            boxShadow: isOpen && autoCover ? `0 0 0 1px ${autoCover.accent}44, 0 6px 24px rgba(0,0,0,0.22)` : "none",
                          }}
                        >
                          <span style={{ color: tileSoftFg, display: "flex", marginBottom: 12 }}>
                            <PlaylistIcon slug={group.slug} size={20} />
                          </span>
                          <span style={{ fontWeight: 700, fontSize: "0.875rem", color: tileFg, lineHeight: 1.3, marginBottom: 4, textShadow: autoCover ? "0 1px 3px rgba(0,0,0,0.5)" : "none" }}>
                            {group.label}
                          </span>
                          <span style={{ fontSize: "0.74rem", color: tileSoftFg, fontWeight: 500, marginTop: "auto" }}>
                            {isEmpty ? "Leer" : `${group.tracks.length} ${group.tracks.length === 1 ? "Titel" : "Titel"}`}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                  </ul>
                  );
                })()}

                {/* ── Opened playlist content panel ── */}
                {openPlaylistSlug && (() => {
                  const group = playlistGroups.find((g) => g.slug === openPlaylistSlug);
                  if (!group) return null;
                  const autoCover = AUTO_PLAYLIST_COVERS[group.slug] ?? null;
                  const panelDivider = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";
                  return (
                    <div className="sv-pl-panel-wrap">
                      <div className="sv-pl-panel-inner">
                    <div className="sv-pl-panel" style={{ border: `1px solid ${autoCover ? autoCover.accent + "44" : glassCardBorder}`, borderRadius: 12, boxShadow: autoCover ? `0 0 0 1px ${autoCover.accent}18` : undefined }}>

                      {/* Panel header: icon + label + count + list/grid toggle + close */}
                      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: `1px solid ${panelDivider}` }}>
                        <span style={{ color: themeCfg.uiSoftText, display: "flex", alignItems: "center", flexShrink: 0 }}>
                          <PlaylistIcon slug={group.slug} />
                        </span>
                        <span style={{ fontWeight: 700, fontSize: "0.88rem", color: themeCfg.uiText, flex: "1 1 0", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {group.label}
                        </span>
                        <span style={{ fontSize: "0.75rem", color: themeCfg.uiSoftText, fontWeight: 500, flexShrink: 0 }}>
                          {group.tracks.length > 0 ? `${group.tracks.length} Titel` : ""}
                        </span>

                        {/* Play playlist — only when content exists */}
                        {group.tracks.length > 0 && (
                          <button
                            type="button"
                            onClick={() => void handlePlayPlaylist(group)}
                            title="Playlist abspielen"
                            aria-label="Playlist abspielen"
                            style={{ flexShrink: 0, padding: "0 10px", height: 28, borderRadius: 999, border: `1px solid ${themeCfg.secondaryButtonBorder}`, background: themeCfg.secondaryButtonBg, color: themeCfg.secondaryButtonText, fontSize: "0.74rem", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}
                          >
                            <svg width="8" height="8" viewBox="0 0 11 11" fill="currentColor" aria-hidden="true"><path d="M2.5 1.8l7 3.7-7 3.7z" /></svg>
                            Abspielen
                          </button>
                        )}

                        {/* List/grid toggle — only shown when content exists */}
                        {group.tracks.length > 0 && (
                          <div style={{ display: "flex", border: `1px solid ${themeCfg.secondaryButtonBorder}`, borderRadius: 999, overflow: "hidden", flexShrink: 0 }}>
                            {(["list", "grid"] as ViewMode[]).map((mode) => (
                              <button
                                key={mode}
                                type="button"
                                onClick={() => setViewMode(mode)}
                                aria-label={mode === "list" ? "Listenansicht" : "Rasteransicht"}
                                style={{ width: 30, height: 30, border: "none", background: viewMode === mode ? themeCfg.primaryButtonBg : "transparent", color: viewMode === mode ? themeCfg.primaryButtonText : themeCfg.uiSoftText, cursor: "pointer", display: "grid", placeItems: "center", transition: "background 150ms ease, color 150ms ease" }}
                              >
                                {mode === "list" ? (
                                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                                    <rect x="0" y="1" width="16" height="2.5" rx="1.25" />
                                    <rect x="0" y="6.75" width="16" height="2.5" rx="1.25" />
                                    <rect x="0" y="12.5" width="16" height="2.5" rx="1.25" />
                                  </svg>
                                ) : (
                                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                                    <rect x="0" y="0" width="6.5" height="6.5" rx="1.5" />
                                    <rect x="9.5" y="0" width="6.5" height="6.5" rx="1.5" />
                                    <rect x="0" y="9.5" width="6.5" height="6.5" rx="1.5" />
                                    <rect x="9.5" y="9.5" width="6.5" height="6.5" rx="1.5" />
                                  </svg>
                                )}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Close */}
                        <button
                          type="button"
                          onClick={() => setOpenPlaylistSlug(null)}
                          aria-label="Schließen"
                          style={{ flexShrink: 0, width: 26, height: 26, borderRadius: "50%", border: `1px solid ${glassCardBorder}`, background: "transparent", color: themeCfg.uiSoftText, cursor: "pointer", display: "grid", placeItems: "center" }}
                        >
                          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                            <path d="M2 2l8 8M10 2l-8 8" />
                          </svg>
                        </button>
                      </div>

                      {/* Panel content */}
                      {group.tracks.length === 0 ? (
                        /* Empty state */
                        <div style={{ padding: "28px 16px 24px", textAlign: "center" }}>
                          <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: "0.9rem", color: themeCfg.uiText }}>
                            Noch nichts hier.
                          </p>
                          <p style={{ margin: "0 0 16px", fontSize: "0.82rem", color: themeCfg.uiSoftText }}>
                            Generiere deine erste {group.label}.
                          </p>
                          <Link
                            href={`/generate${group.slug !== "__other__" ? `?preset=${group.slug}` : ""}`}
                            style={{ display: "inline-block", fontWeight: 700, fontSize: "0.83rem", textDecoration: "none", padding: "8px 18px", borderRadius: 999, background: themeCfg.primaryButtonBg, color: themeCfg.primaryButtonText }}
                          >
                            Jetzt erstellen
                          </Link>
                        </div>
                      ) : viewMode === "grid" ? (
                        /* Compact grid tiles */
                        <div style={{ padding: "12px 12px 10px" }}>
                          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
                            {group.tracks.map((t) => {
                              const menuOpen = openMenuId === t.id;
                              const isStoryItem = !!t.storyId;
                              const chapterCount = isStoryItem ? (storyChapterCounts[t.storyId!] ?? 1) : null;
                              const displayTitle = isStoryItem ? getStoryTitle(t) : getEffectiveTitle(t);
                              const active = isTrackActive(t);
                              const playing = isTrackPlaying(t);
                              const dur = getDurSeconds(t);
                              const durLabel = Number.isFinite(dur) ? formatDuration(dur) : "";
                              const menuItems = [
                                { label: "Umbenennen", action: () => beginEdit(t) },
                                { label: "Zur Warteschlange hinzufügen", action: () => void handleAddToQueue(t) },
                                { label: "Zu Playlist hinzufügen", action: () => setAddToPlaylistTrack(t) },
                                { label: t.isPublic ? "Freigabe entfernen" : "Öffentlich teilen", action: () => void toggleShare(t) },
                                { label: "Link kopieren", action: () => void copyLink(t) },
                                { label: "Download", action: () => void handleDownload(t) },
                                ...(t.storyId ? [{ label: "Story Player öffnen", action: () => router.push(`/s/${t.storyId}`) }] : [{ label: "Track Player öffnen", action: () => router.push(`/t/${t.id}`) }]),
                                { label: "Details", action: () => setDetailTrack(t) },
                              ];
                              return (
                                <li key={t.id} style={{ position: "relative", zIndex: menuOpen ? 100 : undefined, background: glassCardBg, backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)", border: `1px solid ${active ? activeBorderColor : glassCardBorder}`, borderRadius: 12, padding: "11px 12px 10px", display: "flex", flexDirection: "column", transition: "border-color 200ms ease", minHeight: 100 }}>
                                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                                    <div data-menu-root style={{ position: "relative" }}>
                                      <button type="button" aria-label="Aktionen" onClick={() => setOpenMenuId(menuOpen ? null : t.id)} style={{ width: 26, height: 26, borderRadius: "50%", border: "none", background: "transparent", color: menuOpen ? themeCfg.uiText : themeCfg.uiSoftText, cursor: "pointer", display: "grid", placeItems: "center", opacity: menuOpen ? 1 : 0.55, transition: "opacity 150ms ease" }}>
                                        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="2.5" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="8" cy="13.5" r="1.5" /></svg>
                                      </button>
                                      {menuOpen && (
                                        <div style={menuDropdownStyle(isDark, themeCfg)}>
                                          {menuItems.map(({ label, action }) => <button key={label} type="button" onClick={() => { action(); setOpenMenuId(null); }} style={menuItemStyle(themeCfg.uiText, themeCfg.cardBorder)}>{label}</button>)}
                                          <button type="button" onClick={() => { void deleteTrack(t); setOpenMenuId(null); }} style={menuItemStyle("#ef4444", "transparent")}>Löschen</button>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  <button type="button" onClick={() => setDetailTrack(t)} style={{ appearance: "none", background: "transparent", border: "none", padding: 0, cursor: "pointer", fontWeight: 700, fontSize: "0.875rem", color: themeCfg.uiText, textAlign: "left", width: "100%", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.35, marginBottom: 10, flexGrow: 1 }}>
                                    {displayTitle}
                                  </button>
                                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                                    <div style={{ fontSize: "0.7rem", color: themeCfg.uiSoftText, display: "flex", gap: 4, alignItems: "center" }}>
                                      {durLabel && <span>{durLabel}</span>}
                                      {isStoryItem && chapterCount && chapterCount > 1 && <span style={{ padding: "0 5px", borderRadius: 999, background: themeCfg.secondaryButtonBg, border: `1px solid ${themeCfg.secondaryButtonBorder}`, fontSize: "0.67rem", fontWeight: 700 }}>{chapterCount} Kap.</span>}
                                      {t.isPublic && <span style={{ color: themeCfg.progressColor, fontWeight: 600 }}>Öffentlich</span>}
                                    </div>
                                    <button type="button" onClick={() => void handlePlayFromPlaylist(t, group)} aria-label={playing ? "Pause" : "Abspielen"} style={{ width: 32, height: 32, borderRadius: "50%", border: "none", background: themeCfg.primaryButtonBg, color: themeCfg.primaryButtonText, display: "grid", placeItems: "center", cursor: "pointer", flexShrink: 0, boxShadow: active ? "0 4px 14px rgba(0,0,0,0.22)" : "0 2px 8px rgba(0,0,0,0.1)", transition: "box-shadow 200ms ease" }}>
                                      {playing ? <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><rect x="1.5" y="1" width="3.5" height="10" rx="1" /><rect x="7" y="1" width="3.5" height="10" rx="1" /></svg> : <svg width="10" height="10" viewBox="0 0 11 11" fill="currentColor"><path d="M2.5 1.8l7 3.7-7 3.7z" /></svg>}
                                    </button>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ) : (
                        /* Cardless list rows */
                        <ul style={{ listStyle: "none", margin: 0, padding: "2px 0 2px" }}>
                          {group.tracks.map((t, idx) => renderPlaylistTrackRow(t, idx, group.tracks.length, group))}
                        </ul>
                      )}
                    </div>
                      </div>
                    </div>
                  );
                })()}

              </>
            )}

            {/* ── Meine Playlists section ─────────────────────────────────── */}
            {libraryView === "playlists" && (
              <div style={{ marginTop: 28 }}>
                {/* Section header */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                  <span style={{ flex: 1, fontWeight: 700, fontSize: "0.875rem", color: themeCfg.uiText }}>
                    Meine Playlists
                  </span>
                  <button
                    type="button"
                    onClick={() => { setShowCreatePlaylist(true); setNewPlaylistName(""); }}
                    style={{ padding: "5px 14px", borderRadius: 999, border: `1px solid ${themeCfg.secondaryButtonBorder}`, background: themeCfg.secondaryButtonBg, color: themeCfg.secondaryButtonText, fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
                  >
                    + Erstellen
                  </button>
                </div>

                {/* Empty state */}
                {manualPlaylistsLoaded && manualPlaylists.length === 0 && (
                  <div style={{ textAlign: "center", padding: "32px 16px", border: `1px dashed ${glassCardBorder}`, borderRadius: 14 }}>
                    <div style={{ fontSize: "1.5rem", marginBottom: 8, opacity: 0.35 }}>♪</div>
                    <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: "0.9rem", color: themeCfg.uiText }}>Noch keine Playlists</p>
                    <p style={{ margin: 0, fontSize: "0.82rem", color: themeCfg.uiSoftText }}>Erstelle deine erste Playlist und füge Inhalte hinzu.</p>
                  </div>
                )}

                {/* Playlist tiles */}
                {sortedManualPlaylists.length > 0 && (
                  <ul style={{ listStyle: "none", margin: "0 0 14px", padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
                    {(() => {
                      const openManualIdx = sortedManualPlaylists.findIndex(p => p.id === openManualPlaylistId);
                      return sortedManualPlaylists.map((pl, plIdx) => {
                      const isOpen = openManualPlaylistId === pl.id;
                      const isRenaming = renamingPlaylistId === pl.id;
                      const isDragOver = dragOverPlId === pl.id && draggedPlId !== pl.id;
                      const cover = getPlaylistCover(pl.coverKey);
                      const accent = cover?.accent ?? null;
                      // Persistent open-state offset: non-open tiles shift down while a playlist
                      // is open — before-tiles 5px, after-tiles 8px. CSS transition animates both
                      // into and out of this state as playlists open and close.
                      const isPassive = !isOpen && !!(openManualPlaylistId || openPlaylistSlug);
                      const manualTileOffset = (openManualIdx >= 0 && !isOpen) ? (plIdx < openManualIdx ? 5 : 8) : 0;
                      // When a cover is set, a multi-layer background provides the gradient + dark
                      // bottom scrim for text legibility — no extra DOM node needed.
                      const tileBg = cover
                        ? `linear-gradient(to top, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.08) 55%, transparent 100%), ${cover.gradient}`
                        : glassCardBg;
                      const tileFg = cover ? "rgba(255,255,255,0.95)" : themeCfg.uiText;
                      const tileSoftFg = cover ? "rgba(255,255,255,0.6)" : themeCfg.uiSoftText;
                      const tileBorder = isDragOver
                        ? `${cover ? "rgba(255,255,255,0.6)" : themeCfg.uiText}55`
                        : isOpen
                        ? (accent ? accent : cover ? "rgba(255,255,255,0.75)" : themeCfg.uiText)
                        : cover ? "rgba(255,255,255,0.12)" : glassCardBorder;
                      return (
                        <li
                          key={pl.id}
                          className="sv-pl-tile"
                          style={{ position: "relative", aspectRatio: "1 / 0.88", opacity: draggedPlId === pl.id ? 0.45 : (isPassive ? 0.6 : 1), transform: `translateY(${manualTileOffset}px)` }}
                          draggable
                          onDragStart={() => setDraggedPlId(pl.id)}
                          onDragEnd={() => { setDraggedPlId(null); setDragOverPlId(null); }}
                          onDragOver={(e) => { e.preventDefault(); setDragOverPlId(pl.id); }}
                          onDragLeave={() => { if (dragOverPlId === pl.id) setDragOverPlId(null); }}
                          onDrop={(e) => { e.preventDefault(); if (draggedPlId) handlePlaylistDrop(draggedPlId, pl.id); setDraggedPlId(null); setDragOverPlId(null); }}
                        >
                          <button
                            type="button"
                            onClick={() => { setOpenManualPlaylistId(isOpen ? null : pl.id); setOpenPlaylistSlug(null); }}
                            style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "flex-start", padding: "18px 16px 14px", borderRadius: 16, background: tileBg, backdropFilter: cover ? "none" : "blur(18px)", WebkitBackdropFilter: cover ? "none" : "blur(18px)", border: `1px solid ${tileBorder}`, cursor: "grab", textAlign: "left", transition: "border-color 180ms ease, box-shadow 180ms ease", boxShadow: isDragOver ? `0 0 0 2px ${themeCfg.primaryButtonBg}44` : isOpen ? (accent ? `0 0 0 1px ${accent}55, 0 6px 24px rgba(0,0,0,0.18)` : `0 6px 24px rgba(0,0,0,0.14)`) : "none" }}
                          >
                            <span style={{ color: tileSoftFg, display: "flex", marginBottom: 12, opacity: pl.pinned ? 0.8 : 0.7 }}>
                              {pl.pinned ? (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                  <path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"/>
                                </svg>
                              ) : (
                                <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                  <rect x="0" y="2" width="20" height="3" rx="1.5" />
                                  <rect x="0" y="8.5" width="20" height="3" rx="1.5" />
                                  <rect x="0" y="15" width="13" height="3" rx="1.5" />
                                </svg>
                              )}
                            </span>
                            <span style={{ fontWeight: 700, fontSize: "0.875rem", color: tileFg, lineHeight: 1.3, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%", textShadow: cover ? "0 1px 3px rgba(0,0,0,0.5)" : "none" }}>
                              {pl.name}
                            </span>
                            <span style={{ fontSize: "0.74rem", color: tileSoftFg, fontWeight: 500, marginTop: "auto" }}>
                              {pl.itemCount === 0 ? "Leer" : `${pl.itemCount} Titel`}
                            </span>
                          </button>

                          {/* Actions menu */}
                          <div data-menu-root style={{ position: "absolute", top: 8, right: 8 }}>
                            <button
                              type="button"
                              aria-label="Playlist-Aktionen"
                              onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === `pl-${pl.id}` ? null : `pl-${pl.id}`); }}
                              style={{ width: 26, height: 26, borderRadius: "50%", border: "none", background: cover ? "rgba(0,0,0,0.45)" : isDark ? "rgba(0,0,0,0.38)" : "rgba(255,255,255,0.55)", color: cover ? "rgba(255,255,255,0.8)" : themeCfg.uiSoftText, cursor: "pointer", display: "grid", placeItems: "center", boxShadow: openMenuId === `pl-${pl.id}` && accent ? `0 0 0 2px ${accent}66` : "none", transition: "box-shadow 120ms ease" }}
                            >
                              <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="2.5" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="8" cy="13.5" r="1.5" /></svg>
                            </button>
                            {openMenuId === `pl-${pl.id}` && (
                              <div style={playlistMenuDropdownStyle(isDark, themeCfg, accent)}>
                                <button type="button" onClick={() => { setCoverPickerPlaylistId(pl.id); setOpenMenuId(null); }} style={menuItemStyle(themeCfg.uiText, themeCfg.cardBorder)}>Cover ändern</button>
                                <button type="button" onClick={() => { void togglePin(pl.id); setOpenMenuId(null); }} style={menuItemStyle(themeCfg.uiText, themeCfg.cardBorder)}>{pl.pinned ? "Lösen" : "Anpinnen"}</button>
                                <button type="button" onClick={() => { setRenamingPlaylistId(pl.id); setRenamingPlaylistValue(pl.name); setOpenMenuId(null); }} style={menuItemStyle(themeCfg.uiText, themeCfg.cardBorder)}>Umbenennen</button>
                                <button type="button" onClick={() => { void deletePlaylist(pl.id); setOpenMenuId(null); }} style={menuItemStyle("#ef4444", "transparent")}>Löschen</button>
                              </div>
                            )}
                          </div>

                          {/* Inline rename form */}
                          {isRenaming && (
                            <div
                              style={{ position: "absolute", inset: 0, borderRadius: 16, background: isDark ? "rgba(15,23,42,0.95)" : "rgba(255,255,255,0.95)", display: "flex", flexDirection: "column", gap: 8, padding: 14, zIndex: 10 }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                autoFocus
                                value={renamingPlaylistValue}
                                onChange={(e) => setRenamingPlaylistValue(e.target.value)}
                                onKeyDown={async (e) => {
                                  if (e.key === "Enter") { e.preventDefault(); await renamePlaylist(pl.id, renamingPlaylistValue.trim()); setRenamingPlaylistId(null); }
                                  if (e.key === "Escape") { setRenamingPlaylistId(null); }
                                }}
                                style={{ ...inputStyle, fontSize: "0.85rem", ...(accent ? { borderColor: `${accent}88` } : {}) }}
                                placeholder="Playlist-Name…"
                              />
                              <div style={{ display: "flex", gap: 6 }}>
                                <button type="button" onClick={async () => { await renamePlaylist(pl.id, renamingPlaylistValue.trim()); setRenamingPlaylistId(null); }} style={{ flex: 1, padding: "7px 0", borderRadius: 999, border: "none", background: themeCfg.primaryButtonBg, color: themeCfg.primaryButtonText, fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", boxShadow: accent ? `0 0 0 2px ${accent}66` : "none" }}>Speichern</button>
                                <button type="button" onClick={() => setRenamingPlaylistId(null)} style={{ flex: 1, padding: "7px 0", borderRadius: 999, border: `1px solid ${themeCfg.secondaryButtonBorder}`, background: "transparent", color: themeCfg.uiSoftText, fontWeight: 600, fontSize: "0.8rem", cursor: "pointer" }}>Abbrechen</button>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    });
                    })()}
                  </ul>
                )}

                {/* Opened manual playlist panel */}
                {openManualPlaylistId && (() => {
                  const pl = manualPlaylists.find((p) => p.id === openManualPlaylistId);
                  if (!pl) return null;
                  const panelAccent = getPlaylistCover(pl.coverKey)?.accent ?? null;
                  const panelDivider = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";
                  return (
                    <div className="sv-pl-panel-wrap">
                      <div className="sv-pl-panel-inner">
                    <div className="sv-pl-panel" style={{ border: `1px solid ${panelAccent ? panelAccent + "44" : glassCardBorder}`, borderRadius: 12, marginTop: 4, boxShadow: panelAccent ? `0 0 0 1px ${panelAccent}18` : undefined }}>
                      {/* Panel header */}
                      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: `1px solid ${panelDivider}` }}>
                        <span style={{ color: themeCfg.uiSoftText, display: "flex", alignItems: "center", flexShrink: 0 }}>
                          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><rect x="0" y="2" width="20" height="3" rx="1.5" /><rect x="0" y="8.5" width="20" height="3" rx="1.5" /><rect x="0" y="15" width="13" height="3" rx="1.5" /></svg>
                        </span>
                        <span style={{ fontWeight: 700, fontSize: "0.88rem", color: themeCfg.uiText, flex: "1 1 0", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {pl.name}
                        </span>
                        {manualPlaylistItems.length > 0 && (
                          <span style={{ fontSize: "0.75rem", color: themeCfg.uiSoftText, fontWeight: 500, flexShrink: 0 }}>
                            {manualPlaylistItems.length} Titel
                          </span>
                        )}
                        {manualPlaylistItems.length > 0 && (
                          <button
                            type="button"
                            onClick={() => void handlePlayManualPlaylist(manualPlaylistItems)}
                            title="Playlist abspielen"
                            style={{ flexShrink: 0, padding: "0 10px", height: 28, borderRadius: 999, border: `1px solid ${themeCfg.secondaryButtonBorder}`, background: themeCfg.secondaryButtonBg, color: themeCfg.secondaryButtonText, fontSize: "0.74rem", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}
                          >
                            <svg width="8" height="8" viewBox="0 0 11 11" fill="currentColor" aria-hidden="true"><path d="M2.5 1.8l7 3.7-7 3.7z" /></svg>
                            Abspielen
                          </button>
                        )}
                        <button type="button" onClick={() => setOpenManualPlaylistId(null)} aria-label="Schließen" style={{ flexShrink: 0, width: 26, height: 26, borderRadius: "50%", border: `1px solid ${glassCardBorder}`, background: "transparent", color: themeCfg.uiSoftText, cursor: "pointer", display: "grid", placeItems: "center" }}>
                          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M2 2l8 8M10 2l-8 8" /></svg>
                        </button>
                      </div>

                      {/* Panel content */}
                      {manualPlaylistItemsLoading ? (
                        <div style={{ padding: "24px 16px", textAlign: "center", fontSize: "0.85rem", color: themeCfg.uiSoftText }}>Lade…</div>
                      ) : manualPlaylistItems.length === 0 ? (
                        <div style={{ padding: "28px 16px 24px", textAlign: "center" }}>
                          <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: "0.9rem", color: themeCfg.uiText }}>Noch keine Einträge</p>
                          <p style={{ margin: 0, fontSize: "0.82rem", color: themeCfg.uiSoftText }}>Füge Titel über das Aktionsmenü hinzu.</p>
                        </div>
                      ) : (
                        <ul style={{ listStyle: "none", margin: 0, padding: "2px 0 2px" }}>
                          {manualPlaylistItems.map((item, idx) => {
                            const t = item.track;
                            const isStoryItem = !!t.storyId;
                            const displayTitle = isStoryItem ? getStoryTitle(t) : getEffectiveTitle(t);
                            const active = isTrackActive(t);
                            const playing = isTrackPlaying(t);
                            const dur = t.durationSeconds ?? null;
                            const durLabel = Number.isFinite(dur ?? NaN) ? formatDuration(dur) : "";
                            const isLast = idx === manualPlaylistItems.length - 1;
                            const itemMenuId = `mpl-${item.id}`;
                            return (
                              <li
                                key={item.id}
                                className="sv-pl-row"
                                style={{ position: "relative", zIndex: openMenuId === itemMenuId ? 100 : undefined, display: "flex", alignItems: "center", gap: 12, padding: "9px 16px", background: active ? (isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)") : "transparent", borderRadius: isLast ? "0 0 12px 12px" : 0, transition: "background 100ms ease" }}
                              >
                                {/* Play */}
                                <button type="button" onClick={() => void handlePlayManualPlaylist(manualPlaylistItems, idx)} aria-label={playing ? "Pause" : "Abspielen"}
                                  style={{ flexShrink: 0, width: 32, height: 32, borderRadius: "50%", border: "none", background: active ? themeCfg.primaryButtonBg : (isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)"), color: active ? themeCfg.primaryButtonText : themeCfg.uiText, display: "grid", placeItems: "center", cursor: "pointer", transition: "background 150ms ease" }}>
                                  {playing ? <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><rect x="1.5" y="1" width="3.5" height="10" rx="1" /><rect x="7" y="1" width="3.5" height="10" rx="1" /></svg> : <svg width="10" height="10" viewBox="0 0 11 11" fill="currentColor"><path d="M2.5 1.8l7 3.7-7 3.7z" /></svg>}
                                </button>

                                {/* Title + meta */}
                                <div style={{ flex: "1 1 0", minWidth: 0 }}>
                                  <div style={{ fontWeight: 700, fontSize: "0.88rem", color: themeCfg.uiText, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayTitle}</div>
                                  <div style={{ fontSize: "0.72rem", color: themeCfg.uiSoftText, marginTop: 2, display: "flex", gap: 6, alignItems: "center" }}>
                                    {durLabel && <span>{durLabel}</span>}
                                    {isStoryItem && <span style={{ padding: "0 5px", borderRadius: 999, background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", border: `1px solid ${glassCardBorder}`, fontSize: "0.67rem", fontWeight: 700 }}>Story</span>}
                                  </div>
                                </div>

                                {/* ⋮ actions */}
                                <div data-menu-root style={{ position: "relative", flexShrink: 0 }}>
                                  <button type="button" aria-label="Aktionen" onClick={() => setOpenMenuId(openMenuId === itemMenuId ? null : itemMenuId)} style={{ width: 28, height: 28, borderRadius: "50%", border: "none", background: "transparent", color: openMenuId === itemMenuId ? themeCfg.uiText : themeCfg.uiSoftText, cursor: "pointer", display: "grid", placeItems: "center", opacity: openMenuId === itemMenuId ? 1 : 0.55 }}>
                                    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="2.5" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="8" cy="13.5" r="1.5" /></svg>
                                  </button>
                                  {openMenuId === itemMenuId && (
                                    <div style={menuDropdownStyle(isDark, themeCfg)}>
                                      <button type="button" onClick={() => { void handlePlayManualPlaylist(manualPlaylistItems, idx); setOpenMenuId(null); }} style={menuItemStyle(themeCfg.uiText, themeCfg.cardBorder)}>Abspielen</button>
                                      <button type="button" onClick={() => { void handleAddToQueue(t); setOpenMenuId(null); }} style={menuItemStyle(themeCfg.uiText, themeCfg.cardBorder)}>Zur Warteschlange hinzufügen</button>
                                      {t.storyId
                                        ? <button type="button" onClick={() => { router.push(`/s/${t.storyId}`); setOpenMenuId(null); }} style={menuItemStyle(themeCfg.uiText, themeCfg.cardBorder)}>Story Player öffnen</button>
                                        : <button type="button" onClick={() => { router.push(`/t/${t.id}`); setOpenMenuId(null); }} style={menuItemStyle(themeCfg.uiText, themeCfg.cardBorder)}>Track Player öffnen</button>
                                      }
                                      <button type="button" onClick={() => { void removeFromPlaylist(pl.id, item.id); setOpenMenuId(null); }} style={menuItemStyle("#ef4444", "transparent")}>Aus Playlist entfernen</button>
                                    </div>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
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

            {/* Script — loaded lazily from detail endpoint when modal opens */}
            {detailScriptText && (
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
                  {detailScriptText}
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

      {/* ── Cover picker modal ───────────────────────────────────────────── */}
      {coverPickerPlaylistId && (() => {
        const targetPl = manualPlaylists.find((p) => p.id === coverPickerPlaylistId);
        if (!targetPl) return null;
        const coverAccent = getPlaylistCover(targetPl.coverKey)?.accent ?? null;
        return (
          <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 500 }} onClick={() => setCoverPickerPlaylistId(null)}>
            <div style={{ maxWidth: 400, width: "100%", background: isDark ? "rgba(15,23,42,0.97)" : "rgba(255,255,255,0.97)", color: themeCfg.uiText, borderRadius: 20, border: `1px solid ${coverAccent ? coverAccent + "44" : themeCfg.cardBorder}`, boxShadow: coverAccent ? `${themeCfg.cardShadow}, 0 0 0 1px ${coverAccent}22` : themeCfg.cardShadow, padding: 24, backdropFilter: "blur(24px)" }} onClick={(e) => e.stopPropagation()}>

              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: "0.95rem", color: themeCfg.uiText }}>Cover wählen</div>
                  <div style={{ fontSize: "0.75rem", color: themeCfg.uiSoftText, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>{targetPl.name}</div>
                </div>
                <button type="button" onClick={() => setCoverPickerPlaylistId(null)} aria-label="Schließen" style={{ width: 28, height: 28, borderRadius: "50%", border: `1px solid ${themeCfg.cardBorder}`, background: "transparent", color: themeCfg.uiSoftText, cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0 }}>
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M2 2l8 8M10 2l-8 8" /></svg>
                </button>
              </div>

              {/* Cover grid — 3 columns */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                {PLAYLIST_COVERS.map((preset) => {
                  const isSelected = targetPl.coverKey === preset.key;
                  return (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => void setCoverForPlaylist(coverPickerPlaylistId, preset.key)}
                      style={{ padding: 0, border: `2px solid ${isSelected ? (coverAccent || themeCfg.primaryButtonBg) : "transparent"}`, borderRadius: 12, cursor: "pointer", background: "transparent", display: "flex", flexDirection: "column", alignItems: "stretch", gap: 0, overflow: "hidden", transition: "border-color 120ms ease", boxShadow: isSelected ? `0 0 0 2px ${(coverAccent || themeCfg.primaryButtonBg)}33` : "none" }}
                    >
                      <div style={{ height: 56, background: preset.gradient, borderRadius: isSelected ? "10px 10px 0 0" : "10px 10px 0 0" }} />
                      <div style={{ padding: "5px 4px 6px", fontSize: "0.67rem", fontWeight: isSelected ? 700 : 500, color: isSelected ? themeCfg.primaryButtonBg : themeCfg.uiSoftText, textAlign: "center", background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)", borderTop: `1px solid ${isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}`, lineHeight: 1 }}>
                        {preset.label}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Remove cover option */}
              {targetPl.coverKey && (
                <button
                  type="button"
                  onClick={() => void setCoverForPlaylist(coverPickerPlaylistId, null)}
                  style={{ marginTop: 14, width: "100%", padding: "8px 0", borderRadius: 999, border: `1px solid ${themeCfg.cardBorder}`, background: "transparent", color: themeCfg.uiSoftText, fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" }}
                >
                  Kein Cover
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Create playlist modal ─────────────────────────────────────────── */}
      {showCreatePlaylist && (
        <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 500 }} onClick={() => setShowCreatePlaylist(false)}>
          <div style={{ maxWidth: 380, width: "100%", background: isDark ? "rgba(15,23,42,0.97)" : "rgba(255,255,255,0.97)", color: themeCfg.uiText, borderRadius: 20, border: `1px solid ${themeCfg.cardBorder}`, boxShadow: themeCfg.cardShadow, padding: 24, backdropFilter: "blur(24px)" }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: "0 0 16px", fontSize: "1rem", fontWeight: 800 }}>Neue Playlist</h2>
            <input
              autoFocus
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const name = newPlaylistName.trim();
                  if (!name) return;
                  const pl = await createPlaylist(name);
                  if (pl) { showToast("Playlist erstellt."); setShowCreatePlaylist(false); setNewPlaylistName(""); setOpenManualPlaylistId(pl.id); setOpenPlaylistSlug(null); setLibraryView("playlists"); }
                }
                if (e.key === "Escape") setShowCreatePlaylist(false);
              }}
              placeholder="Playlist-Name…"
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginBottom: 14 }}
            />
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" onClick={async () => {
                const name = newPlaylistName.trim();
                if (!name) return;
                const pl = await createPlaylist(name);
                if (pl) { showToast("Playlist erstellt."); setShowCreatePlaylist(false); setNewPlaylistName(""); setOpenManualPlaylistId(pl.id); setOpenPlaylistSlug(null); setLibraryView("playlists"); }
              }} style={{ flex: 1, padding: "11px 0", borderRadius: 999, border: "none", background: themeCfg.primaryButtonBg, color: themeCfg.primaryButtonText, fontWeight: 700, fontSize: "0.875rem", cursor: "pointer" }}>
                Erstellen
              </button>
              <button type="button" onClick={() => setShowCreatePlaylist(false)} style={{ flex: 1, padding: "11px 0", borderRadius: 999, border: `1px solid ${themeCfg.secondaryButtonBorder}`, background: "transparent", color: themeCfg.uiSoftText, fontWeight: 600, fontSize: "0.875rem", cursor: "pointer" }}>
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add-to-playlist picker modal ──────────────────────────────────── */}
      {addToPlaylistTrack && (
        <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 500 }} onClick={() => { setAddToPlaylistTrack(null); setNewPlaylistInPicker(""); }}>
          <div style={{ maxWidth: 380, width: "100%", background: isDark ? "rgba(15,23,42,0.97)" : "rgba(255,255,255,0.97)", color: themeCfg.uiText, borderRadius: 20, border: `1px solid ${themeCfg.cardBorder}`, boxShadow: themeCfg.cardShadow, padding: 24, backdropFilter: "blur(24px)", maxHeight: "70vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ flex: 1, margin: 0, fontSize: "1rem", fontWeight: 800 }}>Zu Playlist hinzufügen</h2>
              <button type="button" onClick={() => { setAddToPlaylistTrack(null); setNewPlaylistInPicker(""); }} style={{ width: 28, height: 28, borderRadius: "50%", border: `1px solid ${themeCfg.cardBorder}`, background: "transparent", color: themeCfg.uiSoftText, cursor: "pointer", display: "grid", placeItems: "center" }}>
                <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M2 2l8 8M10 2l-8 8" /></svg>
              </button>
            </div>

            <p style={{ margin: "0 0 14px", fontSize: "0.82rem", color: themeCfg.uiSoftText, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {addToPlaylistTrack.storyId ? getStoryTitle(addToPlaylistTrack) : getEffectiveTitle(addToPlaylistTrack)}
            </p>

            {/* Playlist list */}
            <div style={{ overflowY: "auto", maxHeight: 260, marginBottom: 14 }}>
              {manualPlaylists.length > 0 ? (
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {manualPlaylists.map((pl) => (
                    <li key={pl.id}>
                      <button
                        type="button"
                        onClick={async () => {
                          await addToPlaylist(pl.id, addToPlaylistTrack.id);
                          setAddToPlaylistTrack(null);
                          setNewPlaylistInPicker("");
                        }}
                        style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 12, padding: "10px 4px", border: "none", borderBottom: `1px solid ${isDark ? "rgba(148,163,184,0.10)" : "rgba(148,163,184,0.18)"}`, background: "transparent", color: themeCfg.uiText, cursor: "pointer", borderRadius: 0 }}
                      >
                        <svg width="14" height="14" viewBox="0 0 20 20" fill={themeCfg.uiSoftText} aria-hidden="true"><rect x="0" y="2" width="20" height="3" rx="1.5" /><rect x="0" y="8.5" width="20" height="3" rx="1.5" /><rect x="0" y="15" width="13" height="3" rx="1.5" /></svg>
                        <span style={{ flex: 1, fontWeight: 600, fontSize: "0.88rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pl.name}</span>
                        <span style={{ fontSize: "0.72rem", color: themeCfg.uiSoftText }}>{pl.itemCount} Titel</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : pickerError ? (
                <p style={{ fontSize: "0.82rem", color: "#ef4444", textAlign: "center", padding: "16px 0" }}>Ladefehler: {pickerError}</p>
              ) : pickerLoading ? (
                <p style={{ fontSize: "0.85rem", color: themeCfg.uiSoftText, textAlign: "center", padding: "16px 0" }}>Lade…</p>
              ) : (
                <p style={{ fontSize: "0.85rem", color: themeCfg.uiSoftText, textAlign: "center", padding: "16px 0" }}>Noch keine Playlists vorhanden.</p>
              )}
            </div>

            {/* Create new playlist inline */}
            <div style={{ borderTop: `1px solid ${isDark ? "rgba(148,163,184,0.12)" : "rgba(148,163,184,0.22)"}`, paddingTop: 14 }}>
              {newPlaylistInPicker === "" ? (
                <button type="button" onClick={() => setNewPlaylistInPicker(" ")} style={{ width: "100%", padding: "10px 0", borderRadius: 999, border: `1px dashed ${themeCfg.secondaryButtonBorder}`, background: "transparent", color: themeCfg.uiSoftText, fontWeight: 600, fontSize: "0.85rem", cursor: "pointer" }}>
                  + Neue Playlist erstellen
                </button>
              ) : (
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    autoFocus
                    value={newPlaylistInPicker.trim() === "" ? "" : newPlaylistInPicker}
                    onChange={(e) => setNewPlaylistInPicker(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const name = newPlaylistInPicker.trim();
                        if (!name) return;
                        const pl = await createPlaylist(name);
                        if (pl) { await addToPlaylist(pl.id, addToPlaylistTrack!.id); setAddToPlaylistTrack(null); setNewPlaylistInPicker(""); }
                      }
                      if (e.key === "Escape") setNewPlaylistInPicker("");
                    }}
                    placeholder="Name der neuen Playlist…"
                    style={{ ...inputStyle, flex: "1 1 auto", minWidth: 0, fontSize: "0.85rem" }}
                  />
                  <button type="button" onClick={async () => {
                    const name = newPlaylistInPicker.trim();
                    if (!name) return;
                    const pl = await createPlaylist(name);
                    if (pl) { await addToPlaylist(pl.id, addToPlaylistTrack!.id); setAddToPlaylistTrack(null); setNewPlaylistInPicker(""); }
                  }} style={{ flexShrink: 0, padding: "0 14px", borderRadius: 999, border: "none", background: themeCfg.primaryButtonBg, color: themeCfg.primaryButtonText, fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}>
                    OK
                  </button>
                </div>
              )}
            </div>
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

// ─── Playlist icon ─────────────────────────────────────────────────────────────

function PlaylistIcon({ slug, size = 15 }: { slug: string; size?: number }) {
  const s = size;
  switch (slug) {
    case "sleep-story":
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <path d="M13.3 10.8A5.5 5.5 0 0 1 5.2 2.7a.45.45 0 0 0-.55-.55A7 7 0 1 0 13.85 11.35a.45.45 0 0 0-.55-.55z" />
        </svg>
      );
    case "kids-story":
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <path d="M8 1.5l1.6 3.25 3.6.52-2.6 2.53.61 3.57L8 9.62l-3.21 1.75.61-3.57-2.6-2.53 3.6-.52z" />
        </svg>
      );
    case "meditation":
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" aria-hidden>
          <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="8" cy="8" r="1.75" fill="currentColor" />
        </svg>
      );
    case "classic-asmr":
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <path d="M8 1l1.1 5.4 5.4 1.1-5.4 1.1L8 14l-1.1-5.4L1.5 7.5l5.4-1.1z" />
        </svg>
      );
    default:
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <rect x="1" y="1" width="5.5" height="5.5" rx="1.5" />
          <rect x="9.5" y="1" width="5.5" height="5.5" rx="1.5" />
          <rect x="1" y="9.5" width="5.5" height="5.5" rx="1.5" />
          <rect x="9.5" y="9.5" width="5.5" height="5.5" rx="1.5" />
        </svg>
      );
  }
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

// Derives a cover-tinted glass dropdown background for manual playlist tile menus.
// When the playlist has a cover accent, the background picks up a very subtle
// version of that hue. Without a cover, falls back to the generic style.
function playlistMenuDropdownStyle(
  isDark: boolean,
  themeCfg: { cardBorder: string; cardShadow: string },
  accent: string | null
): React.CSSProperties {
  if (!accent || !/^#[0-9a-fA-F]{6}$/.test(accent)) {
    return { ...menuDropdownStyle(isDark, themeCfg), minWidth: 160 };
  }
  const r = parseInt(accent.slice(1, 3), 16);
  const g = parseInt(accent.slice(3, 5), 16);
  const b = parseInt(accent.slice(5, 7), 16);
  // Blend accent at ~12-15% into the theme base — vivid enough to feel connected,
  // restrained enough to keep text readable.
  const tr = isDark ? Math.min(255, Math.round(12 + r * 0.14)) : Math.min(255, Math.round(250 - (250 - r) * 0.06));
  const tg = isDark ? Math.min(255, Math.round(18 + g * 0.09)) : Math.min(255, Math.round(250 - (250 - g) * 0.04));
  const tb = isDark ? Math.min(255, Math.round(40 + b * 0.12)) : Math.min(255, Math.round(253 - (253 - b) * 0.06));
  return {
    position: "absolute",
    right: 0,
    top: "calc(100% + 6px)",
    // Two-layer background: subtle accent gradient over the tinted base.
    // The rgba() as the last comma-value is the CSS background-color shorthand layer.
    background: `linear-gradient(160deg, rgba(${r},${g},${b},0.10) 0%, transparent 60%), rgba(${tr},${tg},${tb},0.97)`,
    border: `1px solid ${accent}44`,
    borderRadius: 12,
    minWidth: 160,
    boxShadow: themeCfg.cardShadow,
    overflow: "hidden",
    zIndex: 200,
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
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
