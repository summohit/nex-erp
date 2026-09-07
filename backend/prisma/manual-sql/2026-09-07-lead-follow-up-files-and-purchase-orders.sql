-- Adds scoped follow-up attachments and a purpose marker for purchase orders.
-- Run this in the production database before deploying the matching backend.
-- It is additive and leaves existing deal files unchanged.

ALTER TABLE "LeadFile"
  ADD COLUMN IF NOT EXISTS "followUpId" INTEGER,
  ADD COLUMN IF NOT EXISTS "purpose" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'LeadFile_followUpId_fkey'
  ) THEN
    ALTER TABLE "LeadFile"
      ADD CONSTRAINT "LeadFile_followUpId_fkey"
      FOREIGN KEY ("followUpId") REFERENCES "LeadFollowUp"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "LeadFile_followUpId_idx" ON "LeadFile"("followUpId");
CREATE INDEX IF NOT EXISTS "LeadFile_purchaseOrder_idx" ON "LeadFile"("leadId", "purpose");
