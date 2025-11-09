// app/library/ui.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import CustomPlayer from "@/app/components/CustomPlayer";
import EmptyState from "../components/EmptyState";

type Track = {
  id: string;
  title?: string | null;
  prompt?: string | null;
  url: string;
  createdAt?: string;
  durationSeconds?: number | null;
  // 🔹 NEU:
   isPublic?: boolean | null;
  shareSlug?: string | null;
};

type Theme = "light" | "dark" | "pastel";
type SortKey = "newest" | "oldest" | "short" | "long";

export default function LibraryClient() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
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

  useEffect(() => {
    void load();
  }, []);
  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/tracks");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const list: Track[] = Array.isArray(data)
        ? data
        : Array.isArray((data as { items?: unknown })?.items)
        ? ((data as { items: unknown[] }).items as Track[])
        : [];
      setTracks(list);
    } catch {
      setTracks([]);
    } finally {
      setLoading(false);
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
  function getOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  // Fallback für SSR – passe bei Bedarf an deine Domain an
  return process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
}

function toAbsoluteUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return getOrigin();
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl; // schon absolut
  const base = getOrigin();
  const p = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${base}${p}`;
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

  // bereits vorhanden:
    async function copyLink(t: Track) {
    try {
        // Wenn öffentlich: teile /p/<slug>
        const publicUrl =
        t.isPublic && t.shareSlug ? `${getOrigin()}/p/${t.shareSlug}` : null;

        // Sonst: private Audio-URL, aber absolut
        const privateUrl = toAbsoluteUrl(t.url);

        const finalUrl = publicUrl ?? privateUrl;

        if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(finalUrl);
        } else {
        // Fallback
        const tmp = document.createElement("textarea");
        tmp.value = finalUrl;
        document.body.appendChild(tmp);
        tmp.select();
        document.execCommand("copy");
        tmp.remove();
        }
        showToast("Link kopiert.", "ok");
    } catch {
        showToast("Kopieren fehlgeschlagen.", "err");
    }
    }

  // 🔹 NEU: Öffentlich teilen (Toggle)
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
    const data: { isPublic: boolean; shareSlug: string | null } = await res.json();
    setTracks((prev) =>
      prev.map((x) =>
        x.id === t.id ? { ...x, isPublic: data.isPublic, shareSlug: data.shareSlug ?? null } : x
      )
    );
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
    <main style={{ maxWidth: 980, margin: "40px auto", padding: "0 16px" }}>
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
      ) : (filtered ?? []).length === 0 ? (
        <EmptyState
          title="Keine Einträge"
          hint="Hier landen deine generierten Audios."
          action={{ href: "/generate", label: "+ Neue Generierung" }}
        />
      ) : (
        <ul style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {(filtered ?? []).map((t) => {
            const isEditing = editingId === t.id;
            const isActive = openMenuId === t.id;
            const isHovering = hoverId === t.id;
            const displayTitle = t.title && t.title.trim() !== "" ? t.title : t.prompt || "(ohne Titel)";
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
                        onClick={() => beginEdit(t)}
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
                        {displayTitle}
                      </button>
                    )}
                  </div>
                  {/* Meta */}
                  <div style={{ fontSize: "0.78rem", opacity: 0.65, marginTop: 2 }}>
                    {t.durationSeconds ? `${t.durationSeconds}s · ` : ""}
                    {t.createdAt ? new Date(t.createdAt).toLocaleString("de-DE") : ""}
                    {/* 🔹 NEU: kleiner Public-Hinweis */}
                    {t.isPublic ? " · Öffentlich" : ""}
                  </div>
                  {/* Player */}
                  <div style={{ marginTop: 10 }}>
                    <CustomPlayer src={t.url} title={displayTitle} />
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
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        left: "100%",
                        width: 10,
                        height: 36,
                      }}
                    />
                  )}

                  {openMenuId === t.id && (
                    <div
                      style={{
                        position: "absolute",
                        left: "calc(100% + 8px)",
                        top: 0,
                        background: "var(--color-card)",
                        color: "#000", // 🔹 gut lesbar (fix)
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

                      {/* 🔹 Toggle Öffentlich */}
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

                      {/* 🔹 Share-Link kopieren (nutzt shareSlug wenn vorhanden) */}
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
      )}

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
};