// app/api/account/me/route.ts
import { prisma } from "@/lib/prisma";
import { jsonOk, jsonError } from "@/lib/api";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return jsonError("UNAUTHORIZED", 401, { message: "Bitte einloggen." });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      credits: true,
      isAdmin: true,
      stripeSubscriptionId: true,
      stripeCustomerId: true,
      createdAt: true,
    },
  });

  if (!user) {
    return jsonError("USER_NOT_FOUND", 404, { message: "User nicht gefunden." });
  }

  return jsonOk(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      credits: user.credits,
      isAdmin: user.isAdmin,
      hasSubscription: !!user.stripeSubscriptionId,
      stripeCustomerId: user.stripeCustomerId,
      createdAt: user.createdAt,
    },
    200
  );
}