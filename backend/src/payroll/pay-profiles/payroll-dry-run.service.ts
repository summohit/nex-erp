import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { lopDivisor, PayrollMastersService } from '../masters/payroll-masters.service';
import { PayrollService } from '../payroll.service';
import { INACTIVE_USER_STATUSES } from './inactive-users';
import { payeeKind } from './pay-profiles.service';
import { isLopExempt } from '../lop-exempt';

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface DryRunLine {
  code: string;
  name: string;
  /** Full-month amount from the engine */
  full: number;
  /** After loss of pay (earnings) / recalculated on pay earned (PF, ESI) */
  paid: number;
}

/**
 * Loss of pay for one month: only earnings marked "reduce for loss of pay" go
 * down, by absent days ÷ working days. Exported for tests.
 */
export function applyLossOfPay(
  earnings: { code: string; name: string; monthly: number; reduceForLop: boolean }[],
  /** Days one month's pay is divided by (calendar days by default — see lopDivisor). */
  dayDivisor: number,
  absences: number,
): { lines: DryRunLine[]; lossOfPay: number } {
  const share = dayDivisor > 0 ? Math.min(1, Math.max(0, absences / dayDivisor)) : 0;
  let lossOfPay = 0;
  const lines = earnings.map((e) => {
    const cut = e.reduceForLop ? r2(e.monthly * share) : 0;
    lossOfPay += cut;
    return { code: e.code, name: e.name, full: r2(e.monthly), paid: r2(e.monthly - cut) };
  });
  return { lines, lossOfPay: r2(lossOfPay) };
}

/**
 * Payroll plan Phase 3, dry run: each employee's payslip for a month worked
 * out with the new engine and their pay profile, including loss of pay from
 * attendance. Nothing is saved — real payslips and drafts are not touched.
 */
@Injectable()
export class PayrollDryRunService {
  constructor(
    private prisma: PrismaService,
    private masters: PayrollMastersService,
    private payroll: PayrollService,
  ) {}

