/**
 * Starting payroll masters for a company, taken from Finance's workbook
 * `MNC_Payroll_PF_Min_15000.xlsx` (shared Oct 2026). Phase 1, Task 1.2 of
 * docs/PAYROLL_EXECUTION_TRACKER.md.
 *
 * Pure data: no database, so the calculation engine's tests can load exactly
 * what gets seeded. prisma/seed-payroll-masters.ts writes it.
 *
 * The sheet is followed AS WRITTEN, including where its formulas and its own
 * notes disagree. Each such place is marked "FINANCE Qn" and matches the open
 * questions in the tracker — change the data here (or in the UI later), not
 * the engine, when Finance answers.
 *
 * ── Formula language (evaluated by the Phase 2 engine) ──────────────────────
 *   Numbers, + - * /, parentheses, MIN(a,b), MAX(a,b), comparisons in
 *   conditions (<=, <, >=, >, ==).
 *   Variables:
 *     CTC_MONTHLY        offered CTC / 12 (fixed part only)
 *     <COMPONENT CODE>   any component worked out earlier in the group
 *     <RATE VARIABLE>    from PayrollStatutoryRate, see RATE_VARIABLES below
 *   GROSS is not a variable lines may use: it is CTC_MONTHLY minus the
 *   employer contributions, and the BALANCING line fills earnings up to it.
 */

export const SEED_SOURCE = 'MNC_Payroll_PF_Min_15000.xlsx (Finance, Oct 2026)';

/** Start of FY 2026-27 — when these rules are taken to apply from. */
export const SEED_EFFECTIVE_FROM = '2026-04-01';
export const SEED_FINANCIAL_YEAR = '2026-27';

// ── Statutory rates ─────────────────────────────────────────────────────────

export interface SeedStatutoryRate {
  code: string;
  stateCode: string | null;
  ratePct?: number;
  wageCeiling?: number;
  eligibilityLimit?: number;
  fixedAmount?: number;
  notes: string;
}

export const SEED_STATUTORY_RATES: SeedStatutoryRate[] = [
  {
    code: 'PF_EMPLOYEE', stateCode: null, ratePct: 12, wageCeiling: 15000,
    notes: '12% of PF base. Ceiling ₹15,000 is used only by groups that cap PF (₹1,800).',
  },
  {
    code: 'PF_EMPLOYER', stateCode: null, ratePct: 12, wageCeiling: 15000,
    notes: '12% of PF base; part of CTC, not shown on the payslip.',
  },
  {
    code: 'ESI_EMPLOYEE', stateCode: null, ratePct: 0.75, eligibilityLimit: 21000,
    notes: 'FINANCE Q1: sheet tests Basic ≤ ₹21,000 and applies % to Basic; notes and ESI law say Gross.',
  },
  {
    code: 'ESI_EMPLOYER', stateCode: null, ratePct: 3.25, eligibilityLimit: 21000,
    notes: 'Part of CTC, not shown on the payslip. FINANCE Q1 applies here too.',
  },
  {
    code: 'PT', stateCode: 'UP', fixedAmount: 0,
    notes: 'Uttar Pradesh levies no Professional Tax. FINANCE Q6: confirm every employee is UP-based.',
  },
  {
    code: 'BASIC_FLOOR', stateCode: 'UP', fixedAmount: 13780,
    notes: 'Minimum monthly Basic from the sheet: MAX(50% of CTC, 13,780). FINANCE Q3: source of the figure.',
  },
  {
    code: 'GST', stateCode: null, ratePct: 18,
    notes: 'Added on top of a consultant fee when they invoice with a GSTIN.',
  },
];

/**
 * How each rate is exposed to formulas. `field` is the PayrollStatutoryRate
 * column read.
 */
export const RATE_VARIABLES: Record<string, { code: string; field: 'ratePct' | 'wageCeiling' | 'eligibilityLimit' | 'fixedAmount' }> = {
  PF_EMPLOYEE_PCT: { code: 'PF_EMPLOYEE', field: 'ratePct' },
  PF_EMPLOYER_PCT: { code: 'PF_EMPLOYER', field: 'ratePct' },
  PF_WAGE_CEILING: { code: 'PF_EMPLOYER', field: 'wageCeiling' },
  ESI_EMPLOYEE_PCT: { code: 'ESI_EMPLOYEE', field: 'ratePct' },
  ESI_EMPLOYER_PCT: { code: 'ESI_EMPLOYER', field: 'ratePct' },
  ESI_LIMIT: { code: 'ESI_EMPLOYER', field: 'eligibilityLimit' },
  PT_AMOUNT: { code: 'PT', field: 'fixedAmount' },
  BASIC_FLOOR: { code: 'BASIC_FLOOR', field: 'fixedAmount' },
  GST_PCT: { code: 'GST', field: 'ratePct' },
};

