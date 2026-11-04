-- The manager's probation review for the current period (cleared on extension).
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "probationReview" JSONB;
