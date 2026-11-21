-- Prevent and repair duplicate task-timer sessions.
--
-- A double request could create two IssueTimeLog rows with the same start.
-- The first Stop closed one row while the other remained open for hours,
-- inflating the task total (e.g. 6h 58m instead of approximately one hour).
--
-- Run once during deployment. It is additive and safe to re-run.

BEGIN;

-- Keep the shortest completed row for an identical start. It is the observed
-- session; longer siblings are duplicate starts and must not count as work.
WITH duplicate_closed_timers AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY "issueId", "employeeId", "startedAt"
           ORDER BY "durationMin" ASC, "endedAt" ASC, id ASC
         ) AS row_number
  FROM "IssueTimeLog"
  WHERE "endedAt" IS NOT NULL AND "durationMin" > 0
)
UPDATE "IssueTimeLog" log
SET "durationMin" = 0,
    note = CASE
      WHEN log.note IS NULL OR log.note = '' THEN 'Excluded duplicate timer start during timer integrity repair.'
      ELSE log.note || E'\nExcluded duplicate timer start during timer integrity repair.'
    END
FROM duplicate_closed_timers duplicate
WHERE log.id = duplicate.id AND duplicate.row_number > 1;

-- The duplicate Start requests also created duplicate timeline rows within the
-- same minute. Keep the first row, which is the user's single action.
WITH duplicate_start_activities AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY "issueId", "actorId", date_trunc('minute', "createdAt")
           ORDER BY "createdAt" ASC, id ASC
         ) AS row_number
  FROM "IssueActivity"
  WHERE action = 'WORK_STARTED'
)
DELETE FROM "IssueActivity" activity
USING duplicate_start_activities duplicate
WHERE activity.id = duplicate.id AND duplicate.row_number > 1;

-- A stop that closed the long duplicate session is not a second user action.
-- The excluded row still retains its old end time, letting us remove only the
-- matching activity (with a small allowance for request/DB latency).
DELETE FROM "IssueActivity" activity
USING "IssueTimeLog" log
WHERE log.note LIKE '%Excluded duplicate timer start during timer integrity repair%'
  AND activity."issueId" = log."issueId"
  AND activity."actorId" = log."employeeId"
  AND activity.action = 'WORK_STOPPED'
  AND activity."createdAt" BETWEEN log."endedAt" - INTERVAL '2 minutes'
                             AND log."endedAt" + INTERVAL '2 minutes';

-- If an old duplicate is still open, keep the newest session and close the
-- older copies at their start so they add no artificial time.
WITH open_timers AS (
  SELECT id,
         row_number() OVER (PARTITION BY "issueId" ORDER BY "startedAt" DESC, id DESC) AS row_number
  FROM "IssueTimeLog"
  WHERE "endedAt" IS NULL
)
UPDATE "IssueTimeLog" log
SET "endedAt" = log."startedAt",
    "durationMin" = 0,
    note = CASE
      WHEN log.note IS NULL OR log.note = '' THEN 'Closed duplicate open timer during timer integrity repair.'
      ELSE log.note || E'\nClosed duplicate open timer during timer integrity repair.'
    END
FROM open_timers duplicate
WHERE log.id = duplicate.id AND duplicate.row_number > 1;

-- Enforce the invariant across API instances; the service lock handles the
-- same-process race, this partial index handles separate workers.
CREATE UNIQUE INDEX IF NOT EXISTS "IssueTimeLog_one_open_timer_per_issue"
  ON "IssueTimeLog" ("issueId")
  WHERE "endedAt" IS NULL;

COMMIT;
