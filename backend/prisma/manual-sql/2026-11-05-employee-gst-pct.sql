-- A consultant's own GST % (default 18 when null); GST applies when they have a GSTIN.
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "gstPct" DOUBLE PRECISION;
