# Payroll decisions

Answers to the blocking questions in the MIRA Payroll plan (22 Oct 2026), given on 3 Nov 2026.

**Rule for everything below:** every value is a setting Finance can change in **Settings → Payroll Rules**.
These are the starting values only. Changing them must never need a code change.

| # | Topic | Decision (starting value) | Configurable |
|---|---|---|---|
| 1 | Tax slabs FY 2026-27 | Same as FY 2025-26, both regimes (see the plan, section 3) | Per financial year |
| 2 | Default regime | **New** regime if the employee doesn't choose | Yes |
| 2 | Choice lock | Existing employees: **30 April**. New joiners: **30 days** after joining | Per financial year |
| 3 | Old-regime deductions | All allowed: 80C, 80CCD(1B), 80D, HRA, 24(b), LTA, 80E, 80G | Per section, on/off |
| 3 | Proof | Required for every section by default | Per section |
| 4 | Monthly TDS method | **Spread evenly**: (projected yearly tax − TDS deducted so far) ÷ months left. Alternative: fixed yearly ÷ 12 | Setting |
| 5 | Employee PF | 12% of Basic, **capped at ₹15,000** wage | Rate and cap (statutory); capped or full Basic per salary group; per-employee override with a reason |
| 6 | Employer PF | **Included in CTC**; EPS 8.33% of the employer share; admin charges **not** in CTC | Yes |
| 7 | ESI | On **gross**, only when gross ≤ **₹21,000**; employee 0.75%, employer 3.25% | Base, limit and rates |
| 8 | Old tool's "Variable Deduction 3.25%" | Treated as the **employer ESI share**; not deducted from employees | — |
| 9 | Professional Tax | Uttar Pradesh: none. Haryana: none. Other states added when someone works there | Slabs per state |
| 10 | Test data | **Still needed from Finance:** one month's Excel salary sheet and 5–10 sample employees across groups | — |

## Still open (not blocking the engine switch)
Consultant TDS base, "Other Deduction ₹1,800", grade CTC bands, approvers for revisions and the monthly run,
bank file format, monthly report samples, and the first live month.
