"use client";

import { useEffect } from "react";
import { signOut } from "next-auth/react";
import SVScene from "@/app/components/sv-scene";
import { useSVTheme } from "@/app/components/sv-kit";

export default function LogoutPage() {
  const { themeKey, themeCfg } = useSVTheme();

  useEffect(() => {
    signOut({ callbackUrl: "/" });
  }, []);

  return (
    <SVScene theme={themeKey}>
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
        }}
      >
        <section
          aria-live="polite"
          style={{
            width: "100%",
            maxWidth: 380,
            borderRadius: 24,
            padding: "32px 28px",
            background: themeCfg.cardBg,
            border: `1px solid ${themeCfg.cardBorder}`,
            boxShadow: themeCfg.cardShadow,
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            textAlign: "center",
          }}
        >
          <h1
            style={{
              fontSize: "1.2rem",
              fontWeight: 700,
              margin: "0 0 8px",
              color: themeCfg.uiText,
            }}
          >
            Abmelden…
          </h1>
          <p style={{ color: themeCfg.uiSoftText, fontSize: "0.9rem", margin: 0 }}>
            Einen Moment bitte, du wirst abgemeldet.
          </p>
          <div
            aria-hidden
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              border: `3px solid ${themeCfg.cardBorder}`,
              borderTopColor: themeCfg.primaryButtonBg,
              animation: "svSpin .8s linear infinite",
              margin: "18px auto 0",
            }}
          />
        </section>
      </main>
    </SVScene>
  );
}
