import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CalculationInput,
  CalculationOutput,
  PayrollCalculator,
} from '../engine/payroll-calculator';
import {
  evaluateFormula,
  extractVariableReferences,
} from '../engine/formula-evaluator';
import { RATE_VARIABLES } from './payroll-seed-data';

/** Starting values for the payroll dropdowns (plan W6). Finance edits them in Payroll Rules. */
const DROPDOWN_DEFAULTS: Record<string, { name: string; options: string[] }> = {
  PAYMENT_METHOD: { name: 'Payment methods', options: ['Bank transfer', 'UPI', 'Cheque', 'Cash'] },
  CONTRACT_LENGTH: { name: 'Contract lengths', options: ['6 months', '1 year', '2 years'] },
  WORKER_TYPE: { name: 'Worker types', options: ['Employee', 'Trainee', 'Technical consultant', 'Non-technical consultant'] },
};

function dropdownValue(label: string): string {
  return label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'OPTION';
}

/** "2026-27" from "2026-27", "2026-2027" or "2026". */
function normaliseFy(fy: string): string {
  const m = String(fy || '').match(/^(\d{4})/);
  if (!m) throw new BadRequestException('Financial year must look like 2026-27');
  const y = Number(m[1]);
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

function parseDate(v: any): Date | null {
  if (v == null || v === '') return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) throw new BadRequestException(`Invalid date: ${v}`);
  return d;
}

@Injectable()
export class PayrollMastersService {
  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════
  // 1. SALARY COMPONENTS (W1, W2)
  // ═══════════════════════════════════════════

