-- §Att9/§Att10: leave raised for somebody else, and leave removed.
--
-- Four nullable columns, additive, no backfill.
--
-- `raisedById` is null on every existing row and that is already correct: all
-- of them were applied by the employee themselves. It is set only when a Super
-- Admin, HR or a delegate raises leave on somebody's behalf. Without it, leave
-- entered for an employee looks identical to leave they asked for, which is
-- the first thing anyone queries when a deduction is disputed.
--
-- `deletedAt`/`deletedById` make deletion a soft delete. Every query filters
-- on deletedAt IS NULL, so a deleted request is gone as far as any user is
-- concerned, but the row survives. Leave history is the evidence behind
-- somebody's pay: a hard delete of a year-old approved leave is not something
-- the person it belonged to could ever reconstruct, and one mis-click should
-- not be able to do that.
--
-- Guarded so it is safe to re-run.

BEGIN;

ALTER TABLE "LeaveRequest"
  ADD COLUMN IF NOT EXISTS "raisedById"  INTEGER,
  ADD COLUMN IF NOT EXISTS "deletedAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletedById" INTEGER;

DO $$
BEGIN
  -- SetNull throughout: losing the user who raised or removed a request must
  -- not delete the leave record itself.
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE constraint_name = 'LeaveRequest_raisedById_fkey') THEN
    ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_raisedById_fkey"
      FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE constraint_name = 'LeaveRequest_deletedById_fkey') THEN
    ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_deletedById_fkey"
      FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- Every list reads the live rows; the deleted ones are the exception.
CREATE INDEX IF NOT EXISTS "LeaveRequest_deletedAt_idx"
  ON "LeaveRequest" ("deletedAt");

COMMIT;

-- Verify: all four should be present, and nothing deleted yet.
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'LeaveRequest'
   AND column_name IN ('raisedById','deletedAt','deletedById')
 ORDER BY 1;

SELECT count(*) AS deleted_so_far FROM "LeaveRequest" WHERE "deletedAt" IS NOT NULL;
