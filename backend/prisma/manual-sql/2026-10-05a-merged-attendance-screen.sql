-- Merge "My Attendance" and "All People Attendance" into one Attendance screen.
--
-- The Attendance tab is now role-aware: Super Admin and HR are sent to the
-- company-wide grid (/attendance/all), everyone else lands on their own
-- attendance and never sees another person's record. That is done in
-- attendance-landing.guard.ts on the frontend; this migration fixes the two
-- things it cannot do on its own.
--
-- 1. HR needs the 'attendance/all' module in the permission matrix, or
--    permissionGuard sends them off their own tab. Seeded rather than
--    hardcoded so the matrix stays the source of truth and an administrator
--    can still take it away again from the Permissions screen.
-- 2. The separate "All People Attendance" menu row is deactivated, since the
--    Attendance tab is that page now. The /attendance/all route stays: the
--    redirect target, and the other pages guarded on the same module
--    (Shift Attendance, Clock-out Approvals) still use it.
--
-- Guarded so it is safe to re-run.

-- ── 1. HR may see company-wide attendance ───────────────────────────────────
-- Covers every company, including ones created later only via the app's own
-- onModuleInit path, which this file cannot reach.
INSERT INTO "RolePermission" (role, module, action, "companyId", "createdAt", "updatedAt")
SELECT c.id, 'HR', 'attendance/all', 'VIEW', c.id, now(), now()
  FROM "Company" c
 WHERE NOT EXISTS (
   SELECT 1 FROM "RolePermission" rp
    WHERE rp."companyId" = c.id
      AND rp.role = 'HR'
      AND rp.module = 'attendance/all'
      AND rp.action = 'VIEW'
 );

-- Nothing else may have picked up company-wide attendance by accident. The
-- merge widens who can reach the screen, so the roles that were never meant to
-- see everybody's records are cleared back out.
DELETE FROM "RolePermission"
 WHERE module = 'attendance/all'
   AND action = 'VIEW'
   AND role IN ('ADMIN', 'EMPLOYEE', 'OFFICE_STAFF', 'SALES', 'FINANCE', 'MANAGER');

-- ── 2. Retire the duplicate menu row ─────────────────────────────────────────
-- Deactivated rather than deleted: an administrator who has customised the
-- order or title of this row keeps their work, and re-running the seed above
-- simply never recreates it.
UPDATE "Menu"
   SET "isActive" = false
 WHERE route = '/attendance/all';

-- Verify: should return exactly 1 per company.
SELECT c.id AS company_id, count(rp.id) AS hr_attendance_all_rows
  FROM "Company" c
  LEFT JOIN "RolePermission" rp
    ON rp."companyId" = c.id
   AND rp.role = 'HR'
   AND rp.module = 'attendance/all'
   AND rp.action = 'VIEW'
 GROUP BY c.id;

-- Verify: should return 0.
SELECT count(*) AS active_all_attendance_menu_rows
  FROM "Menu" WHERE route = '/attendance/all' AND "isActive" = true;
