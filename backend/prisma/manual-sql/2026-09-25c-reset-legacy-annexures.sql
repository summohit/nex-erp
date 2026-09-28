-- Put annexures that only ever held the OLD default structure back on the
-- company's standard one.
--
-- The Compensation Annexure used to seed its components from payrollSettings
-- while the offer letter derived its table from offerLetterConfig — two models
-- for one salary, so the same candidate showed a different Employer PF
-- depending on which document you opened. They now share one definition.
--
-- A saved structure always wins over the company standard, by design: once a
-- recruiter has tailored a candidate's CTC, a later change to the standard must
-- not silently rewrite an offer already under discussion. That also means a
-- structure saved before this change stays on the old model forever unless it
-- is cleared.
--
-- Cleared here ONLY where the saved components are exactly the old default set
-- and nothing else — {basic, gratuity, hra, pf, special}. Anything a recruiter
-- actually shaped (a different component list, an added or removed row) is
-- left untouched, because that is a decision about a real offer and not ours
-- to undo. Clearing is not data loss: the annexure regenerates from the
-- company structure, and already-issued PDFs are unaffected — a letter only
-- changes if somebody regenerates it.
--
-- Idempotent: re-running matches nothing once the rows are null.

BEGIN;

UPDATE "JobApplication"
   SET "compensationStructure" = NULL
 WHERE "compensationStructure" IS NOT NULL
   AND (
     SELECT array_agg(c->>'id' ORDER BY c->>'id')
       FROM jsonb_array_elements(("compensationStructure"->'components')::jsonb) c
   ) = ARRAY['basic','gratuity','hra','pf','special'];

COMMIT;

-- Verify: must return 0.
SELECT count(*) AS legacy_structures_remaining
  FROM "JobApplication"
 WHERE "compensationStructure" IS NOT NULL
   AND (
     SELECT array_agg(c->>'id' ORDER BY c->>'id')
       FROM jsonb_array_elements(("compensationStructure"->'components')::jsonb) c
   ) = ARRAY['basic','gratuity','hra','pf','special'];
