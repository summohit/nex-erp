-- 2026-09-16: Timesheet submission and approval (§22)
--
-- Employee submits a day → PM or admin approves or rejects → approved time is
-- what project cost can be measured from (Rule 2).
--
-- ── Why a DAY and not a time log ─────────────────────────────────────────
-- A day is what a person submits and what a reviewer reads. Approving thirty
-- individual timer sessions is a review nobody actually performs, and it would
-- put an approval column on IssueTimeLog — a table written by the timer on
-- every start and stop.
--
-- ── Why absence means "not submitted", never "rejected" ──────────────────
-- Every hour logged before this table existed has no row in it. If no row read
-- as refused, project cost would drop to zero across the entire history the
-- moment this shipped. So cost keeps counting unapproved time, and rejection
-- is the only thing that excludes it. A company that wants stricter behaviour
-- turns on the setting below.
--
-- ── submittedHours ───────────────────────────────────────────────────────
-- The total as it stood when the day was submitted. Logs stay editable
-- afterwards, so storing this is what makes a later edit visible as a
-- discrepancy instead of silently changing what somebody already approved.
--
-- Re-runnable. Apply BEFORE `prisma generate`.

CREATE TABLE IF NOT EXISTS "TimesheetDay" (
  "id"              SERIAL PRIMARY KEY,
  "employeeId"      INTEGER NOT NULL REFERENCES "Employee"("id") ON DELETE CASCADE,
  "date"            DATE    NOT NULL,
  "status"          TEXT    NOT NULL DEFAULT 'SUBMITTED',
  "submittedHours"  DOUBLE PRECISION NOT NULL,
  "submittedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- SetNull: a reviewer leaving the company must not delete the approval.
  "reviewedById"    INTEGER REFERENCES "Employee"("id") ON DELETE SET NULL,
  "reviewedAt"      TIMESTAMP(3),
  "rejectionReason" TEXT,
  "companyId"       INTEGER NOT NULL REFERENCES "Company"("id") ON DELETE CASCADE,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One submission per person per day: re-submitting updates the row rather
-- than stacking a second opinion beside the first.
CREATE UNIQUE INDEX IF NOT EXISTS "TimesheetDay_employeeId_date_key"
  ON "TimesheetDay" ("employeeId", "date");

-- "What is waiting for me to review this week."
CREATE INDEX IF NOT EXISTS "TimesheetDay_companyId_status_date_idx"
  ON "TimesheetDay" ("companyId", "status", "date");

-- ── The company switch (Rule 2, "where applicable") ──────────────────────
-- Off by default. Turning it on means only APPROVED hours count toward
-- project cost; leaving it off keeps every logged hour counting, which is the
-- behaviour every existing project was costed under.
ALTER TABLE "SystemSetting"
  ADD COLUMN IF NOT EXISTS "timesheetApprovalRequired" BOOLEAN NOT NULL DEFAULT false;

-- Verify: table and switch present, nothing submitted yet on a first run.
SELECT
  to_regclass('"TimesheetDay"') IS NOT NULL                              AS timesheet_table,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'SystemSetting'
      AND column_name = 'timesheetApprovalRequired')                     AS approval_switch,
  (SELECT count(*) FROM "TimesheetDay")                                  AS submitted_days;
