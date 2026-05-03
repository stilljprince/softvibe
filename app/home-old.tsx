"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import AuthStatus from "@/components/AuthStatus";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

type Theme = "light" | "dark" | "pastel";

export default function Home() {
  const [theme, setTheme] = useState<Theme>("light");
  const [status, setStatus] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [cooldown, setCooldown] = useState(false);

  const { data: session, status: sessionStatus } = useSession();
  const [loggedIn, setLoggedIn] = useState(false);

  // 👇 neu: für Scroll-Hide
  const [showHeader, setShowHeader] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);

  const router = useRouter();

  // Session-Änderung auswerten
  useEffect(() => {
    if (sessionStatus === "authenticated" && session?.user) {
      setLoggedIn(true);
    } else if (sessionStatus === "unauthenticated") {
      setLoggedIn(false);
    }
  }, [sessionStatus, session]);

  // Theme aus localStorage laden
  useEffect(() => {
    const saved = (localStorage.getItem("theme") as Theme | null) ?? "light";
    document.documentElement.className = saved;
    setTheme(saved);
  }, []);

  // Theme speichern
  useEffect(() => {
    document.documentElement.className = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  // 👇 Scroll-Verhalten: runter = weg, hoch = da
  useEffect(() => {
    const handleScroll = () => {
      const currentY = window.scrollY;

      if (currentY > lastScrollY && currentY > 40) {
        // runter
        setShowHeader(false);
      } else {
        // hoch oder oben
        setShowHeader(true);
      }

      setLastScrollY(currentY);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [lastScrollY]);

  const nextTheme: Record<Theme, Theme> = {
    light: "dark",
    dark: "pastel",
    pastel: "light",
  };

  const getThemeIcon = () => {
    if (theme === "light") return "🌞";
    if (theme === "dark") return "🌙";
    return "🎨";
  };

  const handleToggle = () => {
    setTheme(nextTheme[theme]);
  };

  const getLogo = () => {
    if (theme === "light") return "/softvibe-logo-light.svg";
    if (theme === "dark") return "/softvibe-logo-dark.svg";
    return "/softvibe-logo-pastel.svg";
  };

  const closeMenu = () => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      setMenuOpen(false);
    }, 300);
  };


  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        paddingTop: "64px", // Platz für den fixen Header
      }}
    >
      {/* ====================== Header ====================== */}
      <header
        style={{
          position: "fixed",
          top: menuOpen ? 0 : showHeader ? 0 : "-70px", // 👈 Hide/Show + bei offenem Menü immer sichtbar
          left: 0,
          right: 0,
          zIndex: 100,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0.6rem 1.5rem",
          background: "color-mix(in oklab, var(--color-bg) 90%, transparent)",
          backdropFilter: "blur(10px)",
         
          transition: "top 0.2s ease-out",
        }}
      >
        {/* Logo links */}
        <div style={{ flex: "0 0 auto" }}>
          <Image src={getLogo()} alt="SoftVibe Logo" width={160} height={50} priority />
        </div>

        {/* Navigation Mitte (Desktop) */}
        <nav
          className="desktop-nav"
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            display: "flex",
            gap: "1rem",
          }}
        >
          {[
            { id: "features", label: "Features" },
            { id: "about", label: "Über uns" },
            { id: "contact", label: "Kontakt" },
          ].map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "6px",
                background: "var(--color-nav-bg)",
                color: "var(--color-nav-text)",
                textDecoration: "none",
                fontWeight: 600,
                transition: "all 0.2s ease",
              }}
            >
              {item.label}
            </a>
          ))}
        </nav>

        {/* Buttons rechts (Desktop) */}
        <div className="desktop-nav" style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {/* AuthStatus rechts im Header */}
          <AuthStatus />

          {/* Theme-Switch */}
          <button
            onClick={handleToggle}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "40px",
              height: "40px",
              borderRadius: "50%",
              background: "var(--color-button-bg)",
              color: "var(--color-button-text)",
              border: "none",
              cursor: "pointer",
              fontSize: "1.25rem",
            }}
            aria-label="Theme wechseln"
            title="Theme wechseln"
          >
            {getThemeIcon()}
          </button>
        </div>

        {/* Burger Button (nur Mobile sichtbar) */}
        <button
          className="burger-btn"
          onClick={() => setMenuOpen(true)}
          style={{
            fontSize: "1.8rem",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            display: "none",
          }}
        >
          ☰
        </button>


        {/* Styles */}
