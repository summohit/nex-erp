-- Quotation versioning.
--
-- A quotation that has been sent to a client is a document the client holds.
-- Editing it in place makes the record disagree with their copy, silently. So
-- SENT freezes the row, and a correction becomes the next version of the same
-- proposal on that deal, carrying the same quote number with an -R<n> suffix.
--
-- Every existing quotation is version 1 with no predecessor, which is exactly
-- what the defaults give, so this is safe to run against live data.
-- Re-runnable.

ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "revisionOfId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Quotation_revisionOfId_fkey'
  ) THEN
    ALTER TABLE "Quotation"
      ADD CONSTRAINT "Quotation_revisionOfId_fkey"
      FOREIGN KEY ("revisionOfId") REFERENCES "Quotation"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- Finding "the current version of this deal's proposal" is the hot path in the
-- lead profile, and superseded rows have to be filtered out of it.
CREATE INDEX IF NOT EXISTS "Quotation_leadId_version_idx" ON "Quotation" ("leadId", "version");

-- verify
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'Quotation' AND column_name IN ('version', 'revisionOfId')) AS versioning_columns,
  (SELECT count(*) FROM pg_constraint WHERE conname = 'Quotation_revisionOfId_fkey') AS fk,
  (SELECT count(*) FROM pg_indexes WHERE indexname = 'Quotation_leadId_version_idx') AS idx;
