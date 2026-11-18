import { isRestDay } from '../common/rest-day';
import { personalDaysOff } from '../common/weekly-offs';
import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The Timesheet (§20–§22).
 *
 * Three numbers per day, and the relationship between them is the point:
 *
 *   Login hours    — how long the person was clocked in (Attendance)
 *   Logged hours   — how much of that they booked to work (IssueTimeLog)
 *   Unlogged hours — the difference
 *
 * Unlogged is the figure the screen exists for. Logged time on its own says
 * nothing about whether a day is accounted for; an eight-hour day with two
 * hours booked is the thing a manager needs to see.
 */

export type TimesheetStatus = 'NOT_SUBMITTED' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

/** The four §21 views, as one screen with a scope switcher rather than four routes. */
export type TimesheetScope = 'ME' | 'TEAM' | 'ALL' | 'FINANCE';

/**
 * The §21 filter set, as the screen sends it.
 *
 * `project`, `client` and `source` narrow the LOGS; `employee`, `department`
 * and `pm` narrow WHO is listed. The distinction matters: filtering the logs
 * changes what "logged" means for a day, and so makes unlogged hours
 * meaningless — see `hoursFiltered` on the response.
 */
export interface TimesheetFilters {
  employeeId?: number;
  projectId?: number;
  clientId?: number;
  departmentId?: number;
  pmId?: number;
  source?: 'MANUAL' | 'TIMER';
  status?: TimesheetStatus;
  /** Free text over the task key and title — 1,400 issues is not a dropdown. */
  task?: string;
  /**
   * §21's Billable/Non-billable. Read from Project.billingType rather than a
   * flag of its own: a project billed hourly or fixed-price is billable work,
   * and duplicating that into a second field is how the two start disagreeing.
   */
  billable?: 'BILLABLE' | 'NON_BILLABLE';
}

/**
 * A single time log longer than this is an unstopped timer, not a shift.
 *
 * Worksuite had no auto-stop and the migrated history is full of them — one
 * person has four separate 24.0h logs against the same onsite task. They were
 * imported deliberately rather than dropped, so the screen has to be able to
 * point at them: a day nobody can explain is worse than a day marked odd.
 */
const IMPLAUSIBLE_ENTRY_HOURS = 12;

const ATTENDANCE_SELECT = {
  date: true, clockIn: true, clockOut: true, autoClockedOut: true, missedClockOut: true,
} as const;

const TIME_LOG_SELECT = {
  id: true, startedAt: true, endedAt: true, durationMin: true, source: true, note: true,
  issue: {
    select: {
      id: true, key: true, title: true,
      project: { select: { id: true, name: true, key: true, client: { select: { name: true } } } },
      taskType: { select: { name: true } },
    },
  },
} as const;

const SUBMISSION_SELECT = {
  date: true, status: true, submittedHours: true, submittedAt: true,
  rejectionReason: true, reviewedAt: true,
  reviewedBy: { select: { id: true, firstName: true, lastName: true } },
} as const;

@Injectable()
export class TimesheetsService {
  constructor(private prisma: PrismaService) {}

  private readonly REVIEW_ROLES = ['SUPERADMIN', 'ADMIN'];
  /** §23's cost figures follow the same roles as project financials. */
  private readonly FINANCE_ROLES = ['SUPERADMIN', 'ADMIN', 'FINANCE'];