<style jsx>{`
  .desktop-nav { display: flex; }
  .burger-btn { display: none; }

  @media (max-width: 768px) {
    .desktop-nav { display: none !important; }
    .burger-btn { display: block !important; }
  }

  .mobile-menu.open { animation: slideIn 0.3s forwards; }
  .mobile-menu.closing { animation: slideOut 0.3s forwards; }

  @keyframes slideIn {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }
  @keyframes slideOut {
    from { transform: translateX(0); }
    to { transform: translateX(100%); }
  }

  /* 👇 NEU: Landscape auf kleinen Geräten → trotzdem Mobile-Menü erzwingen */
  @media (orientation: landscape) and (max-width: 1024px) {
    .desktop-nav { display: none !important; }
    .burger-btn { display: block !important; }
  }

  /* optional, falls sehr niedrige Viewports (<600px Höhe) */
  @media (max-height: 600px) and (max-width: 1100px) {
    .desktop-nav { display: none !important; }
    .burger-btn { display: block !important; }
  }
`}</style>
      </header>
{/* ====================== Mobile Menü ====================== */}
{(menuOpen || closing) && (
  <>
    {/* Overlay */}
    <div
      onClick={closeMenu}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 999 }}
    />

    {/* Slide-In/Out Menü */}
    <div
      className={`mobile-menu ${closing ? "closing" : "open"}`}
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        height: "100%",
        width: "70%",
        maxWidth: "300px",
        zIndex: 1000,
        display: "flex",
      }}
    >
      {/* inneres Panel */}
      <div
        style={{
          background:
            theme === "dark"
              ? "#111827"
              : theme === "pastel"
              ? "#fdf7ff"
              : "#fdfbf7",
          borderLeft: "1px solid var(--color-nav-bg)",
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "1rem",
          boxShadow: "-2px 0 10px rgba(0,0,0,0.2)",
        }}
      >
        {/* Theme Switch Button – schließt das Menü NICHT */}
        <button
          onClick={() => {
            handleToggle();
          }}
          style={{
            marginTop: "2rem",
            background: "transparent",
            border: "none",
            textAlign: "left",
            fontWeight: 600,
            color: "var(--color-text)",
            width: "100%",               // 👈 vollbreit
          }}
        >
          {getThemeIcon()} Theme wechseln
        </button>

        {/* Schließen oben rechts */}
        <button
          onClick={closeMenu}
          style={{
            background: "transparent",
            border: "none",
            fontSize: "2rem",
            alignSelf: "flex-end",
            cursor: "pointer",
            marginBottom: "1rem",
            color: "var(--color-text)",
          }}
        >
          ✕
        </button>

        {/* Links + Actions */}
        <nav style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {[
            { id: "features", label: "Features" },
            { id: "about", label: "Über uns" },
            { id: "contact", label: "Kontakt" },
          ].map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              onClick={closeMenu}
              style={{
                padding: "1rem 0",
                fontSize: "1.25rem",
                fontWeight: 600,
                color: "var(--color-text)",
                textDecoration: "none",
                borderBottom: "1px solid var(--color-nav-bg)",
                textAlign: "left",
                width: "100%",             // 👈 vollbreit
                display: "block",           // 👈 block, damit nix nebeneinander will
              }}
            >
              {item.label}
            </a>
          ))}

          {/* 👇 zustandsabhängig */}
          {loggedIn ? (
            <>
              <button
                onClick={() => {
                  closeMenu();
                  router.push("/generate");
                }}
                style={{
                  padding: "1rem 0",
                  fontSize: "1.25rem",
                  fontWeight: 600,
                  color: "var(--color-text)",
                  background: "transparent",
                  border: "none",
                  borderBottom: "1px solid var(--color-nav-bg)",
                  textAlign: "left",
                  cursor: "pointer",
                  width: "100%",           // 👈 vollbreit
                  display: "block",
                }}
              >
                Generieren
              </button>
              <button
                onClick={() => {
                  closeMenu();
                  router.push("/account");
                }}
                style={{
                  padding: "1rem 0",
                  fontSize: "1.25rem",
                  fontWeight: 600,
                  color: "var(--color-text)",
                  background: "transparent",
                  border: "none",
                  borderBottom: "1px solid var(--color-nav-bg)",
                  textAlign: "left",
                  cursor: "pointer",
                  width: "100%",           // 👈 vollbreit
                  display: "block",
                }}
              >
                Mein Konto
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  closeMenu();
                  router.push("/login");
                }}
                style={{
                  padding: "1rem 0",
                  fontSize: "1.25rem",
                  fontWeight: 600,
                  color: "var(--color-text)",
                  background: "transparent",
                  border: "none",
                  borderBottom: "1px solid var(--color-nav-bg)",
                  textAlign: "left",
                  cursor: "pointer",
                  width: "100%",           // 👈 vollbreit
                  display: "block",
                }}
              >
                Anmelden
              </button>
              <button
                onClick={() => {
                  closeMenu();
                  router.push("/register");
                }}
                style={{
                  padding: "1rem 0",
                  fontSize: "1.25rem",
                  fontWeight: 600,
                  color: "var(--color-text)",
                  background: "transparent",
                  border: "none",
                  borderBottom: "1px solid var(--color-nav-bg)",
                  textAlign: "left",
                  cursor: "pointer",
                  width: "100%",           // 👈 vollbreit
                  display: "block",
                }}
              >
                Registrieren
              </button>
            </>
          )}
        </nav>
      </div>
    </div>
  </>
)}
      {/* ====================== Hero ====================== */}
      <section style={{ padding: "2rem 1rem" }}>
        <div
          style={{
            position: "relative",
            width: "100%",
            maxWidth: "1200px",
            margin: "0 auto",
            height: "clamp(320px, 45vh, 520px)",
            borderRadius: "20px",
            overflow: "hidden",
            backgroundImage: `url("/softvibe-hero-banner-${theme}.png")`,
            backgroundSize: "cover",
            backgroundPosition: "right center",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                theme === "dark"
                  ? "linear-gradient(90deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.2) 40%, rgba(0,0,0,0) 70%)"
                  : "linear-gradient(90deg, rgba(255,255,255,0.65) 0%, rgba(255,255,255,0.35) 40%, rgba(255,255,255,0) 70%)",
            }}
          />
          <div
            style={{
              position: "relative",
              zIndex: 1,
              height: "100%",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              padding: "2rem",
              maxWidth: "700px",
              color: "var(--color-text)",
            }}
          >
            <h1 style={{ fontSize: "clamp(2rem, 4vw, 3rem)", fontWeight: 700, marginBottom: "0.75rem" }}>
              Entspannung neu erleben mit <span style={{ color: "var(--color-accent)" }}>SoftVibe</span>
            </h1>
            <p style={{ fontSize: "clamp(1rem, 1.6vw, 1.25rem)", marginBottom: "1.5rem" }}>
              Die erste AI-gestützte Plattform, die ASMR, Meditation und Schlafgeschichten individuell auf dich zuschneidet. 🌙✨
            </p>
            <button
              onClick={() => {
                if (loggedIn) {
                  router.push("/generate");
                } else {
                  router.push("/register");
                }
              }}
              style={{
                width: "180px",
                padding: "0.6rem 0.9rem",
                borderRadius: "6px",
                background: "var(--color-accent)",
                color: "#fff",
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
              }}
            >
              {loggedIn ? "Generieren" : "Jetzt ausprobieren"}
            </button>
          </div>
        </div>
      </section>

      {/* ====================== Features ====================== */}
      <section id="features" style={{ padding: "5rem 2rem", background: "var(--color-bg)" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", textAlign: "center" }}>
          <h2 style={{ fontSize: "2.5rem", fontWeight: 700, marginBottom: "1rem" }}>
            Warum <span style={{ color: "var(--color-accent)" }}>SoftVibe?</span>
          </h2>
          <p style={{ fontSize: "1.2rem", marginBottom: "3rem" }}>
            Entdecke die Vorteile unserer Plattform – designed für Ruhe, Fokus und besseren Schlaf.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "2rem" }}>
            <div style={{ background: "var(--color-card)", padding: "2rem", borderRadius: "16px" }}>
              <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>🎧</div>
              <h3>Personalisiertes ASMR</h3>
              <p>Stelle dir deine eigenen Trigger-Kombinationen zusammen und genieße einzigartige Klangerlebnisse.</p>
            </div>
            <div style={{ background: "var(--color-card)", padding: "2rem", borderRadius: "16px" }}>
              <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>🧘</div>
              <h3>Meditation für Fokus</h3>
              <p>Geführte Sessions, die dich im Alltag entspannter, fokussierter und ausgeglichener machen.</p>
            </div>
            <div style={{ background: "var(--color-card)", padding: "2rem", borderRadius: "16px" }}>
              <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>🌙</div>
              <h3>Schlafgeschichten</h3>
              <p>Entspanne dich mit beruhigenden Geschichten und finde leichter in einen tiefen Schlaf.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ====================== About ====================== */}
      <section id="about" style={{ padding: "4rem 2rem", textAlign: "center", background: "var(--color-card)" }}>
        <h2 style={{ fontSize: "2rem", fontWeight: 700, marginBottom: "1rem" }}>Über SoftVibe</h2>
        <p style={{ maxWidth: "700px", margin: "0 auto", fontSize: "1.1rem" }}>
          SoftVibe ist aus der Idee entstanden, dass Entspannung etwas Persönliches ist.
          Jeder Mensch hat eigene Vorlieben, eigene Trigger, eigene Routinen.
          Wir nutzen KI, um dir genau die Erfahrung zu geben, die zu dir passt.
          Dein Moment. Dein Flow. Dein SoftVibe. 💜
        </p>
      </section>

      {/* ====================== Contact ====================== */}
      <section id="contact" style={{ padding: "4rem 2rem", textAlign: "center" }}>
        <h2 style={{ fontSize: "2rem", fontWeight: 700, marginBottom: "1rem" }}>Kontakt</h2>
        <p style={{ maxWidth: "700px", margin: "0 auto 2rem auto", fontSize: "1.1rem" }}>
          Wir freuen uns immer von dir zu hören – egal ob Feedback, Wünsche oder einfach ein Hallo 👋
        </p>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const data = {
              name: (form.elements.namedItem("name") as HTMLInputElement).value,
              email: (form.elements.namedItem("email") as HTMLInputElement).value,
              message: (form.elements.namedItem("message") as HTMLTextAreaElement).value,
            };
            setStatus("sending");
            try {
              const res = await fetch("/api/contact", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
              });
              const result = await res.json();
              if (result.success) {
                setStatus("success");
                form.reset();

                // Cooldown starten (30 Sek)
                setCooldown(true);
                setTimeout(() => setCooldown(false), 30000);
              } else setStatus("error");
            } catch {
              setStatus("error");
            }
          }}
          style={{
            maxWidth: "600px",
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
          }}
        >
          <input type="text" name="name" placeholder="Dein Name" required />
          <input type="email" name="email" placeholder="Deine E-Mail" required />
          <textarea name="message" placeholder="Deine Nachricht" rows={5} required />
          <button
            type="submit"
            disabled={status === "sending" || cooldown}
            style={{
              width: "150px",
              padding: "0.5rem",
              borderRadius: "6px",
              background: (status === "sending" || cooldown) ? "gray" : "var(--color-accent)",
              color: "#fff",
              fontWeight: 600,
              border: "none",
              cursor: (status === "sending" || cooldown) ? "not-allowed" : "pointer",
              transition: "all 0.2s ease",
              alignSelf: "center",
            }}
          >
            {status === "sending"
              ? "Senden…"
              : cooldown
              ? "Bitte warten…"
              : "Absenden"}
          </button>
        </form>

        {status === "error" && <p>❌ Fehler beim Senden. Bitte später nochmal versuchen.</p>}
        {status === "success" && !cooldown && <p>✅ Nachricht erfolgreich gesendet!</p>}
      </section>

      {/* ====================== Footer ====================== */}
      <footer style={{ padding: "2rem", textAlign: "center", background: "var(--color-card)" }}>
        <p>© {new Date().getFullYear()} SoftVibe. Alle Rechte vorbehalten.</p>
        <p style={{ marginTop: "0.5rem" }}>
          <a href="#">Impressum</a> | <a href="#">Datenschutz</a>
        </p>
        <p style={{ marginTop: "1rem" }}>
          🌐 Folge uns: <a href="#">Instagram</a> <a href="#">YouTube</a>
        </p>
      </footer>
    </main>
  );
}

