-- Resync Project."issueSeq" with the keys that already exist.
--
-- Field visit activation numbered its tasks from `SELECT count(*)` on Issue
-- rather than from the project's counter, so it minted keys that
-- Project."issueSeq" never learned about. Every other writer allocates by
-- incrementing that counter, so the next task raised by hand landed on a
-- number one of those activation tasks already held:
--
--   duplicate key value violates unique constraint "Issue_key_companyId_key"
--
-- And it stayed broken rather than failing once. The increment happens inside
-- the same transaction as the insert, so the rollback took the increment with
-- it and the counter never moved past the collision.
--
-- The code no longer does this (field-visit-activation.service.ts), but the
-- counters it already left behind need catching up once.
--
-- Read-repair only: additive, idempotent, and it never moves a counter
-- backwards, so a project whose counter is already ahead is left alone.

BEGIN;

UPDATE "Project" p
   SET "issueSeq" = m.max_suffix
  FROM (
    SELECT "projectId",
           MAX(NULLIF(regexp_replace(key, '^.*-', ''), '')::INTEGER) AS max_suffix
      FROM "Issue"
     WHERE key ~ '-[0-9]+$'
     GROUP BY "projectId"
  ) m
 WHERE m."projectId" = p.id
   AND p."issueSeq" < m.max_suffix;

COMMIT;

-- Verify: must return 0. Any row here is a key whose number is already beyond
-- its project's counter, which is the exact condition that causes the clash.
SELECT count(*) AS keys_ahead_of_seq
  FROM "Issue" i
  JOIN "Project" p ON p.id = i."projectId"
 WHERE i.key ~ '-[0-9]+$'
   AND (regexp_replace(i.key, '^.*-', ''))::INTEGER > p."issueSeq";
