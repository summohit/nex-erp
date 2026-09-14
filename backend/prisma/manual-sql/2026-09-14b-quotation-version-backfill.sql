-- Backfill quotation versions per deal.
--
-- Versioning shipped with every existing row defaulted to 1, so a deal with
-- three quotations showed "v1" three times. A deal carries one proposal that
-- evolves, so the versions are the creation order within the deal.
--
-- Only the `version` display column is touched. Quote numbers are deliberately
-- left alone: those documents may already be in a client's inbox, and renaming
-- them here would make the record disagree with the paper.
--
-- Re-runnable: it recomputes the same ordering every time.

WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY "leadId" ORDER BY id) AS n
  FROM "Quotation"
  WHERE "leadId" IS NOT NULL
)
UPDATE "Quotation" q
SET "version" = ordered.n
FROM ordered
WHERE q.id = ordered.id AND q."version" IS DISTINCT FROM ordered.n;

-- verify: every deal's versions should run 1..n with no repeats
SELECT
  (SELECT count(*) FROM "Quotation" WHERE "leadId" IS NOT NULL) AS rows_on_deals,
  (SELECT count(*) FROM (
     SELECT "leadId" FROM "Quotation" WHERE "leadId" IS NOT NULL
     GROUP BY "leadId", "version" HAVING count(*) > 1
   ) dupes) AS duplicate_versions_per_deal;
