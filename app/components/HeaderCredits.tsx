// app/components/HeaderCredits.tsx
"use client";

import { useEffect, useState } from "react";
import type React from "react";

type Summary = {
  credits: number;
  isAdmin: boolean;
  hasSubscription: boolean;
};

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
          json && json.ok === true && json.data ? json.data : json;

        if (payload && typeof payload === "object" && "credits" in payload) {
          setData(payload as Summary);
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

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={pillStyle}>
        Credits:&nbsp;{data.isAdmin ? "∞" : data.credits}
      </span>
      {!data.isAdmin && (
        <a href="/billing" style={upgradeStyle}>
          Aufladen
        </a>
      )}
    </div>
  );
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

const upgradeStyle: React.CSSProperties = {
  padding: "0.25rem 0.7rem",
  borderRadius: 999,
  border: "1px solid var(--color-accent)",
  background: "var(--color-accent)",
  color: "#fff",
  fontSize: "0.8rem",
  fontWeight: 600,
  textDecoration: "none",
  whiteSpace: "nowrap",
};