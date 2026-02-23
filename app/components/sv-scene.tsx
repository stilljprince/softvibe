"use client";

import React from "react";
import { THEMES, type ThemeKey } from "@/app/components/sv-kit";

export default function SVScene({
  theme,
  children,
}: {
  theme: ThemeKey;
  children?: React.ReactNode;
}) {
  const themeCfg = THEMES[theme];

  return (
    <div style={{ position: "relative", minHeight: "100vh" }}>
      {/* Fixed Background */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 0,
          backgroundImage: themeCfg.background,
          backgroundSize: "260% 260%",
          animation: "svDrift 40s ease-in-out infinite alternate",
        }}
      />

      {/* Stars + shooting stars (dark only) */}
      {theme === "dark" && (
        <>
          <div className="sv-stars-layer" />
          <div className="sv-shoot sv-shoot-1" />
          <div className="sv-shoot sv-shoot-2" />
          <div className="sv-shoot sv-shoot-3" />
        </>
      )}

      {/* Content */}
      <div style={{ position: "relative", zIndex: 10 }}>{children}</div>

      <style jsx global>{`
        @keyframes svDrift {
          0% { background-position: 0% 0%; }
          50% { background-position: 90% 40%; }
          100% { background-position: 0% 100%; }
        }

        .sv-stars-layer {
          position: fixed;
          inset: -40px;
          pointer-events: none;
          z-index: 1;
          background-repeat: no-repeat;
          opacity: 0.9;
          mix-blend-mode: screen;
          background-image:
            radial-gradient(1px 1px at 6% 8%, rgba(248, 250, 252, 1) 0, transparent 60%),
            radial-gradient(1px 1px at 14% 16%, rgba(226, 232, 240, 0.98) 0, transparent 60%),
            radial-gradient(1px 1px at 22% 10%, rgba(248, 250, 252, 0.98) 0, transparent 60%),
            radial-gradient(1px 1px at 32% 20%, rgba(148, 163, 184, 0.95) 0, transparent 60%),
            radial-gradient(1px 1px at 44% 14%, rgba(226, 232, 240, 0.98) 0, transparent 60%),
            radial-gradient(1px 1px at 56% 18%, rgba(248, 250, 252, 0.95) 0, transparent 60%),
            radial-gradient(1px 1px at 68% 12%, rgba(148, 163, 184, 0.95) 0, transparent 60%),
            radial-gradient(1px 1px at 80% 18%, rgba(248, 250, 252, 0.95) 0, transparent 60%);
          animation: svStarsTwinkle 48s ease-in-out infinite alternate;
        }

        @keyframes svStarsTwinkle {
          0% { opacity: 0.5; transform: translate3d(0,0,0); }
          50% { opacity: 0.9; transform: translate3d(-6px,-8px,0); }
          100% { opacity: 0.55; transform: translate3d(4px,6px,0); }
        }

        .sv-shoot {
          position: fixed;
          width: 6px;
          height: 6px;
          pointer-events: none;
          opacity: 0;
          z-index: 2;
        }
        .sv-shoot::after {
          content: "";
          position: absolute;
          inset: 0;
          margin: auto;
          width: 4px;
          height: 4px;
          border-radius: 999px;
          background: rgba(248, 250, 252, 0.85);
        }
        .sv-shoot-1 { top: 10%; left: -20%; transform: rotate(8deg); animation: svShoot1 34s linear infinite; }
        .sv-shoot-2 { top: 18%; right: -25%; transform: rotate(190deg); animation: svShoot2 46s linear infinite; }
        .sv-shoot-3 { top: 24%; left: -18%; transform: rotate(12deg); animation: svShoot3 52s linear infinite; }

        @keyframes svShoot1 {
          0% { opacity: 0; }
          72% { opacity: 0; left: -20%; top: 10%; }
          76% { opacity: 0.25; left: 10%; top: 9%; }
          80% { opacity: 0.15; left: 32%; top: 11%; }
          84% { opacity: 0; left: 54%; top: 13%; }
          100% { opacity: 0; }
        }
        @keyframes svShoot2 {
          0% { opacity: 0; }
          78% { opacity: 0; right: -25%; top: 18%; }
          82% { opacity: 0.22; right: 8%; top: 17%; }
          86% { opacity: 0.12; right: 32%; top: 19%; }
          90% { opacity: 0; right: 58%; top: 22%; }
          100% { opacity: 0; }
        }
        @keyframes svShoot3 {
          0% { opacity: 0; }
          68% { opacity: 0; left: -18%; top: 24%; }
          72% { opacity: 0.24; left: 8%; top: 22%; }
          77% { opacity: 0.14; left: 28%; top: 24%; }
          82% { opacity: 0; left: 48%; top: 26%; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}