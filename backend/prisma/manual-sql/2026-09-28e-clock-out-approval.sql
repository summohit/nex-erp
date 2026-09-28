-- §Att4/§Att5: evidence and approval for a late clock-out.
--
-- `clockOutReason` already existed: it is collected when somebody closes a
-- PREVIOUS day's session, because at that point the clock-out stamp is their
-- account of a day that has already ended rather than an observation. These
-- columns finish that thought — the proof that backs the claim, and the ruling
-- on it.
--
-- `clockOutApproval` is NULL for ordinary days and must stay that way. A
-- session closed on the day it opened needs nobody's permission, and
-- backfilling those rows to APPROVED would invent thousands of approvals that
-- never happened. Only rows carrying a reason are given a state, and they are
-- given APPROVED rather than PENDING: those days predate the rule, and
-- dropping a year of historical attendance into a queue for review would make
-- the feature's first act a pile of work nobody asked for.
--
-- Additive and guarded, so it is safe to re-run.

BEGIN;

ALTER TABLE "Attendance"
  ADD COLUMN IF NOT EXISTS "clockOutProofUrl"     TEXT,
  ADD COLUMN IF NOT EXISTS "clockOutApproval"     TEXT,
  ADD COLUMN IF NOT EXISTS "clockOutApprovedById" INTEGER,
  ADD COLUMN IF NOT EXISTS "clockOutApprovedAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "clockOutReviewNote"   TEXT;

DO $$
BEGIN
  -- SetNull, not Cascade: deleting an employee record must not delete the
  -- attendance days they approved for other people.
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE constraint_name = 'Attendance_clockOutApprovedById_fkey') THEN
    ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_clockOutApprovedById_fkey"
      FOREIGN KEY ("clockOutApprovedById") REFERENCES "Employee"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- The queue reads exactly this: the PENDING rows.
CREATE INDEX IF NOT EXISTS "Attendance_clockOutApproval_idx"
  ON "Attendance" ("clockOutApproval");

-- Days closed late before this rule existed are settled, not pending.
UPDATE "Attendance"
   SET "clockOutApproval" = 'APPROVED'
 WHERE "clockOutReason" IS NOT NULL
   AND "clockOutApproval" IS NULL;

COMMIT;

-- Verify: no row should be PENDING immediately after the migration, and no
-- ordinary day should have picked up a state.
SELECT "clockOutApproval", count(*) AS rows
  FROM "Attendance"
 GROUP BY "clockOutApproval"
 ORDER BY 1 NULLS FIRST;
