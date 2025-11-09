// scripts/seed-test-user.ts
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";

async function main() {
  const email = "demo@softvibe.app";
  const password = "demo1234";
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash }, // aktualisiert Hash, falls es den User schon gibt
    create: { email, name: "Demo User", passwordHash },
    select: { id: true, email: true },
  });

  console.log("Seeded user:", user, "password:", password);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());