-- ============================================================================
-- Lead Form Builder: LeadForm + LeadFormField tables and Lead.leadFormId column.
--
-- Run this in the Supabase Dashboard → SQL Editor.
-- Every statement is additive and idempotent (IF NOT EXISTS). No data is dropped.
-- ============================================================================

-- 1) Link leads back to the form that generated them
ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "leadFormId" INTEGER;

-- 2) Lead forms (public capture forms configured by admins)
CREATE TABLE IF NOT EXISTS "LeadForm" (
  "id"              SERIAL PRIMARY KEY,
  "formKey"         TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "description"     TEXT,
  "status"          TEXT NOT NULL DEFAULT 'ACTIVE',
  "successMessage"  TEXT NOT NULL DEFAULT 'Thank you! Your enquiry has been received.',
  "redirectUrl"     TEXT,
  "captchaEnabled"  BOOLEAN NOT NULL DEFAULT FALSE,
  "source"          TEXT NOT NULL DEFAULT 'Lead Form',
  "productOptions"  JSONB,
  "createdById"     INTEGER,
  "companyId"       INTEGER NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeadForm_formKey_key"
    UNIQUE ("formKey"),
  CONSTRAINT "LeadForm_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "LeadForm_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 3) Field configuration per form
CREATE TABLE IF NOT EXISTS "LeadFormField" (
  "id"        SERIAL PRIMARY KEY,
  "formId"    INTEGER NOT NULL,
  "fieldKey"  TEXT NOT NULL,
  "label"     TEXT NOT NULL,
  "type"      TEXT NOT NULL,
  "enabled"   BOOLEAN NOT NULL DEFAULT TRUE,
  "required"  BOOLEAN NOT NULL DEFAULT FALSE,
  "isName"    BOOLEAN NOT NULL DEFAULT FALSE,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "options"   JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeadFormField_formId_fkey"
    FOREIGN KEY ("formId") REFERENCES "LeadForm"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 4) Lead -> LeadForm link (FK added after both tables exist)
ALTER TABLE "Lead"
  ADD CONSTRAINT "Lead_leadFormId_fkey"
  FOREIGN KEY ("leadFormId") REFERENCES "LeadForm"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Indices for fast lookups
CREATE INDEX IF NOT EXISTS "LeadForm_companyId_idx"    ON "LeadForm"("companyId");
CREATE INDEX IF NOT EXISTS "LeadFormField_formId_idx"  ON "LeadFormField"("formId");
CREATE INDEX IF NOT EXISTS "Lead_leadFormId_idx"       ON "Lead"("leadFormId");
