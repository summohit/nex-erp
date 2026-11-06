import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PayrollMastersService } from '../masters/payroll-masters.service';
import { isCompanyAdmin, isPayrollRole, normaliseRole } from '../../common/company-roles';
import { READABLE_DOCUMENTS } from './document-reader.service';
import { INACTIVE_USER_STATUSES } from './inactive-users';

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

/** Where a detail stands: checked by Finance, typed but unchecked, read by AI, only a file, or nothing. */
export type DetailState = 'VERIFIED' | 'UNVERIFIED' | 'SUGGESTED' | 'DOCUMENT' | 'MISSING';
const DETAIL_FIELDS: Record<'PAN' | 'UAN' | 'BANK', string[]> = { PAN: ['PAN'], UAN: ['UAN'], BANK: ['BANK_ACCOUNT', 'IFSC', 'BANK_NAME'] };

export function detailState(has: boolean, verifiedAt: Date | null, suggested: boolean, document: boolean): DetailState {
  if (has && verifiedAt) return 'VERIFIED';
  if (suggested) return 'SUGGESTED';
  if (has) return 'UNVERIFIED';
  if (document) return 'DOCUMENT';
  return 'MISSING';
}

/**
 * The CTC written in an offer letter, e.g. "Your Total emoluments are INR
 * 12,00,000 /- CTC" or "₹4,63,200 per annum". Null when no amount is found or
 * it isn't a plausible annual CTC.
 */