// ── Components ──────────────────────────────────────────────────────────────

export type ComponentCategory = 'EARNING' | 'EMPLOYEE_DEDUCTION' | 'EMPLOYER_CONTRIBUTION' | 'REIMBURSEMENT';

export interface SeedComponent {
  code: string;
  name: string;
  category: ComponentCategory;
  partOfCtc: boolean;
  partOfGross: boolean;
  taxable: boolean;
  reduceForLop: boolean;
  showOnPayslip: boolean;
  showOnAnnexure: boolean;
  displayOrder: number;
  description?: string;
}

const earning = (code: string, name: string, displayOrder: number, description?: string): SeedComponent => ({
  code, name, category: 'EARNING', partOfCtc: true, partOfGross: true, taxable: true,
  reduceForLop: true, showOnPayslip: true, showOnAnnexure: true, displayOrder, description,
});

/** Employer's share: inside CTC, outside gross, never on the salary slip. */
const employerShare = (code: string, name: string, displayOrder: number): SeedComponent => ({
  code, name, category: 'EMPLOYER_CONTRIBUTION', partOfCtc: true, partOfGross: false, taxable: false,
  // Recomputed from the LOP-reduced Basic rather than pro-rated itself.
  reduceForLop: false,
  showOnPayslip: false, showOnAnnexure: true, displayOrder,
});

const deduction = (code: string, name: string, displayOrder: number): SeedComponent => ({
  code, name, category: 'EMPLOYEE_DEDUCTION', partOfCtc: false, partOfGross: false, taxable: false,
  reduceForLop: false, showOnPayslip: true, showOnAnnexure: true, displayOrder,
});

export const SEED_COMPONENTS: SeedComponent[] = [
  earning('BASIC', 'Basic Salary', 10),
  earning('HRA', 'House Rent Allowance (HRA)', 20),
  earning('TRAVEL_ALLOWANCE', 'Travelling Allowance', 30),
  earning('MEDICAL_ALLOWANCE', 'Medical Allowance', 40),
  earning('OTHER_ALLOWANCE', 'Other Allowance', 50, 'Balancing figure so earnings equal gross.'),
  earning('CONSULTANT_FEE', 'Professional Fee', 60, 'Monthly fee for consultants; no salary split.'),
  employerShare('EMPLOYER_PF', 'Employer PF Contribution', 110),
  employerShare('EMPLOYER_ESI', 'Employer ESIC Contribution', 120),
  deduction('EMPLOYEE_PF', 'Provident Fund (PF)', 210),
  deduction('EMPLOYEE_ESI', 'Employee State Insurance (ESIC)', 220),
  deduction('PROFESSIONAL_TAX', 'Professional Tax', 230),
  deduction('TDS', 'Income Tax (TDS)', 240),
];

// ── Salary groups ───────────────────────────────────────────────────────────

export type CalcType = 'FIXED' | 'FORMULA' | 'STATUTORY' | 'BALANCING' | 'INPUT';

export interface SeedGroupLine {
  component: string;
  calcType: CalcType;
  amount?: number;
  formula?: string;
  condition?: string;
  overrideAllowed?: boolean;
}

export interface SeedSalaryGroup {
  code: string;
  name: string;
  description: string;
  payeeType: 'EMPLOYEE' | 'CONSULTANT' | 'TRAINEE';
  flatTdsPct?: number;
  gstApplicable?: boolean;
  /** Sheet tab the group reproduces. */
  sheet: string;
  /** Listed in evaluation order: a line may only use codes listed above it. */
  lines: SeedGroupLine[];
}

const PF_ON_BASIC = 'BASIC * PF_EMPLOYER_PCT / 100';
const EE_PF_ON_BASIC = 'BASIC * PF_EMPLOYEE_PCT / 100';
// FINANCE Q2: the sheet's title says PF base is at least ₹15,000, but no
// formula applies that — PF is 12% of actual Basic. Followed as written.
// FINANCE Q1: ESIC tested and computed on Basic, as the sheet does.
const ESI_CONDITION = 'BASIC <= ESI_LIMIT';
// FINANCE Q7: with the ₹13,780 Basic floor, Basic + HRA + Travel + Medical
// exceed gross below a monthly CTC of about ₹24,243, so the sheet's Other
// Allowance goes negative (−₹1,743.45 at ₹22,500). Net still adds up, but a
// payslip cannot carry a negative earning — the engine must flag it rather
// than print it until Finance says which line gives way.

