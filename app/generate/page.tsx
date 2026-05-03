// app/generate/page.tsx
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import GenerateClient from "./ui";

export default async function GeneratePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect("/login?callbackUrl=/generate");
  }
  const sp = await searchParams;
  const prompt      = typeof sp.prompt      === "string" ? sp.prompt      : undefined;
  const preset      = typeof sp.preset      === "string" ? sp.preset      : undefined;
  const ref         = typeof sp.ref         === "string" ? sp.ref         : undefined;
  const refType     = typeof sp.refType     === "string" ? sp.refType     : undefined;
  const sourceTitle = typeof sp.sourceTitle === "string" ? sp.sourceTitle : undefined;
  const durationSec = typeof sp.durationSec === "string" ? Number(sp.durationSec) : undefined;
  const initialDurationMin =
    typeof durationSec === "number" && durationSec > 0
      ? Math.round(durationSec / 60)
      : undefined;
  return (
    <GenerateClient
      initialPrompt={prompt}
      initialPreset={preset}
      initialRef={ref}
      initialRefType={refType}
      initialSourceTitle={sourceTitle}
      initialDurationMin={initialDurationMin}
    />
  );
}