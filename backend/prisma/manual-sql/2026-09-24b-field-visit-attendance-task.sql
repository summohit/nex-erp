-- 2026-09-24b: which task a field-visit day was clocked against
--
-- §5 has the employee pick one of their assigned tasks before clocking in, and
-- §11 shows it back to Delivery alongside the times and the distances. The day
-- row had nowhere to put it.
--
-- SetNull, not Cascade: deleting a task must not delete the attendance for the
-- day somebody worked on it.
--
-- Apply with the DIRECT connection (port 5432); the pooler on 6543 cannot run
-- DDL. Idempotent — safe to re-run.

ALTER TABLE "FieldVisitAttendance" ADD COLUMN IF NOT EXISTS "issueId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FieldVisitAttendance_issueId_fkey'
  ) THEN
    ALTER TABLE "FieldVisitAttendance"
      ADD CONSTRAINT "FieldVisitAttendance_issueId_fkey"
      FOREIGN KEY ("issueId") REFERENCES "Issue"(id)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "FieldVisitAttendance_issueId_idx"
  ON "FieldVisitAttendance" ("issueId");