export function ctcFromLetter(html: string | null | undefined): number | null {
  if (!html) return null;
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const patterns = [
    /(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d+)?)\s*\/?-?\s*(?:\(.*?\)\s*)?CTC/i,
    /emoluments?[^.]{0,40}?(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d+)?)/i,
    /CTC[^.]{0,30}?(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d+)?)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const n = Number(m[1].replace(/,/g, ''));
    if (n >= 60000 && n <= 50000000) return n;
  }
  return null;
}

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
      where: { companyId, user: { status: { notIn: INACTIVE_USER_STATUSES } }, offboardingStatus: { not: 'SEPARATED' } },
      select: {
        id: true, firstName: true, lastName: true, payType: true, employmentType: true, avatarUrl: true, employeeCode: true, firstJob: true,
        user: { select: { email: true } },
        bankAccountNumber: true, ifscCode: true, panNumber: true, uanNumber: true,
        panVerifiedAt: true, uanVerifiedAt: true, bankVerifiedAt: true,
        department: { select: { name: true } },
        designation: { select: { name: true } },
        documents: { where: { documentType: { in: Object.keys(READABLE_DOCUMENTS) } }, select: { documentType: true } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    const pending = await this.prisma.employeeDetailSuggestion.findMany({
      where: { companyId, status: 'SUGGESTED', employeeId: { in: employees.map((e) => e.id) } },
      select: { employeeId: true, field: true },
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
      // No UAN for consultants, or for someone whose first job this is (they said so in their profile).
      const noUanExpected = consultant || e.firstJob;
      if (!noUanExpected && !e.uanNumber) missing.push('UAN');
      const docs = new Set(e.documents.map((d) => READABLE_DOCUMENTS[d.documentType || '']));
      const sugg = (kind: 'PAN' | 'UAN' | 'BANK') => pending.some((s) => s.employeeId === e.id && DETAIL_FIELDS[kind].includes(s.field));
      const details = {
        PAN: detailState(!!e.panNumber, e.panVerifiedAt, sugg('PAN'), docs.has('PAN')),
        UAN: noUanExpected && !e.uanNumber ? null : detailState(!!e.uanNumber, e.uanVerifiedAt, sugg('UAN'), docs.has('UAN')),
        BANK: detailState(!!(e.bankAccountNumber && e.ifscCode), e.bankVerifiedAt, sugg('BANK'), docs.has('BANK')),
      };
      return {
        details,
        employeeId: e.id,
        name: `${e.firstName} ${e.lastName}`.trim(),
        email: (e as any).user?.email ?? null,
        avatarUrl: e.avatarUrl,
        employeeCode: e.employeeCode,
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
        id: true, firstName: true, lastName: true, payType: true, employmentType: true, joiningDate: true, avatarUrl: true, employeeCode: true,
        department: { select: { name: true } }, designation: { select: { name: true } },
        bankName: true, bankAccountNumber: true, ifscCode: true,
        panNumber: true, uanNumber: true, pfNumber: true, esiNumber: true, gstin: true, gstPct: true,
        panVerifiedAt: true, uanVerifiedAt: true, bankVerifiedAt: true,
        documents: {
          where: { documentType: { in: Object.keys(READABLE_DOCUMENTS) } },
          select: { id: true, documentType: true, fileName: true, fileUrl: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    const suggestions = await this.prisma.employeeDetailSuggestion.findMany({
      where: { companyId, employeeId, OR: [{ status: 'SUGGESTED' }, { field: 'UNREADABLE' }] },
      orderBy: { createdAt: 'desc' },
    });
    const versions = await this.prisma.employeePayProfile.findMany({ where: { companyId, employeeId }, orderBy: { version: 'desc' } });
    const cur = this.current(versions);
    let breakup: any = null;
    if (cur) {
      const now = new Date();
      const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
      const financialYear = `${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`;
      const calc = await this.masters.prepareCalculator(companyId, cur.salaryGroupCode, now, { regimeCode: cur.taxRegime === 'OLD' ? 'OLD' : 'NEW', financialYear });
      breakup = calc ? calc.run(cur.annualCtc, (cur.overrides as any) ?? undefined, cur.grossMonthly) : null;
    }
    return { employee, versions, currentVersion: cur?.version ?? null, breakup, suggestions };
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
      /** NEW | OLD; null = the financial year's default */
      taxRegime?: string | null;
      overrides?: Record<string, number> | null;
      /** Monthly gross typed by Finance; null = CTC less employer contributions */
      grossMonthly?: number | null;
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

    const grossMonthly = body.grossMonthly == null || (body.grossMonthly as any) === '' ? null : Number(body.grossMonthly);
    if (grossMonthly != null && !(grossMonthly > 0)) throw new BadRequestException('Monthly gross must be more than zero.');
    if (grossMonthly != null && grossMonthly > annualCtc / 12) throw new BadRequestException('Monthly gross can\'t be more than the monthly CTC.');

    const result = calc.run(annualCtc, overrides ?? undefined, grossMonthly); // fails loudly on a broken formula
    // Basic can be raised per person but never below the group's rule (50% of CTC).
    if (overrides && 'BASIC' in overrides) {
      const { BASIC: _ignored, ...rest } = overrides;
      const ruleBasic = calc.run(annualCtc, Object.keys(rest).length ? rest : undefined, grossMonthly).lines.find((l: any) => l.code === 'BASIC')?.monthly ?? 0;
      if (overrides.BASIC + 0.5 < ruleBasic) {
        throw new BadRequestException(`Basic can't be below the group's rule (50% of CTC = ₹${Math.round(ruleBasic).toLocaleString('en-IN')} a month). Enter ₹${Math.round(ruleBasic).toLocaleString('en-IN')} or more, or leave it empty.`);
      }
    }
    // A per-person amount (e.g. a higher Basic) must still fit inside the CTC.
    const negative = (result.warnings || []).find((w: string) => /negative/i.test(w));
    if (negative) {
      throw new BadRequestException(`These amounts don't fit: ${negative} Lower the Basic or reimbursement, or change the gross or CTC.`);
    }

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
          grossMonthly,
          workerType: workerType?.value ?? null,
          paymentMethod: paymentMethod?.value ?? null,
          taxRegime: body.taxRegime === 'OLD' || body.taxRegime === 'NEW' ? body.taxRegime : null,
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

  /** PAN, UAN, PF / ESI numbers and bank details — no new salary version needed. */
  async updateDetails(companyId: number, employeeId: number, body: Record<string, string | null>, actorUserId?: number) {
    const before = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: { panNumber: true, uanNumber: true, pfNumber: true, esiNumber: true, bankName: true, bankAccountNumber: true, ifscCode: true, gstin: true, gstPct: true },
    });
    if (!before) throw new NotFoundException('Employee not found');
    const data: Record<string, any> = this.cleanStatutory(body) ?? {};
    if (!Object.keys(data).length) return before;
    // A changed number hasn't been checked against its document yet.
    if ('panNumber' in data && data.panNumber !== before.panNumber) data.panVerifiedAt = null;
    if ('uanNumber' in data && data.uanNumber !== before.uanNumber) data.uanVerifiedAt = null;
    if (('bankAccountNumber' in data && data.bankAccountNumber !== before.bankAccountNumber) || ('ifscCode' in data && data.ifscCode !== before.ifscCode)) {
      data.bankVerifiedAt = null;
    }
    const after = await this.prisma.employee.update({
      where: { id: employeeId },
      data,
      select: { panNumber: true, uanNumber: true, pfNumber: true, esiNumber: true, bankName: true, bankAccountNumber: true, ifscCode: true },
    });
    await this.audit(companyId, 'EmployeePayDetails', employeeId, 'UPDATE', before, after, actorUserId);
    return after;
  }

  /**
   * Finance has compared a detail with the document: save the value they
   * confirmed (AI suggestion or their own typing), stamp it verified, and
   * close the pending suggestions for it.
   */
  async verifyDetail(
    companyId: number,
    employeeId: number,
    body: { detail: 'PAN' | 'UAN' | 'BANK'; panNumber?: string; uanNumber?: string; bankAccountNumber?: string; ifscCode?: string; bankName?: string },
    actorUserId?: number,
  ) {
    const detail = body.detail;
    if (!['PAN', 'UAN', 'BANK'].includes(detail)) throw new BadRequestException('Pick PAN, UAN or BANK to verify.');
    const before = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: { panNumber: true, uanNumber: true, bankName: true, bankAccountNumber: true, ifscCode: true },
    });
    if (!before) throw new NotFoundException('Employee not found');

    const input =
      detail === 'PAN' ? { panNumber: body.panNumber ?? before.panNumber }
      : detail === 'UAN' ? { uanNumber: body.uanNumber ?? before.uanNumber }
      : { bankAccountNumber: body.bankAccountNumber ?? before.bankAccountNumber, ifscCode: body.ifscCode ?? before.ifscCode, bankName: body.bankName ?? before.bankName };
    const data: Record<string, any> = this.cleanStatutory(input as any) ?? {};
    if (detail === 'PAN' && !data.panNumber) throw new BadRequestException('Enter the PAN to verify.');
    if (detail === 'UAN' && !data.uanNumber) throw new BadRequestException('Enter the UAN to verify.');
    if (detail === 'BANK' && !(data.bankAccountNumber && data.ifscCode)) throw new BadRequestException('Enter the account number and IFSC to verify.');
    const stamp = new Date();
    data[detail === 'PAN' ? 'panVerifiedAt' : detail === 'UAN' ? 'uanVerifiedAt' : 'bankVerifiedAt'] = stamp;

    const confirmed: Record<string, string | null> = { PAN: data.panNumber ?? null, UAN: data.uanNumber ?? null, BANK_ACCOUNT: data.bankAccountNumber ?? null, IFSC: data.ifscCode ?? null, BANK_NAME: data.bankName ?? null };
    await this.prisma.$transaction(async (tx) => {
      await tx.employee.update({ where: { id: employeeId }, data });
      const open = await tx.employeeDetailSuggestion.findMany({
        where: { companyId, employeeId, status: 'SUGGESTED', field: { in: DETAIL_FIELDS[detail] } },
      });
      for (const sug of open) {
        // A suggestion is "verified" only if Finance kept exactly that value.
        const kept = (confirmed[sug.field] || '').toUpperCase().replace(/\s+/g, ' ') === sug.value.toUpperCase();
        await tx.employeeDetailSuggestion.update({
          where: { id: sug.id },
          data: { status: kept ? 'VERIFIED' : 'REJECTED', decidedByUserId: actorUserId ?? null, decidedAt: stamp },
        });
      }
    });
    await this.audit(companyId, 'EmployeePayDetails', employeeId, 'VERIFY', before, { detail, ...data }, actorUserId);
    return this.get(companyId, employeeId);
  }

  /** Throw away an AI suggestion that's wrong. */
  async rejectSuggestion(companyId: number, suggestionId: number, actorUserId?: number) {
    const sug = await this.prisma.employeeDetailSuggestion.findFirst({ where: { id: suggestionId, companyId } });
    if (!sug) throw new NotFoundException('Suggestion not found');
    await this.prisma.employeeDetailSuggestion.update({
      where: { id: suggestionId },
      data: { status: 'REJECTED', decidedByUserId: actorUserId ?? null, decidedAt: new Date() },
    });
    return { ok: true };
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
      if (!allowed.has(code)) throw new BadRequestException(`${code} is not part of ${group.name} v${group.version}, the version in force on the date this takes effect.`);
      if (!allowed.get(code)) throw new BadRequestException(`${code} can't be overridden in ${group.name} v${group.version}, the version in force on the date this takes effect. Pick a later date, or allow the override in that version.`);
      const n = Number(v);
      if (!(n >= 0)) throw new BadRequestException(`${code}: the amount must be zero or more.`);
      out[code] = n;
    }
    return Object.keys(out).length ? out : null;
  }

  private cleanStatutory(raw?: Record<string, any>) {
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
    const gstin = pick('gstin');
    if (gstin !== undefined) {
      if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) throw new BadRequestException('GSTIN should look like 07ABCDE1234F1Z5.');
      data.gstin = gstin;
    }
    if (raw.gstPct !== undefined) {
      const n = raw.gstPct === null || raw.gstPct === '' ? null : Number(raw.gstPct);
      if (n !== null && !(n >= 0 && n <= 28)) throw new BadRequestException('GST % must be between 0 and 28.');
      (data as any).gstPct = n;
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
          user: { status: { notIn: INACTIVE_USER_STATUSES } },
          offboardingStatus: { not: 'SEPARATED' },
        },
        select: {
          id: true, firstName: true, lastName: true, payType: true, employmentType: true, avatarUrl: true,
          designation: { select: { name: true } },
          user: { select: { email: true } },
          salaryStructures: { select: { amount: true, component: { select: { name: true, type: true } } } },
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
      this.prisma.payrollSalaryGroup.findMany({ where: { companyId, retiredAt: null, isActive: true }, orderBy: { code: 'asc' } }),
    ]);
    const withProfile = new Set(
      (await this.prisma.employeePayProfile.findMany({ where: { companyId }, select: { employeeId: true }, distinct: ['employeeId'] })).map((p) => p.employeeId),
    );

    // Last paid payslip per employee — used when no salary set-up exists (e.g. Aug paid, Sep/Oct ₹0 drafts).
    const paidSlips = await this.prisma.payslip.findMany({
      where: { companyId, employeeId: { in: employees.map((e) => e.id) }, status: { in: ['PAID', 'FINALIZED'] }, totalEarnings: { gt: 0 } },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      select: { employeeId: true, month: true, year: true, totalEarnings: true, lossOfPay: true, items: { select: { componentName: true, type: true, amount: true } } },
    });
    const lastPaid = new Map<number, (typeof paidSlips)[number]>();
    for (const p of paidSlips) if (!lastPaid.has(p.employeeId)) lastPaid.set(p.employeeId, p);

    // Offer letters by candidate email: onboarded/hired before merely offered, newest first.
    const apps = await this.prisma.jobApplication.findMany({
      where: { companyId, offeredSalary: { gt: 0 }, status: { in: ['ONBOARDED', 'HIRED', 'OFFERED'] }, email: { in: employees.map((e) => e.user?.email).filter((x): x is string => !!x) } },
      select: { email: true, offeredSalary: true, status: true, updatedAt: true },
    });
    const rank = (st: string) => (st === 'ONBOARDED' ? 0 : st === 'HIRED' ? 1 : 2);
    const offers = new Map<string, { ctc: number; status: string }>();
    for (const a of apps.sort((x, y) => rank(x.status) - rank(y.status) || +y.updatedAt - +x.updatedAt)) {
      const k = a.email.toLowerCase();
      if (!offers.has(k)) offers.set(k, { ctc: a.offeredSalary!, status: a.status });
    }

    // Offer letters generated from Employees → Letters (no candidate record):
    // the CTC is read from the letter text, newest letter first.
    const letters = await this.prisma.generatedLetter.findMany({
      where: { companyId, employeeId: { in: employees.map((e) => e.id) }, title: { contains: 'offer', mode: 'insensitive' } },
      select: { employeeId: true, body: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const letterOffers = new Map<number, { ctc: number; status: string }>();
    for (const l of letters) {
      if (letterOffers.has(l.employeeId)) continue;
      const ctc = ctcFromLetter(l.body);
      if (ctc) letterOffers.set(l.employeeId, { ctc, status: `letter of ${l.createdAt.toISOString().slice(0, 10)}` });
    }

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
      // No salary set-up: take it from the last paid payslip. Its earnings are already the full month —
      // loss of pay is deducted separately (Aug: ₹8,000 earnings, ₹1,290 LOP, ₹6,710 net).
      let source: string | null = null;
      if (!(currentGross > 0)) {
        const slip = lastPaid.get(e.id);
        if (slip) {
          for (const it of slip.items) {
            if (it.type !== 'EARNING' || !(it.amount > 0) || NOT_COMPARED.test(it.componentName)) continue;
            const code = OLD_TO_NEW[it.componentName.trim().toLowerCase()];
            if (code) current.set(code, (current.get(code) ?? 0) + it.amount);
          }
          currentGross = slip.totalEarnings;
          const month = new Date(slip.year, slip.month - 1, 1).toLocaleString('en-IN', { month: 'short', year: 'numeric' });
          source = `No salary set up in MIRA — monthly gross taken from the ${month} paid payslip (₹${Math.round(currentGross).toLocaleString('en-IN')}). Confirm before saving.`;
        }
      }
      const group = this.proposeGroup(e, groups);
      const base = { employeeId: e.id, name, avatarUrl: e.avatarUrl, payType: e.payType, employmentType: e.employmentType, currentGrossMonthly: round(currentGross) };
      if (!(currentGross > 0)) {
        // No salary was ever set up in MIRA. If they joined through an offer, its CTC is the next best thing.
        const offer = offers.get((e.user?.email || '').toLowerCase()) ?? letterOffers.get(e.id);
        if (offer && group) {
          const calcOffer = await calcFor(group.code);
          if (calcOffer) {
            const out = calcOffer.run(offer.ctc);
            rows.push({
              ...base,
              status: 'REVIEW' as ImportStatus,
              salaryGroupCode: group.code,
              salaryGroupName: group.name,
              annualCtc: offer.ctc,
              proposedGrossMonthly: out.grossMonthly,
              proposedNetMonthly: out.netPayMonthly,
              differences: [],
              warnings: [`No salary set up in MIRA — CTC taken from their offer letter (₹${Math.round(offer.ctc).toLocaleString('en-IN')}, ${offer.status.toLowerCase()}). Confirm before saving.`, ...out.warnings],
            });
            continue;
          }
        }
        rows.push({ ...base, status: 'NO_SALARY' as ImportStatus, salaryGroupCode: group?.code ?? null });
        continue;
      }
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
      const warnings = [...(source ? [source] : []), ...out.warnings];
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
  /**
   * The annual CTC that gives a monthly gross (5 Nov 2026): HR enters the gross
   * they agreed, MIRA works out the CTC for the group (employer PF/ESI on top).
   */


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
