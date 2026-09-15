-- Hours become a budget rather than a note.
--
-- A pre-sales member is engaged for a number of hours, and the tasks raised for
-- them may not exceed it. Needing more is a decision for an administrator, so
-- it travels the same approve/reject path as asking for a person — hence a type
-- on the request rather than a second request model.
--
-- Members whose hours are NULL are uncapped, not capped at zero: 7 of the 11
-- existing members predate this and must stay assignable. Re-runnable.

ALTER TABLE "PreSalesRequest" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'NEW_MEMBER';

CREATE INDEX IF NOT EXISTS "PreSalesRequest_companyId_type_status_idx"
  ON "PreSalesRequest" ("companyId", "type", "status");

-- verify
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'PreSalesRequest' AND column_name = 'type') AS type_column,
  (SELECT count(*) FROM "PreSalesTeamMember" WHERE "hours" IS NULL) AS uncapped_members,
  (SELECT count(*) FROM "PreSalesTeamMember" WHERE "hours" IS NOT NULL) AS capped_members;
