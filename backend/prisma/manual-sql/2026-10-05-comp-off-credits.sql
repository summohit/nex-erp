-- 2026-10-05: Comp-Off credited automatically for field visits on non-working days
--
-- Approving a field visit that lands on a holiday, a week off or a rostered day
-- off now credits one Comp-Off day per person per such day. CompOffCredit is the
-- ledger that makes that safe to repeat: re-approval cannot double-credit, and
-- cancelling the trip (or moving its dates) takes back exactly what it gave.
--
-- Additive only. Re-runnable.

ALTER TABLE "LeaveType"
  ADD COLUMN IF NOT EXISTS "isCompOff" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "CompOffCredit" (
  "id"                  SERIAL PRIMARY KEY,
  "companyId"           INTEGER NOT NULL,
  "employeeId"          INTEGER NOT NULL REFERENCES "Employee"("id")  ON DELETE CASCADE,
  "leaveTypeId"         INTEGER NOT NULL REFERENCES "LeaveType"("id") ON DELETE CASCADE,
  "fieldVisitRequestId" INTEGER NOT NULL,
  "date"                DATE NOT NULL,
  "reason"              TEXT NOT NULL,
  "days"                DOUBLE PRECISION NOT NULL DEFAULT 1,
  "year"                INTEGER NOT NULL,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "CompOffCredit_fieldVisitRequestId_employeeId_date_key"
  ON "CompOffCredit" ("fieldVisitRequestId", "employeeId", "date");
CREATE INDEX IF NOT EXISTS "CompOffCredit_employeeId_idx" ON "CompOffCredit" ("employeeId");

-- An existing leave type that is plainly comp-off is adopted rather than a
-- second one being created beside it. Only where a company has exactly one such
-- name, and none flagged yet; review the result in Master Data → Leave Types.
UPDATE "LeaveType" lt
   SET "isCompOff" = true
 WHERE lt.name ~* '^\s*comp[\s\-_]*off'
   AND NOT EXISTS (SELECT 1 FROM "LeaveType" f WHERE f."companyId" = lt."companyId" AND f."isCompOff")
   AND (SELECT count(*) FROM "LeaveType" c
         WHERE c."companyId" = lt."companyId" AND c.name ~* '^\s*comp[\s\-_]*off') = 1;

SELECT
  (SELECT count(*) FROM "LeaveType" WHERE "isCompOff") AS comp_off_types,
  (SELECT count(*) FROM "CompOffCredit")              AS credits;
