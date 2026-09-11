-- 2026-09-11: A quotation belongs to a deal, not necessarily to a client
--
-- Quotations are raised against a lead (deal) that may have no Client record
-- yet, so Quotation.clientId becomes nullable. At least one of clientId or
-- leadId is still required — enforced in createQuotation, since a CHECK
-- constraint across two nullable columns is harder to evolve than a guard.
--
-- The foreign key also changes from CASCADE to SET NULL. Deleting a client must
-- not silently delete the quotations raised for them: the commercial history is
-- worth more than the tidiness, and with a nullable column there is somewhere
-- for the row to go.
--
-- Sales Orders are unaffected: SalesOrder.clientId stays required, because an
-- order is a commitment against a party. Converting a clientless quote is
-- refused with an explanatory error rather than silently failing.
--
-- Re-runnable: dropping a NOT NULL that is already dropped is a no-op.

ALTER TABLE "Quotation" ALTER COLUMN "clientId" DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Quotation_clientId_fkey') THEN
    ALTER TABLE "Quotation" DROP CONSTRAINT "Quotation_clientId_fkey";
  END IF;
  ALTER TABLE "Quotation"
    ADD CONSTRAINT "Quotation_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
END $$;

-- Verify: nullable should be YES, and the delete rule SET NULL.
SELECT
  (SELECT is_nullable FROM information_schema.columns
     WHERE table_name = 'Quotation' AND column_name = 'clientId')        AS client_id_nullable,
  (SELECT rc.delete_rule
     FROM information_schema.referential_constraints rc
    WHERE rc.constraint_name = 'Quotation_clientId_fkey')               AS on_delete;
