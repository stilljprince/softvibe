// app/api/billing/portal/route.ts
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { jsonOk, jsonError } from "@/lib/api";

export const runtime = "nodejs";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return jsonError("UNAUTHORIZED", 401, { message: "Bitte einloggen." });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, stripeCustomerId: true },
  });

  if (!user) {
    return jsonError("USER_NOT_FOUND", 404, { message: "User nicht gefunden." });
  }

  if (!user.stripeCustomerId) {
    return jsonError("NO_STRIPE_CUSTOMER", 400, {
      message: "Kein Stripe-Konto für diesen User gefunden.",
    });
  }

  const returnUrl = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/account`
    : "http://localhost:3000/account";

  let portalUrl: string;
  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: returnUrl,
    });
    if (!portalSession.url) {
      return jsonError("NO_PORTAL_URL", 500, {
        message: "Stripe konnte keine Portal-URL erstellen.",
      });
    }
    portalUrl = portalSession.url;
  } catch (err) {
    console.error("[BILLING_PORTAL_ERROR]", err);
    return jsonError("STRIPE_ERROR", 500, {
      message: "Fehler beim Erstellen der Billing-Portal-Session.",
    });
  }

  return jsonOk({ url: portalUrl }, 200);
}
