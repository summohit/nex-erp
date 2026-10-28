-- Payroll engine masters (Phase 1, Task 1.1 — docs/PAYROLL_EXECUTION_TRACKER.md).
-- Additive and re-runnable: eight new tables, no existing table is altered.
-- Nothing in the current payroll run reads these yet; the legacy
-- SalaryComponent / SalaryStructure tables remain the source of truth until
-- the new engine is reconciled with Finance's workbook.
-- Generated with `prisma migrate diff`, then made idempotent.

-- CreateTable
CREATE TABLE IF NOT EXISTS "PayrollStatutoryRate" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "stateCode" TEXT,
    "ratePct" DOUBLE PRECISION,
    "wageCeiling" DOUBLE PRECISION,
    "eligibilityLimit" DOUBLE PRECISION,
    "fixedAmount" DOUBLE PRECISION,
    "slabs" JSONB,
    "notes" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollStatutoryRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PayrollComponent" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "partOfCtc" BOOLEAN NOT NULL DEFAULT true,
    "partOfGross" BOOLEAN NOT NULL DEFAULT true,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "reduceForLop" BOOLEAN NOT NULL DEFAULT true,
    "showOnPayslip" BOOLEAN NOT NULL DEFAULT true,
    "showOnAnnexure" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PayrollSalaryGroup" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "payeeType" TEXT NOT NULL DEFAULT 'EMPLOYEE',
    "flatTdsPct" DOUBLE PRECISION,
    "gstApplicable" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "retiredAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollSalaryGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PayrollSalaryGroupLine" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "componentId" INTEGER NOT NULL,
    "calcType" TEXT NOT NULL,
    "amount" DOUBLE PRECISION,
    "formula" TEXT,
    "statutoryCode" TEXT,
    "condition" TEXT,
    "minAmount" DOUBLE PRECISION,
    "maxAmount" DOUBLE PRECISION,
    "overrideAllowed" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PayrollSalaryGroupLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PayrollTaxRegime" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "standardDeduction" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rebateIncomeLimit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rebateMaxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cessPct" DOUBLE PRECISION NOT NULL DEFAULT 4,
    "surcharge" JSONB,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollTaxRegime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PayrollTaxSlab" (
    "id" SERIAL NOT NULL,
    "regimeId" INTEGER NOT NULL,
    "fromAmount" DOUBLE PRECISION NOT NULL,
    "toAmount" DOUBLE PRECISION,
    "ratePct" DOUBLE PRECISION NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PayrollTaxSlab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PayrollTaxSection" (
    "id" SERIAL NOT NULL,
    "regimeId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "maxLimit" DOUBLE PRECISION,
    "proofRequired" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PayrollTaxSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PayrollAuditLog" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "actorUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollStatutoryRate_companyId_code_idx" ON "PayrollStatutoryRate"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollStatutoryRate_companyId_code_stateCode_effectiveFrom_key" ON "PayrollStatutoryRate"("companyId", "code", "stateCode", "effectiveFrom");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollComponent_companyId_category_idx" ON "PayrollComponent"("companyId", "category");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollComponent_companyId_code_key" ON "PayrollComponent"("companyId", "code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollSalaryGroup_companyId_isActive_idx" ON "PayrollSalaryGroup"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollSalaryGroup_companyId_code_version_key" ON "PayrollSalaryGroup"("companyId", "code", "version");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollSalaryGroupLine_componentId_idx" ON "PayrollSalaryGroupLine"("componentId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollSalaryGroupLine_groupId_componentId_key" ON "PayrollSalaryGroupLine"("groupId", "componentId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollTaxRegime_companyId_code_financialYear_key" ON "PayrollTaxRegime"("companyId", "code", "financialYear");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollTaxSlab_regimeId_idx" ON "PayrollTaxSlab"("regimeId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollTaxSection_regimeId_code_key" ON "PayrollTaxSection"("regimeId", "code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollAuditLog_companyId_entity_entityId_idx" ON "PayrollAuditLog"("companyId", "entity", "entityId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollAuditLog_companyId_createdAt_idx" ON "PayrollAuditLog"("companyId", "createdAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "PayrollSalaryGroupLine" ADD CONSTRAINT "PayrollSalaryGroupLine_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PayrollSalaryGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "PayrollSalaryGroupLine" ADD CONSTRAINT "PayrollSalaryGroupLine_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "PayrollComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "PayrollTaxSlab" ADD CONSTRAINT "PayrollTaxSlab_regimeId_fkey" FOREIGN KEY ("regimeId") REFERENCES "PayrollTaxRegime"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "PayrollTaxSection" ADD CONSTRAINT "PayrollTaxSection_regimeId_fkey" FOREIGN KEY ("regimeId") REFERENCES "PayrollTaxRegime"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

