-- F-003 Slice 1: Google Ad Manager Web Provider-Ready (Curated Library only).
--
-- Strictly additive migration. Adds exactly one new value to the existing
-- SponsoredUnlockProvider enum: GOOGLE_AD_MANAGER_WEB.
--
-- No table is created, altered or dropped. No column is added or removed.
-- No existing row is touched. SIMULATED_SOFTVIBE remains valid and is
-- unaffected.

ALTER TYPE "SponsoredUnlockProvider" ADD VALUE 'GOOGLE_AD_MANAGER_WEB';
