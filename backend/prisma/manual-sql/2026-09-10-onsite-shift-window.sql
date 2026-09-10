-- 2026-09-10: On-site shift windows, and attendance that actually reads the roster
--
-- 1. ShiftRosterEntry.startTime / endTime — an on-site stint at a client site
--    rarely runs office hours, so a roster cell can now carry its own "HH:mm"
--    clock window. NULL means "use the shift's own startTime/endTime", which is
--    what every existing row gets, so nothing changes for current data.
--
-- 2. Attendance.shiftId / projectId / isOnsite — clock-in now resolves the
--    roster (roster entry first, standing shift as the fallback) instead of
--    reading Employee.shift blindly, and records what it judged the day
--    against. Stored rather than re-derived: the roster can be edited after
--    the fact and a day marked late has to stay explicable.
--
-- Additive and re-runnable, applied alongside `prisma db push`.

ALTER TABLE "ShiftRosterEntry"
  ADD COLUMN IF NOT EXISTS "startTime" TEXT,
  ADD COLUMN IF NOT EXISTS "endTime"   TEXT;

ALTER TABLE "Attendance"
  ADD COLUMN IF NOT EXISTS "shiftId"   INTEGER,
  ADD COLUMN IF NOT EXISTS "projectId" INTEGER,
  ADD COLUMN IF NOT EXISTS "isOnsite"  BOOLEAN NOT NULL DEFAULT false;

-- Both FKs are optional and SET NULL: deleting a shift or a project must never
-- delete attendance history, and must not block the delete either.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Attendance_shiftId_fkey') THEN
    ALTER TABLE "Attendance"
      ADD CONSTRAINT "Attendance_shiftId_fkey"
      FOREIGN KEY ("shiftId") REFERENCES "Shift"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Attendance_projectId_fkey') THEN
    ALTER TABLE "Attendance"
      ADD CONSTRAINT "Attendance_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- "How much on-site time did this project take?" is the reason projectId exists.
CREATE INDEX IF NOT EXISTS "Attendance_projectId_date_idx"
  ON "Attendance"("projectId", "date");

-- Verify: every check should return 1.
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'ShiftRosterEntry' AND column_name = 'startTime') AS roster_start_time,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'ShiftRosterEntry' AND column_name = 'endTime')   AS roster_end_time,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'Attendance' AND column_name = 'shiftId')         AS att_shift_id,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'Attendance' AND column_name = 'projectId')       AS att_project_id,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'Attendance' AND column_name = 'isOnsite')        AS att_is_onsite;
