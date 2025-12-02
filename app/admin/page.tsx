// app/admin/page.tsx
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next"; // 🔹 wichtig: /next
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import AdminClient from "./AdminClient";

export default async function AdminPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/login");
  }

  // 🔹 Safety: wenn User in DB nicht gefunden wird → zurück zur Startseite
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isAdmin: true },
  });

  if (!me?.isAdmin) {
    redirect("/");
  }

  try {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [users, totalJobs, jobsLast24h, jobsLast7d] = await Promise.all([
      prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          name: true,
          credits: true,
          isAdmin: true,
          stripeSubscriptionId: true,
          createdAt: true,
        },
      }),
      prisma.job.count(),
      prisma.job.count({
        where: { createdAt: { gte: last24h } },
      }),
      prisma.job.count({
        where: { createdAt: { gte: last7d } },
      }),
    ]);

    const withSubscription = users.filter((u) => u.stripeSubscriptionId !== null).length;
    const admins = users.filter((u) => u.isAdmin).length;

    const usersForClient = users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name ?? null,
      credits: u.credits,
      isAdmin: u.isAdmin,
      hasSubscription: u.stripeSubscriptionId !== null,
      createdAt: u.createdAt.toISOString(),
    }));

    const statsForClient = {
      totalJobs,
      jobsLast24h,
      jobsLast7d,
      totalUsers: users.length,
      withSubscription,
      admins,
    };

    return <AdminClient users={usersForClient} stats={statsForClient} />;
  } catch (err) {
    console.error("AdminPage error:", err);

    // Fallback: zeigt ein leeres Dashboard statt komplett zu crashen
    const emptyStats = {
      totalJobs: 0,
      jobsLast24h: 0,
      jobsLast7d: 0,
      totalUsers: 0,
      withSubscription: 0,
      admins: 0,
    };

    return (
      <AdminClient
        users={[]}
        stats={emptyStats}
      />
    );
  }
}