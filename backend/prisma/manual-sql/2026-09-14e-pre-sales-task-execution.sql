-- Reshape pre-sales from an hours-allocation model to a task-execution model.
--
-- The tables shipped earlier today tracked capacity: allocated hours per
-- member, hours per request, hours per task. The feature actually wanted is
-- execution: an admin assigns people to a deal, the assigner raises tasks for
-- them, and each task walks NEW -> WORKING -> ON HOLD -> COMPLETED leaving an
-- audit trail.
--
-- All four tables were empty when this was written (verified: 0 rows in each),
-- so the hours columns are dropped rather than migrated. Re-runnable.

-- ── Assignment: who added them, and why ─────────────────────────────────────
ALTER TABLE "PreSalesTeamMember" ADD COLUMN IF NOT EXISTS "assignedById" INTEGER;
ALTER TABLE "PreSalesTeamMember" ADD COLUMN IF NOT EXISTS "remark" TEXT;
ALTER TABLE "PreSalesTeamMember" ADD COLUMN IF NOT EXISTS "removedAt" TIMESTAMP(3);
ALTER TABLE "PreSalesTeamMember" DROP COLUMN IF EXISTS "allocatedHours";

-- ── Request: employee + reason, no hours ────────────────────────────────────
ALTER TABLE "PreSalesRequest" DROP COLUMN IF EXISTS "hours";
ALTER TABLE "PreSalesRequest" DROP COLUMN IF EXISTS "isAdditional";
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'PreSalesRequest' AND column_name = 'remarks')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'PreSalesRequest' AND column_name = 'adminRemark') THEN
    ALTER TABLE "PreSalesRequest" RENAME COLUMN "remarks" TO "adminRemark";
  END IF;
END $$;

-- ── Task: scheduled work with a duration, not an hours budget ───────────────
ALTER TABLE "PreSalesTask" ADD COLUMN IF NOT EXISTS "taskType" TEXT;
ALTER TABLE "PreSalesTask" ADD COLUMN IF NOT EXISTS "scheduledAt" TIMESTAMP(3);
ALTER TABLE "PreSalesTask" ADD COLUMN IF NOT EXISTS "estimatedMinutes" INTEGER;
ALTER TABLE "PreSalesTask" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
ALTER TABLE "PreSalesTask" DROP COLUMN IF EXISTS "hours";
ALTER TABLE "PreSalesTask" DROP COLUMN IF EXISTS "dueDate";
-- The default moves from PENDING to NEW; no rows exist to rewrite.
ALTER TABLE "PreSalesTask" ALTER COLUMN "status" SET DEFAULT 'NEW';

-- ── Status history: appended, never overwritten ─────────────────────────────
CREATE TABLE IF NOT EXISTS "PreSalesTaskStatusHistory" (
  "id"             SERIAL PRIMARY KEY,
  "companyId"      INTEGER NOT NULL REFERENCES "Company"("id") ON DELETE CASCADE,
  "taskId"         INTEGER NOT NULL REFERENCES "PreSalesTask"("id") ON DELETE CASCADE,
  "previousStatus" TEXT,
  "newStatus"      TEXT NOT NULL,
  "remark"         TEXT,
  "changedById"    INTEGER NOT NULL REFERENCES "Employee"("id") ON DELETE CASCADE,
  "changedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "PreSalesTaskStatusHistory_taskId_changedAt_idx"
  ON "PreSalesTaskStatusHistory" ("taskId", "changedAt");

-- ── Attachments: the existing ImageKit upload, referenced ───────────────────
CREATE TABLE IF NOT EXISTS "PreSalesTaskAttachment" (
  "id"           SERIAL PRIMARY KEY,
  "companyId"    INTEGER NOT NULL REFERENCES "Company"("id") ON DELETE CASCADE,
  "taskId"       INTEGER NOT NULL REFERENCES "PreSalesTask"("id") ON DELETE CASCADE,
  "historyId"    INTEGER REFERENCES "PreSalesTaskStatusHistory"("id") ON DELETE SET NULL,
  "fileName"     TEXT NOT NULL,
  "fileUrl"      TEXT NOT NULL,
  "fileSize"     INTEGER,
  "uploadedById" INTEGER NOT NULL REFERENCES "Employee"("id") ON DELETE CASCADE,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "PreSalesTaskAttachment_taskId_idx" ON "PreSalesTaskAttachment" ("taskId");

-- A pre-sales employee's own lead list is keyed on this.
CREATE INDEX IF NOT EXISTS "PreSalesTeamMember_employeeId_status_idx"
  ON "PreSalesTeamMember" ("employeeId", "status");
CREATE INDEX IF NOT EXISTS "PreSalesTask_assignedToId_status_idx"
  ON "PreSalesTask" ("assignedToId", "status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PreSalesTeamMember_assignedById_fkey') THEN
    ALTER TABLE "PreSalesTeamMember"
      ADD CONSTRAINT "PreSalesTeamMember_assignedById_fkey"
      FOREIGN KEY ("assignedById") REFERENCES "Employee"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- verify
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'PreSalesTeamMember'
     AND column_name IN ('assignedById','remark','removedAt')) AS member_cols,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'PreSalesTask'
     AND column_name IN ('taskType','scheduledAt','estimatedMinutes','completedAt')) AS task_cols,
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'PreSalesTaskStatusHistory') AS history_table,
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'PreSalesTaskAttachment') AS attachment_table,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'PreSalesTask' AND column_name = 'hours') AS hours_gone;