/** Employer and employee statutory lines shared by the regular groups. */
const regularStatutory = (pfEmployer: SeedGroupLine, pfEmployee: SeedGroupLine): SeedGroupLine[] => [
  pfEmployer,
  { component: 'EMPLOYER_ESI', calcType: 'FORMULA', formula: 'BASIC * ESI_EMPLOYER_PCT / 100', condition: ESI_CONDITION },
  pfEmployee,
  { component: 'EMPLOYEE_ESI', calcType: 'FORMULA', formula: 'BASIC * ESI_EMPLOYEE_PCT / 100', condition: ESI_CONDITION },
  { component: 'PROFESSIONAL_TAX', calcType: 'FORMULA', formula: 'PT_AMOUNT' },
  // Worked out by the monthly run from the annual projection, not the template.
  { component: 'TDS', calcType: 'INPUT' },
];

export const SEED_SALARY_GROUPS: SeedSalaryGroup[] = [
  {
    code: 'REGULAR',
    name: 'Regular Employee',
    description: 'Basic 50% of CTC (min ₹13,780), HRA 40% of Basic, PF 12% of actual Basic, ESIC when Basic ≤ ₹21,000.',
    payeeType: 'EMPLOYEE',
    sheet: 'Salary Structure',
    lines: [
      { component: 'BASIC', calcType: 'FORMULA', formula: 'MAX(CTC_MONTHLY * 0.5, BASIC_FLOOR)' },
      { component: 'HRA', calcType: 'FORMULA', formula: 'BASIC * 0.4' },
      { component: 'TRAVEL_ALLOWANCE', calcType: 'FIXED', amount: 1600, overrideAllowed: true },
      { component: 'MEDICAL_ALLOWANCE', calcType: 'FIXED', amount: 1250, overrideAllowed: true },
      ...regularStatutory(
        { component: 'EMPLOYER_PF', calcType: 'FORMULA', formula: PF_ON_BASIC },
        { component: 'EMPLOYEE_PF', calcType: 'FORMULA', formula: EE_PF_ON_BASIC },
      ),
      { component: 'OTHER_ALLOWANCE', calcType: 'BALANCING' },
    ],
  },
  {
    code: 'REGULAR_PF_CAPPED',
    name: 'Regular Employee – PF capped at ₹1,800',
    description: 'Basic 50% of CTC (no floor), PF on the ₹15,000 wage ceiling (₹1,800 each side).',
    payeeType: 'EMPLOYEE',
    sheet: 'Salary Structure Minimum pf',
    lines: [
      // The sheet has no ₹13,780 floor on this tab; it is used for higher CTCs.
      { component: 'BASIC', calcType: 'FORMULA', formula: 'CTC_MONTHLY * 0.5' },
      { component: 'HRA', calcType: 'FORMULA', formula: 'BASIC * 0.4' },
      { component: 'TRAVEL_ALLOWANCE', calcType: 'FIXED', amount: 1600, overrideAllowed: true },
      { component: 'MEDICAL_ALLOWANCE', calcType: 'FIXED', amount: 1250, overrideAllowed: true },
      ...regularStatutory(
        // Sheet hardcodes ₹1,800 = ₹15,000 × 12%.
        { component: 'EMPLOYER_PF', calcType: 'FORMULA', formula: 'MIN(BASIC, PF_WAGE_CEILING) * PF_EMPLOYER_PCT / 100' },
        { component: 'EMPLOYEE_PF', calcType: 'FORMULA', formula: 'MIN(BASIC, PF_WAGE_CEILING) * PF_EMPLOYEE_PCT / 100' },
      ),
      { component: 'OTHER_ALLOWANCE', calcType: 'BALANCING' },
    ],
  },
  {
    code: 'REGULAR_VARIABLE',
    name: 'Regular Employee – with Variable Pay',
    description: 'As Regular, with no Medical Allowance. The variable part of CTC (20% on the sample) is agreed per offer and is outside the monthly split.',
    payeeType: 'EMPLOYEE',
    sheet: 'Salary Structure Variable',
    lines: [
      { component: 'BASIC', calcType: 'FORMULA', formula: 'MAX(CTC_MONTHLY * 0.5, BASIC_FLOOR)' },
      { component: 'HRA', calcType: 'FORMULA', formula: 'BASIC * 0.4' },
      { component: 'TRAVEL_ALLOWANCE', calcType: 'FIXED', amount: 1600, overrideAllowed: true },
      { component: 'MEDICAL_ALLOWANCE', calcType: 'FIXED', amount: 0, overrideAllowed: true },
      ...regularStatutory(
        { component: 'EMPLOYER_PF', calcType: 'FORMULA', formula: PF_ON_BASIC },
        { component: 'EMPLOYEE_PF', calcType: 'FORMULA', formula: EE_PF_ON_BASIC },
      ),
      { component: 'OTHER_ALLOWANCE', calcType: 'BALANCING' },
    ],
  },
  {
    code: 'CONSULTANT_TECH',
    name: 'Technical Consultant',
    description: 'Fee = CTC. TDS 2% (Sec 194J, technical services). GST 18% added when invoiced with a GSTIN. No PF/ESIC.',
    payeeType: 'CONSULTANT',
    flatTdsPct: 2,
    gstApplicable: true,
    sheet: 'Contractual',
    lines: [
      { component: 'CONSULTANT_FEE', calcType: 'BALANCING' },
      { component: 'TDS', calcType: 'FORMULA', formula: 'CONSULTANT_FEE * 2 / 100' },
    ],
  },
  {
    code: 'TRAINEE',
    name: 'Trainee',
    description: 'No Basic, PF or ESIC. Travelling ₹6,000, Medical ₹1,250, rest as Other Allowance.',
    payeeType: 'TRAINEE',
    sheet: 'Salary Structure Trainee',
    lines: [
      { component: 'TRAVEL_ALLOWANCE', calcType: 'FIXED', amount: 6000, overrideAllowed: true },
      { component: 'MEDICAL_ALLOWANCE', calcType: 'FIXED', amount: 1250, overrideAllowed: true },
      { component: 'OTHER_ALLOWANCE', calcType: 'BALANCING' },
    ],
  },
];

