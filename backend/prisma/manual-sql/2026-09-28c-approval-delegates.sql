-- §Att5/§PB7/§PB8 approval delegation. Additive: one new table.
--
-- Approval here is contextual first — a task's extra hours go to the project's
-- managers, a field visit to whoever runs the company. That works until a
-- decision has no natural context (a forgotten clock-out belongs to nobody's
-- project) and the answer becomes "the Super Admin", which is one person and a
-- bottleneck.
--
-- This table only ever ADDS approvers. The company owner can approve
-- regardless of what is in it, so no edit here can lock a workflow away from
-- the one person able to fix it.
--
-- `workflow` is a plain string rather than an enum so that adding a workflow is
-- a code change reviewed with the feature that needs it, not a migration on a
-- shared database.

BEGIN;

CREATE TABLE IF NOT EXISTS "ApprovalDelegate" (
  "id"          SERIAL PRIMARY KEY,
  "workflow"    TEXT NOT NULL,
  "employeeId"  INTEGER NOT NULL,
  "grantedById" INTEGER,
  "companyId"   INTEGER NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- No DB default, matching every other table here: Prisma's @updatedAt sets
  -- this from the client on every write, and a default would be drift.
  "updatedAt"   TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "ApprovalDelegate_companyId_workflow_employeeId_key"
  ON "ApprovalDelegate" ("companyId", "workflow", "employeeId");
CREATE INDEX IF NOT EXISTS "ApprovalDelegate_companyId_workflow_idx"
  ON "ApprovalDelegate" ("companyId", "workflow");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE constraint_name = 'ApprovalDelegate_companyId_fkey') THEN
    ALTER TABLE "ApprovalDelegate" ADD CONSTRAINT "ApprovalDelegate_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE constraint_name = 'ApprovalDelegate_employeeId_fkey') THEN
    ALTER TABLE "ApprovalDelegate" ADD CONSTRAINT "ApprovalDelegate_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE;
  END IF;
  -- SetNull, not Cascade: the delegation outlives whoever granted it, and
  -- losing that record must not silently revoke somebody's ability to approve.
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE constraint_name = 'ApprovalDelegate_grantedById_fkey') THEN
    ALTER TABLE "ApprovalDelegate" ADD CONSTRAINT "ApprovalDelegate_grantedById_fkey"
      FOREIGN KEY ("grantedById") REFERENCES "Employee"("id") ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;

-- Verify: the table exists and is empty on a fresh install.
SELECT count(*) AS approval_delegates FROM "ApprovalDelegate";
