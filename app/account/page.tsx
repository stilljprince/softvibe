// app/account/page.tsx
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import LogoutButton from "@/components/LogoutButton";

export default async function AccountPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    redirect("/login?callbackUrl=/account");
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user) {
    redirect("/login?callbackUrl=/account");
  }

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 700, marginBottom: 16 }}>Mein Konto</h1>

      <section
        style={{
          background: "var(--color-card)",
          color: "var(--color-text)",
          borderRadius: 16,
          border: "1px solid var(--color-nav-bg)",
          boxShadow: "0 8px 20px rgba(0,0,0,0.06)",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--color-nav-bg)",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "var(--color-accent)",
              color: "#fff",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
            }}
            aria-hidden
          >
            {getInitials(user.name ?? user.email)}
          </div>
          <div style={{ fontWeight: 700 }}>{user.name ?? user.email}</div>
        </header>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <Row label="Name" value={user.name ?? "—"} />
            <Row label="E-Mail" value={user.email} />
            <Row label="Nutzer-ID" value={user.id} mono />
            <Row label="Erstellt am" value={fmt(user.createdAt)} />
            <Row label="Geändert am" value={fmt(user.updatedAt)} />
          </tbody>
        </table>
      </section>

      {/* Logout mittig unter der Tabelle */}
      <div style={{ display: "flex", justifyContent: "center", marginTop: 20 }}>
        <LogoutButton />
      </div>
    </main>
  );
}

type CellValue = string | number | null | undefined;

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: CellValue;
  mono?: boolean;
}) {
  return (
    <tr>
      <th
        style={{
          textAlign: "left",
          padding: "14px 20px",
          width: "28%",
          borderBottom: "1px solid var(--color-nav-bg)",
          background: "color-mix(in oklab, var(--color-card) 92%, #000 8%)",
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </th>
      <td
        style={{
          padding: "14px 20px",
          borderBottom: "1px solid var(--color-nav-bg)",
          fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : undefined,
          overflowWrap: "anywhere",
        }}
      >
        {value == null || value === "" ? "—" : String(value)}
      </td>
    </tr>
  );
}

function fmt(d: Date) {
  return new Date(d).toLocaleString("de-DE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getInitials(s: string) {
  const parts = s.trim().split(/\s+/);
  const a = parts[0]?.[0]?.toUpperCase() ?? "";
  const b = parts[1]?.[0]?.toUpperCase() ?? "";
  return (a + b) || (s[0]?.toUpperCase() ?? "👤");
}