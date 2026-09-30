-- Claims reimbursed on a payslip that has since been paid, still reading APPROVED.
--
-- Payroll tags each approved claim with the month/year of the payslip it went
-- out on, but nothing ever marked the claim PAID. From 2026-09-30 paying a
-- payslip does (PayrollService.markExpenseClaimsPaid); this catches up the ones
-- paid before that. Found: 71 claims, ₹6,63,074.45.

BEGIN;

-- 0. What will change (review)
SELECT e.id, e."employeeId", e.month, e.year, e.amount, e.title
FROM "ExpenseClaim" e
JOIN "Payslip" p ON p."employeeId" = e."employeeId" AND p."companyId" = e."companyId"
                AND p.month = e.month AND p.year = e.year
WHERE e.status = 'APPROVED' AND p.status = 'PAID'
ORDER BY e.year, e.month, e."employeeId";

-- 1. Mark them paid
UPDATE "ExpenseClaim" e
SET status = 'PAID', "updatedAt" = now()
FROM "Payslip" p
WHERE p."employeeId" = e."employeeId" AND p."companyId" = e."companyId"
  AND p.month = e.month AND p.year = e.year
  AND e.status = 'APPROVED' AND p.status = 'PAID';

COMMIT;
