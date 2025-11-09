// app/p/[slug]/page.tsx
import { prisma } from "@/lib/prisma";
import { headers } from "next/headers";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import CopyLink from "./CopyLink";
import HeaderShell from "./HeaderShell";
import CustomPlayer from "../../components/CustomPlayer";
import ShareButton from "@/app/components/ShareButton";
import { notFound } from "next/navigation";

type PageParams = { slug: string };
export const runtime = "nodejs";

export default async function PublicPlayPage({
  params,
}: {
  params: Promise<PageParams>; // Next 15: params ist ein Promise
}) {
  const { slug } = await params;

  // Session prüfen (nur für UI; der Audio-Stream ist über /api/public/[slug] geschützt)
  const session = await getServerSession(authOptions);

  // Track via shareSlug & public
  const track = await prisma.track.findFirst({
    where: { shareSlug: slug, isPublic: true },
    select: {
      id: true,
      title: true,
      createdAt: true,
      durationSeconds: true,
    },
  });

 if (!track) {
  notFound();
}

  // Absolute URLs für Copy & Stream
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const origin = `${proto}://${host}`;

  const publicPageUrl = `${origin}/p/${slug}`;
  const streamUrl = `${origin}/api/public/${slug}`;

  const title = track.title && track.title.trim() !== "" ? track.title : "SoftVibe Track";
  const metaLine =
    (track.durationSeconds ? `${track.durationSeconds}s · ` : "") +
    (track.createdAt ? new Date(track.createdAt).toLocaleString("de-DE") : "");

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--color-bg)",
        color: "var(--color-text)",
        paddingTop: 64,
        paddingLeft: 16,
        paddingRight: 16,
        paddingBottom: 40,
      }}
    >
      {/* Header im Landing-Stil */}
      <HeaderShell loggedIn={!!session?.user} slug={slug} />

      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        {/* Card */}
        <section
          style={{
            background: "var(--color-card)",
            border: "1px solid var(--color-nav-bg)",
            borderRadius: 18,
            boxShadow: "0 12px 28px rgba(0,0,0,.06)",
            padding: 18,
          }}
        >
          <h1 style={{ fontSize: "1.4rem", fontWeight: 800, marginBottom: 6, lineHeight: 1.1 }}>
            {title}
          </h1>
          <p style={{ fontSize: ".85rem", opacity: 0.7 }}>{metaLine}</p>

          {/* Player → immer gesicherte Public-API */}
          <div style={{ marginTop: 14 }}>
           <CustomPlayer src={streamUrl} title={title} />
          </div>

          {/* Hinweis wenn ausgeloggt */}
          {!session?.user ? (
            <div
              style={{
                marginTop: 12,
                padding: "10px 12px",
                borderRadius: 12,
                background: "color-mix(in oklab, var(--color-card) 85%, #000 15%)",
                border: "1px solid var(--color-nav-bg)",
              }}
            >
              <p style={{ margin: 0, lineHeight: 1.35 }}>
                Du bist nicht angemeldet. Der Stream ist geschützt und erfordert ein SoftVibe-Konto.{" "}
                <Link
                  href={`/login?callbackUrl=${encodeURIComponent(`/p/${slug}`)}`}
                  style={{ fontWeight: 700, color: "var(--color-accent)", textDecoration: "none" }}
                >
                  Jetzt anmelden →
                </Link>
              </p>
            </div>
          ) : null}

          {/* Copy-Link & Home */}
          <div
            style={{
              marginTop: 14,
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <CopyLink url={publicPageUrl} />
            
            <ShareButton url={publicPageUrl} label="Teilen" title={title} />
            <Link
              href="/"
              style={{ ...pillLink, background: "transparent", color: "var(--color-text)",
            textDecoration: "none",
            fontWeight: 700,
            padding: "8px 12px",
            borderRadius: 999,
            border: "1px solid var(--color-nav-bg)",
            display:"inline-block"
              }}
            >
              ← Zur Startseite
            </Link>
          </div>
        </section>

        <p style={{ opacity: 0.55, marginTop: 14, fontSize: ".85rem", textAlign: "center" }}>
          Geteilter Link · Sicherer Stream via SoftVibe
        </p>
      </div>
    </main>
  );
}

const pillLink: React.CSSProperties = {
  textDecoration: "none",
  fontWeight: 700,
  padding: "8px 12px",
  borderRadius: 999,
  border: "1px solid var(--color-nav-bg)",
  background: "var(--color-card)",
  color: "var(--color-text)",
  display: "inline-block",
};