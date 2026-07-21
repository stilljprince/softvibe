// app/account/page.tsx
import { getServerSession } from "next-auth/next"; // 🔹 kleine Anpassung hier
import { authOptions } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { resolveEntitlements } from "@/lib/entitlement/resolver";
import {
  labelFromEntitlementPlan,
  resolveVisiblePlanStatus,
  type EntitlementsView,
} from "@/lib/entitlement-view";
import AccountClient from "./ui";

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
      stripeSubscriptionId: true,
      avatarKey: true,
      createdAt: true,
    },
  });

  if (!dbUser) {
    redirect("/login?callbackUrl=/account");
  }

  let hasSubscription = !!dbUser.stripeSubscriptionId;
  let planStatus: string | null = null;

  // Stripe subscription retrieval is intentionally kept — it drives the
  // billing-metadata pill (aktiv / gekündigt / inaktiv) shown next to the
  // plan label. It does NOT determine the visible plan. The effective plan
  // comes exclusively from the entitlement resolver below.
  if (dbUser.stripeSubscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(dbUser.stripeSubscriptionId);
      planStatus = mapStripeStatusLabel(sub.status);
    } catch (err) {
      console.error("[account] Fehler beim Laden des Stripe-Abos:", err);
      hasSubscription = false;
      planStatus = null;
    }
  }

  // Resolve the server-side entitlement snapshot. This is the visible source
  // of truth for the current plan, probes and Custom Minutes. A paid plan
  // whose billing period has elapsed resolves to FREE here and must render
  // as "Free" — never as an outdated "Starter" / "Premium" derived from a
  // historical Stripe Price ID.
  let entitlements: EntitlementsView | null = null;
  const resolved = await resolveEntitlements(userId);
  if (resolved.ok) {
    const d = resolved.data;
    entitlements = {
      plan: d.plan,
      monthlyMinutes: {
        allowance: d.monthlyMinutes.allowance,
        used: d.monthlyMinutes.used,
        reserved: d.monthlyMinutes.reserved,
        remaining: d.monthlyMinutes.remaining,
      },
      probes: {
        lifetimeLimit: d.probes.lifetimeLimit,
        used: d.probes.used,
        remaining: d.probes.remaining,
        canUse: d.probes.canUse,
      },
      library: { hasDirectAccess: d.library.hasDirectAccess },
    };
  }

  const planLabel: string | null = entitlements
    ? labelFromEntitlementPlan(entitlements.plan)
    : null;

  // The Stripe status pill (aktiv / gekündigt / inaktiv) is a decoration on
  // the visible plan label. Gated by the effective entitlement plan so a
  // historical paid subscription still reporting active can never render as
  // "Free · aktiv". Stripe metadata, hasSubscription and the Customer Portal
  // are intentionally unaffected.
  const visiblePlanStatus: string | null = entitlements
    ? resolveVisiblePlanStatus(entitlements.plan, planStatus)
    : null;

  return (
    <AccountClient
      user={{
        id: dbUser.id,
        name: dbUser.name ?? session.user.name ?? "Unbekannt",
        email: dbUser.email ?? session.user.email ?? "",
        image: null,
        avatarKey: dbUser.avatarKey ?? null,

        credits: dbUser.credits,
        isAdmin: dbUser.isAdmin,
        hasSubscription,
        createdAt: dbUser.createdAt.toISOString(),
        planLabel,
        planStatus: visiblePlanStatus,
        entitlements,
      }}
    />
  );
}