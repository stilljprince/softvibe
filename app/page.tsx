"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { THEMES, formatEntitlementMenuLabel, useHeaderMenu, type ThemeKey } from "@/app/components/sv-kit";
import SVScene from "@/app/components/sv-scene";
import type { EntitlementsView } from "@/lib/entitlement-view";

type SendStatus = "idle" | "sending" | "success" | "error";

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

// Map rect.top -> progress 0..1
// When rect.top is below START_Y => 0
// When rect.top reaches END_Y => 1
function progressFromTop(rectTop: number, startY: number, endY: number) {
  const t = (startY - rectTop) / (startY - endY);
  return clamp(t, 0, 1);
}

function inputStyle(theme: ThemeKey, isTextarea = false): React.CSSProperties {
  return {
    width: "100%",
    padding: isTextarea ? "0.85rem 0.95rem" : "0.8rem 0.95rem",
    borderRadius: 16,
    border:
      theme === "dark"
        ? "1px solid rgba(148,163,184,0.22)"
        : "1px solid rgba(148,163,184,0.3)",
    background: theme === "dark" ? "rgba(15,23,42,0.22)" : "rgba(255,255,255,0.22)",
    color: theme === "dark" ? "#e5e7eb" : "#0f172a",
    outline: "none",
    fontSize: "0.95rem",
    lineHeight: 1.5,
  };
}

