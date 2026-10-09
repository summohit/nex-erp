-- Clock-in / clock-out geofence ranges (2026-10-09)
--
-- Office locations: within 100 m of the branch pin (was 500 m).
-- On-site (field visit) locations: within 1 km of the site pin (was 500 m).
--
-- The Prisma defaults are updated in schema.prisma; these statements move the
-- rows that already exist and are still on the old 500 m default. A custom
-- radius somebody set deliberately is left alone.

UPDATE "Branch"
SET "geofenceRadius" = 100
WHERE "geofenceRadius" = 500;

UPDATE "FieldVisitRequest"
SET "geofenceRadiusM" = 1000
WHERE "geofenceRadiusM" = 500;
