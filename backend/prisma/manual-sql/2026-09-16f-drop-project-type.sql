-- 2026-09-16: Drop Project.projectType
--
-- Added in the Delivery module's first phase because §4 lists both a Project
-- Type and a Category. In practice only one of them was ever used:
--
--   category    — 78 of 82 projects
--   projectType —  0 of 82 projects
--
-- Nothing read it beyond the form that wrote it, so it was a second name for
-- a question Category already answers, and an extra field on a form that is
-- long enough. Dropped rather than left as an unused column: zero rows carry
-- a value, so there is nothing to preserve.
--
-- NOT related to ProjectSummary.projectType, which is a field of the AI
-- analysis output and stays exactly as it is.
--
-- Apply AFTER the code that stopped referencing it — the reverse order of an
-- ADD COLUMN. Re-runnable.

ALTER TABLE "Project" DROP COLUMN IF EXISTS "projectType";

-- Verify: the column is gone and category is untouched.
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'Project' AND column_name = 'projectType')        AS project_type_column,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'Project' AND column_name = 'category')           AS category_column,
  (SELECT count(*) FROM "Project"
    WHERE NOT "isSystem" AND category IS NOT NULL AND category <> '')    AS projects_with_a_category;
