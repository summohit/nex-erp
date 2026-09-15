-- A pre-sales request becomes a basket of people, each with their own terms.
--
-- Asking for one specialist at a time does not match how the work is scoped:
-- a request is "a network engineer on site for 16 hours and a cloud architect
-- remotely for 8". The admin then approves that set as a whole — trimming or
-- substituting people — so the request needs line items rather than a single
-- employeeId.
--
-- PreSalesRequest had 0 rows when this was written, so its employeeId is
-- dropped rather than migrated. PreSalesTeamMember has 7 real rows, so its new
-- columns are nullable: the members added before this existed have no terms,
-- and inventing values for them would be worse than showing nothing.
-- Re-runnable.

CREATE TABLE IF NOT EXISTS "PreSalesRequestItem" (
  "id"             SERIAL PRIMARY KEY,
  "companyId"      INTEGER NOT NULL REFERENCES "Company"("id") ON DELETE CASCADE,
  "requestId"      INTEGER NOT NULL REFERENCES "PreSalesRequest"("id") ON DELETE CASCADE,
  "employeeId"     INTEGER NOT NULL REFERENCES "Employee"("id") ON DELETE CASCADE,
  "technology"     TEXT,
  "engagementType" TEXT NOT NULL DEFAULT 'VIRTUAL',
  "hours"          DOUBLE PRECISION,
  -- REQUESTED -> APPROVED | REMOVED; ADDED marks an admin substitution.
  "status"         TEXT NOT NULL DEFAULT 'REQUESTED',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "PreSalesRequestItem_requestId_employeeId_key"
  ON "PreSalesRequestItem" ("requestId", "employeeId");
CREATE INDEX IF NOT EXISTS "PreSalesRequestItem_companyId_employeeId_idx"
  ON "PreSalesRequestItem" ("companyId", "employeeId");

-- The single-employee request is replaced by its items.
ALTER TABLE "PreSalesRequest" DROP COLUMN IF EXISTS "employeeId";

-- The assignment records the terms it was granted under.
ALTER TABLE "PreSalesTeamMember" ADD COLUMN IF NOT EXISTS "technology" TEXT;
ALTER TABLE "PreSalesTeamMember" ADD COLUMN IF NOT EXISTS "engagementType" TEXT;
ALTER TABLE "PreSalesTeamMember" ADD COLUMN IF NOT EXISTS "hours" DOUBLE PRECISION;

-- verify
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'PreSalesRequestItem') AS item_table,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'PreSalesTeamMember'
     AND column_name IN ('technology','engagementType','hours')) AS member_cols,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'PreSalesRequest'
     AND column_name = 'employeeId') AS old_column_gone,
  (SELECT count(*) FROM "PreSalesTeamMember") AS members_preserved;
