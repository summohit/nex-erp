-- 2026-09-09c: Show the Tickets menu item
--
-- The row existed but was inactive, so a complete tickets feature — a web page
-- under crm/tickets and a full mobile screen — was unreachable from either
-- surface. MenusService always grants `crm/tickets` to every role ("all
-- employees can raise/view tickets"), so activating the row is all that gates
-- it; no permission rows are needed.
--
-- displayOrder was 0, which tied with Dashboard and left the order between the
-- two down to whatever the database returned. Field Visits is the current last
-- item at 9, so 10 puts Tickets at the end of MAIN, predictably.
--
-- Kept top-level rather than nested under CRM on purpose: every employee is
-- granted tickets, and nesting would surface a "CRM" section to people with no
-- other CRM access.

UPDATE "Menu"
SET "isActive" = true,
    "displayOrder" = 10
WHERE id = 51
  AND route = '/crm/tickets';
