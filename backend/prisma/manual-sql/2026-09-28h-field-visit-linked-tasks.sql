-- Field visits: adopt a project task instead of retyping its name.
--
-- Until now a field visit's scope was free text. Approval fanned that text out
-- into a fresh Issue per person, so picking work that already existed on the
-- project board produced a second card with the same title — the board and the
-- trip then disagreed about what was supposed to happen, and the real task
-- never got the attention.
--
-- "FieldVisitRequestTask.issueId" is the link. A line carrying one is a task
-- the trip adopted: approval puts it in front of the people going and leaves
-- the card itself alone. A line without one behaves exactly as before.
--
-- "IssueMember.fieldVisitRequestId" marks the memberships the trip created, so
-- cancelling or amending it withdraws only what it added. Somebody already on a
-- task by hand is left on it.
--
-- Both columns are nullable and both are guarded, so this is safe to re-run.

ALTER TABLE "FieldVisitRequestTask"
  ADD COLUMN IF NOT EXISTS "issueId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FieldVisitRequestTask_issueId_fkey'
  ) THEN
    ALTER TABLE "FieldVisitRequestTask"
      ADD CONSTRAINT "FieldVisitRequestTask_issueId_fkey"
      FOREIGN KEY ("issueId") REFERENCES "Issue"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "FieldVisitRequestTask_issueId_idx"
  ON "FieldVisitRequestTask"("issueId");

ALTER TABLE "IssueMember"
  ADD COLUMN IF NOT EXISTS "fieldVisitRequestId" INTEGER;

-- Verify: both should return 1.
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'FieldVisitRequestTask' AND column_name = 'issueId')
    AS visit_task_issue_id_col,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'IssueMember' AND column_name = 'fieldVisitRequestId')
    AS issue_member_visit_col;
