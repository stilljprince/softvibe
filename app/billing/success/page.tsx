// app/billing/success/page.tsx
import Link from "next/link";

type Props = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function mapPlanLabel(planRaw: string | undefined): string | null {
  if (!planRaw) return null;
  const plan = planRaw.toLowerCase();
  if (plan === "starter") return "Starter";
  if (plan === "pro") return "Pro";
  if (plan === "ultra") return "Ultra";
  return null;
}

export default async function BillingSuccessPage({ searchParams }: Props) {
  const sp = await searchParams;

  const sessionId = Array.isArray(sp.session_id)
    ? sp.session_id[0]
    : sp.session_id;

  const planRaw = Array.isArray(sp.plan)
    ? sp.plan[0]
    : sp.plan;

  const planLabel = mapPlanLabel(planRaw);

  return (
    <main
      style={{
        maxWidth: 640,
        margin: "60px auto",
        padding: "0 16px",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: "1.8rem", fontWeight: 800, marginBottom: 12 }}>
        Zahlung erfolgreich 🎉
      </h1>
      <p style={{ opacity: 0.8, marginBottom: 16 }}>
        Deine Zahlung wurde verarbeitet. Die Credits werden in Kürze deinem Konto
        gutgeschrieben.
      </p>

      {planLabel && (
        <section
          style={{
            margin: "0 auto 20px",
            padding: "0.9rem 1rem",
            borderRadius: 16,
            border: "1px solid var(--color-nav-bg)",
            background: "var(--color-card)",
            textAlign: "left",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Dein Abo</div>
          <div style={{ fontSize: "0.9rem" }}>
            Du hast soeben das{" "}
            <span style={{ fontWeight: 600 }}>{planLabel}-Abo</span> aktiviert.
          </div>
          <div style={{ fontSize: "0.85rem", opacity: 0.8, marginTop: 4 }}>
            Dein Abo erneuert sich automatisch und schreibt dir regelmäßig neue Credits gut.
            Details zu Zahlungsmethode, Rechnungen oder einer Kündigung findest du jederzeit
            in deinem Account.
          </div>
        </section>
      )}

      {sessionId && (
        <p
          style={{
            fontSize: "0.8rem",
            opacity: 0.6,
            marginBottom: 20,
            wordBreak: "break-all",
          }}
        >
          Session-ID: <code>{sessionId}</code>
        </p>
      )}

      <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
        <Link
          href="/account"
          style={{
            padding: "10px 16px",
            borderRadius: 999,
            border: "1px solid var(--color-nav-bg)",
            background: "var(--color-card)",
            color: "var(--color-text)",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Zum Account
        </Link>
        <Link
          href="/library"
          style={{
            padding: "10px 16px",
            borderRadius: 999,
            border: "1px solid var(--color-nav-bg)",
            background: "var(--color-accent)",
            color: "#fff",
            fontWeight: 700,
            textDecoration: "none",
          }}
        >
          Zur Bibliothek
        </Link>
        <Link
          href="/generate"
          style={{
            padding: "10px 16px",
            borderRadius: 999,
            border: "1px solid var(--color-nav-bg)",
            background: "var(--color-card)",
            color: "var(--color-text)",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Neue Generierung
        </Link>
      </div>
    </main>
  );
}