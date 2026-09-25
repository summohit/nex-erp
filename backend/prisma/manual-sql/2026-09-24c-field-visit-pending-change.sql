-- 2026-09-24c: a proposed change to an approved field visit
--
-- §10: once a trip is approved, the people, the dates, the site and the tasks
-- cannot simply be edited — changing them is a request of its own, and it goes
-- back to whoever could approve the trip.
--
-- The proposal is held rather than applied. The trip keeps running while it is
-- reviewed, and every clock-in is measured against the coordinates and radius
-- on this row, so writing a proposed site into them would move the geofence
-- under people already standing at the approved one.
--
-- Apply with the DIRECT connection (port 5432); the pooler on 6543 cannot run
-- DDL. Idempotent — safe to re-run.

ALTER TABLE "FieldVisitRequest"
  ADD COLUMN IF NOT EXISTS "pendingChange" JSONB,
  ADD COLUMN IF NOT EXISTS "pendingChangeAt" TIMESTAMP(3);

-- The approver's queue is "trips with a change waiting", which is a small
-- slice of a table that is mostly nulls here.
CREATE INDEX IF NOT EXISTS "FieldVisitRequest_pendingChangeAt_idx"
  ON "FieldVisitRequest" ("companyId", "pendingChangeAt")
  WHERE "pendingChangeAt" IS NOT NULL;
