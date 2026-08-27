-- ============================================================================
-- Offer letter support + backfill of JobApplication columns that were added to
-- schema.prisma but never reached the database.
--
-- Run this in the Supabase Dashboard → SQL Editor.
-- `prisma db push` cannot apply DDL over the transaction pooler (port 6543),
-- which is why these are applied by hand.
--
-- Every statement is additive and idempotent (IF NOT EXISTS). No data is
-- dropped, rewritten, or backfilled — all new columns are nullable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. JobApplication: columns already declared in schema.prisma but missing in
--    the DB. These are what the AI-scoring cron currently crashes on
--    (P2022: "The column JobApplication.dateOfBirth does not exist").
-- ---------------------------------------------------------------------------
ALTER TABLE "JobApplication"
  ADD COLUMN IF NOT EXISTS "dateOfBirth"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "gender"          TEXT,
  ADD COLUMN IF NOT EXISTS "currentLocation" TEXT,
  ADD COLUMN IF NOT EXISTS "currentCtc"      DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "expectedCtc"     DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "source"          TEXT,
  ADD COLUMN IF NOT EXISTS "coverLetter"     TEXT,
  ADD COLUMN IF NOT EXISTS "photoUrl"        TEXT;

-- ---------------------------------------------------------------------------
-- 2. JobApplication: new fields the offer letter needs per candidate.
--    "address"     -> full postal address block printed under the date
--    "joiningDate" -> the "You are expected to join on <date>" line
-- ---------------------------------------------------------------------------
ALTER TABLE "JobApplication"
  ADD COLUMN IF NOT EXISTS "address"     TEXT,
  ADD COLUMN IF NOT EXISTS "joiningDate" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- 3. SystemSetting: one JSONB column holding company legal identity, statutory
--    policy constants and salary-structure ratios. Kept as JSON deliberately so
--    adding a future clause needs no further DDL against production.
--    Shape is documented by the OfferLetterConfig interface in
--    backend/src/recruitment/offer-letters.service.ts
-- ---------------------------------------------------------------------------
ALTER TABLE "SystemSetting"
  ADD COLUMN IF NOT EXISTS "offerLetterConfig" JSONB;

-- ---------------------------------------------------------------------------
-- 4. OPTIONAL — seed CES Tech's letterhead/policy values for company 1.
--    Skip or edit if these values differ. Safe to re-run.
-- ---------------------------------------------------------------------------
-- INSERT INTO "SystemSetting" ("companyId", "offerLetterConfig", "createdAt", "updatedAt")
-- VALUES (1, '{
--   "legalEntityName": "N-Expert Solutions Private Limited",
--   "cin": "U72300DL2015PTC278867",
--   "tagline": "Beyond IT Services, We Deliver Solutions",
--   "officeAddress": "Assotech Business Cresterra, Tower-2, 9th Floor, Unit No. #901-902, Sector-135, Noida 201305, Uttar Pradesh, India",
--   "contactPhone": "+91-9891835387 / +0120-6911161",
--   "contactEmail": "info@ces-pl.com",
--   "website": "www.ces-pl.com",
--   "reportingTime": "9:30 AM",
--   "probationMonths": 6,
--   "noticePeriodMonths": 3,
--   "terminationNoticeMonths": 1,
--   "bondMonths": 24,
--   "liquidatedDamages": 500000,
--   "casualLeaveDays": 10,
--   "sickLeaveDays": 8,
--   "workingHoursText": "9:30 A.M. to 6:30 P.M., Monday through Saturday",
--   "monthlyWorkHours": 208,
--   "healthCoverAmount": 300000,
--   "basicPercentOfCtc": 50,
--   "hraPercentOfBasic": 40,
--   "travellingAllowance": 1600,
--   "medicalAllowance": 1250,
--   "pfBase": 15000,
--   "pfPercent": 12,
--   "employerEsicPercent": 3.25,
--   "employeeEsicPercent": 0.75
-- }'::jsonb, NOW(), NOW())
-- ON CONFLICT ("companyId") DO UPDATE
--   SET "offerLetterConfig" = EXCLUDED."offerLetterConfig", "updatedAt" = NOW();

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name IN ('JobApplication','SystemSetting')
--   AND column_name IN ('dateOfBirth','gender','currentLocation','currentCtc',
--                       'expectedCtc','source','coverLetter','photoUrl',
--                       'address','joiningDate','offerLetterConfig')
-- ORDER BY table_name, column_name;
