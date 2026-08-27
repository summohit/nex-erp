-- ============================================================================
-- E-signature support for offer letters (DocuSign-style signing flow).
--
-- Run in Supabase Dashboard → SQL Editor.
-- Additive and idempotent; all columns nullable. No data is dropped.
-- ============================================================================

ALTER TABLE "OfferLetter"
  -- The adopted signature itself, stored as a data: URI so it can be embedded
  -- directly into the countersigned PDF without a second network fetch.
  ADD COLUMN IF NOT EXISTS "signatureImage"  TEXT,
  -- How the signature was produced: DRAWN | TYPED | UPLOADED
  ADD COLUMN IF NOT EXISTS "signatureType"   TEXT,
  -- Optional initials block, for multi-field documents.
  ADD COLUMN IF NOT EXISTS "initialsImage"   TEXT,

  -- Audit trail. DocuSign-style certificates report each of these separately,
  -- so they are tracked as distinct timestamps rather than one "opened" flag.
  ADD COLUMN IF NOT EXISTS "unlockedAt"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "viewedAt"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "unlockAttempts"  INTEGER DEFAULT 0;

-- Verify (expect 6 rows)
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'OfferLetter'
--   AND column_name IN ('signatureImage','signatureType','initialsImage',
--                       'unlockedAt','viewedAt','unlockAttempts')
-- ORDER BY column_name;
