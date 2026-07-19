// app/library/CuratedLibrarySection.tsx
//
// RP-004E1 — Curated Library section rendered inside /library.
//
// This component is intentionally isolated from `app/library/ui.tsx` so
// the 2900-line personal-library file does not grow. It:
//
//   * Fetches GET /api/library/sessions to list active curated sessions
//     with per-user access hints.
//   * Renders three visual states per session — direct plan access,
//     active unlock, sponsored unlock required — using calm, premium
//     copy in German. No reward / ad / gamification language.
//   * On play, fetches GET /api/library/sessions/[id] and loads the
//     protected chapter URLs into the existing global player via
//     `usePlayer().loadStory`. Chapter IDs are prefixed to avoid
//     collision with user-generated Track IDs (`lib-` prefix).
//   * For locked Free sessions, opens the SponsoredUnlockInterstitial
//     modal which drives the server-authoritative start/complete
//     lifecycle. Nothing about the modal grants access — the audio
//     route always re-verifies via LibraryUnlock.
//   * Attempts a one-shot timezone capture from the browser via
//     POST /api/account/timezone on mount. Failure is silent — the
//     Library daily-limit degrades to UTC when no timezone is stored.

"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePlayer, type Chapter } from "@/app/components/player-context";
import { useSVTheme } from "@/app/components/sv-kit";
import SponsoredUnlockInterstitial from "./SponsoredUnlockInterstitial";
import { formatUnlockExpiryHint } from "./format-unlock-expiry";

// ─── Types ────────────────────────────────────────────────────────────

type AccessStatus =
  | "direct_plan_access"
  | "active_unlock"
  | "requires_sponsored_unlock";

type Access = {
  status: AccessStatus;
  unlockExpiresAt: string | null;
};

type SessionListItem = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  preset: string;
  durationSeconds: number | null;
  chapterCount: number;
  access: Access;
};

type SessionDetailChapter = {
  id: string;
  partIndex: number;
  title: string | null;
  durationSeconds: number | null;
  audioUrl: string;
};

type SessionDetail = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  preset: string;
  durationSeconds: number | null;
  access: Access;
  chapters: SessionDetailChapter[];
};

type LoadStatus = "idle" | "loading" | "ok" | "error";

type LibraryQaMode = "FREE" | "STARTER" | "PREMIUM" | "ADMIN";

type Viewer = {
  effectiveMode: LibraryQaMode;
  isAdmin: boolean;
  qaFeatureAvailable: boolean;
  timezone: string | null;
};

const QA_MODES: readonly LibraryQaMode[] = [
  "FREE",
  "STARTER",
  "PREMIUM",
  "ADMIN",
] as const;

const QA_MODE_LABELS: Record<LibraryQaMode, string> = {
  FREE: "Free",
  STARTER: "Starter",
  PREMIUM: "Premium",
  ADMIN: "Admin",
};

// ─── Presentation helpers ─────────────────────────────────────────────

const PRESET_LABELS: Record<string, string> = {
  "sleep-story": "Sleep Story",
  "kids-story": "Kids Story",
  "meditation": "Meditation",
  "classic-asmr": "Classic ASMR",
};

function labelForPreset(preset: string): string {
  return PRESET_LABELS[preset] ?? preset;
}

function formatMinutes(sec: number | null): string {
  if (!sec || !Number.isFinite(sec) || sec <= 0) return "";
  const m = Math.round(sec / 60);
  return `${m} Min`;
}

// ─── Timezone capture ─────────────────────────────────────────────────

/**
 * One-shot best-effort capture. Never blocks the catalog fetch — the
 * server route is first-write-only and idempotent, so a failure here
 * just means the daily limit degrades to UTC until a later attempt
 * succeeds.
 */
async function attemptTimezoneCapture(): Promise<void> {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz || typeof tz !== "string") return;
    await fetch("/api/account/timezone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: tz }),
      cache: "no-store",
    });
  } catch {
    // Silent — daily limit falls back to UTC in this case.
  }
}

// ─── Component ────────────────────────────────────────────────────────

type Props = {
  glassCardBg: string;
  glassCardBorder: string;
};

