"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { THEMES, type ThemeKey } from "@/app/components/sv-kit";
import SVScene from "@/app/components/sv-scene";

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

  // Menu
  const [menuOpen, setMenuOpen] = useState(false);

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

        <div className="sv-desktop" style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button type="button" onClick={() => go(secondaryCta.href)} style={pillStyle("secondary")}>
            {secondaryCta.label}
          </button>
          <button type="button" onClick={() => go(primaryCta.href)} style={pillStyle("primary")}>
            {primaryCta.label} →
          </button>

          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            style={{
              marginLeft: 6,
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
        </div>

        <button
          className="sv-mobile"
          type="button"
          onClick={() => setMenuOpen(true)}
          style={{
            width: 44,
            height: 44,
            borderRadius: 999,
            border: `1px solid ${themeCfg.secondaryButtonBorder}`,
            background: themeCfg.secondaryButtonBg,
            color: themeCfg.secondaryButtonText,
            cursor: "pointer",
            display: "none",
            placeItems: "center",
            boxShadow: "0 10px 25px rgba(0,0,0,0.25)",
            fontWeight: 900,
          }}
          aria-label="Menü"
          title="Menü"
        >
          ☰
        </button>
      </header>

      {/* Mobile menu overlay */}
      {menuOpen && (
        <>
          <div
            onClick={() => setMenuOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(0,0,0,0.45)" }}
          />
          <div
            style={{
              position: "fixed",
              right: 14,
              top: 14,
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
            <div style={{ ...glassPanel, padding: 16, borderRadius: 24 }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div
                  style={{
                    fontSize: "0.8rem",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    fontWeight: 800,
                    color: themeCfg.uiSoftText,
                  }}
                >
                  Menü
                </div>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 999,
                    border: `1px solid ${themeCfg.secondaryButtonBorder}`,
                    background: themeCfg.secondaryButtonBg,
                    color: themeCfg.secondaryButtonText,
                    cursor: "pointer",
                    fontSize: 18,
                    fontWeight: 900,
                  }}
                  aria-label="Schließen"
                >
                  ✕
                </button>
              </div>

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
                      setMenuOpen(false);
                      document.getElementById(x.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                    style={{ ...pillStyle("secondary"), width: "100%", textAlign: "left" }}
                  >
                    {x.label}
                  </button>
                ))}

                <div style={{ height: 1, background: "rgba(148,163,184,0.25)", margin: "4px 0" }} />

                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    go(secondaryCta.href);
                  }}
                  style={{ ...pillStyle("secondary"), width: "100%", textAlign: "left" }}
                >
                  {secondaryCta.label}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    go(primaryCta.href);
                  }}
                  style={{ ...pillStyle("primary"), width: "100%", textAlign: "left" }}
                >
                  {primaryCta.label} →
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* HERO (fixed, lingers longer, then pushed away by features) */}
      <div
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
            AI Sleep · ASMR · Meditation
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
            Schlafgeschichten mit echter Bedtime-Presence. ASMR, das sich nach dir richtet.
            Meditation, die nicht wie eine App klingt – sondern wie Ruhe.
          </p>

          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => go(primaryCta.href)}
              style={{
                ...pillStyle("primary"),
                padding: "0.82rem 1.7rem",
                fontSize: "0.98rem",
                fontWeight: 800,
                animation: "svPulse 3s ease-in-out infinite",
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

          <div style={{ marginTop: 14, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            {["Kein TTS-Feeling", "Studio-Qualität", "Trigger-Kombos", "Sleep-Stories als Kapitel"].map((t) => (
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
                }}
              >
                Features
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
                {[
                  {
                    emoji: "🎧",
                    title: "Personalisiertes ASMR",
                    text: "Baue Trigger-Kombinationen, die du wirklich willst – ohne endloses Suchen.",
                  },
                  {
                    emoji: "🌙",
                    title: "Schlafgeschichten als Kapitel",
                    text: "Kapitel, Auto-Next und ein Player, der sich wie Ruhe anfühlt.",
                  },
                  {
                    emoji: "🧘",
                    title: "Meditation ohne Kitsch",
                    text: "Klar, ruhig, angenehm – weniger Floskeln, mehr echte Entspannung.",
                  },
                ].map((x) => (
                  <div
                    key={x.title}
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "flex-start",
                      padding: "12px 14px",
                      borderRadius: 18,
                      border: "1px solid rgba(148,163,184,0.22)",
                      background: theme === "dark" ? "rgba(15,23,42,0.22)" : "rgba(255,255,255,0.24)",
                    }}
                  >
                    <div style={{ fontSize: 22, lineHeight: 1.1 }}>{x.emoji}</div>
                    <div>
                      <div style={{ fontWeight: 900, color: themeCfg.uiText, marginBottom: 4 }}>{x.title}</div>
                      <div style={{ color: themeCfg.uiSoftText, lineHeight: 1.6 }}>{x.text}</div>
                    </div>
                  </div>
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
            <div style={{ ...glassPanel, padding: 22 }}>
              <div
                style={{
                  fontSize: "0.8rem",
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  fontWeight: 900,
                  color: themeCfg.uiSoftText,
                  marginBottom: 10,
                }}
              >
                Über SoftVibe
              </div>

              <p style={{ margin: 0, color: themeCfg.uiSoftText, lineHeight: 1.75, fontSize: "1.02rem" }}>
                SoftVibe ist gebaut für Menschen, die Schlaf & Ruhe ernst nehmen. Nicht “mehr Content”, sondern das
                richtige Gefühl: warm, nah, ruhig – und trotzdem sauber produziert.
              </p>
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
                }}
              >
                Kontakt
              </div>

              <p style={{ marginTop: 0, color: themeCfg.uiSoftText, lineHeight: 1.7 }}>
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

        <footer style={{ textAlign: "center", padding: "0 18px", color: themeCfg.uiSoftText, fontSize: "0.85rem" }}>
          © {new Date().getFullYear()} SoftVibe · <span style={{ opacity: 0.9 }}>ASMR · Meditation · Sleep Stories</span>
        </footer>
      </div>

     </SVScene>
  );
}