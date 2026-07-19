// app/library/format-unlock-expiry.ts
//
// RP-004E1 — Shared calm expiry-time formatter for FREE-plan Curated
// Library unlocks.
//
// Renders "Freigeschaltet bis HH:MM Uhr" in the user's server-captured
// IANA timezone when available, falling back to the browser's default
// zone when no timezone is stored or when the stored zone is unknown to
// this browser's ICU snapshot. Whole minutes only — a per-second
// countdown would be visually noisy in a calm Library surface.
//
// Returns null when the input is missing, unparseable, or already in
// the past. The card hint and the session-detail popup both use this
// function so a single formatting definition drives both surfaces.

export function formatUnlockExpiryHint(
  iso: string | null,
  timezone: string | null | undefined
): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  if (t - Date.now() <= 0) return null;
  try {
    const fmt = new Intl.DateTimeFormat("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timezone && timezone.length > 0 ? timezone : undefined,
    });
    return `Freigeschaltet bis ${fmt.format(new Date(t))} Uhr`;
  } catch {
    const fmt = new Intl.DateTimeFormat("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `Freigeschaltet bis ${fmt.format(new Date(t))} Uhr`;
  }
}
