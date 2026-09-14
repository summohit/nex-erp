-- Sequential quotation numbers.
--
-- Numbers were `<prefix>-<last 8 digits of Date.now()>`, which is unique by
-- luck rather than by design and reads as noise on a document a client keeps:
-- 3111-62022537 where the reference quotation this template was modelled on
-- says 3111. This replaces the timestamp with a per-company counter.
--
-- The counter is seeded to the number of quotations that already exist, so the
-- next one issued continues the count rather than restarting at 1 alongside
-- them. Existing numbers are deliberately NOT rewritten: those documents have
-- been sent, and renaming them would make the record disagree with the paper.
--
-- Re-runnable. The seed only applies to companies still sitting at 0.

ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "quotationSequence" INTEGER NOT NULL DEFAULT 0;

UPDATE "Company" c
SET "quotationSequence" = sub.n
FROM (SELECT "companyId", count(*)::int AS n FROM "Quotation" GROUP BY "companyId") sub
WHERE c.id = sub."companyId" AND c."quotationSequence" = 0;

-- A backstop the old scheme never had: quoteNumber carried no constraint at
-- all, so nothing but the clock stopped two quotations sharing a number.
CREATE UNIQUE INDEX IF NOT EXISTS "Quotation_companyId_quoteNumber_key"
  ON "Quotation" ("companyId", "quoteNumber");

-- verify
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'Company' AND column_name = 'quotationSequence') AS column_added,
  (SELECT count(*) FROM pg_indexes WHERE indexname = 'Quotation_companyId_quoteNumber_key') AS unique_index,
  (SELECT "quotationSequence" FROM "Company" WHERE id = 1) AS company_1_sequence;
