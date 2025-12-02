// app/pricing/page.tsx
import { redirect } from "next/navigation";

export default function PricingPage() {
  // Alle Pricing-Aufrufe landen jetzt auf /billing
  redirect("/billing");
}