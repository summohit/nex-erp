-- 2026-09-16: Tasks that are not project cards
--
-- Work is raised in three shapes — against a project, against a deal, or
-- against nothing at all — and until now only the first had a home. `Issue` is
-- already the rich model (comments, checklists, attachments, labels, multiple
-- members, time logs); what it lacked was somewhere to put the other two.
--
-- The alternative was making Issue.projectId nullable. That was rejected: seven
-- separate code paths assume a project — key generation, board column
-- assignment, status-from-column, the review flow, ProjectMember inserts,
-- project-scoped labels, and every route nested under projects/:projectId — and
-- each would have grown a null branch in files nobody wants to touch. Instead
-- each company gets ONE hidden "General" project. Every one of those paths then
-- works unchanged, and a general task gets a key, a column and the existing
-- detail screen for free.
--
-- The cost is that the General project must never be shown to a human. Anything
-- listing projects filters `isSystem = false`.
--
-- Re-runnable. Apply alongside `prisma db push`.

-- ── 1. Columns ───────────────────────────────────────────────────────────
ALTER TABLE "Project"
  ADD COLUMN IF NOT EXISTS "isSystem" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "issueSeq" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Department"
  ADD COLUMN IF NOT EXISTS "canCreateTasks" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Issue"
  ADD COLUMN IF NOT EXISTS "leadId"     INTEGER,
  ADD COLUMN IF NOT EXISTS "taskTypeId" INTEGER;

