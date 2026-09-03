-- Notification preferences (per-user, per-type mute) + a Notification index.
--
-- Safe to re-run: every statement is guarded.
-- Purely additive — no existing column is altered or dropped.

-- 1. Per-user mute list.
--    Only MUTED types get a row. An absent row means the type is ON, so a newly
--    added notification type is enabled for everyone by default rather than
--    silently off until each user opts in.
CREATE TABLE IF NOT EXISTS "NotificationPreference" (
  "id"        SERIAL       PRIMARY KEY,
  "userId"    INTEGER      NOT NULL,
  "type"      TEXT         NOT NULL,
  "muted"     BOOLEAN      NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One row per (user, type). Prisma addresses the row through this constraint
-- name, so it must match exactly or the upsert fails at runtime.
CREATE UNIQUE INDEX IF NOT EXISTS "NotificationPreference_userId_type_key"
  ON "NotificationPreference" ("userId", "type");

-- Cascade: deleting a user clears their preferences.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'NotificationPreference_userId_fkey'
  ) THEN
    ALTER TABLE "NotificationPreference"
      ADD CONSTRAINT "NotificationPreference_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 2. The bell counts unread rows per user on every page load and every socket
--    push. That query had no supporting index.
CREATE INDEX IF NOT EXISTS "Notification_userId_isRead_idx"
  ON "Notification" ("userId", "isRead");

-- Verify
SELECT
  (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_name = 'NotificationPreference')          AS pref_table,
  (SELECT COUNT(*) FROM pg_indexes
     WHERE indexname = 'NotificationPreference_userId_type_key') AS unique_idx,
  (SELECT COUNT(*) FROM pg_indexes
     WHERE indexname = 'Notification_userId_isRead_idx')   AS notif_idx;
-- Expected: 1 | 1 | 1
