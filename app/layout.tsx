import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SoftVibe",
  description: "AI-gestützte ASMR-Plattform",
};

// 👉 Wichtig: Next.js unterstützt `themeColor` nur noch über viewport
export const viewport: Viewport = {
  themeColor: "#fdfbf7", // gleiche Farbe wie dein Light-Mode-Background
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <head>
        {/* iOS spezifische Einstellungen */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}


