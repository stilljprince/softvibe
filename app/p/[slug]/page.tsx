// app/p/[slug]/page.tsx
import PublicPreviewClient from "./PublicPreviewClient";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function PublicPreviewPage({ params }: PageProps) {
  const { slug } = await params;

  return <PublicPreviewClient slug={slug} />;
}