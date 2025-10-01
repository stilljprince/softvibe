import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SoftVibe",
  description: "AI-gestützte ASMR-Plattform",
};

// 👉 Hier gehört themeColor jetzt rein:
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fdfbf7" },
    { media: "(prefers-color-scheme: dark)", color: "#121212" },
    { media: "(prefers-color-scheme: pastel)", color: "#faf6ff" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <head>
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

