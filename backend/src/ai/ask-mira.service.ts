import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import { AskMiraMoreTools, MORE_TOOLS } from './ask-mira-more-tools';
import * as path from 'path';

/**
 * Ask MIRA (17 Nov 2026) — Super Admin only AI assistant.
 *
 * The model never sees the database directly and never writes SQL. It can only
 * call the read-only tools below. Each tool returns a short text summary for the
 * model plus a "block" (table / KPIs / chart) that is sent straight to the UI,
 * so numbers and names on screen always come from the database, not the model.
 */

export const ASK_MIRA_ROLES = ['SUPERADMIN', 'SUPER_ADMIN'];

type Block =
  | { type: 'kpis'; title?: string; items: { label: string; value: string | number; tone?: string }[] }
  | { type: 'table'; title: string; columns: string[]; rows: (string | number | null)[][]; employeeIds?: (number | null)[] }
  | { type: 'chart'; title: string; kind: 'bar' | 'line'; labels: string[]; values: number[] };

interface ToolResult { summary: string; blocks: Block[]; source: string }

const IST_OFFSET = 330 * 60000;

@Injectable()
export class AskMiraService {
  private more: AskMiraMoreTools;
  constructor(private prisma: PrismaService) { this.more = new AskMiraMoreTools(prisma); }

  private get apiKey(): string {
    if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY;
    try {
      const content = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
      return content.match(/GROQ_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/)?.[1]?.trim() || '';
    } catch { return ''; }
  }

  assertAllowed(user: any) {
    if (!ASK_MIRA_ROLES.includes(user?.role)) throw new ForbiddenException('Ask MIRA is available to Super Admin only.');
  }

