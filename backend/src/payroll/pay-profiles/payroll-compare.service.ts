import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PayrollMastersService } from '../masters/payroll-masters.service';
import { INACTIVE_USER_STATUSES } from './inactive-users';
import { payeeKind } from './pay-profiles.service';

/** The pieces pay is compared on. OTHER = every deduction that isn't statutory. */
export interface PayBreakdown {
  gross: number;
  pf: number;
  esi: number;
  pt: number;
  tds: number;
  other: number;
  net: number;
}

type Piece = keyof Omit<PayBreakdown, 'gross' | 'net'>;
const LABEL: Record<Piece | 'gross', string> = { gross: 'Gross', pf: 'PF', esi: 'ESI', pt: 'Professional Tax', tds: 'TDS', other: 'Other deductions' };

/** Old deduction lines (free-text names) → which statutory piece they are. */
export function oldDeductionPiece(name: string): Piece {
  const n = name.toLowerCase();
  if (n.includes('provident') || /\bpf\b/.test(n)) return 'pf';
  if (n.includes('state insurance') || /\besi/.test(n)) return 'esi';
  if (n.includes('professional tax') || /\bpt\b/.test(n)) return 'pt';
  if (n.includes('tds') || n.includes('income tax')) return 'tds';
  return 'other';
}

/** Engine component codes → statutory piece. */
const ENGINE_PIECE: Record<string, Piece> = { EMPLOYEE_PF: 'pf', EMPLOYEE_ESI: 'esi', PROFESSIONAL_TAX: 'pt', TDS: 'tds' };

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The current monthly run's rules, for one employee's old salary set-up, on a
 * full month (before loss of pay). Mirrors PayrollService.previewPayroll so
 * the comparison is against what payroll actually does today.
 */
export function oldPay(structure: { amount: number; component: { name: string; type: string } | null }[]): PayBreakdown | null {
  let gross = 0;
  let basic = 0;
  const b: PayBreakdown = { gross: 0, pf: 0, esi: 0, pt: 0, tds: 0, other: 0, net: 0 };
  const names: string[] = [];
  for (const s of structure) {
    const amt = s.amount || 0;
    if (!s.component) continue;
    names.push(s.component.name);
    if (s.component.type === 'EARNING') {
      gross += amt;
      if (s.component.name.toLowerCase().includes('basic')) basic = amt;
    } else if (s.component.type === 'DEDUCTION') {
      b[oldDeductionPiece(s.component.name)] += amt;
    }
  }
  if (gross <= 0) return null;
  const has = (phrase: string) => names.some((n) => n.toLowerCase().includes(phrase.toLowerCase()));
  const statutoryBasic = basic || gross * 0.5;
  if (statutoryBasic > 0 && !has('Provident Fund')) b.pf += Math.round(statutoryBasic * 0.12);
  if (gross <= 21000 && !has('State Insurance')) b.esi += Math.round(gross * 0.0075);
  if (gross > 15000 && !has('Professional Tax')) b.pt += 200;
  if (gross > 50000 && !has('TDS')) b.tds += Math.round((gross - 50000) * 0.1);
  b.gross = r2(gross);
  b.net = r2(Math.max(0, gross - b.pf - b.esi - b.pt - b.tds - b.other));
  return b;
}

/** Why a piece changed, in words Finance can act on. */
function reason(piece: Piece | 'gross', before: number, after: number, ctx: { regime: string | null; payee: string }): string {
  const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
  const base = `${LABEL[piece]}: ${money(before)} → ${money(after)}`;
  switch (piece) {
    case 'tds':
      return ctx.payee === 'CONSULTANT'
        ? `${base} — new: flat TDS % of the fee from the salary group`
        : `${base} — old: 10% of gross above ₹50,000/month; new: income-tax slabs (${ctx.regime ?? 'no'} regime), yearly tax ÷ 12`;
    case 'pf':
      return `${base} — old: 12% of Basic; new: the salary group's PF line (PF_BASE, capped at the wage ceiling unless the group says full Basic)`;
    case 'esi':
      return `${base} — new: the salary group's ESI line and its condition (e.g. only when gross ≤ ₹21,000)`;
    case 'pt':
      return `${base} — old: flat ₹200 above ₹15,000; new: Professional Tax rate for the state in Statutory Rates`;
    case 'gross':
      return `${base} — the pay profile's CTC and group give a different gross than the old salary set-up`;
    default:
      return `${base} — deductions entered on the old salary set-up aren't in the salary group`;
  }
}

@Injectable()
export class PayrollCompareService {
  constructor(
    private prisma: PrismaService,
    private masters: PayrollMastersService,
  ) {}

