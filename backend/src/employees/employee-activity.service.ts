import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** One line on a person's Activity tab. */
export interface ActivityItem {
  at: string;
  area: ActivityArea;
  title: string;
  detail?: string;
  /** In-app link to the thing the line is about, when there is one. */
  link?: string;
  tone?: 'green' | 'red' | 'amber' | 'blue' | 'purple' | 'slate';
}

export type ActivityArea =
  | 'attendance' | 'requests' | 'leave' | 'tasks' | 'tickets'
  | 'field-visits' | 'timesheet' | 'documents' | 'employment' | 'recognition'
  | 'assets' | 'expenses' | 'payroll' | 'comp-off' | 'notices' | 'performance' | 'approvals';

export const ACTIVITY_AREAS: ActivityArea[] = [
  'attendance', 'requests', 'leave', 'tasks', 'tickets',
  'field-visits', 'timesheet', 'documents', 'employment', 'recognition',
  'assets', 'expenses', 'payroll', 'comp-off', 'notices', 'performance', 'approvals',
];

/**
 * Employee profile → Activity tab (17 Nov 2026).
 *
 * Built from records MIRA already keeps — no new tracking — so the timeline
 * has history from day one. Each source is read newest-first up to the page
 * size, then everything is merged and cut to one page; `nextBefore` is the
 * oldest time on the page, and the next page asks for everything older.
 */
@Injectable()
export class EmployeeActivityService {
  constructor(private prisma: PrismaService) {}

