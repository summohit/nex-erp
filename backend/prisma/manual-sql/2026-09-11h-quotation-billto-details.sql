-- 2026-09-11: The rest of the BILL TO block on a quotation
--
-- The reference quotation prints the buyer's contact name, mobile, email,
-- GSTIN, PAN and Place of Supply. None of those existed: Lead carries a contact
-- name, email and phone but no tax identity, and nothing carried place of
-- supply at all.
--
-- Captured on the quotation rather than read back through the lead, for the
-- same reason as billingCompanyName/billingAddress: a lead edited next month
-- must not silently rewrite a document already sent to a client.
--
-- billingPlaceOfSupply is what decides CGST+SGST (intra-state) versus IGST
-- (inter-state) on the printed quote.
--
-- Additive and re-runnable.

ALTER TABLE "Quotation"
  ADD COLUMN IF NOT EXISTS "billingContactName"   TEXT,
  ADD COLUMN IF NOT EXISTS "billingMobile"        TEXT,
  ADD COLUMN IF NOT EXISTS "billingEmail"         TEXT,
  ADD COLUMN IF NOT EXISTS "billingGstin"         TEXT,
  ADD COLUMN IF NOT EXISTS "billingPan"           TEXT,
  ADD COLUMN IF NOT EXISTS "billingPlaceOfSupply" TEXT;

-- Verify: should return 6.
SELECT count(*) AS billto_columns
  FROM information_schema.columns
 WHERE table_name = 'Quotation'
   AND column_name IN ('billingContactName','billingMobile','billingEmail',
                       'billingGstin','billingPan','billingPlaceOfSupply');
