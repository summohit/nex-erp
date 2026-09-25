import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PdfService } from './pdf.service';
import { EmailService } from './email.service';

const PREDEFINED_COMPONENTS = [
  { name: 'Basic Salary', type: 'EARNING', description: 'Base component of employee salary' },
  { name: 'House Rent Allowance (HRA)', type: 'EARNING', description: 'Tax-exempt housing allowance' },
  { name: 'Special Allowance', type: 'EARNING', description: 'Performance and special allowance' },
  { name: 'Conveyance Allowance', type: 'EARNING', description: 'Travel and commuting allowance' },
  { name: 'Medical Allowance', type: 'EARNING', description: 'Medical expenses reimbursement' },
  { name: 'Dearness Allowance (DA)', type: 'EARNING', description: 'Cost of living adjustment' },
  { name: 'Provident Fund (PF)', type: 'DEDUCTION', description: 'Retirement savings contribution' },
  { name: 'Professional Tax', type: 'DEDUCTION', description: 'State government employment tax' },
  { name: 'Income Tax (TDS)', type: 'DEDUCTION', description: 'Tax deducted at source' },
  { name: 'Employee State Insurance (ESI)', type: 'DEDUCTION', description: 'Social security and health insurance' }
];

/**
 * The month whose payslip closes the leave year. Leave does not carry forward —
 * whatever is unused when this slip is generated is paid out on it.
 */
const LEAVE_YEAR_CLOSING_MONTH = 12;

/**
 * Prefix on the payslip line that carries a leave payout. Matched, not just
 * written — a manual earnings edit must not rescale a payout that has already
 * been recorded against this slip.
 */
const LEAVE_ENCASHMENT_PREFIX = 'Leave Encashment';

@Injectable()
export class PayrollService {
  constructor(
    private prisma: PrismaService,
    private pdfService: PdfService,
    private emailService: EmailService
  ) {}

  // ==================== 1. SALARY COMPONENTS ====================

  async getSalaryComponents(companyId: number) {
    const existing = await this.prisma.salaryComponent.findMany({
      where: { companyId },
      orderBy: { id: 'asc' }
    });

    if (existing.length === 0) {
      // Seed predefined components
      await this.prisma.salaryComponent.createMany({
        data: PREDEFINED_COMPONENTS.map(c => ({
          ...c,
          isPreDefined: true,
          companyId
        }))
      });
      return this.prisma.salaryComponent.findMany({
        where: { companyId },
        orderBy: { id: 'asc' }
      });
    }

    return existing;
  }

  async createSalaryComponent(companyId: number, data: { name: string; type: string; description?: string }) {
    if (!['EARNING', 'DEDUCTION'].includes(data.type)) {
      throw new BadRequestException('Component type must be EARNING or DEDUCTION');
    }
    return this.prisma.salaryComponent.create({
      data: {
        name: data.name,
        type: data.type,
        description: data.description,
        isPreDefined: false,
        companyId
      }
    });
  }

