/**
 * MIRA Central Payroll Calculation Engine (Phase 2, Task 2.1).
 *
 * Pure, deterministic salary and tax calculation service.
 * Used identically across:
 *   - Offer letter annexures & preview
 *   - Onboarding pay profile creation
 *   - Finance salary calculator screen (W7)
 *   - Monthly payroll run calculation
 *
 * Implements exact business logic from Finance workbook:
 *   `MNC_Payroll_PF_Min_15000.xlsx`
 */

import {
  evaluateCondition,
  evaluateFormula,
  EvaluationContext,
} from './formula-evaluator';
import {
  ComponentCategory,
  RATE_VARIABLES,
  SEED_COMPONENTS,
  SEED_STATUTORY_RATES,
  SEED_TAX_REGIMES,
  SeedComponent,
  SeedSalaryGroup,
  SeedStatutoryRate,
  SeedTaxRegime,
} from '../masters/payroll-seed-data';

export interface CalculationInput {
  annualCtc?: number;
  monthlyCtc?: number;
  salaryGroup: SeedSalaryGroup;
  statutoryRates?: SeedStatutoryRate[];
  components?: SeedComponent[];
  taxRegime?: SeedTaxRegime;
  declarations?: { [sectionCode: string]: number };
  componentOverrides?: { [componentCode: string]: number };
}

export interface CalculatedLine {
  code: string;
  name: string;
  category: ComponentCategory;
  monthly: number;
  annual: number;
  partOfCtc: boolean;
  partOfGross: boolean;
  taxable: boolean;
  reduceForLop: boolean;
  showOnPayslip: boolean;
  showOnAnnexure: boolean;
  formula?: string;
  notes?: string;
}

export interface TaxSlabBreakdown {
  from: number;
  to: number | null;
  ratePct: number;
  taxableInSlab: number;
  taxAmount: number;
}

export interface TaxCalculationResult {
  regimeCode: 'NEW' | 'OLD';
  grossSalaryAnnual: number;
  standardDeduction: number;
  totalSectionDeductions: number;
  taxableIncome: number;
  slabTax: number;
  rebate87A: number;
  marginalRelief: number;
  taxAfterRebate: number;
  surcharge: number;
  cess: number;
  totalAnnualTax: number;
  monthlyTds: number;
  slabBreakdown: TaxSlabBreakdown[];
}

