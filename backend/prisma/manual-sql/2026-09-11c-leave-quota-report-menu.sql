-- 2026-09-11: Leave Quota Report menu entry
--
-- Adds "Leave Quota Report" under Attendance & Leave (parent id 15), alongside
-- the existing Leave Balances item. Balances is for *editing* allocations; this
-- is the read-only report — allocated, carried in, used and remaining per
-- person, with a per-leave-type breakdown behind each row.
--
-- Menu ids are derived from the route (menus.service.ts: route.replace('/','')),
-- so this item resolves to the module 'attendance/leave-quota'. No
-- RolePermission row is needed: menus.service grants that module to anyone who
-- already has 'attendance', matching how Field Visits rides on 'projects'. The
-- endpoint itself scopes non-admins to their own figures regardless.
--
-- Guarded so it is safe to re-run.

INSERT INTO "Menu" ("companyId", "parentId", title, icon, route, "displayOrder", "isActive")
SELECT NULL, 15, 'Leave Quota Report', NULL, '/attendance/leave-quota', 8, true
WHERE NOT EXISTS (
  SELECT 1 FROM "Menu" WHERE route = '/attendance/leave-quota'
);

-- Verify: should return exactly 1.
SELECT count(*) AS leave_quota_menu_rows
  FROM "Menu" WHERE route = '/attendance/leave-quota';
