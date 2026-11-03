import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PayrollMastersService } from '../masters/payroll-masters.service';
import { isCompanyAdmin, isPayrollRole, normaliseRole } from '../../common/company-roles';

/** Finance and company admins change pay; HR may look (Payroll plan: "who does what"). */
export function isPayrollEditor(role?: string | null): boolean {
  return isCompanyAdmin(role) || normaliseRole(role) === 'FINANCE';
}

export function assertPayrollEditor(role?: string | null) {
  if (!isPayrollEditor(role)) throw new ForbiddenException('Only Finance or an admin can change payroll settings or pay.');
}

export function assertPayrollViewer(role?: string | null) {
  if (!isPayrollRole(role)) throw new ForbiddenException('Only payroll staff can see this.');
}

/** Older groups were saved as CONTRACTOR / INTERN — same meaning as CONSULTANT / TRAINEE. */
export function payeeKind(type?: string | null): 'EMPLOYEE' | 'CONSULTANT' | 'TRAINEE' {
  if (type === 'CONSULTANT' || type === 'CONTRACTOR') return 'CONSULTANT';
  if (type === 'TRAINEE' || type === 'INTERN') return 'TRAINEE';
  return 'EMPLOYEE';
}

/**
 * The old per-employee components (SalaryComponent names) → the new component
 * codes. Used only to compare an employee's current salary with the engine's
 * breakup during the import. Tax, GST and unused heads are left out on purpose:
 * TDS comes from the tax engine (Phase 6) and GST sits on top of a fee.
 */
const OLD_TO_NEW: Record<string, string> = {
  'basic salary': 'BASIC',
  hra: 'HRA',
  'house rent allowance (hra)': 'HRA',
  'travel allowance': 'TRAVEL_ALLOWANCE',
  'conveyance allowance': 'TRAVEL_ALLOWANCE',
  'medical allowance': 'MEDICAL_ALLOWANCE',
  'special allowance': 'OTHER_ALLOWANCE',
  'provident fund (pf)': 'EMPLOYEE_PF',
  'employee state insurance (esi)': 'EMPLOYEE_ESI',
  'professional tax': 'PROFESSIONAL_TAX',
};
const NOT_COMPARED = /^(tds|income tax|gst)/i;

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const UAN = /^[0-9]{12}$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;

type ImportStatus = 'MATCH' | 'REVIEW' | 'NO_SALARY' | 'NO_GROUP';

@Injectable()
export class PayProfilesService {
  constructor(
    private prisma: PrismaService,
    private masters: PayrollMastersService,
  ) {}

  // ═══ Reading ═════════════════════════════════════════════════════════════

  /** Version in force on a date: the newest one that has started. */
  private current<T extends { effectiveFrom: Date; version: number }>(versions: T[], onDate = new Date()): T | null {
    return versions.filter((v) => v.effectiveFrom <= onDate).sort((a, b) => b.version - a.version)[0] ?? null;
  }

