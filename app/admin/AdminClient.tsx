// app/admin/AdminClient.tsx
"use client";

import { useEffect, useState } from "react";
import type React from "react";
import Image from "next/image";
import Link from "next/link";
import HeaderCredits from "@/app/components/HeaderCredits";

type Theme = "light" | "dark" | "pastel";

type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  credits: number;
  isAdmin: boolean;
  hasSubscription: boolean;
  createdAt: string; // ISO
};

type AdminStats = {
  totalJobs: number;
  jobsLast24h: number;
  jobsLast7d: number;
  totalUsers: number;
  withSubscription: number;
  admins: number;
};

export default function AdminClient({
  users,
  stats,
}: {
  users: AdminUser[];
  stats: AdminStats;
}) {
  // ===== Theme wie auf den anderen Seiten =====
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    const saved = (localStorage.getItem("theme") as Theme | null) ?? "light";
    document.documentElement.className = saved;
    setTheme(saved);
  }, []);
  useEffect(() => {
    document.documentElement.className = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);
  const nextTheme: Record<Theme, Theme> = { light: "dark", dark: "pastel", pastel: "light" };
  const getThemeIcon = () => (theme === "light" ? "🌞" : theme === "dark" ? "🌙" : "🎨");
  const handleToggleTheme = () => setTheme(nextTheme[theme]);
  const getLogo = () =>
    theme === "light"
      ? "/softvibe-logo-light.svg"
      : theme === "dark"
      ? "/softvibe-logo-dark.svg"
      : "/softvibe-logo-pastel.svg";

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--color-bg)",
        paddingTop: 64,
        width: "100%",
      }}
    >
      {/* ===== Header wie Account/Library/Generate ===== */}
      <header
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0.6rem 1.5rem",
          background: "color-mix(in oklab, var(--color-bg) 90%, transparent)",
          backdropFilter: "blur(10px)",
        }}
      >
        <div style={{ flex: "0 0 auto" }}>
          <Image src={getLogo()} alt="SoftVibe Logo" width={160} height={50} priority />
        </div>

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
          <Link href="/#features" style={navLinkStyle}>
            Features
          </Link>
          <Link href="/#about" style={navLinkStyle}>
            Über uns
          </Link>
          <Link href="/#contact" style={navLinkStyle}>
            Kontakt
          </Link>
          <Link href="/" style={navLinkStyle}>
            Startseite
          </Link>
        </nav>

        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <HeaderCredits />

          <button
            onClick={handleToggleTheme}
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: "var(--color-button-bg)",
              color: "var(--color-button-text)",
              border: "none",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              fontSize: "1.25rem",
            }}
            aria-label="Theme wechseln"
            title="Theme wechseln"
          >
            {getThemeIcon()}
          </button>

          <form action="/api/auth/signout" method="post">
            <button
              type="submit"
              style={{
                background: "var(--color-accent)",
                color: "#fff",
                border: "none",
                borderRadius: 999,
                padding: "0.4rem 0.9rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Logout
            </button>
          </form>
        </div>

        <style jsx>{`
          @media (max-width: 880px) {
            .desktop-nav {
              display: none !important;
            }
          }
        `}</style>
      </header>

      {/* ===== Inhalt ===== */}
      <div
        style={{
          width: "100%",
          maxWidth: "min(1200px, 100vw - 32px)",
          margin: "40px auto",
          padding: "0 16px",
        }}
      >
        {/* Top-Row: Titel + KPIs */}
        <section style={{ marginBottom: 24 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 14,
            }}
          >
            <h1 style={{ fontSize: "1.8rem", fontWeight: 800 }}>Admin-Dashboard</h1>
            <span
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                border: "1px solid var(--color-nav-bg)",
                fontSize: "0.8rem",
              }}
            >
              {stats.totalUsers} Nutzer
            </span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
              gap: 12,
            }}
          >
            <KpiCard label="Jobs gesamt" value={stats.totalJobs} />
            <KpiCard label="Jobs letzte 24h" value={stats.jobsLast24h} />
            <KpiCard label="Jobs letzte 7 Tage" value={stats.jobsLast7d} />
            <KpiCard label="Mit Subscription" value={stats.withSubscription} />
            <KpiCard label="Admins" value={stats.admins} />
          </div>
        </section>

        {/* User-Tabelle */}
        <section>
          <h2 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: 10 }}>Nutzer</h2>
          <div
            style={{
              overflowX: "auto",
              borderRadius: 14,
              border: "1px solid var(--color-nav-bg)",
              background: "var(--color-card)",
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "0.9rem",
              }}
            >
              <thead>
                <tr
                  style={{
                    background: "color-mix(in oklab, var(--color-card) 90%, var(--color-bg))",
                  }}
                >
                  <Th>Email</Th>
                  <Th>Name</Th>
                  <Th>Credits</Th>
                  <Th>Sub</Th>
                  <Th>Admin</Th>
                  <Th>Mitglied seit</Th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <Td
                      style={{
                        fontFamily:
                          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas",
                      }}
                    >
                      {u.email}
                    </Td>
                    <Td>{u.name || "—"}</Td>
                    <Td>{u.credits}</Td>
                    <Td>{u.hasSubscription ? "✅" : "—"}</Td>
                    <Td>{u.isAdmin ? "✅" : "—"}</Td>
                    <Td>{formatDate(u.createdAt)}</Td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <Td colSpan={6} style={{ textAlign: "center", opacity: 0.7 }}>
                      Keine Nutzer gefunden.
                    </Td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function KpiCard({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        background: "var(--color-card)",
        borderRadius: 16,
        border: "1px solid var(--color-nav-bg)",
        padding: "10px 14px",
        boxShadow: "0 8px 20px rgba(0,0,0,0.05)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <span style={{ fontSize: "0.8rem", opacity: 0.7 }}>{label}</span>
      <span style={{ fontSize: "1.2rem", fontWeight: 800 }}>{value}</span>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "8px 10px",
        borderBottom: "1px solid var(--color-nav-bg)",
        fontWeight: 700,
        fontSize: "0.8rem",
        textTransform: "uppercase",
        letterSpacing: "0.03em",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  style,
  colSpan,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      style={{
        padding: "8px 10px",
        borderBottom: "1px solid rgba(0,0,0,0.04)",
        ...style,
      }}
    >
      {children}
    </td>
  );
}

const navLinkStyle: React.CSSProperties = {
  padding: "0.4rem 0.85rem",
  borderRadius: 6,
  background: "var(--color-nav-bg)",
  color: "var(--color-nav-text)",
  textDecoration: "none",
  fontWeight: 600,
  fontSize: "0.9rem",
};