-- Automatic Comp Off ledger.
-- One row per attendance day prevents a retry, approval, or import from
-- increasing the employee's Comp Off balance twice.

CREATE TABLE IF NOT EXISTS "CompOffCredit" (
  "id" SERIAL PRIMARY KEY,
  "employeeId" INTEGER NOT NULL REFERENCES "Employee"("id") ON DELETE CASCADE,
  "attendanceId" INTEGER NOT NULL UNIQUE REFERENCES "Attendance"("id") ON DELETE CASCADE,
  "leaveTypeId" INTEGER NOT NULL REFERENCES "LeaveType"("id") ON DELETE CASCADE,
  "year" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "CompOffCredit_employeeId_year_idx"
  ON "CompOffCredit" ("employeeId", "year");
