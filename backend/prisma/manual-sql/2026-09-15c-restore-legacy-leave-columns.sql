-- 2026-09-15: URGENT — put the old leave columns back so the DEPLOYED code runs
--
-- 2026-09-15-leave-encashment.sql dropped LeaveType.carryForward /
-- carryForwardLimit and LeaveBalance.carriedOver / carriedForwardFromYear. That
-- is correct for the new code and wrong for the code currently running in
-- production, which still reads them. Prisma selects every scalar column when a
-- query has no explicit `select`, so a dropped column takes the whole query
-- down with it — for example GET /master-data/leave-types and
-- GET /leaves/balances, both of which are unrestricted findMany calls.
--
-- The drop should have been the LAST step, not the first: add the new columns,
-- deploy the code that uses them, and only then drop the old ones. This file
-- puts the database back into that middle state, where BOTH versions work.
--
-- Values are copied back from the new columns so the running UI is not showing
-- something different from what the new code will show.
--
-- Safe to run more than once. Safe to run before or after the new deploy.

ALTER TABLE "LeaveBalance"
  ADD COLUMN IF NOT EXISTS "carriedOver"            DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "carriedForwardFromYear" INTEGER;

ALTER TABLE "LeaveType"
  ADD COLUMN IF NOT EXISTS "carryForward"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "carryForwardLimit" INTEGER NOT NULL DEFAULT 0;

UPDATE "LeaveType"
   SET "carryForward"      = "encashable",
       "carryForwardLimit" = "encashmentLimit"
 WHERE "carryForward"      IS DISTINCT FROM "encashable"
    OR "carryForwardLimit" IS DISTINCT FROM "encashmentLimit";

-- Verify: expect 2, 2, and 3 types flagged (Compensatory Off, Privilege Leave,
-- Sick Leave — the three that were configured to carry forward).
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'LeaveBalance'
       AND column_name IN ('carriedOver', 'carriedForwardFromYear'))    AS balance_columns_back,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'LeaveType'
       AND column_name IN ('carryForward', 'carryForwardLimit'))        AS type_columns_back,
  (SELECT count(*) FROM "LeaveType" WHERE "carryForward")               AS types_flagged;
