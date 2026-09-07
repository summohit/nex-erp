-- Standardise existing Lead Contact references to LC-MMYY-###.
-- New contacts are generated in this format by CrmService.
-- Safe to rerun: it only changes the prior LCMMYY-### format.

UPDATE "LeadContact"
SET "contactCode" = 'LC-' || substring("contactCode" FROM 3)
WHERE "contactCode" ~ '^LC[0-9]{4}-[0-9]{3}$';
