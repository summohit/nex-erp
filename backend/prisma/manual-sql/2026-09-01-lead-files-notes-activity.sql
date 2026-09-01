-- ============================================================================
-- Deal Details enhancements: LeadFile, LeadNote, LeadActivity tables plus a
-- status field on LeadFollowUp.
--
-- Run in Supabase Dashboard → SQL Editor.
-- Additive and idempotent; no data is dropped.
-- ============================================================================

-- 1) Follow-up status (PENDING | COMPLETED | CANCELLED)
ALTER TABLE "LeadFollowUp"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'PENDING';

-- 2) Deal file attachments
CREATE TABLE IF NOT EXISTS "LeadFile" (
  "id"            SERIAL PRIMARY KEY,
  "leadId"        INTEGER NOT NULL,
  "fileName"      TEXT    NOT NULL,
  "fileUrl"       TEXT    NOT NULL,
  "fileType"      TEXT,
  "fileSize"      INTEGER,
  "uploadedById"  INTEGER,
  "companyId"     INTEGER NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadFile_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeadFile_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "LeadFile_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 3) Deal notes
CREATE TABLE IF NOT EXISTS "LeadNote" (
  "id"           SERIAL PRIMARY KEY,
  "leadId"       INTEGER NOT NULL,
  "content"      TEXT    NOT NULL,
  "createdById"  INTEGER,
  "companyId"    INTEGER NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeadNote_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeadNote_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "LeadNote_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 4) Deal activity / history timeline
CREATE TABLE IF NOT EXISTS "LeadActivity" (
  "id"          SERIAL PRIMARY KEY,
  "leadId"      INTEGER NOT NULL,
  "action"      TEXT    NOT NULL,
  "description" TEXT,
  "actorId"     INTEGER,
  "metadata"    JSONB,
  "companyId"   INTEGER NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadActivity_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeadActivity_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "LeadActivity_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 5) Lead contact notes (standalone notes on the Lead Contact Profile)
CREATE TABLE IF NOT EXISTS "LeadContactNote" (
  "id"           SERIAL PRIMARY KEY,
  "contactId"    INTEGER NOT NULL,
  "title"        TEXT    NOT NULL,
  "type"         TEXT    NOT NULL DEFAULT 'GENERAL',
  "content"      TEXT    NOT NULL,
  "createdById"  INTEGER,
  "companyId"    INTEGER NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeadContactNote_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "LeadContact"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeadContactNote_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "LeadContactNote_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Indices for fast per-deal lookups
CREATE INDEX IF NOT EXISTS "LeadFile_leadId_idx"     ON "LeadFile"("leadId");
CREATE INDEX IF NOT EXISTS "LeadNote_leadId_idx"     ON "LeadNote"("leadId");
CREATE INDEX IF NOT EXISTS "LeadActivity_leadId_idx" ON "LeadActivity"("leadId");
CREATE INDEX IF NOT EXISTS "LeadContactNote_contactId_idx" ON "LeadContactNote"("contactId");

-- Verify tables exist
-- \dt "LeadFile" "LeadNote" "LeadActivity"