export default function CuratedLibrarySection({
  glassCardBg,
  glassCardBorder,
}: Props): React.ReactElement {
  const { themeCfg, themeKey } = useSVTheme();
  const isDark = themeKey === "dark";
  const { loadStory } = usePlayer();

  const [status, setStatus] = useState<LoadStatus>("idle");
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingPlayId, setPendingPlayId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string | null>>({});
  const [qaPending, setQaPending] = useState<boolean>(false);
  const [qaError, setQaError] = useState<string | null>(null);

  // Interstitial state: which session id needs the sponsored flow, if any.
  const [interstitialSessionId, setInterstitialSessionId] = useState<
    string | null
  >(null);
  const [interstitialTitle, setInterstitialTitle] = useState<string>("");
  const [interstitialDescription, setInterstitialDescription] = useState<
    string | null
  >(null);
  const timezoneCapturedRef = useRef(false);

  const loadCatalog = useCallback(async (): Promise<void> => {
    setStatus("loading");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/library/sessions", { cache: "no-store" });
      if (res.status === 401) {
        setStatus("error");
        setErrorMsg("Bitte melde dich an, um diese Session abzuspielen.");
        return;
      }
      if (!res.ok) {
        setStatus("error");
        setErrorMsg("Die Library kann gerade nicht geladen werden.");
        return;
      }
      const body = (await res.json()) as unknown;
      const data =
        body &&
        typeof body === "object" &&
        (body as { ok?: unknown }).ok === true &&
        (body as { data?: unknown }).data &&
        typeof (body as { data?: unknown }).data === "object"
          ? ((body as { data: unknown }).data as { sessions?: unknown })
          : (body as { sessions?: unknown });
      const rawSessions = Array.isArray(data?.sessions) ? data.sessions : [];
      // Optional viewer snapshot (added by the server for admin-only
      // QA plumbing). Absent viewer means: no QA panel, no timezone
      // hint. Malformed values are ignored — the UI degrades quietly.
      const rawViewer = (data as { viewer?: unknown } | undefined)?.viewer;
      if (rawViewer && typeof rawViewer === "object") {
        const v = rawViewer as Record<string, unknown>;
        const mode = v.effectiveMode;
        if (
          typeof mode === "string" &&
          (QA_MODES as readonly string[]).includes(mode)
        ) {
          setViewer({
            effectiveMode: mode as LibraryQaMode,
            isAdmin: v.isAdmin === true,
            qaFeatureAvailable: v.qaFeatureAvailable === true,
            timezone: typeof v.timezone === "string" ? v.timezone : null,
          });
        } else {
          setViewer(null);
        }
      } else {
        setViewer(null);
      }
      const parsed: SessionListItem[] = rawSessions
        .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
        .map((r) => {
          const acc = r.access as Record<string, unknown> | undefined;
          const status = (acc?.status ?? "requires_sponsored_unlock") as AccessStatus;
          return {
            id: String(r.id ?? ""),
            slug: String(r.slug ?? ""),
            title: String(r.title ?? ""),
            description:
              typeof r.description === "string" ? r.description : null,
            preset: String(r.preset ?? ""),
            durationSeconds:
              typeof r.durationSeconds === "number" ? r.durationSeconds : null,
            chapterCount:
              typeof r.chapterCount === "number" ? r.chapterCount : 0,
            access: {
              status,
              unlockExpiresAt:
                typeof acc?.unlockExpiresAt === "string"
                  ? (acc.unlockExpiresAt as string)
                  : null,
            },
          };
        })
        .filter((s) => s.id && s.title);
      setSessions(parsed);
      setStatus("ok");
    } catch {
      setStatus("error");
      setErrorMsg("Die Verbindung wurde unterbrochen. Bitte versuche es erneut.");
    }
  }, []);

  useEffect(() => {
    if (!timezoneCapturedRef.current) {
      timezoneCapturedRef.current = true;
      void attemptTimezoneCapture();
    }
    void loadCatalog();
  }, [loadCatalog]);

  /**
   * Fetch fresh session detail and hand the ordered chapters to the
   * global player. Uses "lib-" prefix so curated chapter IDs cannot
   * collide with user-generated Track IDs already in the player state.
   */
  const beginPlayback = useCallback(
    async (sessionId: string): Promise<{ ok: boolean; needsUnlock?: boolean }> => {
      setPendingPlayId(sessionId);
      setRowError((prev) => ({ ...prev, [sessionId]: null }));
      try {
        const res = await fetch(`/api/library/sessions/${sessionId}`, {
          cache: "no-store",
        });
        if (res.status === 401) {
          setRowError((prev) => ({
            ...prev,
            [sessionId]: "Bitte melde dich an, um diese Session abzuspielen.",
          }));
          return { ok: false };
        }
        if (res.status === 404) {
          setRowError((prev) => ({
            ...prev,
            [sessionId]: "Diese Session ist gerade nicht verfügbar.",
          }));
          return { ok: false };
        }
        if (!res.ok) {
          setRowError((prev) => ({
            ...prev,
            [sessionId]:
              "Diese Session kann gerade nicht geladen werden. Bitte versuche es später erneut.",
          }));
          return { ok: false };
        }
        const body = (await res.json()) as unknown;
        const wrap =
          body &&
          typeof body === "object" &&
          (body as { ok?: unknown }).ok === true &&
          (body as { data?: unknown }).data &&
          typeof (body as { data?: unknown }).data === "object"
            ? ((body as { data: unknown }).data as { session?: unknown })
            : (body as { session?: unknown });
        const s = wrap?.session as Partial<SessionDetail> | undefined;
        if (!s || !Array.isArray(s.chapters) || s.chapters.length === 0) {
          setRowError((prev) => ({
            ...prev,
            [sessionId]:
              "Diese Session kann gerade nicht geladen werden. Bitte versuche es später erneut.",
          }));
          return { ok: false };
        }
        // If access changed underneath us to requires_sponsored_unlock,
        // hand back "needs unlock" instead of loading the player. The
        // audio route would refuse the chapter anyway.
        if (s.access?.status === "requires_sponsored_unlock") {
          return { ok: false, needsUnlock: true };
        }
        const chapters: Chapter[] = (s.chapters as SessionDetailChapter[])
          .slice()
          .sort((a, b) => a.partIndex - b.partIndex)
          .map((c) => ({
            id: `lib-${c.id}`,
            url: c.audioUrl,
            title: c.title ?? `Kapitel ${c.partIndex + 1}`,
            partIndex: c.partIndex,
            durationSeconds: c.durationSeconds ?? undefined,
          }));
        loadStory(`lib-${s.id ?? sessionId}`, chapters, 0, s.title ?? "");
        return { ok: true };
      } catch {
        setRowError((prev) => ({
          ...prev,
          [sessionId]:
            "Die Verbindung wurde unterbrochen. Bitte versuche es erneut.",
        }));
        return { ok: false };
      } finally {
        setPendingPlayId((prev) => (prev === sessionId ? null : prev));
      }
    },
    [loadStory]
  );

  const onPlayClicked = useCallback(
    async (session: SessionListItem) => {
      const st = session.access.status;
      if (st === "direct_plan_access" || st === "active_unlock") {
        const result = await beginPlayback(session.id);
        if (result.needsUnlock) {
          // Stale hint — surface the sponsor flow to recover.
          setInterstitialTitle(session.title);
          setInterstitialDescription(session.description);
          setInterstitialSessionId(session.id);
          void loadCatalog();
        }
        return;
      }
      // Locked Free — open the interstitial.
      setInterstitialTitle(session.title);
      setInterstitialDescription(session.description);
      setInterstitialSessionId(session.id);
    },
    [beginPlayback, loadCatalog]
  );

  const onInterstitialSuccess = useCallback(
    async (sessionId: string) => {
      setInterstitialSessionId(null);
      // Refresh catalog so the card immediately reflects active_unlock.
      void loadCatalog();
      // Attempt playback of the newly unlocked session.
      await beginPlayback(sessionId);
    },
    [beginPlayback, loadCatalog]
  );

  const onInterstitialClose = useCallback(() => {
    setInterstitialSessionId(null);
  }, []);

  // ── Admin-only QA-mode plumbing ──────────────────────────────────────
  //
  // The server independently enforces every guard (real admin, dev
  // env, LIBRARY_QA_ACCESS_MODE_ENABLED). This client-side path is
  // purely presentational — a forged UI cannot elevate a non-admin.
  const changeQaMode = useCallback(
    async (nextMode: LibraryQaMode) => {
      if (!viewer || !viewer.qaFeatureAvailable || !viewer.isAdmin) return;
      if (qaPending) return;
      const previous = viewer.effectiveMode;
      if (previous === nextMode) return;
      setQaPending(true);
      setQaError(null);
      // Optimistic update so the segmented button feels immediate.
      setViewer((v) => (v ? { ...v, effectiveMode: nextMode } : v));
      try {
        const res = await fetch("/api/library/qa-access-mode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: nextMode }),
          cache: "no-store",
        });
        if (!res.ok) {
          // Roll back and surface a quiet inline error.
          setViewer((v) => (v ? { ...v, effectiveMode: previous } : v));
          setQaError(
            "QA-Zugriff konnte nicht geändert werden. Bitte erneut versuchen."
          );
          return;
        }
        // Refresh Curated-Library state — access hints, expiry lines
        // and sponsor prompts all depend on the new effective mode.
        // We do NOT reload the entire application; just the section.
        void loadCatalog();
      } catch {
        setViewer((v) => (v ? { ...v, effectiveMode: previous } : v));
        setQaError(
          "Verbindungsproblem. QA-Zugriff wurde nicht geändert."
        );
      } finally {
        setQaPending(false);
      }
    },
    [viewer, qaPending, loadCatalog]
  );

  // ── Styles ──────────────────────────────────────────────────────────

  const cardStyle: React.CSSProperties = useMemo(
    () => ({
      padding: 16,
      borderRadius: 16,
      border: `1px solid ${glassCardBorder}`,
      background: glassCardBg,
      backdropFilter: "blur(20px)",
      WebkitBackdropFilter: "blur(20px)",
      display: "flex",
      alignItems: "center",
      gap: 14,
    }),
    [glassCardBg, glassCardBorder]
  );

  const primaryBtn: React.CSSProperties = useMemo(
    () => ({
      padding: "10px 18px",
      borderRadius: 999,
      border: "none",
      background: themeCfg.primaryButtonBg,
      color: themeCfg.primaryButtonText,
      fontWeight: 700,
      fontSize: "0.875rem",
      cursor: "pointer",
      whiteSpace: "nowrap",
    }),
    [themeCfg.primaryButtonBg, themeCfg.primaryButtonText]
  );

  const secondaryBtn: React.CSSProperties = useMemo(
    () => ({
      padding: "9px 16px",
      borderRadius: 999,
      border: `1px solid ${themeCfg.secondaryButtonBorder}`,
      background: themeCfg.secondaryButtonBg,
      color: themeCfg.secondaryButtonText,
      fontWeight: 600,
      fontSize: "0.875rem",
      cursor: "pointer",
      whiteSpace: "nowrap",
    }),
    [
      themeCfg.secondaryButtonBg,
      themeCfg.secondaryButtonBorder,
      themeCfg.secondaryButtonText,
    ]
  );

  const badgeStyle: React.CSSProperties = {
    fontSize: "0.72rem",
    padding: "2px 8px",
    borderRadius: 999,
    background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
    border: `1px solid ${glassCardBorder}`,
    fontWeight: 700,
    color: themeCfg.uiSoftText,
    letterSpacing: "0.02em",
  };

  // ── Render ──────────────────────────────────────────────────────────

  const showQaPanel = !!viewer && viewer.qaFeatureAvailable && viewer.isAdmin;

  return (
    <section aria-label="Kuratierte Library" style={{ marginTop: 8 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <h2
          style={{
            fontSize: "1.05rem",
            fontWeight: 700,
            color: themeCfg.uiText,
            margin: 0,
          }}
        >
          Kuratierte Sessions
        </h2>
        <span
          style={{ fontSize: "0.78rem", color: themeCfg.uiSoftText }}
        >
          Von SoftVibe ausgewählt
        </span>
      </div>
      {showQaPanel && viewer && (
        <div
          style={{
            marginBottom: 12,
            padding: 10,
            borderRadius: 12,
            border: `1px solid ${glassCardBorder}`,
            background: glassCardBg,
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
          aria-label="Interner QA-Zugriff — nur für Admins"
        >
          <span
            style={{
              fontSize: "0.75rem",
              fontWeight: 700,
              color: themeCfg.uiSoftText,
              letterSpacing: "0.02em",
            }}
          >
            QA-Zugriff (intern)
          </span>
          <div
            role="radiogroup"
            aria-label="Effektiver Library-Zugriff für QA"
            style={{
              display: "inline-flex",
              gap: 4,
              padding: 3,
              borderRadius: 999,
              border: `1px solid ${glassCardBorder}`,
              background: isDark
                ? "rgba(255,255,255,0.04)"
                : "rgba(0,0,0,0.03)",
            }}
          >
            {QA_MODES.map((m) => {
              const active = viewer.effectiveMode === m;
              return (
                <button
                  key={m}
                  role="radio"
                  aria-checked={active}
                  type="button"
                  disabled={qaPending}
                  onClick={() => void changeQaMode(m)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: "none",
                    background: active
                      ? themeCfg.primaryButtonBg
                      : "transparent",
                    color: active
                      ? themeCfg.primaryButtonText
                      : themeCfg.uiText,
                    fontSize: "0.78rem",
                    fontWeight: 700,
                    cursor: qaPending ? "wait" : "pointer",
                    minWidth: 64,
                  }}
                >
                  {QA_MODE_LABELS[m]}
                </button>
              );
            })}
          </div>
          {qaError && (
            <span
              role="alert"
              style={{ fontSize: "0.78rem", color: themeCfg.uiText }}
            >
              {qaError}
            </span>
          )}
        </div>
      )}

      {status === "loading" && (
        <div
          style={{
            padding: 16,
            color: themeCfg.uiSoftText,
            fontSize: "0.9rem",
          }}
          aria-live="polite"
        >
          Wird geladen…
        </div>
      )}

      {status === "error" && (
        <div
          style={{
            padding: 16,
            borderRadius: 12,
            border: `1px solid ${glassCardBorder}`,
            background: glassCardBg,
            color: themeCfg.uiText,
            fontSize: "0.9rem",
          }}
          role="alert"
        >
          {errorMsg ?? "Die Library kann gerade nicht geladen werden."}
          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              onClick={() => void loadCatalog()}
              style={secondaryBtn}
            >
              Erneut versuchen
            </button>
          </div>
        </div>
      )}

      {status === "ok" && sessions.length === 0 && (
        <div
          style={{
            padding: 16,
            color: themeCfg.uiSoftText,
            fontSize: "0.9rem",
          }}
        >
          Aktuell sind keine kuratierten Sessions verfügbar.
        </div>
      )}

      {status === "ok" && sessions.length > 0 && (
        <div style={{ display: "grid", gap: 10 }}>
          {sessions.map((s) => {
            const st = s.access.status;
            const busy = pendingPlayId === s.id;
            const rowMsg = rowError[s.id] ?? null;
            const durationLabel = formatMinutes(s.durationSeconds);
            const unlockHint =
              st === "active_unlock"
                ? formatUnlockExpiryHint(
                    s.access.unlockExpiresAt,
                    viewer?.timezone ?? null
                  )
                : null;

            let stateNote: string | null = null;
            if (st === "requires_sponsored_unlock") {
              stateNote = "Kurze Freischaltung vor dem Abspielen";
            } else if (st === "active_unlock") {
              // Prefer the explicit expiry-time line when available;
              // fall back to the terse "Freigeschaltet" note.
              stateNote = unlockHint ?? "Freigeschaltet";
            }

            return (
              <div key={s.id} style={cardStyle}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      marginBottom: 4,
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={badgeStyle}>{labelForPreset(s.preset)}</span>
                    {durationLabel && (
                      <span
                        style={{
                          fontSize: "0.75rem",
                          color: themeCfg.uiSoftText,
                          fontWeight: 600,
                        }}
                      >
                        {durationLabel}
                      </span>
                    )}
                    {s.chapterCount > 0 && (
                      <span
                        style={{
                          fontSize: "0.75rem",
                          color: themeCfg.uiSoftText,
                          fontWeight: 600,
                        }}
                      >
                        {s.chapterCount} Kapitel
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontWeight: 700,
                      color: themeCfg.uiText,
                      fontSize: "0.98rem",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {s.title}
                  </div>
                  {s.description && (
                    <div
                      style={{
                        fontSize: "0.82rem",
                        color: themeCfg.uiSoftText,
                        marginTop: 4,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {s.description}
                    </div>
                  )}
                  {stateNote && (
                    <div
                      style={{
                        fontSize: "0.76rem",
                        color: themeCfg.uiSoftText,
                        marginTop: 6,
                      }}
                    >
                      {stateNote}
                    </div>
                  )}
                  {rowMsg && (
                    <div
                      role="alert"
                      style={{
                        fontSize: "0.78rem",
                        color: themeCfg.uiText,
                        marginTop: 6,
                      }}
                    >
                      {rowMsg}
                    </div>
                  )}
                </div>
                <div
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onPlayClicked(s)}
                    style={{
                      ...(st === "requires_sponsored_unlock"
                        ? secondaryBtn
                        : primaryBtn),
                      opacity: busy ? 0.5 : 1,
                      cursor: busy ? "wait" : "pointer",
                    }}
                    aria-label={
                      st === "requires_sponsored_unlock"
                        ? `${s.title} freischalten und abspielen`
                        : `${s.title} abspielen`
                    }
                  >
                    {busy
                      ? "…"
                      : st === "requires_sponsored_unlock"
                      ? "Freischalten"
                      : "Abspielen"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {interstitialSessionId && (
        <SponsoredUnlockInterstitial
          librarySessionId={interstitialSessionId}
          sessionTitle={interstitialTitle}
          sessionDescription={interstitialDescription}
          timezone={viewer?.timezone ?? null}
          onSuccess={() => void onInterstitialSuccess(interstitialSessionId)}
          onClose={onInterstitialClose}
        />
      )}
    </section>
  );
}
