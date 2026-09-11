-- 2026-09-11: Authorised signatory block on quotations
--
-- The reference quotation ends with a signature/stamp image above the line
-- "AUTHORISED SIGNATORY FOR <company>". Neither the name nor the image existed,
-- so the generated PDF printed the company name alone with no signature.
--
-- Both nullable. With no name the block falls back to the company name, which
-- is what it prints today; with no image it simply omits the stamp. A quotation
-- must never fail to generate because a signature was not uploaded.
--
-- Additive and re-runnable.

ALTER TABLE "SystemSetting"
  ADD COLUMN IF NOT EXISTS "quotationSignatoryName" TEXT,
  ADD COLUMN IF NOT EXISTS "quotationSignatureUrl"  TEXT;

-- Verify: should return 2.
SELECT count(*) AS signatory_columns
  FROM information_schema.columns
 WHERE table_name = 'SystemSetting'
   AND column_name IN ('quotationSignatoryName','quotationSignatureUrl');
