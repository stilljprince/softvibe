"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type React from "react";
import EmptyState from "../components/EmptyState";
import HeaderCredits from "@/app/components/HeaderCredits";
import CustomPlayer from "@/app/components/CustomPlayer";

type AccountUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;

  credits: number;
  isAdmin: boolean;
  hasSubscription: boolean;
  createdAt: string; // ISO-String
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
  // optional falls /api/tracks liefert:
  title?: string | null;
  url?: string | null;
  durationSeconds?: number | null;
};

type Theme = "light" | "dark" | "pastel";

// ---- Hilfen für Tracks-Response (wie in Library) ----
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

// Datum immer DD.MM.YYYY
function formatDate(dateIso?: string): string {
  if (!dateIso) return "—";
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

export default function AccountClient({ user }: { user: AccountUser }) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loadingTracks, setLoadingTracks] = useState(false);

  // ===== Theme wie Landing =====
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

  // ===== letzte 5 Einträge robust laden (Tracks-API wie in Library) =====
  useEffect(() => {
    const load = async () => {
      setLoadingTracks(true);
      try {
        let res = await fetch("/api/tracks?take=5");
        if (!res.ok) {
          // Fallback auf /api/jobs, falls Tracks-API mal Fehler wirft
          res = await fetch("/api/jobs?take=5");
        }
        if (!res.ok) throw new Error(String(res.status));

        const data: unknown = await res.json();
        let list: Track[] = [];

        if (isTrackArray(data)) {
          list = data;
        } else if (isItemsResp(data)) {
          list = data.items;
        } else if (isOkDataResp(data)) {
          list = data.data.items;
        }

        setTracks(list);
      } catch {
        setTracks([]);
      } finally {
        setLoadingTracks(false);
      }
    };
    void load();
  }, []);

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

  const initials =
    user.name
      ?.split(" ")
      .map((p) => p[0])
      .join("")
      .toUpperCase() || "SV";

  const MAX_TITLE_LENGTH = 60;

  const displayTitle = (t: Track) => {
  const raw = (t.title ?? t.prompt ?? "").trim();
  if (!raw) return "(ohne Titel)";

  if (raw.length <= MAX_TITLE_LENGTH) return raw;
  return raw.slice(0, MAX_TITLE_LENGTH - 1) + "…";
};
  const displayUrl = (t: Track) => t.url ?? t.resultUrl ?? "";
  const handleOpenPortal = async () => {
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
      });

      if (!res.ok) {
        console.error("Failed to create portal session");
        return;
      }

      const data: unknown = await res.json();

      if (
        data &&
        typeof data === "object" &&
        "url" in data &&
        typeof (data as { url: unknown }).url === "string"
      ) {
        window.location.href = (data as { url: string }).url;
      }
    } catch (error) {
      console.error(error);
    }
  };
  
  // Abo-Status-Text (wird jetzt nur noch im Hinweisblock verwendet)
  const subscriptionLabel = user.hasSubscription
    ? user.planLabel
      ? user.planStatus
        ? `${user.planLabel} (${user.planStatus})`
        : user.planLabel
      : "Aktives Abonnement"
    : "Kein aktives Abonnement";

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--color-bg)",
        paddingTop: "64px",
      }}
    >
      {/* ===== Header wie Landing ===== */}
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

      {/* ===== Inhalt: breit ===== */}
      <div
        style={{
          width: "100%",
          maxWidth: "min(1650px, 100vw - 1.5rem)",
          margin: "1.5rem auto 0",
          paddingBottom: "3rem",
        }}
      >
        <div
          style={{
            width: "100%",
            background: "var(--color-card)",
            border: "1px solid var(--color-nav-bg)",
            borderRadius: 20,
            boxShadow: "0 14px 30px rgba(0,0,0,0.035)",
            overflow: "hidden",
            display: "grid",
            gridTemplateColumns: "0.35fr 0.65fr",
            gap: 0,
          }}
        >
          {/* ===== linke Spalte ===== */}
          <div
            style={{
              padding: "1.25rem 1.5rem 1.5rem",
              background:
                "linear-gradient(160deg, color-mix(in oklab, var(--color-accent) 16%, var(--color-card)) 0%, var(--color-card) 70%)",
            }}
          >
            <div style={{ display: "flex", gap: "1rem", alignItems: "center", marginBottom: "1rem" }}>
              <div>
                {user.image ? (
                  <img
                    src={user.image}
                    alt={user.name ?? "User"}
                    style={{
                      width: 70,
                      height: 70,
                      borderRadius: "999px",
                      objectFit: "cover",
                      border: "3px solid rgba(255,255,255,0.5)",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 70,
                      height: 70,
                      borderRadius: "999px",
                      background: "rgba(0,0,0,0.12)",
                      border: "3px solid rgba(255,255,255,0.5)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                      fontWeight: 700,
                      fontSize: "1.2rem",
                    }}
                  >
                    {initials}
                  </div>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: "0.7rem", opacity: 0.7, marginBottom: 3 }}>Dein SoftVibe-Konto</p>
                <h1 style={{ fontSize: "1.25rem", fontWeight: 700, lineHeight: 1.05 }}>{user.name}</h1>
                <p style={{ opacity: 0.9, overflowWrap: "anywhere" }}>{user.email}</p>
              </div>
            </div>

            <section>
              <h2
                style={{
                  fontSize: "0.9rem",
                  fontWeight: 700,
                  marginBottom: "0.5rem",
                }}
              >
                Persönliche Daten
              </h2>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr",
                  gap: "0.6rem",
                }}
              >
                <Field label="Name" value={user.name || "—"} />
                <Field label="E-Mail" value={user.email} mono />
                <Field label="Mitglied seit" value={formatDate(user.createdAt)} />
                <Field label="Credits" value={String(user.credits)} />
              </div>

              {user.hasSubscription && (
                <>
                  <div style={{ marginTop: "0.75rem" }}>
                    <ManageSubscriptionButton onClick={handleOpenPortal} />
                  </div>

                  {user.planLabel && (
                    <div
                      style={{
                        marginTop: "0.75rem",
                        padding: "0.7rem 0.8rem",
                        borderRadius: 14,
                        border: "1px solid rgba(255,255,255,0.45)",
                        background:
                          "color-mix(in oklab, var(--color-card) 94%, rgba(0,0,0,0.10))",
                        fontSize: "0.8rem",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: "0.5rem",
                          marginBottom: 4,
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>Dein aktuelles Abo</div>
                        <div
                          style={{
                            padding: "0.15rem 0.6rem",
                            borderRadius: 999,
                            border: "1px solid rgba(255,255,255,0.7)",
                            background:
                              "color-mix(in oklab, var(--color-card) 90%, rgba(0,0,0,0.12))",
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {user.planLabel}
                          {user.planStatus ? ` · ${user.planStatus}` : ""}
                        </div>
                      </div>
                      
                      <div style={{ opacity: 0.8, marginTop: 4 }}>
                        Credits werden dir automatisch monatlich gutgeschrieben. Details
                        zu Rechnungen und Zahlungen kannst du im{" "}
                        <button
                          type="button"
                          onClick={handleOpenPortal}
                          style={{
                            padding: 0,
                            margin: 0,
                            border: "none",
                            background: "transparent",
                            font: "inherit",
                            fontWeight: 600,
                            cursor: "pointer",
                            color: "inherit",
                          }}
                        >
                          Abo-Verwaltungsbereich
                        </button>{" "}
                        einsehen.
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>
          </div>

          {/* ===== rechte Spalte – letzte Generierungen ===== */}
          <div
            style={{
              padding: "1.25rem 1.5rem 1.5rem",
              background:
                "linear-gradient(160deg, color-mix(in oklab, var(--color-accent) 10%, var(--color-card)) 0%, var(--color-card) 70%)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "1rem",
                marginBottom: "0.75rem",
              }}
            >
              <h2 style={{ fontSize: "1rem", fontWeight: 700 }}>Deine letzten Generierungen</h2>
              <Link
                href="/generate"
                style={{
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  color: "var(--color-accent)",
                  textDecoration: "none",
                }}
              >
                neue Generierung →
              </Link>
            </div>

            {loadingTracks ? (
              <p style={{ opacity: 0.6, fontSize: "0.85rem" }}>Lade…</p>
            ) : tracks.length === 0 ? (
              <EmptyState
                title="Noch keine Generierungen"
                hint="Wenn du generierst, erscheinen sie hier."
                action={{ href: "/generate", label: "Jetzt generieren" }}
              />
            ) : (
              <>
                <ul
  style={{
    display: "flex",
    flexDirection: "column",
    gap: "0.6rem",
  }}
>
  {(Array.isArray(tracks) ? tracks : []).map((t) => (
    <li
      key={t.id}
      style={{
        background: "color-mix(in oklab, var(--color-card) 95%, var(--color-bg))",
        border: "1px solid rgba(0,0,0,0.018)",
        borderRadius: 12,
        padding: "0.7rem 0.75rem 0.6rem",
        display: "flex",
        gap: "0.75rem",
        alignItems: "flex-start",
        flexWrap: "wrap",          // 👈 bei wenig Platz darf umgebrochen werden
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
  style={{
    display: "block",
    fontWeight: 600,
    whiteSpace: "normal",
    wordBreak: "normal",
    overflowWrap: "normal",
    lineHeight: 1.3,
    letterSpacing: "normal",
    writingMode: "horizontal-tb" as React.CSSProperties["writingMode"],
  }}
  title={(t.title ?? t.prompt ?? "").trim() || undefined} // 👈 voller Text im Tooltip
>
  {displayTitle(t)}
</div>
        <div style={{ fontSize: "0.72rem", opacity: 0.6 }}>
          {(t.preset ?? "—") || "—"}
          {t.durationSec
            ? ` · ${t.durationSec}s`
            : t.durationSeconds
            ? ` · ${t.durationSeconds}s`
            : ""}
          {t.createdAt ? ` · ${new Date(t.createdAt).toLocaleString("de-DE")}` : ""}
        </div>
      </div>

      {(t.status === "DONE" || t.url || t.resultUrl) && (
        <div
          style={{
            flexShrink: 0,           // 👈 Player wird nicht weiter gequetscht
            maxWidth: 370,           // 👈 schmaler wie in der Library
            width: "100%",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <CustomPlayer
            src={displayUrl(t)}
            preload="metadata"
            showTitle={false}
            maxWidth={370}
          />
        </div>
      )}
    </li>
  ))}
</ul>

                <div style={{ marginTop: "0.9rem", textAlign: "right" }}>
                  <Link
                    href="/library"
                    style={{
                      fontSize: "0.85rem",
                      fontWeight: 600,
                      textDecoration: "none",
                      padding: "0.45rem 0.9rem",
                      borderRadius: 999,
                      border: "1px solid var(--color-nav-bg)",
                      background: "var(--color-card)",
                      color: "var(--color-text)",
                    }}
                  >
                    Zur Bibliothek →
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
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

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div
      style={{
        background: "color-mix(in oklab, var(--color-card) 96%, var(--color-bg))",
        border: "1px solid rgba(0,0,0,0.01)",
        borderRadius: 14,
        padding: "0.5rem 0.6rem 0.55rem",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        minHeight: 52,
      }}
    >
      <span style={{ opacity: 0.55, fontSize: "0.7rem" }}>{label}</span>
      <span
        style={{
          fontWeight: 600,
          fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas" : undefined,
          overflowWrap: "anywhere",
          wordBreak: "break-word",
        }}
      >
        {value || "—"}
      </span>
    </div>
  );
}

// 🔹 Neuer Button für Stripe Customer Portal
function ManageSubscriptionButton({
  onClick,
}: {
  onClick: () => Promise<void> | void;
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
        marginTop: "0.25rem",
        padding: "0.35rem 0.9rem",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.7)",
        background:
          "color-mix(in oklab, var(--color-card) 92%, rgba(0,0,0,0.12))",
        cursor: loading ? "default" : "pointer",
        fontSize: "0.8rem",
        fontWeight: 600,
        color: "var(--color-text)",
        display: "inline-flex",
        alignItems: "center",
        gap: "0.3rem",
      }}
    >
      {loading ? "Weiterleiten…" : "Abo verwalten"}
    </button>
  );
}