// app/account/ui.tsx
"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import type React from "react";

import SVScene from "@/app/components/sv-scene";
import { useSVTheme, type ThemeConfig } from "@/app/components/sv-kit";
import { usePlayer } from "@/app/components/player-context";
import { AVATAR_PRESETS, getAvatarPreset } from "@/lib/avatars";

// ── Types ─────────────────────────────────────────────────────────────────────

type AccountUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  avatarKey: string | null;
  credits: number;
  isAdmin: boolean;
  hasSubscription: boolean;
  createdAt: string;
  planLabel: string | null;
  planStatus: string | null;
};

type JobStatus = "QUEUED" | "PROCESSING" | "DONE" | "FAILED";

type Track = {
  id: string;
  prompt?: string | null;
  preset?: string | null;
  status?: JobStatus;
  resultUrl?: string | null;
  createdAt?: string;
  durationSec?: number | null;
  title?: string | null;
  url?: string | null;
  durationSeconds?: number | null;
  playCount?: number | null;
};

type ItemsResp = { items: Track[]; nextCursor?: string | null };
type OkDataResp = { ok: true; data: { items: Track[]; nextCursor?: string | null } };

// ── Type guards ───────────────────────────────────────────────────────────────

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
  return isRecord(v) && (v as { ok?: unknown }).ok === true && isRecord((v as { data?: unknown }).data) && isTrackArray((v as OkDataResp).data.items);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

const MAX_TITLE = 60;

function displayTitle(t: Track): string {
  const raw = (t.title ?? t.prompt ?? "").trim();
  if (!raw) return "(ohne Titel)";
  return raw.length <= MAX_TITLE ? raw : raw.slice(0, MAX_TITLE - 1) + "…";
}

function displayUrl(t: Track): string {
  return t.url ?? t.resultUrl ?? "";
}

// ── pillStyle — matches /generate exactly ─────────────────────────────────────

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

// ── Main component ────────────────────────────────────────────────────────────