-- ── 2. Task types, as master data rather than a hardcoded list ───────────
CREATE TABLE IF NOT EXISTS "TaskType" (
  "id"        SERIAL PRIMARY KEY,
  "name"      TEXT NOT NULL,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "position"  INTEGER NOT NULL DEFAULT 0,
  "companyId" INTEGER NOT NULL REFERENCES "Company"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "TaskType_companyId_name_key"
  ON "TaskType" ("companyId", "name");

-- The vocabulary people are already typing into PreSalesTask.taskType freehand.
INSERT INTO "TaskType" ("name", "position", "companyId")
SELECT t.name, t.position, c.id
  FROM "Company" c
  CROSS JOIN (VALUES
    ('Call', 0), ('Meeting', 1), ('Demo', 2), ('Site Visit', 3),
    ('Documentation', 4), ('Development', 5), ('POC', 6),
    ('Follow-up', 7), ('Other', 8)
  ) AS t(name, position)
 WHERE NOT EXISTS (
   SELECT 1 FROM "TaskType" e WHERE e."companyId" = c.id AND e.name = t.name
 );

-- ── 3. Dependencies. A join table, because "previous task" is often several ──
CREATE TABLE IF NOT EXISTS "IssueDependency" (
  "id"               SERIAL PRIMARY KEY,
  "issueId"          INTEGER NOT NULL REFERENCES "Issue"("id") ON DELETE CASCADE,
  "dependsOnIssueId" INTEGER NOT NULL REFERENCES "Issue"("id") ON DELETE CASCADE,
  "type"             TEXT NOT NULL DEFAULT 'BLOCKS',
  "companyId"        INTEGER NOT NULL,
  "createdById"      INTEGER,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "IssueDependency_issueId_dependsOnIssueId_key"
  ON "IssueDependency" ("issueId", "dependsOnIssueId");
CREATE INDEX IF NOT EXISTS "IssueDependency_dependsOnIssueId_idx"
  ON "IssueDependency" ("dependsOnIssueId");

-- ── 4. Who may raise a task ──────────────────────────────────────────────
-- Pre-ticked for the departments that plainly sell. This company has "Sales",
-- "Field Sales" and "Sales & Marketing" as three separate rows, which is
-- exactly why this is a flag and not a name comparison in code. Adjust in
-- Master Data afterwards rather than editing this file.
UPDATE "Department"
   SET "canCreateTasks" = true
 WHERE "canCreateTasks" = false
   AND name ~* '(^|[^a-z])sales';

-- ── 5. The hidden General project, one per company ───────────────────────
-- key 'GEN' is per-company, matching Project's existing per-company key rule.
INSERT INTO "Project" ("name", "key", "description", "isSystem", "status", "companyId", "createdAt", "updatedAt")
SELECT 'General', 'GEN',
       'Tasks that do not belong to a project. Hidden from project lists.',
       true, 'ACTIVE', c.id, NOW(), NOW()
  FROM "Company" c
 WHERE NOT EXISTS (
   SELECT 1 FROM "Project" p WHERE p."companyId" = c.id AND p."isSystem" = true
 );

INSERT INTO "Board" ("name", "projectId", "createdAt")
SELECT 'Main Board', p.id, NOW()
  FROM "Project" p
 WHERE p."isSystem" = true
   AND NOT EXISTS (SELECT 1 FROM "Board" b WHERE b."projectId" = p.id);

INSERT INTO "BoardColumn" ("name", "color", "position", "isSystem", "type", "boardId")
SELECT col.name, col.color, col.position, true, col.type, b.id
  FROM "Board" b
  JOIN "Project" p ON p.id = b."projectId" AND p."isSystem" = true
  CROSS JOIN (VALUES
    ('To Do',       '#6b7280', 0, 'TODO'),
    ('In Progress', '#3b82f6', 1, 'IN_PROGRESS'),
    ('In Review',   '#8b5cf6', 2, 'REVIEW'),
    ('Done',        '#22c55e', 3, 'DONE'),
    ('Archived',    '#9ca3af', 4, 'DONE')
  ) AS col(name, color, position, type)
 WHERE NOT EXISTS (
   SELECT 1 FROM "BoardColumn" bc WHERE bc."boardId" = b.id AND bc.position = col.position
 );

-- ── 6. Backfill the key sequence ─────────────────────────────────────────
-- Existing keys look like "NEX-12". Take the highest suffix per project so the
-- next allocation continues the series rather than colliding with it.
UPDATE "Project" p
   SET "issueSeq" = COALESCE(m.max_suffix, 0)
  FROM (
    SELECT "projectId",
           MAX(NULLIF(regexp_replace(key, '^.*-', ''), '')::INTEGER) AS max_suffix
      FROM "Issue"
     WHERE key ~ '-[0-9]+$'
     GROUP BY "projectId"
  ) m
 WHERE m."projectId" = p.id
   AND p."issueSeq" < COALESCE(m.max_suffix, 0);

-- ── 7. Indexes for the My Tasks query ────────────────────────────────────
-- IssueMember's PK is (issueId, employeeId), so "every issue this person is on"
-- had no usable index and scanned the table. That is the hottest new query.
CREATE INDEX IF NOT EXISTS "IssueMember_employeeId_idx"      ON "IssueMember" ("employeeId");
CREATE INDEX IF NOT EXISTS "Issue_companyId_assigneeId_isArchived_idx"
  ON "Issue" ("companyId", "assigneeId", "isArchived");
CREATE INDEX IF NOT EXISTS "Issue_companyId_dueDate_idx"     ON "Issue" ("companyId", "dueDate");

-- Verify: one General project per company, each with 5 columns; task types
-- seeded; no company left without a task-creating department.
SELECT
  (SELECT count(*) FROM "Company")                                        AS companies,
  (SELECT count(*) FROM "Project" WHERE "isSystem")                       AS general_projects,
  (SELECT count(*) FROM "BoardColumn" bc
     JOIN "Board" b ON b.id = bc."boardId"
     JOIN "Project" p ON p.id = b."projectId" AND p."isSystem")           AS general_columns,
  (SELECT count(*) FROM "TaskType")                                       AS task_types,
  (SELECT count(*) FROM "Department" WHERE "canCreateTasks")              AS task_creating_depts,
  (SELECT count(*) FROM "Issue" WHERE key ~ '-[0-9]+$'
     AND (regexp_replace(key, '^.*-', ''))::INTEGER >
         (SELECT "issueSeq" FROM "Project" WHERE id = "Issue"."projectId")) AS keys_ahead_of_seq;
