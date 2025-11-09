// app/layout.tsx (nur metadata anpassen)
import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "SoftVibe",
  description: "AI-gestützte ASMR-Plattform",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    title: "SoftVibe",
    description: "Personalisierte, AI-gestützte ASMR & Sleep Audio.",
    url: "/",
    siteName: "SoftVibe",
  },
  twitter: {
    card: "summary_large_image",
    title: "SoftVibe",
    description: "Personalisierte, AI-gestützte ASMR & Sleep Audio.",
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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}