  /**
   * The calendar day a moment belongs to, in LOCAL time.
   *
   * Not toISOString().slice(0,10): that is UTC, and east of Greenwich local
   * midnight falls on the previous UTC date — so in IST every day's own logs
   * were filed under the day before and the grid came back empty.
   *
   * Attendance.date is a @db.Date stamped at midnight, which Prisma hands back
   * as UTC midnight, so those are read with UTC parts and everything else with
   * local ones. Hence the two helpers.
   */
  private dayKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** The key for a @db.Date column, which carries no time zone of its own. */
  private dateColumnKey(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  private hours(minutes: number): number {
    return Math.round((minutes / 60) * 100) / 100;
  }

  /**
   * One employee's rows turned into one day per calendar date.
   *
   * Pure assembly, no querying: `getWeek` fetches for a single person and the
   * team views fetch for everyone at once, and both have to produce exactly
   * the same day. When that logic lived inside getWeek, the only way to build
   * a team view was to call it once per employee — forty people meant a
   * hundred and twenty queries for one screen.
   *
   * `includeEntries` is off for the list views, where a row per person per day
   * is the whole payload and nobody has opened anything yet.
   */
  /**
   * Tag days that are a company holiday, approved leave or the person's weekly
   * off (19 Nov 2026), so timesheets show the whole row as "Holiday · Diwali",
   * "On leave · Casual Leave" or "Week off" instead of an empty / unlogged day.
   * Works for one person (My Timesheet) or many (team views).
   */
  private async markOffDays(companyId: number, daysByEmployee: Map<number, any[]>, start: Date, end: Date) {
    const ids = [...daysByEmployee.keys()];
    if (!ids.length) return;
    const pad = 86400000;
    const [leaves, holidays, people] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: { employeeId: { in: ids }, status: 'APPROVED', deletedAt: null, startDate: { lte: new Date(end.getTime() + pad) }, endDate: { gte: new Date(start.getTime() - pad) } },
        select: { employeeId: true, startDate: true, endDate: true, isHalfDay: true, halfDayPeriod: true, leaveType: { select: { name: true, isPaid: true } } },
      }),
      this.prisma.holiday.findMany({
        where: { companyId, date: { gte: new Date(start.getTime() - pad), lte: new Date(end.getTime() + pad) } },
        select: { name: true, date: true },
      }),
      this.prisma.employee.findMany({
        where: { id: { in: ids } },
        select: { id: true, weeklyOffs: true, shift: { select: { workingDays: true } }, branch: { select: { weeklyOffs: true } } },
      }),
    ]);
    const holidayBy = new Map(holidays.map((h) => [this.dateColumnKey(h.date), h.name]));
    const personBy = new Map(people.map((p) => [p.id, personalDaysOff(p as any)]));
    for (const [empId, days] of daysByEmployee) {
      const mine = leaves.filter((l) => l.employeeId === empId);
      const rule = personBy.get(empId);
      for (const d of days) {
        const hol = holidayBy.get(d.date);
        if (hol) { d.offDay = { type: 'HOLIDAY', label: `Holiday · ${hol}`, short: 'Holiday' }; continue; }
        const lv = mine.find((l) => this.dateColumnKey(l.startDate) <= d.date && this.dateColumnKey(l.endDate) >= d.date);
        if (lv) {
          const name = lv.leaveType?.name ?? 'Leave';
          d.offDay = {
            type: lv.leaveType?.isPaid === false ? 'LOP' : 'LEAVE',
            label: `On leave · ${name}${lv.isHalfDay ? ` (half day${lv.halfDayPeriod ? ' ' + lv.halfDayPeriod : ''})` : ''}`,
            short: lv.isHalfDay ? 'Half leave' : 'Leave',
            halfDay: !!lv.isHalfDay,
          };
          continue;
        }
        if (rule && isRestDay(new Date(`${d.date}T00:00:00.000Z`), null, rule.shiftWorkingDays, rule.weeklyOffs)) {
          d.offDay = { type: 'WEEK_OFF', label: 'Week off', short: 'Week off' };
        }
      }
    }
  }

  /**
   * Work that isn't a task timer, shaped like a time log so assembleDays
   * treats it the same (19 Nov 2026): ticket time entries, field-visit time
   * on site (clock-in → clock-out), and manual "Add work" lines.
   */
  private async extraLogs(companyId: number, employeeIds: number[], start: Date, end: Date): Promise<any[]> {
    if (!employeeIds.length) return [];
    const mins = (a: Date, b: Date | null) => (b ? Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000)) : 0);
    const [tickets, visits, work] = await Promise.all([
      this.prisma.ticketTimeEntry.findMany({
        where: { userId: { in: employeeIds }, startTime: { gte: start, lte: end }, endTime: { not: null }, ticket: { companyId } },
        select: { id: true, userId: true, startTime: true, endTime: true, notes: true, ticket: { select: { id: true, ticketNumber: true, title: true } } },
      }),
      this.prisma.fieldVisitAttendance.findMany({
        where: { employeeId: { in: employeeIds }, companyId, clockInTime: { gte: start, lte: end }, clockOutTime: { not: null } },
        select: { id: true, employeeId: true, clockInTime: true, clockOutTime: true, request: { select: { id: true, requestNumber: true, location: true, project: { select: { id: true, name: true } } } } },
      }),
      this.prisma.timesheetWorkEntry.findMany({
        where: { companyId, employeeId: { in: employeeIds }, date: { gte: new Date(start.toISOString().slice(0, 10) + 'T00:00:00.000Z'), lte: end } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const out: any[] = [];
    for (const t of tickets) out.push({
      id: `T${t.id}`, employeeId: t.userId, startedAt: t.startTime, endedAt: t.endTime, durationMin: mins(t.startTime, t.endTime),
      source: 'TICKET', note: t.notes ?? null, kind: 'TICKET', title: `${t.ticket.ticketNumber} · ${t.ticket.title}`, ticketId: t.ticket.id,
    });
    for (const v of visits) out.push({
      id: `F${v.id}`, employeeId: v.employeeId, startedAt: v.clockInTime, endedAt: v.clockOutTime, durationMin: mins(v.clockInTime!, v.clockOutTime),
      source: 'FIELD_VISIT', note: v.request?.location ?? null, kind: 'FIELD_VISIT',
      title: `Field visit ${v.request?.requestNumber ?? ''}`.trim(), projectName: v.request?.project?.name ?? null,
    });
    for (const w of work) out.push({
      // Noon of the stored day so it lands on that date in any time zone.
      id: `W${w.id}`, workId: w.id, employeeId: w.employeeId, startedAt: new Date(w.date.toISOString().slice(0, 10) + 'T12:00:00'), endedAt: null,
      durationMin: w.minutes, source: 'WORK', note: w.description, kind: 'WORK', title: w.description,
      projectId: w.projectId, issueId: w.issueId, ticketId: w.ticketId,
    });
    return out;
  }

  private assembleDays(
    start: Date,
    end: Date,
    attendance: any[],
    logs: any[],
    submissions: any[],
    includeEntries: boolean,
  ): any[] {
    const attendanceByDay = new Map(attendance.map((a) => [this.dateColumnKey(a.date), a]));
    const submissionByDay = new Map(submissions.map((s) => [this.dateColumnKey(s.date), s]));

    const logsByDay = new Map<string, any[]>();
    for (const log of logs) {
      const key = this.dayKey(log.startedAt);
      if (!logsByDay.has(key)) logsByDay.set(key, []);
      logsByDay.get(key)!.push(log);
    }

    const days: any[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = this.dayKey(d);
      const att = attendanceByDay.get(key);
      const dayLogs = logsByDay.get(key) ?? [];
      const submission = submissionByDay.get(key);

      const loggedMin = dayLogs.reduce((sum, l) => sum + (l.durationMin ?? 0), 0);
      // An open session contributes nothing: see the note on getWeek.
      const loginMin = att?.clockIn && att?.clockOut
        ? Math.max(0, Math.round((att.clockOut.getTime() - att.clockIn.getTime()) / 60000))
        : 0;

      const loggedHours = this.hours(loggedMin);
      const loginHours = this.hours(loginMin);

      // §20's Manual/Timer column, as a split rather than a flag: a day is
      // rarely all one or all the other.
      const manualMin = dayLogs
        .filter((l) => l.source === 'MANUAL' || l.source === 'WORK')
        .reduce((sum, l) => sum + (l.durationMin ?? 0), 0);

      // The longest single sitting on this day. Reported rather than corrected:
      // the hours are somebody's to fix, not this endpoint's to rewrite.
      const longestEntryMin = dayLogs.reduce((max, l) => Math.max(max, l.durationMin ?? 0), 0);

      const day: any = {
        date: key,
        clockIn: att?.clockIn ?? null,
        clockOut: att?.clockOut ?? null,
        /// An auto-closed day's clock-out is a cutoff, not an observation, so
        /// the hours built from it are an estimate and the UI says so.
        autoClockedOut: att?.autoClockedOut ?? false,
        sessionOpen: !!att?.clockIn && !att?.clockOut,
        loginHours,
        loggedHours,
        manualHours: this.hours(manualMin),
        timerHours: this.hours(loggedMin - manualMin),
        // Never negative. Booking more than you were clocked in for is a data
        // problem, not nine hours of unlogged time.
        unloggedHours: Math.max(0, Math.round((loginHours - loggedHours) * 100) / 100),
        overLogged: loggedHours > loginHours && loginHours > 0,
        longestEntryHours: this.hours(longestEntryMin),
        /**
         * An entry too long to be a real sitting. Deliberately independent of
         * attendance: the days that need this most are the ones with no
         * clock-in at all — a weekend with 22 hours booked never trips
         * `overLogged`, because that test needs login hours to compare against.
         */
        hasImplausibleEntry: longestEntryMin > IMPLAUSIBLE_ENTRY_HOURS * 60,
        /** Booked time on a day the person was never clocked in for. */
        loggedWithoutLogin: loggedHours > 0 && loginHours === 0 && !att?.clockIn,
        status: (submission?.status ?? 'NOT_SUBMITTED') as TimesheetStatus,
        submittedHours: submission?.submittedHours ?? null,
        // Logs stay editable after submission; this is how that shows up.
        changedSinceSubmission:
          submission != null && Math.abs((submission.submittedHours ?? 0) - loggedHours) > 0.01,
        rejectionReason: submission?.rejectionReason ?? null,
        reviewedBy: submission?.reviewedBy ?? null,
        reviewedAt: submission?.reviewedAt ?? null,
      };

      if (includeEntries) {
        day.entries = dayLogs.map((l) => ({
          id: l.id,
          // TASK (timer / manual task log) · TICKET · FIELD_VISIT · WORK (manual "Add work")
          kind: l.kind ?? 'TASK',
          workId: l.workId ?? null,
          title: l.title ?? null,
          issueId: l.issue?.id ?? l.issueId ?? null,
          issueKey: l.issue?.key ?? null,
          issueTitle: l.issue?.title ?? null,
          projectId: l.issue?.project?.id ?? l.projectId ?? null,
          projectName: l.issue?.project?.name ?? l.projectName ?? null,
          projectCode: l.issue?.project?.key ?? null,
          clientName: l.issue?.project?.client?.name ?? null,
          taskType: l.issue?.taskType?.name ?? null,
          startedAt: l.startedAt,
          endedAt: l.endedAt,
          hours: this.hours(l.durationMin ?? 0),
          source: l.source,
          /// §19's description — what the person was actually doing. Migrated
          /// Workway logs carry their memo here.
          note: l.note ?? null,
        }));
      }

      days.push(day);
    }

    return days;
  }

  /**
   * One employee's week, day by day.
   *
   * Login hours come from a day's clock-in/clock-out pair. A day still open —
   * somebody is working right now — counts nothing rather than counting up to
   * the current time, because a running day is not yet a fact and would make
   * unlogged hours climb through the afternoon.
   */
  async getWeek(companyId: number, employeeId: number, startDateStr: string, endDateStr: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: { id: true, firstName: true, lastName: true, avatarUrl: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const start = new Date(`${startDateStr}T00:00:00`);
    const end = new Date(`${endDateStr}T23:59:59.999`);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('A valid date range is required');
    }

    const [attendance, logs, submissions] = await Promise.all([
      this.prisma.attendance.findMany({
        where: { employeeId, date: { gte: start, lte: end } },
        select: ATTENDANCE_SELECT,
      }),
      this.prisma.issueTimeLog.findMany({
        where: { employeeId, startedAt: { gte: start, lte: end }, issue: { companyId } },
        select: TIME_LOG_SELECT,
        orderBy: { startedAt: 'asc' },
      }),
      this.prisma.timesheetDay.findMany({
        where: { employeeId, date: { gte: start, lte: end } },
        select: SUBMISSION_SELECT,
      }),
    ]);

    const extras = await this.extraLogs(companyId, [employeeId], start, end);
    const allLogs = [...logs, ...extras].sort((a: any, b: any) => +new Date(a.startedAt) - +new Date(b.startedAt));
    const days = this.assembleDays(start, end, attendance, allLogs, submissions, true);
    await this.markOffDays(companyId, new Map([[employeeId, days]]), start, end);

    const totals = days.reduce(
      (acc, d) => ({
        loginHours: Math.round((acc.loginHours + d.loginHours) * 100) / 100,
        loggedHours: Math.round((acc.loggedHours + d.loggedHours) * 100) / 100,
        unloggedHours: Math.round((acc.unloggedHours + d.unloggedHours) * 100) / 100,
      }),
      { loginHours: 0, loggedHours: 0, unloggedHours: 0 },
    );

    return { employee, days, totals };
  }

  /**
   * Someone else's week, for a viewer allowed to see it: admins and finance
   * (who already list everyone), or a project manager for a person on — or
   * logging time to — one of their projects that week, the same people the
   * TEAM view lists. Being in the same company is not enough: a week carries
   * every task note, and colleagues should not read each other's.
   */
  async getWeekForViewer(
    companyId: number,
    viewerEmployeeId: number | null,
    role: string,
    employeeId: number,
    startDateStr: string,
    endDateStr: string,
  ) {
    const allowed =
      viewerEmployeeId === employeeId ||
      this.FINANCE_ROLES.includes(role) ||
      // 17 Nov 2026: HR reads a person's week on their profile (read-only).
      ['HR', 'SUPER_ADMIN'].includes(String(role || '').toUpperCase()) ||
      (await this.visibleEmployeeIds(
        companyId, viewerEmployeeId, 'TEAM',
        new Date(`${startDateStr}T00:00:00`), new Date(`${endDateStr}T23:59:59.999`),
        { employeeId },
      )).includes(employeeId);
    if (!allowed) throw new ForbiddenException("You can't view this person's timesheet");
    return this.getWeek(companyId, employeeId, startDateStr, endDateStr);
  }

  /**
   * Tasks to pick in "Add work" (19 Nov 2026): the caller's tasks for that
   * date (scheduled across it, due that day, or worked on that day) plus all
   * their open tasks and anything finished in the last 30 days.
   */
  async myTasksForDate(companyId: number, employeeId: number | null, dateStr: string) {
    if (!employeeId) return { onDate: [], all: [] };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))) throw new BadRequestException('A valid date is required');
    const dayStart = new Date(`${dateStr}T00:00:00`), dayEnd = new Date(`${dateStr}T23:59:59.999`);
    const since = new Date(dayStart.getTime() - 30 * 86400000);
    const select = { id: true, key: true, title: true, status: true, startDate: true, dueDate: true, project: { select: { id: true, name: true } } } as const;
    const [mine, worked] = await Promise.all([
      this.prisma.issue.findMany({
        where: { companyId, assigneeId: employeeId, isArchived: false, OR: [{ status: { notIn: ['DONE', 'CANCELLED'] } }, { completedAt: { gte: since } }, { dueDate: { gte: since } }] },
        select, orderBy: [{ dueDate: 'asc' }], take: 300,
      }),
      this.prisma.issueTimeLog.findMany({ where: { employeeId, startedAt: { gte: dayStart, lte: dayEnd } }, select: { issueId: true } }),
    ]);
    const workedIds = new Set(worked.map((w) => w.issueId));
    const onDay = (t: any) => workedIds.has(t.id)
      || (t.dueDate && t.dueDate >= dayStart && t.dueDate <= dayEnd)
      || (t.startDate && t.startDate <= dayEnd && (!t.dueDate || t.dueDate >= dayStart));
    const shape = (t: any) => ({ id: t.id, key: t.key, title: t.title, status: t.status, projectId: t.project?.id ?? null, projectName: t.project?.name ?? null });
    return { onDate: mine.filter(onDay).map(shape), all: mine.map(shape) };
  }

  // ── Manual "Add work" entries (19 Nov 2026) ──────────────────────────────

  private async assertDayOpen(employeeId: number, dateStr: string) {
    const day = await this.prisma.timesheetDay.findFirst({ where: { employeeId, date: new Date(`${dateStr}T00:00:00`) }, select: { status: true } });
    if (day?.status === 'APPROVED') throw new BadRequestException('This day is already approved — it can no longer be changed.');
  }

  private validWork(body: any) {
    const date = String(body?.date ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('Pick the date.');
    const minutes = Math.round(Number(body?.minutes));
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 16 * 60) throw new BadRequestException('Time must be between 5 minutes and 16 hours.');
    const description = String(body?.description ?? '').trim();
    if (description.length < 3) throw new BadRequestException('Describe what you did.');
    const num = (v: any) => (v == null || v === '' ? null : Number(v));
    return { date, minutes, description: description.slice(0, 1000), projectId: num(body?.projectId), issueId: num(body?.issueId), ticketId: num(body?.ticketId) };
  }

  async addWork(companyId: number, employeeId: number | null, body: any) {
    if (!employeeId) throw new ForbiddenException('No employee profile');
    const w = this.validWork(body);
    await this.assertDayOpen(employeeId, w.date);
    return this.prisma.timesheetWorkEntry.create({ data: { companyId, employeeId, ...w, date: new Date(`${w.date}T00:00:00.000Z`) } });
  }

  async updateWork(companyId: number, employeeId: number | null, id: number, body: any) {
    const row = await this.prisma.timesheetWorkEntry.findFirst({ where: { id, companyId, employeeId: employeeId ?? -1 } });
    if (!row) throw new NotFoundException('Entry not found');
    const w = this.validWork({ ...body, date: body?.date ?? row.date.toISOString().slice(0, 10) });
    await this.assertDayOpen(row.employeeId, row.date.toISOString().slice(0, 10));
    await this.assertDayOpen(row.employeeId, w.date);
    return this.prisma.timesheetWorkEntry.update({ where: { id }, data: { ...w, date: new Date(`${w.date}T00:00:00.000Z`) } });
  }

  async deleteWork(companyId: number, employeeId: number | null, id: number) {
    const row = await this.prisma.timesheetWorkEntry.findFirst({ where: { id, companyId, employeeId: employeeId ?? -1 } });
    if (!row) throw new NotFoundException('Entry not found');
    await this.assertDayOpen(row.employeeId, row.date.toISOString().slice(0, 10));
    await this.prisma.timesheetWorkEntry.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * Submit a day for review.
   *
   * Re-submitting an already-submitted or rejected day updates the row rather
   * than adding a second one — a corrected day is the same day. An APPROVED
   * day is left alone: reopening somebody else's approval is a review action,
   * not the employee's to take.
   */
  async submitDay(companyId: number, employeeId: number, dateStr: string) {
    const date = new Date(`${dateStr}T00:00:00`);
    if (isNaN(date.getTime())) throw new BadRequestException('A valid date is required');

    const { days } = await this.getWeek(companyId, employeeId, dateStr, dateStr);
    const day = days[0];
    if (!day || day.loggedHours <= 0) {
      throw new BadRequestException('There are no hours logged on this day to submit');
    }

    const existing = await this.prisma.timesheetDay.findUnique({
      where: { employeeId_date: { employeeId, date } },
      select: { id: true, status: true },
    });

    if (existing?.status === 'APPROVED') {
      throw new BadRequestException('This day has already been approved');
    }

    return this.prisma.timesheetDay.upsert({
      where: { employeeId_date: { employeeId, date } },
      create: {
        employeeId, date, companyId,
        status: 'SUBMITTED',
        submittedHours: day.loggedHours,
      },
      update: {
        status: 'SUBMITTED',
        submittedHours: day.loggedHours,
        submittedAt: new Date(),
        // A re-submission is a fresh request, so the previous rejection and
        // reviewer are cleared rather than lingering beside a pending day.
        rejectionReason: null,
        reviewedById: null,
        reviewedAt: null,
      },
    });
  }

  /**
   * Who may review a given employee's timesheet.
   *
   * Admins always. Otherwise the reviewer has to manage a project the person
   * actually booked time to that day — a project manager reviews the work done
   * for them, not everything a person did.
   */
  private async canReview(
    companyId: number,
    reviewerEmployeeId: number | null,
    role: string,
    employeeId: number,
    date: Date,
  ): Promise<boolean> {
    if (this.REVIEW_ROLES.includes(role)) return true;
    if (reviewerEmployeeId == null) return false;

    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const overlap = await this.prisma.issueTimeLog.findFirst({
      where: {
        employeeId,
        startedAt: { gte: date, lte: dayEnd },
        issue: {
          companyId,
          project: {
            OR: [
              { leadId: reviewerEmployeeId },
              { members: { some: { employeeId: reviewerEmployeeId, role: 'PROJECT_MANAGER' } } },
            ],
          },
        },
      },
      select: { id: true },
    });

    return !!overlap;
  }

  async reviewDay(
    companyId: number,
    reviewerEmployeeId: number | null,
    role: string,
    employeeId: number,
    dateStr: string,
    decision: 'APPROVED' | 'REJECTED',
    reason?: string,
  ) {
    const date = new Date(`${dateStr}T00:00:00`);
    if (isNaN(date.getTime())) throw new BadRequestException('A valid date is required');

    if (decision === 'REJECTED' && !reason?.trim()) {
      // §22. A rejection with no reason is an instruction nobody can act on.
      throw new BadRequestException('A reason is required when rejecting a timesheet');
    }

    if (reviewerEmployeeId === employeeId && !this.REVIEW_ROLES.includes(role)) {
      throw new ForbiddenException('You cannot review your own timesheet');
    }

    if (!(await this.canReview(companyId, reviewerEmployeeId, role, employeeId, date))) {
      throw new ForbiddenException('You do not manage a project this person booked time to on that day');
    }

    const existing = await this.prisma.timesheetDay.findUnique({
      where: { employeeId_date: { employeeId, date } },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('That day has not been submitted for review');

    return this.prisma.timesheetDay.update({
      where: { id: existing.id },
      data: {
        status: decision,
        reviewedById: reviewerEmployeeId,
        reviewedAt: new Date(),
        rejectionReason: decision === 'REJECTED' ? reason!.trim() : null,
      },
    });
  }

  /**
   * Who this scope is allowed to list (§21).
   *
   * TEAM is not "my direct reports": a project manager's team is the people
   * who worked on their projects, which is a different set and the one the
   * approval rule already uses. Project MEMBERS are included alongside the
   * people who logged time, because the row that matters most on a team
   * timesheet is the one showing nothing at all.
   */
  private async visibleEmployeeIds(
    companyId: number,
    viewerEmployeeId: number | null,
    scope: TimesheetScope,
    start: Date,
    end: Date,
    filters: TimesheetFilters,
  ): Promise<number[]> {
    /**
     * Everyone, active or not.
     *
     * Inactive people are listed rather than filtered out: their hours are part
     * of what a project cost and what a month looked like, and the person who
     * left is exactly the one whose timesheet nobody can go and ask about.
     *
     * "Inactive" means User.status = SUSPENDED, and only that.
     *
     * Two fields were tried before this one and both were wrong.
     * Employee.offboardingStatus is unused — NONE for 93 of 96 people and
     * SEPARATED for nobody — so filtering on it excluded no one while looking
     * like it did something. Then every non-ACTIVE status was treated as
     * inactive, which swept in PENDING_VERIFICATION: that is the column
     * DEFAULT, carried by 30 employees the bulk import created who never
     * clicked a verification email. Twelve of them have logged time, the most
     * recent two days ago. They are current staff, and badging them as
     * anything is a statement about account provisioning that has no business
     * on a timesheet.
     *
     * SUSPENDED survives the same test: 43 people, newest log five weeks old.
     */
    const where: any = { companyId };
    if (filters.employeeId) where.id = filters.employeeId;
    if (filters.departmentId) where.departmentId = filters.departmentId;

    if (scope === 'ALL' || scope === 'FINANCE') {
      const all = await this.prisma.employee.findMany({ where, select: { id: true } });
      return all.map((e) => e.id);
    }

    if (viewerEmployeeId == null) return [];

    const managed: any = {
      companyId,
      OR: [
        { leadId: viewerEmployeeId },
        { members: { some: { employeeId: viewerEmployeeId, role: 'PROJECT_MANAGER' } } },
      ],
    };
    if (filters.projectId) managed.id = filters.projectId;

    const [members, loggers] = await Promise.all([
      this.prisma.projectMember.findMany({
        where: { project: managed },
        select: { employeeId: true },
        distinct: ['employeeId'],
      }),
      this.prisma.issueTimeLog.findMany({
        where: { startedAt: { gte: start, lte: end }, issue: { companyId, project: managed } },
        select: { employeeId: true },
        distinct: ['employeeId'],
      }),
    ]);

    const candidates = new Set<number>([
      ...members.map((m) => m.employeeId),
      ...loggers.map((l) => l.employeeId),
    ]);
    // A PM reviews other people's time, not their own (§22).
    candidates.delete(viewerEmployeeId);
    if (candidates.size === 0) return [];

    const narrowed = await this.prisma.employee.findMany({
      where: { ...where, id: filters.employeeId ?? { in: Array.from(candidates) } },
      select: { id: true },
    });
    return narrowed.map((e) => e.id);
  }

  /**
   * The team, admin and finance views (§21) — one screen, one scope switch.
   *
   * A row per person with their week's totals, not their entries: opening
   * somebody's week is a second request, and sending every log for forty
   * people to render a summary is the thing that makes this screen slow.
   */
  async getOverview(
    companyId: number,
    viewerEmployeeId: number | null,
    role: string,
    scope: TimesheetScope,
    startDateStr: string,
    endDateStr: string,
    filters: TimesheetFilters = {},
  ) {
    const start = new Date(`${startDateStr}T00:00:00`);
    const end = new Date(`${endDateStr}T23:59:59.999`);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('A valid date range is required');
    }

    if (scope === 'ALL' && !this.REVIEW_ROLES.includes(role)) {
      throw new ForbiddenException('Only an administrator can see every employee');
    }
    if (scope === 'FINANCE' && !this.FINANCE_ROLES.includes(role)) {
      throw new ForbiddenException('Only finance and administrators can see cost hours');
    }

    const employeeIds = await this.visibleEmployeeIds(
      companyId, viewerEmployeeId, scope, start, end, filters,
    );

    // Hourly cost and cost totals: Super Admin only (19 Nov 2026).
    const canViewCost = role === 'SUPERADMIN';

    // Narrowing the logs changes what "logged" means for a day, so unlogged
    // hours stop being the gap they claim to be. The flag tells the screen to
    // stop showing that column rather than show a number that is now a lie.
    //
    // Computed BEFORE the empty-result branch: that branch used to hardcode
    // false, so a filtered query matching nobody reported itself as unfiltered
    // and the client would size its table for a column the data cannot fill.
    const hoursFiltered = !!(
      filters.projectId || filters.clientId || filters.source || filters.pmId ||
      filters.task?.trim() || filters.billable
    );

    if (employeeIds.length === 0) {
      // Same shape as a populated response. An empty result that drops fields
      // makes the client branch on "did anyone match" before it can read a
      // total, and the branch it forgets is the one that crashes.
      return {
        scope, canViewCost, hoursFiltered,
        employees: [],
        totals: {
          loginHours: 0, loggedHours: 0, unloggedHours: 0,
          manualHours: 0, timerHours: 0, cost: 0, unratedHours: 0,
        },
      };
    }

    const issueWhere: any = { companyId };
    const projectWhere: any = {};
    if (filters.projectId) projectWhere.id = filters.projectId;
    if (filters.clientId) projectWhere.clientId = filters.clientId;
    if (filters.billable) {
      projectWhere.billingType =
        filters.billable === 'BILLABLE' ? { not: 'NON_BILLABLE' } : 'NON_BILLABLE';
    }
    if (filters.pmId) {
      projectWhere.OR = [
        { leadId: filters.pmId },
        { members: { some: { employeeId: filters.pmId, role: 'PROJECT_MANAGER' } } },
      ];
    }
    if (Object.keys(projectWhere).length) issueWhere.project = projectWhere;
    if (filters.task?.trim()) {
      const q = filters.task.trim();
      issueWhere.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { key: { contains: q, mode: 'insensitive' } },
      ];
    }

    const logWhere: any = {
      employeeId: { in: employeeIds },
      startedAt: { gte: start, lte: end },
      issue: issueWhere,
    };
    if (filters.source) logWhere.source = filters.source;

    const [people, attendance, logs, submissions] = await Promise.all([
      this.prisma.employee.findMany({
        where: { id: { in: employeeIds } },
        select: {
          id: true, firstName: true, lastName: true, avatarUrl: true, employeeCode: true,
          user: { select: { status: true } },
          hourlyCostRate: canViewCost,
          department: { select: { id: true, name: true } },
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
      this.prisma.attendance.findMany({
        where: { employeeId: { in: employeeIds }, date: { gte: start, lte: end } },
        select: { ...ATTENDANCE_SELECT, employeeId: true },
      }),
      this.prisma.issueTimeLog.findMany({
        where: logWhere,
        select: { ...TIME_LOG_SELECT, employeeId: true },
        orderBy: { startedAt: 'asc' },
      }),
      this.prisma.timesheetDay.findMany({
        where: { employeeId: { in: employeeIds }, date: { gte: start, lte: end } },
        select: { ...SUBMISSION_SELECT, employeeId: true },
      }),
    ]);

    const bucket = <T extends { employeeId: number }>(rows: T[]) => {
      const by = new Map<number, T[]>();
      for (const r of rows) {
        if (!by.has(r.employeeId)) by.set(r.employeeId, []);
        by.get(r.employeeId)!.push(r);
      }
      return by;
    };
    const attBy = bucket(attendance as any[]);
    // Tickets, field visits and manual work belong to no project filter; leave
    // them out when the view is filtered by project / task / source.
    const narrowed = Object.keys(issueWhere).length > 0 || !!filters.source;
    const extras = narrowed ? [] : await this.extraLogs(companyId, employeeIds, start, end);
    const logBy = bucket([...(logs as any[]), ...extras]);
    const subBy = bucket(submissions as any[]);

    const daysBy = new Map<number, any[]>();
    for (const person of people) {
      daysBy.set(person.id, this.assembleDays(
        start, end,
        attBy.get(person.id) ?? [],
        logBy.get(person.id) ?? [],
        subBy.get(person.id) ?? [],
        false,
      ));
    }
    await this.markOffDays(companyId, daysBy, start, end);

    const employees = people.map((person) => {
      const days = daysBy.get(person.id)!;

      const totals = days.reduce(
        (acc, d) => ({
          loginHours: Math.round((acc.loginHours + d.loginHours) * 100) / 100,
          loggedHours: Math.round((acc.loggedHours + d.loggedHours) * 100) / 100,
          unloggedHours: Math.round((acc.unloggedHours + d.unloggedHours) * 100) / 100,
          manualHours: Math.round((acc.manualHours + d.manualHours) * 100) / 100,
          timerHours: Math.round((acc.timerHours + d.timerHours) * 100) / 100,
        }),
        { loginHours: 0, loggedHours: 0, unloggedHours: 0, manualHours: 0, timerHours: 0 },
      );

      const needsAttention = days.filter(
        (d) => d.hasImplausibleEntry || d.loggedWithoutLogin || d.overLogged,
      ).length;
      const pending = days.filter((d) => d.status === 'SUBMITTED').length;
      const approved = days.filter((d) => d.status === 'APPROVED').length;
      const rejected = days.filter((d) => d.status === 'REJECTED').length;

      const rate = canViewCost ? (person as any).hourlyCostRate ?? null : null;
      return {
        employee: {
          id: person.id,
          firstName: person.firstName,
          lastName: person.lastName,
          avatarUrl: person.avatarUrl,
          employeeCode: person.employeeCode,
          department: person.department,
          isInactive: (person as any).user?.status === 'SUSPENDED',
        },
        days: days.map((d) => ({
          date: d.date, loginHours: d.loginHours, loggedHours: d.loggedHours,
          unloggedHours: d.unloggedHours, manualHours: d.manualHours, timerHours: d.timerHours,
          status: d.status, sessionOpen: d.sessionOpen, overLogged: d.overLogged,
          changedSinceSubmission: d.changedSinceSubmission,
          hasImplausibleEntry: d.hasImplausibleEntry,
          loggedWithoutLogin: d.loggedWithoutLogin,
          offDay: d.offDay ?? null,
        })),
        totals,
        counts: { pending, approved, rejected, needsAttention },
        // §23's rate applied to this week. Null rather than zero when nobody
        // has set one — an unpriced person costing ₹0 is the lie phase 2 went
        // out of its way not to tell.
        cost: canViewCost
          ? { hourlyRate: rate, amount: rate == null ? null : Math.round(rate * totals.loggedHours * 100) / 100, unratedHours: rate == null ? totals.loggedHours : 0 }
          : undefined,
      };
    });

    // Active staff first. An inactive row is history, not something anybody is
    // going to act on this week.
    employees.sort((a, b) => {
      if (a.employee.isInactive !== b.employee.isInactive) return a.employee.isInactive ? 1 : -1;
      return 0;
    });

    const filtered = filters.status
      ? employees.filter((e) =>
          filters.status === 'NOT_SUBMITTED'
            ? e.days.some((d) => d.status === 'NOT_SUBMITTED' && d.loggedHours > 0)
            : e.days.some((d) => d.status === filters.status),
        )
      : employees;

    const totals = filtered.reduce(
      (acc, e) => ({
        loginHours: Math.round((acc.loginHours + e.totals.loginHours) * 100) / 100,
        loggedHours: Math.round((acc.loggedHours + e.totals.loggedHours) * 100) / 100,
        unloggedHours: Math.round((acc.unloggedHours + e.totals.unloggedHours) * 100) / 100,
        manualHours: Math.round((acc.manualHours + e.totals.manualHours) * 100) / 100,
        timerHours: Math.round((acc.timerHours + e.totals.timerHours) * 100) / 100,
        cost: canViewCost ? Math.round((acc.cost + (e.cost?.amount ?? 0)) * 100) / 100 : acc.cost,
        unratedHours: canViewCost ? Math.round((acc.unratedHours + (e.cost?.unratedHours ?? 0)) * 100) / 100 : acc.unratedHours,
      }),
      { loginHours: 0, loggedHours: 0, unloggedHours: 0, manualHours: 0, timerHours: 0, cost: 0, unratedHours: 0 },
    );

    return { scope, canViewCost, hoursFiltered, employees: filtered, totals };
  }

  /** Days waiting on this reviewer (§21, the PM's "My Team Timesheet"). */
  async getPendingReviews(companyId: number, reviewerEmployeeId: number | null, role: string) {
    const isAdmin = this.REVIEW_ROLES.includes(role);

    const submitted = await this.prisma.timesheetDay.findMany({
      where: { companyId, status: 'SUBMITTED' },
      orderBy: { date: 'desc' },
      take: 200,
      select: {
        id: true, date: true, submittedHours: true, submittedAt: true,
        employee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
    });

    if (isAdmin) return submitted;

    // A PM sees only the days that touched a project they manage. Filtered
    // per row because the answer depends on where the hours went, not on who
    // the person is.
    const visible = await Promise.all(
      submitted.map(async (d) =>
        (await this.canReview(companyId, reviewerEmployeeId, role, d.employee.id, d.date)) ? d : null,
      ),
    );
    return visible.filter(Boolean);
  }
}
