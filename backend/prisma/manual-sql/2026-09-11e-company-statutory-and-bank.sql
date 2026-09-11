-- 2026-09-11: Company statutory, contact and bank details
--
-- Fields that belong on a quotation or invoice letterhead: mobile, email,
-- address, GSTIN, PAN, Udyam registration, the quote-number prefix, and the
-- bank account a client pays into.
--
-- All nullable. A company must still be able to save its profile without a
-- registration number, and every existing row stays valid.
--
-- quotationPrefix is read by createQuotation; blank falls back to "QT", which
-- is what every quotation generated so far already uses, so existing numbering
-- is unaffected.
--
-- Additive and re-runnable, applied alongside `prisma db push`.

ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "mobile"            TEXT,
  ADD COLUMN IF NOT EXISTS "email"             TEXT,
  ADD COLUMN IF NOT EXISTS "address"           TEXT,
  ADD COLUMN IF NOT EXISTS "gstin"             TEXT,
  ADD COLUMN IF NOT EXISTS "panNumber"         TEXT,
  ADD COLUMN IF NOT EXISTS "udyamRegNo"        TEXT,
  ADD COLUMN IF NOT EXISTS "quotationPrefix"   TEXT,
  ADD COLUMN IF NOT EXISTS "bankAccountName"   TEXT,
  ADD COLUMN IF NOT EXISTS "bankName"          TEXT,
  ADD COLUMN IF NOT EXISTS "bankBranch"        TEXT,
  ADD COLUMN IF NOT EXISTS "bankIfsc"          TEXT,
  ADD COLUMN IF NOT EXISTS "bankAccountNumber" TEXT;

-- Deliberately no seeded values: real bank account numbers do not belong in a
-- file under version control. Enter them in Settings > Company Profile.

-- Verify: should return 12.
SELECT count(*) AS company_columns_added
  FROM information_schema.columns
 WHERE table_name = 'Company'
   AND column_name IN ('mobile','email','address','gstin','panNumber','udyamRegNo',
                       'quotationPrefix','bankAccountName','bankName','bankBranch',
                       'bankIfsc','bankAccountNumber');