  async updateSalaryComponent(companyId: number, id: number, data: { name?: string; description?: string }) {
    const comp = await this.prisma.salaryComponent.findFirst({ where: { id, companyId } });
    if (!comp) throw new NotFoundException('Component not found');
    return this.prisma.salaryComponent.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description
      }
    });
  }

  async deleteSalaryComponent(companyId: number, id: number) {
    const comp = await this.prisma.salaryComponent.findFirst({ where: { id, companyId } });
    if (!comp) throw new NotFoundException('Component not found');
    if (comp.isPreDefined) {
      throw new BadRequestException('Predefined components cannot be deleted');
    }
    return this.prisma.salaryComponent.delete({ where: { id } });
  }

  // ==================== 2. SALARY STRUCTURE ====================

  async getAllSalaryStructures(companyId: number) {
    const employees = await this.prisma.employee.findMany({
      where: { companyId },
      include: {
        department: { select: { id: true, name: true } },
        designation: { select: { id: true, name: true } },
        user: { select: { email: true, role: true, status: true } },
        salaryStructures: {
          include: { component: true }
        }
      },
      orderBy: { firstName: 'asc' }
    });

    return employees.map((emp) => {
      let grossEarnings = 0;
      let totalDeductions = 0;

      for (const s of emp.salaryStructures || []) {
        if (s.component?.type === 'EARNING') {
          grossEarnings += s.amount || 0;
        } else if (s.component?.type === 'DEDUCTION') {
          totalDeductions += s.amount || 0;
        }
      }

      const netSalary = Math.max(0, grossEarnings - totalDeductions);
      const hasStructure = (emp.salaryStructures?.length || 0) > 0 && grossEarnings > 0;

      let salaryGroup = 'Employee Salary Group';
      const desig = (emp.designation?.name || '').toLowerCase();
      if (desig.includes('consultant')) {
        salaryGroup = 'Technical Consultant';
      } else if (desig.includes('trainee') || desig.includes('intern')) {
        salaryGroup = 'Trainee Stipend';
      } else if (desig.includes('operations') || desig.includes('manager')) {
        salaryGroup = 'Non Technical Consultant Salary';
      } else if (emp.department?.name) {
        salaryGroup = emp.department.name;
      }

      return {
        id: emp.id,
        firstName: emp.firstName,
        lastName: emp.lastName,
        avatarUrl: emp.avatarUrl,
        employeeCode: emp.employeeCode,
        department: emp.department,
        designation: emp.designation,
        user: emp.user,
        // Sent so the table can lead with the people who have been here
        // longest. Sorting on it in the database would not survive the
        // client's own re-sorts, and the column is wanted for display order
        // rather than as the query's order.
        joiningDate: emp.joiningDate,
        salaryCycle: 'Monthly',
        salaryGroup,
        // Suspension still wins: somebody with no login is off payroll
        // whatever this flag says, and the screen should agree with what
        // generation will actually do.
        allowPayrollGenerate:
          emp.user?.status !== 'SUSPENDED' && emp.allowPayrollGenerate ? 'Yes' : 'No',
        grossEarnings,
        totalDeductions,
        netSalary,
        hasStructure,
        salaryStructures: emp.salaryStructures
      };
    });
  }

  /** Take somebody off payroll, or put them back on, without touching their login. */
  async setAllowPayrollGenerate(companyId: number, employeeId: number, allow: boolean) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId } });
    if (!employee) throw new NotFoundException('Employee not found');
    return this.prisma.employee.update({
      where: { id: employeeId },
      data: { allowPayrollGenerate: allow },
      select: { id: true, allowPayrollGenerate: true },
    });
  }

  async getSalaryStructure(companyId: number, employeeId: number) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      include: {
        salaryStructures: {
          include: { component: true }
        }
      }
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee.salaryStructures;
  }

  async updateSalaryStructure(companyId: number, employeeId: number, items: { componentId: number; amount: number }[]) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId } });
    if (!employee) throw new NotFoundException('Employee not found');

    for (const item of items) {
      await this.prisma.salaryStructure.upsert({
        where: {
          employeeId_componentId: {
            employeeId,
            componentId: Number(item.componentId)
          }
        },
        update: { amount: Number(item.amount) || 0 },
        create: {
          employeeId,
          componentId: Number(item.componentId),
          amount: Number(item.amount) || 0
        }
      });
    }

    return this.getSalaryStructure(companyId, employeeId);
  }

  // ==================== 3. PAYSLIPS ====================

  private isWeeklyOff(date: Date, rules: string[]): boolean {
    const day = date.getDay(); // 0=Sun, 6=Sat
    const dateNum = date.getDate();
    const occurrence = Math.ceil(dateNum / 7); // 1st, 2nd, 3rd, 4th, 5th occurrence in the month
    
    for (const rule of rules) {
      const parts = rule.split(':');
      const ruleDay = parseInt(parts[0], 10);
      const condition = parts[1] || 'all';

      if (day === ruleDay) {
        if (condition === 'all') return true;
        if (condition === 'even' && occurrence % 2 === 0) return true;
        if (condition === 'odd' && occurrence % 2 !== 0) return true;
      }
    }
    return false;
  }

  /**
   * What a run would pay, before anybody presses the button.
   *
   * Generation is close to irreversible in practice: it writes DRAFT slips,
   * and once a period is finalised it refuses to regenerate. The damage that
   * a thin attendance month does is therefore only visible afterwards, on
   * payslips people have already been shown. This answers the same question
   * beforehand, and writes nothing.
   *
   * Deliberately a second implementation of the loss-of-pay rule rather than a
   * refactor of the first: generation is the code that pays people and is not
   * worth destabilising for a preview. The two are checked against each other
   * by payroll-preview.spec.ts, which is what stops them drifting apart.
   */
  async previewPayroll(companyId: number, month: number, year: number) {
    const employees = await this.prisma.employee.findMany({
      where: { companyId, user: { status: { not: 'SUSPENDED' } }, allowPayrollGenerate: true },
      include: { salaryStructures: { include: { component: true } }, branch: true },
    });

    const totalDaysInMonth = new Date(year, month, 0).getDate();
    const rows: any[] = [];

    for (const emp of employees) {
      let gross = 0;
      let deductions = 0;
      for (const st of emp.salaryStructures || []) {
        const amt = st.amount || 0;
        if (st.component?.type === 'EARNING') gross += amt;
        else if (st.component?.type === 'DEDUCTION') deductions += amt;
      }
      if (gross <= 0) continue;

      const offs = (emp.branch?.weeklyOffs || '0').split(',').map((n) => n.trim());
      let workingDays = 0;
      for (let d = 1; d <= totalDaysInMonth; d++) {
        if (!offs.includes(String(new Date(year, month - 1, d).getDay()))) workingDays++;
      }
      if (workingDays === 0) workingDays = totalDaysInMonth;

      const attendances = await this.prisma.attendance.findMany({
        where: {
          employeeId: emp.id,
          date: { gte: new Date(year, month - 1, 1), lte: new Date(year, month, 0) },
        },
        select: { date: true, status: true },
      });
      const byDay = new Map<string, string>();
      let present = 0;
      let half = 0;
      for (const a of attendances) {
        byDay.set(a.date.toISOString().split('T')[0], a.status);
        if (a.status === 'PRESENT') present++;
        else if (a.status === 'HALF_DAY') half++;
      }

      const leaves = await this.prisma.leaveRequest.findMany({
        where: { employeeId: emp.id, status: 'APPROVED' },
        select: { startDate: true, endDate: true },
      });

      let absences = 0;
      for (let d = 1; d <= totalDaysInMonth; d++) {
        const date = new Date(year, month - 1, d);
        if (offs.includes(String(date.getDay()))) continue;
        const key = date.toISOString().split('T')[0];
        const st = byDay.get(key);
        if (st === 'PRESENT' || st === 'HALF_DAY') continue;
        const covered = leaves.some(
          (l) =>
            key >= l.startDate.toISOString().split('T')[0] &&
            key <= l.endDate.toISOString().split('T')[0],
        );
        if (!covered) absences++;
      }
      absences += half * 0.5;

      const lossOfPay = Math.round((gross / workingDays) * absences * 100) / 100;
      rows.push({
        employeeId: emp.id,
        name: `${emp.firstName} ${emp.lastName}`.trim(),
        workingDays,
        presentDays: present + half * 0.5,
        absences,
        gross,
        deductions,
        lossOfPay,
        net: Math.max(0, gross - deductions - lossOfPay),
        /// No attendance at all is a different problem from a patchy month:
        /// it usually means nothing was ever recorded for them, not that they
        /// never came in.
        noAttendance: attendances.length === 0,
      });
    }

    const totalGross = rows.reduce((t, r) => t + r.gross, 0);
    const totalLossOfPay = rows.reduce((t, r) => t + r.lossOfPay, 0);

    return {
      month,
      year,
      employees: rows.length,
      totalGross,
      totalLossOfPay,
      totalNet: rows.reduce((t, r) => t + r.net, 0),
      lossOfPayShare: totalGross > 0 ? totalLossOfPay / totalGross : 0,
      severelyAffected: rows.filter((r) => r.gross > 0 && r.lossOfPay / r.gross > 0.5).length,
      noAttendance: rows.filter((r) => r.noAttendance).length,
      rows: rows.sort((a, b) => b.lossOfPay / b.gross - a.lossOfPay / a.gross),
    };
  }

  /**
   * Draft this month's payslips.
   *
   * `skipLossOfPay` exists because the attendance record and the truth can come
   * apart. September 2026 has roughly 60% of its working days recorded — the
   * clock-in was broken for part of it and the Workway import stopped on the
   * 21st — and generating from that would have deducted ₹15.1 lakh, 46% of
   * gross, for days people worked. Ten people would have lost over half their
   * pay and one, with no attendance at all, would have been paid nothing.
   *
   * The arithmetic was never wrong; the input was. So the waiver is a decision
   * somebody makes for a named month, not a rule, and not a default.
   */
  async generatePayslips(
    companyId: number,
    month: number,
    year: number,
    opts: { skipLossOfPay?: boolean } = {},
  ) {
    const existingPayslips = await this.prisma.payslip.findMany({
      where: { companyId, month: Number(month), year: Number(year) },
      select: { status: true }
    });

    if (existingPayslips.length > 0) {
      const hasFinalized = existingPayslips.some(p => p.status === 'FINALIZED' || p.status === 'PAID');
      if (hasFinalized) {
        throw new BadRequestException('Blocked or overrides existing DRAFT. Cannot override FINALIZED.');
      }
    }

    const employees = await this.prisma.employee.findMany({
      // Deactivated staff are off payroll — no draft is created for them.
      // So is anyone switched off on the salary screen, which until now was a
      // dropdown that changed nothing: it read Yes/No, saved neither, and
      // generation drafted a payslip regardless.
      where: {
        companyId,
        user: { status: { not: 'SUSPENDED' } },
        allowPayrollGenerate: true,
      },
      include: {
        salaryStructures: {
          include: { component: true }
        },
        branch: true
      }
    });

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0); // Last day of month
    const totalDaysInMonth = endDate.getDate();

    for (const emp of employees) {
      // Branch Weekly Offs logic
      const weeklyOffsConfig = emp.branch?.weeklyOffs || "0";
      const weeklyOffRules = weeklyOffsConfig.split(',').map(n => n.trim());
      
      let workingDaysInMonth = 0;
      for (let d = 1; d <= totalDaysInMonth; d++) {
        const date = new Date(year, month - 1, d);
        if (!this.isWeeklyOff(date, weeklyOffRules)) {
          workingDaysInMonth++;
        }
      }

      // Fallback if configured poorly (e.g. all days are weekly off)
      if (workingDaysInMonth === 0) workingDaysInMonth = totalDaysInMonth;

      // Calculate attendance statistics for this month
      const attendances = await this.prisma.attendance.findMany({
        where: {
          employeeId: emp.id,
          date: {
            gte: startDate,
            lte: endDate
          }
        }
      });

      const approvedLeaves = await this.prisma.leaveRequest.findMany({
        where: {
          employeeId: emp.id,
          status: 'APPROVED',
          leaveType: { isPaid: true },
          startDate: { lte: endDate },
          endDate: { gte: startDate }
        },
        include: { leaveType: true }
      });

      let presentCount = 0;
      let halfDayCount = 0;
      
      const attendanceMap = new Map();
      for (const att of attendances) {
        // Simple YYYY-MM-DD string for safe comparison ignoring timezones
        const dateStr = att.date.toISOString().split('T')[0];
        attendanceMap.set(dateStr, att.status);
        if (att.status === 'PRESENT') presentCount++;
        else if (att.status === 'HALF_DAY') halfDayCount++;
      }

      let unexcusedAbsences = 0;

      for (let d = 1; d <= totalDaysInMonth; d++) {
        const date = new Date(year, month - 1, d);
        // Only check working days for LOP
        if (!this.isWeeklyOff(date, weeklyOffRules)) {
          const dateStr = date.toISOString().split('T')[0];
          const status = attendanceMap.get(dateStr);
          
          if (status !== 'PRESENT' && status !== 'HALF_DAY') {
            // Check if covered by approved paid leave
            let isCovered = false;
            for (const leave of approvedLeaves) {
              const leaveStartStr = leave.startDate.toISOString().split('T')[0];
              const leaveEndStr = leave.endDate.toISOString().split('T')[0];
              if (dateStr >= leaveStartStr && dateStr <= leaveEndStr) {
                isCovered = true;
                break;
              }
            }

            if (!isCovered) {
              unexcusedAbsences++;
            }
          }
        }
      }

      unexcusedAbsences += (halfDayCount * 0.5);
      
      const presentDays = presentCount + (halfDayCount * 0.5);

      // Fetch approved expense claims for this period
      const approvedExpenses = await this.prisma.expenseClaim.findMany({
        where: {
          employeeId: emp.id,
          companyId,
          status: 'APPROVED',
          OR: [
            { month: null, year: null },
            { month: Number(month), year: Number(year) }
          ]
        }
      });

      const expenseAmount = approvedExpenses.reduce((sum, exp) => sum + exp.amount, 0);

      // Earnings & Deductions from Structure
      let totalEarnings = 0;
      let totalDeductions = 0;
      const payslipItemsData: { componentName: string; type: string; amount: number }[] = [];

      let basicSalary = 0;

      for (const struct of emp.salaryStructures) {
        const amt = struct.amount || 0;
        if (amt > 0) {
          if (struct.component.type === 'EARNING') {
            totalEarnings += amt;
            payslipItemsData.push({
              componentName: struct.component.name,
              type: 'EARNING',
              amount: amt
            });
            if (struct.component.name.toLowerCase().includes('basic')) {
              basicSalary = amt;
            }
          } else if (struct.component.type === 'DEDUCTION') {
            totalDeductions += amt;
            payslipItemsData.push({
              componentName: struct.component.name,
              type: 'DEDUCTION',
              amount: amt
            });
          }
        }
      }

      // --- STATUTORY COMPLIANCE ENGINE ---
      if (basicSalary === 0 && totalEarnings > 0) {
        basicSalary = totalEarnings * 0.5;
      }

      // PF: 12% of Basic Salary
      const pfAmount = Math.round(basicSalary * 0.12);
      if (pfAmount > 0 && !payslipItemsData.some(i => i.componentName.includes('Provident Fund'))) {
        payslipItemsData.push({ componentName: 'Provident Fund (PF) [Statutory]', type: 'DEDUCTION', amount: pfAmount });
        totalDeductions += pfAmount;
      }

      // ESI: 0.75% of Gross if Gross <= 21,000
      if (totalEarnings > 0 && totalEarnings <= 21000 && !payslipItemsData.some(i => i.componentName.includes('State Insurance'))) {
        const esiAmount = Math.round(totalEarnings * 0.0075);
        payslipItemsData.push({ componentName: 'Employee State Insurance (ESI) [Statutory]', type: 'DEDUCTION', amount: esiAmount });
        totalDeductions += esiAmount;
      }

      // PT: Flat ₹200 if Gross > 15,000
      if (totalEarnings > 15000 && !payslipItemsData.some(i => i.componentName.includes('Professional Tax'))) {
        const ptAmount = 200;
        payslipItemsData.push({ componentName: 'Professional Tax [Statutory]', type: 'DEDUCTION', amount: ptAmount });
        totalDeductions += ptAmount;
      }

      // TDS: 10% on amount exceeding 50,000
      if (totalEarnings > 50000 && !payslipItemsData.some(i => i.componentName.includes('TDS'))) {
        const tdsAmount = Math.round((totalEarnings - 50000) * 0.10);
        payslipItemsData.push({ componentName: 'Income Tax (TDS) [Statutory]', type: 'DEDUCTION', amount: tdsAmount });
        totalDeductions += tdsAmount;
      }
      // --- END STATUTORY COMPLIANCE ---

      // Loss of Pay (LOP) calculation based on actual unexcused working day absences
      const dailyRate = workingDaysInMonth > 0 ? (totalEarnings / workingDaysInMonth) : 0;
      // Waived for the whole run when asked — see the note on this method.
      const lossOfPay = opts.skipLossOfPay
        ? 0
        : Math.round(dailyRate * unexcusedAbsences * 100) / 100;

      // Leave encashment, on the December slip only. Deliberately after the
      // statutory block and after dailyRate: a one-off payout must not inflate
      // the rate its own days are priced at, and must not push the month's
      // gross past the ESI ceiling or the TDS threshold, which are tests on
      // regular salary rather than on everything paid in the month.
      const encashment = Number(month) === LEAVE_YEAR_CLOSING_MONTH
        ? await this.computeLeaveEncashment(emp.id, Number(year), dailyRate)
        : { lines: [], days: 0, amount: 0, ratePerDay: 0 };

      for (const line of encashment.lines) {
        payslipItemsData.push({
          componentName: `${LEAVE_ENCASHMENT_PREFIX} — ${line.leaveTypeName} (${line.days} day${line.days === 1 ? '' : 's'}, ${year})`,
          type: 'EARNING',
          amount: line.amount,
        });
        totalEarnings += line.amount;
      }

      const netPay = Math.max(0, Math.round((totalEarnings - totalDeductions - lossOfPay + expenseAmount) * 100) / 100);

      // Upsert DRAFT Payslip
      const payslip = await this.prisma.payslip.upsert({
        where: {
          employeeId_month_year: {
            employeeId: emp.id,
            month: Number(month),
            year: Number(year)
          }
        },
        update: {
          workingDays: workingDaysInMonth,
          presentDays,
          absentDays: unexcusedAbsences,
          halfDays: halfDayCount,
          totalEarnings,
          totalDeductions,
          lossOfPay,
          expenseAmount,
          netPay,
          status: 'DRAFT'
        },
        create: {
          employeeId: emp.id,
          companyId,
          month: Number(month),
          year: Number(year),
          workingDays: workingDaysInMonth,
          presentDays,
          absentDays: unexcusedAbsences,
          halfDays: halfDayCount,
          totalEarnings,
          totalDeductions,
          lossOfPay,
          expenseAmount,
          netPay,
          status: 'DRAFT'
        }
      });

      await this.prisma.payslipItem.deleteMany({ where: { payslipId: payslip.id } });

      if (payslipItemsData.length > 0) {
        await this.prisma.payslipItem.createMany({
          data: payslipItemsData.map(item => ({
            ...item,
            payslipId: payslip.id
          }))
        });
      }

      // Rewritten, not appended: the December slip is a DRAFT until finalized
      // and may be regenerated after a late leave approval, at which point last
      // run's figures are wrong rather than additional.
      await this.prisma.leaveEncashment.deleteMany({
        where: { employeeId: emp.id, year: Number(year) },
      });
      if (encashment.lines.length > 0) {
        await this.prisma.leaveEncashment.createMany({
          data: encashment.lines.map(line => ({
            employeeId: emp.id,
            leaveTypeId: line.leaveTypeId,
            year: Number(year),
            days: line.days,
            ratePerDay: encashment.ratePerDay,
            amount: line.amount,
            payslipId: payslip.id,
            companyId,
          })),
        });
      }

      if (approvedExpenses.length > 0) {
        await this.prisma.expenseClaim.updateMany({
          where: { id: { in: approvedExpenses.map(e => e.id) } },
          data: { month: Number(month), year: Number(year) }
        });
      }
    }

    return this.getPayslips(companyId, month, year);
  }

  /**
   * What the employee is owed for leave they were granted this year and did
   * not take.
   *
   * Leave used to roll into the next year; it no longer does. A year's days
   * expire with the year, so the unused ones are bought back on that year's
   * last payslip instead of quietly disappearing — and January then opens with
   * a fresh allocation (LeaveAccrualCron.openYear).
   *
   * Priced at the same daily rate Loss of Pay is charged at, so a day not taken
   * is worth exactly what a day of absence costs.
   *
   * Only types flagged `encashable` pay out. Sick and Maternity leave are an
   * entitlement to be absent when you need to be, not a balance the company
   * owes money on, and paying them out would reward not taking them.
   *
   * The balance rows are left alone. `used` means days actually taken, which
   * attendance and the quota report both rely on; adding encashed days to it
   * would make an employee who took no leave look like they took all of it.
   */
  private async computeLeaveEncashment(employeeId: number, year: number, ratePerDay: number) {
    const lines: { leaveTypeId: number; leaveTypeName: string; days: number; amount: number }[] = [];
    // No salary structure, or a month with no working days: there is no rate to
    // value a day at, so there is nothing to pay out.
    if (ratePerDay <= 0) return { lines, ratePerDay, days: 0, amount: 0 };

    const balances = await this.prisma.leaveBalance.findMany({
      where: { employeeId, year, leaveType: { encashable: true } },
      select: {
        leaveTypeId: true,
        allocated: true,
        used: true,
        leaveType: { select: { name: true, encashmentLimit: true } },
      },
    });

    for (const b of balances) {
      const remaining = b.allocated - b.used;
      if (remaining <= 0) continue;

      // A limit of 0 is no cap, not "encash nothing" — the field only appears
      // once encashment is switched on, so a cap of zero would make the switch
      // do nothing at all.
      const days = b.leaveType.encashmentLimit > 0
        ? Math.min(remaining, b.leaveType.encashmentLimit)
        : remaining;

      lines.push({
        leaveTypeId: b.leaveTypeId,
        leaveTypeName: b.leaveType.name,
        days: Math.round(days * 100) / 100,
        amount: Math.round(days * ratePerDay * 100) / 100,
      });
    }

    return {
      lines,
      ratePerDay,
      days: Math.round(lines.reduce((sum, l) => sum + l.days, 0) * 100) / 100,
      amount: Math.round(lines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100,
    };
  }

  async getPayslips(companyId: number, month?: number, year?: number) {
    const where: any = { companyId };
    if (month) where.month = Number(month);
    if (year) where.year = Number(year);

    const existing = await this.prisma.payslip.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
            department: { select: { name: true } },
            designation: { select: { name: true } },
            user: { select: { status: true } }
          }
        },
        items: true
      },
      orderBy: { employee: { firstName: 'asc' } }
    });

    // Deliberately does NOT generate when the period is empty.
    //
    // It used to: a GET that found nothing created a full month of drafts as a
    // side effect. That made an empty period impossible — September 2026 was
    // deleted three times and came back within seconds each time, because
    // opening the Payslips tab regenerated it.
    //
    // Worse, it generated without the pre-flight check. September's attendance
    // is about 60% complete, so those drafts carried ₹15.1 lakh of loss of pay
    // for days people had worked, and they appeared on screen with nobody
    // having asked for them. Generating payroll is a decision; a page load is
    // not. The empty state has a button for it.
    return existing;
  }

  async getMyPayslips(companyId: number, userId: number) {
    const employee = await this.prisma.employee.findFirst({ where: { userId, companyId } });
    if (!employee) throw new NotFoundException('Employee profile not found');

    return this.prisma.payslip.findMany({
      where: {
        employeeId: employee.id,
        companyId,
        status: { in: ['FINALIZED', 'PAID'] }
      },
      include: {
        items: true,
        employee: {
          select: {
            firstName: true,
            lastName: true,
            department: { select: { name: true } },
            designation: { select: { name: true } }
          }
        }
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }]
    });
  }

  async updatePayslip(companyId: number, id: number, data: { lossOfPay?: number; totalEarnings?: number; totalDeductions?: number; expenseAmount?: number; status?: string }) {
    const payslip = await this.prisma.payslip.findFirst({ where: { id, companyId } });
    if (!payslip) throw new NotFoundException('Payslip not found');

    const lossOfPay = Math.max(0, data.lossOfPay !== undefined ? Number(data.lossOfPay) : payslip.lossOfPay);
    const totalEarnings = Math.max(0, data.totalEarnings !== undefined ? Number(data.totalEarnings) : payslip.totalEarnings);
    const totalDeductions = Math.max(0, data.totalDeductions !== undefined ? Number(data.totalDeductions) : payslip.totalDeductions);
    const expenseAmount = Math.max(0, data.expenseAmount !== undefined ? Number(data.expenseAmount) : payslip.expenseAmount);

    const netPay = Math.max(0, Math.round((totalEarnings - totalDeductions - lossOfPay + expenseAmount) * 100) / 100);

    // Sync deduction line items if totalDeductions was manually adjusted
    if (data.totalDeductions !== undefined) {
      const deductionItems = await this.prisma.payslipItem.findMany({
        where: { payslipId: id, type: 'DEDUCTION' }
      });
      if (deductionItems.length === 1) {
        await this.prisma.payslipItem.update({
          where: { id: deductionItems[0].id },
          data: { amount: Math.max(0, totalDeductions) }
        });
      } else if (deductionItems.length > 1) {
        const oldSum = deductionItems.reduce((sum, item) => sum + item.amount, 0);
        for (let i = 0; i < deductionItems.length; i++) {
          const item = deductionItems[i];
          const newAmt = oldSum > 0 ? Math.round((item.amount / oldSum) * totalDeductions * 100) / 100 : (i === 0 ? totalDeductions : 0);
          await this.prisma.payslipItem.update({
            where: { id: item.id },
            data: { amount: Math.max(0, newAmt) }
          });
        }
      }
    }

    // Sync earning line items if totalEarnings was manually adjusted
    if (data.totalEarnings !== undefined) {
      const allEarnings = await this.prisma.payslipItem.findMany({
        where: { payslipId: id, type: 'EARNING' }
      });
      // A leave payout is a recorded figure — so many days at so much a day,
      // held in LeaveEncashment — not a share of the month's salary. Spreading
      // an adjustment across it would leave the line disagreeing with the
      // record behind it, so the adjustment lands on the salary lines and the
      // payout is held out of the redistribution at its recorded amount.
      const encashmentTotal = allEarnings
        .filter(item => item.componentName.startsWith(LEAVE_ENCASHMENT_PREFIX))
        .reduce((sum, item) => sum + item.amount, 0);
      const earningItems = allEarnings.filter(item => !item.componentName.startsWith(LEAVE_ENCASHMENT_PREFIX));
      const salaryTarget = Math.max(0, Math.round((totalEarnings - encashmentTotal) * 100) / 100);

      if (earningItems.length > 0) {
        const oldSum = earningItems.reduce((sum, item) => sum + item.amount, 0);
        for (let i = 0; i < earningItems.length; i++) {
          const item = earningItems[i];
          const newAmt = oldSum > 0 ? Math.round((item.amount / oldSum) * salaryTarget * 100) / 100 : (i === 0 ? salaryTarget : 0);
          await this.prisma.payslipItem.update({
            where: { id: item.id },
            data: { amount: Math.max(0, newAmt) }
          });
        }
      }
    }

    return this.prisma.payslip.update({
      where: { id },
      data: {
        lossOfPay,
        totalEarnings,
        totalDeductions,
        expenseAmount,
        netPay,
        status: data.status || payslip.status
      },
      include: { items: true, employee: true }
    });
  }

  async batchFinalizePayslips(companyId: number, month: number, year: number) {
    return this.prisma.payslip.updateMany({
      where: {
        companyId,
        month: Number(month),
        year: Number(year),
        status: 'DRAFT'
      },
      data: { status: 'FINALIZED' }
    });
  }

  async markPayslipsPaid(companyId: number, month: number, year: number) {
    return this.prisma.payslip.updateMany({
      where: {
        companyId,
        month: Number(month),
        year: Number(year),
        status: 'FINALIZED'
      },
      data: { status: 'PAID', paidOn: new Date() }
    });
  }

  // ==================== 4. EXPENSE CLAIMS ====================

  async createExpenseClaim(companyId: number, userId: number, data: { title: string; description?: string; amount: number; category?: string; receiptUrl?: string; purchaseDate?: string; purchasedFrom?: string; projectCode?: string; projectName?: string; projectId?: number }) {
    const employee = await this.prisma.employee.findFirst({ where: { userId, companyId } });
    if (!employee) throw new NotFoundException('Employee not found');

    const amount = Number(data.amount);
    if (!amount || amount <= 0) {
      throw new BadRequestException('Claim amount must be greater than zero');
    }

    const MAX_CLAIM_LIMIT = 100000;
    if (amount > MAX_CLAIM_LIMIT) {
      throw new BadRequestException(`Expense limit exceeded. Maximum claim limit is ₹1,00,000 (${amount.toLocaleString('en-IN')} cannot be claimed).`);
    }

    if (data.purchaseDate) {
      const pDate = new Date(data.purchaseDate);
      const today = new Date();
      if (pDate > today) {
        throw new BadRequestException('Purchase date cannot be in the future');
      }
    }

    return this.prisma.expenseClaim.create({
      data: {
        employeeId: employee.id,
        companyId,
        title: data.title,
        description: data.description,
        amount: amount,
        category: data.category || 'OTHER',
        receiptUrl: data.receiptUrl,
        purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
        purchasedFrom: data.purchasedFrom || null,
        projectCode: data.projectCode || null,
        projectName: data.projectName || null,
        projectId: data.projectId || null,
        status: 'PENDING'
      }
    });
  }


  async getMyExpenseClaims(companyId: number, userId: number) {
    const employee = await this.prisma.employee.findFirst({ where: { userId, companyId } });
    if (!employee) throw new NotFoundException('Employee not found');

    return this.prisma.expenseClaim.findMany({
      where: { employeeId: employee.id, companyId },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            department: { select: { name: true } }
          }
        },
        approvedBy: {
          select: { employee: { select: { firstName: true, lastName: true } } }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getDashboardSummary(companyId: number) {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const [payrollAgg, pendingCount, pendingSum, recentPending] = await Promise.all([
      this.prisma.payslip.aggregate({
        where: { companyId, month, year },
        _sum: { netPay: true, totalEarnings: true, totalDeductions: true },
        _count: true
      }),
      this.prisma.expenseClaim.count({ where: { companyId, status: 'PENDING' } }),
      this.prisma.expenseClaim.aggregate({
        where: { companyId, status: 'PENDING' },
        _sum: { amount: true }
      }),
      this.prisma.expenseClaim.findMany({
        where: { companyId, status: 'PENDING' },
        include: { employee: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5
      })
    ]);

    return {
      payrollSummary: {
        month,
        year,
        payslipCount: payrollAgg._count,
        totalNetPay: payrollAgg._sum.netPay || 0,
        totalEarnings: payrollAgg._sum.totalEarnings || 0,
        totalDeductions: payrollAgg._sum.totalDeductions || 0
      },
      pendingExpenseClaims: {
        count: pendingCount,
        totalAmount: pendingSum._sum.amount || 0,
        recent: recentPending
      }
    };
  }

  async getAllExpenseClaims(companyId: number) {
    return this.prisma.expenseClaim.findMany({
      where: { companyId },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            // The grid renders a photo when there is one and falls back to an
            // initial. It was always falling back, because neither field was
            // being sent.
            avatarUrl: true,
            user: { select: { status: true } },
            department: { select: { name: true } }
          }
        },
        approvedBy: {
          select: { employee: { select: { firstName: true, lastName: true } } }
        }
      },
      // When the money was spent, not when the row reached NEX. 795 of these
      // arrived in one import, so createdAt orders them all identically and
      // tells you nothing.
      orderBy: [{ purchaseDate: 'desc' }, { createdAt: 'desc' }]
    });
  }

  async updateExpenseClaimStatus(companyId: number, userId: number, id: number, data: { status: string; rejectionReason?: string }, userRole?: string) {
    // Only privileged roles can approve/reject expense claims
    const privilegedRoles = ['SUPERADMIN', 'ADMIN', 'HR', 'FINANCE'];
    if (!userRole || !privilegedRoles.includes(userRole)) {
      throw new BadRequestException('You do not have permission to approve or reject expense claims');
    }

    // Free text in the database, so a typo would otherwise become a status
    // nothing filters on and no screen knows how to colour.
    const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'PAID'];
    if (!STATUSES.includes(String(data.status || '').toUpperCase())) {
      throw new BadRequestException(`Status must be one of ${STATUSES.join(', ')}`);
    }

    const claim = await this.prisma.expenseClaim.findFirst({ where: { id, companyId }, include: { employee: true } });
    if (!claim) throw new NotFoundException('Expense claim not found');

    // Prevent self-approval: check if the approver is the same person who submitted
    if (claim.employee) {
      const approverEmployee = await this.prisma.employee.findFirst({ where: { userId, companyId } });
      if (approverEmployee && approverEmployee.id === claim.employeeId) {
        throw new BadRequestException('You cannot approve or reject your own expense claim');
      }
    }

    return this.prisma.expenseClaim.update({
      where: { id },
      data: {
        status: String(data.status).toUpperCase(),
        rejectionReason: data.rejectionReason,
        approvedById: userId
      }
    });
  }

  async deleteExpenseClaim(companyId: number, id: number, userId: number, userRole?: string) {
    const claim = await this.prisma.expenseClaim.findFirst({
      where: { id, companyId }
    });
    if (!claim) throw new NotFoundException('Expense claim not found');

    const employee = await this.prisma.employee.findFirst({ where: { userId, companyId } });
    const isOwner = employee && claim.employeeId === employee.id;
    const isPrivileged = userRole === 'SUPERADMIN' || userRole === 'ADMIN' || userRole === 'HR';

    if (!isOwner && !isPrivileged) {
      throw new BadRequestException('You do not have permission to delete this expense claim');
    }

    return this.prisma.expenseClaim.delete({ where: { id } });
  }

  async updateExpenseClaim(
    companyId: number,
    userId: number,
    id: number,
    data: { title?: string; description?: string; amount?: number; category?: string; receiptUrl?: string | null; purchaseDate?: string; purchasedFrom?: string; projectCode?: string; projectName?: string; projectId?: number }
  ) {
    const employee = await this.prisma.employee.findFirst({ where: { userId, companyId } });
    if (!employee) throw new NotFoundException('Employee not found');

    const claim = await this.prisma.expenseClaim.findFirst({ where: { id, companyId } });
    if (!claim) throw new NotFoundException('Expense claim not found');
    if (claim.employeeId !== employee.id) throw new BadRequestException('You do not have permission to edit this expense claim');
    if (claim.status !== 'PENDING') throw new BadRequestException('Only PENDING expense claims can be edited');

    if (data.amount !== undefined) {
      const amount = Number(data.amount);
      if (!amount || amount <= 0) throw new BadRequestException('Claim amount must be greater than zero');
      if (amount > 100000) throw new BadRequestException('Maximum claim limit is ₹1,00,000');
    }

    if (data.purchaseDate) {
      const pDate = new Date(data.purchaseDate);
      if (pDate > new Date()) throw new BadRequestException('Purchase date cannot be in the future');
    }

    return this.prisma.expenseClaim.update({
      where: { id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.amount !== undefined && { amount: Number(data.amount) }),
        ...(data.category !== undefined && { category: data.category }),
        ...(data.receiptUrl !== undefined && { receiptUrl: data.receiptUrl }),
        ...(data.purchaseDate !== undefined && { purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null }),
        ...(data.purchasedFrom !== undefined && { purchasedFrom: data.purchasedFrom }),
        ...(data.projectCode !== undefined && { projectCode: data.projectCode }),
        ...(data.projectName !== undefined && { projectName: data.projectName }),
        ...(data.projectId !== undefined && { projectId: data.projectId }),
      },
    });
  }

  /** One payslip, with everything a detail view or a PDF needs. */
  /**
   * One payslip in full.
   *
   * `onlyEmployeeId` is the caller when they are not a payroll administrator:
   * a payslip is somebody's salary, and without this the id in the URL was the
   * only thing between an employee and every colleague's pay. Null means the
   * caller runs payroll and may read anybody's.
   */
  async getPayslipDetail(companyId: number, id: number, onlyEmployeeId: number | null = null) {
    const payslip = await this.prisma.payslip.findFirst({
      where: {
        id,
        companyId,
        ...(onlyEmployeeId == null ? {} : { employeeId: onlyEmployeeId }),
      },
      include: {
        employee: {
          include: { user: { select: { email: true } }, department: true, designation: true },
        },
        items: { orderBy: { id: 'asc' } },
        encashments: true,
      },
    });
    if (!payslip) throw new NotFoundException('Payslip not found');
    return payslip;
  }

  /**
   * Rewrite a payslip from its components.
   *
   * The existing adjust dialog edits three totals — earnings, deductions, loss
   * of pay — which is enough to change what somebody is paid and not enough to
   * say why. This takes the lines instead, the way the payslip itself is
   * written, and derives the totals from them. A payslip whose parts do not
   * add up to its total is not a document anybody should be handed.
   *
   * An "Unpaid Days Deduction" line is written back to the lossOfPay FIELD
   * rather than stored as an item. NEX has a dedicated concept for it and
   * screens built on it — the employee's payslip card reads that field, and an
   * import that left it at zero had everybody seeing "LOP Penalty: ₹0" beside
   * a payslip that had deducted ₹9,677 for unpaid days. The editor still shows
   * it as a line, because a figure you cannot see is a figure you cannot fix;
   * only its resting place differs.
   */
  async updatePayslipItems(
    companyId: number,
    id: number,
    data: {
      items: { componentName: string; type: string; amount: number }[];
      workingDays?: number;
      presentDays?: number;
    },
  ) {
    const payslip = await this.prisma.payslip.findFirst({ where: { id, companyId } });
    if (!payslip) throw new NotFoundException('Payslip not found');
    // A PAID payslip is not refused — correcting a genuine error on an issued
    // slip is legitimate — but it is a record the person has already been
    // given, so the edit is noted rather than made silently.
    if (payslip.status === 'PAID') {
      console.warn(`[payroll] editing a PAID payslip (id ${id}, ${payslip.month}/${payslip.year})`);
    }

    const clean = (data.items || [])
      .map((i) => ({
        componentName: String(i.componentName || '').trim(),
        type: i.type === 'DEDUCTION' ? 'DEDUCTION' : 'EARNING',
        amount: Math.round((Number(i.amount) || 0) * 100) / 100,
      }))
      .filter((i) => i.componentName && i.amount > 0);

    const UNPAID = /^unpaid days deduction$/i;
    const lossOfPay = clean
      .filter((i) => i.type === 'DEDUCTION' && UNPAID.test(i.componentName))
      .reduce((t, i) => t + i.amount, 0);
    const lines = clean.filter(
      (i) => !(i.type === 'DEDUCTION' && UNPAID.test(i.componentName)));

    const totalEarnings = lines.filter((i) => i.type === 'EARNING')
      .reduce((t, i) => t + i.amount, 0);
    const totalDeductions = lines.filter((i) => i.type === 'DEDUCTION')
      .reduce((t, i) => t + i.amount, 0);
    const netPay = Math.max(
      0, Math.round((totalEarnings - totalDeductions - lossOfPay) * 100) / 100);

    await this.prisma.payslipItem.deleteMany({ where: { payslipId: id } });
    if (lines.length) {
      await this.prisma.payslipItem.createMany({
        data: lines.map((i) => ({ payslipId: id, ...i })),
      });
    }

    await this.prisma.payslip.update({
      where: { id },
      data: {
        totalEarnings,
        totalDeductions,
        netPay,
        lossOfPay,
        ...(data.workingDays ? { workingDays: Math.round(data.workingDays) } : {}),
        ...(data.presentDays != null ? { presentDays: Number(data.presentDays) } : {}),
      },
    });

    return this.getPayslipDetail(companyId, id);
  }

  /** The PDF for one payslip, as bytes for the caller to stream. */
  async getPayslipPdf(companyId: number, id: number, onlyEmployeeId: number | null = null) {
    const payslip = await this.getPayslipDetail(companyId, id, onlyEmployeeId);
    const { buffer, isPdf } = await this.pdfService.generatePayslipPdf(payslip);
    const name = `${payslip.employee.firstName}-${payslip.month}-${payslip.year}`
      .replace(/[^A-Za-z0-9-]/g, '');
    return { buffer, isPdf, filename: `payslip-${name}.${isPdf ? 'pdf' : 'html'}` };
  }

  /**
   * Send one payslip again.
   *
   * Separate from the batch send because re-sending to one person is the
   * common case -- a wrong address, a deleted mail -- and doing it through the
   * batch would mail the whole company a second time.
   */
  async sendOnePayslipEmail(companyId: number, id: number) {
    const payslip = await this.getPayslipDetail(companyId, id);
    const email = payslip.employee?.user?.email;
    if (!email) throw new BadRequestException('That employee has no email address on file');

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const empName = payslip.employee.lastName
      ? `${payslip.employee.firstName} ${payslip.employee.lastName}`
      : payslip.employee.firstName;

    const { buffer } = await this.pdfService.generatePayslipPdf(payslip);
    const sent = await this.emailService.sendPayslipEmail(
      email, empName, monthNames[payslip.month - 1], payslip.year, buffer,
    );
    if (!sent) throw new BadRequestException(`Could not send to ${email}`);
    return { sent: true, email };
  }

  async batchSendPayslipEmails(companyId: number, month: number, year: number) {
    const payslips = await this.prisma.payslip.findMany({
      where: { companyId, month, year },
      include: {
        employee: {
          include: {
            user: true,
            department: true,
            designation: true
          }
        },
        items: true
      }
    });

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthName = monthNames[month - 1];

    let successCount = 0;
    let failedCount = 0;

    for (const payslip of payslips) {
      const email = payslip.employee?.user?.email;
      if (!email) {
        failedCount++;
        continue;
      }

      const empName = payslip.employee.lastName 
        ? `${payslip.employee.firstName} ${payslip.employee.lastName}` 
        : payslip.employee.firstName;

      try {
        const { buffer } = await this.pdfService.generatePayslipPdf(payslip);
        const sent = await this.emailService.sendPayslipEmail(
          email,
          empName,
          monthName,
          year,
          buffer
        );
        if (sent) successCount++;
        else failedCount++;
      } catch (e) {
        failedCount++;
      }
    }

    return {
      message: `Batch email processing complete`,
      sentCount: successCount,
      failedCount,
      totalCount: payslips.length
    };
  }
}