  async getComponents(companyId: number) {
    return this.prisma.payrollComponent.findMany({
      where: { companyId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async getComponentByCode(companyId: number, code: string) {
    const comp = await this.prisma.payrollComponent.findUnique({
      where: { companyId_code: { companyId, code } },
    });
    if (!comp) throw new NotFoundException(`Component ${code} not found`);
    return comp;
  }

  async createComponent(
    companyId: number,
    data: {
      code: string;
      name: string;
      category: string;
      partOfCtc?: boolean;
      partOfGross?: boolean;
      taxable?: boolean;
      reduceForLop?: boolean;
      showOnPayslip?: boolean;
      showOnAnnexure?: boolean;
      displayOrder?: number;
      description?: string;
    },
    actorUserId?: number,
  ) {
    const code = data.code.toUpperCase().trim();
    const existing = await this.prisma.payrollComponent.findUnique({
      where: { companyId_code: { companyId, code } },
    });
    if (existing) {
      throw new BadRequestException(`Component code '${code}' already exists`);
    }

    // Employer contributions must default to showOnPayslip = false (Finance rule)
    const showOnPayslip =
      data.category === 'EMPLOYER_CONTRIBUTION'
        ? (data.showOnPayslip ?? false)
        : (data.showOnPayslip ?? true);

    const comp = await this.prisma.payrollComponent.create({
      data: {
        companyId,
        code,
        name: data.name.trim(),
        category: data.category,
        partOfCtc: data.partOfCtc ?? true,
        partOfGross: data.category === 'EARNING' ? (data.partOfGross ?? true) : false,
        taxable: data.taxable ?? true,
        reduceForLop: data.reduceForLop ?? true,
        showOnPayslip,
        showOnAnnexure: data.showOnAnnexure ?? true,
        displayOrder: data.displayOrder ?? 0,
        description: data.description,
      },
    });

    await this.logAudit(companyId, 'PayrollComponent', comp.id, 'CREATE', null, comp, actorUserId);
    return comp;
  }

  async updateComponent(
    companyId: number,
    id: number,
    data: {
      name?: string;
      partOfCtc?: boolean;
      partOfGross?: boolean;
      taxable?: boolean;
      reduceForLop?: boolean;
      showOnPayslip?: boolean;
      showOnAnnexure?: boolean;
      displayOrder?: number;
      isActive?: boolean;
      description?: string;
    },
    actorUserId?: number,
  ) {
    const compId = Number(id);
    const compCompanyId = Number(companyId);
    const existing = await this.prisma.payrollComponent.findFirst({
      where: { id: compId, companyId: compCompanyId },
    });
    if (!existing) throw new NotFoundException('Component not found');

    const updated = await this.prisma.payrollComponent.update({
      where: { id: compId },
      data: {
        ...(data.name && { name: data.name.trim() }),
        ...(data.partOfCtc !== undefined && { partOfCtc: data.partOfCtc }),
        ...(data.partOfGross !== undefined && { partOfGross: data.partOfGross }),
        ...(data.taxable !== undefined && { taxable: data.taxable }),
        ...(data.reduceForLop !== undefined && { reduceForLop: data.reduceForLop }),
        ...(data.showOnPayslip !== undefined && { showOnPayslip: data.showOnPayslip }),
        ...(data.showOnAnnexure !== undefined && { showOnAnnexure: data.showOnAnnexure }),
        ...(data.displayOrder !== undefined && { displayOrder: data.displayOrder }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.description !== undefined && { description: data.description }),
      },
    });

    await this.logAudit(compCompanyId, 'PayrollComponent', compId, 'UPDATE', existing, updated, actorUserId);
    return updated;
  }

  async deleteComponent(companyId: number, id: number, actorUserId?: number) {
    const compId = Number(id);
    const compCompanyId = Number(companyId);
    const existing = await this.prisma.payrollComponent.findFirst({
      where: { id: compId, companyId: compCompanyId },
    });
    if (!existing) throw new NotFoundException('Component not found');
    if (existing.isSystem) {
      throw new BadRequestException(`System component '${existing.code}' cannot be deleted.`);
    }

    const usedInGroup = await this.prisma.payrollSalaryGroupLine.findFirst({
      where: { componentId: compId },
    });
    if (usedInGroup) {
      throw new BadRequestException(`Component '${existing.code}' is actively used in one or more Salary Structures.`);
    }

    await this.prisma.payrollComponent.delete({
      where: { id: compId },
    });

    await this.logAudit(compCompanyId, 'PayrollComponent', compId, 'DELETE', existing, null, actorUserId);
    return { success: true, message: `Component '${existing.code}' deleted successfully.` };
  }

  // ═══════════════════════════════════════════
  // 2. SALARY GROUPS & FORMULA LINES (W3)
  // ═══════════════════════════════════════════

  async getSalaryGroups(companyId: number, includeRetired = false) {
    return this.prisma.payrollSalaryGroup.findMany({
      where: {
        companyId: Number(companyId),
        ...(includeRetired ? {} : { retiredAt: null, isActive: true }),
      },
      include: {
        lines: {
          include: { component: true },
          orderBy: { displayOrder: 'asc' },
        },
      },
      orderBy: [{ id: 'asc' }],
    });
  }

  async getSalaryGroupById(companyId: number, id: number) {
    const grpId = Number(id);
    const grpCompanyId = Number(companyId);
    const group = await this.prisma.payrollSalaryGroup.findFirst({
      where: { id: grpId, companyId: grpCompanyId },
      include: {
        lines: {
          include: { component: true },
          orderBy: { displayOrder: 'asc' },
        },
      },
    });
    if (!group) throw new NotFoundException(`Salary group #${id} not found`);
    return group;
  }

  async saveSalaryGroupVersion(
    companyId: number,
    data: {
      code: string;
      name: string;
      description?: string;
      payeeType?: string;
      flatTdsPct?: number;
      gstApplicable?: boolean;
      pfWageBasis?: string;
      effectiveFrom: string;
      lines: {
        componentId: number;
        calcType: string;
        amount?: number;
        formula?: string;
        condition?: string;
        overrideAllowed?: boolean;
        displayOrder?: number;
      }[];
    },
    actorUserId?: number,
  ) {
    const code = data.code.toUpperCase().trim();

    // Check existing version
    const latest = await this.prisma.payrollSalaryGroup.findFirst({
      where: { companyId, code },
      orderBy: { version: 'desc' },
    });

    const newVersion = latest ? latest.version + 1 : 1;
    const effectiveDate = new Date(data.effectiveFrom);

    return this.prisma.$transaction(async (tx) => {
      // If retiring previous version:
      if (latest) {
        await tx.payrollSalaryGroup.update({
          where: { id: latest.id },
          data: { retiredAt: effectiveDate },
        });
      }

      const created = await tx.payrollSalaryGroup.create({
        data: {
          companyId,
          code,
          version: newVersion,
          name: data.name.trim(),
          description: data.description,
          payeeType: data.payeeType || 'EMPLOYEE',
          flatTdsPct: data.flatTdsPct ?? null,
          gstApplicable: data.gstApplicable ?? false,
          pfWageBasis: data.pfWageBasis === 'FULL_BASIC' ? 'FULL_BASIC' : 'CAPPED',
          effectiveFrom: effectiveDate,
          lines: {
            create: data.lines.map((l, index) => ({
              componentId: l.componentId,
              calcType: l.calcType,
              amount: l.amount ?? null,
              formula: l.formula ?? null,
              condition: l.condition ?? null,
              overrideAllowed: l.overrideAllowed ?? false,
              displayOrder: l.displayOrder ?? (index + 1) * 10,
            })),
          },
        },
        include: {
          lines: {
            include: { component: true },
          },
        },
      });

      await this.logAudit(companyId, 'PayrollSalaryGroup', created.id, 'CREATE', latest, created, actorUserId);
      return created;
    });
  }

  // ═══════════════════════════════════════════
  // 3. STATUTORY RATES (W5)
  // ═══════════════════════════════════════════

  async getStatutoryRates(companyId: number) {
    return this.prisma.payrollStatutoryRate.findMany({
      where: { companyId, isActive: true },
      orderBy: [{ code: 'asc' }, { stateCode: 'asc' }, { effectiveFrom: 'desc' }],
    });
  }

  async saveStatutoryRate(
    companyId: number,
    data: {
      code: string;
      stateCode?: string | null;
      ratePct?: number | null;
      wageCeiling?: number | null;
      eligibilityLimit?: number | null;
      fixedAmount?: number | null;
      slabs?: any;
      notes?: string;
      effectiveFrom: string;
    },
    actorUserId?: number,
  ) {
    const effectiveDate = new Date(data.effectiveFrom);
    const rate = await this.prisma.payrollStatutoryRate.upsert({
      where: {
        companyId_code_stateCode_effectiveFrom: {
          companyId,
          code: data.code,
          stateCode: data.stateCode ?? '',
          effectiveFrom: effectiveDate,
        },
      },
      update: {
        ratePct: data.ratePct ?? null,
        wageCeiling: data.wageCeiling ?? null,
        eligibilityLimit: data.eligibilityLimit ?? null,
        fixedAmount: data.fixedAmount ?? null,
        slabs: data.slabs ?? null,
        notes: data.notes,
      },
      create: {
        companyId,
        code: data.code,
        stateCode: data.stateCode ?? null,
        ratePct: data.ratePct ?? null,
        wageCeiling: data.wageCeiling ?? null,
        eligibilityLimit: data.eligibilityLimit ?? null,
        fixedAmount: data.fixedAmount ?? null,
        slabs: data.slabs ?? null,
        notes: data.notes,
        effectiveFrom: effectiveDate,
      },
    });

    await this.logAudit(companyId, 'PayrollStatutoryRate', rate.id, 'UPDATE', null, rate, actorUserId);
    return rate;
  }

  async updateStatutoryRate(
    companyId: number,
    id: number,
    data: {
      ratePct?: number | null;
      wageCeiling?: number | null;
      eligibilityLimit?: number | null;
      fixedAmount?: number | null;
      notes?: string;
    },
    actorUserId?: number,
  ) {
    const rateId = Number(id);
    const rateCompanyId = Number(companyId);
    const existing = await this.prisma.payrollStatutoryRate.findFirst({
      where: { id: rateId, companyId: rateCompanyId },
    });
    if (!existing) throw new NotFoundException('Statutory rate not found');

    const updated = await this.prisma.payrollStatutoryRate.update({
      where: { id: rateId },
      data: {
        ...(data.ratePct !== undefined && { ratePct: data.ratePct != null ? Number(data.ratePct) : null }),
        ...(data.wageCeiling !== undefined && { wageCeiling: data.wageCeiling != null ? Number(data.wageCeiling) : null }),
        ...(data.eligibilityLimit !== undefined && { eligibilityLimit: data.eligibilityLimit != null ? Number(data.eligibilityLimit) : null }),
        ...(data.fixedAmount !== undefined && { fixedAmount: data.fixedAmount != null ? Number(data.fixedAmount) : null }),
        ...(data.notes !== undefined && { notes: data.notes?.trim() }),
      },
    });

    await this.logAudit(rateCompanyId, 'PayrollStatutoryRate', rateId, 'UPDATE', existing, updated, actorUserId);
    return updated;
  }

  // ═══════════════════════════════════════════
  // 4. TAX REGIMES (W4)
  // ═══════════════════════════════════════════

  async getTaxRegimes(companyId: number, financialYear: string) {
    return this.prisma.payrollTaxRegime.findMany({
      where: { companyId, financialYear, isActive: true },
      include: {
        slabs: { orderBy: { position: 'asc' } },
        // All sections, switched-off ones too, so Finance can turn them back on.
        // The calculator only uses active ones (see calculateSalary).
        sections: { orderBy: { position: 'asc' } },
      },
    });
  }

  async updateTaxRegime(
    companyId: number,
    id: number,
    data: {
      standardDeduction?: number;
      rebateIncomeLimit?: number;
      rebateMaxAmount?: number;
      cessPct?: number;
      surcharge?: { fromIncome: number; ratePct: number }[];
      slabs?: { fromAmount: number; toAmount?: number | null; ratePct: number; position?: number }[];
      /** Deduction sections (old regime): limit, proof needed, on/off. Matched by code. */
      sections?: { code: string; maxLimit?: number | null; proofRequired?: boolean; isActive?: boolean }[];
    },
    actorUserId?: number,
  ) {
    const regId = Number(id);
    const regCompanyId = Number(companyId);
    const existing = await this.prisma.payrollTaxRegime.findFirst({
      where: { id: regId, companyId: regCompanyId },
      include: { slabs: true },
    });
    if (!existing) throw new NotFoundException('Tax regime not found');

    const updated = await this.prisma.$transaction(async (tx) => {
      if (data.slabs && data.slabs.length > 0) {
        await tx.payrollTaxSlab.deleteMany({ where: { regimeId: regId } });
        await tx.payrollTaxSlab.createMany({
          data: data.slabs.map((s, idx) => ({
            regimeId: regId,
            fromAmount: Number(s.fromAmount),
            toAmount: s.toAmount != null ? Number(s.toAmount) : null,
            ratePct: Number(s.ratePct),
            position: s.position ?? idx,
          })),
        });
      }

      for (const sec of data.sections || []) {
        await tx.payrollTaxSection.updateMany({
          where: { regimeId: regId, code: String(sec.code) },
          data: {
            ...(sec.maxLimit !== undefined && { maxLimit: sec.maxLimit == null ? null : Number(sec.maxLimit) }),
            ...(sec.proofRequired !== undefined && { proofRequired: !!sec.proofRequired }),
            ...(sec.isActive !== undefined && { isActive: !!sec.isActive }),
          },
        });
      }

      return tx.payrollTaxRegime.update({
        where: { id: regId },
        data: {
          ...(data.surcharge !== undefined && {
            surcharge: (data.surcharge || [])
              .map((b) => ({ fromIncome: Number(b.fromIncome), ratePct: Number(b.ratePct) }))
              .filter((b) => b.fromIncome > 0 && b.ratePct >= 0) as any,
          }),
          ...(data.standardDeduction !== undefined && { standardDeduction: Number(data.standardDeduction) }),
          ...(data.rebateIncomeLimit !== undefined && { rebateIncomeLimit: Number(data.rebateIncomeLimit) }),
          ...(data.rebateMaxAmount !== undefined && { rebateMaxAmount: Number(data.rebateMaxAmount) }),
          ...(data.cessPct !== undefined && { cessPct: Number(data.cessPct) }),
        },
        include: { slabs: { orderBy: { position: 'asc' } }, sections: true },
      });
    });

    await this.logAudit(regCompanyId, 'PayrollTaxRegime', regId, 'UPDATE', existing, updated, actorUserId);
    return updated;
  }

  // ═══════════════════════════════════════════
  // 5. CALCULATION SERVICE & FORMULA VALIDATION (W2, W7)
  // ═══════════════════════════════════════════

  /**
   * Evaluates and validates a formula expression against available components.
   */
  async validateFormula(
    companyId: number,
    formula: string,
    sampleCtc = 600000,
  ) {
    try {
      const vars = extractVariableReferences(formula);
      const components = await this.getComponents(companyId);
      const knownCodes = new Set([
        'CTC_MONTHLY',
        'CTC_ANNUAL',
        'GROSS',
        'PF_BASE',
        ...Object.keys(RATE_VARIABLES),
        ...components.map((c) => c.code),
      ]);

      const unknown = vars.filter((v) => !knownCodes.has(v));
      if (unknown.length > 0) {
        return {
          valid: false,
          error: `Formula references unknown variables: ${unknown.join(', ')}`,
          variables: vars,
        };
      }

      // Try evaluation with sample values
      const sampleCtx: Record<string, number> = {
        CTC_MONTHLY: sampleCtc / 12,
        CTC_ANNUAL: sampleCtc,
        GROSS: sampleCtc / 12 * 0.95,
        BASIC: sampleCtc / 12 * 0.5,
        BASIC_FLOOR: 13780,
        PF_EMPLOYER_PCT: 12,
        PF_EMPLOYEE_PCT: 12,
        PF_WAGE_CEILING: 15000,
        PF_BASE: Math.min(sampleCtc / 12 * 0.5, 15000),
        ESI_EMPLOYER_PCT: 3.25,
        ESI_EMPLOYEE_PCT: 0.75,
        ESI_LIMIT: 21000,
        PT_AMOUNT: 0,
        GST_PCT: 18,
      };

      const result = evaluateFormula(formula, sampleCtx);
      return {
        valid: true,
        sampleResult: result,
        variables: vars,
      };
    } catch (err: any) {
      return {
        valid: false,
        error: err.message,
      };
    }
  }

  /**
   * Run salary calculation using the unified Calculation Engine.
   */
  async calculateSalary(
    companyId: number,
    params: {
      annualCtc?: number;
      monthlyCtc?: number;
      groupId?: number;
      groupCode?: string;
      regimeCode?: 'NEW' | 'OLD';
      financialYear?: string;
      declarations?: { [sectionCode: string]: number };
      overrides?: { [componentCode: string]: number };
    },
  ): Promise<CalculationOutput> {
    // 1. Fetch Salary Group
    let group: any;
    const rawGid = params.groupId !== undefined && params.groupId !== null ? Number(params.groupId) : NaN;
    if (!isNaN(rawGid)) {
      group = await this.getSalaryGroupById(companyId, rawGid);
    } else if (params.groupCode) {
      group = await this.prisma.payrollSalaryGroup.findFirst({
        where: { companyId, code: params.groupCode, retiredAt: null },
        include: {
          lines: {
            include: { component: true },
            orderBy: { displayOrder: 'asc' },
          },
        },
      });
    }

    if (!group) throw new NotFoundException('Salary group not found');

    // 2. Fetch statutory rates & components
    const statutoryRates = await this.getStatutoryRates(companyId);
    const components = await this.getComponents(companyId);

    // 3. Fetch tax regime if requested
    let taxRegime: any;
    const fy = params.financialYear || '2026-27';
    if (params.regimeCode) {
      taxRegime = await this.prisma.payrollTaxRegime.findUnique({
        where: {
          companyId_code_financialYear: {
            companyId,
            code: params.regimeCode,
            financialYear: fy,
          },
        },
        include: {
          slabs: { orderBy: { position: 'asc' } },
          sections: { where: { isActive: true }, orderBy: { position: 'asc' } },
        },
      });
    }

    // 4. Adapt DB models to Calculation Engine format
    const calcInput: CalculationInput = {
      annualCtc: params.annualCtc,
      monthlyCtc: params.monthlyCtc,
      salaryGroup: {
        code: group.code,
        name: group.name,
        description: group.description ?? '',
        payeeType: group.payeeType,
        flatTdsPct: group.flatTdsPct ?? undefined,
        gstApplicable: group.gstApplicable,
        pfWageBasis: group.pfWageBasis === 'FULL_BASIC' ? 'FULL_BASIC' : 'CAPPED',
        sheet: '',
        lines: group.lines.map((l: any) => ({
          component: l.component.code,
          calcType: l.calcType,
          amount: l.amount ?? undefined,
          formula: l.formula ?? undefined,
          condition: l.condition ?? undefined,
          overrideAllowed: l.overrideAllowed,
        })),
      },
      statutoryRates: statutoryRates.map((r) => ({
        code: r.code,
        stateCode: r.stateCode,
        ratePct: r.ratePct ?? undefined,
        wageCeiling: r.wageCeiling ?? undefined,
        eligibilityLimit: r.eligibilityLimit ?? undefined,
        fixedAmount: r.fixedAmount ?? undefined,
        notes: r.notes ?? '',
      })),
      components: components.map((c) => ({
        code: c.code,
        name: c.name,
        category: c.category as any,
        partOfCtc: c.partOfCtc,
        partOfGross: c.partOfGross,
        taxable: c.taxable,
        reduceForLop: c.reduceForLop,
        showOnPayslip: c.showOnPayslip,
        showOnAnnexure: c.showOnAnnexure,
        displayOrder: c.displayOrder,
      })),
      taxRegime: taxRegime
        ? {
            code: taxRegime.code,
            name: taxRegime.name,
            standardDeduction: taxRegime.standardDeduction,
            rebateIncomeLimit: taxRegime.rebateIncomeLimit,
            rebateMaxAmount: taxRegime.rebateMaxAmount,
            cessPct: taxRegime.cessPct,
            surcharge: (taxRegime.surcharge as any) ?? [],
            isDefault: taxRegime.isDefault,
            slabs: taxRegime.slabs.map((s: any) => ({
              from: s.fromAmount,
              to: s.toAmount,
              ratePct: s.ratePct,
            })),
            sections: taxRegime.sections.map((s: any) => ({
              code: s.code,
              name: s.name,
              maxLimit: s.maxLimit,
              proofRequired: s.proofRequired,
            })),
          }
        : undefined,
      declarations: params.declarations,
      componentOverrides: params.overrides,
    };

    return PayrollCalculator.calculate(calcInput);
  }

  // ═══════════════════════════════════════════
  // 5a. FORMULA HELP — every name a formula or condition may use
  // ═══════════════════════════════════════════

  /**
   * The names Finance can type into a formula or condition, what each means,
   * where its value comes from, and its value today. Built from RATE_VARIABLES
   * and the live rates/components, so it always matches what the engine reads.
   */
  async getFormulaHelp(companyId: number) {
    const [rates, components] = await Promise.all([this.getStatutoryRates(companyId), this.getComponents(companyId)]);
    const fieldLabel: Record<string, string> = {
      ratePct: 'Rate %',
      wageCeiling: 'Wage ceiling',
      eligibilityLimit: 'Eligibility limit',
      fixedAmount: 'Fixed amount',
    };
    const rateMeaning: Record<string, string> = {
      PF_EMPLOYEE_PCT: 'Employee PF rate, in %',
      PF_EMPLOYER_PCT: 'Employer PF rate, in %',
      PF_WAGE_CEILING: 'PF wage ceiling (₹ per month) — PF is capped at this wage',
      ESI_EMPLOYEE_PCT: 'Employee ESI rate, in %',
      ESI_EMPLOYER_PCT: 'Employer ESI rate, in %',
      ESI_LIMIT: 'ESI applies only at or below this monthly wage (₹)',
      PT_AMOUNT: 'Professional Tax amount for the state (₹ per month)',
      BASIC_FLOOR: 'Minimum monthly Basic (₹)',
      GST_PCT: 'GST rate added to a consultant fee, in %',
    };

    const salary = [
      { name: 'CTC_MONTHLY', meaning: 'The employee\'s CTC for one month (annual CTC ÷ 12)', source: 'The CTC entered for the employee (or in the calculator)', when: 'Any line' },
      { name: 'CTC_ANNUAL', meaning: 'The employee\'s yearly CTC', source: 'The CTC entered for the employee (or in the calculator)', when: 'Any line' },
      { name: 'GROSS', meaning: 'Monthly gross salary = CTC_MONTHLY − employer contributions (employer PF, employer ESI…)', source: 'Worked out by the engine just before the Balancing line', when: 'Only lines below the Balancing line, and the Balancing line itself' },
      { name: 'PF_BASE', meaning: 'Wage PF is charged on: Basic capped at PF_WAGE_CEILING, or full Basic', source: 'The salary group\'s "PF wage base" setting + BASIC', when: 'Any line below BASIC' },
    ];

    const rateVars = Object.entries(RATE_VARIABLES).map(([name, { code, field }]) => {
      const r = rates.find((x) => x.code === code && x.isActive !== false);
      const value = r ? (r as any)[field] : null;
      return {
        name,
        meaning: rateMeaning[name] || '',
        source: `Statutory Rates → ${code} → ${fieldLabel[field]}`,
        value: value ?? null,
      };
    });

    const componentVars = components
      .filter((c) => c.isActive !== false)
      .map((c) => ({ name: c.code, meaning: c.name, category: c.category }));

    return {
      salary,
      rates: rateVars,
      components: componentVars,
      functions: [
        { name: 'MIN(a, b, …)', meaning: 'The smallest value', example: 'MIN(BASIC, 15000)' },
        { name: 'MAX(a, b, …)', meaning: 'The largest value', example: 'MAX(CTC_MONTHLY * 0.5, BASIC_FLOOR)' },
        { name: 'ROUND(x, d)', meaning: 'Round to d decimals (default 0)', example: 'ROUND(BASIC * 0.4)' },
        { name: 'FLOOR(x) / CEIL(x)', meaning: 'Round down / up to a whole rupee', example: 'FLOOR(GROSS * 0.0075)' },
        { name: 'IF(test, then, else)', meaning: 'Pick a value based on a test', example: 'IF(GROSS <= ESI_LIMIT, GROSS * ESI_EMPLOYEE_PCT / 100, 0)' },
      ],
      operators: ['+  −  *  /', '( ) for grouping', '<  <=  >  >=  ==  !=', 'AND  OR  NOT'],
    };
  }

  // ═══════════════════════════════════════════
  // 5b. YEAR SETTINGS, COMPANY CONFIG, DROPDOWNS (Phase 1)
  // ═══════════════════════════════════════════

  /** Year settings for one FY. Not saved yet → the decided starting values (3 Nov 2026), unsaved. */
  async getYearSetting(companyId: number, financialYear: string) {
    const fy = normaliseFy(financialYear);
    const saved = await this.prisma.payrollYearSetting.findUnique({
      where: { companyId_financialYear: { companyId, financialYear: fy } },
    });
    if (saved) return { ...saved, saved: true };
    const startYear = Number(fy.slice(0, 4));
    return {
      companyId,
      financialYear: fy,
      defaultRegimeCode: 'NEW',
      regimeLockDate: new Date(Date.UTC(startYear, 3, 30)), // 30 April
      newJoinerChoiceDays: 30,
      tdsMethod: 'SPREAD',
      proofWindowStart: new Date(Date.UTC(startYear + 1, 0, 1)), // 1 Jan
      proofWindowEnd: new Date(Date.UTC(startYear + 1, 1, 28)), // 28 Feb
      saved: false,
    };
  }

  async saveYearSetting(
    companyId: number,
    financialYear: string,
    data: {
      defaultRegimeCode?: string;
      regimeLockDate?: string;
      newJoinerChoiceDays?: number;
      tdsMethod?: string;
      proofWindowStart?: string | null;
      proofWindowEnd?: string | null;
    },
    actorUserId?: number,
  ) {
    const fy = normaliseFy(financialYear);
    const before = await this.getYearSetting(companyId, fy);
    const regime = data.defaultRegimeCode ?? before.defaultRegimeCode;
    if (!['NEW', 'OLD'].includes(regime)) throw new BadRequestException('Default regime must be NEW or OLD');
    const method = data.tdsMethod ?? before.tdsMethod;
    if (!['SPREAD', 'FIXED'].includes(method)) throw new BadRequestException('TDS method must be SPREAD or FIXED');
    const days = data.newJoinerChoiceDays ?? before.newJoinerChoiceDays;
    if (!(Number.isInteger(Number(days)) && Number(days) >= 0 && Number(days) <= 365)) {
      throw new BadRequestException('New-joiner window must be 0–365 days');
    }
    const lock = parseDate(data.regimeLockDate) ?? before.regimeLockDate;
    const proofStart = data.proofWindowStart === undefined ? before.proofWindowStart : parseDate(data.proofWindowStart);
    const proofEnd = data.proofWindowEnd === undefined ? before.proofWindowEnd : parseDate(data.proofWindowEnd);
    if (proofStart && proofEnd && proofEnd < proofStart) throw new BadRequestException('Proof window ends before it starts');

    const values = {
      defaultRegimeCode: regime,
      regimeLockDate: lock,
      newJoinerChoiceDays: Number(days),
      tdsMethod: method,
      proofWindowStart: proofStart,
      proofWindowEnd: proofEnd,
    };
    const saved = await this.prisma.payrollYearSetting.upsert({
      where: { companyId_financialYear: { companyId, financialYear: fy } },
      create: { companyId, financialYear: fy, ...values },
      update: values,
    });
    // Keep the regimes' "default" flag in step with the year's default.
    await this.prisma.payrollTaxRegime.updateMany({ where: { companyId, financialYear: fy }, data: { isDefault: false } });
    await this.prisma.payrollTaxRegime.updateMany({ where: { companyId, financialYear: fy, code: regime }, data: { isDefault: true } });
    await this.logAudit(companyId, 'PayrollYearSetting', saved.id, before.saved ? 'UPDATE' : 'CREATE', before.saved ? before : null, saved, actorUserId);
    return { ...saved, saved: true };
  }

  async getCompanyConfig(companyId: number) {
    const saved = await this.prisma.payrollCompanyConfig.findUnique({ where: { companyId } });
    return saved
      ? { ...saved, saved: true }
      : { companyId, gradeBasis: 'MONTHLY_GROSS', costingWorkingDays: 26, costingHoursPerDay: 8, costingIncludeEmployer: true, saved: false };
  }

  async saveCompanyConfig(
    companyId: number,
    data: { gradeBasis?: string; costingWorkingDays?: number; costingHoursPerDay?: number; costingIncludeEmployer?: boolean },
    actorUserId?: number,
  ) {
    const before = await this.getCompanyConfig(companyId);
    const gradeBasis = data.gradeBasis ?? before.gradeBasis;
    if (!['MONTHLY_GROSS', 'ANNUAL_CTC'].includes(gradeBasis)) throw new BadRequestException('Grade basis must be MONTHLY_GROSS or ANNUAL_CTC');
    const workingDays = Number(data.costingWorkingDays ?? before.costingWorkingDays);
    const hours = Number(data.costingHoursPerDay ?? before.costingHoursPerDay);
    if (!(workingDays > 0 && workingDays <= 31)) throw new BadRequestException('Working days per month must be 1–31');
    if (!(hours > 0 && hours <= 24)) throw new BadRequestException('Hours per day must be 1–24');
    const values = {
      gradeBasis,
      costingWorkingDays: workingDays,
      costingHoursPerDay: hours,
      costingIncludeEmployer: data.costingIncludeEmployer ?? before.costingIncludeEmployer,
    };
    const saved = await this.prisma.payrollCompanyConfig.upsert({ where: { companyId }, create: { companyId, ...values }, update: values });
    await this.logAudit(companyId, 'PayrollCompanyConfig', saved.id, before.saved ? 'UPDATE' : 'CREATE', before.saved ? before : null, saved, actorUserId);
    return { ...saved, saved: true };
  }

  /** Every dropdown list; lists never saved come back with their starting values (unsaved). */
  async getDropdowns(companyId: number) {
    const rows = await this.prisma.payrollDropdownOption.findMany({
      where: { companyId, isActive: true },
      orderBy: [{ listKey: 'asc' }, { position: 'asc' }],
    });
    return Object.entries(DROPDOWN_DEFAULTS).map(([listKey, meta]) => {
      const options = rows.filter((r) => r.listKey === listKey);
      return {
        listKey,
        name: meta.name,
        saved: options.length > 0,
        options: options.length
          ? options.map((o) => ({ value: o.value, label: o.label }))
          : meta.options.map((label) => ({ value: dropdownValue(label), label })),
      };
    });
  }

  /** Replace one list. Removed options are switched off, not deleted — payslips may refer to them. */
  async saveDropdown(companyId: number, listKey: string, labels: string[], actorUserId?: number) {
    if (!(listKey in DROPDOWN_DEFAULTS)) throw new BadRequestException('Unknown dropdown list');
    const clean = [...new Set((labels || []).map((l) => String(l || '').trim()).filter(Boolean))];
    if (!clean.length) throw new BadRequestException('A list needs at least one option');
    if (clean.some((l) => l.length > 80)) throw new BadRequestException('Options must be 80 characters or fewer');
    const before = (await this.getDropdowns(companyId)).find((d) => d.listKey === listKey);

    await this.prisma.$transaction(async (tx) => {
      await tx.payrollDropdownOption.updateMany({ where: { companyId, listKey }, data: { isActive: false } });
      for (const [i, label] of clean.entries()) {
        const value = dropdownValue(label);
        await tx.payrollDropdownOption.upsert({
          where: { companyId_listKey_value: { companyId, listKey, value } },
          create: { companyId, listKey, value, label, position: i, isActive: true },
          update: { label, position: i, isActive: true },
        });
      }
    });
    const after = (await this.getDropdowns(companyId)).find((d) => d.listKey === listKey);
    await this.logAudit(companyId, 'PayrollDropdown', 0, 'UPDATE', before, after, actorUserId);
    return after;
  }

  // ═══════════════════════════════════════════
  // 6. AUDIT LOG (W13)
  // ═══════════════════════════════════════════

  /** Latest changes; pass entity + entityId for one record's history (e.g. a component). */
  async getAuditLog(companyId: number, limit = 100, entity?: string, entityId?: number) {
    return this.prisma.payrollAuditLog.findMany({
      where: { companyId, ...(entity && { entity }), ...(entityId && { entityId }) },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  private async logAudit(
    companyId: number,
    entity: string,
    entityId: number,
    action: string,
    before: any,
    after: any,
    actorUserId?: number,
  ) {
    try {
      await this.prisma.payrollAuditLog.create({
        data: {
          companyId,
          entity,
          entityId,
          action,
          before: before ? (before as any) : undefined,
          after: after ? (after as any) : undefined,
          actorUserId,
        },
      });
    } catch (e) {
      console.error('Failed to write payroll audit log:', e);
    }
  }
}
