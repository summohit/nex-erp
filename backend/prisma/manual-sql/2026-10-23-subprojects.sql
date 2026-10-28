-- Subprojects: a project may sit under one parent project (one level).
-- Additive and re-runnable: three columns and an index; no existing project
-- changes. budgetMode defaults to SEPARATE, which is how every project behaves today.

ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "parentId" INTEGER;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "subCode" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "budgetMode" TEXT NOT NULL DEFAULT 'SEPARATE';

DO $$ BEGIN
  ALTER TABLE "Project" ADD CONSTRAINT "Project_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "Project_parentId_idx" ON "Project" ("parentId");
