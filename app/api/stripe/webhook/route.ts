// app/api/stripe/webhook/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  classifySubscriptionStatus,
  derivePlanFromSubscription,
  extractBillingPeriod,
} from "@/lib/entitlement/stripe-plan-mapping";

export const runtime = "nodejs";

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// Legacy Credits-Gutschrift (Pre-RP-010) — nur noch für Alt-Metadata "pro"
// bzw. "ultra" relevant, falls Stripe einen alten Checkout-Event wiederholt.
// Für die aktuellen MVP-Pläne "starter" und "premium" ist die Entitlement-
// Aktivierung ausschließlich über User.plan / PeriodUsage autoritativ; ein
// Credits-Increment wird deshalb bewusst nicht mehr vorgenommen. Kein neuer
// arbitrarier Premium-Credits-Wert wird eingeführt.
function legacyCreditsForPlan(
  rawPlan: string | null | undefined
): number | null {
  const plan = (rawPlan ?? "").toLowerCase();
  if (plan === "pro") return 20000;
  if (plan === "ultra") return 100000;
  return null;
}

// ---------- helpers (RP-010 Phase 2B-2) -----------------------------------

function extractSubscriptionId(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (raw && typeof (raw as { id?: unknown }).id === "string") {
    return (raw as { id: string }).id;
  }
  return null;
}

function extractCustomerId(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (raw && typeof (raw as { id?: unknown }).id === "string") {
    return (raw as { id: string }).id;
  }
  return null;
}

/**
 * Locate the local user for a Stripe subscription. Prefers an explicit
 * hint (session.metadata.userId), falls back to stripeCustomerId, then
 * stripeSubscriptionId. Returns the user id or null.
 */
async function findUserId(hints: {
  userIdHint?: string | null;
  customerId?: string | null;
  subscriptionId?: string | null;
}): Promise<string | null> {
  const { userIdHint, customerId, subscriptionId } = hints;

  if (userIdHint) {
    const existing = await prisma.user.findUnique({
      where: { id: userIdHint },
      select: { id: true },
    });
    if (existing) return existing.id;
  }

  if (customerId) {
    const byCustomer = await prisma.user.findFirst({
      where: { stripeCustomerId: customerId },
      select: { id: true },
    });
    if (byCustomer) return byCustomer.id;
  }

  if (subscriptionId) {
    const bySub = await prisma.user.findFirst({
      where: { stripeSubscriptionId: subscriptionId },
      select: { id: true },
    });
    if (bySub) return bySub.id;
  }

  return null;
}

/**
 * Sync a Stripe subscription onto the local user, honoring the CEO's
 * Option-C status policy (see classifySubscriptionStatus for details):
 *
 *   SYNC_PAID
 *     Adopt / refresh the paid plan and the current billing period.
 *
 *   KEEP_PAID_UPDATE_PERIOD  (past_due)
 *     Do NOT touch the persisted plan — the user keeps their existing
 *     paid entitlement until planPeriodEnd. Refresh the period boundaries
 *     if Stripe provides valid values.
 *
 *   DOWNGRADE_FREE  (unpaid, incomplete_expired, canceled)
 *     Reset the user to FREE, clear the billing period and drop the
 *     subscription reference.
 *
 *   NO_CHANGE  (incomplete, paused, unknown)
 *     Log a warning and leave the persisted plan untouched. Never
 *     activate paid speculatively, never extend paid artificially.
 *
 * Never touches credits, probe counters, PeriodUsage, LibraryUnlock, or
 * any job/enforcement state — all out of scope for RP-010 Phase 2B-2.
 */
async function syncSubscriptionToUser(params: {
  userId: string;
  subscription: Stripe.Subscription;
  extraCustomerId?: string | null;
}): Promise<void> {
  const { userId, subscription, extraCustomerId } = params;

  const action = classifySubscriptionStatus(subscription.status);
  const { start, end } = extractBillingPeriod(subscription);

  if (action === "DOWNGRADE_FREE") {
    console.log("[billing/webhook] downgrading user to FREE", {
      userId,
      subscriptionId: subscription.id,
      status: subscription.status,
    });
    await resetUserToFree(userId);
    return;
  }

  if (action === "NO_CHANGE") {
    console.warn(
      "[billing/webhook] non-actionable subscription status — leaving persisted plan untouched",
      {
        userId,
        subscriptionId: subscription.id,
        status: subscription.status,
      }
    );
    return;
  }

  // From here on: SYNC_PAID or KEEP_PAID_UPDATE_PERIOD. Both refresh the
  // Stripe reference and the billing period if valid. Only SYNC_PAID also
  // adopts a new plan value.
  const data: Prisma.UserUpdateInput = {
    stripeSubscriptionId: subscription.id,
  };

  if (start !== null) data.planPeriodStart = start;
  if (end !== null) data.planPeriodEnd = end;

  if (action === "SYNC_PAID") {
    const plan = derivePlanFromSubscription(subscription);
    if (plan) {
      data.plan = plan;
    } else {
      console.warn(
        "[billing/webhook] no plan mapping resolved for subscription",
        {
          subscriptionId: subscription.id,
          priceId: subscription.items?.data?.[0]?.price?.id ?? null,
          metadataPlan: subscription.metadata?.plan ?? null,
        }
      );
    }
  }

  if (extraCustomerId) {
    data.stripeCustomerId = extraCustomerId;
  }

  await prisma.user.update({
    where: { id: userId },
    data,
  });
}

/**
 * Reset a local user's paid-plan state after a subscription is fully
 * cancelled. Drops Plan back to FREE and clears the billing period.
 * Credits are intentionally preserved.
 */
async function resetUserToFree(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      plan: "FREE",
      planPeriodStart: null,
      planPeriodEnd: null,
      stripeSubscriptionId: null,
    },
  });
}

