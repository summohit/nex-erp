-- §PB8 + scope requests: two-step approval, and the Fix request.
--
-- Two parts, both additive:
--   1. Issue gains an approval state and the two signatures.
--   2. ProjectScopeRequest (+ attachments) is new.
--
-- An earlier draft of this file also added "technicalApprovedById" and
-- "technicalApprovedAt" to ProjectBudgetRequest. That was wrong: the technical
-- architect's step belongs to task creation and nowhere else, because a budget
-- increase asks whether the company will spend more, which is not a technical
-- question. The columns are gone from here. A database that ran the earlier
-- draft still has them; they are nullable, nothing reads or writes them, and
-- dropping columns from a live table is a worse trade than leaving two unused
-- ones behind.
--
-- No backfill anywhere, and that is the important bit. Issue.approvalState is
-- NULL on every existing task and NULL means "settled, act on it freely" —
-- backfilling those to APPROVED would be harmless but dishonest (nobody
-- approved them), and backfilling to PENDING would freeze every board in the
-- company. Budget requests keep their existing status values untouched, so
-- anything counting APPROVED budget carries on working.
--
-- Guarded so it is safe to re-run.

BEGIN;

-- 1. Task approval -----------------------------------------------------------
ALTER TABLE "Issue"
  ADD COLUMN IF NOT EXISTS "approvalState"           TEXT,
  ADD COLUMN IF NOT EXISTS "approvalRequestedById"   INTEGER,
  ADD COLUMN IF NOT EXISTS "technicalApprovedById"   INTEGER,
  ADD COLUMN IF NOT EXISTS "technicalApprovedAt"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "adminApprovedById"       INTEGER,
  ADD COLUMN IF NOT EXISTS "adminApprovedAt"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvalRejectionReason" TEXT;

DO $$
BEGIN
  -- SetNull throughout: losing an approver's employee record must not delete
  -- the task or the request they signed off.
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE constraint_name = 'Issue_approvalRequestedById_fkey') THEN
    ALTER TABLE "Issue" ADD CONSTRAINT "Issue_approvalRequestedById_fkey"
      FOREIGN KEY ("approvalRequestedById") REFERENCES "Employee"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE constraint_name = 'Issue_technicalApprovedById_fkey') THEN
    ALTER TABLE "Issue" ADD CONSTRAINT "Issue_technicalApprovedById_fkey"
      FOREIGN KEY ("technicalApprovedById") REFERENCES "Employee"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE constraint_name = 'Issue_adminApprovedById_fkey') THEN
    ALTER TABLE "Issue" ADD CONSTRAINT "Issue_adminApprovedById_fkey"
      FOREIGN KEY ("adminApprovedById") REFERENCES "Employee"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- The approval queue reads exactly this: what is still in flight.
CREATE INDEX IF NOT EXISTS "Issue_approvalState_idx" ON "Issue" ("approvalState");

-- 2. Scope ("Fix") requests ---------------------------------------------------
CREATE TABLE IF NOT EXISTS "ProjectScopeRequest" (
  "id"           SERIAL PRIMARY KEY,
  "projectId"    INTEGER NOT NULL,
  "companyId"    INTEGER NOT NULL,
  "raisedById"   INTEGER NOT NULL,
  "title"        TEXT    NOT NULL,
  -- IN_SCOPE or OUT_OF_SCOPE. Required, because that single answer is what
  -- turns an argument about who pays into a decision somebody can make.
  "scope"        TEXT    NOT NULL,
  "body"         TEXT    NOT NULL,
  "status"       TEXT    NOT NULL DEFAULT 'PENDING',
  "reviewedById" INTEGER,
  "reviewedAt"   TIMESTAMP(3),
  "decisionNote" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- No DB default, matching every other table here: Prisma's @updatedAt sets
  -- this from the client on every write, and a default would be drift.
  "updatedAt"    TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "ProjectScopeRequestAttachment" (
  "id"        SERIAL PRIMARY KEY,
  "requestId" INTEGER NOT NULL,
  "url"       TEXT    NOT NULL,
  "name"      TEXT    NOT NULL,
  "sizeBytes" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ProjectScopeRequest_companyId_status_idx"
  ON "ProjectScopeRequest" ("companyId", "status");
CREATE INDEX IF NOT EXISTS "ProjectScopeRequest_projectId_idx"
  ON "ProjectScopeRequest" ("projectId");
CREATE INDEX IF NOT EXISTS "ProjectScopeRequestAttachment_requestId_idx"
  ON "ProjectScopeRequestAttachment" ("requestId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE constraint_name = 'ProjectScopeRequest_projectId_fkey') THEN
    ALTER TABLE "ProjectScopeRequest" ADD CONSTRAINT "ProjectScopeRequest_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE constraint_name = 'ProjectScopeRequest_companyId_fkey') THEN
    ALTER TABLE "ProjectScopeRequest" ADD CONSTRAINT "ProjectScopeRequest_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE constraint_name = 'ProjectScopeRequest_raisedById_fkey') THEN
    ALTER TABLE "ProjectScopeRequest" ADD CONSTRAINT "ProjectScopeRequest_raisedById_fkey"
      FOREIGN KEY ("raisedById") REFERENCES "Employee"("id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE constraint_name = 'ProjectScopeRequest_reviewedById_fkey') THEN
    ALTER TABLE "ProjectScopeRequest" ADD CONSTRAINT "ProjectScopeRequest_reviewedById_fkey"
      FOREIGN KEY ("reviewedById") REFERENCES "Employee"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE constraint_name = 'ProjectScopeRequestAttachment_requestId_fkey') THEN
    ALTER TABLE "ProjectScopeRequestAttachment" ADD CONSTRAINT "ProjectScopeRequestAttachment_requestId_fkey"
      FOREIGN KEY ("requestId") REFERENCES "ProjectScopeRequest"("id") ON DELETE CASCADE;
  END IF;
END $$;

COMMIT;

-- Verify: no task should have picked up an approval state, and the new tables
-- exist and are empty.
SELECT "approvalState", count(*) AS tasks FROM "Issue" GROUP BY 1 ORDER BY 1 NULLS FIRST;
SELECT count(*) AS scope_requests FROM "ProjectScopeRequest";
