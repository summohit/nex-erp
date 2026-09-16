-- 2026-09-16: Delivery module — the money model
--
-- Phase 1 shipped the budget field and a `budgetUsed` that was expenses
-- alone, with a comment admitting it. This is the rest: what the people on a
-- project cost, and the milestones that release money against it.
--
-- ── Employee.hourlyCostRate ──────────────────────────────────────────────
-- The one input the model was missing. Logged hours × this rate is project
-- employee cost (§23). Deliberately NOT derived from Payslip or
-- SalaryStructure: an internal charge-out rate is a commercial decision that
-- includes overhead and is revised on its own schedule, and reading it from
-- payroll would both leak salary into project screens and re-price history
-- every time somebody got a raise.
--
-- Null means "no rate set". Those hours cost nothing rather than guessing an
-- average — a project that silently reports itself cheaper than it is would
-- be worse than one that admits it cannot say.
--
-- ── Milestones ───────────────────────────────────────────────────────────
-- "ProjectMilestone" already existed, but as a child of ProjectAnalysisRun:
-- something the AI proposed while reading the uploaded documents, with no
-- money, no owner and no consequences, and several runs' worth per project.
-- That is not the milestone the contract is written against.
--
-- So the AI one is renamed to AnalysisMilestone and the name is given to the
-- real thing. The rename is safe: `tx.projectMilestone` appears in exactly
-- one place in the codebase (project-ai.service.ts) and nothing in the
-- frontend reads it. The relation field on ProjectAnalysisRun stays
-- `milestones`, so the analysis include is untouched.
--
-- Re-runnable. Apply alongside `prisma generate`.

-- ── 1. Internal cost rate ────────────────────────────────────────────────
ALTER TABLE "Employee"
  ADD COLUMN IF NOT EXISTS "hourlyCostRate" DOUBLE PRECISION;

-- ── 2. Rename the AI milestone out of the way ────────────────────────────
-- Guarded on both sides so a re-run, or an install that already has the new
-- table, is a no-op rather than an error.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_name = 'ProjectMilestone')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'ProjectMilestone' AND column_name = 'analysisId')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables
                      WHERE table_name = 'AnalysisMilestone')
  THEN
    ALTER TABLE "ProjectMilestone" RENAME TO "AnalysisMilestone";
  END IF;
END $$;

-- ── 3. The real milestone ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ProjectMilestone" (
  "id"          SERIAL PRIMARY KEY,
  "projectId"   INTEGER NOT NULL REFERENCES "Project"("id")  ON DELETE CASCADE,
  "name"        TEXT    NOT NULL,
  "description" TEXT,
  "startDate"   TIMESTAMP(3),
  "dueDate"     TIMESTAMP(3),
  "percentage"  DOUBLE PRECISION,
  "amount"      DOUBLE PRECISION,
  "status"      TEXT    NOT NULL DEFAULT 'PENDING',
  "completedAt" TIMESTAMP(3),
  -- SetNull, not Cascade: somebody leaving the company must not delete the
  -- milestone they happened to own.
  "ownerId"     INTEGER REFERENCES "Employee"("id") ON DELETE SET NULL,
  "position"    INTEGER NOT NULL DEFAULT 0,
  "companyId"   INTEGER NOT NULL REFERENCES "Company"("id") ON DELETE CASCADE,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ProjectMilestone_projectId_position_idx"
  ON "ProjectMilestone" ("projectId", "position");
CREATE INDEX IF NOT EXISTS "ProjectMilestone_companyId_status_idx"
  ON "ProjectMilestone" ("companyId", "status");

-- ── 4. Tasks deliver milestones (§15) ────────────────────────────────────
ALTER TABLE "Issue"
  ADD COLUMN IF NOT EXISTS "milestoneId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'Issue_milestoneId_fkey'
  ) THEN
    ALTER TABLE "Issue"
      ADD CONSTRAINT "Issue_milestoneId_fkey"
      FOREIGN KEY ("milestoneId") REFERENCES "ProjectMilestone"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Issue_milestoneId_idx" ON "Issue" ("milestoneId");

-- Verify.
--
-- The AI milestone count is raised as a notice rather than selected, because
-- on an install that never ran a project analysis "AnalysisMilestone" does not
-- exist and a static query naming it fails to parse — which would turn a
-- successful migration into an error at the last line.
DO $$
DECLARE kept BIGINT;
BEGIN
  IF to_regclass('"AnalysisMilestone"') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM "AnalysisMilestone"' INTO kept;
    RAISE NOTICE 'AnalysisMilestone rows carried over: %', kept;
  ELSE
    RAISE NOTICE 'No AnalysisMilestone table — this install has never run a project analysis.';
  END IF;
END $$;

SELECT
  to_regclass('"AnalysisMilestone"') IS NOT NULL                        AS analysis_milestone_table,
  to_regclass('"ProjectMilestone"')  IS NOT NULL                        AS project_milestone_table,
  (SELECT count(*) FROM "ProjectMilestone")                             AS real_milestones,
  (SELECT count(*) FROM "Employee")                                     AS employees,
  (SELECT count(*) FROM "Employee" WHERE "hourlyCostRate" IS NOT NULL)  AS employees_with_a_rate,
  (SELECT count(*) FROM "Issue" WHERE "milestoneId" IS NOT NULL)        AS tasks_on_a_milestone;
