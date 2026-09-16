-- 2026-09-16: Shift reminders, push devices, and the end of the automatic clock-out
--
-- Three things arrive together because they are one change:
--
--   1. The 23:00 sweep stops closing sessions. A clock-out it wrote was never an
--      observation — the time was a cutoff and the coordinates were the
--      clock-in's reused — and it quietly erased the fact that somebody forgot.
--      Sessions now stay open until a human closes them, and the sweep's job is
--      to say so. `missedClockOut` is that statement.
--
--   2. Closing a previous day's session after IST midnight now needs a reason,
--      because at that point the clock-out time bears no relation to when the
--      person actually stopped working. `clockOutReason` holds it.
--
--   3. Reminders have to reach a closed app, which Socket.IO cannot do. FCM can,
--      and it addresses a registration token per browser or app install —
--      `DeviceToken`. `ShiftReminderLog` is what stops a minute-by-minute sweep
--      sending the same reminder twice after a restart.
--
-- Re-runnable. Apply alongside `prisma db push`.

-- ── 1. Attendance ────────────────────────────────────────────────────────
ALTER TABLE "Attendance"
  ADD COLUMN IF NOT EXISTS "clockOutReason" TEXT,
  ADD COLUMN IF NOT EXISTS "missedClockOut" BOOLEAN NOT NULL DEFAULT false;

-- The reminder sweep asks "whose session is still open?" every minute.
CREATE INDEX IF NOT EXISTS "Attendance_clockOut_date_idx"
  ON "Attendance" ("clockOut", "date");

-- ── 2. Push destinations ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "DeviceToken" (
  "id"         SERIAL PRIMARY KEY,
  "token"      TEXT NOT NULL,
  "userId"     INTEGER NOT NULL REFERENCES "User"("id")    ON DELETE CASCADE,
  "companyId"  INTEGER NOT NULL REFERENCES "Company"("id") ON DELETE CASCADE,
  "platform"   TEXT NOT NULL,
  "deviceName" TEXT,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Unique on the token, not on (user, token): the same browser or handset can be
-- signed into by a second person, and the registration re-points the row rather
-- than leaving a ghost that pushes one person's shift reminders to another.
CREATE UNIQUE INDEX IF NOT EXISTS "DeviceToken_token_key"     ON "DeviceToken" ("token");
CREATE INDEX        IF NOT EXISTS "DeviceToken_userId_idx"    ON "DeviceToken" ("userId");
CREATE INDEX        IF NOT EXISTS "DeviceToken_companyId_idx" ON "DeviceToken" ("companyId");

-- ── 3. Reminders already sent ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ShiftReminderLog" (
  "id"         SERIAL PRIMARY KEY,
  "employeeId" INTEGER NOT NULL REFERENCES "Employee"("id") ON DELETE CASCADE,
  "date"       DATE NOT NULL,
  "kind"       TEXT NOT NULL,
  "sentAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The idempotency key. The sweep inserts before it sends; a duplicate insert
-- fails and the send is skipped, so a restart inside the same minute — or a
-- second backend instance — cannot double-send.
CREATE UNIQUE INDEX IF NOT EXISTS "ShiftReminderLog_employeeId_date_kind_key"
  ON "ShiftReminderLog" ("employeeId", "date", "kind");
CREATE INDEX IF NOT EXISTS "ShiftReminderLog_date_idx" ON "ShiftReminderLog" ("date");

-- ── 4. Sessions the old sweep already closed ─────────────────────────────
-- Left exactly as they are. Reopening them would put months of finished days
-- back on people's screens as outstanding work; `autoClockedOut` already marks
-- them as cutoffs rather than observations, which is the honest record of what
-- happened while that job was running.

-- Verify.
SELECT
  (SELECT count(*) FROM "DeviceToken")                                    AS device_tokens,
  (SELECT count(*) FROM "ShiftReminderLog")                               AS reminders_sent,
  (SELECT count(*) FROM "Attendance" WHERE "missedClockOut")              AS flagged_missed,
  (SELECT count(*) FROM "Attendance"
    WHERE "clockIn" IS NOT NULL AND "clockOut" IS NULL)                   AS open_sessions,
  (SELECT count(*) FROM "Attendance" WHERE "autoClockedOut")              AS legacy_auto_closed;
