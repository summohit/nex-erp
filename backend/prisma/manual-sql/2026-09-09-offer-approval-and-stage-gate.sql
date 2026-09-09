-- 2026-09-09: Job offer rules — profile budget, stage gating, approval reason
--
-- 1. JobApplication.profileBudget — the budget approved for this candidate.
--    Falls back to Job.maxSalary when NULL, so existing rows keep behaving the
--    way they did before this column existed.
-- 2. JobApplication.completedStages — every pipeline stage the candidate has
--    been moved through. Backs the rule that APPLIED, PHONE_SCREENING and
--    INTERVIEW must all be visited before OFFERED, and OFFERED before HIRED.
-- 3. approvalReason / approvalBudget / approvalRequestedAt / approvalDecidedAt /
--    approvalDecidedById — the above-budget approval request and its outcome.
--
-- Applied on top of the Prisma schema; runs against the same database Prisma
-- manages, so the ALTER TABLE below is additive and safe to re-run.

ALTER TABLE "JobApplication"
  ADD COLUMN IF NOT EXISTS "profileBudget" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "completedStages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "approvalReason" TEXT,
  ADD COLUMN IF NOT EXISTS "approvalBudget" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "approvalRequestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvalDecidedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvalDecidedById" INTEGER;

-- Backfill: candidates that already reached a stage were, by definition, moved
-- through every mandatory stage before it. Without this, every in-flight
-- candidate would be blocked from HIRED by a gate that did not exist when they
-- were offered. Legacy status vocabulary is normalised on the way in.
UPDATE "JobApplication"
SET "completedStages" = CASE "status"
  WHEN 'NEW'          THEN ARRAY['APPLIED']
  WHEN 'APPLIED'      THEN ARRAY['APPLIED']
  WHEN 'REVIEWING'    THEN ARRAY['APPLIED','PHONE_SCREENING']
  WHEN 'SHORTLISTED'  THEN ARRAY['APPLIED','PHONE_SCREENING']
  WHEN 'PHONE_SCREENING' THEN ARRAY['APPLIED','PHONE_SCREENING']
  WHEN 'INTERVIEWING' THEN ARRAY['APPLIED','PHONE_SCREENING','INTERVIEW']
  WHEN 'INTERVIEW'    THEN ARRAY['APPLIED','PHONE_SCREENING','INTERVIEW']
  WHEN 'NEGOTIATION'  THEN ARRAY['APPLIED','PHONE_SCREENING','INTERVIEW','NEGOTIATION']
  WHEN 'OFFERED'      THEN ARRAY['APPLIED','PHONE_SCREENING','INTERVIEW','OFFERED']
  WHEN 'HIRED'        THEN ARRAY['APPLIED','PHONE_SCREENING','INTERVIEW','OFFERED','HIRED']
  WHEN 'ONBOARDED'    THEN ARRAY['APPLIED','PHONE_SCREENING','INTERVIEW','OFFERED','HIRED','ONBOARDED']
  -- ON_HOLD / REJECTED say nothing about how far the candidate got, so credit
  -- only the stage every application starts from.
  ELSE ARRAY['APPLIED']
END
WHERE "completedStages" = ARRAY[]::TEXT[];