  /**
   * Old run vs the engine for one month, per employee, on a full month (loss of
   * pay works the same for both and is left out). Read-only: nothing is saved.
   */
  async compare(companyId: number, month: number, year: number) {
    if (!(month >= 1 && month <= 12) || !(year >= 2000 && year <= 2100)) throw new BadRequestException('Pick a valid month and year.');
    const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59));
    const fyStart = month >= 4 ? year : year - 1;
    const financialYear = `${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`;
    const yearSetting = await this.masters.getYearSetting(companyId, financialYear);
    const regimeCode = (yearSetting.defaultRegimeCode === 'OLD' ? 'OLD' : 'NEW') as 'NEW' | 'OLD';

    const employees = await this.prisma.employee.findMany({
      where: {
        companyId,
        allowPayrollGenerate: true,
        offboardingStatus: { not: 'SEPARATED' },
        user: { status: { notIn: INACTIVE_USER_STATUSES } },
      },
      select: {
        id: true, firstName: true, lastName: true, avatarUrl: true, employeeCode: true, payType: true,
        department: { select: { name: true } },
        salaryStructures: { select: { amount: true, component: { select: { name: true, type: true } } } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    const profiles = await this.prisma.employeePayProfile.findMany({
      where: { companyId, employeeId: { in: employees.map((e) => e.id) }, effectiveFrom: { lte: monthEnd } },
      orderBy: { version: 'desc' },
    });
    const inForce = new Map<number, (typeof profiles)[number]>();
    for (const p of profiles) if (!inForce.has(p.employeeId)) inForce.set(p.employeeId, p);

    const calcs = new Map<string, Awaited<ReturnType<PayrollMastersService['prepareCalculator']>>>();
    const calcFor = async (code: string) => {
      if (!calcs.has(code)) calcs.set(code, await this.masters.prepareCalculator(companyId, code, monthEnd, { regimeCode, financialYear }));
      return calcs.get(code)!;
    };

    const rows: any[] = [];
    for (const e of employees) {
      const before = oldPay(e.salaryStructures);
      const profile = inForce.get(e.id);
      const base = {
        employeeId: e.id,
        name: `${e.firstName} ${e.lastName}`.trim(),
        avatarUrl: e.avatarUrl,
        employeeCode: e.employeeCode,
        department: e.department?.name ?? null,
      };
      if (!profile) {
        rows.push({ ...base, status: before ? 'NO_PROFILE' : 'NO_SALARY', old: before, new: null, diffNet: null, reasons: [] });
        continue;
      }
      const calc = await calcFor(profile.salaryGroupCode);
      if (!calc) {
        rows.push({ ...base, status: 'NO_GROUP', salaryGroupCode: profile.salaryGroupCode, old: before, new: null, diffNet: null, reasons: [] });
        continue;
      }
      const payee = payeeKind(calc.group.payeeType);
      let out;
      try {
        out = calc.run(profile.annualCtc, (profile.overrides as any) ?? undefined);
      } catch (err: any) {
        rows.push({ ...base, status: 'ERROR', salaryGroupCode: profile.salaryGroupCode, old: before, new: null, diffNet: null, reasons: [err?.message || 'Calculation failed'] });
        continue;
      }
      const after: PayBreakdown = { gross: r2(out.grossMonthly), pf: 0, esi: 0, pt: 0, tds: 0, other: 0, net: 0 };
      for (const l of out.lines) {
        if (l.category !== 'EMPLOYEE_DEDUCTION') continue;
        after[ENGINE_PIECE[l.code] ?? 'other'] += l.monthly;
      }
      // Employees: TDS comes from the tax slabs, not a group line.
      if (payee === 'EMPLOYEE' && out.tax) after.tds = out.tax.monthlyTds;
      (['pf', 'esi', 'pt', 'tds', 'other'] as Piece[]).forEach((k) => (after[k] = r2(after[k])));
      after.net = r2(Math.max(0, after.gross - after.pf - after.esi - after.pt - after.tds - after.other));

      const reasons: string[] = [];
      if (before) {
        for (const k of ['gross', 'pf', 'esi', 'pt', 'tds', 'other'] as const) {
          if (Math.abs(before[k] - after[k]) > 1) reasons.push(reason(k, before[k], after[k], { regime: calc.hasTax ? regimeCode : null, payee }));
        }
      }
      const diffNet = before ? r2(after.net - before.net) : null;
      rows.push({
        ...base,
        status: !before ? 'NEW_ONLY' : Math.abs(diffNet!) <= 1 ? 'SAME' : 'DIFFERENT',
        salaryGroupCode: profile.salaryGroupCode,
        annualCtc: profile.annualCtc,
        old: before,
        new: after,
        diffNet,
        reasons,
      });
    }

    const sum = (pick: (r: any) => number | null | undefined) => r2(rows.reduce((t, r) => t + (pick(r) || 0), 0));
    const compared = rows.filter((r) => r.old && r.new);
    const count = (s: string) => rows.filter((r) => r.status === s).length;
    return {
      month,
      year,
      financialYear,
      regimeCode,
      summary: {
        employees: rows.length,
        compared: compared.length,
        same: count('SAME'),
        different: count('DIFFERENT'),
        noProfile: count('NO_PROFILE'),
        noSalary: count('NO_SALARY'),
        newOnly: count('NEW_ONLY'),
        errors: count('ERROR') + count('NO_GROUP'),
        // Totals over employees present on both sides, so they're like-for-like.
        oldGross: r2(compared.reduce((t, r) => t + r.old.gross, 0)),
        newGross: r2(compared.reduce((t, r) => t + r.new.gross, 0)),
        oldNet: r2(compared.reduce((t, r) => t + r.old.net, 0)),
        newNet: r2(compared.reduce((t, r) => t + r.new.net, 0)),
        oldTds: r2(compared.reduce((t, r) => t + r.old.tds, 0)),
        newTds: r2(compared.reduce((t, r) => t + r.new.tds, 0)),
        totalNetChange: sum((r) => r.diffNet),
      },
      rows: rows.sort((a, b) => Math.abs(b.diffNet ?? 0) - Math.abs(a.diffNet ?? 0)),
    };
  }
}