  // ---------- date helpers (attendance dates = midnight UTC of the IST day) ----------
  private todayYmd() { return new Date(Date.now() + IST_OFFSET).toISOString().slice(0, 10); }
  private day(ymd: string) { return new Date(`${ymd}T00:00:00.000Z`); }
  private validYmd(v: any, fallback: string) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback; }
  private fmtTime(d?: Date | null) {
    if (!d) return null;
    return new Date(d.getTime() + IST_OFFSET).toISOString().slice(11, 16);
  }
  private name(e: any) { return `${e?.firstName ?? ''} ${e?.lastName ?? ''}`.trim(); }

  private activeEmployeeWhere(companyId: number, department?: string) {
    return {
      companyId,
      offboardingStatus: { not: 'SEPARATED' },
      user: { status: 'ACTIVE' },
      ...(department ? { department: { name: { contains: department, mode: 'insensitive' as const } } } : {}),
    };
  }

  // ---------- tools ----------
  readonly coreTools = [
    {
      type: 'function',
      function: {
        name: 'day_attendance',
        description: 'Attendance snapshot for ONE day: who is present, late, half day, absent, on approved leave, or has not clocked in. Use for "today", "yesterday" or a specific date.',
        parameters: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'YYYY-MM-DD (IST). Defaults to today.' },
            department: { type: 'string', description: 'Optional department name filter' },
            show: { type: 'string', enum: ['all', 'late', 'absent', 'on_leave', 'not_clocked_in', 'half_day', 'present'], description: 'Which people to list in the table' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'attendance_range',
        description: 'Attendance over a date range: per-person counts of present, late, half day and absent days, plus a daily trend. Use for "this week", "this month", "most late", trends.',
        parameters: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'YYYY-MM-DD' },
            to: { type: 'string', description: 'YYYY-MM-DD' },
            department: { type: 'string' },
            employee: { type: 'string', description: 'Optional person name to focus on' },
            sort_by: { type: 'string', enum: ['late', 'absent', 'half_day', 'present'], description: 'Rank people by this count' },
          },
          required: ['from', 'to'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'leave_requests',
        description: 'Leave requests overlapping a date range, with status and type. Use for who is on leave, pending leave approvals, leave usage.',
        parameters: {
          type: 'object',
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
            status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'ANY'] },
            department: { type: 'string' },
            employee: { type: 'string' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'tasks',
        description: 'Project tasks (board issues). Filter by status, overdue, assignee, project. Also returns counts per assignee.',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'OPEN', 'ANY'], description: 'OPEN = anything not done or cancelled' },
            overdue_only: { type: 'boolean' },
            assignee: { type: 'string' },
            project: { type: 'string' },
            completed_from: { type: 'string', description: 'For DONE tasks: completed/updated on or after YYYY-MM-DD' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'employees',
        description: 'Active employee directory: headcount by department, new joiners, find a person.',
        parameters: {
          type: 'object',
          properties: {
            search: { type: 'string' },
            department: { type: 'string' },
            joined_from: { type: 'string', description: 'YYYY-MM-DD, list people who joined on/after this date' },
          },
        },
      },
    },
  ];

  readonly tools: any[] = [...this.coreTools, ...MORE_TOOLS];

  private async runTool(companyId: number, name: string, args: any): Promise<ToolResult> {
    if (this.more.has(name)) return this.more.run(companyId, name, args);
    switch (name) {
      case 'day_attendance': return this.dayAttendance(companyId, args);
      case 'attendance_range': return this.attendanceRange(companyId, args);
      case 'leave_requests': return this.leaveRequests(companyId, args);
      case 'tasks': return this.tasksTool(companyId, args);
      case 'employees': return this.employeesTool(companyId, args);
      default: return { summary: `Unknown tool ${name}`, blocks: [], source: '' };
    }
  }

  private async dayAttendance(companyId: number, args: any): Promise<ToolResult> {
    const ymd = this.validYmd(args?.date, this.todayYmd());
    const d = this.day(ymd);
    const emps = await this.prisma.employee.findMany({
      where: this.activeEmployeeWhere(companyId, args?.department),
      select: { id: true, firstName: true, lastName: true, department: { select: { name: true } } },
    });
    const ids = emps.map((e) => e.id);
    const [att, leaves] = await Promise.all([
      this.prisma.attendance.findMany({ where: { employeeId: { in: ids }, date: d } }),
      this.prisma.leaveRequest.findMany({
        where: { employeeId: { in: ids }, status: 'APPROVED', startDate: { lte: new Date(d.getTime() + 86399999) }, endDate: { gte: d } },
        include: { leaveType: { select: { name: true } } },
      }),
    ]);
    const attBy = new Map(att.map((a) => [a.employeeId, a]));
    const leaveBy = new Map(leaves.map((l) => [l.employeeId, l]));

    const rows: { e: any; state: string; inT: string | null; outT: string | null; note: string }[] = [];
    for (const e of emps) {
      const a = attBy.get(e.id);
      const l = leaveBy.get(e.id);
      let state = 'Not clocked in';
      if (l && (!a || !a.clockIn)) state = 'On leave';
      else if (a?.status === 'HALF_DAY') state = 'Half day';
      else if (a?.status === 'ABSENT') state = 'Absent';
      else if (a?.clockIn) state = a.isLate ? 'Late' : 'Present';
      rows.push({ e, state, inT: this.fmtTime(a?.clockIn), outT: this.fmtTime(a?.clockOut), note: l ? `${l.leaveType?.name ?? 'Leave'}${l.isHalfDay ? ' (half)' : ''}` : '' });
    }
    const count = (s: string) => rows.filter((r) => r.state === s).length;
    const present = count('Present') + count('Late');
    const filterMap: Record<string, string[]> = {
      late: ['Late'], absent: ['Absent'], on_leave: ['On leave'], not_clocked_in: ['Not clocked in'], half_day: ['Half day'], present: ['Present', 'Late'],
    };
    const show = filterMap[args?.show] ?? null;
    const list = rows.filter((r) => !show || show.includes(r.state)).sort((a, b) => a.state.localeCompare(b.state) || this.name(a.e).localeCompare(this.name(b.e)));

    const blocks: Block[] = [
      {
        type: 'kpis', title: `Attendance on ${ymd}`, items: [
          { label: 'Active staff', value: emps.length },
          { label: 'Present', value: present, tone: 'green' },
          { label: 'Late', value: count('Late'), tone: 'amber' },
          { label: 'Half day', value: count('Half day'), tone: 'amber' },
          { label: 'On leave', value: count('On leave'), tone: 'blue' },
          { label: 'Absent', value: count('Absent'), tone: 'red' },
          { label: 'Not clocked in', value: count('Not clocked in'), tone: 'slate' },
        ],
      },
    ];
    if (list.length) {
      blocks.push({
        type: 'table', title: show ? `${args.show.replace(/_/g, ' ')} — ${ymd}` : `Everyone — ${ymd}`,
        columns: ['Employee', 'Department', 'Status', 'In', 'Out', 'Leave'],
        rows: list.slice(0, 300).map((r) => [this.name(r.e), r.e.department?.name ?? '—', r.state, r.inT ?? '—', r.outT ?? '—', r.note || '—']),
        employeeIds: list.slice(0, 300).map((r) => r.e.id),
      });
    }
    const sampleNames = list.slice(0, 25).map((r) => `${this.name(r.e)} (${r.state}${r.inT ? ' ' + r.inT : ''})`).join(', ');
    return {
      summary: `Date ${ymd}${args?.department ? `, department ~${args.department}` : ''}: active ${emps.length}, present ${present} (late ${count('Late')}), half day ${count('Half day')}, on leave ${count('On leave')}, absent ${count('Absent')}, not clocked in ${count('Not clocked in')}. Listed (${list.length}): ${sampleNames}${list.length > 25 ? ', …' : ''}`,
      blocks,
      source: `Attendance and approved leave for ${ymd}, ${emps.length} active employees`,
    };
  }

  private async attendanceRange(companyId: number, args: any): Promise<ToolResult> {
    const today = this.todayYmd();
    const to = this.validYmd(args?.to, today);
    let from = this.validYmd(args?.from, to);
    if (from > to) from = to;
    const span = (this.day(to).getTime() - this.day(from).getTime()) / 86400000;
    if (span > 366) from = new Date(this.day(to).getTime() - 366 * 86400000).toISOString().slice(0, 10);

    const empWhere: any = this.activeEmployeeWhere(companyId, args?.department);
    if (args?.employee) {
      empWhere.OR = args.employee.split(/\s+/).filter(Boolean).map((w: string) => ({
        OR: [{ firstName: { contains: w, mode: 'insensitive' } }, { lastName: { contains: w, mode: 'insensitive' } }],
      }));
    }
    const emps = await this.prisma.employee.findMany({
      where: empWhere, select: { id: true, firstName: true, lastName: true, department: { select: { name: true } } },
    });
    const att = await this.prisma.attendance.findMany({
      where: { employeeId: { in: emps.map((e) => e.id) }, date: { gte: this.day(from), lte: this.day(to) } },
      select: { employeeId: true, date: true, status: true, isLate: true, clockIn: true },
    });

    const per = new Map<number, { present: number; late: number; half: number; absent: number }>();
    const daily = new Map<string, number>();
    for (const a of att) {
      const p = per.get(a.employeeId) ?? { present: 0, late: 0, half: 0, absent: 0 };
      if (a.status === 'ABSENT') p.absent++;
      else if (a.status === 'HALF_DAY') p.half++;
      else if (a.clockIn || a.status === 'PRESENT') p.present++;
      if (a.isLate && a.status !== 'ABSENT') {
        p.late++;
        const k = a.date.toISOString().slice(0, 10);
        daily.set(k, (daily.get(k) ?? 0) + 1);
      }
      per.set(a.employeeId, p);
    }
    const key = ({ late: 'late', absent: 'absent', half_day: 'half', present: 'present' } as const)[args?.sort_by as 'late'] ?? 'late';
    const ranked = emps
      .map((e) => ({ e, c: per.get(e.id) ?? { present: 0, late: 0, half: 0, absent: 0 } }))
      .sort((a, b) => b.c[key] - a.c[key] || this.name(a.e).localeCompare(this.name(b.e)));
    const tot = ranked.reduce((s, r) => ({ present: s.present + r.c.present, late: s.late + r.c.late, half: s.half + r.c.half, absent: s.absent + r.c.absent }), { present: 0, late: 0, half: 0, absent: 0 });

    const labels: string[] = [];
    for (let t = this.day(from).getTime(); t <= this.day(to).getTime(); t += 86400000) labels.push(new Date(t).toISOString().slice(0, 10));

    const blocks: Block[] = [
      { type: 'kpis', title: `${from} → ${to}`, items: [
        { label: 'People', value: emps.length },
        { label: 'Present days', value: tot.present, tone: 'green' },
        { label: 'Late marks', value: tot.late, tone: 'amber' },
        { label: 'Half days', value: tot.half, tone: 'amber' },
        { label: 'Absent days', value: tot.absent, tone: 'red' },
      ] },
    ];
    if (labels.length > 1 && labels.length <= 93) {
      blocks.push({ type: 'chart', kind: labels.length > 20 ? 'line' : 'bar', title: 'Late marks per day', labels: labels.map((l) => l.slice(5)), values: labels.map((l) => daily.get(l) ?? 0) });
    }
    const shown = ranked.filter((r) => r.c.present + r.c.late + r.c.half + r.c.absent > 0).slice(0, 200);
    if (shown.length) {
      blocks.push({
        type: 'table', title: `Per person (sorted by ${key})`,
        columns: ['Employee', 'Department', 'Present', 'Late', 'Half day', 'Absent'],
        rows: shown.map((r) => [this.name(r.e), r.e.department?.name ?? '—', r.c.present, r.c.late, r.c.half, r.c.absent]),
        employeeIds: shown.map((r) => r.e.id),
      });
    }
    return {
      summary: `Range ${from} to ${to}: ${emps.length} people. Totals present ${tot.present}, late ${tot.late}, half day ${tot.half}, absent ${tot.absent}. Top by ${key}: ${shown.slice(0, 10).map((r) => `${this.name(r.e)} P${r.c.present}/L${r.c.late}/H${r.c.half}/A${r.c.absent}`).join('; ')}`,
      blocks,
      source: `Attendance records ${from} to ${to}, ${emps.length} active employees`,
    };
  }

  private async leaveRequests(companyId: number, args: any): Promise<ToolResult> {
    const today = this.todayYmd();
    const from = this.validYmd(args?.from, today);
    const to = this.validYmd(args?.to, from);
    const status = args?.status && args.status !== 'ANY' ? args.status : undefined;
    const empWhere: any = { companyId, ...(args?.department ? { department: { name: { contains: args.department, mode: 'insensitive' } } } : {}) };
    if (args?.employee) {
      empWhere.AND = args.employee.split(/\s+/).filter(Boolean).map((w: string) => ({
        OR: [{ firstName: { contains: w, mode: 'insensitive' } }, { lastName: { contains: w, mode: 'insensitive' } }],
      }));
    }
    const list = await this.prisma.leaveRequest.findMany({
      where: {
        ...(status ? { status } : {}),
        employee: empWhere,
        // pending requests are listed regardless of dates when no range was asked
        ...(status === 'PENDING' && !args?.from ? {} : { startDate: { lte: new Date(this.day(to).getTime() + 86399999) }, endDate: { gte: this.day(from) } }),
      },
      include: { leaveType: { select: { name: true } }, employee: { select: { id: true, firstName: true, lastName: true, department: { select: { name: true } } } } },
      orderBy: { startDate: 'asc' },
      take: 300,
    });
    const days = (l: any) => l.isHalfDay ? 0.5 : Math.round((l.endDate.getTime() - l.startDate.getTime()) / 86400000) + 1;
    const byStatus = (s: string) => list.filter((l) => l.status === s).length;
    const blocks: Block[] = [
      { type: 'kpis', title: `Leave ${from === to ? from : `${from} → ${to}`}`, items: [
        { label: 'Requests', value: list.length },
        { label: 'Approved', value: byStatus('APPROVED'), tone: 'green' },
        { label: 'Pending', value: byStatus('PENDING'), tone: 'amber' },
        { label: 'Rejected', value: byStatus('REJECTED'), tone: 'red' },
      ] },
    ];
    if (list.length) blocks.push({
      type: 'table', title: 'Leave requests',
      columns: ['Employee', 'Department', 'Type', 'From', 'To', 'Days', 'Status'],
      rows: list.map((l) => [this.name(l.employee), l.employee.department?.name ?? '—', l.leaveType?.name ?? '—', l.startDate.toISOString().slice(0, 10), l.endDate.toISOString().slice(0, 10), days(l), l.status]),
      employeeIds: list.map((l) => l.employee.id),
    });
    return {
      summary: `${list.length} leave requests (${status ?? 'any status'}) for ${from}..${to}: ${list.slice(0, 25).map((l) => `${this.name(l.employee)} ${l.leaveType?.name} ${l.startDate.toISOString().slice(0, 10)}→${l.endDate.toISOString().slice(0, 10)} ${l.status}`).join('; ')}`,
      blocks,
      source: `Leave requests overlapping ${from} to ${to}`,
    };
  }

  private async tasksTool(companyId: number, args: any): Promise<ToolResult> {
    const where: any = { isArchived: false, project: { companyId } };
    const st = args?.status ?? 'OPEN';
    if (st === 'OPEN') where.status = { notIn: ['DONE', 'CANCELLED'] };
    else if (st !== 'ANY') where.status = st;
    if (args?.overdue_only) { where.dueDate = { lt: this.day(this.todayYmd()) }; where.status = { notIn: ['DONE', 'CANCELLED'] }; }
    if (args?.project) where.project = { companyId, name: { contains: args.project, mode: 'insensitive' } };
    if (args?.assignee) {
      where.assignee = { AND: args.assignee.split(/\s+/).filter(Boolean).map((w: string) => ({
        OR: [{ firstName: { contains: w, mode: 'insensitive' } }, { lastName: { contains: w, mode: 'insensitive' } }],
      })) };
    }
    if (st === 'DONE' && args?.completed_from) where.completedAt = { gte: this.day(this.validYmd(args.completed_from, this.todayYmd())) };

    const list = await this.prisma.issue.findMany({
      where,
      select: { id: true, title: true, status: true, priority: true, dueDate: true, assignee: { select: { id: true, firstName: true, lastName: true } }, project: { select: { name: true } } },
      orderBy: [{ dueDate: 'asc' }],
      take: 300,
    });
    const today = this.day(this.todayYmd());
    const total = list.length >= 300 ? await this.prisma.issue.count({ where }) : list.length;
    const overdue = args?.overdue_only ? total : list.filter((t) => t.dueDate && t.dueDate < today && !['DONE', 'CANCELLED'].includes(t.status)).length;
    const perAssignee = new Map<string, number>();
    for (const t of list) { const n = t.assignee ? this.name(t.assignee) : 'Unassigned'; perAssignee.set(n, (perAssignee.get(n) ?? 0) + 1); }
    const top = [...perAssignee.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);

    const blocks: Block[] = [
      { type: 'kpis', title: 'Tasks', items: [
        { label: 'Tasks', value: total },
        { label: 'Overdue', value: overdue, tone: 'red' },
        { label: 'In progress', value: list.filter((t) => t.status === 'IN_PROGRESS').length, tone: 'blue' },
        { label: 'In review', value: list.filter((t) => t.status === 'IN_REVIEW').length, tone: 'amber' },
      ] },
    ];
    if (top.length > 1) blocks.push({ type: 'chart', kind: 'bar', title: 'Tasks per person', labels: top.map((t) => t[0]), values: top.map((t) => t[1]) });
    if (list.length) blocks.push({
      type: 'table', title: total > list.length ? `Tasks (first ${list.length} of ${total})` : 'Tasks',
      columns: ['Task', 'Project', 'Assignee', 'Status', 'Priority', 'Due'],
      rows: list.map((t) => [t.title, t.project?.name ?? '—', t.assignee ? this.name(t.assignee) : 'Unassigned', t.status, t.priority, t.dueDate ? t.dueDate.toISOString().slice(0, 10) : '—']),
      employeeIds: list.map((t) => t.assignee?.id ?? null),
    });
    return {
      summary: `${total} tasks in total${total > list.length ? ` (details below cover the first ${list.length})` : ''} (status ${st}${args?.overdue_only ? ', overdue only' : ''}), ${overdue} overdue. Per assignee: ${top.map((t) => `${t[0]} ${t[1]}`).join(', ')}. First items: ${list.slice(0, 15).map((t) => `"${t.title}" ${t.status} due ${t.dueDate?.toISOString().slice(0, 10) ?? '-'}`).join('; ')}`,
      blocks,
      source: `Project board tasks${list.length >= 300 ? ' (first 300)' : ''}`,
    };
  }

  private async employeesTool(companyId: number, args: any): Promise<ToolResult> {
    const where: any = this.activeEmployeeWhere(companyId, args?.department);
    if (args?.search) {
      where.AND = args.search.split(/\s+/).filter(Boolean).map((w: string) => ({
        OR: [{ firstName: { contains: w, mode: 'insensitive' } }, { lastName: { contains: w, mode: 'insensitive' } }, { user: { email: { contains: w, mode: 'insensitive' } } }],
      }));
    }
    if (args?.joined_from) where.joiningDate = { gte: this.day(this.validYmd(args.joined_from, this.todayYmd())) };
    const list = await this.prisma.employee.findMany({
      where,
      select: { id: true, firstName: true, lastName: true, joiningDate: true, department: { select: { name: true } }, designation: { select: { name: true } }, manager: { select: { firstName: true, lastName: true } } },
      orderBy: { joiningDate: 'desc' },
      take: 300,
    });
    const byDept = new Map<string, number>();
    for (const e of list) { const d = e.department?.name ?? 'No department'; byDept.set(d, (byDept.get(d) ?? 0) + 1); }
    const depts = [...byDept.entries()].sort((a, b) => b[1] - a[1]);
    const blocks: Block[] = [{ type: 'kpis', title: 'People', items: [{ label: 'Employees', value: list.length }, { label: 'Departments', value: depts.length }] }];
    if (depts.length > 1) blocks.push({ type: 'chart', kind: 'bar', title: 'Headcount by department', labels: depts.slice(0, 15).map((d) => d[0]), values: depts.slice(0, 15).map((d) => d[1]) });
    if (list.length) blocks.push({
      type: 'table', title: 'Employees',
      columns: ['Employee', 'Department', 'Designation', 'Manager', 'Joined'],
      rows: list.map((e) => [this.name(e), e.department?.name ?? '—', (e as any).designation?.name ?? '—', e.manager ? this.name(e.manager) : '—', e.joiningDate ? e.joiningDate.toISOString().slice(0, 10) : '—']),
      employeeIds: list.map((e) => e.id),
    });
    return {
      summary: `${list.length} active employees matched. By department: ${depts.map((d) => `${d[0]} ${d[1]}`).join(', ')}. ${list.slice(0, 20).map((e) => `${this.name(e)} (${e.department?.name ?? '-'}, joined ${e.joiningDate?.toISOString().slice(0, 10) ?? '-'})`).join('; ')}`,
      blocks,
      source: `Employee directory (active only)`,
    };
  }

  // ---------- chat loop ----------
  async ask(user: any, messages: { role: 'user' | 'assistant'; content: string }[]) {
    this.assertAllowed(user);
    const key = this.apiKey;
    if (!key) return { answer: 'AI is not configured on this server (missing GROQ_API_KEY).', blocks: [], sources: [] };

    const today = this.todayYmd();
    const weekday = new Date(`${today}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long' });
    const system = `You are "Ask MIRA", the analytics assistant inside MIRA ERP, talking to the company's Super Admin.
Today is ${weekday} ${today} (IST). Weeks start Monday.
Rules:
- ALWAYS call a tool to get data. Never invent names or numbers. If no tool fits, say what you can answer (attendance, leave, tasks, employees, timesheets, tickets, field visits, payroll totals, assets, probation, period comparisons).
- For "why", "compared to", "better/worse", "trend" questions use compare_periods (pick comparable periods, e.g. 1-17 Nov vs 1-17 Oct) and explain the change: which department and which people drove it. You may also call other tools to explain causes (e.g. leave or field visits behind absences).
- Payroll: totals only; never claim individual salaries.
- The UI already shows the tool's tables, KPI cards and charts below your reply. So do NOT repeat full tables; write a short, sharp answer (2-6 lines) with the key numbers and 1-2 insights worth a manager's attention.
- Use **bold** for key numbers. Plain markdown, bullet points allowed. No headings.
- Reply in English by default. Only if the user writes in Hindi or Hinglish, reply in Hinglish (Roman script).
- Call each tool once with the right arguments; do not repeat the same call.
- When you mention dates write them like "17 Nov"; never guess a year.
- Resolve relative dates yourself ("this week" = Monday of this week to today, "last month" = full previous month).`;

    const convo: any[] = [{ role: 'system', content: system }, ...messages.slice(-12).map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }))];
    const blocks: Block[] = [];
    const sources: string[] = [];

    for (let step = 0; step < 5; step++) {
      const res = await this.callGroq(key, convo);
      if (!res.ok) {
        const txt = await res.text();
        console.error('Ask MIRA Groq error', res.status, txt.slice(0, 300));
        const answer = blocks.length
          ? 'Here is the data. (The AI summary is busy right now — ask again in a minute for insights.)'
          : res.status === 429 ? 'MIRA AI is busy right now. Please try again in a minute.' : 'Could not reach the AI service. Please try again.';
        return { answer, ...(await this.withAvatars(this.unique(blocks, sources))) };
      }
      const data = await res.json();
      const msg = data.choices?.[0]?.message;
      const calls = msg?.tool_calls ?? [];
      if (!calls.length) return { answer: msg?.content?.trim() || 'No answer.', ...(await this.withAvatars(this.unique(blocks, sources))) };

      convo.push({ role: 'assistant', content: msg.content ?? '', tool_calls: calls });
      for (const c of calls) {
        let args: any = {};
        try { args = JSON.parse(c.function?.arguments || '{}'); } catch { /* ignore */ }
        let out: ToolResult;
        try { out = await this.runTool(user.companyId, c.function?.name, args); }
        catch (e: any) { console.error('Ask MIRA tool error', c.function?.name, e?.message); out = { summary: `Tool failed: ${e?.message ?? 'error'}`, blocks: [], source: '' }; }
        blocks.push(...out.blocks);
        if (out.source) sources.push(out.source);
        convo.push({ role: 'tool', tool_call_id: c.id, content: out.summary.slice(0, 2500) });
      }
    }
    return { answer: 'I gathered the data below.', ...(await this.withAvatars(this.unique(blocks, sources))) };
  }

  /**
   * Groq free tier allows ~8k tokens a minute. On a 429, wait if it is short,
   * otherwise fall back to the smaller model (separate limit).
   */
  private async callGroq(key: string, convo: any[]) {
    const call = (model: string) => fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: convo, tools: this.tools, tool_choice: 'auto', temperature: 0.2, max_tokens: 900 }),
    });
    let res = await call('openai/gpt-oss-120b');
    if (res.status !== 429) return res;
    const wait = Number(res.headers.get('retry-after')) || Number((await res.clone().text()).match(/try again in ([\d.]+)s/)?.[1]) || 99;
    if (wait <= 12) {
      await new Promise((r) => setTimeout(r, Math.ceil(wait * 1000) + 300));
      res = await call('openai/gpt-oss-120b');
      if (res.status !== 429) return res;
    }
    return call('openai/gpt-oss-20b');
  }

  /** Adds profile photos (id → avatarUrl) to every table that lists people. */
  private async withAvatars(r: { blocks: Block[]; sources: string[] }) {
    const ids = new Set<number>();
    for (const b of r.blocks) if (b.type === 'table') for (const id of b.employeeIds ?? []) if (id) ids.add(id);
    if (!ids.size) return r;
    const emps = await this.prisma.employee.findMany({ where: { id: { in: [...ids] }, avatarUrl: { not: null } }, select: { id: true, avatarUrl: true } });
    const map = new Map(emps.map((e) => [e.id, e.avatarUrl as string]));
    for (const b of r.blocks) if (b.type === 'table' && b.employeeIds) {
      const av: Record<number, string> = {};
      for (const id of b.employeeIds) if (id && map.has(id)) av[id] = map.get(id)!;
      (b as any).avatars = av;
    }
    return r;
  }

  /** The model sometimes calls the same tool twice; show each card once. */
  private unique(blocks: Block[], sources: string[]) {
    const seen = new Set<string>();
    return {
      blocks: blocks.filter((b) => { const k = JSON.stringify(b); if (seen.has(k)) return false; seen.add(k); return true; }),
      sources: [...new Set(sources)],
    };
  }

  /** Morning briefing — computed directly, no AI call, so it is instant. */
  async briefing(user: any) {
    this.assertAllowed(user);
    const companyId = user.companyId;
    const today = this.todayYmd();
    const day = await this.dayAttendance(companyId, { date: today });
    const kpis = (day.blocks[0] as any).items as { label: string; value: number }[];
    const v = (l: string) => Number(kpis.find((k) => k.label === l)?.value ?? 0);
    const [pendingLeaves, overdueTasks] = await Promise.all([
      this.prisma.leaveRequest.count({ where: { status: 'PENDING', employee: { companyId } } }),
      this.prisma.issue.count({ where: { isArchived: false, project: { companyId }, status: { notIn: ['DONE', 'CANCELLED'] }, dueDate: { lt: this.day(today) } } }),
    ]);
    return {
      date: today,
      items: [
        { label: 'Present', value: v('Present'), tone: 'green', ask: 'Who is present today?' },
        { label: 'Late', value: v('Late'), tone: 'amber', ask: 'Who came late today?' },
        { label: 'On leave', value: v('On leave'), tone: 'blue', ask: 'Who is on leave today?' },
        { label: 'Not clocked in', value: v('Not clocked in'), tone: 'slate', ask: 'Who has not clocked in today?' },
        { label: 'Pending leave', value: pendingLeaves, tone: 'amber', ask: 'Show all pending leave requests' },
        { label: 'Overdue tasks', value: overdueTasks, tone: 'red', ask: 'Show overdue tasks by person' },
      ],
    };
  }
}
