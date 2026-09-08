-- 2026-09-08: On-site roster support
--
-- 1. Project.address — where work happens for a project, set at creation and
--    auto-filled into the roster's on-site details when a project is picked.
-- 2. ShiftRosterEntry gains projectId / address / onsiteApprovalStatus so an
--    on-site shift assignment records its location and, for "No Project"
--    requests, its approval state (PENDING → awaiting Administrator + HR,
--    then APPROVED / REJECTED by one of them).
--
-- Applied on top of the Prisma schema; runs against the same database Prisma
-- manages, so ALTER TABLE below is additive and safe to re-run.

ALTER TABLE "Project"
  ADD COLUMN IF NOT EXISTS "address" TEXT;

ALTER TABLE "ShiftRosterEntry"
  ADD COLUMN IF NOT EXISTS "projectId" INTEGER,
  ADD COLUMN IF NOT EXISTS "address" TEXT,
  ADD COLUMN IF NOT EXISTS "onsiteApprovalStatus" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "approvedByUserId" INTEGER;

-- Keep the FK optional and set-null so deleting a project never strands a
-- roster row.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ShiftRosterEntry_projectId_fkey'
  ) THEN
    ALTER TABLE "ShiftRosterEntry"
      ADD CONSTRAINT "ShiftRosterEntry_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ShiftRosterEntry_companyId_onsiteApprovalStatus_idx"
  ON "ShiftRosterEntry"("companyId", "onsiteApprovalStatus");