// app/billing/success/ui.tsx
"use client";

import Link from "next/link";
import SVScene from "@/app/components/sv-scene";
import { useSVTheme, SVHeader } from "@/app/components/sv-kit";

export default function BillingSuccessClient({
  planLabel,
}: {
  planLabel: string | null;
}) {
  const { themeKey, themeCfg, cycleTheme, logoSrc } = useSVTheme();

  return (
    <SVScene theme={themeKey}>
      {/* Logo click cycles the theme */}
      <SVHeader
        variant="app"
        logoSrc={logoSrc}
        onLogoClick={cycleTheme}
      />

      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "80px 24px 32px",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 480,
            borderRadius: 24,
            padding: "36px 28px 28px",
            background: themeCfg.cardBg,
            border: `1px solid ${themeCfg.cardBorder}`,
            boxShadow: themeCfg.cardShadow,
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            textAlign: "center",
          }}
        >
          {/* Success indicator */}
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: "50%",
              background: `${themeCfg.primaryButtonBg}1a`,
              border: `2px solid ${themeCfg.primaryButtonBg}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 18px",
              fontSize: "1.4rem",
              color: themeCfg.primaryButtonBg,
              fontWeight: 700,
            }}
          >
            ✓
          </div>

          <h1
            style={{
              fontSize: "1.4rem",
              fontWeight: 800,
              color: themeCfg.uiText,
              margin: "0 0 10px",
            }}
          >
            Zahlung erfolgreich
          </h1>
          <p
            style={{
              color: themeCfg.uiSoftText,
              fontSize: "0.92rem",
              lineHeight: 1.65,
              margin: "0 0 24px",
            }}
          >
            Deine Zahlung wurde verarbeitet. Die Credits werden in Kürze deinem
            Konto gutgeschrieben.
          </p>

          {/* Plan confirmation */}
          {planLabel && (
            <div
              style={{
                marginBottom: 24,
                padding: "14px 16px",
                borderRadius: 16,
                border: `1px solid ${themeCfg.cardBorder}`,
                background: `${themeCfg.primaryButtonBg}0d`,
                textAlign: "left",
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  color: themeCfg.uiText,
                  marginBottom: 4,
                  fontSize: "0.9rem",
                }}
              >
                {planLabel}-Abo aktiviert
              </div>
              <div
                style={{
                  fontSize: "0.84rem",
                  color: themeCfg.uiSoftText,
                  lineHeight: 1.55,
                }}
              >
                Dein Abo erneuert sich automatisch und schreibt dir monatlich
                neue Credits gut. Verwaltung und Kündigung jederzeit über dein
                Konto.
              </div>
            </div>
          )}

          {/* CTAs — forward action first */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <Link
              href="/generate"
              style={{
                padding: "0.55rem 1.3rem",
                borderRadius: 999,
                background: themeCfg.primaryButtonBg,
                color: themeCfg.primaryButtonText,
                fontWeight: 700,
                fontSize: "0.88rem",
                textDecoration: "none",
              }}
            >
              Jetzt generieren
            </Link>
            <Link
              href="/account"
              style={{
                padding: "0.55rem 1.1rem",
                borderRadius: 999,
                border: `1px solid ${themeCfg.secondaryButtonBorder}`,
                background: themeCfg.secondaryButtonBg,
                color: themeCfg.secondaryButtonText,
                fontWeight: 600,
                fontSize: "0.88rem",
                textDecoration: "none",
              }}
            >
              Zum Konto
            </Link>
            <Link
              href="/library"
              style={{
                padding: "0.55rem 1.1rem",
                borderRadius: 999,
                border: `1px solid ${themeCfg.secondaryButtonBorder}`,
                background: themeCfg.secondaryButtonBg,
                color: themeCfg.secondaryButtonText,
                fontWeight: 600,
                fontSize: "0.88rem",
                textDecoration: "none",
              }}
            >
              Bibliothek
            </Link>
          </div>
        </div>
      </main>
    </SVScene>
  );
}
