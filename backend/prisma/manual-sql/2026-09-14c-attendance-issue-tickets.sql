-- Attendance-issue tickets.
--
-- An employee can raise a problem with their own attendance record as a ticket.
-- It differs from every other ticket in three ways, all of which need storage:
--
--   * it is routed to HR, not the development team  -> attendanceTicketAssigneeId
--   * it concerns a specific day                    -> Ticket.attendanceDate
--   * it is not engineering's business to read      -> handled in code
--
-- Re-runnable. The enum value is added separately by the runner, because
-- Postgres refuses to use a new enum value in the transaction that adds it.

ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "attendanceDate" TIMESTAMP(3);
ALTER TABLE "SystemSetting" ADD COLUMN IF NOT EXISTS "attendanceTicketAssigneeId" INTEGER;

-- HR filters their queue by type and works it in date order.
CREATE INDEX IF NOT EXISTS "Ticket_type_attendanceDate_idx" ON "Ticket" ("type", "attendanceDate");

-- verify
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'Ticket' AND column_name = 'attendanceDate') AS ticket_column,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'SystemSetting' AND column_name = 'attendanceTicketAssigneeId') AS setting_column,
  (SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'TicketType' AND e.enumlabel = 'ATTENDANCE_ISSUE') AS enum_value,
  (SELECT count(*) FROM pg_indexes WHERE indexname = 'Ticket_type_attendanceDate_idx') AS idx;
