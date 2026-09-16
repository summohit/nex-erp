-- 2026-09-16: Delivery module — foundation
--
-- "Projects" becomes "Delivery": a section with Projects, Tasks, Timesheet,
-- Field Visits under it, rather than one flat link. Project Tickets, Expenses
-- and Project Reports join it in later phases, when the screens behind them
-- exist — a menu row pointing at a route that does not resolve is worse than
-- no row at all.
--
-- It also gives Project the fields the delivery workflow needs and that the
-- model has been doing without: an owning department, a type and a priority,
-- an hours estimate to set against logged time, a currency, and two switches
-- that later phases read — whether manual time logging is allowed, and where
-- the project sits in the closure process.
--
-- ── On statuses ──────────────────────────────────────────────────────────
-- Project already carries two: `status` (ACTIVE / ARCHIVED — purely the
-- archive lifecycle) and `workStatus` (NOT_STARTED / IN_PROGRESS / FINISHED).
-- A project that is technically finished but still waiting on an invoice is
-- neither, which is the distinction this module is built around.
--
-- Rather than add a third status column, `workStatus` takes over as THE
-- project status and its vocabulary widens to DRAFT / ACTIVE / ON_HOLD /
-- AT_RISK / COMPLETED / CLOSED / CANCELLED. It is read in exactly four places
-- (one service line, three in the projects list) and was never editable from
-- the UI, so widening it costs nothing; inventing `deliveryStatus` alongside
-- two existing status columns would have cost a great deal of confusion.
--
-- `closureStatus` is deliberately separate and NOT a finer grain of the same
-- thing: work being done and money being collected are two independent
-- tracks, and the whole point is that a project can be COMPLETED on one and
-- PAYMENT_PENDING on the other.
--
-- Re-runnable. Apply alongside `prisma db push`.

-- ── 1. Project: delivery fields ──────────────────────────────────────────
ALTER TABLE "Project"
  -- workStatus predates this module but not every install has it: the local
  -- dev database did not. Added here so the statements below can rely on it.
  ADD COLUMN IF NOT EXISTS "workStatus"             TEXT,
  ADD COLUMN IF NOT EXISTS "departmentId"           INTEGER REFERENCES "Department"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "projectType"            TEXT,
  ADD COLUMN IF NOT EXISTS "priority"               TEXT    NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN IF NOT EXISTS "estimatedHours"         DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "currency"               TEXT    NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS "budgetNotes"            TEXT,
  -- §9: controlled per project. Defaults to true because every existing
  -- project already permits manual entry — flipping that silently would
  -- strand in-flight timesheets.
  ADD COLUMN IF NOT EXISTS "allowManualTimeLogging" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "closureStatus"          TEXT    NOT NULL DEFAULT 'WORK_PENDING';

CREATE INDEX IF NOT EXISTS "Project_companyId_workStatus_idx"
  ON "Project" ("companyId", "workStatus");
CREATE INDEX IF NOT EXISTS "Project_departmentId_idx"
  ON "Project" ("departmentId");

-- ── 2. workStatus: widen the vocabulary ──────────────────────────────────
-- NOT_STARTED means "set up but not begun", which is DRAFT in the new set.
-- Rows with no workStatus at all are live projects nobody classified, so they
-- become ACTIVE rather than DRAFT — calling a running project a draft would
-- hide it behind the default Active filter on the list.
UPDATE "Project" SET "workStatus" = 'DRAFT'     WHERE "workStatus" = 'NOT_STARTED';
UPDATE "Project" SET "workStatus" = 'ACTIVE'    WHERE "workStatus" = 'IN_PROGRESS';
UPDATE "Project" SET "workStatus" = 'COMPLETED' WHERE "workStatus" = 'FINISHED';
UPDATE "Project" SET "workStatus" = 'ACTIVE'    WHERE "workStatus" IS NULL AND "status" = 'ACTIVE';

-- A project whose work is already finished is past WORK_PENDING; it is waiting
-- on sign-off. Everything else keeps the column default.
UPDATE "Project"
   SET "closureStatus" = 'SIGNOFF_PENDING'
 WHERE "workStatus" = 'COMPLETED'
   AND "closureStatus" = 'WORK_PENDING';

-- ── 3. Sidebar: Projects → Delivery ──────────────────────────────────────
-- The Projects row becomes the Delivery section header. Its own route is
-- cleared: menus.service keeps a parent only when at least one child is
-- permitted, and a parent that is both a link and a section renders as a
-- dead click target once it has children (the CRM row had the same fix).
--
-- Every statement below identifies the section by DEPTH — a row whose parent
-- is a top-level section — and not by title alone. Matching on
-- `title = 'Delivery'` also matches the *child* named Projects' sibling once
-- one exists, which on a second run turns a child into a second section and
-- duplicates the whole subtree.
UPDATE "Menu" m
   SET title = 'Delivery', route = NULL, icon = COALESCE(m.icon, 'lucideKanban')
 WHERE (m.title = 'Delivery' OR m.route = '/projects')
   AND EXISTS (SELECT 1 FROM "Menu" s WHERE s.id = m."parentId" AND s."parentId" IS NULL);

-- Children. Each points at a screen that exists today. Menu module ids are
-- derived from the route (menus.service: route.replace('/','')), so these
-- resolve to 'projects', 'tasks', 'timesheets' and 'field-visits' — all four
-- granted off the existing 'projects' permission in menus.service, exactly as
-- Field Visits already was. No new RolePermission rows are needed.
INSERT INTO "Menu" ("companyId", "parentId", title, icon, route, "displayOrder", "isActive")
SELECT NULL, d.id, c.title, NULL, c.route, c.ord, true
  FROM "Menu" d
  JOIN "Menu" s ON s.id = d."parentId" AND s."parentId" IS NULL
  CROSS JOIN (VALUES
    ('Projects',     '/projects',     1),
    ('Tasks',        '/tasks',        2),
    ('Timesheet',    '/timesheets',   3),
    ('Field Visits', '/field-visits', 4)
  ) AS c(title, route, ord)
 WHERE d.title = 'Delivery'
   AND NOT EXISTS (
     SELECT 1 FROM "Menu" e WHERE e."parentId" = d.id AND e.route = c.route
   );

-- Field Visits was a sibling of Projects at the top level. It now lives under
-- Delivery, so retire the old row rather than showing it twice. Scoped to
-- rows sitting directly under a top-level section, so the new child is safe.
UPDATE "Menu" m
   SET "isActive" = false
 WHERE m.route = '/field-visits'
   AND m."isActive"
   AND EXISTS (SELECT 1 FROM "Menu" s WHERE s.id = m."parentId" AND s."parentId" IS NULL);

-- Verify: one Delivery section with four active children; no project left on
-- a retired workStatus value; exactly one active Field Visits row.
SELECT
  (SELECT count(*) FROM "Menu" WHERE title = 'Delivery' AND "parentId" IS NOT NULL) AS delivery_sections,
  (SELECT count(*) FROM "Menu" c JOIN "Menu" d ON d.id = c."parentId"
     WHERE d.title = 'Delivery' AND c."isActive")                                   AS delivery_children,
  (SELECT count(*) FROM "Menu" WHERE route = '/field-visits' AND "isActive")        AS active_field_visit_rows,
  (SELECT count(*) FROM "Project"
     WHERE "workStatus" IN ('NOT_STARTED','IN_PROGRESS','FINISHED'))                AS stale_work_statuses,
  (SELECT count(*) FROM "Project" WHERE "workStatus" IS NULL)                       AS unclassified_projects;
