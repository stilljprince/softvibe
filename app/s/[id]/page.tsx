import StoryClient from "./story-client";

export default async function StoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <StoryClient storyId={id} />;
}