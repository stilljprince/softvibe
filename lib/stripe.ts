// lib/stripe.ts
import Stripe from "stripe";

const secretKey = process.env.STRIPE_SECRET_KEY;

if (!secretKey) {
  // In Dev knallt das sofort beim Start, statt später mit "stripe undefined"
  throw new Error("STRIPE_SECRET_KEY is not set in the environment");
}

export const stripe = new Stripe(secretKey, {
  apiVersion: "2025-10-29.clover",
});

// optional, falls du irgendwo den Typ brauchst
export type StripeClient = Stripe;