  /** Everyone on payroll with their current profile and what's missing — Finance's checklist. */
  async list(companyId: number) {
    const employees = await this.prisma.employee.findMany({
      where: { companyId, user: { status: { not: 'SUSPENDED' } }, offboardingStatus: { not: 'SEPARATED' } },
      select: {
        id: true, firstName: true, lastName: true, payType: true, employmentType: true,
        bankAccountNumber: true, ifscCode: true, panNumber: true, uanNumber: true,
        department: { select: { name: true } },
        designation: { select: { name: true } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    const profiles = await this.prisma.employeePayProfile.findMany({
      where: { companyId, employeeId: { in: employees.map((e) => e.id) } },
      orderBy: { version: 'desc' },
    });
    return employees.map((e) => {
      const mine = profiles.filter((p) => p.employeeId === e.id);
      const cur = this.current(mine);
      const upcoming = mine.find((p) => p.effectiveFrom > new Date()) ?? null;
      const consultant = e.payType === 'CONSULTANT';
      const missing: string[] = [];
      if (!cur) missing.push('Pay profile');
      if (!e.bankAccountNumber || !e.ifscCode) missing.push('Bank details');
      if (!e.panNumber) missing.push('PAN');
      if (!consultant && !e.uanNumber) missing.push('UAN');
      return {
        employeeId: e.id,
        name: `${e.firstName} ${e.lastName}`.trim(),
        department: e.department?.name ?? null,
        designation: e.designation?.name ?? null,
        payType: e.payType,
        current: cur && { version: cur.version, salaryGroupCode: cur.salaryGroupCode, annualCtc: cur.annualCtc, effectiveFrom: cur.effectiveFrom },
        upcoming: upcoming && { version: upcoming.version, annualCtc: upcoming.annualCtc, effectiveFrom: upcoming.effectiveFrom },
        missing,
      };
    });
  }

  /** One employee: their versions, statutory details and today's breakup from the engine. */
  async get(companyId: number, employeeId: number) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: {
        id: true, firstName: true, lastName: true, payType: true, employmentType: true, joiningDate: true,
        bankName: true, bankAccountNumber: true, ifscCode: true,
        panNumber: true, uanNumber: true, pfNumber: true, esiNumber: true,
      },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    const versions = await this.prisma.employeePayProfile.findMany({ where: { companyId, employeeId }, orderBy: { version: 'desc' } });
    const cur = this.current(versions);
    let breakup: any = null;
    if (cur) {
      const calc = await this.masters.prepareCalculator(companyId, cur.salaryGroupCode);
      breakup = calc ? calc.run(cur.annualCtc, (cur.overrides as any) ?? undefined) : null;
    }
    return { employee, versions, currentVersion: cur?.version ?? null, breakup };
  }

  // ═══ Changing ════════════════════════════════════════════════════════════

  /**
   * Add a version. Nothing is edited in place — a revision, a correction and the
   * first profile are all new versions with their own start date and reason.
   */
  async addVersion(
    companyId: number,
    employeeId: number,
    body: {
      salaryGroupCode: string;
      annualCtc: number;
      effectiveFrom: string;
      workerType?: string | null;
      paymentMethod?: string | null;
      overrides?: Record<string, number> | null;
      reason?: string | null;
      source?: string;
      employee?: {
        panNumber?: string | null; uanNumber?: string | null; pfNumber?: string | null; esiNumber?: string | null;
        bankName?: string | null; bankAccountNumber?: string | null; ifscCode?: string | null;
      };
    },
    actorUserId?: number,
  ) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId }, select: { id: true } });
    if (!employee) throw new NotFoundException('Employee not found');

    const effectiveFrom = new Date(body.effectiveFrom);
    if (isNaN(effectiveFrom.getTime())) throw new BadRequestException('Pick the date this takes effect from.');
    const annualCtc = Number(body.annualCtc);
    if (!(annualCtc > 0)) throw new BadRequestException('Annual CTC must be more than zero.');
    const code = String(body.salaryGroupCode || '').trim().toUpperCase();
    const calc = await this.masters.prepareCalculator(companyId, code, effectiveFrom);
    if (!calc) throw new BadRequestException(`No salary group "${code}" in force on that date.`);

    const workerType = await this.checkOption(companyId, 'WORKER_TYPE', body.workerType);
    const paymentMethod = await this.checkOption(companyId, 'PAYMENT_METHOD', body.paymentMethod);
    if (workerType?.paysAs && payeeKind(workerType.paysAs) !== payeeKind(calc.group.payeeType)) {
      throw new BadRequestException(
        `${workerType.label} is paid as ${payeeKind(workerType.paysAs).toLowerCase()}, but ${calc.group.name} is a ${payeeKind(calc.group.payeeType).toLowerCase()} group.`,
      );
    }

    const overrides = this.cleanOverrides(body.overrides, calc.group);
    const reason = (body.reason || '').trim().slice(0, 500) || null;
    if (overrides && !reason) throw new BadRequestException('Give a reason for the component overrides.');

