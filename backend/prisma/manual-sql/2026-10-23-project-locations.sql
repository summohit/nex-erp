-- Project locations: the cities a project works in, and sites owned by one
-- project. Additive: a new table and a nullable column.

ALTER TABLE "TaskLocation" ADD COLUMN IF NOT EXISTS "projectId" INTEGER;
CREATE INDEX IF NOT EXISTS "TaskLocation_projectId_idx" ON "TaskLocation"("projectId");

CREATE TABLE IF NOT EXISTS "ProjectLocation" (
  "id" SERIAL PRIMARY KEY,
  "projectId" INTEGER NOT NULL,
  "locationId" INTEGER NOT NULL REFERENCES "TaskLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "companyId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectLocation_projectId_locationId_key" ON "ProjectLocation"("projectId", "locationId");
CREATE INDEX IF NOT EXISTS "ProjectLocation_companyId_idx" ON "ProjectLocation"("companyId");
