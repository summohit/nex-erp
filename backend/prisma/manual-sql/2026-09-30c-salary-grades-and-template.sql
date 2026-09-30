-- Salary grades, the salary template, and employee vs consultant pay type.
--
-- 1. Employee."payType": EMPLOYEE (graded, on the template) or CONSULTANT
--    (contract pay with TDS / GST, outside both). Backfilled from the TDS / GST
--    components consultants already carry -- 5 people on 2026-09-30.
-- 2. "SalaryGrade": five bands by monthly gross, per company.
-- 3. "SalaryTemplate": how a gross splits into components, per company.
--    Basic 50% of gross, HRA 40% of Basic, PF 12% of Basic (capped at 15,000),
--    ESI 0.75% up to 21,000 gross, PT 200.
--
-- Safe to run twice.

BEGIN;

-- 1. Pay type
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "payType" TEXT NOT NULL DEFAULT 'EMPLOYEE';

UPDATE "Employee" e SET "payType" = 'CONSULTANT'
WHERE EXISTS (
  SELECT 1 FROM "SalaryStructure" s
  JOIN "SalaryComponent" k ON k.id = s."componentId"
  WHERE s."employeeId" = e.id AND (k.name ILIKE 'TDS%' OR k.name ILIKE 'GST%')
);

-- 2. Grades
CREATE TABLE IF NOT EXISTS "SalaryGrade" (
  "id"        SERIAL PRIMARY KEY,
  "name"      TEXT NOT NULL,
  "label"     TEXT,
  "minGross"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "maxGross"  DOUBLE PRECISION,
  "position"  INTEGER NOT NULL DEFAULT 0,
  "companyId" INTEGER NOT NULL REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "SalaryGrade_companyId_name_key" ON "SalaryGrade"("companyId", "name");

INSERT INTO "SalaryGrade" ("name", "label", "minGross", "maxGross", "position", "companyId")
SELECT g.name, g.label, g.min, g.max, g.pos, c.id
FROM "Company" c
CROSS JOIN (VALUES
  ('G1', 'Support & trainees',      0,      15000,  1),
  ('G2', 'Junior staff',            15001,  30000,  2),
  ('G3', 'Professionals',           30001,  60000,  3),
  ('G4', 'Managers & seniors',      60001,  150000, 4),
  ('G5', 'Leadership',              150001, NULL,   5)
) AS g(name, label, min, max, pos)
ON CONFLICT ("companyId", "name") DO NOTHING;

-- 3. Template
CREATE TABLE IF NOT EXISTS "SalaryTemplate" (
  "id"              SERIAL PRIMARY KEY,
  "basicPct"        DOUBLE PRECISION NOT NULL DEFAULT 50,
  "hraPctOfBasic"   DOUBLE PRECISION NOT NULL DEFAULT 40,
  "conveyance"      DOUBLE PRECISION NOT NULL DEFAULT 1600,
  "medical"         DOUBLE PRECISION NOT NULL DEFAULT 1250,
  "pfPct"           DOUBLE PRECISION NOT NULL DEFAULT 12,
  "pfWageCap"       DOUBLE PRECISION DEFAULT 15000,
  "esiPct"          DOUBLE PRECISION NOT NULL DEFAULT 0.75,
  "esiGrossLimit"   DOUBLE PRECISION NOT NULL DEFAULT 21000,
  "professionalTax" DOUBLE PRECISION NOT NULL DEFAULT 200,
  "companyId"       INTEGER NOT NULL REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "SalaryTemplate_companyId_key" ON "SalaryTemplate"("companyId");

INSERT INTO "SalaryTemplate" ("companyId")
SELECT id FROM "Company"
ON CONFLICT ("companyId") DO NOTHING;

-- Check
SELECT "payType", count(*) FROM "Employee" GROUP BY 1;
SELECT "companyId", name, "minGross", "maxGross" FROM "SalaryGrade" ORDER BY "companyId", position;

COMMIT;
