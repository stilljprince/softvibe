// app/billing/page.tsx
"use client";

import { useState } from "react";

type PlanId = "starter" | "pro" | "ultra";

type Plan = {
  id: PlanId;
  label: string;
  priceId: string;
  priceLabel: string;
  credits: number;
};

const PLANS: Plan[] = [
  {
    id: "starter",
    label: "Starter",
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_STARTER ?? "",
    priceLabel: "5 € / Monat",
    credits: 5000,
  },
  {
    id: "pro",
    label: "Pro",
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO ?? "",
    priceLabel: "15 € / Monat",
    credits: 20000,
  },
  {
    id: "ultra",
    label: "Ultra",
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_ULTRA ?? "",
    priceLabel: "60 € / Monat",
    credits: 100000,
  },
];

export default function BillingPage() {
  const [loadingId, setLoadingId] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout(planId: PlanId, priceId: string) {
    setError(null);
    setLoadingId(planId);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: planId,
          priceId,
          mode: "subscription", // 🔴 wichtig: echtes Abo
        }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as
          | { message?: string; error?: string }
          | null;

        const msg =
          err?.message ??
          (err?.error ? `Fehler: ${err.error}` : `Fehler: ${res.status}`);

        setError(msg);
        return;
      }

      const data = (await res.json()) as {
        ok: boolean;
        data?: { url?: string };
      };

      const url = data?.data?.url;
      if (!url) {
        setError("Keine Checkout-URL erhalten.");
        return;
      }

      window.location.href = url;
    } catch (e) {
      console.error(e);
      setError("Netzwerkfehler.");
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <main style={{ maxWidth: 840, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 800, marginBottom: 16 }}>
        SoftVibe Credits
      </h1>

      <p style={{ marginBottom: 8, opacity: 0.8 }}>
        Wähle ein Paket, erhalte monatlich Credits und generiere deine
        personalisierten ASMR-Tracks.
      </p>
      <p style={{ marginBottom: 24, fontSize: "0.85rem", opacity: 0.7 }}>
        Deine Abrechnung läuft über Stripe. Du kannst dein Abonnement jederzeit
        im Kundenportal verwalten oder kündigen.
      </p>

      {error && (
        <p
          style={{
            color: "#b91c1c",
            fontWeight: 600,
            marginBottom: 16,
          }}
        >
          {error}
        </p>
      )}

      <div style={{ display: "grid", gap: 16 }}>
        {PLANS.map((p) => {
          const envMissing = !p.priceId;
          const isLoading = loadingId === p.id;

          return (
            <section
              key={p.id}
              style={{
                borderRadius: 16,
                border: "1px solid var(--color-nav-bg)",
                padding: 16,
                background: "var(--color-card)",
              }}
            >
              <h2
                style={{
                  fontSize: "1.2rem",
                  fontWeight: 700,
                  marginBottom: 4,
                }}
              >
                {p.label}
              </h2>
              <p style={{ marginBottom: 4 }}>{p.priceLabel}</p>
              <p
                style={{
                  fontSize: "0.9rem",
                  opacity: 0.8,
                  marginBottom: 12,
                }}
              >
                {p.credits.toLocaleString("de-DE")} Credits pro Monat.
              </p>

              {envMissing && (
                <p
                  style={{
                    fontSize: "0.8rem",
                    opacity: 0.7,
                    marginBottom: 8,
                  }}
                >
                  Dieser Plan ist aktuell nicht verfügbar
                  (Stripe-Preis-ID fehlt in der Umgebungsvariable).
                </p>
              )}

              <button
                type="button"
                onClick={() => void startCheckout(p.id, p.priceId)}
                disabled={envMissing || isLoading}
                className="sv-btn sv-btn--primary"
              >
                {isLoading ? "Weiterleitung…" : "Jetzt auswählen"}
              </button>
            </section>
          );
        })}
      </div>
    </main>
  );
}