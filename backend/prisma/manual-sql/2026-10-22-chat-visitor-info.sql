-- Website Chat visitor details: location from IP, device/visit context.
-- Additive and nullable: existing conversations simply have no details.

ALTER TABLE "ChatConversation" ADD COLUMN IF NOT EXISTS "ipAddress" TEXT;
ALTER TABLE "ChatConversation" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "ChatConversation" ADD COLUMN IF NOT EXISTS "region" TEXT;
ALTER TABLE "ChatConversation" ADD COLUMN IF NOT EXISTS "country" TEXT;
ALTER TABLE "ChatConversation" ADD COLUMN IF NOT EXISTS "visitorTimezone" TEXT;
ALTER TABLE "ChatConversation" ADD COLUMN IF NOT EXISTS "language" TEXT;
ALTER TABLE "ChatConversation" ADD COLUMN IF NOT EXISTS "screen" TEXT;
ALTER TABLE "ChatConversation" ADD COLUMN IF NOT EXISTS "utm" JSONB;
ALTER TABLE "ChatConversation" ADD COLUMN IF NOT EXISTS "visitCount" INTEGER;
ALTER TABLE "ChatConversation" ADD COLUMN IF NOT EXISTS "secondsOnSite" INTEGER;
ALTER TABLE "ChatConversation" ADD COLUMN IF NOT EXISTS "pages" JSONB;
