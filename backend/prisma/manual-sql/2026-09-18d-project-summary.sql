-- §1 project summary. Additive: one nullable column.
BEGIN;
-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "summary" TEXT;

COMMIT;
