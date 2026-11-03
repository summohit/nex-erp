-- Payroll Phase 2: pay profiles (versioned), PAN / UAN on employees,
-- and "pays as" on worker types. Additive only; existing payroll is unchanged.

ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "uanNumber" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "panNumber" TEXT;
ALTER TABLE "PayrollDropdownOption" ADD COLUMN IF NOT EXISTS "paysAs" TEXT;

CREATE TABLE IF NOT EXISTS "EmployeePayProfile" (
  "id" SERIAL PRIMARY KEY,
  "companyId" INTEGER NOT NULL,
  "employeeId" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "salaryGroupCode" TEXT NOT NULL,
  "annualCtc" DOUBLE PRECISION NOT NULL,
  "workerType" TEXT,
  "paymentMethod" TEXT,
  "overrides" JSONB,
  "reason" TEXT,
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "createdByUserId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "EmployeePayProfile_employeeId_version_key" ON "EmployeePayProfile"("employeeId", "version");
CREATE INDEX IF NOT EXISTS "EmployeePayProfile_companyId_employeeId_idx" ON "EmployeePayProfile"("companyId", "employeeId");
