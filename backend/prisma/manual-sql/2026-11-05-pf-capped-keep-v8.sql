-- Testing clean-up (5 Nov 2026): keep only v8 of REGULAR_PF_CAPPED and make it apply from 1 Apr 2026.
BEGIN;
DELETE FROM "PayrollSalaryGroup" WHERE "companyId" = 1 AND code = 'REGULAR_PF_CAPPED' AND id IN (2, 13, 20, 27, 33, 35, 36);
UPDATE "PayrollSalaryGroup" SET "effectiveFrom" = '2026-04-01', "retiredAt" = NULL WHERE id = 37 AND code = 'REGULAR_PF_CAPPED';
COMMIT;
