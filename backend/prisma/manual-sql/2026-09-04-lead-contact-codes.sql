-- Human-readable references for Leads and Lead Contacts.
--   Lead        -> leadCode      e.g. L0926-001
--   LeadContact -> contactCode   e.g. LC0926-001
-- Format: prefix + MM + YY + '-' + a sequence that restarts each month, per company.
--
-- Safe to re-run. Purely additive — no existing column is altered or dropped.

-- 1. Columns (nullable: rows predating this stay valid)
ALTER TABLE "Lead"        ADD COLUMN IF NOT EXISTS "leadCode"    TEXT;
ALTER TABLE "LeadContact" ADD COLUMN IF NOT EXISTS "contactCode" TEXT;

-- 2. Backfill existing rows.
--    Numbered by createdAt within each (company, month) so the oldest record of a
--    month gets -001. Only touches rows that have no code yet, so re-running is a
--    no-op and never renumbers anything already issued.
WITH numbered AS (
  SELECT
    id,
    'L' || to_char("createdAt", 'MMYY') || '-' ||
      lpad(
        ROW_NUMBER() OVER (
          PARTITION BY "companyId", date_trunc('month', "createdAt")
          ORDER BY "createdAt", id
        )::text, 3, '0'
      ) AS code
  FROM "Lead"
  WHERE "leadCode" IS NULL
)
UPDATE "Lead" l
SET "leadCode" = n.code
FROM numbered n
WHERE l.id = n.id;

WITH numbered AS (
  SELECT
    id,
    'LC' || to_char("createdAt", 'MMYY') || '-' ||
      lpad(
        ROW_NUMBER() OVER (
          PARTITION BY "companyId", date_trunc('month', "createdAt")
          ORDER BY "createdAt", id
        )::text, 3, '0'
      ) AS code
  FROM "LeadContact"
  WHERE "contactCode" IS NULL
)
UPDATE "LeadContact" c
SET "contactCode" = n.code
FROM numbered n
WHERE c.id = n.id;

-- 3. Unique indexes.
--    Created AFTER the backfill: the app computes the next number by reading the
--    highest existing code, then relies on this constraint to reject a collision
--    from two simultaneous creates. Prisma addresses these by name, so the names
--    must match exactly.
CREATE UNIQUE INDEX IF NOT EXISTS "Lead_leadCode_key"
  ON "Lead" ("leadCode");
CREATE UNIQUE INDEX IF NOT EXISTS "LeadContact_contactCode_key"
  ON "LeadContact" ("contactCode");

-- Verify: expect no NULLs left, and a sample of the new codes.
SELECT
  (SELECT COUNT(*) FROM "Lead"        WHERE "leadCode"    IS NULL) AS leads_without_code,
  (SELECT COUNT(*) FROM "LeadContact" WHERE "contactCode" IS NULL) AS contacts_without_code;

SELECT "leadCode", title, "createdAt" FROM "Lead" ORDER BY "createdAt" DESC LIMIT 5;
SELECT "contactCode", name, "createdAt" FROM "LeadContact" ORDER BY "createdAt" DESC LIMIT 5;
