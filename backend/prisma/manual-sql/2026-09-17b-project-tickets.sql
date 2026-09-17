-- 2026-09-17: Project tickets (§29, §30).
--
-- A ticket here is a PROPOSED TASK. A project manager raises one — usually a
-- new requirement from the client — naming who would do it, how urgent it is,
-- when it should run and how long it should take. An administrator approves,
-- and only then does it become a real task.
--
-- ── Why not the existing Ticket table ────────────────────────────────────
-- That one is the company helpdesk: a required departmentId for routing, a
-- platform of WEB/MOBILE/BOTH, an attendanceDate for HR, and twelve live rows
-- that are all BUG/FEATURE_REQUEST/IMPROVEMENT/QUESTION. None of that applies
-- to a client requirement on a delivery project, and the lifecycle is
-- different: this one ends by turning into something else. Sharing the table
-- would mean making departmentId optional — weakening the routing rule for the
-- people actually using it — and filtering every helpdesk list forever.
--
-- ── The approval is the point ────────────────────────────────────────────
-- A PM can already create tasks directly. A ticket exists for work that needs
-- somebody else's yes first: scope that grows a project. So the interesting
-- states are before conversion, and `convertedIssueId` is what keeps the
-- ticket's history attached to the task it became (§30).
--
-- Re-runnable. Apply BEFORE `prisma generate`.

CREATE TABLE IF NOT EXISTS "ProjectTicket" (
  "id"              SERIAL PRIMARY KEY,
  "ticketNumber"    TEXT    NOT NULL,
  "title"           TEXT    NOT NULL,
  "description"     TEXT,

  "projectId"       INTEGER NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
  "companyId"       INTEGER NOT NULL REFERENCES "Company"("id") ON DELETE CASCADE,

  -- The PM who raised it. SetNull: a manager leaving must not delete the
  -- requirement they recorded.
  "raisedById"      INTEGER REFERENCES "Employee"("id") ON DELETE SET NULL,
  -- Who would do the work. A proposal, not an assignment — the task carries
  -- the real one once it exists.
  "proposedAssigneeId" INTEGER REFERENCES "Employee"("id") ON DELETE SET NULL,

  "priority"        TEXT    NOT NULL DEFAULT 'MEDIUM',
  "startDate"       TIMESTAMP(3),
  "dueDate"         TIMESTAMP(3),
  -- §30's estimate step. Carried onto the task so §8 can compare it with what
  -- the work actually took.
  "estimatedHours"  DOUBLE PRECISION,

  -- REQUESTED, APPROVED, REJECTED, CONVERTED, COMPLETED, CANCELLED.
  "status"          TEXT    NOT NULL DEFAULT 'REQUESTED',
  "reviewedById"    INTEGER REFERENCES "Employee"("id") ON DELETE SET NULL,
  "reviewedAt"      TIMESTAMP(3),
  -- Required on REJECTED, as everywhere else a decision goes against someone.
  "rejectionReason" TEXT,

  -- The task this became. The link is what stops a ticket and its task
  -- drifting into two accounts of the same work.
  "convertedIssueId" INTEGER UNIQUE REFERENCES "Issue"("id") ON DELETE SET NULL,
  "convertedAt"     TIMESTAMP(3),

  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Ticket numbers are unique per company, not globally: two companies both
-- starting at 1 is correct, and a shared sequence would leak how much work
-- other tenants are doing.
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectTicket_companyId_ticketNumber_key"
  ON "ProjectTicket" ("companyId", "ticketNumber");

-- "What is waiting for me to approve", the administrator's whole view of this.
CREATE INDEX IF NOT EXISTS "ProjectTicket_companyId_status_idx"
  ON "ProjectTicket" ("companyId", "status");

CREATE INDEX IF NOT EXISTS "ProjectTicket_projectId_idx"
  ON "ProjectTicket" ("projectId");

-- Verify.
SELECT to_regclass('"ProjectTicket"') IS NOT NULL AS table_present,
       (SELECT count(*) FROM "ProjectTicket")     AS tickets;
