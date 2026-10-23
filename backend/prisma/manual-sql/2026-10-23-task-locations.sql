-- Location-wise task tracking (docs/location-task-tracking.md).
-- Additive and re-runnable: four new tables and two nullable columns. No
-- existing task, time log or attachment is changed.

CREATE TABLE IF NOT EXISTS "TaskLocation" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "level" TEXT NOT NULL DEFAULT 'STATE',
  "parentId" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "position" INTEGER NOT NULL DEFAULT 0,
  "companyId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskLocation_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "TaskLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "TaskLocation_companyId_isActive_idx" ON "TaskLocation" ("companyId", "isActive");
CREATE INDEX IF NOT EXISTS "TaskLocation_parentId_idx" ON "TaskLocation" ("parentId");

CREATE TABLE IF NOT EXISTS "IssueLocation" (
  "id" SERIAL PRIMARY KEY,
  "issueId" INTEGER NOT NULL,
  "locationId" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
  "startDate" TIMESTAMP(3),
  "dueDate" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "completedById" INTEGER,
  "remarks" TEXT,
  "blockedReason" TEXT,
  "overdueNotifiedAt" TIMESTAMP(3),
  "removedAt" TIMESTAMP(3),
  "removedById" INTEGER,
  "companyId" INTEGER NOT NULL,
  "createdById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IssueLocation_issueId_fkey"
    FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "IssueLocation_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "TaskLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "IssueLocation_issueId_locationId_key" ON "IssueLocation" ("issueId", "locationId");
CREATE INDEX IF NOT EXISTS "IssueLocation_companyId_status_idx" ON "IssueLocation" ("companyId", "status");
CREATE INDEX IF NOT EXISTS "IssueLocation_companyId_dueDate_idx" ON "IssueLocation" ("companyId", "dueDate");
CREATE INDEX IF NOT EXISTS "IssueLocation_locationId_idx" ON "IssueLocation" ("locationId");

CREATE TABLE IF NOT EXISTS "IssueLocationAssignee" (
  "issueLocationId" INTEGER NOT NULL,
  "employeeId" INTEGER NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IssueLocationAssignee_pkey" PRIMARY KEY ("issueLocationId", "employeeId"),
  CONSTRAINT "IssueLocationAssignee_issueLocationId_fkey"
    FOREIGN KEY ("issueLocationId") REFERENCES "IssueLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "IssueLocationAssignee_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "IssueLocationAssignee_employeeId_idx" ON "IssueLocationAssignee" ("employeeId");

CREATE TABLE IF NOT EXISTS "IssueLocationActivity" (
  "id" SERIAL PRIMARY KEY,
  "issueLocationId" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "field" TEXT,
  "oldValue" TEXT,
  "newValue" TEXT,
  "body" TEXT,
  "actorId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IssueLocationActivity_issueLocationId_fkey"
    FOREIGN KEY ("issueLocationId") REFERENCES "IssueLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "IssueLocationActivity_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "IssueLocationActivity_issueLocationId_createdAt_idx"
  ON "IssueLocationActivity" ("issueLocationId", "createdAt");

ALTER TABLE "IssueTimeLog" ADD COLUMN IF NOT EXISTS "issueLocationId" INTEGER;
DO $$ BEGIN
  ALTER TABLE "IssueTimeLog" ADD CONSTRAINT "IssueTimeLog_issueLocationId_fkey"
    FOREIGN KEY ("issueLocationId") REFERENCES "IssueLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "IssueTimeLog_issueLocationId_idx" ON "IssueTimeLog" ("issueLocationId");

ALTER TABLE "IssueAttachment" ADD COLUMN IF NOT EXISTS "issueLocationId" INTEGER;
DO $$ BEGIN
  ALTER TABLE "IssueAttachment" ADD CONSTRAINT "IssueAttachment_issueLocationId_fkey"
    FOREIGN KEY ("issueLocationId") REFERENCES "IssueLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "IssueAttachment_issueLocationId_idx" ON "IssueAttachment" ("issueLocationId");
