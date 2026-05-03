// app/share/[slug]/page.tsx
import { redirect } from "next/navigation";

type PageParams = { slug: string };

// Next 15: params ist ein Promise
export default async function ShareRedirectPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { slug } = await params;
  // einfach auf /p/[slug] weiterleiten – dort liegt deine eigentliche Share-Ansicht
  redirect(`/p/${slug}`);
}