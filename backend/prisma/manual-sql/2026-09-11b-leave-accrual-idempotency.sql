-- 2026-09-11: Make leave accrual and carry-forward actually run, exactly once
--
-- Two jobs were broken in different ways:
--
-- 1. Accrual was scheduled with setInterval(24h) measured from process start,
--    then returned early unless that tick happened to land on the 1st of a
--    month. Every deploy and every pm2 restart reset the clock, so in practice
--    it almost never fired — and had it fired twice it would have credited
--    twice, since nothing recorded that a period was done.
--
-- 2. Carry-forward was never implemented at all. carryForward and
--    carryForwardLimit are configurable (Compensatory Off: 5, Privilege Leave:
--    30) and LeaveBalance.carriedOver was written by no code — every one of the
--    728 live rows still reads 0.
--
-- lastAccruedPeriod is stamped in the same UPDATE that applies the credit, so
-- a restart mid-run cannot double-credit: the retry matches no rows.
-- carriedForwardFromYear is a separate guard because a carried amount of 0 is a
-- legitimate result and so cannot mark itself as done.
--
-- Additive and re-runnable, applied alongside `prisma db push`.

ALTER TABLE "LeaveBalance"
  ADD COLUMN IF NOT EXISTS "lastAccruedPeriod"      TEXT,
  ADD COLUMN IF NOT EXISTS "carriedForwardFromYear" INTEGER;

-- Verify: both checks should return 1.
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'LeaveBalance' AND column_name = 'lastAccruedPeriod')      AS last_accrued_period,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'LeaveBalance' AND column_name = 'carriedForwardFromYear') AS carried_forward_from_year;
