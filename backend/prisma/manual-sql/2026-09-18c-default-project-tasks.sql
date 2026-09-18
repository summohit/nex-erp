-- §1 default project tasks. Additive: one new table plus its seed rows.
--
-- Generated with `prisma migrate diff` against port 5432 (the pooler on 6543
-- hangs for schema commands). Safe to re-run.

BEGIN;
-- CreateTable
CREATE TABLE "DefaultProjectTask" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DefaultProjectTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DefaultProjectTask_companyId_name_key" ON "DefaultProjectTask"("companyId", "name");

-- AddForeignKey
ALTER TABLE "DefaultProjectTask" ADD CONSTRAINT "DefaultProjectTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The six tasks, for every company that already exists. CompanySeederService
-- seeds these for new companies, but its onModuleInit is commented out to keep
-- startup fast, so it never runs for companies already on the system.
--
-- ON CONFLICT DO NOTHING against (companyId, name): re-running changes
-- nothing, and a company that has renamed or retired these keeps its own list.
INSERT INTO "DefaultProjectTask" ("name", "description", "position", "companyId", "createdAt", "updatedAt")
SELECT t.name, t.description, t.position, c.id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Company" c
CROSS JOIN (VALUES
  ('Project Planning and Management', 'Prepare and manage the overall project plan, including scope, timelines, resources, responsibilities, milestones, dependencies, and key deliverables.', 0),
  ('Project Plan Approval', 'Review the prepared project plan with the relevant stakeholders and obtain the required internal/client approval before project execution begins.', 1),
  ('Client Virtual Meeting', 'Conduct and document virtual meetings with the client to discuss project requirements, progress, planning, issues, deliverables, and next steps.', 2),
  ('Client On-Site Meeting', 'Plan and conduct on-site meetings with the client when required for project discussions, requirement gathering, implementation, inspection, review, or coordination.', 3),
  ('Project Sign-Off Documents', 'Prepare, collect, review, and maintain all required project sign-off documents, approvals, confirmations, and supporting evidence from the client.', 4),
  ('Project Sign-Off', 'Complete the final project sign-off process after all agreed deliverables are completed, reviewed, and accepted by the client, and formally close the project.', 5)
) AS t(name, description, position)
ON CONFLICT ("companyId", "name") DO NOTHING;

COMMIT;
