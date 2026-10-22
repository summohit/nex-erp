-- Permanent WFH set from the roster by HR / super admin, and one-day office
-- call-ins for those people. Additive: new tables only.

CREATE TABLE IF NOT EXISTS "WfhPermanent" (
  "id" SERIAL PRIMARY KEY,
  "companyId" INTEGER NOT NULL,
  "employeeId" INTEGER NOT NULL,
  "startDate" DATE NOT NULL,
  "endDate" DATE,
  "weekdays" TEXT,
  "reason" TEXT,
  "setById" INTEGER,
  "endedById" INTEGER,
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "WfhPermanent_companyId_endDate_idx" ON "WfhPermanent"("companyId", "endDate");
CREATE INDEX IF NOT EXISTS "WfhPermanent_employeeId_idx" ON "WfhPermanent"("employeeId");

CREATE TABLE IF NOT EXISTS "WfhOfficeDay" (
  "id" SERIAL PRIMARY KEY,
  "companyId" INTEGER NOT NULL,
  "employeeId" INTEGER NOT NULL,
  "date" DATE NOT NULL,
  "setById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "WfhOfficeDay_employeeId_date_key" ON "WfhOfficeDay"("employeeId", "date");
