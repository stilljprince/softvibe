// app/sitemap.xml/route.ts
export const runtime = "edge";

function iso(d: Date) {
  return d.toISOString();
}

export async function GET() {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const now = new Date();

  const urls = [
    { loc: `${base}/`,                lastmod: iso(now), changefreq: "weekly",  priority: "0.9" },
    { loc: `${base}/generate`,        lastmod: iso(now), changefreq: "weekly",  priority: "0.8" },
    { loc: `${base}/library`,         lastmod: iso(now), changefreq: "weekly",  priority: "0.6" },
    { loc: `${base}/account`,         lastmod: iso(now), changefreq: "monthly", priority: "0.4" },
    { loc: `${base}/login`,           lastmod: iso(now), changefreq: "yearly",  priority: "0.2" },
    { loc: `${base}/register`,        lastmod: iso(now), changefreq: "yearly",  priority: "0.2" },
    { loc: `${base}/impressum`,       lastmod: iso(now), changefreq: "yearly",  priority: "0.1" },
    { loc: `${base}/datenschutz`,     lastmod: iso(now), changefreq: "yearly",  priority: "0.1" },
  ];

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
    urls
      .map(
        (u) =>
          `<url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`
      )
      .join("") +
    `</urlset>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}