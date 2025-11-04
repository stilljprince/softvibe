// app/account/page.tsx
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import AccountClient from "./ui";

export default async function AccountPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login?callbackUrl=/account");
  }

  return (
    <AccountClient
      user={{
        id: session.user.id as string,
        name: session.user.name ?? "Unbekannt",
        email: session.user.email ?? "",
        image: null, // Upload machen wir später
      }}
    />
  );
}