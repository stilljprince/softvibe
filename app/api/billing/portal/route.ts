// app/api/billing/portal/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";

export async function POST() {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user || !session.user.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        stripeCustomerId: true,
      },
    });

    if (!user) {
      return new NextResponse("User not found", { status: 404 });
    }

    if (!user.stripeCustomerId) {
      // User hat (noch) kein Stripe-Customer
      return new NextResponse("Stripe customer not found for user", {
        status: 400,
      });
    }

    const returnUrl =
      process.env.NEXT_PUBLIC_APP_URL
        ? `${process.env.NEXT_PUBLIC_APP_URL}/account`
        : "http://localhost:3000/account";

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: returnUrl,
    });

    if (!portalSession.url) {
      return new NextResponse("Could not create billing portal session", {
        status: 500,
      });
    }

    return NextResponse.json({ url: portalSession.url });
  } catch (error) {
    console.error("[BILLING_PORTAL_ERROR]", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}