-- 2026-09-15: Leave expires with its year and is paid out, not carried forward
--
-- Policy change, not a bug fix. Leave granted for a year now ends with that
-- year: whatever is unused when the year's last payslip is generated is bought
-- back in that payslip, and the new year opens with a fresh allocation. Nothing
-- rolls over any more.
--
-- Carry-forward went in four days ago (2026-09-11b) and has never run — it
-- fires only on 1 January, so no January has passed since. Every one of the 728
-- LeaveBalance rows still reads carriedOver = 0 and carriedForwardFromYear
-- NULL, which the queries below assert before dropping anything. If either
-- returns a non-zero count, STOP: something wrote carry-over after all, and
-- those days have to be encashed by hand before the columns go.
--
-- LeaveType.carryForwardLimit is not dropped blind either: it becomes the
-- starting encashmentLimit for the types that had it (Compensatory Off: 5,
-- Privilege Leave: 30), so the cap HR already chose survives the rename.
--
-- Apply alongside `prisma db push`.

-- 1. Safety check. Both must be 0.
SELECT
  (SELECT count(*) FROM "LeaveBalance" WHERE "carriedOver" <> 0)                 AS rows_with_carried_days,
  (SELECT count(*) FROM "LeaveBalance" WHERE "carriedForwardFromYear" IS NOT NULL) AS rows_already_rolled;

-- 2. Leave types: carry-forward becomes encashment, keeping the configured cap.
ALTER TABLE "LeaveType"
  ADD COLUMN IF NOT EXISTS "encashable"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "encashmentLimit" INTEGER NOT NULL DEFAULT 0;

UPDATE "LeaveType"
   SET "encashable"      = "carryForward",
       "encashmentLimit" = "carryForwardLimit"
 WHERE "carryForward" = true
   AND "encashable" = false;

ALTER TABLE "LeaveType"
  DROP COLUMN IF EXISTS "carryForward",
  DROP COLUMN IF EXISTS "carryForwardLimit";

-- 3. Balances: a year's row no longer inherits anything from the year before.
ALTER TABLE "LeaveBalance"
  DROP COLUMN IF EXISTS "carriedOver",
  DROP COLUMN IF EXISTS "carriedForwardFromYear";

-- 4. What was paid out, and on which payslip. One row per employee, per leave
--    type, per leave year; rewritten while the December slip is still a draft.
CREATE TABLE IF NOT EXISTS "LeaveEncashment" (
  "id"          SERIAL PRIMARY KEY,
  "employeeId"  INTEGER NOT NULL REFERENCES "Employee"("id")  ON DELETE CASCADE,
  "leaveTypeId" INTEGER NOT NULL REFERENCES "LeaveType"("id") ON DELETE CASCADE,
  "year"        INTEGER NOT NULL,
  "days"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "ratePerDay"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "amount"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "payslipId"   INTEGER REFERENCES "Payslip"("id") ON DELETE SET NULL,
  "companyId"   INTEGER NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "LeaveEncashment_employeeId_leaveTypeId_year_key"
  ON "LeaveEncashment" ("employeeId", "leaveTypeId", "year");

-- Verify: 2 dropped columns gone, 2 added, table present. Expect 0, 2, 1.
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name IN ('LeaveType', 'LeaveBalance')
       AND column_name IN ('carryForward', 'carryForwardLimit', 'carriedOver', 'carriedForwardFromYear')) AS leftovers,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'LeaveType' AND column_name IN ('encashable', 'encashmentLimit'))                 AS encashment_columns,
  (SELECT count(*) FROM information_schema.tables
     WHERE table_name = 'LeaveEncashment')                                                               AS encashment_table;