  async getActivity(
    companyId: number,
    viewer: { role?: string; employeeId?: number | null },
    employeeId: number,
    opts: { before?: string; limit?: number; areas?: string; from?: string; to?: string } = {},
  ): Promise<{ items: ActivityItem[]; nextBefore: string | null }> {
    const target = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: { id: true, userId: true, managerId: true, joiningDate: true, createdAt: true, firstName: true },
    });
    if (!target) throw new NotFoundException('Employee not found');
    const role = String(viewer.role || '').toUpperCase();
    const allowed = ['SUPERADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR'].includes(role)
      || viewer.employeeId === employeeId
      || (!!viewer.employeeId && target.managerId === viewer.employeeId);
    if (!allowed) throw new ForbiddenException("You can't view this person's activity.");

    const limit = Math.min(Math.max(Number(opts.limit) || 50, 10), 100);
    const before = opts.before ? new Date(opts.before) : new Date(Date.now() + 60_000);
    const from = opts.from ? new Date(`${opts.from}T00:00:00`) : undefined;
    const toEnd = opts.to ? new Date(`${opts.to}T23:59:59.999`) : undefined;
    const upper = toEnd && toEnd < before ? toEnd : before;
    const range = { lt: upper, ...(from ? { gte: from } : {}) };
    const wanted = new Set(
      (opts.areas || '').split(',').map((a) => a.trim()).filter((a) => ACTIVITY_AREAS.includes(a as ActivityArea)),
    );
    const want = (a: ActivityArea) => !wanted.size || wanted.has(a);
    const take = limit;
    const items: ActivityItem[] = [];
    const push = (i: ActivityItem | null) => { if (i && new Date(i.at) < upper && (!from || new Date(i.at) >= from)) items.push(i); };
    const t = (d: Date) => d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
    const day = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' });
    const range2 = (s: Date, e: Date) => (day(s) === day(e) ? day(s) : `${day(s)} – ${day(e)}`);
    const jobs: Promise<void>[] = [];

    // 1. Attendance: clock in / clock out
    if (want('attendance')) jobs.push((async () => {
      const rows = await this.prisma.attendance.findMany({
        where: { employeeId, clockIn: { not: null, ...range } },
        orderBy: { clockIn: 'desc' }, take,
        select: { clockIn: true, clockOut: true, isLate: true, isEarlyLeave: true, autoClockedOut: true, isOnsite: true },
      });
      for (const r of rows) {
        push({
          at: r.clockIn!.toISOString(), area: 'attendance', tone: r.isLate ? 'amber' : 'green',
          title: `Clocked in at ${t(r.clockIn!)}`,
          detail: [r.isLate ? 'Late' : '', r.isOnsite ? 'On site' : ''].filter(Boolean).join(' · ') || undefined,
        });
        if (r.clockOut) push({
          at: r.clockOut.toISOString(), area: 'attendance', tone: r.autoClockedOut ? 'red' : 'slate',
          title: r.autoClockedOut ? 'Auto clocked out at 11:00 PM' : `Clocked out at ${t(r.clockOut)}`,
          detail: r.autoClockedOut ? 'No clock-out was recorded' : r.isEarlyLeave ? 'Left early' : undefined,
        });
      }
    })());

    // 2. Attendance requests: regularizations
    if (want('requests')) jobs.push((async () => {
      const rows = await this.prisma.attendanceRegularization.findMany({
        where: { employeeId, updatedAt: range }, orderBy: { updatedAt: 'desc' }, take,
        select: { date: true, status: true, reason: true, rejectionReason: true, createdAt: true, updatedAt: true },
      });
      for (const r of rows) {
        push({ at: r.createdAt.toISOString(), area: 'requests', tone: 'blue', title: `Requested regularization for ${day(r.date)}`, detail: r.reason || undefined, link: '/attendance/regularizations' });
        if (r.status === 'APPROVED' || r.status === 'REJECTED') push({
          at: r.updatedAt.toISOString(), area: 'requests', tone: r.status === 'APPROVED' ? 'green' : 'red',
          title: `Regularization for ${day(r.date)} ${r.status === 'APPROVED' ? 'approved' : 'rejected'}`,
          detail: r.status === 'REJECTED' ? r.rejectionReason || undefined : undefined,
        });
      }
    })());

    // 3. Leave
    if (want('leave')) jobs.push((async () => {
      const rows = await this.prisma.leaveRequest.findMany({
        where: { employeeId, deletedAt: null, updatedAt: range }, orderBy: { updatedAt: 'desc' }, take,
        select: { startDate: true, endDate: true, isHalfDay: true, status: true, rejectionReason: true, createdAt: true, updatedAt: true, leaveType: { select: { name: true } } },
      });
      for (const r of rows) {
        const what = `${r.leaveType?.name || 'Leave'} · ${range2(r.startDate, r.endDate)}${r.isHalfDay ? ' (half day)' : ''}`;
        push({ at: r.createdAt.toISOString(), area: 'leave', tone: 'blue', title: 'Applied for leave', detail: what });
        if (['APPROVED', 'REJECTED', 'CANCELLED'].includes(r.status) && r.updatedAt.getTime() - r.createdAt.getTime() > 1000) push({
          at: r.updatedAt.toISOString(), area: 'leave',
          tone: r.status === 'APPROVED' ? 'green' : r.status === 'REJECTED' ? 'red' : 'slate',
          title: `Leave ${r.status.toLowerCase()}`,
          detail: r.status === 'REJECTED' && r.rejectionReason ? `${what} · ${r.rejectionReason}` : what,
        });
      }
    })());

    // 4. Tasks: created + what they did on tasks
    if (want('tasks')) jobs.push((async () => {
      const [created, acts] = await Promise.all([
        this.prisma.issue.findMany({
          where: { reporterId: employeeId, createdAt: range }, orderBy: { createdAt: 'desc' }, take,
          select: { key: true, title: true, createdAt: true },
        }),
        this.prisma.issueActivity.findMany({
          where: { actorId: employeeId, createdAt: range }, orderBy: { createdAt: 'desc' }, take,
          select: { action: true, field: true, oldValue: true, newValue: true, createdAt: true, issue: { select: { key: true, title: true } } },
        }),
      ]);
      for (const c of created) push({ at: c.createdAt.toISOString(), area: 'tasks', tone: 'purple', title: `Created task ${c.key}`, detail: c.title, link: `/tasks?search=${encodeURIComponent(c.key)}` });
      for (const a of acts) {
        const key = a.issue?.key || 'a task';
        const label: Record<string, string> = {
          STATUS_CHANGED: `Moved ${key} to ${pretty(a.newValue)}`,
          ASSIGNED: `Assigned ${key}`,
          COMMENT_ADDED: `Commented on ${key}`,
          PRIORITY_CHANGED: `Changed priority of ${key} to ${pretty(a.newValue)}`,
          WORK_STARTED: `Started work on ${key}`,
          WORK_STOPPED: `Stopped work on ${key}`,
        };
        push({
          at: a.createdAt.toISOString(), area: 'tasks', tone: 'purple',
          title: label[a.action] || `${pretty(a.action)} · ${key}`,
          detail: a.issue?.title, link: a.issue?.key ? `/tasks?search=${encodeURIComponent(a.issue.key)}` : undefined,
        });
      }
    })());

    // 5. Tickets
    if (want('tickets')) jobs.push((async () => {
      const [raised, acts] = await Promise.all([
        this.prisma.ticket.findMany({
          where: { reporterId: employeeId, companyId, createdAt: range }, orderBy: { createdAt: 'desc' }, take,
          select: { id: true, ticketNumber: true, title: true, createdAt: true },
        }),
        this.prisma.ticketActivity.findMany({
          where: { actorId: employeeId, createdAt: range }, orderBy: { createdAt: 'desc' }, take,
          select: { action: true, newValue: true, createdAt: true, ticket: { select: { id: true, ticketNumber: true, title: true } } },
        }),
      ]);
      for (const r of raised) push({ at: r.createdAt.toISOString(), area: 'tickets', tone: 'blue', title: `Raised ticket ${r.ticketNumber}`, detail: r.title, link: `/crm/tickets?ticket=${r.id}` });
      for (const a of acts) {
        if (a.action === 'CREATED') continue; // already listed as "Raised"
        push({
          at: a.createdAt.toISOString(), area: 'tickets', tone: 'blue',
          title: `${pretty(a.action)} · ${a.ticket?.ticketNumber || 'ticket'}${a.newValue && a.action.includes('STATUS') ? ` → ${pretty(a.newValue)}` : ''}`,
          detail: a.ticket?.title, link: a.ticket ? `/crm/tickets?ticket=${a.ticket.id}` : undefined,
        });
      }
    })());

    // 6. Field visits
    if (want('field-visits')) jobs.push((async () => {
      const acts = await this.prisma.fieldVisitRequestActivity.findMany({
        where: { actorId: employeeId, createdAt: range }, orderBy: { createdAt: 'desc' }, take,
        select: { action: true, detail: true, createdAt: true, request: { select: { id: true, requestNumber: true, location: true } } },
      });
      for (const a of acts) push({
        at: a.createdAt.toISOString(), area: 'field-visits', tone: 'amber',
        title: `${pretty(a.action)} · ${a.request?.requestNumber || 'field visit'}`,
        detail: a.detail || a.request?.location, link: a.request ? `/field-visits/requests/${a.request.id}` : undefined,
      });
    })());

    // 7. Timesheet
    if (want('timesheet')) jobs.push((async () => {
      const rows = await this.prisma.timesheetDay.findMany({
        where: { employeeId, updatedAt: range }, orderBy: { updatedAt: 'desc' }, take,
        select: { date: true, status: true, submittedHours: true, submittedAt: true, reviewedAt: true, rejectionReason: true },
      });
      for (const r of rows) {
        const hrs = `${Math.floor(r.submittedHours)}h ${String(Math.round((r.submittedHours % 1) * 60)).padStart(2, '0')}m`;
        if (r.submittedAt) push({ at: r.submittedAt.toISOString(), area: 'timesheet', tone: 'slate', title: `Submitted timesheet for ${day(r.date)}`, detail: hrs, link: '/timesheets' });
        if (r.reviewedAt && (r.status === 'APPROVED' || r.status === 'REJECTED')) push({
          at: r.reviewedAt.toISOString(), area: 'timesheet', tone: r.status === 'APPROVED' ? 'green' : 'red',
          title: `Timesheet for ${day(r.date)} ${r.status.toLowerCase()}`, detail: r.rejectionReason || hrs,
        });
      }
    })());

    // 8. Documents
    if (want('documents')) jobs.push((async () => {
      const rows = await this.prisma.employeeDocument.findMany({
        where: { employeeId, createdAt: range }, orderBy: { createdAt: 'desc' }, take,
        select: { fileName: true, documentType: true, createdAt: true },
      });
      for (const r of rows) push({ at: r.createdAt.toISOString(), area: 'documents', tone: 'slate', title: `Uploaded ${r.documentType || 'a document'}`, detail: r.fileName });
    })());

    // 9. Employment: joined (salary-free; promotions stay on the History tab)
    if (want('employment')) {
      const joined = target.joiningDate || target.createdAt;
      if (joined) push({ at: joined.toISOString(), area: 'employment', tone: 'green', title: 'Joined the company' });
    }

    // 10. Recognition
    if (want('recognition')) jobs.push((async () => {
      const rows = await this.prisma.appreciation.findMany({
        where: { employeeId, companyId, givenDate: range }, orderBy: { givenDate: 'desc' }, take,
        select: { givenDate: true, summary: true, awardType: { select: { title: true } } },
      });
      for (const r of rows) push({ at: r.givenDate.toISOString(), area: 'recognition', tone: 'purple', title: `Received ${r.awardType?.title || 'an award'}`, detail: r.summary, link: '/appreciation' });
    })());

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const name = (e?: { firstName?: string | null; lastName?: string | null } | null) => e ? `${e.firstName || ''} ${e.lastName || ''}`.trim() : 'someone';

    // 11. Assets: assigned / returned
    if (want('assets')) jobs.push((async () => {
      const rows = await this.prisma.assetAssignment.findMany({
        where: { employeeId, companyId, updatedAt: range }, orderBy: { updatedAt: 'desc' }, take,
        select: { assignedDate: true, returnDate: true, conditionOnReturn: true, asset: { select: { name: true, assetTag: true } } },
      });
      for (const r of rows) {
        const what = [r.asset?.name, r.asset?.assetTag].filter(Boolean).join(' · ');
        push({ at: r.assignedDate.toISOString(), area: 'assets', tone: 'blue', title: 'Asset assigned', detail: what, link: '/assets' });
        if (r.returnDate) push({ at: r.returnDate.toISOString(), area: 'assets', tone: 'slate', title: 'Asset returned', detail: [what, r.conditionOnReturn].filter(Boolean).join(' · ') });
      }
    })());

    // 12. Expense claims
    if (want('expenses')) jobs.push((async () => {
      const rows = await this.prisma.expenseClaim.findMany({
        where: { employeeId, companyId, updatedAt: range }, orderBy: { updatedAt: 'desc' }, take,
        select: { title: true, amount: true, category: true, status: true, rejectionReason: true, createdAt: true, updatedAt: true },
      });
      for (const r of rows) {
        const what = `${r.title} · ₹${Number(r.amount).toLocaleString('en-IN')}`;
        push({ at: r.createdAt.toISOString(), area: 'expenses', tone: 'blue', title: 'Submitted an expense claim', detail: what });
        if (['APPROVED', 'REJECTED', 'PAID'].includes(r.status) && r.updatedAt.getTime() - r.createdAt.getTime() > 1000) push({
          at: r.updatedAt.toISOString(), area: 'expenses',
          tone: r.status === 'REJECTED' ? 'red' : 'green',
          title: `Expense claim ${r.status.toLowerCase()}`,
          detail: r.status === 'REJECTED' && r.rejectionReason ? `${what} · ${r.rejectionReason}` : what,
        });
      }
    })());

    // 13. Payroll: payslip published / paid — never the amounts
    if (want('payroll')) jobs.push((async () => {
      const rows = await this.prisma.payslip.findMany({
        where: { employeeId, companyId, status: { not: 'DRAFT' }, updatedAt: range }, orderBy: { updatedAt: 'desc' }, take,
        select: { month: true, year: true, status: true, paidOn: true, updatedAt: true },
      });
      for (const r of rows) {
        const m = `${months[(r.month || 1) - 1]} ${r.year}`;
        push({
          at: (r.paidOn || r.updatedAt).toISOString(), area: 'payroll', tone: 'green',
          title: r.paidOn || r.status === 'PAID' ? `Salary paid for ${m}` : `Payslip published for ${m}`,
        });
      }
    })());

    // 14. Comp-off credits
    if (want('comp-off')) jobs.push((async () => {
      const rows = await this.prisma.compOffCredit.findMany({
        where: { employeeId, companyId, createdAt: range }, orderBy: { createdAt: 'desc' }, take,
        select: { days: true, date: true, reason: true, createdAt: true },
      });
      for (const r of rows) push({
        at: r.createdAt.toISOString(), area: 'comp-off', tone: 'green',
        title: `Comp-off credited · ${r.days} day${r.days === 1 ? '' : 's'}`,
        detail: [r.date ? `For ${day(r.date)}` : '', r.reason || ''].filter(Boolean).join(' · ') || undefined,
      });
    })());

    // 15. Notices read
    if (want('notices') && target.userId) jobs.push((async () => {
      const rows = await this.prisma.noticeRead.findMany({
        where: { userId: target.userId!, readAt: range }, orderBy: { readAt: 'desc' }, take,
        select: { readAt: true, notice: { select: { title: true, companyId: true } } },
      });
      for (const r of rows) if (r.notice?.companyId === companyId) push({ at: r.readAt.toISOString(), area: 'notices', tone: 'slate', title: 'Read a notice', detail: r.notice.title, link: '/notices' });
    })());

    // 16. Performance reviews: their own, and ones they review
    if (want('performance')) jobs.push((async () => {
      const rows = await this.prisma.performanceReview.findMany({
        where: { companyId, updatedAt: range, OR: [{ employeeId }, { reviewerId: employeeId }] }, orderBy: { updatedAt: 'desc' }, take,
        select: { employeeId: true, cycleName: true, status: true, createdAt: true, updatedAt: true, employee: { select: { firstName: true, lastName: true } } },
      });
      for (const r of rows) {
        const own = r.employeeId === employeeId;
        push({
          at: r.updatedAt.toISOString(), area: 'performance', tone: 'purple',
          title: own ? `Performance review · ${pretty(r.status)}` : `Reviewing ${name(r.employee)} · ${pretty(r.status)}`,
          detail: r.cycleName, link: '/performance',
        });
      }
    })());

    // 17. As an approver: decisions they made on other people's requests
    if (want('approvals')) jobs.push((async () => {
      const decided = { in: ['APPROVED', 'REJECTED'] };
      const [leaves, regs, sheets] = await Promise.all([
        target.userId ? this.prisma.leaveRequest.findMany({
          where: { approvedById: target.userId, deletedAt: null, status: decided, employeeId: { not: employeeId }, updatedAt: range },
          orderBy: { updatedAt: 'desc' }, take,
          select: { status: true, startDate: true, endDate: true, updatedAt: true, leaveType: { select: { name: true } }, employee: { select: { firstName: true, lastName: true } } },
        }) : Promise.resolve([] as any[]),
        target.userId ? this.prisma.attendanceRegularization.findMany({
          where: { approvedById: target.userId, status: decided, employeeId: { not: employeeId }, updatedAt: range },
          orderBy: { updatedAt: 'desc' }, take,
          select: { status: true, date: true, updatedAt: true, employee: { select: { firstName: true, lastName: true } } },
        }) : Promise.resolve([] as any[]),
        this.prisma.timesheetDay.findMany({
          where: { reviewedById: employeeId, status: decided, employeeId: { not: employeeId }, reviewedAt: range },
          orderBy: { reviewedAt: 'desc' }, take,
          select: { status: true, date: true, reviewedAt: true, employee: { select: { firstName: true, lastName: true } } },
        }),
      ]);
      const verb = (st: string) => (st === 'APPROVED' ? 'Approved' : 'Rejected');
      const tone = (st: string) => (st === 'APPROVED' ? 'green' : 'red') as ActivityItem['tone'];
      for (const r of leaves) push({ at: r.updatedAt.toISOString(), area: 'approvals', tone: tone(r.status), title: `${verb(r.status)} ${name(r.employee)}'s leave`, detail: `${r.leaveType?.name || 'Leave'} · ${range2(r.startDate, r.endDate)}` });
      for (const r of regs) push({ at: r.updatedAt.toISOString(), area: 'approvals', tone: tone(r.status), title: `${verb(r.status)} ${name(r.employee)}'s regularization`, detail: `For ${day(r.date)}` });
      for (const r of sheets) if (r.reviewedAt) push({ at: r.reviewedAt.toISOString(), area: 'approvals', tone: tone(r.status), title: `${verb(r.status)} ${name(r.employee)}'s timesheet`, detail: `For ${day(r.date)}` });
    })());

    await Promise.all(jobs);
    items.sort((a, b) => b.at.localeCompare(a.at));
    const page = items.slice(0, limit);
    return { items: page, nextBefore: page.length >= limit ? page[page.length - 1].at : null };
  }
}

/** "STATUS_CHANGED" / "in_progress" → "Status changed" / "In progress". */
function pretty(v?: string | null): string {
  if (!v) return '';
  const s = String(v).replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
