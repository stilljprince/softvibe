-- RP-010 Phase 1: Core Entitlement Schema Foundation
--
-- Strictly additive migration. Adds:
--   * Plan enum (FREE, STARTER, PREMIUM)
--   * EntitlementKind enum (PLAN_MINUTES, PROBE)
--   * User: plan, planPeriodStart, planPeriodEnd, probeGenerationsUsed
--   * Job: entitlementKind, reservedMinutes, usageFinalizedAt, usageReleasedAt
--   * PeriodUsage table (per-billing-period usage accumulator)
--
-- No existing columns are dropped, renamed, or updated. No data is
-- rewritten. Existing Users default to FREE / 0 probe generations;
-- existing Jobs remain valid because all new Job columns are nullable.

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'STARTER', 'PREMIUM');

-- CreateEnum
CREATE TYPE "EntitlementKind" AS ENUM ('PLAN_MINUTES', 'PROBE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "plan" "Plan" NOT NULL DEFAULT 'FREE',
ADD COLUMN     "planPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "planPeriodStart" TIMESTAMP(3),
ADD COLUMN     "probeGenerationsUsed" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "entitlementKind" "EntitlementKind",
ADD COLUMN     "reservedMinutes" INTEGER,
ADD COLUMN     "usageFinalizedAt" TIMESTAMP(3),
ADD COLUMN     "usageReleasedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PeriodUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "minutesUsed" INTEGER NOT NULL DEFAULT 0,
    "minutesReserved" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PeriodUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PeriodUsage_userId_periodEnd_idx" ON "PeriodUsage"("userId", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "PeriodUsage_userId_periodStart_key" ON "PeriodUsage"("userId", "periodStart");

-- AddForeignKey
ALTER TABLE "PeriodUsage" ADD CONSTRAINT "PeriodUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
