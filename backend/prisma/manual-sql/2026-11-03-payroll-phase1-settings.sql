-- Payroll Phase 1: year settings, company payroll config, dropdown masters,
-- PF wage basis per salary group, and annual-CTC bands on grades.
-- Additive only: new tables and nullable/defaulted columns. Nothing existing changes behaviour.

ALTER TABLE "PayrollSalaryGroup" ADD COLUMN IF NOT EXISTS "pfWageBasis" TEXT NOT NULL DEFAULT 'CAPPED';
ALTER TABLE "SalaryGrade" ADD COLUMN IF NOT EXISTS "minAnnualCtc" DOUBLE PRECISION;
ALTER TABLE "SalaryGrade" ADD COLUMN IF NOT EXISTS "maxAnnualCtc" DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS "PayrollYearSetting" (
  "id" SERIAL PRIMARY KEY,
  "companyId" INTEGER NOT NULL,
  "financialYear" TEXT NOT NULL,
  "defaultRegimeCode" TEXT NOT NULL DEFAULT 'NEW',
  "regimeLockDate" TIMESTAMP(3) NOT NULL,
  "newJoinerChoiceDays" INTEGER NOT NULL DEFAULT 30,
  "tdsMethod" TEXT NOT NULL DEFAULT 'SPREAD',
  "proofWindowStart" TIMESTAMP(3),
  "proofWindowEnd" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollYearSetting_companyId_financialYear_key" ON "PayrollYearSetting"("companyId", "financialYear");

CREATE TABLE IF NOT EXISTS "PayrollCompanyConfig" (
  "id" SERIAL PRIMARY KEY,
  "companyId" INTEGER NOT NULL,
  "gradeBasis" TEXT NOT NULL DEFAULT 'MONTHLY_GROSS',
  "costingWorkingDays" DOUBLE PRECISION NOT NULL DEFAULT 26,
  "costingHoursPerDay" DOUBLE PRECISION NOT NULL DEFAULT 8,
  "costingIncludeEmployer" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollCompanyConfig_companyId_key" ON "PayrollCompanyConfig"("companyId");

CREATE TABLE IF NOT EXISTS "PayrollDropdownOption" (
  "id" SERIAL PRIMARY KEY,
  "companyId" INTEGER NOT NULL,
  "listKey" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollDropdownOption_companyId_listKey_value_key" ON "PayrollDropdownOption"("companyId", "listKey", "value");
CREATE INDEX IF NOT EXISTS "PayrollDropdownOption_companyId_listKey_idx" ON "PayrollDropdownOption"("companyId", "listKey");
