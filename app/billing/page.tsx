// app/billing/page.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import SVScene from "@/app/components/sv-scene";
import { useSVTheme, SVHeader } from "@/app/components/sv-kit";

type PlanId = "starter" | "pro" | "ultra";

type Plan = {
  id: PlanId;
  label: string;
  tagline: string;
  priceId: string;
  price: string;
  credits: number;
  recommended?: boolean;
};

const PLANS: Plan[] = [
  {
    id: "starter",
    label: "Starter",
    tagline: "Zum Kennenlernen",
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_STARTER ?? "",
    price: "5 €",
    credits: 5_000,
  },
  {
    id: "pro",
    label: "Pro",
    tagline: "Für regelmäßige Nutzung",
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO ?? "",
    price: "15 €",
    credits: 20_000,
    recommended: true,
  },
  {
    id: "ultra",
    label: "Ultra",
    tagline: "Für intensive Nutzung",
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_ULTRA ?? "",
    price: "60 €",
    credits: 100_000,
  },
];

export default function BillingPage() {
  const { themeKey, themeCfg, cycleTheme, logoSrc } = useSVTheme();
  const [loadingId, setLoadingId] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout(planId: PlanId, priceId: string) {
    setError(null);
    setLoadingId(planId);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planId, priceId, mode: "subscription" }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as
          | { message?: string; error?: string }
          | null;
        setError(
          err?.message ?? (err?.error ? `Fehler: ${err.error}` : `Fehler: ${res.status}`)
        );
        return;
      }

      const data = (await res.json()) as { ok: boolean; data?: { url?: string } };
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
    <SVScene theme={themeKey}>
      {/* Logo click cycles the theme — consistent with generate page */}
      <SVHeader
        variant="app"
        logoSrc={logoSrc}
        onLogoClick={cycleTheme}
        right={
          <Link
            href="/account"
            style={{
              fontSize: "0.85rem",
              fontWeight: 600,
              color: themeCfg.uiSoftText,
              textDecoration: "none",
              padding: "0.4rem 0.85rem",
              borderRadius: 999,
              background: themeCfg.secondaryButtonBg,
              border: `1px solid ${themeCfg.secondaryButtonBorder}`,
            }}
          >
            ← Konto
          </Link>
        }
      />

      <main
        style={{
          minHeight: "100vh",
          padding: "100px 24px 56px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {/* Page header */}
        <div style={{ textAlign: "center", maxWidth: 520, marginBottom: 44 }}>
          <p
            style={{
              fontSize: "0.75rem",
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              fontWeight: 700,
              color: themeCfg.uiSoftText,
              marginBottom: 10,
            }}
          >
            SoftVibe Credits
          </p>
          <h1
            style={{
              fontSize: "clamp(1.6rem, 3vw, 2rem)",
              fontWeight: 850,
              color: themeCfg.uiText,
              margin: "0 0 14px",
              lineHeight: 1.15,
            }}
          >
            Wähle dein Paket
          </h1>
          <p style={{ color: themeCfg.uiSoftText, fontSize: "0.95rem", lineHeight: 1.65 }}>
            Erhalte monatliche Credits für personalisierte Entspannungs-Audios —
            Sleep Stories, Meditationen, ASMR und Kids Stories.
          </p>
        </div>

        {/* Error state */}
        {error && (
          <p
            style={{
              color: "#e11d48",
              fontWeight: 600,
              marginBottom: 20,
              fontSize: "0.9rem",
            }}
          >
            {error}
          </p>
        )}

        {/* Plan cards — flex-wrap creates responsive 3 → 1 column layout */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            justifyContent: "center",
            width: "100%",
            maxWidth: 940,
            alignItems: "stretch",
          }}
        >
          {PLANS.map((plan) => {
            const envMissing = !plan.priceId;
            const isLoading = loadingId === plan.id;
            const isRec = plan.recommended === true;

            return (
              <section
                key={plan.id}
                style={{
                  flex: "1 1 260px",
                  maxWidth: 300,
                  borderRadius: 24,
                  padding: "24px 22px",
                  background: themeCfg.cardBg,
                  backdropFilter: "blur(14px)",
                  WebkitBackdropFilter: "blur(14px)",
                  border: isRec
                    ? `2px solid ${themeCfg.primaryButtonBg}`
                    : `1px solid ${themeCfg.cardBorder}`,
                  boxShadow: themeCfg.cardShadow,
                  display: "flex",
                  flexDirection: "column",
                  position: "relative",
                }}
              >
                {/* Recommended badge — top-right inside card */}
                {isRec && (
                  <div
                    style={{
                      position: "absolute",
                      top: 16,
                      right: 16,
                      background: themeCfg.primaryButtonBg,
                      color: themeCfg.primaryButtonText,
                      fontSize: "0.68rem",
                      fontWeight: 700,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      padding: "0.25rem 0.65rem",
                      borderRadius: 999,
                    }}
                  >
                    Empfohlen
                  </div>
                )}

                {/* Plan name */}
                <div
                  style={{
                    fontSize: "1.15rem",
                    fontWeight: 800,
                    color: themeCfg.uiText,
                    marginBottom: 4,
                    paddingRight: isRec ? 80 : 0, // clearance for badge
                  }}
                >
                  {plan.label}
                </div>

                {/* Tagline */}
                <div
                  style={{
                    fontSize: "0.82rem",
                    color: themeCfg.uiSoftText,
                    marginBottom: 20,
                  }}
                >
                  {plan.tagline}
                </div>

                {/* Price */}
                <div style={{ marginBottom: 6 }}>
                  <span
                    style={{
                      fontSize: "2.2rem",
                      fontWeight: 850,
                      color: themeCfg.uiText,
                      lineHeight: 1,
                    }}
                  >
                    {plan.price}
                  </span>
                  <span
                    style={{
                      fontSize: "0.85rem",
                      color: themeCfg.uiSoftText,
                      marginLeft: 6,
                    }}
                  >
                    / Monat
                  </span>
                </div>

                {/* Credits */}
                <div
                  style={{
                    fontSize: "0.85rem",
                    color: themeCfg.uiSoftText,
                    marginBottom: 24,
                    paddingBottom: 20,
                    borderBottom: `1px solid ${themeCfg.cardBorder}`,
                  }}
                >
                  <span style={{ fontWeight: 700, color: themeCfg.uiText }}>
                    {plan.credits.toLocaleString("de-DE")}
                  </span>{" "}
                  Credits pro Monat
                </div>

                {envMissing && (
                  <p
                    style={{
                      fontSize: "0.78rem",
                      color: themeCfg.uiSoftText,
                      marginBottom: 10,
                    }}
                  >
                    Aktuell nicht verfügbar
                  </p>
                )}

                {/* CTA — primary style for recommended plan */}
                <button
                  type="button"
                  onClick={() => void startCheckout(plan.id, plan.priceId)}
                  disabled={envMissing || isLoading}
                  style={{
                    marginTop: "auto",
                    width: "100%",
                    background: isRec
                      ? themeCfg.primaryButtonBg
                      : themeCfg.secondaryButtonBg,
                    color: isRec
                      ? themeCfg.primaryButtonText
                      : themeCfg.secondaryButtonText,
                    border: isRec
                      ? "none"
                      : `1px solid ${themeCfg.secondaryButtonBorder}`,
                    borderRadius: 999,
                    padding: "0.6rem 1.2rem",
                    fontWeight: 700,
                    fontSize: "0.88rem",
                    cursor: envMissing || isLoading ? "default" : "pointer",
                    opacity: envMissing || isLoading ? 0.6 : 1,
                    transition: "opacity .15s ease",
                  }}
                >
                  {isLoading ? "Weiterleitung…" : "Jetzt auswählen"}
                </button>
              </section>
            );
          })}
        </div>

        {/* Trust footer */}
        <p
          style={{
            marginTop: 32,
            textAlign: "center",
            fontSize: "0.8rem",
            color: themeCfg.uiSoftText,
            lineHeight: 1.6,
            maxWidth: 380,
          }}
        >
          Sichere Zahlung über{" "}
          <span style={{ fontWeight: 600, color: themeCfg.uiText }}>Stripe</span>.{" "}
          Jederzeit kündbar — keine Mindestlaufzeit.
        </p>
      </main>
    </SVScene>
  );
}
