-- Website Chat: office hours and an offline message per widget.
-- Additive and nullable: existing widgets keep behaving as "always online".

ALTER TABLE "ChatWidgetConfig" ADD COLUMN IF NOT EXISTS "officeHours" JSONB;
ALTER TABLE "ChatWidgetConfig" ADD COLUMN IF NOT EXISTS "offlineMessage" TEXT;
