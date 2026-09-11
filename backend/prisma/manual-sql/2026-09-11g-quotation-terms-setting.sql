-- 2026-09-11: Default quotation terms move to System Settings
--
-- The terms pre-filled into a new proposal were a hardcoded constant in
-- lead-profile.component.ts (PROPOSAL_DEFAULT_TERMS), so changing them meant a
-- code change and a deploy. They are now a company setting.
--
-- Null is meaningful: it falls back to the same built-in text every quotation
-- has used so far, so behaviour is unchanged until somebody edits the setting.
-- The terms stay editable on each individual quote — this is the starting
-- point, not a policy that overrides what was actually agreed.
--
-- Additive and re-runnable.

ALTER TABLE "SystemSetting"
  ADD COLUMN IF NOT EXISTS "quotationTerms" TEXT;

-- Verify: should return 1.
SELECT count(*) AS quotation_terms_column
  FROM information_schema.columns
 WHERE table_name = 'SystemSetting' AND column_name = 'quotationTerms';
