-- §3/§4 task hours. Purely additive: one new column and two new tables.
-- Nothing is dropped, altered or backfilled, so this is safe to run on a live
-- database and safe to run twice.

BEGIN;

-- The approved-extra ceiling. Defaults to 0, so every existing task keeps
-- exactly the hours it already had.
ALTER TABLE "Issue"
  ADD COLUMN IF NOT EXISTS "additionalHours" DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "TaskHoursRequest" (
  "id"              SERIAL PRIMARY KEY,
  "issueId"         INTEGER NOT NULL,
  "companyId"       INTEGER NOT NULL,
  "requestedById"   INTEGER NOT NULL,
  "requestedHours"  DOUBLE PRECISION NOT NULL,
  "approvedHours"   DOUBLE PRECISION,
  "reason"          TEXT NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'REQUESTED',
  "reviewedById"    INTEGER,
  "reviewedAt"      TIMESTAMP(3),
  "rejectionReason" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- No DB default, matching every other table here: Prisma's @updatedAt sets
  -- this from the client on every write, and a default would be drift.
  "updatedAt"       TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "TaskHoursRequestActivity" (
  "id"        SERIAL PRIMARY KEY,
  "requestId" INTEGER NOT NULL,
  "action"    TEXT NOT NULL,
  "detail"    TEXT,
  "oldValue"  TEXT,
  "newValue"  TEXT,
  "actorId"   INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "TaskHoursRequest_companyId_status_idx"
  ON "TaskHoursRequest" ("companyId", "status");
CREATE INDEX IF NOT EXISTS "TaskHoursRequest_issueId_idx"
  ON "TaskHoursRequest" ("issueId");
CREATE INDEX IF NOT EXISTS "TaskHoursRequest_requestedById_idx"
  ON "TaskHoursRequest" ("requestedById");
CREATE INDEX IF NOT EXISTS "TaskHoursRequestActivity_requestId_createdAt_idx"
  ON "TaskHoursRequestActivity" ("requestId", "createdAt");

-- Foreign keys, added separately so a re-run does not fail on a duplicate.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskHoursRequest_issueId_fkey') THEN
    ALTER TABLE "TaskHoursRequest" ADD CONSTRAINT "TaskHoursRequest_issueId_fkey"
      FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskHoursRequest_companyId_fkey') THEN
    ALTER TABLE "TaskHoursRequest" ADD CONSTRAINT "TaskHoursRequest_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskHoursRequest_requestedById_fkey') THEN
    ALTER TABLE "TaskHoursRequest" ADD CONSTRAINT "TaskHoursRequest_requestedById_fkey"
      FOREIGN KEY ("requestedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskHoursRequest_reviewedById_fkey') THEN
    ALTER TABLE "TaskHoursRequest" ADD CONSTRAINT "TaskHoursRequest_reviewedById_fkey"
      FOREIGN KEY ("reviewedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskHoursRequestActivity_requestId_fkey') THEN
    ALTER TABLE "TaskHoursRequestActivity" ADD CONSTRAINT "TaskHoursRequestActivity_requestId_fkey"
      FOREIGN KEY ("requestId") REFERENCES "TaskHoursRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskHoursRequestActivity_actorId_fkey') THEN
    ALTER TABLE "TaskHoursRequestActivity" ADD CONSTRAINT "TaskHoursRequestActivity_actorId_fkey"
      FOREIGN KEY ("actorId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
