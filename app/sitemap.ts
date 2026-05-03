// app/sitemap.ts
import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

  // Statische Seiten
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: new Date() },
    { url: `${base}/generate`, lastModified: new Date() },
    { url: `${base}/library`, lastModified: new Date() },
    { url: `${base}/account`, lastModified: new Date() },
    { url: `${base}/datenschutz`, lastModified: new Date() },
    { url: `${base}/impressum`, lastModified: new Date() },
  ];

  // Öffentliche Tracks (werden unter /p/<slug> geteilt)
  const publicTracks = await prisma.track.findMany({
    where: { isPublic: true, shareSlug: { not: null } },
    select: { shareSlug: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: 2000, // Safety-Limit
  });

  const dynamicRoutes: MetadataRoute.Sitemap = publicTracks
    .filter((t) => t.shareSlug)
    .map((t) => ({
      url: `${base}/p/${t.shareSlug!}`,
      lastModified: t.updatedAt ?? new Date(),
    }));

  return [...staticRoutes, ...dynamicRoutes];
}