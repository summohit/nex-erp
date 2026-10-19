-- Candidate follow-ups for the Recruitment / ATS pipeline.
-- This is additive: no existing ATS records are changed or removed.

CREATE TABLE IF NOT EXISTS "CandidateFollowUp" (
  "id" SERIAL PRIMARY KEY,
  "applicationId" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'CALL',
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "assignedToId" INTEGER,
  "companyId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CandidateFollowUp_applicationId_fkey"
    FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CandidateFollowUp_assignedToId_fkey"
    FOREIGN KEY ("assignedToId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CandidateFollowUp_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CandidateFollowUp_companyId_status_scheduledAt_idx"
  ON "CandidateFollowUp" ("companyId", "status", "scheduledAt");
CREATE INDEX IF NOT EXISTS "CandidateFollowUp_applicationId_scheduledAt_idx"
  ON "CandidateFollowUp" ("applicationId", "scheduledAt");
CREATE INDEX IF NOT EXISTS "CandidateFollowUp_assignedToId_scheduledAt_idx"
  ON "CandidateFollowUp" ("assignedToId", "scheduledAt");