// ── Income tax ──────────────────────────────────────────────────────────────
// FINANCE / CA to confirm for FY 2026-27. Values are the Finance Act 2025
// rules; the workbook's own tax line ("Minimum pf" C19) uses the same new-
// regime ladder (₹3,00,000 tax up to ₹24L, 30% above, 4% cess).

export interface SeedTaxRegime {
  code: 'NEW' | 'OLD';
  name: string;
  standardDeduction: number;
  rebateIncomeLimit: number;
  rebateMaxAmount: number;
  cessPct: number;
  surcharge: { fromIncome: number; ratePct: number }[];
  isDefault: boolean;
  slabs: { from: number; to: number | null; ratePct: number }[];
  sections: { code: string; name: string; maxLimit: number | null; proofRequired?: boolean }[];
}

export const SEED_TAX_REGIMES: SeedTaxRegime[] = [
  {
    code: 'NEW',
    name: 'New Tax Regime (Sec 115BAC)',
    standardDeduction: 75000,
    rebateIncomeLimit: 1200000,
    rebateMaxAmount: 60000,
    cessPct: 4,
    surcharge: [
      { fromIncome: 5000000, ratePct: 10 },
      { fromIncome: 10000000, ratePct: 15 },
      { fromIncome: 20000000, ratePct: 25 },
    ],
    isDefault: true,
    slabs: [
      { from: 0, to: 400000, ratePct: 0 },
      { from: 400000, to: 800000, ratePct: 5 },
      { from: 800000, to: 1200000, ratePct: 10 },
      { from: 1200000, to: 1600000, ratePct: 15 },
      { from: 1600000, to: 2000000, ratePct: 20 },
      { from: 2000000, to: 2400000, ratePct: 25 },
      { from: 2400000, to: null, ratePct: 30 },
    ],
    sections: [],
  },
  {
    code: 'OLD',
    name: 'Old Tax Regime',
    standardDeduction: 50000,
    rebateIncomeLimit: 500000,
    rebateMaxAmount: 12500,
    cessPct: 4,
    surcharge: [
      { fromIncome: 5000000, ratePct: 10 },
      { fromIncome: 10000000, ratePct: 15 },
      { fromIncome: 20000000, ratePct: 25 },
      { fromIncome: 50000000, ratePct: 37 },
    ],
    isDefault: false,
    slabs: [
      { from: 0, to: 250000, ratePct: 0 },
      { from: 250000, to: 500000, ratePct: 5 },
      { from: 500000, to: 1000000, ratePct: 20 },
      { from: 1000000, to: null, ratePct: 30 },
    ],
    sections: [
      { code: '80C', name: 'Sec 80C (PF, PPF, ELSS, LIC, tuition, home-loan principal)', maxLimit: 150000 },
      { code: '80CCD_1B', name: 'Sec 80CCD(1B) – additional NPS', maxLimit: 50000 },
      { code: '80D', name: 'Sec 80D – health insurance (self & family)', maxLimit: 25000 },
      { code: '80D_PARENTS', name: 'Sec 80D – health insurance (parents)', maxLimit: 50000 },
      { code: 'HRA', name: 'HRA exemption – Sec 10(13A)', maxLimit: null },
      { code: '24B', name: 'Sec 24(b) – home-loan interest (self-occupied)', maxLimit: 200000 },
    ],
  },
];
