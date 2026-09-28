-- §PB10 visit locations. Additive: one new table, nothing altered.
--
-- A field visit's location is pinned on a map and its coordinates decide
-- whether somebody clocking in there counts as on site, so it cannot stay free
-- text. Branch was the only existing table carrying coordinates, but a Branch
-- is one of our own offices — the wrong thing to offer for a client visit —
-- and Client addresses carry no coordinates at all. Hence a table of its own.
--
-- clientId is nullable and SetNull: plenty of sites belong to a client, and
-- plenty (a supplier, a data centre, a site office) belong to nobody, and
-- removing a client must not take the record of where people went with it.

BEGIN;

CREATE TABLE IF NOT EXISTS "VisitLocation" (
  "id"        SERIAL PRIMARY KEY,
  "name"      TEXT NOT NULL,
  "address"   TEXT,
  "latitude"  DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "position"  INTEGER NOT NULL DEFAULT 0,
  "clientId"  INTEGER,
  "companyId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- No DB default, matching every other table here: Prisma's @updatedAt sets
  -- this from the client on every write, and a default would be drift.
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "VisitLocation_companyId_name_key"
  ON "VisitLocation" ("companyId", "name");
CREATE INDEX IF NOT EXISTS "VisitLocation_companyId_isActive_idx"
  ON "VisitLocation" ("companyId", "isActive");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE constraint_name = 'VisitLocation_companyId_fkey') THEN
    ALTER TABLE "VisitLocation" ADD CONSTRAINT "VisitLocation_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE constraint_name = 'VisitLocation_clientId_fkey') THEN
    ALTER TABLE "VisitLocation" ADD CONSTRAINT "VisitLocation_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- Which site a trip was raised against, when it was picked from the list
-- rather than typed. The location text and coordinates on the request stay
-- put: where somebody actually went is a fact about that trip, and retiring a
-- site from the picker must not erase it from trips already made.
ALTER TABLE "FieldVisitRequest"
  ADD COLUMN IF NOT EXISTS "visitLocationId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE constraint_name = 'FieldVisitRequest_visitLocationId_fkey') THEN
    ALTER TABLE "FieldVisitRequest" ADD CONSTRAINT "FieldVisitRequest_visitLocationId_fkey"
      FOREIGN KEY ("visitLocationId") REFERENCES "VisitLocation"("id") ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;

-- Verify: the table exists and is empty on a fresh install.
SELECT count(*) AS visit_locations FROM "VisitLocation";
