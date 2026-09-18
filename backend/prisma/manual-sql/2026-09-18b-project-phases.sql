-- §8 project phases. Additive: one nullable column on Issue and one new table.
--
-- Generated with `prisma migrate diff`, which works here only against port
-- 5432 -- through the pgbouncer pooler on 6543 it hangs rather than failing.
--
-- Existing tasks get phaseId NULL, meaning "no phase recorded", which is the
-- honest state for every task created before phases existed.

BEGIN;
-- AlterTable
ALTER TABLE "Issue" ADD COLUMN     "phaseId" INTEGER;

-- CreateTable
CREATE TABLE "ProjectPhase" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectPhase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPhase_companyId_name_key" ON "ProjectPhase"("companyId", "name");

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPhase" ADD CONSTRAINT "ProjectPhase_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;

-- Backfill the five default phases for companies that already exist.
--
-- CompanySeederService seeds these, but its onModuleInit is deliberately
-- commented out to keep startup fast, so it only ever runs for a company
-- created after this ships. Without this insert, every existing company would
-- open the phase picker to an empty list.
--
-- ON CONFLICT DO NOTHING against the (companyId, name) unique, so this is safe
-- to re-run and never disturbs a company that has renamed or retired them.
INSERT INTO "ProjectPhase" ("name", "position", "companyId", "createdAt", "updatedAt")
SELECT p.name, p.position, c.id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Company" c
CROSS JOIN (VALUES
  ('Phase 1', 0), ('Phase 2', 1), ('Phase 3', 2), ('Phase 4', 3), ('Phase 5', 4)
) AS p(name, position)
ON CONFLICT ("companyId", "name") DO NOTHING;
