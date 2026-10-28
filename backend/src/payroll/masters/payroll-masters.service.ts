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
        sections: { where: { isActive: true }, orderBy: { position: 'asc' } },
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
      slabs?: { fromAmount: number; toAmount?: number | null; ratePct: number; position?: number }[];
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

      return tx.payrollTaxRegime.update({
        where: { id: regId },
        data: {
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
  // 6. AUDIT LOG (W13)
  // ═══════════════════════════════════════════

  async getAuditLog(companyId: number, limit = 100) {
    return this.prisma.payrollAuditLog.findMany({
      where: { companyId },
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
