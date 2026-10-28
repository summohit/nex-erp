import { PayrollCalculator } from './payroll-calculator';
import {
  SEED_SALARY_GROUPS,
  SEED_TAX_REGIMES,
} from '../masters/payroll-seed-data';

describe('PayrollCalculator (matching MNC_Payroll_PF_Min_15000.xlsx)', () => {
  const getGroup = (code: string) => {
    const group = SEED_SALARY_GROUPS.find((g) => g.code === code);
    if (!group) throw new Error(`Salary group ${code} not found in seed`);
    return group;
  };

  const newRegime = SEED_TAX_REGIMES.find((r) => r.code === 'NEW')!;
  const oldRegime = SEED_TAX_REGIMES.find((r) => r.code === 'OLD')!;

  describe('Case 1: Regular Employee with Capped PF (Minimum pf sheet tab)', () => {
    it('calculates monthly CTC ₹1,00,000 down to the exact rupee', () => {
      const res = PayrollCalculator.calculate({
        monthlyCtc: 100000,
        salaryGroup: getGroup('REGULAR_PF_CAPPED'),
      });

      expect(res.ctcMonthly).toBe(100000);
      expect(res.ctcAnnual).toBe(1200000);

      // Components
      const lineMap = new Map(res.lines.map((l) => [l.code, l.monthly]));
      expect(lineMap.get('BASIC')).toBe(50000);
      expect(lineMap.get('HRA')).toBe(20000);
      expect(lineMap.get('TRAVEL_ALLOWANCE')).toBe(1600);
      expect(lineMap.get('MEDICAL_ALLOWANCE')).toBe(1250);
      expect(lineMap.get('EMPLOYER_PF')).toBe(1800);
      expect(lineMap.get('EMPLOYER_ESI')).toBe(0);
      expect(lineMap.get('OTHER_ALLOWANCE')).toBe(25350);

      // Gross = CTC - Employer PF = 98,200
      expect(res.grossMonthly).toBe(98200);
      expect(res.grossAnnual).toBe(1178400);

      // Deductions
      expect(lineMap.get('EMPLOYEE_PF')).toBe(1800);
      expect(lineMap.get('EMPLOYEE_ESI')).toBe(0);
      expect(res.totalDeductionsMonthly).toBe(1800);

      // Net Take Home = Gross - Deductions = 96,400
      expect(res.netPayMonthly).toBe(96400);
      expect(res.netPayAnnual).toBe(1156800);

      // Verification of Payslip Rule: Employer share MUST be hidden from payslip
      const payslipLines = res.lines.filter((l) => l.showOnPayslip);
      const payslipCodes = payslipLines.map((l) => l.code);
      expect(payslipCodes).not.toContain('EMPLOYER_PF');
      expect(payslipCodes).not.toContain('EMPLOYER_ESI');
      expect(payslipCodes).toContain('EMPLOYEE_PF');
    });
  });

  describe('Case 2: Regular Employee with Uncapped PF & Variable (Variable sheet tab)', () => {
    it('calculates monthly CTC ₹60,000 with 12% PF on Basic and ₹0 Medical', () => {
      const res = PayrollCalculator.calculate({
        monthlyCtc: 60000,
        salaryGroup: getGroup('REGULAR_VARIABLE'),
      });

      const lineMap = new Map(res.lines.map((l) => [l.code, l.monthly]));
      expect(lineMap.get('BASIC')).toBe(30000);
      expect(lineMap.get('HRA')).toBe(12000);
      expect(lineMap.get('TRAVEL_ALLOWANCE')).toBe(1600);
      expect(lineMap.get('MEDICAL_ALLOWANCE')).toBe(0);
      expect(lineMap.get('EMPLOYER_PF')).toBe(3600);
      expect(lineMap.get('EMPLOYER_ESI')).toBe(0);
      expect(lineMap.get('OTHER_ALLOWANCE')).toBe(12800);

      expect(res.grossMonthly).toBe(56400);
      expect(lineMap.get('EMPLOYEE_PF')).toBe(3600);
      expect(res.netPayMonthly).toBe(52800);
    });
  });

  describe('Case 3: Low-Wage / ESIC Eligible Employee (Salary Structure sheet tab)', () => {
    it('calculates monthly CTC ₹25,000 with ₹13,780 floor & ESIC rules', () => {
      const res = PayrollCalculator.calculate({
        monthlyCtc: 25000,
        salaryGroup: getGroup('REGULAR'),
      });

      const lineMap = new Map(res.lines.map((l) => [l.code, l.monthly]));

      // Basic is pegged at floor ₹13,780 (since 25,000 * 50% = 12,500 < 13,780)
      expect(lineMap.get('BASIC')).toBe(13780);
      expect(lineMap.get('HRA')).toBe(5512); // 13,780 * 40%
      expect(lineMap.get('TRAVEL_ALLOWANCE')).toBe(1600);
      expect(lineMap.get('MEDICAL_ALLOWANCE')).toBe(1250);
      expect(lineMap.get('EMPLOYER_PF')).toBe(1653.6); // 13,780 * 12%
      expect(lineMap.get('EMPLOYER_ESI')).toBe(447.85); // 13,780 * 3.25%

      // Gross = CTC - (Employer PF + Employer ESI)
      expect(res.grossMonthly).toBe(22898.55);
      expect(lineMap.get('OTHER_ALLOWANCE')).toBe(756.55);

      // Employee Deductions
      expect(lineMap.get('EMPLOYEE_PF')).toBe(1653.6);
      expect(lineMap.get('EMPLOYEE_ESI')).toBe(103.35); // 13,780 * 0.75%
      expect(res.totalDeductionsMonthly).toBe(1756.95);

      // Net Take Home Pay
      expect(res.netPayMonthly).toBe(21141.6);
    });
  });

  describe('Case 4: Contractual / Technical Consultant (Contractual sheet tab)', () => {
    it('calculates monthly CTC ₹18,000 with 2% TDS u/s 194J', () => {
      const res = PayrollCalculator.calculate({
        monthlyCtc: 18000,
        salaryGroup: getGroup('CONSULTANT_TECH'),
      });

      const lineMap = new Map(res.lines.map((l) => [l.code, l.monthly]));
      expect(lineMap.get('CONSULTANT_FEE')).toBe(18000);
      expect(lineMap.get('TDS')).toBe(360); // 18,000 * 2%
      expect(res.netPayMonthly).toBe(17640);
    });
  });

  describe('Case 5: Trainee / Intern (Salary Structure Trainee sheet tab)', () => {
    it('calculates monthly CTC ₹15,000 stipend with allowances and no PF/ESI', () => {
      const res = PayrollCalculator.calculate({
        monthlyCtc: 15000,
        salaryGroup: getGroup('TRAINEE'),
      });

      const lineMap = new Map(res.lines.map((l) => [l.code, l.monthly]));
      expect(lineMap.get('TRAVEL_ALLOWANCE')).toBe(6000);
      expect(lineMap.get('MEDICAL_ALLOWANCE')).toBe(1250);
      expect(lineMap.get('OTHER_ALLOWANCE')).toBe(7750);
      expect(res.totalDeductionsMonthly).toBe(0);
      expect(res.netPayMonthly).toBe(15000);
    });
  });

  describe('Case 6: Income Tax Engine (New vs Old Regime FY 2026-27)', () => {
    it('computes 0 tax for taxable income under ₹12 Lakhs under New Regime (Rebate 87A)', () => {
      // Annual Gross ₹12,00,000 - ₹75,000 standard deduction = ₹11,25,000 taxable
      const tax = PayrollCalculator.calculateTax(1200000, newRegime);
      expect(tax.grossSalaryAnnual).toBe(1200000);
      expect(tax.standardDeduction).toBe(75000);
      expect(tax.taxableIncome).toBe(1125000);
      // Taxable income <= 12L => Rebate applies, total annual tax = 0
      expect(tax.rebate87A).toBeGreaterThan(0);
      expect(tax.totalAnnualTax).toBe(0);
      expect(tax.monthlyTds).toBe(0);
    });

    it('computes old regime tax correctly with 80C deductions', () => {
      // Annual Gross ₹10,00,000
      // Standard deduction ₹50,000 + 80C ₹1,50,000 = ₹2,00,000 deductions
      // Taxable = ₹8,00,000
      // 0-2.5L: 0, 2.5-5L: 12,500, 5-8L: 60,000 => 72,500 + 4% cess = ₹75,400
      const tax = PayrollCalculator.calculateTax(1000000, oldRegime, { '80C': 150000 });
      expect(tax.taxableIncome).toBe(800000);
      expect(tax.slabTax).toBe(72500);
      expect(tax.cess).toBe(2900);
      expect(tax.totalAnnualTax).toBe(75400);
      expect(tax.monthlyTds).toBe(Math.round(75400 / 12));
    });
  });
});
