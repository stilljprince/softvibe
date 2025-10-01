"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "pastel";

export default function Home() {
  const [theme, setTheme] = useState<Theme>("light");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const saved = (localStorage.getItem("theme") as Theme | null) ?? "light";
    document.documentElement.className = saved;
    setTheme(saved);
  }, []);

  useEffect(() => {
    document.documentElement.className = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

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

  return (
    <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
{/* Header */}
<header
  style={{
    position: "relative",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "1rem 2rem",
  }}
>
  {/* Logo links */}
  <div style={{ flex: "0 0 auto" }}>
    <Image src={getLogo()} alt="SoftVibe Logo" width={160} height={50} />
  </div>

  {/* Navigation Mitte (nur Desktop sichtbar) */}
  <nav
    className="desktop-nav"
    style={{
      flex: "1 1 auto",
      display: "flex",
      justifyContent: "center",
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
          display: "inline-block",
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget as HTMLAnchorElement;
          el.style.background = "var(--color-accent)";
          el.style.transform = "translateY(-2px)";
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLAnchorElement;
          el.style.background = "var(--color-nav-bg)";
          el.style.transform = "translateY(0)";
        }}
      >
        {item.label}
      </a>
    ))}
  </nav>

  {/* Buttons rechts (nur Desktop sichtbar) */}
  <div className="desktop-nav" style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
    {/* Anmelden */}
    <button
      style={{
        padding: "0.5rem 1rem",
        borderRadius: "8px",
        background: "var(--color-button-bg)",
        color: "var(--color-button-text)",
        border: "none",
        fontWeight: 600,
        cursor: "pointer",
        transition: "all 0.2s ease",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = "var(--color-nav-bg)";
        el.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = "var(--color-button-bg)";
        el.style.transform = "translateY(0)";
      }}
    >
      Anmelden
    </button>

    {/* Testen */}
    <button
      style={{
        padding: "0.5rem 1rem",
        borderRadius: "8px",
        background: "var(--color-accent)",
        color: "#fff",
        border: "none",
        fontWeight: 600,
        cursor: "pointer",
        transition: "all 0.2s ease",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = "#333";
        el.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = "var(--color-accent)";
        el.style.transform = "translateY(0)";
      }}
    >
      Testen
    </button>

    {/* Mode Switch Button */}
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
        transition: "transform 0.2s ease",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
      }}
    >
      {getThemeIcon()}
    </button>
  </div>

  {/* Mobile Navigation (Burger + Slide-In) */}
  <div className="mobile-nav">
    <button
      className="burger-btn"
      style={{
        fontSize: "1.5rem",
        background: "var(--color-button-bg)",
        color: "var(--color-button-text)",
        border: "none",
        borderRadius: "8px",
        padding: "0.5rem 0.75rem",
        cursor: "pointer",
        zIndex: 1001,
      }}
      onClick={() => {
        document.querySelector(".mobile-menu")?.classList.add("open");
        document.querySelector(".overlay")?.classList.add("show");
      }}
    >
      ☰
    </button>

    {/* Overlay */}
    <div
      className="overlay"
      onClick={() => {
        document.querySelector(".mobile-menu")?.classList.remove("open");
        document.querySelector(".overlay")?.classList.remove("show");
      }}
    ></div>

    {/* Slide-In Menü */}
    <div className="mobile-menu">
      {[
        { id: "features", label: "Features" },
        { id: "about", label: "Über uns" },
        { id: "contact", label: "Kontakt" },
      ].map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          style={{
            padding: "1rem",
            borderBottom: "1px solid var(--color-nav-bg)",
            color: "var(--color-text)",
            textDecoration: "none",
            fontWeight: 600,
          }}
          onClick={() => {
            document.querySelector(".mobile-menu")?.classList.remove("open");
            document.querySelector(".overlay")?.classList.remove("show");
          }}
        >
          {item.label}
        </a>
      ))}

      <button
        style={{
          padding: "1rem",
          background: "none",
          border: "none",
          color: "var(--color-text)",
          fontWeight: 600,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        Anmelden
      </button>
      <button
        style={{
          padding: "1rem",
          background: "var(--color-accent)",
          border: "none",
          borderRadius: "6px",
          margin: "1rem",
          color: "#fff",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Testen
      </button>
      <button
        onClick={() => {
          handleToggle();
          document.querySelector(".mobile-menu")?.classList.remove("open");
          document.querySelector(".overlay")?.classList.remove("show");
        }}
        style={{
          padding: "1rem",
          background: "none",
          border: "none",
          color: "var(--color-text)",
          fontWeight: 600,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {getThemeIcon()} Theme wechseln
      </button>
    </div>
  </div>

  <style jsx>{`
    .desktop-nav {
      display: flex;
    }
    .mobile-nav {
      display: none;
    }
    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
      z-index: 999;
    }
    .overlay.show {
      opacity: 1;
      pointer-events: all;
    }
    .mobile-menu {
      position: fixed;
      top: 0;
      right: -100%;
      height: 100%;
      width: 70%;
      max-width: 300px;
      background: var(--color-card);
      box-shadow: -2px 0 10px rgba(0, 0, 0, 0.2);
      display: flex;
      flex-direction: column;
      z-index: 1000;
      transition: right 0.3s ease-in-out;
      padding-top: 4rem;
    }
    .mobile-menu.open {
      right: 0;
    }
    @media (max-width: 768px) {
      .desktop-nav {
        display: none !important;
      }
      .mobile-nav {
        display: block !important;
      }
    }
  `}</style>
</header>




{/* Hero Section – zentrierte Box, nicht volle Breite */}
<section style={{ padding: "2rem 1rem" }}>
  <div
    style={{
      position: "relative",
      width: "100%",
      maxWidth: "1200px",            // <- begrenzt die Breite
      margin: "0 auto",              // <- zentriert
      height: "clamp(320px, 45vh, 520px)", // <- responsiv: min/ideal/max
      borderRadius: "20px",
      overflow: "hidden",
      backgroundImage: `url("/softvibe-hero-banner-${theme}.png")`,
      backgroundSize: "cover",
      backgroundPosition: "right center",   // <- hält das Motiv (Frau) sichtbar
      backgroundRepeat: "no-repeat",
    }}
  >
    {/* Lesbarkeits-Layer (hell im Light/Pastel, dunkel im Dark) */}
    <div
      style={{
        position: "absolute",
        inset: 0,
        background:
          theme === "dark"
            ? "linear-gradient(90deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.2) 40%, rgba(0,0,0,0) 70%)"
            : "linear-gradient(90deg, rgba(255,255,255,0.65) 0%, rgba(255,255,255,0.35) 40%, rgba(255,255,255,0) 70%)",
        pointerEvents: "none",
      }}
    />

    {/* Inhalt links, damit wir das Motiv rechts nicht überdecken */}
    <div
      style={{
        position: "relative",
        zIndex: 1,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        textAlign: "left",
        padding: "2rem",
        maxWidth: "700px",
        color: "var(--color-text)",
      }}
    >
      <h1 style={{ fontSize: "clamp(2rem, 4vw, 3rem)", fontWeight: 700, marginBottom: "0.75rem" }}>
        Entspannung neu erleben mit{" "}
        <span style={{ color: "var(--color-accent)" }}>SoftVibe</span>
      </h1>
      <p
        style={{
          fontSize: "clamp(1rem, 1.6vw, 1.25rem)",
          fontWeight: 400,
          lineHeight: 1.6,
          marginBottom: "1.5rem",
        }}
      >
        Die erste AI-gestützte Plattform, die ASMR, Meditation und Schlafgeschichten
        ganz individuell auf dich zuschneidet. 🌙✨
      </p>
        <button
  style={{
    width: "150px",            /* feste Breite */
    padding: "0.5rem",         /* kleineres Padding */
    borderRadius: "6px",
    background: "var(--color-accent)",
    color: "#fff",
    fontWeight: 600,
    border: "none",
    cursor: "pointer",
    transition: "all 0.2s ease",
  }}
  onMouseEnter={(e) => {
    const el = e.currentTarget as HTMLButtonElement;
    el.style.transform = "translateY(-2px)";
    el.style.filter = "brightness(90%)";
  }}
  onMouseLeave={(e) => {
    const el = e.currentTarget as HTMLButtonElement;
    el.style.transform = "translateY(0)";
    el.style.filter = "brightness(100%)";
  }}
>
  Jetzt ausprobieren
</button>



    </div>
  </div>
</section>





      {/* Features Section */}
<section
  id="features"
  style={{
    padding: "5rem 2rem",
    background: "var(--color-bg)",
  }}
>
  <div
    style={{
      maxWidth: "1200px",
      margin: "0 auto",
      textAlign: "center",
    }}
  >
    <h2 style={{ fontSize: "2.5rem", fontWeight: 700, marginBottom: "1rem" }}>
      Warum <span style={{ color: "var(--color-accent)" }}>SoftVibe?</span>
    </h2>
    <p
      style={{
        fontSize: "1.2rem",
        fontWeight: 400,
        color: "var(--color-text)",
        marginBottom: "3rem",
      }}
    >
      Entdecke die Vorteile unserer Plattform – designed für Ruhe, Fokus und
      besseren Schlaf.
    </p>

    {/* Feature Cards */}
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: "2rem",
      }}
    >
      {/* Card 1 */}
      <div
        style={{
          background: "var(--color-card)",
          padding: "2rem",
          borderRadius: "16px",
          boxShadow: "0 6px 20px rgba(0,0,0,0.08)",
          transition: "transform 0.2s ease, box-shadow 0.2s ease",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.transform = "translateY(-6px)";
          (e.currentTarget as HTMLDivElement).style.boxShadow =
            "0 10px 30px rgba(0,0,0,0.12)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
          (e.currentTarget as HTMLDivElement).style.boxShadow =
            "0 6px 20px rgba(0,0,0,0.08)";
        }}
      >
        <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>🎧</div>
        <h3 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "0.5rem" }}>
          Personalisiertes ASMR
        </h3>
        <p style={{ fontSize: "1rem", color: "var(--color-text)" }}>
          Stelle dir deine eigenen Trigger-Kombinationen zusammen und genieße
          einzigartige Klangerlebnisse.
        </p>
      </div>

      {/* Card 2 */}
      <div
        style={{
          background: "var(--color-card)",
          padding: "2rem",
          borderRadius: "16px",
          boxShadow: "0 6px 20px rgba(0,0,0,0.08)",
          transition: "transform 0.2s ease, box-shadow 0.2s ease",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.transform = "translateY(-6px)";
          (e.currentTarget as HTMLDivElement).style.boxShadow =
            "0 10px 30px rgba(0,0,0,0.12)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
          (e.currentTarget as HTMLDivElement).style.boxShadow =
            "0 6px 20px rgba(0,0,0,0.08)";
        }}
      >
        <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>🧘</div>
        <h3 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "0.5rem" }}>
          Meditation für Fokus
        </h3>
        <p style={{ fontSize: "1rem", color: "var(--color-text)" }}>
          Geführte Sessions, die dich im Alltag entspannter, fokussierter und
          ausgeglichener machen.
        </p>
      </div>

      {/* Card 3 */}
      <div
        style={{
          background: "var(--color-card)",
          padding: "2rem",
          borderRadius: "16px",
          boxShadow: "0 6px 20px rgba(0,0,0,0.08)",
          transition: "transform 0.2s ease, box-shadow 0.2s ease",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.transform = "translateY(-6px)";
          (e.currentTarget as HTMLDivElement).style.boxShadow =
            "0 10px 30px rgba(0,0,0,0.12)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
          (e.currentTarget as HTMLDivElement).style.boxShadow =
            "0 6px 20px rgba(0,0,0,0.08)";
        }}
      >
        <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>🌙</div>
        <h3 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "0.5rem" }}>
          Schlafgeschichten
        </h3>
        <p style={{ fontSize: "1rem", color: "var(--color-text)" }}>
          Entspanne dich mit beruhigenden Geschichten und finde leichter in einen
          tiefen Schlaf.
        </p>
      </div>
    </div>
  </div>