// ---------- route ---------------------------------------------------------

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
      // ✅ Checkout abgeschlossen → Stripe-Refs sichern und (bei Subscription)
      //    Plan & Billing-Period synchronisieren. Legacy-Credits werden für
      //    Starter/Premium bewusst nicht mehr gutgeschrieben (siehe unten).
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        const customerId = extractCustomerId(
          (session as { customer?: unknown }).customer
        );
        const subscriptionId = extractSubscriptionId(
          (session as { subscription?: unknown }).subscription
        );

        const userIdHint = session.metadata?.userId ?? null;
        const planMeta = session.metadata?.plan ?? null;

        console.log("[billing/webhook] checkout.session.completed:", {
          userId: userIdHint,
          customerId,
          subscriptionId,
          planMeta,
          mode: session.mode,
        });

        if (!userIdHint) {
          console.warn(
            "[billing/webhook] checkout.session.completed ohne userId in metadata"
          );
          break;
        }

        // 🔸 Stripe-Referenzen sichern. Für Starter/Premium (MVP) wird die
        //    Entitlement-Aktivierung ausschließlich über syncSubscriptionToUser
        //    → User.plan / planPeriod{Start,End} getragen. Legacy-Credits
        //    werden für den neuen Plan-Flow nicht mehr gutgeschrieben; nur
        //    replizierte Alt-Events mit metadata.plan "pro"/"ultra" behalten
        //    ihr ursprüngliches Verhalten.
        const data: Prisma.UserUpdateInput = {};

        const legacyCredits = legacyCreditsForPlan(planMeta);
        if (legacyCredits !== null) {
          data.credits = { increment: legacyCredits };
        }

        if (customerId) {
          data.stripeCustomerId = customerId;
        }
        if (subscriptionId) {
          data.stripeSubscriptionId = subscriptionId;
        }

        if (Object.keys(data).length > 0) {
          await prisma.user.update({
            where: { id: userIdHint },
            data,
          });
        }

        // 🔸 RP-010 2B-2: nur bei echten Subscription-Checkouts Plan/Periode
        //    aus Stripe holen. One-time Payments (mode=payment) lassen Plan
        //    unangetastet — dort werden ausschließlich Credits gutgeschrieben.
        if (subscriptionId) {
          try {
            const subscription = await stripe.subscriptions.retrieve(
              subscriptionId
            );
            await syncSubscriptionToUser({
              userId: userIdHint,
              subscription,
              extraCustomerId: customerId ?? null,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            console.error(
              "[billing/webhook] failed to sync subscription after checkout:",
              { subscriptionId, msg }
            );
          }
        }

        break;
      }

      // ✅ Subscription geändert (Upgrade / Downgrade / Renewal-Anchor / etc.)
      //    → Plan & Billing-Periode aktuell halten
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;

        const customerId = extractCustomerId(sub.customer);
        const userId = await findUserId({
          customerId,
          subscriptionId: sub.id,
        });

        if (!userId) {
          console.warn(
            "[billing/webhook] customer.subscription.updated: kein User zu Stripe-Referenz gefunden",
            { subscriptionId: sub.id, customerId }
          );
          break;
        }

        await syncSubscriptionToUser({
          userId,
          subscription: sub,
          extraCustomerId: customerId ?? null,
        });

        break;
      }

      // 🔎 Renewal-Zahlung erfolgreich → aktuelle Periode aus Stripe holen
      //    (Credits werden hier weiterhin NICHT verändert — siehe unten).
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;

        const parent = (invoice as { parent?: Stripe.Invoice.Parent | null })
          .parent;
        const parentSubId =
          parent?.subscription_details?.subscription != null
            ? extractSubscriptionId(parent.subscription_details.subscription)
            : null;

        const legacySubId = extractSubscriptionId(
          (invoice as { subscription?: unknown }).subscription
        );

        const subscriptionId = parentSubId ?? legacySubId;

        const customerId = extractCustomerId(invoice.customer);

        console.log("[billing/webhook] invoice.payment_succeeded:", {
          subscriptionId,
          customerId,
          billing_reason: invoice.billing_reason,
          invoiceId: invoice.id,
        });

        // ⚠️ Wichtige Info:
        // Credits werden NUR bei checkout.session.completed gutgeschrieben.
        // Hier machen wir bewusst nichts an den Credits, um Doppelbuchungen
        // zu vermeiden.
        //
        // 🔸 RP-010 2B-2: bei Subscription-Rechnungen aktuelle Periode +
        //    Plan aus Stripe frisch übernehmen. Ohne Subscription-Referenz
        //    ist die Rechnung eine One-off → wir tun nichts.
        if (!subscriptionId) break;

        const userId = await findUserId({
          customerId,
          subscriptionId,
        });

        if (!userId) {
          console.warn(
            "[billing/webhook] invoice.payment_succeeded: kein User zu Stripe-Referenz gefunden",
            { subscriptionId, customerId }
          );
          break;
        }

        try {
          const subscription = await stripe.subscriptions.retrieve(
            subscriptionId
          );
          await syncSubscriptionToUser({
            userId,
            subscription,
            extraCustomerId: customerId ?? null,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          console.error(
            "[billing/webhook] failed to sync subscription after invoice.payment_succeeded:",
            { subscriptionId, msg }
          );
        }

        break;
      }

      // ✅ Subscription endgültig gekündigt → Plan zurück auf FREE, Periode
      //    leeren, Subscription-Referenz beim User entfernen.
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;

        const customerId = extractCustomerId(sub.customer);
        const userId = await findUserId({
          customerId,
          subscriptionId: sub.id,
        });

        if (!userId) break;

        await resetUserToFree(userId);

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
