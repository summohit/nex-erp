-- When a task actually reached DONE.
--
-- `updatedAt` has been standing in for this, and it is not the same thing:
-- fixing a typo on a finished task bumps updatedAt and makes it look freshly
-- completed. That is harmless in a "completed this week" tile and wrong in a
-- leaderboard that ranks people by it.
--
-- The backfill below is a best estimate, not a fact, and worth being plain
-- about: for tasks already DONE we have no record of when they were finished,
-- and updatedAt is the closest thing that exists. A task marked done in
-- January and edited in March will read as completed in March.
--
-- The alternative was leaving history null, which would have meant an empty
-- leaderboard for the first thirty days. Estimated history that is roughly
-- right beats no history at all here, as long as nobody mistakes it for
-- precise — hence this comment rather than a silent UPDATE. Every task
-- completed from now on carries a real timestamp.
--
-- Additive and guarded, so it is safe to re-run.

BEGIN;

ALTER TABLE "Issue"
  ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);

-- The leaderboard reads "done, in this window", so it reads exactly this.
CREATE INDEX IF NOT EXISTS "Issue_completedAt_idx" ON "Issue" ("completedAt");

UPDATE "Issue"
   SET "completedAt" = "updatedAt"
 WHERE status = 'DONE'
   AND "completedAt" IS NULL;

COMMIT;

-- Verify: every DONE task should now carry a timestamp, and nothing else should.
SELECT
  count(*) FILTER (WHERE status = 'DONE'  AND "completedAt" IS NOT NULL) AS done_with_date,
  count(*) FILTER (WHERE status = 'DONE'  AND "completedAt" IS NULL)     AS done_without_date,
  count(*) FILTER (WHERE status <> 'DONE' AND "completedAt" IS NOT NULL) AS not_done_but_dated
FROM "Issue";
