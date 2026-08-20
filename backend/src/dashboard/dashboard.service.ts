import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeavesService } from '../leaves/leaves.service';
import { EmployeesService } from '../employees/employees.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { PayrollService } from '../payroll/payroll.service';
import { ApplicationsService } from '../recruitment/applications.service';
import { CrmService } from '../crm/crm.service';
import { SalesService } from '../sales/sales.service';

interface DashboardUser {
  sub: number;
  companyId: number;
  employeeId: number | null;
  role: string;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

@Injectable()
export class DashboardService {
  constructor(
    private prisma: PrismaService,
    private leavesService: LeavesService,
    private employeesService: EmployeesService,
    private onboardingService: OnboardingService,
    private payrollService: PayrollService,
    private applicationsService: ApplicationsService,
    private crmService: CrmService,
    private salesService: SalesService
  ) {}

  async getDashboard(user: DashboardUser) {
    const common = await this.buildCommon(user);

    switch (user.role) {
      case 'SUPERADMIN':
      case 'ADMIN': {
        const [org, payroll, revenueTrend] = await Promise.all([
          this.buildOrgWidgets(user.companyId, false),
          this.buildPayrollCharts(user.companyId),
          this.buildRevenueTrend(user.companyId)
        ]);
        return { role: user.role, common, org, finance: payroll, sales: { revenueTrend } };
      }
      case 'HR': {
        const org = await this.buildOrgWidgets(user.companyId, true);
        return { role: user.role, common, org };
      }
      case 'FINANCE': {
        const [summary, payroll, revenueTrend] = await Promise.all([
          this.payrollService.getDashboardSummary(user.companyId),
          this.buildPayrollCharts(user.companyId),
          this.buildRevenueTrend(user.companyId)
        ]);
        return { role: user.role, common, finance: { ...summary, ...payroll }, sales: { revenueTrend } };
      }
      case 'SALES': {
        const [sales, leadsPipeline, revenueTrend, recentOrders] = await Promise.all([
          this.salesService.getDashboardSummary(user.companyId),
          this.crmService.getDashboardSummary(user.companyId),
          this.buildRevenueTrend(user.companyId),
          this.getRecentOrders(user.companyId)
        ]);
        return { role: user.role, common, sales: { ...sales, leadsPipeline, revenueTrend, recentOrders } };
      }
      default:
        return { role: user.role, common };
    }
  }

  // ---------------- COMMON (all roles) ----------------

  private async buildCommon(user: DashboardUser) {
    const currentYear = new Date().getFullYear();
    const [myLeaveBalance, myTasks, myAttendanceThisMonth, upcomingHolidays, myHoursLogged] = await Promise.all([
      this.leavesService.getMyBalances(user.sub, currentYear),
      this.getMyTasks(user.companyId, user.employeeId),
      this.getMyAttendanceThisMonth(user.employeeId),
      this.getUpcomingHolidays(user.companyId),
      this.getMyHoursLogged(user.employeeId)
    ]);

    const myTasksByStatus = this.countBy(myTasks, (t: any) => t.status);

    return { myLeaveBalance, myTasks, myTasksByStatus, myAttendanceThisMonth, upcomingHolidays, myHoursLogged };
  }

  private async getMyTasks(companyId: number, employeeId: number | null) {
    if (!employeeId) return [];
    return this.prisma.issue.findMany({
      where: {
        project: { companyId },
        isArchived: false,
        status: { notIn: ['DONE', 'CANCELLED'] },
        OR: [{ assigneeId: employeeId }, { reporterId: employeeId }]
      },
      include: { project: { select: { id: true, key: true, name: true } } },
      orderBy: { dueDate: 'asc' },
      take: 8
    });
  }

  private async getMyAttendanceThisMonth(employeeId: number | null) {
    if (!employeeId) return { days: [], presentCount: 0, lateCount: 0, absentCount: 0 };

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const records = await this.prisma.attendance.findMany({
      where: { employeeId, date: { gte: start, lt: end } },
      select: { date: true, status: true, isLate: true, clockIn: true, clockOut: true },
      orderBy: { date: 'asc' }
    });

    return {
      days: records,
      presentCount: records.filter(r => r.status === 'PRESENT').length,
      lateCount: records.filter(r => r.isLate).length,
      absentCount: records.filter(r => r.status === 'ABSENT').length
    };
  }

  private async getUpcomingHolidays(companyId: number) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return this.prisma.holiday.findMany({
      where: { companyId, date: { gte: today } },
      orderBy: { date: 'asc' },
      take: 5
    });
  }

  private async getMyHoursLogged(employeeId: number | null) {
    if (!employeeId) return [];

    const start = new Date();
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);

    const logs = await this.prisma.issueTimeLog.findMany({
      where: { employeeId, startedAt: { gte: start }, durationMin: { not: null } },
      select: { startedAt: true, durationMin: true }
    });

