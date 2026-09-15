-- 2026-09-15: Mark the days nobody clocked out of
--
-- AutoClockoutCron closes any session still open at 23:00 IST of its own day
-- and, having no live device to ask, reuses the clock-in coordinates for the
-- clock-out. On screen that is indistinguishable from someone who really did
-- work until 11 PM and left from where they arrived — a 13-hour day, often with
-- overtime attached. The flag says which it was.
--
-- Per session as well as per day, because a day can hold one session the
-- employee closed and another the sweep did.
--
-- Backfill is a heuristic, and deliberately a narrow one: a clock-out at
-- exactly 23:00 IST whose coordinates are the clock-in's, or absent entirely.
-- A real 11:00:00 PM clock-out from the same spot would be caught too; at
-- second precision that is vanishingly rare, and calling it auto-closed is the
-- less misleading of the two errors.
--
-- Note the double AT TIME ZONE. These columns are `timestamp without time
-- zone` holding UTC, so the naive value has to be labelled UTC before it can be
-- read in IST. A single `AT TIME ZONE 'Asia/Kolkata'` subtracts the offset
-- instead of adding it and matches nothing — eleven hours off, silently.
--
-- Additive and re-runnable, applied alongside `prisma db push`.

ALTER TABLE "Attendance"
  ADD COLUMN IF NOT EXISTS "autoClockedOut" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "AttendanceLog"
  ADD COLUMN IF NOT EXISTS "autoClockedOut" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Attendance"
   SET "autoClockedOut" = true
 WHERE "clockOut" IS NOT NULL
   AND "autoClockedOut" = false
   AND to_char("clockOut" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'HH24:MI:SS') = '23:00:00'
   AND ("clockOutLat" IS NOT DISTINCT FROM "clockInLat")
   AND ("clockOutLng" IS NOT DISTINCT FROM "clockInLng");

UPDATE "AttendanceLog" l
   SET "autoClockedOut" = true
  FROM "Attendance" a
 WHERE l."attendanceId" = a.id
   AND a."autoClockedOut" = true
   AND l."clockOut" IS NOT NULL
   AND l."autoClockedOut" = false
   AND to_char(l."clockOut" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'HH24:MI:SS') = '23:00:00';

-- Verify: both columns present (expect 2), plus how many days were backfilled.
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name IN ('Attendance', 'AttendanceLog') AND column_name = 'autoClockedOut') AS columns_added,
  (SELECT count(*) FROM "Attendance"    WHERE "autoClockedOut") AS days_marked,
  (SELECT count(*) FROM "AttendanceLog" WHERE "autoClockedOut") AS sessions_marked;
