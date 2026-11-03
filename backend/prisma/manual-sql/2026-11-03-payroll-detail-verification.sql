-- Pay profiles: verify PAN / UAN / bank against uploaded documents.
-- Additive only: three nullable dates on Employee and a suggestions table.

ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "panVerifiedAt" TIMESTAMP(3);
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "uanVerifiedAt" TIMESTAMP(3);
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "bankVerifiedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "EmployeeDetailSuggestion" (
  "id" SERIAL PRIMARY KEY,
  "companyId" INTEGER NOT NULL,
  "employeeId" INTEGER NOT NULL,
  "field" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "documentId" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'SUGGESTED',
  "note" TEXT,
  "decidedByUserId" INTEGER,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "EmployeeDetailSuggestion_companyId_employeeId_idx" ON "EmployeeDetailSuggestion"("companyId", "employeeId");
CREATE INDEX IF NOT EXISTS "EmployeeDetailSuggestion_employeeId_field_status_idx" ON "EmployeeDetailSuggestion"("employeeId", "field", "status");
