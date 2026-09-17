-- 2026-09-17: A note on a time log (§19).
--
-- §19 lists "Description" among the fields every time entry should store, and
-- it was the one field never built. The gap only became obvious migrating
-- Workway, whose every log carries a memo — "mail for letter and offer",
-- "pan 2.0 documentation" — and that memo is the only thing that says what
-- 2h 30m against "Project Management" actually was.
--
-- Nullable, and staying that way. Thousands of existing rows have no note and
-- were never asked for one, so a default would be inventing a note nobody
-- wrote. The timer writes rows with no note too: it records a span, and asking
-- for a sentence at every stop is how people stop using the timer.
--
-- Re-runnable. Apply BEFORE `prisma generate`.

ALTER TABLE "IssueTimeLog"
  ADD COLUMN IF NOT EXISTS "note" TEXT;

-- Verify: the column exists, and how much of it is filled.
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'IssueTimeLog' AND column_name = 'note'
  )                                                    AS note_column,
  count(*)                                             AS total_logs,
  count("note")                                        AS logs_with_note
FROM "IssueTimeLog";
