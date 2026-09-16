-- 2026-09-16: Projects are opened against a lead contact
--
-- The project form's Client field now lists LEAD CONTACTS rather than clients
-- (§4, "lead contacts — add as clients"): at the moment a project is created,
-- a lead contact is who the business actually knows. Choosing one resolves to
-- a Client row, reusing an existing client of the same name or creating it,
-- and Project.clientId keeps pointing there — so every client filter, column
-- and future invoice is untouched.
--
-- This column records WHICH CONTACT WAS CHOSEN, which clientId cannot answer:
-- several contacts at the same company resolve to one client, so the mapping
-- is not reversible. Without it, editing a project would show an empty Client
-- field and silently clear it on save.
--
-- SetNull, not Cascade: deleting a lead contact must not delete the project.
--
-- Re-runnable. Apply BEFORE `prisma generate`.

ALTER TABLE "Project"
  ADD COLUMN IF NOT EXISTS "leadContactId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'Project_leadContactId_fkey'
  ) THEN
    ALTER TABLE "Project"
      ADD CONSTRAINT "Project_leadContactId_fkey"
      FOREIGN KEY ("leadContactId") REFERENCES "LeadContact"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Project_leadContactId_idx" ON "Project" ("leadContactId");

-- Verify: column and constraint present; existing projects keep their client.
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'Project' AND column_name = 'leadContactId')      AS lead_contact_column,
  (SELECT count(*) FROM information_schema.table_constraints
    WHERE constraint_name = 'Project_leadContactId_fkey')                AS fkey,
  (SELECT count(*) FROM "Project" WHERE "clientId" IS NOT NULL)          AS projects_with_a_client,
  (SELECT count(*) FROM "Project" WHERE "leadContactId" IS NOT NULL)     AS projects_with_a_lead_contact;
