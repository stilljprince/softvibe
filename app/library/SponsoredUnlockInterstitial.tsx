// app/library/SponsoredUnlockInterstitial.tsx
//
// RP-004E1 — Simulated Sponsored Unlock interstitial modal.
//
// Presentation shell for the server-owned event lifecycle:
//
//   1. On mount, POST /api/library/sponsored/simulated/start.
//   2. Show a calm SoftVibe Early Access acknowledgement, driven by
//      the SERVER's eligibleAt (never a client timer as source of truth).
//   3. When eligibleAt is reached, enable the "Session öffnen" button.
//   4. On click, POST /api/library/sponsored/simulated/complete.
//   5. On completion, transition to the "unlocked" detail phase — a
//      calm session-detail surface that shows title, description and a
//      prominent "Freigeschaltet bis HH:MM Uhr" line so the FREE-plan
//      unlock duration is discoverable before playback begins.
//   6. On the user's [Abspielen] click, hand back to the caller which
//      refetches session state and starts playback.
//
// Non-goals:
//
//   * Grant access locally. If the network call succeeds but the
//     resulting audio stream still returns UNLOCK_REQUIRED, the audio
//     route wins — nothing here can shortcut that.
//   * Impersonate a real advertiser. The copy is honest: "Diese Session
//     wird im Early Access durch SoftVibe unterstützt." No third-party
//     name, no fake reward.
//   * Persist unlock state in localStorage. A page reload during the
//     interstitial reopens with a fresh (or reused) event.

"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSVTheme } from "@/app/components/sv-kit";
import { formatUnlockExpiryHint } from "./format-unlock-expiry";

type StartResp =
  | {
      outcome: "direct_plan_access";
      plan: string;
      librarySessionId: string;
    }
  | {
      outcome: "active_unlock";
      librarySessionId: string;
      unlockExpiresAt: string;
    }
  | {
      outcome: "event_created" | "event_reused";
      eventId: string;
      librarySessionId: string;
      eligibleAt: string;
      expiresAt: string;
      minimumDurationSeconds: number;
    };

type CompleteResp =
  | {
      outcome: "created" | "reused";
      unlockId: string;
      librarySessionId: string;
      unlockedAt: string;
      expiresAt: string;
    }
  | {
      outcome: "direct_plan_access";
      plan: string;
      librarySessionId: string;
    };

type Phase =
  | "starting"
  | "watching" // interstitial visible, waiting for eligibleAt
  | "ready"    // eligibleAt reached, waiting for user action
  | "completing"
  | "unlocked" // FREE unlock granted, showing session detail before playback
  | "success"  // paid caller — skip detail and hand back immediately
  | "error";

type Props = {
  librarySessionId: string;
  sessionTitle: string;
  sessionDescription: string | null;
  timezone: string | null;
  onSuccess: () => void;
  onClose: () => void;
};

/** Map server error codes to calm German copy. */
function messageForError(code: string): string {
  switch (code) {
    case "SIMULATION_DISABLED":
      return "Die kostenlose Freischaltung ist momentan nicht verfügbar.";
    case "SESSION_NOT_FOUND":
    case "EVENT_NOT_FOUND":
      return "Diese Session ist gerade nicht verfügbar.";
    case "SESSION_INACTIVE":
      return "Diese Session ist gerade nicht verfügbar.";
    case "Unauthorized":
    case "USER_NOT_FOUND":
      return "Bitte melde dich an, um diese Session abzuspielen.";
    case "EVENT_TOO_EARLY":
      return "Die Freischaltung ist noch nicht abgeschlossen.";
    case "EVENT_EXPIRED":
      return "Die Freischaltung ist abgelaufen. Bitte starte sie erneut.";
    case "EVENT_CANCELLED":
      return "Diese Freischaltung wurde beendet.";
    case "DAILY_UNLOCK_LIMIT_REACHED":
      return "Du hast deine drei kostenlosen Library-Sessions für heute bereits freigeschaltet.";
    case "CONCURRENCY_CONFLICT":
      return "Bitte versuche es kurz noch einmal.";
    case "RATE_LIMITED":
      return "Bitte warte einen Moment und versuche es erneut.";
    default:
      return "Die Verbindung wurde unterbrochen. Bitte versuche es erneut.";
  }
}

