-- §Att7: "Shift Attendance" menu entry.
--
-- Adds the week/month per-shift report under Attendance & Leave (parent id 15),
-- next to All People Shift Roster. The roster is the plan — who is on what; this
-- is how the plan went.
--
-- Menu ids derive from the route (menus.service.ts: route.replace('/','')), so
-- this resolves to the module 'attendance/shift-summary'. The route itself is
-- guarded on 'attendance/all', which is the same data read a different way, so
-- anybody who can see company-wide attendance can see it grouped by shift.
--
-- Guarded so it is safe to re-run.

INSERT INTO "Menu" ("companyId", "parentId", title, icon, route, "displayOrder", "isActive")
SELECT NULL, 15, 'Shift Attendance', NULL, '/attendance/shift-summary', 9, true
WHERE NOT EXISTS (
  SELECT 1 FROM "Menu" WHERE route = '/attendance/shift-summary'
);

-- Verify: should return exactly 1.
SELECT count(*) AS shift_summary_menu_rows
  FROM "Menu" WHERE route = '/attendance/shift-summary';
