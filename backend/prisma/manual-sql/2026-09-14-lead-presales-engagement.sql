-- Pre-sales engagement: team members, requests, tasks, and minutes-of-meeting.
-- Run this in the production database before deploying the matching backend.
-- It is additive / idempotent — safe to re-run.

-- 1. PreSalesTeamMember — an approved pre-sales person on a deal with hours.
CREATE TABLE IF NOT EXISTS "PreSalesTeamMember" (
  "id"             SERIAL PRIMARY KEY,
  "companyId"      INTEGER NOT NULL,
  "leadId"         INTEGER NOT NULL,
  "employeeId"     INTEGER NOT NULL,
  "allocatedHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status"         TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PreSalesTeamMember_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PreSalesTeamMember_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PreSalesTeamMember_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 2. PreSalesRequest — sales person → admin approval/rejection with remarks.
CREATE TABLE IF NOT EXISTS "PreSalesRequest" (
  "id"            SERIAL PRIMARY KEY,
  "companyId"     INTEGER NOT NULL,
  "leadId"        INTEGER NOT NULL,
  "requestedById" INTEGER NOT NULL,
  "employeeId"    INTEGER NOT NULL,
  "hours"         DOUBLE PRECISION NOT NULL,
  "reason"        TEXT,
  "remarks"       TEXT,
  "isAdditional"  BOOLEAN NOT NULL DEFAULT false,
  "status"        TEXT NOT NULL DEFAULT 'PENDING',
  "approvedById"  INTEGER,
  "approvedAt"    TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PreSalesRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PreSalesRequest_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PreSalesRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PreSalesRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PreSalesRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- 3. PreSalesTask — hourly task assigned by sales person to pre-sales person.
CREATE TABLE IF NOT EXISTS "PreSalesTask" (
  "id"           SERIAL PRIMARY KEY,
  "companyId"    INTEGER NOT NULL,
  "leadId"       INTEGER NOT NULL,
  "assignedById" INTEGER NOT NULL,
  "assignedToId" INTEGER NOT NULL,
  "title"        TEXT NOT NULL,
  "description"  TEXT,
  "hours"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status"       TEXT NOT NULL DEFAULT 'PENDING',
  "dueDate"      TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PreSalesTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PreSalesTask_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PreSalesTask_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PreSalesTask_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 4. PreSalesMoM — minutes of meeting uploaded by pre-sales person into a task.
CREATE TABLE IF NOT EXISTS "PreSalesMoM" (
  "id"           SERIAL PRIMARY KEY,
  "companyId"    INTEGER NOT NULL,
  "leadId"       INTEGER NOT NULL,
  "taskId"       INTEGER,
  "uploadedById" INTEGER NOT NULL,
  "title"        TEXT NOT NULL,
  "meetingDate"  TIMESTAMP(3),
  "summary"      TEXT,
  "fileUrl"      TEXT,
  "fileName"     TEXT,
  "fileType"     TEXT,
  "fileSize"     INTEGER,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PreSalesMoM_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PreSalesMoM_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PreSalesMoM_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "PreSalesTask"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "PreSalesMoM_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Uniqueness: one active engagement per person per deal.
CREATE UNIQUE INDEX IF NOT EXISTS "PreSalesTeamMember_leadId_employeeId_key" ON "PreSalesTeamMember"("leadId", "employeeId");
CREATE INDEX IF NOT EXISTS "PreSalesTeamMember_companyId_leadId_idx" ON "PreSalesTeamMember"("companyId", "leadId");
CREATE INDEX IF NOT EXISTS "PreSalesRequest_companyId_status_idx" ON "PreSalesRequest"("companyId", "status");
CREATE INDEX IF NOT EXISTS "PreSalesRequest_companyId_leadId_idx" ON "PreSalesRequest"("companyId", "leadId");
CREATE INDEX IF NOT EXISTS "PreSalesTask_companyId_leadId_idx" ON "PreSalesTask"("companyId", "leadId");
CREATE INDEX IF NOT EXISTS "PreSalesMoM_companyId_leadId_idx" ON "PreSalesMoM"("companyId", "leadId");