</section>

      {/* About Section */}
      <section
        id="about"
        style={{
          padding: "4rem 2rem",
          textAlign: "center",
          background: "var(--color-card)",
        }}
      >
        <h2 style={{ fontSize: "2rem", fontWeight: 700, marginBottom: "1rem" }}>
          Über SoftVibe
        </h2>
        <p style={{ maxWidth: "700px", margin: "0 auto", fontSize: "1.1rem", fontWeight: 400 }}>
          SoftVibe ist aus der Idee entstanden, dass Entspannung etwas Persönliches ist.  
          Jeder Mensch hat eigene Vorlieben, eigene Trigger, eigene Routinen.  
          Wir nutzen KI, um dir genau die Erfahrung zu geben, die zu dir passt.  
          Dein Moment. Dein Flow. Dein SoftVibe. 💜
        </p>
      </section>

      {/* Contact Section */}
      <section
        id="contact"
        style={{
          padding: "4rem 2rem",
          textAlign: "center",
        }}
      >
        <h2 style={{ fontSize: "2rem", fontWeight: 700, marginBottom: "1rem" }}>
          Kontakt
        </h2>
        <p style={{ maxWidth: "700px", margin: "0 auto 2rem auto", fontSize: "1.1rem", fontWeight: 400 }}>
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
              } else {
                setStatus("error");
              }
            } catch (err) {
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
          <input
            type="text"
            name="name"
            placeholder="Dein Name"
            required
            style={{
              padding: "12px",
              borderRadius: "8px",
              border: `1px solid var(--color-input-border)`,
              background: "var(--color-input-bg)",
              color: "var(--color-input-text)",
              fontSize: "1rem",
            }}
          />
          <input
            type="email"
            name="email"
            placeholder="Deine E-Mail"
            required
            style={{
              padding: "12px",
              borderRadius: "8px",
              border: `1px solid var(--color-input-border)`,
              background: "var(--color-input-bg)",
              color: "var(--color-input-text)",
              fontSize: "1rem",
            }}
          />
          <textarea
            name="message"
            placeholder="Deine Nachricht"
            rows={5}
            required
            style={{
              padding: "12px",
              borderRadius: "8px",
              border: `1px solid var(--color-input-border)`,
              background: "var(--color-input-bg)",
              color: "var(--color-input-text)",
              fontSize: "1rem",
            }}
          />
          <button
  type="submit"
  style={{
    width: "150px",            /* feste Breite, wie bei "Jetzt ausprobieren" */
    padding: "0.5rem",
    borderRadius: "6px",
    background: "var(--color-accent)",
    color: "#fff",
    fontWeight: 600,
    border: "none",
    cursor: "pointer",
    transition: "all 0.2s ease",
    alignSelf: "center",       /* zentriert im Formular */
  }}
  onMouseEnter={(e) => {
    const el = e.currentTarget as HTMLButtonElement;
    el.style.transform = "translateY(-2px)";
    el.style.filter = "brightness(90%)";
  }}
  onMouseLeave={(e) => {
    const el = e.currentTarget as HTMLButtonElement;
    el.style.transform = "translateY(0)";
    el.style.filter = "brightness(100%)";
  }}
>
  Absenden


</button>


        </form>

        {/* Status-Meldung */}
        {status === "sending" && (
          <p style={{ marginTop: "1rem", color: "var(--color-accent)" }}>⏳ Nachricht wird gesendet...</p>
        )}
        {status === "success" && (
          <p style={{ marginTop: "1rem", color: "green" }}>✅ Nachricht erfolgreich gesendet!</p>
        )}
        {status === "error" && (
          <p style={{ marginTop: "1rem", color: "red" }}>❌ Fehler beim Senden. Bitte später nochmal versuchen.</p>
        )}
      </section>

      {/* Footer */}
      <footer
        style={{
          padding: "2rem",
          textAlign: "center",
          fontSize: "0.875rem",
          color: "var(--color-text)",
          background: "var(--color-card)",
        }}
      >
        <p>© {new Date().getFullYear()} SoftVibe. Alle Rechte vorbehalten.</p>
        <p style={{ marginTop: "0.5rem" }}>
          <a href="#" style={{ margin: "0 10px", color: "var(--color-accent)" }}>Impressum</a> |
          <a href="#" style={{ margin: "0 10px", color: "var(--color-accent)" }}>Datenschutz</a>
        </p>
        <p style={{ marginTop: "1rem" }}>
          🌐 Folge uns: 
          <a href="#" style={{ margin: "0 8px", color: "var(--color-accent)" }}>Instagram</a>
          <a href="#" style={{ margin: "0 8px", color: "var(--color-accent)" }}>YouTube</a>
        </p>
      </footer>
    </main>
  );
}



