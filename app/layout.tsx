// app/layout.tsx (nur metadata anpassen)
import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "./providers";
import GlobalPlayer from "./components/global-player";

const SITE_DESCRIPTION =
  "Persönliche Schlafgeschichten, Meditationen, sanfte ASMR-Sessions, Kids Stories und eigene Hörgeschichten — gestaltet für Ruhe, Atmosphäre und Vorstellungskraft.";

export const metadata: Metadata = {
  title: "SoftVibe — Persönliche Audioerlebnisse",
  description: SITE_DESCRIPTION,
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    title: "SoftVibe — Persönliche Audioerlebnisse",
    description: SITE_DESCRIPTION,
    url: "/",
    siteName: "SoftVibe",
  },
  twitter: {
    card: "summary_large_image",
    title: "SoftVibe — Persönliche Audioerlebnisse",
    description: SITE_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: "#fdfbf7",
};

// … dein bestehender RootLayout-Code darunter unverändert …

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" data-scroll-behavior="smooth">
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body>
        <Providers>
          {children}
          <GlobalPlayer />
        </Providers>
      </body>
    </html>
  );
}