-- REGULAR_WITH_MIN_BASIC v1 (id 41, created 6 Nov, no pay profiles yet): replace its 4 lines with a complete set.
-- Basic = 50% of CTC but at least 15,000 (the company BASIC_FLOOR rate is 13,780, so the 15,000 is written in).
BEGIN;
DELETE FROM "PayrollSalaryGroupLine" WHERE "groupId" = 41;
INSERT INTO "PayrollSalaryGroupLine" ("groupId", "componentId", "calcType", formula, condition, amount, "overrideAllowed", "displayOrder")
SELECT 41, c.id, v.calc, v.formula, v.cond, v.amount, v.ovr, v.ord
FROM (VALUES
  ('BASIC',           'FORMULA',   'MAX(CTC_MONTHLY * 0.5, 15000)',   NULL, NULL::float8, true,  1),
  ('HRA',             'FORMULA',   'BASIC * 0.4',                     NULL, NULL,         false, 2),
  ('EMPLOYER_PF',     'FORMULA',   'PF_BASE * PF_EMPLOYER_PCT / 100', NULL, NULL,         false, 3),
  ('EMPLOYER_ESI',    'FORMULA',   '(CTC_MONTHLY - EMPLOYER_PF) / (1 + ESI_EMPLOYER_PCT / 100) * ESI_EMPLOYER_PCT / 100',
                                   '(CTC_MONTHLY - EMPLOYER_PF) / (1 + ESI_EMPLOYER_PCT / 100) <= ESI_LIMIT', NULL, false, 4),
  ('EMPLOYEE_PF',     'FORMULA',   'PF_BASE * PF_EMPLOYEE_PCT / 100', NULL, NULL,         false, 5),
  ('TDS',             'INPUT',     NULL,                              NULL, NULL,         false, 6),
  ('OTHER_REIMB',     'FIXED',     NULL,                              NULL, 0,            true,  7),
  ('OTHER_ALLOWANCE', 'BALANCING', NULL,                              NULL, NULL,         false, 8),
  ('EMPLOYEE_ESI',    'FORMULA',   'GROSS * ESI_EMPLOYEE_PCT / 100',  'GROSS <= ESI_LIMIT', NULL, false, 9)
) AS v(code, calc, formula, cond, amount, ovr, ord)
JOIN "PayrollComponent" c ON c."companyId" = 1 AND c.code = v.code;
COMMIT;
