-- Probation policy per company (months by employment category, extensions,
-- reminders, pro-rata rounding) and how many times a probation was extended.
ALTER TABLE "SystemSetting" ADD COLUMN IF NOT EXISTS "probationPolicy" JSONB;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "probationExtensions" INTEGER NOT NULL DEFAULT 0;
