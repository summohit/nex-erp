BEGIN;

CREATE TABLE IF NOT EXISTS "VisitLocationRequest" (
  "id"                SERIAL PRIMARY KEY,
  "name"              TEXT NOT NULL,
  "address"           TEXT,
  "latitude"          DOUBLE PRECISION,
  "longitude"         DOUBLE PRECISION,
  "position"          INTEGER NOT NULL DEFAULT 0,
  "leadContactId"     INTEGER,
  "status"            TEXT NOT NULL DEFAULT 'PENDING',
  "requestedById"     INTEGER NOT NULL,
  "reviewedById"      INTEGER,
  "reviewedAt"        TIMESTAMP(3),
  "rejectionReason"   TEXT,
  "visitLocationId"   INTEGER,
  "companyId"         INTEGER NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "VisitLocationRequest_companyId_status_idx"
  ON "VisitLocationRequest" ("companyId", "status");
CREATE INDEX IF NOT EXISTS "VisitLocationRequest_requestedById_idx"
  ON "VisitLocationRequest" ("requestedById");
CREATE INDEX IF NOT EXISTS "VisitLocationRequest_leadContactId_idx"
  ON "VisitLocationRequest" ("leadContactId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'VisitLocationRequest_companyId_fkey') THEN
    ALTER TABLE "VisitLocationRequest" ADD CONSTRAINT "VisitLocationRequest_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'VisitLocationRequest_requestedById_fkey') THEN
    ALTER TABLE "VisitLocationRequest" ADD CONSTRAINT "VisitLocationRequest_requestedById_fkey"
      FOREIGN KEY ("requestedById") REFERENCES "Employee"("id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'VisitLocationRequest_reviewedById_fkey') THEN
    ALTER TABLE "VisitLocationRequest" ADD CONSTRAINT "VisitLocationRequest_reviewedById_fkey"
      FOREIGN KEY ("reviewedById") REFERENCES "Employee"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'VisitLocationRequest_leadContactId_fkey') THEN
    ALTER TABLE "VisitLocationRequest" ADD CONSTRAINT "VisitLocationRequest_leadContactId_fkey"
      FOREIGN KEY ("leadContactId") REFERENCES "LeadContact"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'VisitLocationRequest_visitLocationId_fkey') THEN
    ALTER TABLE "VisitLocationRequest" ADD CONSTRAINT "VisitLocationRequest_visitLocationId_fkey"
      FOREIGN KEY ("visitLocationId") REFERENCES "VisitLocation"("id") ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;