export interface CalculationOutput {
  ctcMonthly: number;
  ctcAnnual: number;
  grossMonthly: number;
  grossAnnual: number;
  totalEarningsMonthly: number;
  totalEarningsAnnual: number;
  totalDeductionsMonthly: number;
  totalDeductionsAnnual: number;
  totalEmployerContributionsMonthly: number;
  totalEmployerContributionsAnnual: number;
  netPayMonthly: number;
  netPayAnnual: number;
  lines: CalculatedLine[];
  tax?: TaxCalculationResult;
  warnings: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export class PayrollCalculator {
  /**
   * Main calculation entrypoint.
   */
  public static calculate(input: CalculationInput): CalculationOutput {
    const warnings: string[] = [];

    // 1. Resolve Monthly CTC and Annual CTC
    let ctcMonthly: number;
    let ctcAnnual: number;

    if (input.monthlyCtc != null && input.monthlyCtc >= 0) {
      ctcMonthly = round2(input.monthlyCtc);
      ctcAnnual = round2(ctcMonthly * 12);
    } else if (input.annualCtc != null && input.annualCtc >= 0) {
      ctcAnnual = round2(input.annualCtc);
      ctcMonthly = round2(ctcAnnual / 12);
    } else {
      throw new Error('Either annualCtc or monthlyCtc must be provided as a non-negative number');
    }

    const rates = input.statutoryRates || SEED_STATUTORY_RATES;
    const allComponents = input.components || SEED_COMPONENTS;
    const componentMap = new Map(allComponents.map((c) => [c.code, c]));

    // 2. Build Rate context
    const context: EvaluationContext = {
      CTC_MONTHLY: ctcMonthly,
      CTC_ANNUAL: ctcAnnual,
    };

    for (const [varName, { code, field }] of Object.entries(RATE_VARIABLES)) {
      const r = rates.find((rate) => rate.code === code);
      if (r && r[field] != null) {
        context[varName] = r[field]!;
      } else {
        context[varName] = 0;
      }
    }

    const overrides = input.componentOverrides || {};
    const lines = input.salaryGroup.lines;
    const computedValues = new Map<string, number>();

    // 3. First pass: Evaluate non-balancing lines before the balancing line
    let balancingLineIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const compCode = line.component;

      if (line.calcType === 'BALANCING') {
        if (balancingLineIndex !== -1) {
          warnings.push(`Multiple BALANCING lines found in group ${input.salaryGroup.code}. Only one will balance.`);
        }
        balancingLineIndex = i;
        // Lines after BALANCING depend on the balancing line, so evaluate them after step 5
        break;
      }

      // Check condition
      if (line.condition) {
        const conditionMet = evaluateCondition(line.condition, context);
        if (!conditionMet) {
          computedValues.set(compCode, 0);
          context[compCode] = 0;
          continue;
        }
      }

      let val = 0;
      if (compCode in overrides) {
        val = overrides[compCode];
      } else if (line.calcType === 'FIXED') {
        val = line.amount ?? 0;
      } else if (line.calcType === 'FORMULA') {
        val = line.formula ? evaluateFormula(line.formula, context) : 0;
      } else if (line.calcType === 'INPUT') {
        val = 0; // Default 0 for monthly inputs in template calculation
      }

      val = round2(val);
      computedValues.set(compCode, val);
      context[compCode] = val;
    }

    // 4. Calculate Gross & Employer Contributions
    let totalEmployerShare = 0;
    for (const [code, val] of computedValues.entries()) {
      const comp = componentMap.get(code);
      if (comp?.category === 'EMPLOYER_CONTRIBUTION') {
        totalEmployerShare += val;
      }
    }
    totalEmployerShare = round2(totalEmployerShare);

    // Gross Salary = CTC - Employer contributions
    const grossMonthly = round2(ctcMonthly - totalEmployerShare);
    context['GROSS'] = grossMonthly;

    // 5. Evaluate the BALANCING line (e.g. OTHER_ALLOWANCE)
    if (balancingLineIndex !== -1) {
      const line = lines[balancingLineIndex];
      const compCode = line.component;

      // In employee structures, balancing line fills earnings up to Gross
      if (input.salaryGroup.payeeType === 'EMPLOYEE') {
        let otherEarningsSum = 0;
        for (const [code, val] of computedValues.entries()) {
          const comp = componentMap.get(code);
          if (comp?.category === 'EARNING' && code !== compCode) {
            otherEarningsSum += val;
          }
        }
        const balancingAmount = round2(grossMonthly - otherEarningsSum);
        if (balancingAmount < 0) {
          warnings.push(
            `Balancing allowance (${compCode}) is negative (${balancingAmount}). Base floor or fixed allowances exceed Gross at CTC ₹${ctcMonthly}.`,
          );
        }
        computedValues.set(compCode, balancingAmount);
        context[compCode] = balancingAmount;
      } else if (input.salaryGroup.payeeType === 'CONSULTANT') {
        // In consultant structures, fee = CTC
        computedValues.set(compCode, ctcMonthly);
        context[compCode] = ctcMonthly;
      } else {
        // Trainee: balance against CTC
        let otherSum = 0;
        for (const [code, val] of computedValues.entries()) {
          if (code !== compCode) otherSum += val;
        }
        const balancingAmount = round2(ctcMonthly - otherSum);
        computedValues.set(compCode, balancingAmount);
        context[compCode] = balancingAmount;
      }

      // Re-evaluate subsequent lines after balancing line (e.g. TDS = CONSULTANT_FEE * 2 / 100)
      for (let i = balancingLineIndex + 1; i < lines.length; i++) {
        const subsequentLine = lines[i];
        const subCode = subsequentLine.component;
        if (subsequentLine.condition) {
          const conditionMet = evaluateCondition(subsequentLine.condition, context);
          if (!conditionMet) {
            computedValues.set(subCode, 0);
            context[subCode] = 0;
            continue;
          }
        }
        let val = 0;
        if (subCode in overrides) {
          val = overrides[subCode];
        } else if (subsequentLine.calcType === 'FIXED') {
          val = subsequentLine.amount ?? 0;
        } else if (subsequentLine.calcType === 'FORMULA' && subsequentLine.formula) {
          val = evaluateFormula(subsequentLine.formula, context);
        }
        val = round2(val);
        computedValues.set(subCode, val);
        context[subCode] = val;
      }
    }

    // 6. Build final calculated line items
    const calculatedLines: CalculatedLine[] = [];
    let totalEarnings = 0;
    let totalDeductions = 0;
    let totalEmployerContributions = 0;

    for (const line of lines) {
      const code = line.component;
      const comp = componentMap.get(code);
      if (!comp) continue;

      const monthlyVal = computedValues.get(code) ?? 0;
      const annualVal = round2(monthlyVal * 12);

      if (comp.category === 'EARNING') totalEarnings += monthlyVal;
      else if (comp.category === 'EMPLOYEE_DEDUCTION') totalDeductions += monthlyVal;
      else if (comp.category === 'EMPLOYER_CONTRIBUTION') totalEmployerContributions += monthlyVal;

      calculatedLines.push({
        code: comp.code,
        name: comp.name,
        category: comp.category,
        monthly: monthlyVal,
        annual: annualVal,
        partOfCtc: comp.partOfCtc,
        partOfGross: comp.partOfGross,
        taxable: comp.taxable,
        reduceForLop: comp.reduceForLop,
        showOnPayslip: comp.showOnPayslip,
        showOnAnnexure: comp.showOnAnnexure,
        formula: line.formula ?? undefined,
      });
    }

    totalEarnings = round2(totalEarnings);
    totalDeductions = round2(totalDeductions);
    totalEmployerContributions = round2(totalEmployerContributions);
    const netPayMonthly = round2(totalEarnings - totalDeductions);
    const netPayAnnual = round2(netPayMonthly * 12);

    // 7. Calculate Tax if a Tax Regime is selected or requested
    let taxResult: TaxCalculationResult | undefined;
    if (input.taxRegime) {
      taxResult = this.calculateTax(grossMonthly * 12, input.taxRegime, input.declarations);
    }

    return {
      ctcMonthly,
      ctcAnnual,
      grossMonthly,
      grossAnnual: round2(grossMonthly * 12),
      totalEarningsMonthly: totalEarnings,
      totalEarningsAnnual: round2(totalEarnings * 12),
      totalDeductionsMonthly: totalDeductions,
      totalDeductionsAnnual: round2(totalDeductions * 12),
      totalEmployerContributionsMonthly: totalEmployerContributions,
      totalEmployerContributionsAnnual: round2(totalEmployerContributions * 12),
      netPayMonthly,
      netPayAnnual,
      lines: calculatedLines,
      tax: taxResult,
      warnings,
    };
  }

