-- Sessions left open under days that already have a clock-out.
--
-- A day (Attendance) with clockOut set, holding a session (AttendanceLog) with
-- clockOut NULL. Found 2026-09-30: 32 sessions, 16 employees, Oct 2025 – Aug
-- 2026. Each blocked its owner with "Session still open from <date>" at every
-- clock-in (e.g. Rohit Yadav, 19 Feb 2026). The code no longer reads these as
-- open (findOpenSessionBefore); this tidies the rows themselves.
--
-- Run in one go. Step 0 prints what will change; check it before COMMIT.

BEGIN;

-- 0. What is affected (review this output)
SELECT l.id AS log_id, a.id AS attendance_id, a."employeeId", a.date,
       l."clockIn" AS log_in, a."clockOut" AS day_out,
       EXISTS (SELECT 1 FROM "AttendanceLog" z
               WHERE z."attendanceId" = l."attendanceId" AND z.id <> l.id
                 AND z."clockIn" = l."clockIn" AND z."clockOut" IS NOT NULL) AS exact_duplicate
FROM "AttendanceLog" l
JOIN "Attendance" a ON a.id = l."attendanceId"
WHERE l."clockOut" IS NULL AND a."clockOut" IS NOT NULL AND a.date < CURRENT_DATE
ORDER BY a.date;

-- 1. Exact duplicates: an open copy of a closed session with the same clock-in.
--    Nothing is lost -- the closed copy stays.
DELETE FROM "AttendanceLog" l
USING "Attendance" a
WHERE a.id = l."attendanceId"
  AND l."clockOut" IS NULL AND a."clockOut" IS NOT NULL AND a.date < CURRENT_DATE
  AND EXISTS (SELECT 1 FROM "AttendanceLog" z
              WHERE z."attendanceId" = l."attendanceId" AND z.id <> l.id
                AND z."clockIn" = l."clockIn" AND z."clockOut" IS NOT NULL);

-- 2. The rest: close each at the day's own recorded clock-out, flagged as not
--    observed (autoClockedOut) so the screen says so. Skips any session that
--    started after the day's clock-out -- those would get a negative length.
UPDATE "AttendanceLog" l
SET "clockOut" = a."clockOut", "autoClockedOut" = true, "updatedAt" = now()
FROM "Attendance" a
WHERE a.id = l."attendanceId"
  AND l."clockOut" IS NULL AND a."clockOut" IS NOT NULL AND a.date < CURRENT_DATE
  AND a."clockOut" >= l."clockIn";

-- 3. Anything left needs a person to look at it (expected: 0 rows)
SELECT l.id AS log_id, a."employeeId", a.date, l."clockIn", a."clockOut"
FROM "AttendanceLog" l
JOIN "Attendance" a ON a.id = l."attendanceId"
WHERE l."clockOut" IS NULL AND a."clockOut" IS NOT NULL AND a.date < CURRENT_DATE;

COMMIT;