    const result = calc.run(annualCtc, overrides ?? undefined); // fails loudly on a broken formula

    const statutory = this.cleanStatutory(body.employee);

    const saved = await this.prisma.$transaction(async (tx) => {
      const last = await tx.employeePayProfile.findFirst({ where: { employeeId }, orderBy: { version: 'desc' }, select: { version: true } });
      const created = await tx.employeePayProfile.create({
        data: {
          companyId,
          employeeId,
          version: (last?.version ?? 0) + 1,
          effectiveFrom,
          salaryGroupCode: code,
          annualCtc,
          workerType: workerType?.value ?? null,
          paymentMethod: paymentMethod?.value ?? null,
          overrides: overrides ?? undefined,
          reason,
          source: ['IMPORT', 'REVISION', 'OFFER'].includes(String(body.source)) ? String(body.source) : 'MANUAL',
          createdByUserId: actorUserId ?? null,
        },
      });
      if (statutory) await tx.employee.update({ where: { id: employeeId }, data: statutory });
      return created;
    });

    await this.audit(companyId, 'EmployeePayProfile', saved.id, 'CREATE', null, { ...saved, statutory }, actorUserId);
    return { profile: saved, breakup: result };
  }

  private async checkOption(companyId: number, listKey: string, value?: string | null) {
    if (!value) return null;
    const opt = await this.prisma.payrollDropdownOption.findFirst({ where: { companyId, listKey, value, isActive: true } });
    if (!opt) throw new BadRequestException(`"${value}" is not in the ${listKey.toLowerCase().replace('_', ' ')} list.`);
    return opt;
  }

  /** Only components on this group's lines that allow an override; amounts ≥ 0. */
  private cleanOverrides(raw: Record<string, number> | null | undefined, group: any): Record<string, number> | null {
    if (!raw || typeof raw !== 'object') return null;
    const allowed = new Map<string, boolean>(group.lines.map((l: any) => [l.component.code, !!l.overrideAllowed]));
    const out: Record<string, number> = {};
    for (const [code, v] of Object.entries(raw)) {
      if (v === null || v === undefined || (v as any) === '') continue;
      if (!allowed.has(code)) throw new BadRequestException(`${code} is not part of this salary group.`);
      if (!allowed.get(code)) throw new BadRequestException(`${code} can't be overridden in this salary group.`);
      const n = Number(v);
      if (!(n >= 0)) throw new BadRequestException(`${code}: the amount must be zero or more.`);
      out[code] = n;
    }
    return Object.keys(out).length ? out : null;
  }

  private cleanStatutory(raw?: Record<string, string | null | undefined>) {
    if (!raw) return null;
    const pick = (k: string) => (raw[k] === undefined ? undefined : String(raw[k] ?? '').trim().toUpperCase() || null);
    const data: Record<string, string | null> = {};
    const pan = pick('panNumber');
    if (pan !== undefined) {
      if (pan && !PAN.test(pan)) throw new BadRequestException('PAN should look like ABCDE1234F.');
      data.panNumber = pan;
    }
    const uan = pick('uanNumber');
    if (uan !== undefined) {
      if (uan && !UAN.test(uan)) throw new BadRequestException('UAN is 12 digits.');
      data.uanNumber = uan;
    }
    const ifsc = pick('ifscCode');
    if (ifsc !== undefined) {
      if (ifsc && !IFSC.test(ifsc)) throw new BadRequestException('IFSC should look like HDFC0001234.');
      data.ifscCode = ifsc;
    }
    for (const k of ['pfNumber', 'esiNumber', 'bankAccountNumber']) {
      const v = pick(k);
      if (v !== undefined) data[k] = v;
    }
    if (raw.bankName !== undefined) data.bankName = String(raw.bankName ?? '').trim() || null;
    return Object.keys(data).length ? data : null;
  }

  // ═══ Import from today's salaries ════════════════════════════════════════

  /**
   * A report, nothing saved: for each employee without a profile, the salary
   * group they'd go on and the annual CTC whose engine gross equals what they
   * are paid today, plus every component that comes out different.
   */
  async previewImport(companyId: number) {
    const [employees, groups] = await Promise.all([
      this.prisma.employee.findMany({
        where: {
          companyId,
          user: { status: { not: 'SUSPENDED' } },
          offboardingStatus: { not: 'SEPARATED' },
        },
        select: {
          id: true, firstName: true, lastName: true, payType: true, employmentType: true,
          designation: { select: { name: true } },
          salaryStructures: { select: { amount: true, component: { select: { name: true, type: true } } } },
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
      this.prisma.payrollSalaryGroup.findMany({ where: { companyId, retiredAt: null, isActive: true }, orderBy: { code: 'asc' } }),
    ]);
    const withProfile = new Set(
      (await this.prisma.employeePayProfile.findMany({ where: { companyId }, select: { employeeId: true }, distinct: ['employeeId'] })).map((p) => p.employeeId),
    );

    const calculators = new Map<string, Awaited<ReturnType<PayrollMastersService['prepareCalculator']>>>();
    const calcFor = async (code: string) => {
      if (!calculators.has(code)) calculators.set(code, await this.masters.prepareCalculator(companyId, code));
      return calculators.get(code)!;
    };

    const rows: any[] = [];
    for (const e of employees) {
      if (withProfile.has(e.id)) continue;
      const name = `${e.firstName} ${e.lastName}`.trim();
      const current = new Map<string, number>();
      let currentGross = 0;
      for (const s of e.salaryStructures) {
        if (!(s.amount > 0)) continue;
        const oldName = s.component.name.trim();
        if (NOT_COMPARED.test(oldName)) continue;
        const code = OLD_TO_NEW[oldName.toLowerCase()];
        if (s.component.type === 'EARNING') currentGross += s.amount;
        if (code) current.set(code, (current.get(code) ?? 0) + s.amount);
      }
      const group = this.proposeGroup(e, groups);
      const base = { employeeId: e.id, name, payType: e.payType, employmentType: e.employmentType, currentGrossMonthly: round(currentGross) };
      if (!(currentGross > 0)) { rows.push({ ...base, status: 'NO_SALARY' as ImportStatus, salaryGroupCode: group?.code ?? null }); continue; }
      if (!group) { rows.push({ ...base, status: 'NO_GROUP' as ImportStatus, salaryGroupCode: null }); continue; }

      const calc = await calcFor(group.code);
      if (!calc) { rows.push({ ...base, status: 'NO_GROUP' as ImportStatus, salaryGroupCode: group.code }); continue; }
      const annualCtc = this.solveCtc(calc.run, currentGross);
      const out = calc.run(annualCtc);
      const proposed = new Map(out.lines.map((l) => [l.code, l.monthly]));
      const differences: { code: string; current: number; proposed: number }[] = [];
      for (const code of new Set([...current.keys(), ...out.lines.filter((l) => l.category === 'EARNING' || l.category === 'EMPLOYEE_DEDUCTION').map((l) => l.code)])) {
        if (code === 'TDS') continue;
        const a = round(current.get(code) ?? 0);
        const b = round(proposed.get(code) ?? 0);
        if (Math.abs(a - b) > 1) differences.push({ code, current: a, proposed: b });
      }
      const grossOk = Math.abs(out.grossMonthly - currentGross) <= 1;
      // Things Finance must look at before approving this row.
      const warnings = [...out.warnings];
      for (const l of out.lines) {
        if (l.monthly < 0) warnings.push(`${l.name} comes out negative (₹${l.monthly}) — this group doesn't fit a salary this low.`);
      }
      if (!grossOk) warnings.push(`Closest gross is ₹${out.grossMonthly}, not ₹${round(currentGross)} — check the CTC.`);
      rows.push({
        ...base,
        status: (grossOk && differences.length === 0 && warnings.length === 0 ? 'MATCH' : 'REVIEW') as ImportStatus,
        warnings,
        salaryGroupCode: group.code,
        salaryGroupName: group.name,
        annualCtc,
        proposedGrossMonthly: out.grossMonthly,
        proposedNetMonthly: out.netPayMonthly,
        differences,
      });
    }
    const count = (s: ImportStatus) => rows.filter((r) => r.status === s).length;
    return {
      summary: { total: rows.length, match: count('MATCH'), review: count('REVIEW'), noSalary: count('NO_SALARY'), noGroup: count('NO_GROUP'), alreadyHaveProfile: withProfile.size },
      groups: groups.map((g) => ({ code: g.code, name: g.name, payeeType: payeeKind(g.payeeType) })),
      rows,
    };
  }

  /** Consultants → a consultant group, trainees → a trainee group, everyone else → capped-PF employee group. */
  private proposeGroup(
    e: { payType: string; employmentType: string | null; designation: { name: string } | null },
    groups: { code: string; name: string; payeeType: string }[],
  ) {
    const trainee = /trainee|intern/i.test(e.employmentType || '') || /trainee|intern/i.test(e.designation?.name || '');
    const kind = e.payType === 'CONSULTANT' ? 'CONSULTANT' : trainee ? 'TRAINEE' : 'EMPLOYEE';
    const ofKind = groups.filter((g) => payeeKind(g.payeeType) === kind);
    if (kind === 'EMPLOYEE') return ofKind.find((g) => g.code === 'REGULAR_PF_CAPPED') ?? ofKind[0] ?? null;
    return ofKind[0] ?? null;
  }

  /** Annual CTC whose engine gross matches today's gross (gross rises with CTC, so bisect). */
  private solveCtc(run: (annualCtc: number) => { grossMonthly: number }, targetGrossMonthly: number): number {
    let lo = 0;
    let hi = targetGrossMonthly * 12 * 2 + 600000;
    for (let i = 0; i < 60 && hi - lo > 1; i++) {
      const mid = (lo + hi) / 2;
      if (run(mid).grossMonthly < targetGrossMonthly) lo = mid;
      else hi = mid;
    }
    return Math.round(hi);
  }

  /** Save version 1 for the rows Finance approved (group and CTC as they left them). */
  async applyImport(
    companyId: number,
    body: { effectiveFrom: string; rows: { employeeId: number; salaryGroupCode: string; annualCtc: number }[] },
    actorUserId?: number,
  ) {
    if (!Array.isArray(body.rows) || !body.rows.length) throw new BadRequestException('Pick at least one employee.');
    const results: { employeeId: number; ok: boolean; error?: string }[] = [];
    for (const r of body.rows) {
      const has = await this.prisma.employeePayProfile.count({ where: { companyId, employeeId: Number(r.employeeId) } });
      if (has) { results.push({ employeeId: r.employeeId, ok: false, error: 'Already has a pay profile' }); continue; }
      try {
        await this.addVersion(companyId, Number(r.employeeId), {
          salaryGroupCode: r.salaryGroupCode,
          annualCtc: r.annualCtc,
          effectiveFrom: body.effectiveFrom,
          reason: 'Imported from the salary set up before pay profiles',
          source: 'IMPORT',
        }, actorUserId);
        results.push({ employeeId: r.employeeId, ok: true });
      } catch (err: any) {
        results.push({ employeeId: r.employeeId, ok: false, error: err?.message || 'Failed' });
      }
    }
    return { saved: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok), results };
  }

  private async audit(companyId: number, entity: string, entityId: number, action: string, before: any, after: any, actorUserId?: number) {
    try {
      await this.prisma.payrollAuditLog.create({
        data: { companyId, entity, entityId, action, before: before ?? undefined, after: after ?? undefined, actorUserId },
      });
    } catch {
      /* the change itself is saved; a missing audit row must not undo it */
    }
  }
}

const round = (n: number) => Math.round(n * 100) / 100;