  /**
   * Annual income tax calculation under specified Tax Regime (New or Old).
   */
  public static calculateTax(
    annualGross: number,
    regime: SeedTaxRegime,
    declarations: { [sectionCode: string]: number } = {},
  ): TaxCalculationResult {
    const standardDeduction = regime.standardDeduction || 0;

    // Tally eligible declarations against section maxLimits
    let totalSectionDeductions = 0;
    if (regime.code === 'OLD') {
      for (const sec of regime.sections) {
        const declared = declarations[sec.code] || 0;
        if (declared > 0) {
          const eligible = sec.maxLimit != null ? Math.min(declared, sec.maxLimit) : declared;
          totalSectionDeductions += eligible;
        }
      }
    }

    const totalDeductions = standardDeduction + totalSectionDeductions;
    const taxableIncome = Math.max(0, annualGross - totalDeductions);

    // Calculate slab tax
    const slabBreakdown: TaxSlabBreakdown[] = [];
    let slabTax = 0;

    for (const slab of regime.slabs) {
      const from = slab.from;
      const to = slab.to;
      const rate = slab.ratePct;

      if (taxableIncome > from) {
        const slabUpper = to != null ? Math.min(taxableIncome, to) : taxableIncome;
        const taxableInSlab = Math.max(0, slabUpper - from);
        const taxAmount = round2((taxableInSlab * rate) / 100);

        slabTax += taxAmount;
        slabBreakdown.push({
          from,
          to,
          ratePct: rate,
          taxableInSlab,
          taxAmount,
        });
      } else {
        slabBreakdown.push({
          from,
          to,
          ratePct: rate,
          taxableInSlab: 0,
          taxAmount: 0,
        });
      }
    }
    slabTax = round2(slabTax);

    // Rebate u/s 87A
    let rebate87A = 0;
    let marginalRelief = 0;

    if (regime.code === 'NEW') {
      if (taxableIncome <= regime.rebateIncomeLimit) {
        rebate87A = Math.min(slabTax, regime.rebateMaxAmount);
      } else {
        // Marginal relief for New Regime: tax on income above rebate limit cannot exceed (taxableIncome - rebateLimit)
        const excessIncome = taxableIncome - regime.rebateIncomeLimit;
        if (slabTax > excessIncome) {
          marginalRelief = round2(slabTax - excessIncome);
        }
      }
    } else {
      // Old Regime rebate u/s 87A (taxable income <= 5L, rebate up to 12.5k)
      if (taxableIncome <= regime.rebateIncomeLimit) {
        rebate87A = Math.min(slabTax, regime.rebateMaxAmount);
      }
    }

    const taxAfterRebate = Math.max(0, round2(slabTax - rebate87A - marginalRelief));

    // Surcharge
    let surcharge = 0;
    if (regime.surcharge && regime.surcharge.length > 0) {
      const sortedSurcharge = [...regime.surcharge].sort((a, b) => b.fromIncome - a.fromIncome);
      const appliedBand = sortedSurcharge.find((s) => taxableIncome > s.fromIncome);
      if (appliedBand) {
        surcharge = round2((taxAfterRebate * appliedBand.ratePct) / 100);
      }
    }

    // Health & Education Cess
    const cess = round2(((taxAfterRebate + surcharge) * regime.cessPct) / 100);
    const totalAnnualTax = round2(taxAfterRebate + surcharge + cess);
    const monthlyTds = Math.round(totalAnnualTax / 12);

    return {
      regimeCode: regime.code,
      grossSalaryAnnual: round2(annualGross),
      standardDeduction,
      totalSectionDeductions,
      taxableIncome,
      slabTax,
      rebate87A,
      marginalRelief,
      taxAfterRebate,
      surcharge,
      cess,
      totalAnnualTax,
      monthlyTds,
      slabBreakdown,
    };
  }
}