export default function AccountClient({ user }: { user: AccountUser }) {
  const { themeKey, themeCfg, cycleTheme, logoSrc } = useSVTheme();
  const { loadTrack, play, pause, state } = usePlayer();

  const [tracks, setTracks] = useState<Track[]>([]);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [tab, setTab] = useState<"recent" | "popular">("recent");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Avatar — initialise from sessionStorage so a stale router-cache remount can't
  // temporarily overwrite the user's latest saved choice before fresh data arrives.
  const [avatarKey, setAvatarKey] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      const stored = window.sessionStorage.getItem("sv_avatar_key");
      if (stored !== null) return stored === "" ? null : stored;
    }
    return user.avatarKey;
  });
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);

  const isDark = themeKey === "dark";

  // Glass surface values
  const glassCardBg = isDark
    ? "rgba(15,23,42,0.32)"
    : themeKey === "pastel"
    ? "rgba(255,245,250,0.50)"
    : "rgba(255,255,255,0.55)";
  const glassCardBorder = isDark
    ? "rgba(255,255,255,0.08)"
    : "rgba(0,0,0,0.08)";
  const divider = `1px solid ${glassCardBorder}`;

  // glassPanel — matches /generate exactly
  const glassPanel = useMemo((): React.CSSProperties => ({
    background: isDark ? "rgba(15,23,42,0.52)" : "rgba(248,250,252,0.62)",
    border: isDark ? "1px solid rgba(148,163,184,0.22)" : "1px solid rgba(148,163,184,0.28)",
    color: themeCfg.uiText,
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    boxShadow: isDark ? "0 26px 80px rgba(0,0,0,0.55)" : "0 22px 60px rgba(15,23,42,0.25)",
  }), [isDark, themeCfg.uiText]);

  // "Meist gehört" is disabled until playCount data is available
  const hasPlayCount = tracks.some(
    (t) => typeof t.playCount === "number" && t.playCount > 0,
  );
  const tabTracks =
    tab === "popular" && hasPlayCount
      ? [...tracks].sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0))
      : tracks;

  // Load recent tracks
  useEffect(() => {
    const load = async () => {
      setLoadingTracks(true);
      try {
        let res = await fetch("/api/tracks?take=5");
        if (!res.ok) res = await fetch("/api/jobs?take=5");
        if (!res.ok) throw new Error(String(res.status));
        const data: unknown = await res.json();
        let list: Track[] = [];
        if (isTrackArray(data)) list = data;
        else if (isItemsResp(data)) list = data.items;
        else if (isOkDataResp(data)) list = data.data.items;
        setTracks(list);
      } catch {
        setTracks([]);
      } finally {
        setLoadingTracks(false);
      }
    };
    void load();
  }, []);

  // Stripe Customer Portal
  const handleOpenPortal = async () => {
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      if (!res.ok) { console.error("Failed to create portal session"); return; }
      const data: unknown = await res.json();
      if (data && typeof data === "object" && "url" in data && typeof (data as { url: unknown }).url === "string") {
        window.location.href = (data as { url: string }).url;
      }
    } catch (error) {
      console.error(error);
    }
  };

  // Global player
  const handlePlay = useCallback((t: Track) => {
    const url = displayUrl(t);
    if (!url) return;
    const active = state.trackId === t.id;
    if (active) {
      state.isPlaying ? pause() : play();
      return;
    }
    loadTrack(url, displayTitle(t), t.id);
  }, [state.trackId, state.isPlaying, loadTrack, play, pause]);

  const initials = user.name?.split(" ").map((p) => p[0]).join("").toUpperCase() || "SV";
  const activePreset = getAvatarPreset(avatarKey);

  async function handleSelectAvatar(key: string) {
    if (key === avatarKey || savingAvatar) return;
    setSavingAvatar(true);
    try {
      const res = await fetch("/api/account/avatar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarKey: key }),
      });
      if (res.ok) {
        window.sessionStorage.setItem("sv_avatar_key", key);
        setAvatarKey(key);
        setAvatarPickerOpen(false);
      }
    } finally {
      setSavingAvatar(false);
    }
  }

  return (
    <SVScene theme={themeKey}>
      {/* Responsive grid — desktop: 320px left + 1fr right */}
      <style>{`
        @media (min-width: 900px) {
          .sv-account-grid {
            display: grid !important;
            grid-template-columns: 320px 1fr;
            gap: 32px;
            align-items: start;
          }
        }
      `}</style>

      {/* ── Header — matches /generate exactly ───────────────────────── */}
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
        {/* Logo — click cycles theme */}
        <button
          type="button"
          onClick={cycleTheme}
          style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer" }}
          aria-label="Theme wechseln"
          title="Theme wechseln"
        >
          <Image src={logoSrc} alt="SoftVibe Logo" width={160} height={50} priority />
        </button>

        {/* Home — absolutely centered */}
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

        {/* Menu — hover with close-delay so cursor can reach the dropdown */}
        <div
          style={{ position: "relative" }}
          onMouseEnter={() => {
            if (menuCloseTimer.current) { clearTimeout(menuCloseTimer.current); menuCloseTimer.current = null; }
            setMenuOpen(true);
          }}
          onMouseLeave={() => {
            menuCloseTimer.current = setTimeout(() => setMenuOpen(false), 150);
          }}
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
                width: "min(280px, calc(100vw - 28px))",
                padding: 2,
                borderRadius: 26,
                background: isDark
                  ? "radial-gradient(circle at top, rgba(56,189,248,0.22), transparent 68%)"
                  : "radial-gradient(circle at top, rgba(244,114,182,0.32), transparent 70%)",
                boxShadow: "0 26px 80px rgba(0,0,0,0.7)",
              }}
            >
              <div style={{ ...glassPanel, padding: 16, borderRadius: 24 }}>
                <div style={{ fontSize: "0.8rem", letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 800, color: themeCfg.uiSoftText, marginBottom: 12 }}>
                  Menü
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    { label: "Generieren", href: "/generate" },
                    { label: "Bibliothek", href: "/library" },
                    { label: "Konto", href: "/account" },
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

      {/* ── Page content ──────────────────────────────────────────────── */}
      <main style={{ minHeight: "100vh", padding: "96px 24px 80px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>

          {/* Responsive grid container */}
          <div
            className="sv-account-grid"
            style={{ display: "flex", flexDirection: "column", gap: 32 }}
          >

            {/* ── Left column: Identity + Credits + Quick Actions ── */}
            <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>

              {/* Identity */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 14 }}>
                  {/* Avatar — clickable to open picker */}
                  <div style={{ flexShrink: 0, position: "relative" }}>
                    <button
                      type="button"
                      onClick={() => setAvatarPickerOpen(true)}
                      aria-label="Avatar ändern"
                      title="Avatar ändern"
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: "50%",
                        background: `${themeCfg.primaryButtonBg}22`,
                        border: `2px solid ${themeCfg.primaryButtonBg}44`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: themeCfg.primaryButtonBg,
                        fontWeight: 800,
                        fontSize: "1.1rem",
                        cursor: "pointer",
                        padding: 0,
                        transition: "border-color 150ms ease, background 150ms ease",
                      }}
                    >
                      {activePreset ? (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          {activePreset.paths.map((d, i) => <path key={i} d={d} />)}
                        </svg>
                      ) : (
                        initials
                      )}
                    </button>
                    {/* Edit badge */}
                    <div style={{ position: "absolute", bottom: -2, right: -2, width: 18, height: 18, borderRadius: "50%", background: themeCfg.primaryButtonBg, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                      <svg width="9" height="9" viewBox="0 0 12 12" fill={themeCfg.primaryButtonText} aria-hidden="true">
                        <path d="M8.5 1.5l2 2L3 11H1V9L8.5 1.5z"/>
                      </svg>
                    </div>
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
                      <h1
                        style={{
                          fontSize: "clamp(1.25rem, 2.5vw, 1.55rem)",
                          fontWeight: 800,
                          color: themeCfg.uiText,
                          margin: 0,
                          lineHeight: 1.15,
                        }}
                      >
                        {user.name}
                      </h1>
                      {user.isAdmin && (
                        <div
                          style={{
                            padding: "0.18rem 0.55rem",
                            borderRadius: 999,
                            background: `${themeCfg.primaryButtonBg}22`,
                            border: `1px solid ${themeCfg.primaryButtonBg}55`,
                            fontSize: "0.68rem",
                            fontWeight: 700,
                            color: themeCfg.primaryButtonBg,
                            letterSpacing: "0.06em",
                          }}
                        >
                          Admin
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: "0.8rem", color: themeCfg.uiSoftText, overflowWrap: "anywhere" }}>
                      {user.email}
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: "0.75rem", color: themeCfg.uiSoftText, paddingLeft: 72 }}>
                  Mitglied seit {formatDate(user.createdAt)}
                </div>
              </div>

              {/* Divider */}
              <div style={{ borderTop: divider }} />

              {/* Credits + plan */}
              <div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: "2.2rem", fontWeight: 850, color: themeCfg.uiText, lineHeight: 1 }}>
                    {user.isAdmin ? "∞" : user.credits.toLocaleString("de-DE")}
                  </span>
                  <span style={{ fontSize: "0.8rem", color: themeCfg.uiSoftText, fontWeight: 500 }}>
                    Credits
                  </span>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                  {user.hasSubscription && user.planLabel ? (
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        padding: "0.22rem 0.65rem",
                        borderRadius: 999,
                        background: `${themeCfg.primaryButtonBg}1a`,
                        border: `1px solid ${themeCfg.primaryButtonBg}44`,
                        fontSize: "0.78rem",
                        fontWeight: 700,
                        color: themeCfg.uiText,
                      }}
                    >
                      {user.planLabel}
                      {user.planStatus && (
                        <span style={{ fontWeight: 400, color: themeCfg.uiSoftText }}>
                          · {user.planStatus}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span style={{ fontSize: "0.8rem", color: themeCfg.uiSoftText }}>Kein Abo</span>
                  )}

                  {user.hasSubscription ? (
                    <ManageSubscriptionButton onClick={handleOpenPortal} themeCfg={themeCfg} />
                  ) : (
                    <Link
                      href="/billing"
                      style={{
                        padding: "0.3rem 0.85rem",
                        borderRadius: 999,
                        background: themeCfg.primaryButtonBg,
                        color: themeCfg.primaryButtonText,
                        fontWeight: 700,
                        fontSize: "0.8rem",
                        textDecoration: "none",
                      }}
                    >
                      Paket wählen
                    </Link>
                  )}
                </div>
              </div>

              {/* Divider */}
              <div style={{ borderTop: divider }} />

              {/* Quick Actions */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Link href="/generate" style={pillStyle(themeCfg, "primary")}>
                  + Neu erstellen
                </Link>
                <Link href="/library" style={pillStyle(themeCfg, "secondary")}>
                  Bibliothek öffnen
                </Link>
              </div>

            </div>

            {/* ── Right column: Tracks — open panel, no card wrapper ── */}
            <section style={{ minWidth: 0 }}>

              {/* Section header: tabs + view toggle — standalone row */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-end",
                  borderBottom: `1px solid ${glassCardBorder}`,
                  marginBottom: 20,
                }}
              >
                {/* Tabs — underline style */}
                <div style={{ display: "flex" }}>
                  {(["recent", "popular"] as const).map((t) => {
                    const isActive = tab === t;
                    const isDisabled = t === "popular" && !hasPlayCount;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={isDisabled ? undefined : () => setTab(t)}
                        style={{
                          appearance: "none",
                          background: "transparent",
                          border: "none",
                          borderBottom: isActive
                            ? `2px solid ${themeCfg.primaryButtonBg}`
                            : "2px solid transparent",
                          padding: "0 4px 12px",
                          marginRight: 20,
                          cursor: isDisabled ? "not-allowed" : "pointer",
                          fontSize: "0.88rem",
                          fontWeight: isActive ? 700 : 500,
                          color: isActive ? themeCfg.uiText : themeCfg.uiSoftText,
                          opacity: isDisabled ? 0.45 : 1,
                          transition: "color 150ms ease, border-color 150ms ease",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t === "recent" ? "Zuletzt erstellt" : "Meist gehört"}
                      </button>
                    );
                  })}
                </div>

                {/* View toggle pill */}
                {tracks.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      borderRadius: 999,
                      border: `1px solid ${glassCardBorder}`,
                      overflow: "hidden",
                      background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                      marginBottom: 12,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setViewMode("list")}
                      aria-label="Listenansicht"
                      style={{
                        padding: "5px 8px",
                        border: "none",
                        background: viewMode === "list" ? themeCfg.primaryButtonBg : "transparent",
                        color: viewMode === "list" ? themeCfg.primaryButtonText : themeCfg.uiSoftText,
                        cursor: "pointer",
                        display: "grid",
                        placeItems: "center",
                        transition: "background 150ms ease, color 150ms ease",
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <rect x="1" y="2" width="14" height="2.5" rx="1" />
                        <rect x="1" y="6.75" width="14" height="2.5" rx="1" />
                        <rect x="1" y="11.5" width="14" height="2.5" rx="1" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("grid")}
                      aria-label="Kachelansicht"
                      style={{
                        padding: "5px 8px",
                        border: "none",
                        background: viewMode === "grid" ? themeCfg.primaryButtonBg : "transparent",
                        color: viewMode === "grid" ? themeCfg.primaryButtonText : themeCfg.uiSoftText,
                        cursor: "pointer",
                        display: "grid",
                        placeItems: "center",
                        transition: "background 150ms ease, color 150ms ease",
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <rect x="1" y="1" width="6" height="6" rx="1.5" />
                        <rect x="9" y="1" width="6" height="6" rx="1.5" />
                        <rect x="1" y="9" width="6" height="6" rx="1.5" />
                        <rect x="9" y="9" width="6" height="6" rx="1.5" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>

              {/* Content */}
              {loadingTracks ? (
                <p style={{ opacity: 0.5, fontSize: "0.85rem", color: themeCfg.uiSoftText }}>
                  Lade…
                </p>
              ) : tabTracks.length === 0 ? (
                <div style={{ padding: "32px 0", textAlign: "center" }}>
                  <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: "0.95rem", color: themeCfg.uiText }}>
                    Noch keine Generierungen
                  </p>
                  <p style={{ margin: "0 0 18px", fontSize: "0.85rem", color: themeCfg.uiSoftText }}>
                    Wenn du generierst, erscheinen sie hier.
                  </p>
                  <Link
                    href="/generate"
                    style={{
                      display: "inline-block",
                      padding: "0.45rem 1.1rem",
                      borderRadius: 999,
                      background: themeCfg.primaryButtonBg,
                      color: themeCfg.primaryButtonText,
                      fontWeight: 700,
                      fontSize: "0.85rem",
                      textDecoration: "none",
                    }}
                  >
                    Jetzt erstellen
                  </Link>
                </div>
              ) : viewMode === "grid" ? (
                <>
                  {/* ── True grid — each tile is a real glass card ── */}
                  <ul
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                      gap: 14,
                      listStyle: "none",
                    }}
                  >
                    {tabTracks.map((t) => {
                      const active = state.trackId === t.id;
                      const playing = active && state.isPlaying;
                      const hasAudio = !!(t.status === "DONE" || t.url || t.resultUrl);
                      return (
                        <li
                          key={t.id}
                          style={{
                            background: glassCardBg,
                            border: `1px solid ${active ? themeCfg.primaryButtonBg + "55" : glassCardBorder}`,
                            borderRadius: 16,
                            padding: "14px 16px",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "space-between",
                            gap: 14,
                            backdropFilter: "blur(12px)",
                            WebkitBackdropFilter: "blur(12px)",
                            boxShadow: active
                              ? `0 4px 20px rgba(0,0,0,0.18)`
                              : isDark
                              ? "0 2px 8px rgba(0,0,0,0.2)"
                              : "0 2px 8px rgba(15,23,42,0.08)",
                            transition: "border-color 200ms ease, box-shadow 200ms ease",
                            minHeight: 110,
                          }}
                        >
                          {/* Title */}
                          <div
                            style={{
                              fontWeight: 700,
                              fontSize: "0.9rem",
                              color: active ? themeCfg.primaryButtonBg : themeCfg.uiText,
                              lineHeight: 1.4,
                              display: "-webkit-box",
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                              transition: "color 150ms ease",
                            }}
                            title={(t.title ?? t.prompt ?? "").trim() || undefined}
                          >
                            {displayTitle(t)}
                          </div>

                          {/* Meta + play button row */}
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: "0.72rem", color: themeCfg.uiSoftText, fontWeight: 600, marginBottom: 1 }}>
                                {(t.preset ?? "—") || "—"}
                              </div>
                              <div style={{ fontSize: "0.68rem", color: themeCfg.uiSoftText, opacity: 0.7 }}>
                                {(t.durationSec ?? t.durationSeconds) ? `${t.durationSec ?? t.durationSeconds}s` : ""}
                                {t.createdAt ? ` · ${new Date(t.createdAt).toLocaleDateString("de-DE")}` : ""}
                              </div>
                            </div>
                            {hasAudio && (
                              <button
                                type="button"
                                onClick={() => handlePlay(t)}
                                aria-label={playing ? "Pause" : "Abspielen"}
                                style={{
                                  flexShrink: 0,
                                  width: 36,
                                  height: 36,
                                  borderRadius: "50%",
                                  border: "none",
                                  background: themeCfg.primaryButtonBg,
                                  color: themeCfg.primaryButtonText,
                                  display: "grid",
                                  placeItems: "center",
                                  cursor: "pointer",
                                  boxShadow: active ? "0 4px 16px rgba(0,0,0,0.25)" : "0 2px 8px rgba(0,0,0,0.15)",
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
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  <div style={{ marginTop: 20, textAlign: "right" }}>
                    <Link href="/library" style={pillStyle(themeCfg, "secondary")}>
                      Alle ansehen →
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  {/* ── List view — clean rows, no surfaces ── */}
                  <ul style={{ listStyle: "none" }}>
                    {tabTracks.map((t, i) => {
                      const active = state.trackId === t.id;
                      const playing = active && state.isPlaying;
                      const hasAudio = !!(t.status === "DONE" || t.url || t.resultUrl);
                      const isLast = i === tabTracks.length - 1;
                      return (
                        <li
                          key={t.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            padding: "12px 0",
                            borderBottom: isLast ? "none" : `1px solid ${glassCardBorder}`,
                          }}
                        >
                          {hasAudio && (
                            <button
                              type="button"
                              onClick={() => handlePlay(t)}
                              aria-label={playing ? "Pause" : "Abspielen"}
                              style={{
                                flexShrink: 0,
                                width: 36,
                                height: 36,
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
                          )}

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontWeight: 600,
                                fontSize: "0.9rem",
                                color: active ? themeCfg.primaryButtonBg : themeCfg.uiText,
                                lineHeight: 1.3,
                                marginBottom: 3,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                transition: "color 150ms ease",
                              }}
                              title={(t.title ?? t.prompt ?? "").trim() || undefined}
                            >
                              {displayTitle(t)}
                            </div>
                            <div style={{ fontSize: "0.72rem", color: themeCfg.uiSoftText }}>
                              {(t.preset ?? "—") || "—"}
                              {(t.durationSec ?? t.durationSeconds) ? ` · ${t.durationSec ?? t.durationSeconds}s` : ""}
                              {t.createdAt ? ` · ${new Date(t.createdAt).toLocaleDateString("de-DE")}` : ""}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  <div style={{ marginTop: 20, textAlign: "right" }}>
                    <Link href="/library" style={pillStyle(themeCfg, "secondary")}>
                      Alle ansehen →
                    </Link>
                  </div>
                </>
              )}
            </section>

          </div>
        </div>
      </main>

      {/* ── Avatar picker modal ─────────────────────────────────────────── */}
      {avatarPickerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 500 }}
          onClick={() => setAvatarPickerOpen(false)}
        >
          <div
            style={{ ...glassPanel, borderRadius: 20, padding: 24, width: "min(380px, 100%)", maxHeight: "80vh", overflowY: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <span style={{ fontWeight: 700, fontSize: "0.95rem", color: themeCfg.uiText }}>Avatar wählen</span>
              <button type="button" onClick={() => setAvatarPickerOpen(false)} aria-label="Schließen" style={{ width: 28, height: 28, borderRadius: "50%", border: `1px solid ${glassCardBorder}`, background: "transparent", color: themeCfg.uiSoftText, cursor: "pointer", display: "grid", placeItems: "center" }}>
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M2 2l8 8M10 2l-8 8" /></svg>
              </button>
            </div>

            {/* Grid of avatar options */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {AVATAR_PRESETS.map((preset) => {
                const isSelected = avatarKey === preset.key;
                return (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => void handleSelectAvatar(preset.key)}
                    disabled={savingAvatar}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 8,
                      padding: "14px 8px",
                      borderRadius: 14,
                      border: isSelected ? `2px solid ${themeCfg.primaryButtonBg}` : `1px solid ${glassCardBorder}`,
                      background: isSelected ? `${themeCfg.primaryButtonBg}18` : "transparent",
                      color: isSelected ? themeCfg.primaryButtonBg : themeCfg.uiSoftText,
                      cursor: savingAvatar ? "wait" : "pointer",
                      transition: "border-color 120ms ease, background 120ms ease, color 120ms ease",
                    }}
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      {preset.paths.map((d, i) => <path key={i} d={d} />)}
                    </svg>
                    <span style={{ fontSize: "0.7rem", fontWeight: isSelected ? 700 : 500, color: isSelected ? themeCfg.primaryButtonBg : themeCfg.uiSoftText, lineHeight: 1 }}>
                      {preset.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Remove avatar option */}
            {avatarKey && (
              <button
                type="button"
                onClick={async () => {
                  setSavingAvatar(true);
                  try {
                    const res = await fetch("/api/account/avatar", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ avatarKey: null }) });
                    if (res.ok) { window.sessionStorage.setItem("sv_avatar_key", ""); setAvatarKey(null); setAvatarPickerOpen(false); }
                  } finally { setSavingAvatar(false); }
                }}
                disabled={savingAvatar}
                style={{ marginTop: 14, width: "100%", padding: "8px 0", borderRadius: 999, border: `1px solid ${glassCardBorder}`, background: "transparent", color: themeCfg.uiSoftText, fontSize: "0.78rem", fontWeight: 600, cursor: savingAvatar ? "wait" : "pointer" }}
              >
                Initialen verwenden
              </button>
            )}
          </div>
        </div>
      )}
    </SVScene>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ManageSubscriptionButton({
  onClick,
  themeCfg,
}: {
  onClick: () => Promise<void> | void;
  themeCfg: ThemeConfig;
}) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (loading) return;
    try {
      setLoading(true);
      await onClick();
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      style={{
        padding: "0.3rem 0.85rem",
        borderRadius: 999,
        border: `1px solid ${themeCfg.secondaryButtonBorder}`,
        background: themeCfg.secondaryButtonBg,
        color: themeCfg.secondaryButtonText,
        cursor: loading ? "default" : "pointer",
        fontSize: "0.8rem",
        fontWeight: 600,
        opacity: loading ? 0.65 : 1,
        transition: "opacity .15s ease",
      }}
    >
      {loading ? "Weiterleiten…" : "Abo verwalten"}
    </button>
  );
}
