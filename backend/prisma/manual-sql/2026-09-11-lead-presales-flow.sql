-- Adds a pipeline discriminator to Lead (SALES vs PRE_SALES) plus the link that
-- records when a pre-sales deal is converted into a sales lead.
-- Run this in the production database before deploying the matching backend.
-- It is additive: existing leads keep flowing through the SALES pipeline.

ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "flow" TEXT NOT NULL DEFAULT 'SALES',
  ADD COLUMN IF NOT EXISTS "convertedToSalesId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Lead_convertedToSalesId_fkey'
  ) THEN
    ALTER TABLE "Lead"
      ADD CONSTRAINT "Lead_convertedToSalesId_fkey"
      FOREIGN KEY ("convertedToSalesId") REFERENCES "Lead"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Lead_flow_idx" ON "Lead"("companyId", "flow");
CREATE INDEX IF NOT EXISTS "Lead_convertedToSalesId_idx" ON "Lead"("convertedToSalesId");