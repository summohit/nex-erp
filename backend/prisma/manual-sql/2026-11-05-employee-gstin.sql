-- A consultant's GSTIN: GST is added on top of their fee when their salary group has GST on.
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "gstin" TEXT;
