-- 2026-09-17: Project budget and hours increase requests (§25).
--
-- A PM asks for more hours, more money, or both, with a reason and supporting
-- document. An administrator approves, and the PROJECT ITSELF changes — that
-- last part is what makes this a request rather than a note.
--
-- ── Why before/after and not just the delta ──────────────────────────────
-- §25 asks for request history, and a history of "+500 hrs" answers nothing
-- six months later. What a reader needs is "2,000 → 2,500", and that cannot be
-- reconstructed afterwards: the project's estimate moves for other reasons
-- too, and a second approved request would make the arithmetic ambiguous. So
-- the figures on both sides are recorded at the moment of approval.
--
-- They are captured at APPROVAL, not at request: a request may sit for a week
-- while the project changes underneath it, and what matters is what the
-- administrator actually changed.
--
-- ── These rows are financial ─────────────────────────────────────────────
-- A budget request contains the budget. Rule 1 of the Delivery module says a
-- normal employee never sees what a project costs, so reading these follows
-- exactly the same test as reading the project's own money fields — see
-- project-visibility.ts. The table carries no special marking for that; the
-- service refuses.
--
-- Re-runnable. Apply BEFORE `prisma generate`.

CREATE TABLE IF NOT EXISTS "ProjectBudgetRequest" (
  "id"              SERIAL PRIMARY KEY,
  "projectId"       INTEGER NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
  "companyId"       INTEGER NOT NULL REFERENCES "Company"("id") ON DELETE CASCADE,

  -- SetNull: a manager leaving must not delete the record of what they asked
  -- for and what was granted.
  "requestedById"   INTEGER REFERENCES "Employee"("id") ON DELETE SET NULL,

  -- At least one of these is required; the service refuses a request for
  -- nothing. Null means "not asked for", which is not the same as zero.
  "additionalHours"  DOUBLE PRECISION,
  "additionalBudget" DOUBLE PRECISION,

  -- Required. A request with no reason is one nobody can rule on.
  "reason"          TEXT NOT NULL,
  "attachmentUrl"   TEXT,
  "attachmentName"  TEXT,

  -- PENDING, APPROVED, REJECTED, CANCELLED.
  "status"          TEXT NOT NULL DEFAULT 'PENDING',
  "reviewedById"    INTEGER REFERENCES "Employee"("id") ON DELETE SET NULL,
  "reviewedAt"      TIMESTAMP(3),
  "rejectionReason" TEXT,

  -- What the project held on either side of this decision. Written only on
  -- approval; null on a pending, rejected or cancelled row, because nothing
  -- moved.
  "hoursBefore"     DOUBLE PRECISION,
  "hoursAfter"      DOUBLE PRECISION,
  "budgetBefore"    DOUBLE PRECISION,
  "budgetAfter"     DOUBLE PRECISION,

  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- "What is waiting for me to approve."
CREATE INDEX IF NOT EXISTS "ProjectBudgetRequest_companyId_status_idx"
  ON "ProjectBudgetRequest" ("companyId", "status");

-- The project's own history, newest first.
CREATE INDEX IF NOT EXISTS "ProjectBudgetRequest_projectId_createdAt_idx"
  ON "ProjectBudgetRequest" ("projectId", "createdAt");

SELECT to_regclass('"ProjectBudgetRequest"') IS NOT NULL AS table_present,
       (SELECT count(*) FROM "ProjectBudgetRequest")     AS requests;
