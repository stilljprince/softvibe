// app/billing/success/page.tsx
import BillingSuccessClient from "./ui";

type Props = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function mapPlanLabel(raw: string | undefined): string | null {
  if (!raw) return null;
  const plan = raw.toLowerCase();
  if (plan === "starter") return "Starter";
  if (plan === "pro") return "Pro";
  if (plan === "ultra") return "Ultra";
  return null;
}

export default async function BillingSuccessPage({ searchParams }: Props) {
  const sp = await searchParams;
  const planRaw = Array.isArray(sp.plan) ? sp.plan[0] : sp.plan;
  return <BillingSuccessClient planLabel={mapPlanLabel(planRaw)} />;
}