    // Bucket into the last 7 calendar days
    const buckets: { date: string; hours: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      buckets.push({ date: d.toISOString().slice(0, 10), hours: 0 });
    }
    for (const log of logs) {
      const key = log.startedAt.toISOString().slice(0, 10);
      const bucket = buckets.find(b => b.date === key);
      if (bucket) bucket.hours += (log.durationMin || 0) / 60;
    }
    return buckets.map(b => ({ ...b, hours: Math.round(b.hours * 10) / 10 }));
  }

  // ---------------- ORG (SUPERADMIN / ADMIN / HR) ----------------

  private async buildOrgWidgets(companyId: number, isHR: boolean) {
    const [
      headcount,
      headcountTrend,
      todayAttendance,
      attendanceTrend,
      pendingLeaveApprovals,
      recruitmentAnalytics,
      projectStatus
    ] = await Promise.all([
      this.employeesService.getHeadcountSummary(companyId),
      this.getHeadcountTrend(companyId),
      this.getTodayAttendance(companyId),
      this.getAttendanceTrend(companyId),
      this.leavesService.getPendingApprovalsForCompany(companyId, 8),
      this.applicationsService.getAnalytics(companyId),
      this.getProjectStatus(companyId)
    ]);

    const base = {
      headcount,
      headcountTrend,
      todayAttendance,
      attendanceTrend,
      pendingLeaveApprovals,
      recruitmentAnalytics,
      projectStatus
    };

    if (!isHR) return base;

    const [onboardingPipeline, leaveByType, celebrations] = await Promise.all([
      this.onboardingService.getCompanyPipelineSummary(companyId),
      this.getLeaveByType(companyId),
      this.getCelebrations(companyId)
    ]);

    return { ...base, onboardingPipeline, leaveByType, celebrations };
  }

  private async getHeadcountTrend(companyId: number) {
    const employees = await this.prisma.employee.findMany({
      where: { companyId },
      select: { joiningDate: true, createdAt: true }
    });

    const trend: { label: string; count: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
      const count = employees.filter(e => {
        const joined = e.joiningDate || e.createdAt;
        return joined <= monthEnd;
      }).length;
      trend.push({ label: `${MONTH_LABELS[monthEnd.getMonth()]} ${monthEnd.getFullYear()}`, count });
    }
    return trend;
  }

  private async getTodayAttendance(companyId: number) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [totalEmployees, records, onLeave] = await Promise.all([
      this.prisma.employee.count({ where: { companyId } }),
      this.prisma.attendance.findMany({
        where: { employee: { companyId }, date: { gte: today, lt: tomorrow } },
        select: { status: true, isLate: true }
      }),
      this.prisma.leaveRequest.count({
        where: {
          employee: { companyId },
          status: 'APPROVED',
          startDate: { lte: today },
          endDate: { gte: today }
        }
      })
    ]);

    const present = records.filter(r => r.status === 'PRESENT').length;
    const late = records.filter(r => r.isLate).length;
    const halfDay = records.filter(r => r.status === 'HALF_DAY').length;
    const notClockedIn = Math.max(totalEmployees - records.length - onLeave, 0);

    return { totalEmployees, present, late, halfDay, onLeave, notClockedIn };
  }

  private async getAttendanceTrend(companyId: number) {
    const start = new Date();
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);

    const records = await this.prisma.attendance.findMany({
      where: { employee: { companyId }, date: { gte: start } },
      select: { date: true, status: true }
    });

    const buckets: { date: string; present: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      buckets.push({ date: d.toISOString().slice(0, 10), present: 0 });
    }
    for (const r of records) {
      if (r.status !== 'PRESENT') continue;
      const key = r.date.toISOString().slice(0, 10);
      const bucket = buckets.find(b => b.date === key);
      if (bucket) bucket.present++;
    }
    return buckets;
  }

  private async getProjectStatus(companyId: number) {
    const grouped = await this.prisma.issue.groupBy({
      by: ['status'],
      where: { project: { companyId }, isArchived: false },
      _count: true
    });
    return grouped.map(g => ({ status: g.status, count: g._count }));
  }

  private async getLeaveByType(companyId: number) {
    const requests = await this.prisma.leaveRequest.findMany({
      where: { employee: { companyId } },
      select: { leaveType: { select: { name: true } } }
    });
    return this.countBy(requests, (r: any) => r.leaveType?.name || 'Unknown');
  }

  private async getCelebrations(companyId: number) {
    const employees = await this.prisma.employee.findMany({
      where: { companyId },
      select: { id: true, firstName: true, lastName: true, avatarUrl: true, dateOfBirth: true, joiningDate: true }
    });

    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const withinNext30Days = (d: Date | null) => {
      if (!d) return null;
      const next = new Date(todayMidnight.getFullYear(), d.getMonth(), d.getDate());
      if (next < todayMidnight) {
        next.setFullYear(next.getFullYear() + 1);
      }
      const diffDays = Math.round((next.getTime() - todayMidnight.getTime()) / 86400000);
      return diffDays >= 0 && diffDays <= 30 ? { date: next, diffDays } : null;
    };

    const birthdays: any[] = [];
    const anniversaries: any[] = [];

    for (const e of employees) {
      const bday = withinNext30Days(e.dateOfBirth);
      if (bday) birthdays.push({ ...e, upcomingDate: bday.date, inDays: bday.diffDays });

      const anniv = withinNext30Days(e.joiningDate);
      if (anniv && e.joiningDate) {
        const years = anniv.date.getFullYear() - e.joiningDate.getFullYear();
        if (years > 0) anniversaries.push({ ...e, upcomingDate: anniv.date, inDays: anniv.diffDays, years });
      }
    }

    birthdays.sort((a, b) => a.inDays - b.inDays);
    anniversaries.sort((a, b) => a.inDays - b.inDays);

    return { birthdays: birthdays.slice(0, 5), anniversaries: anniversaries.slice(0, 5) };
  }

  // ---------------- FINANCE CHARTS ----------------

  private async buildPayrollCharts(companyId: number) {
    const [payrollTrend, deptSalaryCost, expensesByCategory] = await Promise.all([
      this.getPayrollTrend(companyId),
      this.getDeptSalaryCost(companyId),
      this.getExpensesByCategory(companyId)
    ]);
    return { payrollTrend, deptSalaryCost, expensesByCategory };
  }

  private async getPayrollTrend(companyId: number) {
    const now = new Date();
    const periods: { month: number; year: number; label: string }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      periods.push({ month: d.getMonth() + 1, year: d.getFullYear(), label: `${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}` });
    }

    const grouped = await this.prisma.payslip.groupBy({
      by: ['month', 'year'],
      where: {
        companyId,
        OR: periods.map(p => ({ month: p.month, year: p.year }))
      },
      _sum: { netPay: true, totalEarnings: true, totalDeductions: true }
    });

    return periods.map(p => {
      const match = grouped.find(g => g.month === p.month && g.year === p.year);
      return {
        label: p.label,
        netPay: match?._sum.netPay || 0,
        earnings: match?._sum.totalEarnings || 0,
        deductions: match?._sum.totalDeductions || 0
      };
    });
  }

  private async getDeptSalaryCost(companyId: number) {
    const now = new Date();
    const payslips = await this.prisma.payslip.findMany({
      where: { companyId, month: now.getMonth() + 1, year: now.getFullYear() },
      select: { netPay: true, employee: { select: { department: { select: { name: true } } } } }
    });

    const map = new Map<string, number>();
    for (const p of payslips) {
      const dept = p.employee?.department?.name || 'Unassigned';
      map.set(dept, (map.get(dept) || 0) + (p.netPay || 0));
    }
    return Array.from(map.entries())
      .map(([name, total]) => ({ name, total: Math.round(total * 100) / 100 }))
      .sort((a, b) => b.total - a.total);
  }

  private async getExpensesByCategory(companyId: number) {
    const grouped = await this.prisma.expenseClaim.groupBy({
      by: ['category'],
      where: { companyId },
      _count: true,
      _sum: { amount: true }
    });
    return grouped.map(g => ({ category: g.category, count: g._count, total: g._sum.amount || 0 }));
  }

  // ---------------- SALES CHARTS ----------------

  private async buildRevenueTrend(companyId: number) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const orders = await this.prisma.salesOrder.findMany({
      where: { companyId, date: { gte: start } },
      select: { date: true, total: true }
    });

    const buckets: { label: string; total: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({ label: `${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`, total: 0 });
    }
    for (const o of orders) {
      const label = `${MONTH_LABELS[o.date.getMonth()]} ${o.date.getFullYear()}`;
      const bucket = buckets.find(b => b.label === label);
      if (bucket) bucket.total += o.total || 0;
    }
    return buckets.map(b => ({ ...b, total: Math.round(b.total * 100) / 100 }));
  }

  private async getRecentOrders(companyId: number) {
    return this.prisma.salesOrder.findMany({
      where: { companyId },
      select: { id: true, orderNumber: true, date: true, total: true, status: true, client: { select: { name: true } } },
      orderBy: { date: 'desc' },
      take: 5
    });
  }

  // ---------------- helpers ----------------

  private countBy<T>(items: T[], keyFn: (item: T) => string) {
    const map = new Map<string, number>();
    for (const item of items) {
      const key = keyFn(item);
      map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries()).map(([name, count]) => ({ name, count }));
  }
}
