-- 2026-09-09b: Hold the candidate in place while an above-budget offer is
-- pending approval.
--
-- Previously an above-budget offer was forced into OFFERED and left there with
-- a PENDING_APPROVAL flag, which told the board the candidate had been offered
-- when nobody had approved the money yet. The candidate now stays in whatever
-- stage they are already in, and approvalRequestedStage records where the
-- recruiter was trying to send them, so approving the request completes the
-- move that was asked for.
--
-- Additive and safe to re-run.

ALTER TABLE "JobApplication"
  ADD COLUMN IF NOT EXISTS "approvalRequestedStage" TEXT;

-- Anything already sitting in OFFERED on a pending request was put there by the
-- old behaviour; record OFFERED as the stage it was heading for so approving it
-- now behaves the same way it used to.
UPDATE "JobApplication"
SET "approvalRequestedStage" = 'OFFERED'
WHERE "approvalStatus" = 'PENDING_APPROVAL'
  AND "approvalRequestedStage" IS NULL;
