// app/register/page.tsx
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import RegisterForm from "./ui";

export default async function RegisterPage() {
  const session = await getServerSession(authOptions);

  // eingeloggt? → kein zweites Registrieren
  if (session?.user) {
    redirect("/account");
  }

  return <RegisterForm />;
}