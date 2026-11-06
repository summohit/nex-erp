-- Monthly gross typed per pay profile version (null = CTC less employer contributions)
ALTER TABLE "EmployeePayProfile" ADD COLUMN IF NOT EXISTS "grossMonthly" DOUBLE PRECISION;
