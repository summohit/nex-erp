-- Loss of pay per-day basis: CALENDAR (days in the month, decided 4 Nov 2026) | WORKING | FIXED_30 | FIXED_26.
ALTER TABLE "PayrollCompanyConfig" ADD COLUMN IF NOT EXISTS "lopDayBasis" TEXT NOT NULL DEFAULT 'CALENDAR';
