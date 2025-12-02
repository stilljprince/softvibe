// app/account/page.tsx
import { getServerSession } from "next-auth/next"; // 🔹 kleine Anpassung hier
import { authOptions } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import AccountClient from "./ui";

function mapPriceToPlan(priceId: string | null): string | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_STARTER) return "Starter";
  if (priceId === process.env.STRIPE_PRICE_PRO) return "Pro";
  if (priceId === process.env.STRIPE_PRICE_ULTRA) return "Ultra";
  return "Unbekannter Plan";
}

function mapStripeStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "active":
    case "trialing":
      return "aktiv";
    case "canceled":
      return "gekündigt";
    case "incomplete":
    case "incomplete_expired":
    case "past_due":
    case "unpaid":
      return "inaktiv";
    default:
      return "unbekannt";
  }
}

export default async function AccountPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/account");
  }

  const userId = session.user.id as string;

  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      credits: true,
      isAdmin: true,
      stripeSubscriptionId: true, // 🔹 wichtig
      createdAt: true,
    },
  });

  if (!dbUser) {
    redirect("/login?callbackUrl=/account");
  }

  let hasSubscription = !!dbUser.stripeSubscriptionId;
  let planLabel: string | null = null;
  let planStatus: string | null = null;

  if (dbUser.stripeSubscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(dbUser.stripeSubscriptionId);

      const firstItem = sub.items?.data?.[0];
      const priceId =
        firstItem && typeof firstItem.price?.id === "string"
          ? firstItem.price.id
          : null;

      planLabel = mapPriceToPlan(priceId);
      planStatus = mapStripeStatusLabel(sub.status);
    } catch (err) {
      console.error("[account] Fehler beim Laden des Stripe-Abos:", err);
      hasSubscription = false;
      planLabel = null;
      planStatus = null;
    }
  }

  return (
    <AccountClient
      user={{
        id: dbUser.id,
        name: dbUser.name ?? session.user.name ?? "Unbekannt",
        email: dbUser.email ?? session.user.email ?? "",
        image: null,

        credits: dbUser.credits,
        isAdmin: dbUser.isAdmin,
        hasSubscription,
        createdAt: dbUser.createdAt.toISOString(),
        planLabel,
        planStatus,
      }}
    />
  );
}