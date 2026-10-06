-- Standardise the visible board-column names. Archived tasks remain archived
-- through Issue.isArchived; they do not need an Archived workflow column.
-- This deliberately does not alter any task records or their history.
BEGIN;

UPDATE "BoardColumn"
SET name = 'Completed', color = '#22c55e', type = 'DONE'
WHERE lower(name) = 'done';

UPDATE "BoardColumn"
SET name = 'Cancelled', color = '#ef4444', type = 'CANCELLED'
WHERE lower(name) = 'archived';

COMMIT;