/** Parse the { ok, data | error } envelope produced by lib/api.ts. */
function parseEnvelope<T>(json: unknown): { ok: true; data: T } | { ok: false; error: string } {
  if (json && typeof json === "object") {
    const j = json as { ok?: unknown; data?: unknown; error?: unknown };
    if (j.ok === true && j.data && typeof j.data === "object") {
      return { ok: true, data: j.data as T };
    }
    if (j.ok === false) {
      return { ok: false, error: typeof j.error === "string" ? j.error : "UNKNOWN" };
    }
  }
  return { ok: false, error: "UNKNOWN" };
}

export default function SponsoredUnlockInterstitial({
  librarySessionId,
  sessionTitle,
  sessionDescription,
  timezone,
  onSuccess,
  onClose,
}: Props): React.ReactElement {
  const { themeCfg, themeKey } = useSVTheme();
  const isDark = themeKey === "dark";

  const [phase, setPhase] = useState<Phase>("starting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [eligibleAtMs, setEligibleAtMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  // Server-authoritative unlock expiry captured on start (active_unlock)
  // or complete (created / reused). Drives the calm "Freigeschaltet bis
  // HH:MM Uhr" line rendered in the "unlocked" phase.
  const [unlockExpiresAt, setUnlockExpiresAt] = useState<string | null>(null);

  // Focus trap: keep focus inside the modal while it's mounted.
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const openButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // ── Start the event on mount ─────────────────────────────────────────

  const startCall = useCallback(async () => {
    setPhase("starting");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/library/sponsored/simulated/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ librarySessionId }),
        cache: "no-store",
      });
      const body = await res.json();
      const parsed = parseEnvelope<StartResp>(body);
      if (!parsed.ok) {
        setErrorMsg(messageForError(parsed.error));
        setPhase("error");
        return;
      }
      const d = parsed.data;
      // Paid caller — no FREE unlock exists, so no expiry to surface.
      // Skip the interstitial entirely and hand playback back to the
      // caller in one motion.
      if (d.outcome === "direct_plan_access") {
        setPhase("success");
        onSuccess();
        return;
      }
      // FREE caller who already holds an active unlock (e.g. reopened
      // the modal after a race). Show the same session-detail phase we
      // use after a fresh complete so the expiry stays discoverable.
      if (d.outcome === "active_unlock") {
        setUnlockExpiresAt(d.unlockExpiresAt);
        setPhase("unlocked");
        return;
      }
      // event_created / event_reused
      setEventId(d.eventId);
      const eligibleMs = Date.parse(d.eligibleAt);
      setEligibleAtMs(Number.isFinite(eligibleMs) ? eligibleMs : Date.now());
      setPhase("watching");
    } catch {
      setErrorMsg(
        "Die Verbindung wurde unterbrochen. Bitte versuche es erneut."
      );
      setPhase("error");
    }
  }, [librarySessionId, onSuccess]);

  useEffect(() => {
    void startCall();
  }, [startCall]);

  // ── Tick a display clock while watching ──────────────────────────────
  useEffect(() => {
    if (phase !== "watching") return;
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [phase]);

  // Promote watching → ready when eligibleAt is reached.
  useEffect(() => {
    if (phase !== "watching") return;
    if (eligibleAtMs === null) return;
    if (nowMs >= eligibleAtMs) setPhase("ready");
  }, [phase, eligibleAtMs, nowMs]);

  // ── Complete on user action ─────────────────────────────────────────

  const onCompleteClicked = useCallback(async () => {
    if (!eventId) return;
    setPhase("completing");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/library/sponsored/simulated/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId }),
        cache: "no-store",
      });
      const body = await res.json();
      const parsed = parseEnvelope<CompleteResp>(body);
      if (!parsed.ok) {
        setErrorMsg(messageForError(parsed.error));
        setPhase("error");
        return;
      }
      const d = parsed.data;
      // Paid effective plan (e.g. QA-mode flip) — the block would be
      // irrelevant to a non-FREE caller. Skip the detail phase.
      if (d.outcome === "direct_plan_access") {
        setPhase("success");
        onSuccess();
        return;
      }
      // FREE unlock granted. Hold the modal in the calm detail phase so
      // the "Freigeschaltet bis HH:MM Uhr" line is visible before the
      // user starts playback.
      setUnlockExpiresAt(d.expiresAt);
      setPhase("unlocked");
    } catch {
      setErrorMsg(
        "Die Verbindung wurde unterbrochen. Bitte versuche es erneut."
      );
      setPhase("error");
    }
  }, [eventId, onSuccess]);

  // ── Keyboard: Escape closes (never counts as completion) ─────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      // Focus trap: keep focus inside the dialog on Tab.
      if (e.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled])"
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Initial focus. Prefer the primary action once ready or once the
  // unlock detail phase surfaces the [Abspielen] button; otherwise the
  // close/cancel action so the user can always dismiss.
  useEffect(() => {
    if ((phase === "ready" || phase === "unlocked") && openButtonRef.current) {
      openButtonRef.current.focus();
    } else if (closeButtonRef.current) {
      closeButtonRef.current.focus();
    }
  }, [phase]);

  // Prevent background scroll while the modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // ── Derived progress (for the calm progress bar) ─────────────────────

  const progress = useMemo(() => {
    if (phase !== "watching" || eligibleAtMs === null) return null;
    // We compute the total duration from the difference between the
    // server-issued eligibleAt and mount time (approximated by first
    // observation); this is a display aid only — the server still owns
    // the eligibility decision.
    const totalMs = Math.max(1, eligibleAtMs - (nowMs - 8_000));
    const remaining = Math.max(0, eligibleAtMs - nowMs);
    const done = Math.max(0, Math.min(1, 1 - remaining / totalMs));
    return { done, remaining };
  }, [phase, eligibleAtMs, nowMs]);

  // ── Styles ──────────────────────────────────────────────────────────

  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: isDark ? "rgba(2,6,23,0.72)" : "rgba(15,23,42,0.55)",
    backdropFilter: "blur(6px)",
    zIndex: 1000,
    display: "grid",
    placeItems: "center",
    padding: 20,
  };

  const dialogStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 460,
    borderRadius: 20,
    background: isDark ? "rgba(15,23,42,0.95)" : "rgba(255,255,255,0.98)",
    border: `1px solid ${themeCfg.cardBorder}`,
    boxShadow: themeCfg.cardShadow,
    padding: 24,
    color: themeCfg.uiText,
  };

  const primaryBtn: React.CSSProperties = {
    padding: "12px 22px",
    borderRadius: 999,
    border: "none",
    background: themeCfg.primaryButtonBg,
    color: themeCfg.primaryButtonText,
    fontWeight: 700,
    fontSize: "0.9rem",
    cursor: "pointer",
  };

  const secondaryBtn: React.CSSProperties = {
    padding: "10px 18px",
    borderRadius: 999,
    border: `1px solid ${themeCfg.secondaryButtonBorder}`,
    background: themeCfg.secondaryButtonBg,
    color: themeCfg.secondaryButtonText,
    fontWeight: 600,
    fontSize: "0.9rem",
    cursor: "pointer",
  };

  // ── Content per phase ───────────────────────────────────────────────

  const cancelLabel = "Abbrechen";
  const openLabel = "Session öffnen";
  const playLabel = "Abspielen";

  // Calm dynamic expiry line, reusing the same formatter that renders
  // the small card hint. Returns null if unlockExpiresAt is missing or
  // already in the past — the block simply disappears in that edge case.
  const expiryHint = formatUnlockExpiryHint(unlockExpiresAt, timezone);
  const trimmedDescription =
    sessionDescription && sessionDescription.trim().length > 0
      ? sessionDescription
      : null;

  let bodyContent: React.ReactElement;
  if (phase === "starting") {
    bodyContent = (
      <p style={{ margin: 0, color: themeCfg.uiSoftText }}>
        Vorbereitung läuft…
      </p>
    );
  } else if (phase === "watching") {
    bodyContent = (
      <>
        <p style={{ margin: "0 0 8px 0", color: themeCfg.uiSoftText }}>
          Diese Session wird im Early Access durch SoftVibe unterstützt.
        </p>
        <p style={{ margin: 0, color: themeCfg.uiSoftText, fontSize: "0.85rem" }}>
          Der Öffnen-Button erscheint gleich.
        </p>
        {progress && (
          <div
            aria-hidden
            style={{
              marginTop: 16,
              height: 4,
              width: "100%",
              borderRadius: 999,
              background: isDark
                ? "rgba(255,255,255,0.08)"
                : "rgba(0,0,0,0.06)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${Math.round(progress.done * 100)}%`,
                height: "100%",
                background: themeCfg.uiText,
                opacity: 0.55,
                transition: "width 220ms linear",
              }}
            />
          </div>
        )}
      </>
    );
  } else if (phase === "ready") {
    bodyContent = (
      <>
        <p style={{ margin: "0 0 6px 0", color: themeCfg.uiSoftText }}>
          Diese Session wird im Early Access durch SoftVibe unterstützt.
        </p>
        <p style={{ margin: 0, color: themeCfg.uiSoftText, fontSize: "0.85rem" }}>
          Freischaltung bereit.
        </p>
      </>
    );
  } else if (phase === "completing") {
    bodyContent = (
      <p style={{ margin: 0, color: themeCfg.uiSoftText }}>
        Freischaltung wird abgeschlossen…
      </p>
    );
  } else if (phase === "unlocked") {
    // Calm, minimal session-detail surface shown between the successful
    // FREE unlock and the user's [Abspielen] click. The description
    // context lands right below the h2 title; the unlock-status block
    // (subtle contained surface, not a warning colour) makes the expiry
    // duration discoverable in the position of the primary playback
    // action.
    bodyContent = (
      <>
        {trimmedDescription && (
          <p
            style={{
              margin: "0 0 14px 0",
              color: themeCfg.uiSoftText,
              fontSize: "0.9rem",
              lineHeight: 1.5,
            }}
          >
            {trimmedDescription}
          </p>
        )}
        {expiryHint && (
          <div
            role="group"
            aria-label="Freischaltungsdauer"
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              border: `1px solid ${themeCfg.cardBorder}`,
              background: isDark
                ? "rgba(255,255,255,0.04)"
                : "rgba(15,23,42,0.03)",
            }}
          >
            <div
              style={{
                fontSize: "0.92rem",
                fontWeight: 600,
                color: themeCfg.uiText,
              }}
            >
              {expiryHint}
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: "0.82rem",
                color: themeCfg.uiSoftText,
                lineHeight: 1.5,
              }}
            >
              Du kannst diese Session bis dahin jederzeit weiterhören.
            </div>
          </div>
        )}
      </>
    );
  } else if (phase === "success") {
    bodyContent = (
      <p style={{ margin: 0, color: themeCfg.uiSoftText }}>Erfolgreich.</p>
    );
  } else {
    bodyContent = (
      <p style={{ margin: 0, color: themeCfg.uiText }} role="alert">
        {errorMsg ?? "Die Verbindung wurde unterbrochen. Bitte versuche es erneut."}
      </p>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sponsored-title"
      style={overlayStyle}
      onClick={(e) => {
        // Backdrop click cancels (never grants access).
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={dialogStyle} ref={dialogRef}>
        <h2
          id="sponsored-title"
          style={{
            margin: "0 0 6px 0",
            fontSize: "1.05rem",
            fontWeight: 700,
            color: themeCfg.uiText,
          }}
        >
          {sessionTitle || "Kurze Freischaltung"}
        </h2>
        <div style={{ minHeight: 72, marginTop: 4 }}>{bodyContent}</div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 20,
          }}
        >
          {phase === "error" ? (
            <>
              <button
                type="button"
                ref={closeButtonRef}
                onClick={onClose}
                style={secondaryBtn}
              >
                Schließen
              </button>
              <button
                type="button"
                ref={openButtonRef}
                onClick={() => void startCall()}
                style={primaryBtn}
              >
                Erneut versuchen
              </button>
            </>
          ) : phase === "success" ? (
            <button
              type="button"
              ref={closeButtonRef}
              onClick={onClose}
              style={primaryBtn}
            >
              Schließen
            </button>
          ) : phase === "unlocked" ? (
            <>
              <button
                type="button"
                ref={closeButtonRef}
                onClick={onClose}
                style={secondaryBtn}
              >
                Schließen
              </button>
              <button
                type="button"
                ref={openButtonRef}
                onClick={onSuccess}
                style={primaryBtn}
              >
                {playLabel}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                ref={closeButtonRef}
                onClick={onClose}
                disabled={phase === "completing"}
                style={{
                  ...secondaryBtn,
                  opacity: phase === "completing" ? 0.5 : 1,
                  cursor: phase === "completing" ? "wait" : "pointer",
                }}
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                ref={openButtonRef}
                onClick={() => void onCompleteClicked()}
                disabled={phase !== "ready"}
                style={{
                  ...primaryBtn,
                  opacity: phase === "ready" ? 1 : 0.4,
                  cursor: phase === "ready" ? "pointer" : "not-allowed",
                }}
              >
                {phase === "completing" ? "…" : openLabel}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
