// app/components/HeaderCredits.tsx
//
// Compact plan-aware entitlement pill for the top-right of app headers.
// Reads the resolved-entitlement snapshot from /api/account/summary and
// mirrors the Account page's plan-aware display:
//   - Admin  → "∞ Custom Minutes"
//   - FREE   → remaining Free-Generations (probes)
//   - Paid   → remaining Custom Minutes
//
// The legacy component name is preserved to avoid a broad import rename.
// It never renders the legacy "Credits" balance or a top-up affordance.

"use client";

import { useEffect, useState } from "react";
import type React from "react";
import type { EntitlementsView } from "@/lib/entitlement-view";

type Summary = {
  isAdmin: boolean;
  hasSubscription: boolean;
  entitlements: EntitlementsView | null;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function parseEntitlements(raw: unknown): EntitlementsView | null {
  if (!isRecord(raw)) return null;
  const plan = raw.plan;
  const mm = raw.monthlyMinutes;
  const pr = raw.probes;
  const lib = raw.library;
  if (
    (plan === "FREE" || plan === "STARTER" || plan === "PREMIUM") &&
    isRecord(mm) &&
    typeof mm.allowance === "number" &&
    typeof mm.used === "number" &&
    typeof mm.reserved === "number" &&
    typeof mm.remaining === "number" &&
    isRecord(pr) &&
    typeof pr.lifetimeLimit === "number" &&
    typeof pr.used === "number" &&
    typeof pr.remaining === "number" &&
    typeof pr.canUse === "boolean" &&
    isRecord(lib) &&
    typeof lib.hasDirectAccess === "boolean"
  ) {
    return {
      plan,
      monthlyMinutes: {
        allowance: mm.allowance,
        used: mm.used,
        reserved: mm.reserved,
        remaining: mm.remaining,
      },
      probes: {
        lifetimeLimit: pr.lifetimeLimit,
        used: pr.used,
        remaining: pr.remaining,
        canUse: pr.canUse,
      },
      library: { hasDirectAccess: lib.hasDirectAccess },
    };
  }
  return null;
}

export default function HeaderCredits() {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/account/summary", { cache: "no-store" });
        if (!res.ok) {
          setLoading(false);
          return;
        }
        const json = await res.json();
        const payload: unknown =
          json && typeof json === "object" && "ok" in json && (json as { ok?: unknown }).ok === true
            ? (json as { data?: unknown }).data
            : json;

        if (isRecord(payload)) {
          setData({
            isAdmin: !!payload.isAdmin,
            hasSubscription: !!payload.hasSubscription,
            entitlements: parseEntitlements(payload.entitlements),
          });
        } else {
          setData(null);
        }
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading || !data) return null;

  const label = renderEntitlementLabel(data);
  if (!label) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={pillStyle} aria-live="polite">{label}</span>
    </div>
  );
}

export function renderEntitlementLabel(data: Summary): string | null {
  if (data.isAdmin) return "∞ Custom Minutes";
  const ent = data.entitlements;
  if (!ent) return null;
  if (ent.plan === "FREE") {
    const remaining = Math.max(0, ent.probes.remaining);
    if (remaining === 1) return "1 Freie Generierung";
    return `${remaining} Freie Generierungen`;
  }
  const remainingMinutes = Math.max(0, ent.monthlyMinutes.remaining);
  return `${remainingMinutes} Custom Minutes`;
}

const pillStyle: React.CSSProperties = {
  padding: "0.25rem 0.7rem",
  borderRadius: 999,
  border: "1px solid var(--color-nav-bg)",
  background: "color-mix(in oklab, var(--color-card) 85%, var(--color-accent) 15%)",
  fontSize: "0.8rem",
  fontWeight: 600,
  color: "var(--color-text)",
  whiteSpace: "nowrap",
};
