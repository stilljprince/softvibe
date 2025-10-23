import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() { /* z.B. Test-User anlegen */ }
main().finally(()=>prisma.$disconnect());
