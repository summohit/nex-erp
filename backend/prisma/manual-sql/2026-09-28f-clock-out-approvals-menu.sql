-- §Att5: "Clock-out Approvals" menu entry.
--
-- Sits under Attendance & Leave (parent id 15), beside Shift Attendance. Menu
-- ids derive from the route (menus.service.ts: route.replace('/','')), so this
-- resolves to the module 'attendance/clock-out-approvals'.
--
-- Guarded on 'attendance/all' at the route, the same as Shift Attendance:
-- seeing the queue is the same class of information as seeing everybody's
-- attendance. Who may actually approve is a narrower question the page asks the
-- server directly, because it depends on the delegate list and not on a menu.
--
-- Guarded so it is safe to re-run.

INSERT INTO "Menu" ("companyId", "parentId", title, icon, route, "displayOrder", "isActive")
SELECT NULL, 15, 'Clock-out Approvals', NULL, '/attendance/clock-out-approvals', 10, true
WHERE NOT EXISTS (
  SELECT 1 FROM "Menu" WHERE route = '/attendance/clock-out-approvals'
);

-- Verify: should return exactly 1.
SELECT count(*) AS clock_out_approvals_menu_rows
  FROM "Menu" WHERE route = '/attendance/clock-out-approvals';
