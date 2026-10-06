-- Keep existing company-specific menus in sync with the shorter product name.
UPDATE "Menu"
   SET title = 'Shift Roster'
 WHERE route = '/attendance/shifts'
    OR title = 'All People Shift Roster';
