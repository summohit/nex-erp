-- A visit location belongs to a lead contact, not a client.
--
-- 2026-09-28-visit-locations.sql linked it to Client. That was wrong twice
-- over: Project already opens against a LeadContact, so a site pointing at a
-- Client made the two inconsistent; and the Client table holds a dozen rows
-- with status LEAD, created by CRM conversion and several of them a person's
-- name rather than a company, so the picker read as a list of prospects.
-- LeadContact also carries an address, which a Client row does not in any
-- usable form.
--
-- Safe to run as written: VisitLocation was created empty in the same session
-- and nothing has linked to a client yet. The guard below refuses rather than
-- silently discarding a link if that is ever untrue.

BEGIN;

DO $$
DECLARE linked INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'VisitLocation' AND column_name = 'clientId') THEN
    SELECT count(*) INTO linked FROM "VisitLocation" WHERE "clientId" IS NOT NULL;
    IF linked > 0 THEN
      RAISE EXCEPTION 'Refusing to drop clientId: % visit location(s) are linked to a client. Re-point them at a lead contact first.', linked;
    END IF;
    ALTER TABLE "VisitLocation" DROP CONSTRAINT IF EXISTS "VisitLocation_clientId_fkey";
    ALTER TABLE "VisitLocation" DROP COLUMN "clientId";
  END IF;
END $$;

ALTER TABLE "VisitLocation"
  ADD COLUMN IF NOT EXISTS "leadContactId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE constraint_name = 'VisitLocation_leadContactId_fkey') THEN
    ALTER TABLE "VisitLocation" ADD CONSTRAINT "VisitLocation_leadContactId_fkey"
      FOREIGN KEY ("leadContactId") REFERENCES "LeadContact"("id") ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;

-- Verify: leadContactId present, clientId gone.
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name='VisitLocation' AND column_name='leadContactId') AS lead_contact_col,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name='VisitLocation' AND column_name='clientId')      AS client_col_should_be_0;
