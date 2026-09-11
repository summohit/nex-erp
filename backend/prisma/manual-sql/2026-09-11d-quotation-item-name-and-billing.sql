-- 2026-09-11: Quotation line-item name, and billed-to details on the quote
--
-- 1. QuotationItem.name — the line item's short label. What the form called
--    "Description" becomes "Name", and description is now the longer text
--    underneath it. Nullable, so every existing row stays valid; description
--    remains NOT NULL and untouched.
--
-- 2. Quotation.billingCompanyName / billingAddress — who the quote is addressed
--    to, seeded from the lead and editable on the quote itself. Copied rather
--    than read back through the lead relation on purpose: editing a lead's
--    company or address months later must not silently rewrite a quotation that
--    has already been sent to a client.
--
-- Additive and re-runnable, applied alongside `prisma db push`.

ALTER TABLE "QuotationItem"
  ADD COLUMN IF NOT EXISTS "name" TEXT;

ALTER TABLE "Quotation"
  ADD COLUMN IF NOT EXISTS "billingCompanyName" TEXT,
  ADD COLUMN IF NOT EXISTS "billingAddress"     TEXT;

-- Verify: all three checks should return 1.
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'QuotationItem' AND column_name = 'name')               AS item_name,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'Quotation' AND column_name = 'billingCompanyName')     AS billing_company,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'Quotation' AND column_name = 'billingAddress')         AS billing_address;
