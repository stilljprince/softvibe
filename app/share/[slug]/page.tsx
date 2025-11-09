// app/share/[slug]/page.tsx
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { notFound } from "next/navigation";

export const runtime = "nodejs";

export default async function SharePage({
  params,
}: {
  params: { slug: string };
}) {
  const { slug } = params;

  // Track per Share-Slug holen (ohne "prompt", weil das Feld im Track nicht existiert)
  const track = await prisma.track.findUnique({
    where: { shareSlug: slug },
    select: {
      id: true,
      title: true,
      url: true,
      createdAt: true,
      durationSeconds: true,
      userId: true,
    },
  });

  if (!track) {
    notFound();
  }

  const session = await getServerSession(authOptions);
  const isAuthed = !!session?.user?.id;

  const displayTitle = (track.title && track.title.trim() !== ""
    ? track.title
    : "SoftVibe Audio");

  // Für Gäste: 5-Sekunden-Preview via Media Fragments (#t=0,5)
  const previewSrc = `${track.url}#t=0,5`;

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--color-bg)",
        color: "var(--color-text)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 16px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 840,
          background: "var(--color-card)",
          border: "1px solid var(--color-nav-bg)",
          borderRadius: 16,
          boxShadow: "0 10px 24px rgba(0,0,0,.06)",
          padding: 18,
        }}
      >
        {/* Head */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 10,
          }}
        >
          <h1 style={{ fontSize: "1.25rem", fontWeight: 800, margin: 0 }}>
            {displayTitle}
          </h1>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <Link
              href="/"
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                background: "var(--color-nav-bg)",
                color: "var(--color-nav-text)",
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              Startseite
            </Link>
            <Link
              href="/generate"
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                background: "var(--color-accent)",
                color: "#fff",
                textDecoration: "none",
                fontWeight: 700,
              }}
            >
              Eigene erstellen
            </Link>
          </div>
        </div>

        {/* Meta */}
        <div style={{ fontSize: "0.85rem", opacity: 0.75, marginBottom: 12 }}>
          {track.durationSeconds ? `${track.durationSeconds}s · ` : ""}
          {track.createdAt ? new Date(track.createdAt).toLocaleString("de-DE") : ""}
        </div>

        {/* Player-Bereich */}
        {isAuthed ? (
          // Voller Zugriff
          <div>
            <audio controls preload="none" src={track.url} style={{ width: "100%" }} />
            <p style={{ opacity: 0.75, marginTop: 12 }}>
              Du bist angemeldet – voller Zugriff auf diesen Track.
            </p>
          </div>
        ) : (
          // Gated Preview
          <div>
            <div style={{ position: "relative" }}>
              <audio controls preload="none" src={previewSrc} style={{ width: "100%" }} />
              <div
                style={{
                  position: "absolute",
                  right: 8,
                  bottom: 8,
                  fontSize: "0.75rem",
                  opacity: 0.7,
                  background: "color-mix(in oklab, var(--color-card) 92%, #000)",
                  border: "1px solid var(--color-nav-bg)",
                  borderRadius: 999,
                  padding: "2px 8px",
                }}
              >
                Preview (5s)
              </div>
            </div>

            <div
              style={{
                marginTop: 14,
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <Link
                href={`/login?callbackUrl=${encodeURIComponent(`/share/${slug}`)}`}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: "var(--color-accent)",
                  color: "#fff",
                  textDecoration: "none",
                  fontWeight: 700,
                }}
              >
                Anmelden & komplett hören
              </Link>
              <Link
                href={`/register?callbackUrl=${encodeURIComponent(`/share/${slug}`)}`}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: "var(--color-nav-bg)",
                  color: "var(--color-nav-text)",
                  textDecoration: "none",
                  fontWeight: 700,
                }}
              >
                Neu bei SoftVibe? Account erstellen
              </Link>
            </div>

            <p style={{ opacity: 0.75, marginTop: 10 }}>
              Tipp: Mit einem kostenlosen Account kannst du komplette Audios hören
              und eigene erstellen.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}