export default function Home() {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const loggedIn = sessionStatus === "authenticated" && !!session?.user;

  // Theme (match /t and /s)
  const [theme, setTheme] = useState<ThemeKey>("dark");
  const themeCfg = THEMES[theme];
  const logoSrc =
    theme === "dark" ? "/softvibe-logo-dark.svg" : "/softvibe-logo-pastel.svg";

  useEffect(() => {
    const saved = window.localStorage.getItem("sv-theme");
    if (saved === "light" || saved === "pastel" || saved === "dark") setTheme(saved);
  }, []);
  useEffect(() => {
    window.localStorage.setItem("sv-theme", theme);
  }, [theme]);
  const cycleTheme = () => {
    setTheme((p) => (p === "light" ? "pastel" : p === "pastel" ? "dark" : "light"));
  };

  // Menu — shared hover/click/outside-click behaviour with /generate, /library, /account.
  const {
    open: menuOpen,
    rootRef: menuRootRef,
    onMouseEnter: menuOnMouseEnter,
    onMouseLeave: menuOnMouseLeave,
    toggle: toggleMenu,
    close: closeMenu,
  } = useHeaderMenu();

  // Mobile header auto-hide on scroll. Only takes visual effect below the
  // mobile/landscape/low-height breakpoints (see the scoped <style> below) —
  // desktop stays unaffected regardless of this state.
  const [headerHidden, setHeaderHidden] = useState(false);
  const lastScrollYRef = useRef(0);
  const menuOpenRef = useRef(false);
  useEffect(() => {
    menuOpenRef.current = menuOpen;
    if (menuOpen) setHeaderHidden(false);
  }, [menuOpen]);

  // Usage info for the logged-in menu — reuses /api/account/summary, the
  // same endpoint /generate, /library and /account already read.
  const [menuIsAdmin, setMenuIsAdmin] = useState(false);
  const [menuEntitlements, setMenuEntitlements] = useState<EntitlementsView | null>(null);

  useEffect(() => {
    if (!loggedIn) return;
    void fetch("/api/account/summary", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const d = json?.ok === true && json.data ? json.data : json;
        if (!d || typeof d !== "object") return;
        setMenuIsAdmin((d as { isAdmin?: unknown }).isAdmin === true);
        const ent = (d as { entitlements?: unknown }).entitlements;
        if (ent && typeof ent === "object") {
          setMenuEntitlements(ent as EntitlementsView);
        }
      })
      .catch(() => null);
  }, [loggedIn]);

  // Contact
  const [sendStatus, setSendStatus] = useState<SendStatus>("idle");
  const [cooldown, setCooldown] = useState(false);

  const primaryCta = useMemo(() => {
    if (loggedIn) return { label: "Generieren", href: "/generate" };
    return { label: "Kostenlos starten", href: "/register" };
  }, [loggedIn]);

  const secondaryCta = useMemo(() => {
    if (loggedIn) return { label: "Library", href: "/library" };
    return { label: "Login", href: "/login" };
  }, [loggedIn]);

  const go = (href: string) => router.push(href);

  // Refs for sections (for reveal logic + hero push)
  const featuresRef = useRef<HTMLElement | null>(null);
  const aboutRef = useRef<HTMLElement | null>(null);
  const contactRef = useRef<HTMLElement | null>(null);

  // Progress values 0..1
  const [heroT, setHeroT] = useState(0);
  const [featuresT, setFeaturesT] = useState(0);
  const [aboutT, setAboutT] = useState(0);
  const [contactT, setContactT] = useState(0);

  // Scroll loop (single RAF)
  useEffect(() => {
    let raf: number | null = null;

    const update = () => {
      raf = null;
      const vh = window.innerHeight || 800;

      // Reveal thresholds (tune)
      // start reveal when section enters lower part of screen
      const START_Y = vh * 0.92;
      const END_Y = vh * 0.55;

      const fRect = featuresRef.current?.getBoundingClientRect();
      const aRect = aboutRef.current?.getBoundingClientRect();
      const cRect = contactRef.current?.getBoundingClientRect();

      const fT = fRect ? progressFromTop(fRect.top, START_Y, END_Y) : 0;
      const aT = aRect ? progressFromTop(aRect.top, START_Y, END_Y) : 0;
      const cT = cRect ? progressFromTop(cRect.top, START_Y, END_Y) : 0;

      setFeaturesT(fT);
      setAboutT(aT);
      setContactT(cT);

      // HERO linger + push-out:
      // Keep hero around longer; only start hiding once Features is genuinely close.
      // Start pushing hero when features reaches ~20% revealed.
      const heroStart = 0.12;
      const heroEnd = 0.95;
      const hT = clamp((fT - heroStart) / (heroEnd - heroStart), 0, 1);
      setHeroT(hT);

      // Mobile header auto-hide: hide on scroll-down past a small threshold,
      // show on scroll-up, and always show near the top or while the menu is open.
      const scrollY = window.scrollY || 0;
      const delta = scrollY - lastScrollYRef.current;
      const HIDE_THRESHOLD = 8;
      if (menuOpenRef.current || scrollY < 60) {
        setHeaderHidden(false);
      } else if (delta > HIDE_THRESHOLD) {
        setHeaderHidden(true);
      } else if (delta < -HIDE_THRESHOLD) {
        setHeaderHidden(false);
      }
      lastScrollYRef.current = scrollY;
    };

    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(update);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  const pillStyle = (variant: "primary" | "secondary") => {
    if (variant === "primary") {
      return {
        textDecoration: "none",
        padding: "0.55rem 1.15rem",
        borderRadius: 999,
        background: themeCfg.primaryButtonBg,
        color: themeCfg.primaryButtonText,
        fontSize: "0.88rem",
        fontWeight: 700,
        boxShadow: "0 14px 35px rgba(0,0,0,0.35)",
        border: "none",
        cursor: "pointer",
        whiteSpace: "nowrap" as const,
      };
    }
    return {
      textDecoration: "none",
      padding: "0.55rem 1.05rem",
      borderRadius: 999,
      border: `1px solid ${themeCfg.secondaryButtonBorder}`,
      background: themeCfg.secondaryButtonBg,
      color: themeCfg.secondaryButtonText,
      fontSize: "0.85rem",
      fontWeight: 650,
      boxShadow: "0 10px 25px rgba(0,0,0,0.25)",
      cursor: "pointer",
      whiteSpace: "nowrap" as const,
    };
  };

  const glassPanel = useMemo(() => {
    const isDark = theme === "dark";
    return {
      background: isDark ? "rgba(15,23,42,0.52)" : "rgba(248,250,252,0.62)",
      border: isDark ? "1px solid rgba(148,163,184,0.22)" : "1px solid rgba(148,163,184,0.28)",
      color: themeCfg.uiText,
      backdropFilter: "blur(18px)",
      WebkitBackdropFilter: "blur(18px)",
      boxShadow: isDark
        ? "0 26px 80px rgba(0,0,0,0.55)"
        : "0 22px 60px rgba(15,23,42,0.25)",
      borderRadius: 22,
    } as const;
  }, [theme, themeCfg.uiText]);

  // Hero animation
  const heroOpacity = 1 - heroT;
  const heroTranslateY = -heroT * 140; // push up more
  const heroPointer = heroT < 0.92 ? "auto" : "none";

  // Section reveal animation helper
  const sectionStyle = (t: number): React.CSSProperties => ({
    opacity: t,
    transform: `translateY(${(1 - t) * 18}px)`,
    transition: "opacity 220ms ease-out, transform 220ms ease-out",
  });

  return (
   <SVScene theme={theme}>

      {/* Fixed header */}
      <header
        className={`sv-header-autohide${headerHidden ? " sv-header-hidden" : ""}`}
        style={{
          position: "fixed",
          top: 18,
          left: 18,
          right: 18,
          zIndex: 30,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          pointerEvents: "auto",
        }}
      >
        <button
          type="button"
          onClick={cycleTheme}
          style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer" }}
          aria-label="Theme wechseln"
          title="Theme wechseln"
        >
          <Image src={logoSrc} alt="SoftVibe Logo" width={160} height={50} priority />
        </button>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div className="sv-desktop" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button type="button" onClick={() => go(secondaryCta.href)} style={pillStyle("secondary")}>
              {secondaryCta.label}
            </button>
            <button type="button" onClick={() => go(primaryCta.href)} style={pillStyle("primary")}>
              {primaryCta.label} →
            </button>
          </div>

          {/* Menu — hover-based shared wrapper, matches /generate, /library, /account */}
          <div
            ref={menuRootRef}
            style={{ position: "relative" }}
            onMouseEnter={menuOnMouseEnter}
            onMouseLeave={menuOnMouseLeave}
          >
            <button
              type="button"
              onClick={toggleMenu}
              style={{
                width: 40,
                height: 40,
                borderRadius: 999,
                border: `1px solid ${themeCfg.secondaryButtonBorder}`,
                background: themeCfg.secondaryButtonBg,
                color: themeCfg.secondaryButtonText,
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
                boxShadow: "0 10px 25px rgba(0,0,0,0.25)",
                fontWeight: 900,
              }}
              aria-label="Menü"
              title="Menü"
            >
              ☰
            </button>

            {menuOpen && (
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 8px)",
                  zIndex: 90,
                  width: "min(360px, calc(100vw - 28px))",
                  padding: 2,
                  borderRadius: 26,
                  background:
                    theme === "dark"
                      ? "radial-gradient(circle at top, rgba(56,189,248,0.22), transparent 68%)"
                      : "radial-gradient(circle at top, rgba(244,114,182,0.32), transparent 70%)",
                  boxShadow: "0 26px 80px rgba(0,0,0,0.7)",
                }}
              >
                <div style={{ ...glassPanel, padding: 16, borderRadius: 24 }}>
                  <div
                    style={{
                      fontSize: "0.8rem",
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      fontWeight: 800,
                      color: themeCfg.uiSoftText,
                      marginBottom: 10,
                    }}
                  >
                    Menü
                  </div>

                  {loggedIn && (
                    <div style={{ fontSize: "0.78rem", color: themeCfg.uiSoftText, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                      {formatEntitlementMenuLabel(menuEntitlements, menuIsAdmin)}
                    </div>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
                    {[
                      { label: "Features", id: "features" },
                      { label: "Über SoftVibe", id: "about" },
                      { label: "Kontakt", id: "contact" },
                    ].map((x) => (
                      <button
                        key={x.id}
                        type="button"
                        onClick={() => {
                          closeMenu();
                          document.getElementById(x.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }}
                        style={{ ...pillStyle("secondary"), width: "100%", textAlign: "left" }}
                      >
                        {x.label}
                      </button>
                    ))}

                    <div style={{ height: 1, background: "rgba(148,163,184,0.25)", margin: "4px 0" }} />

                    {loggedIn ? (
                      <>
                        {[
                          { label: "Generieren", href: "/generate" },
                          { label: "Bibliothek", href: "/library" },
                          { label: "Konto", href: "/account" },
                        ].map((x) => (
                          <button
                            key={x.href}
                            type="button"
                            onClick={() => {
                              closeMenu();
                              go(x.href);
                            }}
                            style={{ ...pillStyle("secondary"), width: "100%", textAlign: "left" }}
                          >
                            {x.label}
                          </button>
                        ))}

                        <div style={{ height: 1, background: "rgba(148,163,184,0.25)", margin: "4px 0" }} />

                        <form action="/api/auth/signout" method="post">
                          <button
                            type="submit"
                            style={{ ...pillStyle("secondary"), width: "100%", textAlign: "left" }}
                          >
                            Logout
                          </button>
                        </form>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            closeMenu();
                            go(secondaryCta.href);
                          }}
                          style={{ ...pillStyle("secondary"), width: "100%", textAlign: "left" }}
                        >
                          {secondaryCta.label}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            closeMenu();
                            go(primaryCta.href);
                          }}
                          style={{ ...pillStyle("primary"), width: "100%", textAlign: "left" }}
                        >
                          {primaryCta.label} →
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Mobile header fix: hide the desktop pill group below the breakpoint,
            and on short/landscape mobile viewports so the fixed header never
            wraps or overflows. The menu trigger stays visible at all sizes. */}
        <style jsx>{`
          .sv-header-autohide {
            transition: transform 320ms ease;
          }
          @media (max-width: 768px) {
            .sv-desktop {
              display: none !important;
            }
            .sv-header-hidden.sv-header-autohide {
              transform: translateY(-130%);
            }
          }
          @media (orientation: landscape) and (max-width: 1024px) {
            .sv-desktop {
              display: none !important;
            }
            .sv-header-hidden.sv-header-autohide {
              transform: translateY(-130%);
            }
          }
          @media (max-height: 600px) and (max-width: 1100px) {
            .sv-desktop {
              display: none !important;
            }
            .sv-header-hidden.sv-header-autohide {
              transform: translateY(-130%);
            }
          }
          @media (orientation: landscape) and (max-width: 1024px) {
            .sv-hero {
              top: 61% !important;
            }
          }
          @media (max-height: 600px) and (max-width: 1100px) {
            .sv-hero {
              top: 64% !important;
            }
          }
          .sv-scroll-hint {
            animation: svScrollHintFloat 2.2s ease-in-out infinite;
          }
          @keyframes svScrollHintFloat {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(6px); }
          }
          .sv-hero-cta-pulse {
            animation: svPulse 3s ease-in-out infinite;
          }
          @keyframes svPulse {
            0%, 100% { box-shadow: 0 14px 35px rgba(0,0,0,0.35); }
            50% { box-shadow: 0 14px 35px rgba(0,0,0,0.5); }
          }
          @media (prefers-reduced-motion: reduce) {
            .sv-scroll-hint,
            .sv-hero-cta-pulse {
              animation: none;
            }
          }
          .sv-feature-card {
            transition: transform 200ms ease, box-shadow 200ms ease, border-color 200ms ease;
          }
          .sv-feature-card:hover,
          .sv-feature-card:focus-visible {
            transform: translateY(-2px);
            box-shadow: 0 14px 40px rgba(0,0,0,0.22);
            border-color: rgba(148,163,184,0.42);
          }
          .sv-feature-card:focus-visible {
            outline: 2px solid rgba(148,163,184,0.6);
            outline-offset: 3px;
          }
          @media (prefers-reduced-motion: reduce) {
            .sv-feature-card {
              transition: none;
            }
            .sv-feature-card:hover,
            .sv-feature-card:focus-visible {
              transform: none;
            }
          }
        `}</style>
      </header>

      {/* Dimming backdrop — focus layer behind the open menu, shared across all pages */}
      {menuOpen && (
        <div
          onClick={closeMenu}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 25,
            background: theme === "dark" ? "rgba(2,6,23,0.35)" : "rgba(15,23,42,0.16)",
          }}
        />
      )}

      {/* HERO (fixed, lingers longer, then pushed away by features) */}
      <div
        className="sv-hero"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          top: "50%",
          transform: `translateY(calc(-58% + ${heroTranslateY}px))`,
          zIndex: 20,
          padding: "0 18px",
          pointerEvents: heroPointer,
          opacity: heroOpacity,
          transition: "opacity 120ms linear",
        }}
      >
        <div style={{ maxWidth: 860, margin: "0 auto", textAlign: "center" }}>
          <div
            style={{
              fontSize: "0.8rem",
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              fontWeight: 800,
              color: themeCfg.uiSoftText,
              marginBottom: 10,
            }}
          >
            Schlaf · Ruhe · Eigene Geschichten
          </div>

          <h1
            style={{
              fontSize: "clamp(2.4rem, 6vw, 3.6rem)",
              fontWeight: 900,
              margin: 0,
              color: themeCfg.uiText,
              lineHeight: 1.08,
              letterSpacing: "-0.02em",
            }}
          >
            SoftVibe
          </h1>

          <p
            style={{
              fontSize: "clamp(1.02rem, 2vw, 1.22rem)",
              color: themeCfg.uiSoftText,
              maxWidth: 740,
              margin: "14px auto 18px",
              lineHeight: 1.7,
            }}
          >
            Persönliche Audiomomente für Schlaf und Ruhe – sanfte ASMR-Sessions, ruhige
            Meditationen, Geschichten für Kinder und deine eigenen Hörgeschichten, ganz auf
            dich zugeschnitten.
          </p>

          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => go(primaryCta.href)}
              className="sv-hero-cta-pulse"
              style={{
                ...pillStyle("primary"),
                padding: "0.82rem 1.7rem",
                fontSize: "0.98rem",
                fontWeight: 800,
              }}
            >
              {primaryCta.label} →
            </button>

            <button
              type="button"
              onClick={() => go(secondaryCta.href)}
              style={{
                ...pillStyle("secondary"),
                padding: "0.78rem 1.55rem",
                fontSize: "0.92rem",
                fontWeight: 700,
              }}
            >
              {secondaryCta.label}
            </button>
          </div>

          {!loggedIn && (
            <p
              style={{
                marginTop: 10,
                fontSize: "0.78rem",
                color: themeCfg.uiSoftText,
                opacity: 0.85,
              }}
            >
              Kostenlos ausprobieren · keine Zahlungsdaten zum Start erforderlich
            </p>
          )}

          <div style={{ marginTop: 14, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            {["Persönliche Geschichten", "Sanfte Stimmen", "Einschlafen", "Mentale Auszeiten"].map((t) => (
              <span
                key={t}
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  border: `1px solid ${themeCfg.secondaryButtonBorder}`,
                  background: themeCfg.secondaryButtonBg,
                  color: themeCfg.secondaryButtonText,
                  fontSize: "0.78rem",
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  boxShadow: "0 10px 25px rgba(0,0,0,0.18)",
                }}
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Scroll hint — anchored near the bottom viewport edge, independent of
          the hero's own centered text flow. Shares the hero's fade/pointer
          state so it disappears together with the hero on scroll. */}
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: "clamp(20px, 5vh, 44px)",
          zIndex: 20,
          display: "flex",
          justifyContent: "center",
          opacity: heroOpacity,
          pointerEvents: heroPointer,
          transition: "opacity 120ms linear",
        }}
      >
        <button
          type="button"
          aria-label="Zu Features scrollen"
          className="sv-scroll-hint"
          onClick={() => {
            const reduceMotion =
              typeof window !== "undefined" &&
              window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            featuresRef.current?.scrollIntoView({
              behavior: reduceMotion ? "auto" : "smooth",
              block: "start",
            });
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            borderRadius: "50%",
            border: "none",
            background: "transparent",
            color: themeCfg.uiSoftText,
            cursor: "pointer",
            opacity: 0.6,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {/* CONTENT */}
      <div
        style={{
          position: "relative",
          zIndex: 10,
          minHeight: "260vh",
          // Give hero a lot of breathing room so it "lingers"
          paddingTop: "105vh",
          paddingBottom: 120,
        }}
      >
        {/* FEATURES */}
        <section
          id="features"
          ref={(el) => {
            featuresRef.current = el;
          }}
          style={{ padding: "0 18px" }}
        >
          <div style={{ maxWidth: 980, margin: "0 auto", ...sectionStyle(featuresT) }}>
            <div style={{ ...glassPanel, padding: 22 }}>
              <div
                style={{
                  fontSize: "0.8rem",
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  fontWeight: 900,
                  color: themeCfg.uiSoftText,
                  marginBottom: 10,
                  textAlign: "center",
                }}
              >
                Features
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
                  gap: 12,
                }}
              >
                {[
                  {
                    emoji: "🌙",
                    title: "Schlafgeschichten",
                    text: "Persönliche Geschichten, die dich Abend für Abend sanft begleiten und dir helfen, den Tag in Ruhe hinter dir zu lassen.",
                    preset: "sleep-story",
                  },
                  {
                    emoji: "🎧",
                    title: "ASMR",
                    text: "Sanfte Flüsterstimmen und ruhige persönliche Ansprache, die Nähe schaffen und dir helfen, für einen Moment alles hinter dir zu lassen.",
                    preset: "classic-asmr",
                  },
                  {
                    emoji: "🧘",
                    title: "Meditation",
                    text: "Geführte Momente zum Durchatmen, Loslassen und Ankommen – ruhig, klar und ohne unnötige Ablenkung.",
                    preset: "meditation",
                  },
                  {
                    emoji: "🧸",
                    title: "Geschichten für Kinder",
                    text: "Liebevoll erzählte Geschichten, die Kinder jederzeit ruhig begleiten und ihre Fantasie auf sanfte Weise wachsen lassen können.",
                    preset: "kids-story",
                  },
                  {
                    emoji: "✨",
                    title: "Eigene Geschichten",
                    text: "Verwandle deine eigenen Ideen in einzigartige Hörgeschichten – von kleinen Abenteuern bis zu ganzen Welten, die es nur für dich gibt.",
                    preset: "narrative",
                  },
                ].map((x) => (
                  <Link
                    key={x.title}
                    href={`/generate?preset=${x.preset}`}
                    className="sv-feature-card"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      textAlign: "center",
                      gap: 8,
                      padding: "16px 14px",
                      borderRadius: 18,
                      border: "1px solid rgba(148,163,184,0.22)",
                      background: theme === "dark" ? "rgba(15,23,42,0.22)" : "rgba(255,255,255,0.24)",
                      textDecoration: "none",
                      color: "inherit",
                    }}
                  >
                    <div style={{ fontSize: 22, lineHeight: 1.1 }}>{x.emoji}</div>
                    <div style={{ fontWeight: 900, color: themeCfg.uiText }}>{x.title}</div>
                    <div style={{ color: themeCfg.uiSoftText, lineHeight: 1.6, maxWidth: 260, margin: "0 auto" }}>
                      {x.text}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ABOUT */}
        <section
          id="about"
          ref={(el) => {
            aboutRef.current = el;
          }}
          style={{ padding: "24px 18px 0" }}
        >
          <div style={{ maxWidth: 980, margin: "0 auto", ...sectionStyle(aboutT) }}>
            <div style={{ ...glassPanel, padding: "40px 22px", textAlign: "center" }}>
              <div
                style={{
                  fontSize: "0.8rem",
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  fontWeight: 900,
                  color: themeCfg.uiSoftText,
                  marginBottom: 18,
                }}
              >
                Über SoftVibe
              </div>

              <div
                style={{
                  maxWidth: 680,
                  margin: "0 auto",
                  color: themeCfg.uiSoftText,
                  lineHeight: 1.75,
                  fontSize: "1.02rem",
                  display: "grid",
                  gap: 20,
                }}
              >
                <p style={{ margin: 0 }}>
                  SoftVibe ist eine Plattform für persönliche Audioerlebnisse, die Ruhe,
                  Vorstellungskraft und Atmosphäre miteinander verbinden.
                </p>
                <p style={{ margin: 0 }}>
                  Ob du leichter einschlafen, nach einem langen Tag abschalten, eine ruhige
                  Meditation genießen, deinem Kind eine persönliche Geschichte erzählen oder
                  deiner eigenen Geschichte freien Lauf lassen möchtest – SoftVibe hilft dir dabei,
                  genau die Session zu erschaffen, die zu diesem Moment passt.
                </p>
                <p style={{ margin: 0 }}>
                  Statt dich durch endlose Kataloge zu wühlen, beschreibst du einfach, was du
                  hören möchtest. Daraus entstehen individuelle Schlafgeschichten, Meditationen,
                  sanfte ASMR-Sessions, Geschichten für Kinder oder ganz eigene Hörgeschichten –
                  persönlich, stimmungsvoll und genau auf dich zugeschnitten.
                </p>
                <p style={{ margin: 0 }}>
                  Dabei bleibt die Technologie bewusst im Hintergrund. SoftVibe soll sich nicht
                  wie ein KI-Werkzeug anfühlen, sondern wie ein ruhiger Ort, an den du immer
                  wieder zurückkehren kannst – warm, hochwertig und frei von unnötiger Ablenkung.
                </p>
                <p style={{ margin: 0 }}>
                  Denn manchmal braucht man nicht mehr Auswahl. Man braucht einfach etwas, das
                  sich anfühlt, als wäre es genau für einen selbst gemacht.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CONTACT */}
        <section
          id="contact"
          ref={(el) => {
            contactRef.current = el;
          }}
          style={{ padding: "24px 18px 0" }}
        >
          <div style={{ maxWidth: 980, margin: "0 auto", ...sectionStyle(contactT) }}>
            <div style={{ ...glassPanel, padding: 22 }}>
              <div
                style={{
                  fontSize: "0.8rem",
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  fontWeight: 900,
                  color: themeCfg.uiSoftText,
                  marginBottom: 10,
                  textAlign: "center",
                }}
              >
                Kontakt
              </div>

              <p style={{ marginTop: 0, color: themeCfg.uiSoftText, lineHeight: 1.7, textAlign: "center" }}>
                Feedback, Wünsche, Bugs – schreib uns. Wir lesen alles.
              </p>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (cooldown || sendStatus === "sending") return;

                  const form = e.currentTarget;
                  const data = {
                    name: (form.elements.namedItem("name") as HTMLInputElement).value,
                    email: (form.elements.namedItem("email") as HTMLInputElement).value,
                    message: (form.elements.namedItem("message") as HTMLTextAreaElement).value,
                  };

                  setSendStatus("sending");
                  try {
                    const res = await fetch("/api/contact", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(data),
                    });
                    const result = await res.json();
                    if (result?.success) {
                      setSendStatus("success");
                      form.reset();
                      setCooldown(true);
                      window.setTimeout(() => setCooldown(false), 30000);
                    } else {
                      setSendStatus("error");
                    }
                  } catch {
                    setSendStatus("error");
                  }
                }}
                style={{ display: "grid", gap: 10, marginTop: 14 }}
              >
                <input name="name" placeholder="Dein Name" required style={inputStyle(theme)} />
                <input name="email" placeholder="Deine E-Mail" type="email" required style={inputStyle(theme)} />
                <textarea name="message" placeholder="Deine Nachricht" rows={5} required style={inputStyle(theme, true)} />

                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    type="submit"
                    disabled={sendStatus === "sending" || cooldown}
                    style={{
                      ...pillStyle("primary"),
                      padding: "0.72rem 1.45rem",
                      opacity: sendStatus === "sending" || cooldown ? 0.6 : 1,
                      cursor: sendStatus === "sending" || cooldown ? "not-allowed" : "pointer",
                      animation: "none",
                    }}
                  >
                    {sendStatus === "sending" ? "Senden…" : cooldown ? "Bitte warten…" : "Absenden"}
                  </button>

                  {sendStatus === "error" && (
                    <span style={{ color: theme === "dark" ? "#fecaca" : "#b91c1c", fontWeight: 700 }}>
                      ❌ Fehler beim Senden.
                    </span>
                  )}
                  {sendStatus === "success" && !cooldown && (
                    <span style={{ color: theme === "dark" ? "#bbf7d0" : "#166534", fontWeight: 800 }}>
                      ✅ Gesendet.
                    </span>
                  )}
                </div>
              </form>
            </div>
          </div>
        </section>

        <div style={{ height: 26 }} />

        <footer
          style={{
            padding: "28px 18px 18px",
            color: themeCfg.uiSoftText,
            fontSize: "0.85rem",
          }}
        >
          <div
            style={{
              maxWidth: 980,
              margin: "0 auto",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
              textAlign: "center",
            }}
          >
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center" }}>
              {[
                { label: "Impressum", href: "/impressum" },
                { label: "Datenschutz", href: "/datenschutz" },
                { label: "AGB", href: "/agb" },
                { label: "Widerruf", href: "/widerruf" },
              ].map((x) => (
                <Link
                  key={x.href}
                  href={x.href}
                  style={{ color: themeCfg.uiSoftText, fontSize: "0.8rem", fontWeight: 600, textDecoration: "none", opacity: 0.85 }}
                >
                  {x.label}
                </Link>
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: "0.72rem", letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.6 }}>
                Folge SoftVibe
              </span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                {["Instagram", "TikTok", "YouTube"].map((platform) => (
                  <span
                    key={platform}
                    aria-disabled="true"
                    style={{
                      padding: "4px 10px",
                      borderRadius: 999,
                      border: `1px solid ${themeCfg.secondaryButtonBorder}`,
                      fontSize: "0.72rem",
                      fontWeight: 600,
                      opacity: 0.5,
                    }}
                  >
                    {platform} · bald verfügbar
                  </span>
                ))}
              </div>
            </div>

            <div style={{ opacity: 0.9 }}>
              © {new Date().getFullYear()} SoftVibe · Persönliche Audioerlebnisse für Ruhe und Vorstellungskraft
            </div>
          </div>
        </footer>
      </div>

     </SVScene>
  );
}