  /**
   * fullMonth: ignore attendance (a month still in progress, or before attendance is clean).
   * currentProfiles: for a month before the profiles start, use each employee's
   * first profile and the salary group from that date — so Finance can check the
   * engine against a month already paid, with that month's attendance.
   */
  async run(companyId: number, month: number, year: number, fullMonth = false, currentProfiles = false) {
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
        id: true, firstName: true, lastName: true, avatarUrl: true, employeeCode: true,
        department: { select: { name: true } }, designation: { select: { name: true } },
        bankAccountNumber: true, panNumber: true, gstin: true,
        user: { select: { role: true } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    const profiles = await this.prisma.employeePayProfile.findMany({
      where: { companyId, employeeId: { in: employees.map((e) => e.id) } },
      orderBy: { version: 'desc' },
    });
    const inForce = new Map<number, (typeof profiles)[number]>();
    for (const p of profiles) if (p.effectiveFrom <= monthEnd && !inForce.has(p.employeeId)) inForce.set(p.employeeId, p);
    const borrowed = new Set<number>();
    if (currentProfiles) {
      // Earliest version per employee, for those with nothing in force yet.
      for (const p of [...profiles].reverse()) {
        if (inForce.has(p.employeeId)) continue;
        inForce.set(p.employeeId, p);
        borrowed.add(p.employeeId);
      }
    }

    const attendance = fullMonth ? new Map() : await this.payroll.attendanceForMonth(companyId, month, year, [...inForce.keys()]);

    const companyConfig = await this.masters.getCompanyConfig(companyId);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

    // Statutory rates for recalculating PF / ESI on pay actually earned.
    const rates = await this.masters.getStatutoryRates(companyId);
    const rate = (code: string, field: 'ratePct' | 'wageCeiling' | 'eligibilityLimit') =>
      (rates.find((x: any) => x.code === code && x.isActive !== false) as any)?.[field] ?? null;
    const pfPct = Number(rate('PF_EMPLOYEE', 'ratePct') ?? 12);
    const pfCeiling = Number(rate('PF_EMPLOYER', 'wageCeiling') ?? 15000);
    const esiPct = Number(rate('ESI_EMPLOYEE', 'ratePct') ?? 0.75);
    const esiLimit = Number(rate('ESI_EMPLOYER', 'eligibilityLimit') ?? 21000);
    const gstPct = Number(rate('GST', 'ratePct') ?? 18);

    const calcs = new Map<string, Awaited<ReturnType<PayrollMastersService['prepareCalculator']>>>();
    const calcFor = async (code: string, onDate: Date, regime: 'NEW' | 'OLD') => {
      const key = `${code}@${onDate.toISOString()}@${regime}`;
      if (!calcs.has(key)) calcs.set(key, await this.masters.prepareCalculator(companyId, code, onDate, { regimeCode: regime, financialYear }));
      return calcs.get(key)!;
    };

    const rows: any[] = [];
    for (const e of employees) {
      const base = {
        employeeId: e.id,
        name: `${e.firstName} ${e.lastName}`.trim(),
        avatarUrl: e.avatarUrl,
        employeeCode: e.employeeCode,
        department: e.department?.name ?? null,
        designation: e.designation?.name ?? null,
      };
      const profile = inForce.get(e.id);
      if (!profile) {
        rows.push({ ...base, status: 'BLOCKED', warnings: ['No pay profile for this month — the engine can\'t pay them. Create one or import it.'] });
        continue;
      }
      // A borrowed profile uses the salary group as it stood when the profile starts.
      // The employee's own regime choice, else the year's default (NEW).
      const regime = ((profile as any).taxRegime === 'OLD' || (profile as any).taxRegime === 'NEW' ? (profile as any).taxRegime : regimeCode) as 'NEW' | 'OLD';
      const calc = await calcFor(profile.salaryGroupCode, borrowed.has(e.id) ? profile.effectiveFrom : monthEnd, regime);
      if (!calc) {
        rows.push({ ...base, status: 'BLOCKED', warnings: [`Salary group ${profile.salaryGroupCode} isn't in force for this month.`] });
        continue;
      }
      let out;
      try {
        out = calc.run(profile.annualCtc, (profile.overrides as any) ?? undefined);
      } catch (err: any) {
        rows.push({ ...base, status: 'BLOCKED', warnings: [err?.message || 'Calculation failed'] });
        continue;
      }
      const payee = payeeKind(calc.group.payeeType);
      const exempt = isLopExempt(e.user?.role);
      const att = fullMonth || exempt
        ? { workingDays: 0, presentDays: 0, absences: 0, noAttendance: false }
        : attendance.get(e.id) ?? { workingDays: 0, presentDays: 0, absences: 0, noAttendance: true };

      const earningLines = out.lines.filter((l) => l.category === 'EARNING' && l.monthly !== 0);
      const divisor = lopDivisor((companyConfig as any).lopDayBasis, daysInMonth, att.workingDays);
      const { lines: earnings, lossOfPay } = applyLossOfPay(earningLines, divisor, att.absences);
      const grossFull = r2(earnings.reduce((t, l) => t + l.full, 0));
      const grossPaid = r2(earnings.reduce((t, l) => t + l.paid, 0));
      const basicPaid = earnings.find((l) => l.code === 'BASIC')?.paid ?? 0;

      const deductions: DryRunLine[] = [];
      for (const l of out.lines.filter((x) => x.category === 'EMPLOYEE_DEDUCTION')) {
        let paid = l.monthly;
        if (l.code === 'EMPLOYEE_PF' && l.monthly > 0) {
          // PF on Basic earned, capped at the wage ceiling unless the group pays on full Basic.
          const wage = calc.group.pfWageBasis === 'FULL_BASIC' ? basicPaid : Math.min(basicPaid, pfCeiling);
          paid = (wage * pfPct) / 100;
        } else if (l.code === 'EMPLOYEE_ESI') {
          // ESI on wages earned, for those eligible on their full-month gross.
          paid = grossFull <= esiLimit ? (grossPaid * esiPct) / 100 : 0;
        } else if (l.code === 'TDS' && payee === 'EMPLOYEE') {
          continue; // employees' TDS comes from the tax slabs below
        }
        if (Math.abs(paid) < 0.005 && Math.abs(l.monthly) < 0.005) continue;
        deductions.push({ code: l.code, name: l.name, full: r2(l.monthly), paid: r2(paid) });
      }
      if (payee === 'EMPLOYEE' && out.tax && out.tax.monthlyTds > 0) {
        deductions.push({ code: 'TDS', name: 'Income Tax (TDS)', full: out.tax.monthlyTds, paid: out.tax.monthlyTds });
      }
      const totalDeductions = r2(deductions.reduce((t, d) => t + d.paid, 0));
      // GST on top of a consultant's fee (5 Nov 2026), when the group has GST on
      // and the consultant has a GSTIN. Not part of CTC; TDS stays on the fee.
      const feePaid = earnings.find((l) => l.code === 'CONSULTANT_FEE')?.paid ?? 0;
      const gst = payee === 'CONSULTANT' && calc.group.gstApplicable && (e as any).gstin && feePaid > 0 ? r2((feePaid * gstPct) / 100) : 0;
      const net = r2(Math.max(0, grossPaid + gst - totalDeductions));

      const warnings: string[] = [];
      const notes: string[] = exempt && !fullMonth ? [`Paid in full — ${e.user!.role === 'FINANCE' ? 'Finance' : 'Super Admin'} logins have no loss of pay.`] : [];
      if (att.noAttendance) warnings.push('No attendance recorded this month — every working day counts as absent.');
      else if (att.workingDays > 0 && att.absences / att.workingDays > 0.5) warnings.push(`Absent ${att.absences} of ${att.workingDays} working days — check attendance before paying.`);
      if (!e.bankAccountNumber) warnings.push('No bank account on file.');
      if (!e.panNumber && grossFull * 12 > 250000) warnings.push('No PAN on file — TDS may need to be higher (20%) without it.');
      if (payee === 'CONSULTANT' && calc.group.gstApplicable && !(e as any).gstin) warnings.push('No GSTIN on file — GST is not added to this fee.');

      rows.push({
        ...base,
        status: warnings.length ? 'CHECK' : 'OK',
        salaryGroupCode: profile.salaryGroupCode,
        annualCtc: profile.annualCtc,
        taxRegime: regime,
        profileFrom: profile.effectiveFrom,
        borrowedProfile: borrowed.has(e.id),
        workingDays: att.workingDays,
        presentDays: att.presentDays,
        absences: r2(att.absences),
        earnings,
        grossFull,
        lossOfPay,
        grossPaid,
        deductions,
        totalDeductions,
        net,
        gst,
        gstPct: gst ? gstPct : null,
        lopExempt: exempt,
        notes,
        employerContributions: r2(out.lines.filter((l) => l.category === 'EMPLOYER_CONTRIBUTION').reduce((t, l) => t + l.monthly, 0)),
        warnings,
      });
    }

    const paid = rows.filter((r) => r.status !== 'BLOCKED');
    const sum = (k: string) => r2(paid.reduce((t, r) => t + (r[k] || 0), 0));
    return {
      month,
      year,
      financialYear,
      regimeCode,
      fullMonth,
      lopDayBasis: (companyConfig as any).lopDayBasis ?? 'CALENDAR',
      currentProfiles,
      borrowedProfiles: borrowed.size,
      summary: {
        employees: rows.length,
        payslips: paid.length,
        blocked: rows.filter((r) => r.status === 'BLOCKED').length,
        toCheck: rows.filter((r) => r.status === 'CHECK').length,
        grossFull: sum('grossFull'),
        lossOfPay: sum('lossOfPay'),
        grossPaid: sum('grossPaid'),
        deductions: sum('totalDeductions'),
        net: sum('net'),
        employerContributions: sum('employerContributions'),
      },
      rows,
    };
  }
}
