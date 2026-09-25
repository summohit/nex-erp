-- 2026-09-24a: Field Visit Requests — bring every environment level
--
-- The six FieldVisitRequest* / FieldVisitAttendance tables already exist on the
-- Supabase database, with data in them, but no migration in this repo ever
-- created them: commit 335c0200's predecessor only back-described what was
-- already there into schema.prisma. A fresh checkout pointed at an empty
-- database therefore gets a Prisma client whose models have no tables behind
-- them, and the local erp_db (45 tables) is exactly in that state.
--
-- So this file creates them the way they exist in production — same columns,
-- same defaults, same indexes, same delete rules — and is written to be a
-- no-op where they are already present. Verified column-by-column against the
-- live schema on 2026-09-24; the only deliberate difference is
-- "geofenceRadiusM" at the end, which is new.
--
-- Apply with the DIRECT connection (port 5432), not the pooler on 6543 — the
-- pooler cannot run DDL. deploy.sh already does that rewrite for migrations.

-- ─── The trip itself ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "FieldVisitRequest" (
  id                SERIAL PRIMARY KEY,
  "requestNumber"   TEXT NOT NULL,
  "projectId"       INTEGER NOT NULL,
  "companyId"       INTEGER NOT NULL,
  "raisedById"      INTEGER NOT NULL,
  location          TEXT NOT NULL,
  latitude          DOUBLE PRECISION NOT NULL,
  longitude         DOUBLE PRECISION NOT NULL,
  "startDate"       TIMESTAMP(3) NOT NULL,
  "endDate"         TIMESTAMP(3) NOT NULL,
  "visitDays"       INTEGER NOT NULL,
  "startTime"       TEXT NOT NULL,
  "endTime"         TEXT NOT NULL,
  remarks           TEXT,
  status            TEXT NOT NULL DEFAULT 'DRAFT',
  "reviewedById"    INTEGER,
  "reviewedAt"      TIMESTAMP(3),
  "rejectionReason" TEXT,
  "submittedAt"     TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "FieldVisitRequest_companyId_requestNumber_key"
  ON "FieldVisitRequest" ("companyId", "requestNumber");
CREATE INDEX IF NOT EXISTS "FieldVisitRequest_companyId_status_idx"
  ON "FieldVisitRequest" ("companyId", status);
CREATE INDEX IF NOT EXISTS "FieldVisitRequest_projectId_idx"
  ON "FieldVisitRequest" ("projectId");

-- ─── Who goes, what for, what was attached, and who changed it ───────────────

CREATE TABLE IF NOT EXISTS "FieldVisitRequestMember" (
  id           SERIAL PRIMARY KEY,
  "requestId"  INTEGER NOT NULL,
  "employeeId" INTEGER NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "FieldVisitRequestMember_requestId_employeeId_key"
  ON "FieldVisitRequestMember" ("requestId", "employeeId");
CREATE INDEX IF NOT EXISTS "FieldVisitRequestMember_employeeId_idx"
  ON "FieldVisitRequestMember" ("employeeId");

CREATE TABLE IF NOT EXISTS "FieldVisitRequestTask" (
  id           SERIAL PRIMARY KEY,
  "requestId"  INTEGER NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT,
  position     INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "FieldVisitRequestTask_requestId_idx"
  ON "FieldVisitRequestTask" ("requestId");

CREATE TABLE IF NOT EXISTS "FieldVisitRequestAttachment" (
  id             SERIAL PRIMARY KEY,
  "requestId"    INTEGER NOT NULL,
  "fileName"     TEXT NOT NULL,
  "fileUrl"      TEXT NOT NULL,
  "fileSize"     INTEGER,
  "uploadedById" INTEGER NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "FieldVisitRequestAttachment_requestId_idx"
  ON "FieldVisitRequestAttachment" ("requestId");

CREATE TABLE IF NOT EXISTS "FieldVisitRequestActivity" (
  id          SERIAL PRIMARY KEY,
  "requestId" INTEGER NOT NULL,
  action      TEXT NOT NULL,
  detail      TEXT,
  "oldValue"  TEXT,
  "newValue"  TEXT,
  "actorId"   INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "FieldVisitRequestActivity_requestId_createdAt_idx"
  ON "FieldVisitRequestActivity" ("requestId", "createdAt");

-- ─── One person, one day ─────────────────────────────────────────────────────
--
-- Distances are kept in km as recorded rather than reduced to a pass/fail, so
-- a marginal clock-in stays arguable after the fact.

CREATE TABLE IF NOT EXISTS "FieldVisitAttendance" (
  id                   SERIAL PRIMARY KEY,
  "requestId"          INTEGER NOT NULL,
  "employeeId"         INTEGER NOT NULL,
  "companyId"          INTEGER NOT NULL,
  "visitDate"          TIMESTAMP(3) NOT NULL,
  "isHoliday"          BOOLEAN NOT NULL DEFAULT false,
  status               TEXT NOT NULL DEFAULT 'SCHEDULED',
  "clockInTime"        TIMESTAMP(3),
  "clockInLat"         DOUBLE PRECISION,
  "clockInLng"         DOUBLE PRECISION,
  "clockInDistanceKm"  DOUBLE PRECISION,
  "clockOutTime"       TIMESTAMP(3),
  "clockOutLat"        DOUBLE PRECISION,
  "clockOutLng"        DOUBLE PRECISION,
  "clockOutDistanceKm" DOUBLE PRECISION,
  "fieldVisitId"       INTEGER,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "FieldVisitAttendance_requestId_employeeId_visitDate_key"
  ON "FieldVisitAttendance" ("requestId", "employeeId", "visitDate");
CREATE INDEX IF NOT EXISTS "FieldVisitAttendance_companyId_visitDate_idx"
  ON "FieldVisitAttendance" ("companyId", "visitDate");
CREATE INDEX IF NOT EXISTS "FieldVisitAttendance_employeeId_visitDate_idx"
  ON "FieldVisitAttendance" ("employeeId", "visitDate");

-- ─── Back-references from the tracked visit and the task board ───────────────
--
-- Both nullable: a visit somebody started directly, and a task raised by hand,
-- are how they all began and must keep working.

ALTER TABLE "FieldVisit" ADD COLUMN IF NOT EXISTS "fieldVisitRequestId" INTEGER;
ALTER TABLE "Issue"      ADD COLUMN IF NOT EXISTS "fieldVisitRequestId" INTEGER;

-- ─── New: the geofence radius lives on the request ───────────────────────────
--
-- The rule is "within 500 metres of the approved site". Kept as data on the
-- row rather than a constant in the clock-in code, because the radius a visit
-- was judged against has to stay readable afterwards — if the company ever
-- changes the number, days already clocked must keep the radius they were
-- actually held to. The UI ships fixed at 500.

ALTER TABLE "FieldVisitRequest"
  ADD COLUMN IF NOT EXISTS "geofenceRadiusM" INTEGER NOT NULL DEFAULT 500;

-- ─── Delete rules ────────────────────────────────────────────────────────────
--
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so each one is guarded by name
-- — the names Prisma itself would pick, so a later `prisma db push` sees them
-- as already satisfied rather than dropping and recreating them.
--
-- The rules are not uniform on purpose. A request follows its project and its
-- company down (CASCADE), but the employee who raised it or uploaded a file
-- cannot be deleted out from under it (RESTRICT) — that would silently erase
-- who asked for a trip that happened. Reviewers and the tracked visit fall
-- away to NULL: the decision and the day survive the record of who made it.

DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN
    SELECT * FROM (VALUES
      ('FieldVisitRequest',           'FieldVisitRequest_projectId_fkey',            'projectId',      'Project',           'CASCADE'),
      ('FieldVisitRequest',           'FieldVisitRequest_companyId_fkey',            'companyId',      'Company',           'CASCADE'),
      ('FieldVisitRequest',           'FieldVisitRequest_raisedById_fkey',           'raisedById',     'Employee',          'RESTRICT'),
      ('FieldVisitRequest',           'FieldVisitRequest_reviewedById_fkey',         'reviewedById',   'Employee',          'SET NULL'),
      ('FieldVisitRequestMember',     'FieldVisitRequestMember_requestId_fkey',      'requestId',      'FieldVisitRequest', 'CASCADE'),
      ('FieldVisitRequestMember',     'FieldVisitRequestMember_employeeId_fkey',     'employeeId',     'Employee',          'CASCADE'),
      ('FieldVisitRequestTask',       'FieldVisitRequestTask_requestId_fkey',        'requestId',      'FieldVisitRequest', 'CASCADE'),
      ('FieldVisitRequestAttachment', 'FieldVisitRequestAttachment_requestId_fkey',  'requestId',      'FieldVisitRequest', 'CASCADE'),
      ('FieldVisitRequestAttachment', 'FieldVisitRequestAttachment_uploadedById_fkey','uploadedById',  'Employee',          'RESTRICT'),
      ('FieldVisitRequestActivity',   'FieldVisitRequestActivity_requestId_fkey',    'requestId',      'FieldVisitRequest', 'CASCADE'),
      ('FieldVisitRequestActivity',   'FieldVisitRequestActivity_actorId_fkey',      'actorId',        'Employee',          'CASCADE'),
      ('FieldVisitAttendance',        'FieldVisitAttendance_requestId_fkey',         'requestId',      'FieldVisitRequest', 'CASCADE'),
      ('FieldVisitAttendance',        'FieldVisitAttendance_employeeId_fkey',        'employeeId',     'Employee',          'CASCADE'),
      ('FieldVisitAttendance',        'FieldVisitAttendance_companyId_fkey',         'companyId',      'Company',           'CASCADE'),
      ('FieldVisitAttendance',        'FieldVisitAttendance_fieldVisitId_fkey',      'fieldVisitId',   'FieldVisit',        'SET NULL'),
      ('FieldVisit',                  'FieldVisit_fieldVisitRequestId_fkey',         'fieldVisitRequestId', 'FieldVisitRequest', 'SET NULL'),
      ('Issue',                       'Issue_fieldVisitRequestId_fkey',              'fieldVisitRequestId', 'FieldVisitRequest', 'SET NULL')
    ) AS t(child, name, col, parent, on_delete)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.name) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON UPDATE CASCADE ON DELETE %s',
        fk.child, fk.name, fk.col, fk.parent, fk.on_delete
      );
    END IF;
  END LOOP;
END $$;
