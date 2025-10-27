// app/generate/page.tsx
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import GenerateClient from "./ui";

export default async function GeneratePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect("/login?callbackUrl=/generate");
  }
  return <GenerateClient />;
}