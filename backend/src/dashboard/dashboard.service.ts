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
    const [
      myLeaveBalance,
      myTasks,
      myAttendanceThisMonth,
      upcomingHolidays,
      myHoursLogged,
      myShiftSchedule,
      people,
      myTickets,
      taskStats,
      projectStats,
      weekTimelogs,
      myCalendar,
      probation
    ] = await Promise.all([
      this.leavesService.getMyBalances(user.sub, currentYear),
      this.getMyTasks(user.companyId, user.employeeId),
      this.getMyAttendanceThisMonth(user.employeeId),
      this.getUpcomingHolidays(user.companyId),
      this.getMyHoursLogged(user.employeeId),
      this.getMyShiftSchedule(user.employeeId),
      this.getPeopleWidgets(user.companyId),
      this.getMyTickets(user.companyId, user.employeeId),
      this.getMyTaskStats(user.companyId, user.employeeId),
      this.getMyProjectStats(user.companyId, user.employeeId),
      this.getWeekTimelogs(user.employeeId),
      this.getMyCalendar(user.companyId, user.employeeId),
      this.getProbationInfo(user.employeeId)
    ]);

    const myTasksByStatus = this.countBy(myTasks, (t: any) => t.status);

    return {
      myLeaveBalance,
      myTasks,
      myTasksByStatus,
      myAttendanceThisMonth,
      upcomingHolidays,
      myHoursLogged,
      myShiftSchedule,
      birthdays: people.birthdays,
      anniversaries: people.anniversaries,
      todayJoinings: people.todayJoinings,
      todayAnniversaries: people.todayAnniversaries,
      appreciations: people.appreciations,
      onLeaveToday: people.onLeaveToday,
      onWfhToday: people.onWfhToday,
      myTickets,
      taskStats,
      projectStats,
      weekTimelogs,
      myCalendar,
      probation
    };
  }

  // ---------------- COMMON PEOPLE & WORKPLACE WIDGETS ----------------

  /**
   * Org-wide people widgets shown to everyone on the Home dashboard: who is
   * celebrating (birthdays / work anniversaries), who joined or completes a
   * year today, recent appreciations, and who is out (on leave / working from
   * home). Reads employee basics once rather than running a query per widget.
   */
  private async getPeopleWidgets(companyId: number) {
    const now = new Date();
    const todayMonth = now.getMonth();
    const todayDate = now.getDate();

    const employees = await this.prisma.employee.findMany({
      where: { companyId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        dateOfBirth: true,
        joiningDate: true,
        designation: { select: { name: true } },
        department: { select: { name: true } }
      }
    });

    const withinNext30 = (d: Date | null) => {
      if (!d) return null;
      const todayMidnight = new Date(now.getFullYear(), todayMonth, todayDate);
      const next = new Date(todayMidnight.getFullYear(), d.getMonth(), d.getDate());
      if (next < todayMidnight) next.setFullYear(next.getFullYear() + 1);
      const diffDays = Math.round((next.getTime() - todayMidnight.getTime()) / 86400000);
      return diffDays >= 0 && diffDays <= 30 ? { date: next, diffDays } : null;
    };

    const birthdays: any[] = [];
    const anniversaries: any[] = [];
    const todayJoinings: any[] = [];
    const todayAnniversaries: any[] = [];

    for (const e of employees) {
      const bday = withinNext30(e.dateOfBirth);
      if (bday) birthdays.push({ ...e, upcomingDate: bday.date, inDays: bday.diffDays });

      const anniv = withinNext30(e.joiningDate);
      if (anniv && e.joiningDate) {
        const years = anniv.date.getFullYear() - e.joiningDate.getFullYear();
        if (years > 0) anniversaries.push({ ...e, upcomingDate: anniv.date, inDays: anniv.diffDays, years });
      }

      if (e.joiningDate && e.joiningDate.getMonth() === todayMonth && e.joiningDate.getDate() === todayDate) {
        const years = now.getFullYear() - e.joiningDate.getFullYear();
        if (years <= 0) todayJoinings.push(e);
        else todayAnniversaries.push({ ...e, years });
      }
    }

    birthdays.sort((a, b) => a.inDays - b.inDays);
    anniversaries.sort((a, b) => a.inDays - b.inDays);

    // Who is out today — one read, split into leave vs. work-from-home by the
    // leave type's own name, since WFH is modelled as a leave type not a status.
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const leaveToday = await this.prisma.leaveRequest.findMany({
      where: {
        employee: { companyId },
        status: 'APPROVED',
        startDate: { lte: now },
        endDate: { gte: todayMidnight }
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
            designation: { select: { name: true } },
            department: { select: { name: true } }
          }
        },
        leaveType: { select: { name: true } }
      }
    });

    const wfhPattern = /work\s*from\s*home|wfh|remote/i;
    const person = (p: any, extra: any = {}) => ({
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      avatarUrl: p.avatarUrl,
      designation: p.designation?.name || null,
      department: p.department?.name || null,
      ...extra
    });

    const onLeaveToday = leaveToday
      .filter(l => !wfhPattern.test(l.leaveType?.name || ''))
      .map(l => person(l.employee, { leaveType: l.leaveType?.name || 'Leave', isHalfDay: l.isHalfDay, halfDayPeriod: l.halfDayPeriod, requestId: l.id }));

    const onWfhToday = leaveToday
      .filter(l => wfhPattern.test(l.leaveType?.name || ''))
      .map(l => person(l.employee, { leaveType: l.leaveType?.name || 'Work From Home', requestId: l.id }));

    const appreciations = await this.prisma.appreciation.findMany({
      where: { companyId },
      include: {
        awardType: { select: { title: true, icon: true, color: true } },
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
            designation: { select: { name: true } },
            department: { select: { name: true } }
          }
        }
      },
      orderBy: { givenDate: 'desc' },
      take: 6
    });

    return {
      birthdays: birthdays.slice(0, 8).map(e => person(e, { upcomingDate: e.upcomingDate, inDays: e.inDays })),
      anniversaries: anniversaries.slice(0, 8).map(e => person(e, { upcomingDate: e.upcomingDate, inDays: e.inDays, years: e.years })),
      todayJoinings: todayJoinings.map(e => person(e, { joiningDate: e.joiningDate })),
      todayAnniversaries: todayAnniversaries.map(e => person(e, { joiningDate: e.joiningDate, years: e.years })),
      appreciations: appreciations.map(a => ({
        id: a.id,
        givenDate: a.givenDate,
        summary: a.summary,
        photoUrl: a.photoUrl,
        awardTitle: a.awardType?.title || 'Appreciation',
        awardIcon: a.awardType?.icon || 'trophy',
        awardColor: a.awardType?.color || 'orange',
        employee: a.employee ? person(a.employee) : null
      })),
      onLeaveToday,
      onWfhToday
    };
  }

  /**
   * The employee's own shift for the next two weeks — the roster entry when one
   * exists, otherwise their standing shift, with the standing shift's own
   * `workingDays` deciding day-offs. Mirrors the roster resolution rule closely
   * enough for a read-only "what's my schedule" widget without importing the
   * whole Attendance module.
   */
  private async getMyShiftSchedule(employeeId: number | null) {
    if (!employeeId) return [];

    const today = this.startOfToday();
    const startUtc = this.utcMidnight(today);
    const endUtc = this.utcMidnight(this.addDays(today, 14));

    const [employee, entries] = await Promise.all([
      this.prisma.employee.findUnique({ where: { id: employeeId }, select: { shift: true } }),
      this.prisma.shiftRosterEntry.findMany({
        where: { employeeId, date: { gte: startUtc, lt: endUtc } },
        include: { shift: true, project: { select: { name: true } } }
      })
    ]);

    const byDate = new Map(entries.map(e => [this.ymd(e.date), e]));
    const schedule: any[] = [];

    for (let i = 0; i < 14; i++) {
      const day = this.addDays(today, i);
      const key = this.ymd(day);
      const weekday = day.toLocaleDateString('en-US', { weekday: 'long' });
      const entry = byDate.get(key);

      if (entry) {
        if (entry.isDayOff) {
          schedule.push({ date: key, weekday, isDayOff: true, shiftName: 'Day Off', shortCode: null, startTime: null, endTime: null, note: entry.note || '', projectName: entry.project?.name || null });
          continue;
        }
        const shift = entry.shift || employee?.shift;
        schedule.push({
          date: key,
          weekday,
          isDayOff: false,
          shiftName: shift?.name || 'Unassigned',
          shortCode: shift?.shortCode || null,
          startTime: entry.startTime || shift?.startTime || null,
          endTime: entry.endTime || shift?.endTime || null,
          note: entry.note || '',
          projectName: entry.project?.name || null
        });
        continue;
      }

      const shift = employee?.shift;
      if (!shift) {
        schedule.push({ date: key, weekday, isDayOff: false, shiftName: 'Not Assigned', shortCode: null, startTime: null, endTime: null, note: '', projectName: null });
        continue;
      }
      const works = !shift.workingDays || shift.workingDays.split(',').includes(weekday);
      schedule.push({
        date: key,
        weekday,
        isDayOff: !works,
        shiftName: works ? shift.name : 'Day Off',
        shortCode: works ? shift.shortCode || null : null,
        startTime: works ? shift.startTime || null : null,
        endTime: works ? shift.endTime || null : null,
        note: works ? 'Default shift' : '',
        projectName: null
      });
    }

    return schedule;
  }

  private async getMyTickets(companyId: number, employeeId: number | null) {
    if (!employeeId) return [];
    return this.prisma.ticket.findMany({
      where: { companyId, OR: [{ reporterId: employeeId }, { assigneeId: employeeId }] },
      select: { id: true, ticketNumber: true, title: true, status: true, priority: true, type: true, createdAt: true, resolvedAt: true },
      orderBy: { createdAt: 'desc' },
      take: 6
    });
  }

  private async getMyTaskStats(companyId: number, employeeId: number | null) {
    if (!employeeId) return { pending: 0, overdue: 0 };
    const today = this.startOfToday();
    const base = {
      project: { companyId },
      isArchived: false,
      OR: [{ assigneeId: employeeId }, { reporterId: employeeId }]
    };
    const [pending, overdue] = await Promise.all([
      this.prisma.issue.count({ where: { ...base, status: { notIn: ['DONE', 'CANCELLED'] } } }),
      this.prisma.issue.count({ where: { ...base, status: { notIn: ['DONE', 'CANCELLED'] }, dueDate: { lt: today } } })
    ]);
    return { pending, overdue };
  }

  private async getMyProjectStats(companyId: number, employeeId: number | null) {
    if (!employeeId) return { inProgress: 0, overdue: 0, total: 0 };
    const today = this.startOfToday();
    const base = {
      companyId,
      isSystem: false,
      OR: [{ leadId: employeeId }, { members: { some: { employeeId } } }]
    };
    const [inProgress, overdue, total] = await Promise.all([
      this.prisma.project.count({ where: { ...base, workStatus: 'ACTIVE' } }),
      this.prisma.project.count({ where: { ...base, workStatus: { notIn: ['COMPLETED', 'CLOSED', 'CANCELLED'] }, endDate: { lt: today } } }),
      this.prisma.project.count({ where: base })
    ]);
    return { inProgress, overdue, total };
  }

  /**
   * This week's logged time, Monday-first, with a break estimate.
   *
   * Logged minutes come from the task timers. "Break" is attendance span minus
   * logged time for the days that have both, clamped at zero — time at work that
   * never reached a task. It is deliberately an estimate: without it the widget
   * would show a number that looks like a fact but isn't one.
   */
  private async getWeekTimelogs(employeeId: number | null) {
    const today = this.startOfToday();
    const dow = today.getDay();
    const monday = this.addDays(today, dow === 0 ? -6 : 1 - dow);
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    const days = labels.map((label, i) => {
      const d = this.addDays(monday, i);
      return { date: this.ymd(d), label, minutes: 0 };
    });

    if (!employeeId) return { days, totalMinutes: 0, breakMinutes: 0 };

    const [logs, attendances] = await Promise.all([
      this.prisma.issueTimeLog.findMany({
        where: { employeeId, startedAt: { gte: monday }, durationMin: { not: null } },
        select: { startedAt: true, durationMin: true }
      }),
      this.prisma.attendance.findMany({
        where: {
          employeeId,
          date: { gte: this.utcMidnight(monday) },
          clockIn: { not: null },
          clockOut: { not: null }
        },
        select: { clockIn: true, clockOut: true }
      })
    ]);

    let total = 0;
    for (const log of logs) {
      const key = this.ymd(new Date(log.startedAt));
      const day = days.find(d => d.date === key);
      const minutes = log.durationMin || 0;
      if (day) day.minutes += minutes;
      total += minutes;
    }

    let span = 0;
    for (const a of attendances) {
      if (!a.clockIn || !a.clockOut) continue;
      span += Math.max(0, (a.clockOut.getTime() - a.clockIn.getTime()) / 60000);
    }

    return {
      days: days.map(d => ({ ...d, minutes: Math.round(d.minutes) })),
      totalMinutes: Math.round(total),
      breakMinutes: Math.max(0, Math.round(span - total))
    };
  }

  /**
   * The week strip: everything happening Monday–Sunday that involves the
   * employee or the company — holidays, colleagues' birthdays, their own
   * approved leave, and their rostered shift days.
   */
  private async getMyCalendar(companyId: number, employeeId: number | null) {
    const today = this.startOfToday();
    const dow = today.getDay();
    const monday = this.addDays(today, dow === 0 ? -6 : 1 - dow);
    const sunday = this.addDays(monday, 6);
    const startKey = this.ymd(monday);
    const endKey = this.ymd(sunday);
    const startUtc = this.utcMidnight(monday);
    const endUtc = this.utcMidnight(this.addDays(sunday, 1));

    const [holidays, employees, leaves, rosterEntries] = await Promise.all([
      this.prisma.holiday.findMany({ where: { companyId, date: { gte: startUtc, lt: endUtc } }, select: { id: true, name: true, date: true } }),
      this.prisma.employee.findMany({ where: { companyId }, select: { id: true, firstName: true, lastName: true, dateOfBirth: true } }),
      this.prisma.leaveRequest.findMany({
        where: { employee: { companyId }, status: 'APPROVED', startDate: { lt: endUtc }, endDate: { gte: startUtc } },
        include: {
          leaveType: { select: { name: true } },
          employee: { select: { id: true, firstName: true, lastName: true } }
        }
      }),
      employeeId
        ? this.prisma.shiftRosterEntry.findMany({
            where: { employeeId, date: { gte: startUtc, lt: endUtc } },
            include: { shift: { select: { name: true } } }
          })
        : Promise.resolve([])
    ]);

    const events: any[] = [];

    for (const h of holidays) {
      events.push({ date: this.ymd(h.date), type: 'HOLIDAY', title: h.name, subtitle: 'Company holiday' });
    }

    // Birthdays: pull the occurrence into this calendar week.
    for (const e of employees) {
      if (!e.dateOfBirth) continue;
      const marker = new Date(monday.getFullYear(), e.dateOfBirth.getMonth(), e.dateOfBirth.getDate());
      if (marker < monday) marker.setFullYear(marker.getFullYear() + 1);
      const key = this.ymd(marker);
      if (key >= startKey && key <= endKey) {
        events.push({ date: key, type: 'BIRTHDAY', title: `${e.firstName} ${e.lastName}`, subtitle: 'Birthday' });
      }
    }

    for (const l of leaves) {
      const from = this.ymd(l.startDate);
      const to = this.ymd(l.endDate);
      const name = `${l.employee?.firstName || ''} ${l.employee?.lastName || ''}`.trim() || 'Employee';
      for (const day of this.daysBetween(monday, sunday)) {
        const key = this.ymd(day);
        if (key >= from && key <= to) {
          const mine = l.employeeId === employeeId;
          events.push({
            date: key,
            type: 'LEAVE',
            title: name,
            subtitle: mine ? `${l.leaveType?.name || 'Leave'} (You)` : l.leaveType?.name || 'Leave',
            mine
          });
        }
      }
    }

    for (const r of rosterEntries) {
      events.push({
        date: this.ymd(r.date),
        type: r.isDayOff ? 'DAY_OFF' : 'SHIFT',
        title: r.isDayOff ? 'Day Off' : r.shift?.name || 'Shift',
        subtitle: r.isDayOff ? '' : 'Your shift'
      });
    }

    return {
      weekStart: startKey,
      weekEnd: endKey,
      days: this.daysBetween(monday, sunday).map(d => ({ date: this.ymd(d), label: d.toLocaleDateString('en-US', { weekday: 'short' }), dayNum: d.getDate() })),
      events
    };
  }

  private async getProbationInfo(employeeId: number | null) {
    if (!employeeId) return null;
    const e = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { nextAppraisalDate: true, joiningDate: true, employmentCategory: true }
    });
    if (!e) return null;
    return { nextAppraisalDate: e.nextAppraisalDate, joiningDate: e.joiningDate, employmentCategory: e.employmentCategory };
  }

  private startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private addDays(d: Date, n: number) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  /** Calendar day as YYYY-MM-DD from local parts — matches how a @db.Date reads. */
  private ymd(d: Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** UTC midnight for a local calendar day, for @db.Date range filters. */
  private utcMidnight(d: Date) {
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  }

  private daysBetween(start: Date, end: Date) {
    const out: Date[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      out.push(new Date(d));
    }
    return out;
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
    // No avatarUrl here — this is fetched for every employee on every dashboard
    // load, and the Upcoming Celebrations widget never renders a photo.
    const employees = await this.prisma.employee.findMany({
      where: { companyId },
      select: { id: true, firstName: true, lastName: true, dateOfBirth: true, joiningDate: true }
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
