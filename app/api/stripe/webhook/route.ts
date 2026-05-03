// app/api/stripe/webhook/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

type PlanId = "starter" | "pro" | "ultra";

function creditsForPlan(rawPlan: string | null | undefined): number {
  const plan = (rawPlan ?? "").toLowerCase() as PlanId | "";
  if (plan === "starter") return 5000;
  if (plan === "pro") return 20000;
  if (plan === "ultra") return 100000;
  // Fallback, falls metadata.plan komisch ist
  return 5000;
}

export async function POST(req: Request) {
  // 1) Secret vorhanden?
  if (!STRIPE_WEBHOOK_SECRET) {
    console.error("[billing/webhook] STRIPE_WEBHOOK_SECRET fehlt.");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  // 2) Signatur-Header
  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
  }

  // 3) Roh-Body als Text holen (wichtig für Signatur)
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[billing/webhook] constructEvent failed:", msg);
    return NextResponse.json({ error: `Webhook error: ${msg}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      // ✅ Checkout abgeschlossen → Stripe-Customer + Subscription + Credits
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id ?? null;

        const rawSub = (session as { subscription?: unknown }).subscription;
        let subscriptionId: string | null = null;
        if (typeof rawSub === "string") {
          subscriptionId = rawSub;
        } else if (rawSub && typeof (rawSub as { id?: unknown }).id === "string") {
          subscriptionId = (rawSub as { id: string }).id;
        }

        const userId = session.metadata?.userId ?? null;
        const planMeta = session.metadata?.plan ?? null;

        console.log("[billing/webhook] checkout.session.completed:", {
          userId,
          customerId,
          subscriptionId,
          planMeta,
        });

        if (!userId) {
          console.warn(
            "[billing/webhook] checkout.session.completed ohne userId in metadata"
          );
          break;
        }

        const creditsToAdd = creditsForPlan(planMeta);

        const data: Prisma.UserUpdateInput = {
          credits: { increment: creditsToAdd },
        };

        if (customerId) {
          data.stripeCustomerId = customerId;
        }
        if (subscriptionId) {
          data.stripeSubscriptionId = subscriptionId;
        }

        await prisma.user.update({
          where: { id: userId },
          data,
        });

        break;
      }

      // 🔎 Optional: nur Logging, keine Credits mehr hier
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const invWithSub = invoice as { subscription?: unknown };
        const rawSub = invWithSub.subscription;
        let subscriptionId: string | null = null;
        if (typeof rawSub === "string") {
          subscriptionId = rawSub;
        } else if (rawSub && typeof (rawSub as { id?: unknown }).id === "string") {
          subscriptionId = (rawSub as { id: string }).id;
        }

        const customerId =
          typeof invoice.customer === "string"
            ? invoice.customer
            : invoice.customer?.id ?? null;

        console.log("[billing/webhook] invoice.payment_succeeded:", {
          subscriptionId,
          customerId,
          billing_reason: invoice.billing_reason,
          invoiceId: invoice.id,
        });

        // ⚠️ Wichtige Info:
        // Credits werden jetzt NUR bei checkout.session.completed gutgeschrieben.
        // Hier machen wir nichts mehr, um Doppelbuchungen zu vermeiden.
        break;
      }

      // ✅ Subscription gekündigt → Subscription-ID beim User leeren
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;

        const customerId =
          typeof sub.customer === "string"
            ? sub.customer
            : (sub.customer as
                | Stripe.Customer
                | Stripe.DeletedCustomer
                | null
                | undefined)?.id ?? null;

        if (!customerId) break;

        const user = await prisma.user.findFirst({
          where: { stripeCustomerId: customerId },
          select: { id: true },
        });

        if (!user) break;

        const clearSubData: Prisma.UserUpdateInput = {
          stripeSubscriptionId: null,
        };

        await prisma.user.update({
          where: { id: user.id },
          data: clearSubData,
        });

        break;
      }

      default:
        // andere Events ignorieren wir erstmal
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[billing/webhook] handler error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}