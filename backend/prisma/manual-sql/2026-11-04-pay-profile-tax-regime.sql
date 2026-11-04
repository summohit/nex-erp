-- Each employee's income-tax regime (NEW / OLD). NULL = the financial year's default regime.
ALTER TABLE "EmployeePayProfile" ADD COLUMN IF NOT EXISTS "taxRegime" TEXT;
