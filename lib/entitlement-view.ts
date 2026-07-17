// lib/entitlement-view.ts
//
// Small, client-safe structural type describing the resolved-entitlement
// snapshot as it appears on the read side of the API (JSON payload from
// /api/account/summary) and when passed from the Account server component
// into the Account client component.
//
// This file intentionally lives OUTSIDE lib/entitlement/** so that it never
// pulls Prisma / server-only modules into a client bundle. It is a pure
// type module. Keep it minimal — only the fields consumed by Generate and
// Account UI are declared here.

export type EntitlementPlanView = "FREE" | "STARTER" | "PREMIUM";

export type EntitlementsView = {
  plan: EntitlementPlanView;
  monthlyMinutes: {
    allowance: number;
    used: number;
    reserved: number;
    remaining: number;
  };
  probes: {
    lifetimeLimit: number;
    used: number;
    remaining: number;
    canUse: boolean;
  };
  library: {
    hasDirectAccess: boolean;
  };
};
