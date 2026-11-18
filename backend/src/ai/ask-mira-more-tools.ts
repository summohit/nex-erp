import { PrismaService } from '../prisma/prisma.service';

/**
 * Ask MIRA — extra read-only data tools (17 Nov 2026):
 * timesheets, tickets, field visits, payroll totals, assets, probation, and a
 * period-vs-period comparison for "why" questions.
 * Same contract as the core tools: a short summary for the model + UI blocks.
 */

type Block = any;
export interface MoreToolResult { summary: string; blocks: Block[]; source: string }

const IST_OFFSET = 330 * 60000;
const DAY = 86400000;

export const MORE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'timesheets',
      description: 'Timesheet submissions over a date range: hours submitted per person, approved/pending/rejected, and people who were present but did not submit.',
      parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, department: { type: 'string' }, show: { type: 'string', enum: ['hours', 'missing', 'pending'] } }, required: ['from', 'to'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tickets',
      description: 'Support/IT tickets: counts by status, average resolution time, oldest open tickets, per assignee and per department. Range filters on created date.',
      parameters: { type: 'object', properties: { status: { type: 'string', enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REJECTED', 'UNRESOLVED', 'ANY'] }, from: { type: 'string' }, to: { type: 'string' }, department: { type: 'string' }, assignee: { type: 'string' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'field_visits',
      description: 'Field visits: who is on field on a date or range (with clock-in and project), and field visit requests waiting for approval.',
      parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, pending_requests: { type: 'boolean', description: 'List requests waiting for approval instead' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'payroll_summary',
      description: 'Payroll totals for a month: number of payslips, total earnings, deductions, loss of pay and net pay, split by department, plus payslip status. Totals only.',
      parameters: { type: 'object', properties: { month: { type: 'integer', description: '1-12' }, year: { type: 'integer' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'assets',
      description: 'Company assets (laptops etc.): counts by status and category, who holds what, warranties expiring soon.',
      parameters: { type: 'object', properties: { holder: { type: 'string', description: 'Person name' }, category: { type: 'string' }, warranty_days: { type: 'integer', description: 'List warranties expiring within N days' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'probation',
      description: 'Employees on probation: end dates, overdue confirmations, ending within N days, and manager review status.',
      parameters: { type: 'object', properties: { ending_within_days: { type: 'integer' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compare_periods',
      description: 'Compare a metric between two periods, overall and by department, with the people who changed most. Use for "why", "vs last month", "trend", "which team got worse".',
      parameters: {
        type: 'object',
        properties: {
          metric: { type: 'string', enum: ['late', 'absent', 'half_day', 'leave_days', 'tasks_completed', 'tickets_raised', 'tickets_resolved', 'timesheet_hours'] },
          a_from: { type: 'string', description: 'Current period start YYYY-MM-DD' },
          a_to: { type: 'string' },
          b_from: { type: 'string', description: 'Previous period start' },
          b_to: { type: 'string' },
        },
        required: ['metric', 'a_from', 'a_to', 'b_from', 'b_to'],
      },
    },
  },
];

export class AskMiraMoreTools {
  constructor(private prisma: PrismaService) {}

  has(name: string) { return MORE_TOOLS.some((t) => t.function.name === name); }

  run(companyId: number, name: string, args: any): Promise<MoreToolResult> {
    switch (name) {
      case 'timesheets': return this.timesheets(companyId, args);
      case 'tickets': return this.tickets(companyId, args);
      case 'field_visits': return this.fieldVisits(companyId, args);
      case 'payroll_summary': return this.payroll(companyId, args);
      case 'assets': return this.assets(companyId, args);
      case 'probation': return this.probation(companyId, args);
      case 'compare_periods': return this.compare(companyId, args);
    }
    return Promise.resolve({ summary: 'Unknown tool', blocks: [], source: '' });
  }

  // ---------- helpers ----------
  private today() { return new Date(Date.now() + IST_OFFSET).toISOString().slice(0, 10); }
  private d(ymd: string) { return new Date(`${ymd}T00:00:00.000Z`); }
  private end(ymd: string) { return new Date(this.d(ymd).getTime() + DAY - 1); }
  private ymd(v: any, fb: string) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fb; }
  private iso(d?: Date | null) { return d ? d.toISOString().slice(0, 10) : '—'; }
  private time(d?: Date | null) { return d ? new Date(d.getTime() + IST_OFFSET).toISOString().slice(11, 16) : '—'; }
  private nm(e: any) { return e ? `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim() : '—'; }
  private nameWhere(q?: string) {
    if (!q) return undefined;
    return { AND: q.split(/\s+/).filter(Boolean).map((w) => ({ OR: [{ firstName: { contains: w, mode: 'insensitive' as const } }, { lastName: { contains: w, mode: 'insensitive' as const } }] })) };
  }
  private range(args: any, defDays = 0) {
    const to = this.ymd(args?.to, this.today());
    let from = this.ymd(args?.from, new Date(this.d(to).getTime() - defDays * DAY).toISOString().slice(0, 10));
    if (from > to) from = to;
    return { from, to };
  }
  private active(companyId: number, department?: string) {
    return {
      companyId, offboardingStatus: { not: 'SEPARATED' }, user: { status: 'ACTIVE' },
      ...(department ? { department: { name: { contains: department, mode: 'insensitive' as const } } } : {}),
    };
  }
  private money(n: number) { return '₹' + Math.round(n).toLocaleString('en-IN'); }

  // ---------- timesheets ----------
  private async timesheets(companyId: number, args: any): Promise<MoreToolResult> {
    const { from, to } = this.range(args, 6);
    const emps = await this.prisma.employee.findMany({ where: this.active(companyId, args?.department), select: { id: true, firstName: true, lastName: true, department: { select: { name: true } } } });
    const ids = emps.map((e) => e.id);
    const [days, att] = await Promise.all([
      this.prisma.timesheetDay.findMany({ where: { employeeId: { in: ids }, date: { gte: this.d(from), lte: this.d(to) } }, select: { employeeId: true, date: true, status: true, submittedHours: true } }),
      this.prisma.attendance.findMany({ where: { employeeId: { in: ids }, date: { gte: this.d(from), lte: this.d(to) }, clockIn: { not: null } }, select: { employeeId: true, date: true } }),
    ]);
    const sub = new Set(days.map((x) => `${x.employeeId}|${this.iso(x.date)}`));
    const per = new Map<number, { hours: number; days: number; pending: number; rejected: number; missing: number }>();
    const get = (id: number) => per.get(id) ?? (per.set(id, { hours: 0, days: 0, pending: 0, rejected: 0, missing: 0 }), per.get(id)!);
    for (const x of days) { const p = get(x.employeeId); p.hours += x.submittedHours || 0; p.days++; if (x.status === 'SUBMITTED') p.pending++; if (x.status === 'REJECTED') p.rejected++; }
    for (const a of att) if (!sub.has(`${a.employeeId}|${this.iso(a.date)}`)) get(a.employeeId).missing++;

    const show = args?.show ?? 'hours';
    const rows = emps.map((e) => ({ e, p: per.get(e.id) ?? { hours: 0, days: 0, pending: 0, rejected: 0, missing: 0 } }))
      .filter((r) => show === 'missing' ? r.p.missing > 0 : show === 'pending' ? r.p.pending > 0 : r.p.days > 0 || r.p.missing > 0)
      .sort((a, b) => show === 'missing' ? b.p.missing - a.p.missing : show === 'pending' ? b.p.pending - a.p.pending : b.p.hours - a.p.hours);
    const tot = [...per.values()].reduce((s, p) => ({ hours: s.hours + p.hours, pending: s.pending + p.pending, missing: s.missing + p.missing }), { hours: 0, pending: 0, missing: 0 });
    const blocks: Block[] = [
      { type: 'kpis', title: `Timesheets ${from} → ${to}`, items: [
        { label: 'Hours submitted', value: Math.round(tot.hours) },
        { label: 'Pending review', value: tot.pending, tone: 'amber' },
        { label: 'Missing days', value: tot.missing, tone: 'red' },
        { label: 'People submitting', value: [...per.values()].filter((p) => p.days).length, tone: 'green' },
      ] },
    ];
    if (rows.length) blocks.push({
      type: 'table', title: show === 'missing' ? 'Present but no timesheet' : show === 'pending' ? 'Waiting for review' : 'Hours per person',
      columns: ['Employee', 'Department', 'Hours', 'Days submitted', 'Pending', 'Missing days'],
      rows: rows.slice(0, 200).map((r) => [this.nm(r.e), r.e.department?.name ?? '—', Math.round(r.p.hours * 10) / 10, r.p.days, r.p.pending, r.p.missing]),
      employeeIds: rows.slice(0, 200).map((r) => r.e.id),
    });
    return {
      summary: `Timesheets ${from}..${to}: ${Math.round(tot.hours)} h submitted, ${tot.pending} days pending review, ${tot.missing} present-days without a timesheet. Top: ${rows.slice(0, 10).map((r) => `${this.nm(r.e)} ${Math.round(r.p.hours)}h/${r.p.missing} missing`).join('; ')}`,
      blocks, source: `Timesheet days and clock-ins ${from} to ${to}`,
    };
  }

  // ---------- tickets ----------
  private async tickets(companyId: number, args: any): Promise<MoreToolResult> {
    const where: any = { companyId };
    const st = args?.status ?? 'ANY';
    if (st === 'UNRESOLVED') where.status = { in: ['OPEN', 'IN_PROGRESS'] };
    else if (st !== 'ANY') where.status = st;
    if (args?.from || args?.to) { const { from, to } = this.range(args); where.createdAt = { gte: this.d(from), lte: this.end(to) }; }
    if (args?.department) where.department = { name: { contains: args.department, mode: 'insensitive' } };
    if (args?.assignee) where.assignee = this.nameWhere(args.assignee);
    const list = await this.prisma.ticket.findMany({
      where, orderBy: { createdAt: 'asc' }, take: 500,
      select: { id: true, ticketNumber: true, title: true, status: true, priority: true, createdAt: true, resolvedAt: true, department: { select: { name: true } }, assignee: { select: { id: true, firstName: true, lastName: true } }, reporter: { select: { firstName: true, lastName: true } } },
    });
    const total = list.length >= 500 ? await this.prisma.ticket.count({ where }) : list.length;
    const by = (s: string) => list.filter((t) => t.status === s).length;
    const resolved = list.filter((t) => t.resolvedAt);
    const avgH = resolved.length ? resolved.reduce((s, t) => s + (t.resolvedAt!.getTime() - t.createdAt.getTime()), 0) / resolved.length / 3600000 : 0;
    const perA = new Map<string, number>();
    for (const t of list) if (['OPEN', 'IN_PROGRESS'].includes(t.status)) { const k = t.assignee ? this.nm(t.assignee) : 'Unassigned'; perA.set(k, (perA.get(k) ?? 0) + 1); }
    const top = [...perA.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    const now = Date.now();
    const blocks: Block[] = [
      { type: 'kpis', title: 'Tickets', items: [
        { label: 'Tickets', value: total },
        { label: 'Open', value: by('OPEN'), tone: 'red' },
        { label: 'In progress', value: by('IN_PROGRESS'), tone: 'blue' },
        { label: 'Resolved/closed', value: by('RESOLVED') + by('CLOSED'), tone: 'green' },
        { label: 'Avg resolution', value: avgH >= 48 ? `${(avgH / 24).toFixed(1)} d` : `${avgH.toFixed(1)} h`, tone: 'slate' },
      ] },
    ];
    if (top.length > 1) blocks.push({ type: 'chart', kind: 'bar', title: 'Unresolved tickets per assignee', labels: top.map((t) => t[0]), values: top.map((t) => t[1]) });
    if (list.length) blocks.push({
      type: 'table', title: total > list.length ? `Tickets (oldest ${list.length} of ${total})` : 'Tickets (oldest first)',
      columns: ['Ticket', 'Title', 'Team', 'Assignee', 'Status', 'Priority', 'Age (days)'],
      rows: list.slice(0, 300).map((t) => [t.ticketNumber, t.title, t.department?.name ?? '—', t.assignee ? this.nm(t.assignee) : 'Unassigned', t.status, t.priority, Math.floor(((t.resolvedAt?.getTime() ?? now) - t.createdAt.getTime()) / DAY)]),
      employeeIds: list.slice(0, 300).map((t) => t.assignee?.id ?? null),
    });
    const oldest = list.filter((t) => ['OPEN', 'IN_PROGRESS'].includes(t.status)).slice(0, 5);
    return {
      summary: `${total} tickets (${st}). Open ${by('OPEN')}, in progress ${by('IN_PROGRESS')}, resolved ${by('RESOLVED')}, closed ${by('CLOSED')}, rejected ${by('REJECTED')}. Avg resolution ${avgH.toFixed(1)} h over ${resolved.length}. Unresolved per assignee: ${top.map((t) => `${t[0]} ${t[1]}`).join(', ')}. Oldest open: ${oldest.map((t) => `${t.ticketNumber} "${t.title}" ${Math.floor((now - t.createdAt.getTime()) / DAY)}d`).join('; ')}`,
      blocks, source: 'Tickets' + (where.createdAt ? ' raised in range' : ''),
    };
  }

  // ---------- field visits ----------
  private async fieldVisits(companyId: number, args: any): Promise<MoreToolResult> {
    if (args?.pending_requests) {
      const reqs = await this.prisma.fieldVisitRequest.findMany({
        where: { companyId, status: { in: ['PENDING', 'PENDING_APPROVAL', 'SUBMITTED'] } }, orderBy: { startDate: 'asc' }, take: 200,
        select: { requestNumber: true, location: true, startDate: true, endDate: true, status: true, project: { select: { name: true } }, raisedBy: { select: { id: true, firstName: true, lastName: true } }, _count: { select: { members: true } } },
      });
      return {
        summary: `${reqs.length} field visit requests waiting: ${reqs.slice(0, 20).map((r) => `${r.requestNumber} ${this.nm(r.raisedBy)} → ${r.location} ${this.iso(r.startDate)}`).join('; ')}`,
        blocks: [
          { type: 'kpis', title: 'Field visit requests', items: [{ label: 'Waiting for approval', value: reqs.length, tone: 'amber' }] },
          ...(reqs.length ? [{ type: 'table', title: 'Pending field visit requests', columns: ['Employee', 'Request', 'Project', 'Location', 'From', 'To', 'People'],
            rows: reqs.map((r) => [this.nm(r.raisedBy), r.requestNumber, r.project?.name ?? '—', r.location, this.iso(r.startDate), this.iso(r.endDate), r._count.members]),
            employeeIds: reqs.map((r) => r.raisedBy?.id ?? null) }] : []),
        ],
        source: 'Field visit requests (pending)',
      };
    }
    const { from, to } = this.range(args);
    const rows = await this.prisma.fieldVisitAttendance.findMany({
      where: { companyId, visitDate: { gte: this.d(from), lte: this.end(to) } }, orderBy: [{ visitDate: 'asc' }], take: 400,
      select: { visitDate: true, status: true, clockInTime: true, clockOutTime: true, employee: { select: { id: true, firstName: true, lastName: true } }, request: { select: { requestNumber: true, location: true, project: { select: { name: true } } } } },
    });
    const people = new Set(rows.map((r) => r.employee?.id)).size;
    const clocked = rows.filter((r) => r.clockInTime).length;
    return {
      summary: `Field visits ${from}..${to}: ${rows.length} visit-days, ${people} people, ${clocked} clocked in. ${rows.slice(0, 20).map((r) => `${this.nm(r.employee)} ${this.iso(r.visitDate)} ${r.request?.location} ${r.status}`).join('; ')}`,
      blocks: [
        { type: 'kpis', title: `Field visits ${from === to ? from : `${from} → ${to}`}`, items: [{ label: 'Visit days', value: rows.length }, { label: 'People', value: people }, { label: 'Clocked in', value: clocked, tone: 'green' }, { label: 'Not clocked in', value: rows.length - clocked, tone: 'amber' }] },
        ...(rows.length ? [{ type: 'table', title: 'On field', columns: ['Employee', 'Date', 'Project', 'Location', 'Status', 'In', 'Out'],
          rows: rows.map((r) => [this.nm(r.employee), this.iso(r.visitDate), r.request?.project?.name ?? '—', r.request?.location ?? '—', r.status, this.time(r.clockInTime), this.time(r.clockOutTime)]),
          employeeIds: rows.map((r) => r.employee?.id ?? null) }] : []),
      ],
      source: `Field visit attendance ${from} to ${to}`,
    };
  }

  // ---------- payroll ----------
  private async payroll(companyId: number, args: any): Promise<MoreToolResult> {
    let month = Number(args?.month), year = Number(args?.year);
    if (!month || !year) {
      const last = await this.prisma.payslip.findFirst({ where: { companyId }, orderBy: [{ year: 'desc' }, { month: 'desc' }], select: { month: true, year: true } });
      month = month || last?.month || new Date().getMonth() + 1;
      year = year || last?.year || new Date().getFullYear();
    }
    const slips = await this.prisma.payslip.findMany({
      where: { companyId, month, year },
      select: { status: true, totalEarnings: true, totalDeductions: true, lossOfPay: true, netPay: true, absentDays: true, employee: { select: { department: { select: { name: true } } } } },
    });
    const sum = (k: string) => slips.reduce((s, p: any) => s + (p[k] || 0), 0);
    const byDept = new Map<string, { n: number; gross: number; net: number; lop: number }>();
    for (const p of slips) { const k = p.employee?.department?.name ?? 'No department'; const v = byDept.get(k) ?? { n: 0, gross: 0, net: 0, lop: 0 }; v.n++; v.gross += p.totalEarnings; v.net += p.netPay; v.lop += p.lossOfPay; byDept.set(k, v); }
    const depts = [...byDept.entries()].sort((a, b) => b[1].net - a[1].net);
    const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const status = ['DRAFT', 'FINALIZED', 'PAID'].map((s) => `${s} ${slips.filter((p) => p.status === s).length}`).join(', ');
    return {
      summary: `Payroll ${label}: ${slips.length} payslips (${status}). Earnings ${this.money(sum('totalEarnings'))}, deductions ${this.money(sum('totalDeductions'))}, loss of pay ${this.money(sum('lossOfPay'))}, net ${this.money(sum('netPay'))}. By department net: ${depts.map((d) => `${d[0]} ${this.money(d[1].net)} (${d[1].n})`).join(', ')}`,
      blocks: [
        { type: 'kpis', title: `Payroll — ${label}`, items: [
          { label: 'Payslips', value: slips.length },
          { label: 'Total earnings', value: this.money(sum('totalEarnings')) },
          { label: 'Deductions', value: this.money(sum('totalDeductions')), tone: 'amber' },
          { label: 'Loss of pay', value: this.money(sum('lossOfPay')), tone: 'red' },
          { label: 'Net pay', value: this.money(sum('netPay')), tone: 'green' },
        ] },
        ...(depts.length > 1 ? [{ type: 'chart', kind: 'bar', title: 'Net pay by department (₹)', labels: depts.slice(0, 15).map((d) => d[0]), values: depts.slice(0, 15).map((d) => Math.round(d[1].net)) }] : []),
        ...(depts.length ? [{ type: 'table', title: 'By department', columns: ['Department', 'Payslips', 'Earnings', 'Loss of pay', 'Net pay'],
          rows: depts.map((d) => [d[0], d[1].n, this.money(d[1].gross), this.money(d[1].lop), this.money(d[1].net)]) }] : []),
      ],
      source: `Payslips for ${label} (totals only)`,
    };
  }

  // ---------- assets ----------
  private async assets(companyId: number, args: any): Promise<MoreToolResult> {
    const all = await this.prisma.asset.findMany({ where: { companyId, ...(args?.category ? { category: { contains: args.category, mode: 'insensitive' } } : {}) }, select: { id: true, assetTag: true, name: true, category: true, status: true, warrantyExpiry: true } });
    const asg = await this.prisma.assetAssignment.findMany({
      where: { companyId, status: 'ACTIVE', assetId: { in: all.map((a) => a.id) }, ...(args?.holder ? { employee: this.nameWhere(args.holder) } : {}) },
      select: { assetId: true, assignedDate: true, employee: { select: { id: true, firstName: true, lastName: true, offboardingStatus: true } } },
    });
    const byId = new Map(all.map((a) => [a.id, a]));
    const statusCounts = new Map<string, number>(); for (const a of all) statusCounts.set(a.status, (statusCounts.get(a.status) ?? 0) + 1);
    const catCounts = new Map<string, number>(); for (const a of all) catCounts.set(a.category, (catCounts.get(a.category) ?? 0) + 1);
    const leavers = asg.filter((x) => x.employee?.offboardingStatus && x.employee.offboardingStatus !== 'NONE');
    const blocks: Block[] = [
      { type: 'kpis', title: 'Assets', items: [
        { label: 'Assets', value: all.length },
        ...[...statusCounts.entries()].map(([k, v]) => ({ label: k.charAt(0) + k.slice(1).toLowerCase().replace(/_/g, ' '), value: v })),
        { label: 'With leavers', value: leavers.length, tone: 'red' },
      ] },
    ];
    if (catCounts.size > 1) blocks.push({ type: 'chart', kind: 'bar', title: 'Assets by category', labels: [...catCounts.keys()], values: [...catCounts.values()] });
    let summaryExtra = '';
    if (args?.warranty_days) {
      const lim = Date.now() + Number(args.warranty_days) * DAY;
      const exp = all.filter((a) => a.warrantyExpiry && a.warrantyExpiry.getTime() <= lim && a.warrantyExpiry.getTime() >= Date.now() - 30 * DAY).sort((a, b) => a.warrantyExpiry!.getTime() - b.warrantyExpiry!.getTime());
      if (exp.length) blocks.push({ type: 'table', title: `Warranty ending within ${args.warranty_days} days`, columns: ['Tag', 'Asset', 'Category', 'Status', 'Warranty ends'], rows: exp.map((a) => [a.assetTag, a.name, a.category, a.status, this.iso(a.warrantyExpiry)]) });
      summaryExtra = ` Warranty ending within ${args.warranty_days} days: ${exp.length} (${exp.slice(0, 10).map((a) => `${a.assetTag} ${this.iso(a.warrantyExpiry)}`).join(', ')}).`;
    }
    if (asg.length) blocks.push({
      type: 'table', title: args?.holder ? `Assets with ${args.holder}` : 'Assigned assets',
      columns: ['Employee', 'Tag', 'Asset', 'Category', 'Since'],
      rows: asg.slice(0, 300).map((x) => [this.nm(x.employee), byId.get(x.assetId)?.assetTag ?? '—', byId.get(x.assetId)?.name ?? '—', byId.get(x.assetId)?.category ?? '—', this.iso(x.assignedDate)]),
      employeeIds: asg.slice(0, 300).map((x) => x.employee?.id ?? null),
    });
    return {
      summary: `${all.length} assets. Status: ${[...statusCounts.entries()].map((e) => e.join(' ')).join(', ')}. Category: ${[...catCounts.entries()].map((e) => e.join(' ')).join(', ')}. ${asg.length} active assignments${args?.holder ? ` for ${args.holder}: ${asg.map((x) => byId.get(x.assetId)?.name).join(', ')}` : ''}. ${leavers.length} assets still with people who are leaving/left: ${leavers.slice(0, 10).map((x) => `${this.nm(x.employee)} (${byId.get(x.assetId)?.assetTag})`).join(', ')}.${summaryExtra}`,
      blocks, source: 'Asset register and active assignments',
    };
  }

  // ---------- probation ----------
  private async probation(companyId: number, args: any): Promise<MoreToolResult> {
    const list = await this.prisma.employee.findMany({
      where: { ...this.active(companyId), probationEndDate: { not: null }, probationConfirmedAt: null },
      select: { id: true, firstName: true, lastName: true, joiningDate: true, probationEndDate: true, probationExtensions: true, probationReview: true, department: { select: { name: true } }, manager: { select: { firstName: true, lastName: true } } },
      orderBy: { probationEndDate: 'asc' },
    });
    const now = this.d(this.today()).getTime();
    const within = args?.ending_within_days ? Number(args.ending_within_days) : null;
    const rows = list.filter((e) => within === null || e.probationEndDate!.getTime() - now <= within * DAY);
    const overdue = list.filter((e) => e.probationEndDate!.getTime() < now).length;
    const soon = list.filter((e) => { const t = e.probationEndDate!.getTime() - now; return t >= 0 && t <= 30 * DAY; }).length;
    const reviewed = list.filter((e) => e.probationReview).length;
    const daysLeft = (e: any) => Math.round((e.probationEndDate.getTime() - now) / DAY);
    return {
      summary: `${list.length} people on probation (not confirmed). ${overdue} past end date, ${soon} ending in 30 days, ${reviewed} have a manager review. ${rows.slice(0, 20).map((e) => `${this.nm(e)} ends ${this.iso(e.probationEndDate)} (${daysLeft(e)}d), review ${(e.probationReview as any)?.recommendation ?? 'none'}`).join('; ')}`,
      blocks: [
        { type: 'kpis', title: 'Probation', items: [{ label: 'On probation', value: list.length }, { label: 'Past end date', value: overdue, tone: 'red' }, { label: 'Ending in 30 days', value: soon, tone: 'amber' }, { label: 'Manager reviewed', value: reviewed, tone: 'green' }] },
        ...(rows.length ? [{ type: 'table', title: within !== null ? `Ending within ${within} days` : 'On probation', columns: ['Employee', 'Department', 'Manager', 'Joined', 'Ends', 'Days left', 'Extensions', 'Review'],
          rows: rows.map((e) => [this.nm(e), e.department?.name ?? '—', this.nm(e.manager), this.iso(e.joiningDate), this.iso(e.probationEndDate), daysLeft(e), e.probationExtensions, (e.probationReview as any)?.recommendation ?? 'Pending']),
          employeeIds: rows.map((e) => e.id) }] : []),
      ],
      source: 'Employees on probation (unconfirmed)',
    };
  }

  // ---------- compare periods ----------
  private async metricBy(companyId: number, metric: string, from: string, to: string): Promise<Map<number, number>> {
    const emps = await this.prisma.employee.findMany({ where: this.active(companyId), select: { id: true } });
    const ids = emps.map((e) => e.id);
    const out = new Map<number, number>();
    const add = (id: number | null | undefined, v = 1) => { if (id) out.set(id, (out.get(id) ?? 0) + v); };
    const gte = this.d(from), lte = this.end(to);
    if (['late', 'absent', 'half_day'].includes(metric)) {
      const where: any = { employeeId: { in: ids }, date: { gte, lte: this.d(to) } };
      if (metric === 'late') { where.isLate = true; where.status = { not: 'ABSENT' }; }
      else where.status = metric === 'absent' ? 'ABSENT' : 'HALF_DAY';
      for (const a of await this.prisma.attendance.findMany({ where, select: { employeeId: true } })) add(a.employeeId);
    } else if (metric === 'leave_days') {
      const ls = await this.prisma.leaveRequest.findMany({ where: { employeeId: { in: ids }, status: 'APPROVED', startDate: { lte }, endDate: { gte } }, select: { employeeId: true, startDate: true, endDate: true, isHalfDay: true } });
      for (const l of ls) {
        const s = Math.max(l.startDate.getTime(), gte.getTime()), e = Math.min(l.endDate.getTime(), this.d(to).getTime());
        add(l.employeeId, l.isHalfDay ? 0.5 : Math.max(0, Math.round((e - s) / DAY) + 1));
      }
    } else if (metric === 'tasks_completed') {
      for (const t of await this.prisma.issue.findMany({ where: { project: { companyId }, completedAt: { gte, lte } }, select: { assigneeId: true } })) add(t.assigneeId);
    } else if (metric === 'tickets_raised') {
      for (const t of await this.prisma.ticket.findMany({ where: { companyId, createdAt: { gte, lte } }, select: { reporterId: true } })) add(t.reporterId);
    } else if (metric === 'tickets_resolved') {
      for (const t of await this.prisma.ticket.findMany({ where: { companyId, resolvedAt: { gte, lte } }, select: { assigneeId: true } })) add(t.assigneeId);
    } else if (metric === 'timesheet_hours') {
      for (const t of await this.prisma.timesheetDay.findMany({ where: { employeeId: { in: ids }, date: { gte, lte: this.d(to) } }, select: { employeeId: true, submittedHours: true } })) add(t.employeeId, t.submittedHours || 0);
    }
    return out;
  }

  private async compare(companyId: number, args: any): Promise<MoreToolResult> {
    const metric = args?.metric ?? 'late';
    const t = this.today();
    const aF = this.ymd(args?.a_from, t), aT = this.ymd(args?.a_to, t), bF = this.ymd(args?.b_from, t), bT = this.ymd(args?.b_to, t);
    const [A, B, emps] = await Promise.all([
      this.metricBy(companyId, metric, aF, aT),
      this.metricBy(companyId, metric, bF, bT),
      this.prisma.employee.findMany({ where: { companyId }, select: { id: true, firstName: true, lastName: true, department: { select: { name: true } } } }),
    ]);
    const emp = new Map(emps.map((e) => [e.id, e]));
    const total = (m: Map<number, number>) => [...m.values()].reduce((s, v) => s + v, 0);
    const ta = total(A), tb = total(B);
    const pct = tb ? Math.round(((ta - tb) / tb) * 100) : null;
    const dept = new Map<string, { a: number; b: number }>();
    for (const [id, v] of A) { const k = emp.get(id)?.department?.name ?? 'No department'; const x = dept.get(k) ?? { a: 0, b: 0 }; x.a += v; dept.set(k, x); }
    for (const [id, v] of B) { const k = emp.get(id)?.department?.name ?? 'No department'; const x = dept.get(k) ?? { a: 0, b: 0 }; x.b += v; dept.set(k, x); }
    const depts = [...dept.entries()].sort((x, y) => Math.abs(y[1].a - y[1].b) - Math.abs(x[1].a - x[1].b));
    const ids = new Set([...A.keys(), ...B.keys()]);
    const people = [...ids].map((id) => ({ id, a: A.get(id) ?? 0, b: B.get(id) ?? 0 })).sort((x, y) => Math.abs(y.a - y.b) - Math.abs(x.a - x.b)).slice(0, 15);
    const label = metric.replace(/_/g, ' ');
    const r1 = (n: number) => Math.round(n * 10) / 10;
    return {
      summary: `${label}: current ${aF}..${aT} = ${r1(ta)}, previous ${bF}..${bT} = ${r1(tb)}${pct !== null ? ` (${pct >= 0 ? '+' : ''}${pct}%)` : ''}. Note: periods may differ in length (${Math.round((this.d(aT).getTime() - this.d(aF).getTime()) / DAY) + 1} vs ${Math.round((this.d(bT).getTime() - this.d(bF).getTime()) / DAY) + 1} days). By department: ${depts.map((d) => `${d[0]}: previous ${r1(d[1].b)} -> now ${r1(d[1].a)}`).join('; ')}. Biggest changes per person: ${people.map((p) => `${this.nm(emp.get(p.id))}: previous ${r1(p.b)} -> now ${r1(p.a)}`).join('; ')}. Write changes as "previous → now".`,
      blocks: [
        { type: 'kpis', title: `${label[0].toUpperCase() + label.slice(1)}: ${aF} → ${aT} vs ${bF} → ${bT}`, items: [
          { label: 'Current', value: r1(ta) }, { label: 'Previous', value: r1(tb) },
          { label: 'Change', value: pct === null ? '—' : `${pct >= 0 ? '+' : ''}${pct}%`, tone: pct === null ? 'slate' : (pct > 0) === ['tasks_completed', 'tickets_resolved', 'timesheet_hours'].includes(metric) ? 'green' : 'red' },
        ] },
        { type: 'table', title: 'By department', columns: ['Department', 'Current', 'Previous', 'Change'], rows: depts.map((d) => [d[0], r1(d[1].a), r1(d[1].b), `${d[1].a - d[1].b >= 0 ? '+' : ''}${r1(d[1].a - d[1].b)}`]) },
        { type: 'table', title: 'People who changed most', columns: ['Employee', 'Department', 'Current', 'Previous', 'Change'],
          rows: people.map((p) => [this.nm(emp.get(p.id)), emp.get(p.id)?.department?.name ?? '—', r1(p.a), r1(p.b), `${p.a - p.b >= 0 ? '+' : ''}${r1(p.a - p.b)}`]),
          employeeIds: people.map((p) => p.id) },
      ],
      source: `${label} ${aF}–${aT} vs ${bF}–${bT}`,
    };
  }
}
