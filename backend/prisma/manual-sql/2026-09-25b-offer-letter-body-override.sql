-- Per-candidate offer letter text.
--
-- The offer letter has only ever rendered from one company-wide LetterTemplate,
-- so there was no way to change a clause for a single candidate. This holds the
-- edited body for that one person; null means "render from the template", which
-- stays the normal case.
--
-- Additive and nullable, so every existing application keeps rendering exactly
-- as it does today.

ALTER TABLE "JobApplication"
  ADD COLUMN IF NOT EXISTS "offerLetterBody" TEXT;
