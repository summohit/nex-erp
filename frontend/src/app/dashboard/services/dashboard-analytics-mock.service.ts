import { Injectable } from '@angular/core';
import { DashboardPayload } from '../../services/dashboard.service';

export interface AttendanceTrendPoint {
  date: string;
  label: string;
  hours: number;
  target: number;
}

export interface HeatmapCell {
  date: string;
  label: string;
  hours: number;
  level: 0 | 1 | 2 | 3 | 4; // 0: 0h, 1: 1-4h, 2: 4-7h, 3: 7-9h, 4: >9h
  dayOfWeek: number; // 0 (Mon) .. 6 (Sun)
}

export interface HeatmapWeek {
  weekLabel: string;
  days: HeatmapCell[];
}

export interface TaskStatusSlice {
  label: 'Todo' | 'In Progress' | 'Review' | 'Done';
  key: string;
  count: number;
  color: string;
}

export interface OverdueAgingBucket {
  bucket: '0–7d' | '8–30d' | '30+ days';
  count: number;
  color: string;
}

export interface LeaveGaugeItem {
  id: string;
  name: string;
  code: string;
  used: number;
  allocated: number;
  remaining: number;
  percentUsed: number;
  color: string;
}

export interface ProjectProgressItem {
  id: number;
  name: string;
  clientOrDept: string;
  progress: number;
  dueDate: string; // standardized "19 Oct 2026"
  status: 'ON_TRACK' | 'AT_RISK' | 'COMPLETED';
  tasksOpen: number;
}

export interface TeamPresenceBreakdown {
  total: number;
  segments: {
    key: 'present' | 'wfh' | 'leave' | 'absent' | 'notPunched';
    label: string;
    count: number;
    percent: number;
    color: string;
  }[];
}

export interface WeeklyAttendancePoint {
  week: string;
  attendancePct: number;
  onTimePct: number;
}

export interface TicketSlaData {
  byAge: { bucket: string; count: number; color: string }[];
  trend: { period: string; raised: number; resolved: number }[];
}

export interface JoiningsExitsPoint {
  month: string;
  joinings: number;
  exits: number;
}

@Injectable({ providedIn: 'root' })
export class DashboardAnalyticsMockService {
  /**
   * Standardize dates across the dashboard to "19 Oct 2026"
   */
  formatStandardDate(input: string | Date | null | undefined): string {
    if (!input) return '—';
    const d = typeof input === 'string' ? new Date(input.length === 10 ? `${input}T00:00:00` : input) : input;
    if (isNaN(d.getTime())) return '—';
    const day = d.getDate();
    const month = d.toLocaleDateString('en-GB', { month: 'short' });
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
  }

  /**
   * Relative time formatter ("2d ago", "3h ago", "Just now")
   */
  formatRelativeTime(input: string | Date | null | undefined, now: Date = new Date()): string {
    if (!input) return '';
    const d = typeof input === 'string' ? new Date(input) : input;
    if (isNaN(d.getTime())) return '';
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    const diffDays = Math.floor(diffHrs / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    const diffMonths = Math.floor(diffDays / 30);
    return `${diffMonths}mo ago`;
  }

  /**
   * Row 2 KPI Sparklines & Deltas
   * TODO(API): GET /api/dashboard/me/kpi-trends (returns 7-point sparkline + period-over-period delta %)
   */
  getKpiTelemetry(payload: DashboardPayload | null) {
    const loggedSeries = (payload?.common?.myHoursLogged || []).slice(-7).map((d) => Number(d.hours || 0));
    const attendanceSpark = loggedSeries.length >= 4 ? loggedSeries : [8.2, 8.8, 9.1, 8.5, 9.2, 8.9, 9.0];

    const taskOverdue = payload?.common?.taskStats?.overdue ?? 0;
    const projectOverdue = payload?.common?.projectStats?.overdue ?? 0;

    return {
      attendance: {
        sparkline: attendanceSpark,
        delta: '▲ 6%',
        deltaTone: 'good' as const,
      },
      leave: {
        sparkline: [24, 22, 21, 19, 18, 18, 16],
        delta: '▼ 2d used',
        deltaTone: 'neutral' as const,
      },
      tasks: {
        sparkline: [14, 12, 15, 11, 9, 10, payload?.common?.taskStats?.pending || 8],
        delta: taskOverdue > 0 ? `▲ ${taskOverdue} overdue` : '▼ 14%',
        deltaTone: (taskOverdue > 0 ? 'bad' : 'good') as 'good' | 'bad',
      },
      projects: {
        sparkline: [3, 4, 4, 5, 5, 6, payload?.common?.projectStats?.inProgress || 4],
        delta: projectOverdue > 0 ? `▲ ${projectOverdue} delayed` : '▲ 12%',
        deltaTone: (projectOverdue > 0 ? 'bad' : 'good') as 'good' | 'bad',
      },
      tickets: {
        sparkline: [6, 5, 7, 4, 3, 2, payload?.common?.ticketStats?.pending || 2],
        delta: (payload?.common?.ticketStats?.overdue || 0) > 0 ? `▲ ${payload?.common?.ticketStats?.overdue} overdue` : '▼ 18%',
        deltaTone: ((payload?.common?.ticketStats?.overdue || 0) > 0 ? 'bad' : 'good') as 'good' | 'bad',
      },
    };
  }

  /**
   * My Workspace — Attendance trend: area chart, last 30 days, hours worked/day vs 9h target line.
   * Hydrates from payload.common.myHoursLogged (14d) + backfill for 30d window.
   * TODO(API): Extend GET /api/dashboard common.myHoursLogged from 14 days to 30 days.
   */
  getMyAttendanceTrend30d(payload: DashboardPayload | null): AttendanceTrendPoint[] {
    const existingMap = new Map<string, number>();
    for (const item of payload?.common?.myHoursLogged || []) {
      existingMap.set(item.date, Number(item.hours || 0));
    }

    const today = new Date();
    const points: AttendanceTrendPoint[] = [];
    const pattern = [8.8, 9.2, 8.6, 9.1, 8.4, 9.5, 8.9, 9.0, 8.3, 9.4];

    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const dow = d.getDay();
      const isWeekend = dow === 0 || dow === 6;

      let hours = existingMap.get(key);
      if (hours === undefined || (hours === 0 && !isWeekend && i > 1)) {
        hours = isWeekend ? 0 : pattern[(29 - i) % pattern.length];
      }

      points.push({
        date: key,
        label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        hours: Number(hours.toFixed(1)),
        target: isWeekend ? 0 : 9,
      });
    }
    return points;
  }

  /**
   * My Workspace — Work-hours heatmap: GitHub-style calendar heatmap for the last 12 weeks.
   * TODO(API): GET /api/dashboard/me/work-hours-heatmap?weeks=12
   */
  getWorkHoursHeatmap12w(payload: DashboardPayload | null): HeatmapWeek[] {
    const existingMap = new Map<string, number>();
    for (const item of payload?.common?.myHoursLogged || []) {
      existingMap.set(item.date, Number(item.hours || 0));
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dow = today.getDay();
    const currentMonday = new Date(today);
    currentMonday.setDate(today.getDate() + (dow === 0 ? -6 : 1 - dow));

    const weeks: HeatmapWeek[] = [];
    const sampleHours = [8.5, 9.2, 7.8, 9.4, 8.9, 6.5, 9.1, 8.7, 9.6, 8.2, 9.0, 7.4];

    for (let w = 11; w >= 0; w--) {
      const weekStart = new Date(currentMonday);
      weekStart.setDate(currentMonday.getDate() - w * 7);
      const weekLabel = weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      const days: HeatmapCell[] = [];

      for (let dIdx = 0; dIdx < 7; dIdx++) {
        const cellDate = new Date(weekStart);
        cellDate.setDate(weekStart.getDate() + dIdx);
        const key = `${cellDate.getFullYear()}-${String(cellDate.getMonth() + 1).padStart(2, '0')}-${String(cellDate.getDate()).padStart(2, '0')}`;
        const isFuture = cellDate.getTime() > today.getTime();
        const isWeekend = dIdx >= 5;

        let hrs = existingMap.get(key);
        if (hrs === undefined) {
          if (isFuture || isWeekend) {
            hrs = 0;
          } else {
            hrs = sampleHours[(w * 7 + dIdx) % sampleHours.length];
          }
        }

        let level: 0 | 1 | 2 | 3 | 4 = 0;
        if (hrs > 0 && hrs < 5) level = 1;
        else if (hrs >= 5 && hrs < 7.5) level = 2;
        else if (hrs >= 7.5 && hrs <= 9) level = 3;
        else if (hrs > 9) level = 4;

        days.push({
          date: key,
          label: this.formatStandardDate(cellDate),
          hours: Number(hrs.toFixed(1)),
          level,
          dayOfWeek: dIdx,
        });
      }

      weeks.push({ weekLabel, days });
    }

    return weeks;
  }

  /**
   * My Workspace — Task status donut: Todo / In Progress / Review / Done, with total in center.
   */
  getTaskStatusDonut(payload: DashboardPayload | null): { total: number; slices: TaskStatusSlice[] } {
    const raw = payload?.common?.myTasksByStatus || [];
    const map = new Map<string, number>();
    for (const r of raw) {
      map.set(String(r.name).toUpperCase(), Number(r.count || 0));
    }

    let todo = (map.get('PENDING') || 0) + (map.get('TODO') || 0) + (map.get('TO DO') || 0);
    let inProgress = (map.get('IN_PROGRESS') || 0) + (map.get('IN PROGRESS') || 0);
    let review = (map.get('REVIEW') || 0) + (map.get('IN_REVIEW') || 0);
    let done = (map.get('COMPLETED') || 0) + (map.get('DONE') || 0);

    // Fallback when user has tasks in common.myTasks or demo metrics
    if (todo + inProgress + review + done === 0) {
      const tasks = payload?.common?.myTasks || [];
      if (tasks.length > 0) {
        todo = tasks.filter((t) => t.status === 'PENDING').length;
        inProgress = tasks.filter((t) => t.status === 'IN_PROGRESS').length;
        review = tasks.filter((t) => t.status === 'REVIEW').length;
        done = tasks.filter((t) => t.status === 'COMPLETED').length;
      }
    }

    const slices: TaskStatusSlice[] = [
      { label: 'Todo', key: 'TODO', count: todo, color: '#64748b' },
      { label: 'In Progress', key: 'IN_PROGRESS', count: inProgress, color: '#1373e5' },
      { label: 'Review', key: 'REVIEW', count: review, color: '#d97706' },
      { label: 'Done', key: 'DONE', count: done, color: '#059669' },
    ];

    return {
      total: todo + inProgress + review + done,
      slices,
    };
  }

  /**
   * My Workspace — Overdue aging bar: 0–7d, 8–30d, 30+ days overdue.
   * Computes directly from payload.common.myTasks due dates.
   * TODO(API): GET /api/dashboard/me/tasks-overdue-aging (for full task list beyond top 8)
   */
  getOverdueAgingBuckets(payload: DashboardPayload | null): OverdueAgingBucket[] {
    const tasks = payload?.common?.myTasks || [];
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    let b0_7 = 0;
    let b8_30 = 0;
    let b30Plus = 0;

    for (const t of tasks) {
      if (!t.dueDate || t.status === 'COMPLETED') continue;
      const due = new Date(t.dueDate);
      due.setHours(0, 0, 0, 0);
      const diffDays = Math.floor((now.getTime() - due.getTime()) / 86400000);
      if (diffDays > 0 && diffDays <= 7) b0_7++;
      else if (diffDays >= 8 && diffDays <= 30) b8_30++;
      else if (diffDays > 30) b30Plus++;
    }

    const totalOverdueStat = payload?.common?.taskStats?.overdue || 0;
    const sum = b0_7 + b8_30 + b30Plus;
    if (totalOverdueStat > sum) {
      b8_30 += totalOverdueStat - sum;
    }

    return [
      { bucket: '0–7d', count: b0_7, color: '#f59e0b' },
      { bucket: '8–30d', count: b8_30, color: '#ea580c' },
      { bucket: '30+ days', count: b30Plus, color: '#dc2626' },
    ];
  }

  /**
   * My Workspace — Leave balance radial/gauge per leave type (Sick, Casual, Comp-Off) used vs total.
   */
  getLeaveGauges(payload: DashboardPayload | null): LeaveGaugeItem[] {
    const allBalances = (payload?.common?.myLeaveBalance || []) as any[];
    const paid = allBalances.filter((x) => x.leaveType?.isPaid !== false);
    const raw = paid.length > 0 ? paid : allBalances;

    const palette = ['#1373e5', '#059669', '#7c3aed', '#d97706', '#0891b2', '#e11d48'];

    const deriveCode = (name: string, explicit?: string): string => {
      if (explicit && explicit.trim()) return explicit.trim().toUpperCase();
      const cleaned = (name || 'Leave').replace(/[^a-zA-Z\s-]/g, '').trim();
      const words = cleaned.split(/[\s-]+/).filter(Boolean);
      if (words.length >= 2) {
        return words
          .slice(0, 3)
          .map((w) => w[0].toUpperCase())
          .join('');
      }
      return cleaned.slice(0, 2).toUpperCase() || 'LV';
    };

    if (raw.length > 0) {
      return raw.slice(0, 6).map((b, idx) => {
        const allocated = Math.max(0, Number(b.allocated || 0));
        const used = Number(b.used || 0);
        const remaining = Math.max(0, allocated - used);
        const percentUsed =
          allocated > 0 ? Math.min(100, Math.round((used / allocated) * 100)) : 0;
        const name = b.leaveType?.name || 'Leave';
        return {
          id: String(b.id || idx),
          name,
          code: deriveCode(name, b.leaveType?.code),
          used,
          allocated,
          remaining,
          percentUsed,
          color: palette[idx % palette.length],
        };
      });
    }

    return [
      { id: 'cl', name: 'Casual Leave', code: 'CL', used: 4, allocated: 12, remaining: 8, percentUsed: 33, color: '#1373e5' },
      { id: 'sl', name: 'Sick Leave', code: 'SL', used: 2, allocated: 10, remaining: 8, percentUsed: 20, color: '#059669' },
      { id: 'co', name: 'Comp-Off', code: 'CO', used: 1, allocated: 4, remaining: 3, percentUsed: 25, color: '#7c3aed' },
    ];
  }

  /**
   * My Workspace — Project progress: horizontal progress bars per project with % and due date.
   * TODO(API): GET /api/dashboard/me/projects (with completionPercentage, dueDate, openTasksCount)
   */
  getProjectProgressList(payload: DashboardPayload | null): ProjectProgressItem[] {
    const inProg = payload?.common?.projectStats?.inProgress ?? 3;
    if (inProg === 0 && (payload?.common?.projectStats?.total ?? 0) === 0) {
      return [];
    }
    return [
      {
        id: 101,
        name: 'NexERP Core v2.4 Rollout',
        clientOrDept: 'Platform Engineering',
        progress: 78,
        dueDate: '28 Oct 2026',
        status: 'ON_TRACK',
        tasksOpen: 4,
      },
      {
        id: 102,
        name: 'Q4 Payroll & Compliance Automation',
        clientOrDept: 'HR & Finance Ops',
        progress: 54,
        dueDate: '12 Nov 2026',
        status: 'ON_TRACK',
        tasksOpen: 7,
      },
      {
        id: 103,
        name: 'Mobile Attendance Geofence SDK',
        clientOrDept: 'Mobile Squad',
        progress: 36,
        dueDate: '15 Oct 2026',
        status: 'AT_RISK',
        tasksOpen: 5,
      },
      {
        id: 104,
        name: 'Employee Self-Service Portal Refresh',
        clientOrDept: 'Design Systems',
        progress: 92,
        dueDate: '22 Oct 2026',
        status: 'ON_TRACK',
        tasksOpen: 1,
      },
    ];
  }

  /**
   * My Team — Presence today: stacked horizontal bar (Present / WFH / On Leave / Absent / Not punched).
   * Hydrates from payload.org.todayAttendance + payload.common.onWfhToday + payload.common.onLeaveToday.
   * TODO(API): GET /api/dashboard/team/presence-today (scoped to manager's direct + indirect reports)
   */
  getTeamPresenceBreakdown(payload: DashboardPayload | null): TeamPresenceBreakdown {
    const orgAtt = payload?.org?.todayAttendance;
    const wfhCount = payload?.common?.onWfhToday?.length || 0;
    const leaveCount = orgAtt?.onLeave ?? (payload?.common?.onLeaveToday?.length || 0);
    const rawPresent = orgAtt?.present ?? 18;
    const presentOnSite = Math.max(0, rawPresent - wfhCount);
    const notPunched = orgAtt?.notClockedIn ?? 2;
    const totalHeadcount = orgAtt?.totalEmployees || payload?.org?.headcount?.total || Math.max(24, rawPresent + leaveCount + notPunched + 1);
    const absent = Math.max(0, totalHeadcount - (presentOnSite + wfhCount + leaveCount + notPunched));
    const safeTotal = Math.max(1, presentOnSite + wfhCount + leaveCount + absent + notPunched);

    const segments = [
      {
        key: 'present' as const,
        label: 'Present (Office)',
        count: presentOnSite,
        percent: Math.round((presentOnSite / safeTotal) * 100),
        color: '#059669',
      },
      {
        key: 'wfh' as const,
        label: 'Work From Home',
        count: wfhCount,
        percent: Math.round((wfhCount / safeTotal) * 100),
        color: '#1373e5',
      },
      {
        key: 'leave' as const,
        label: 'On Leave',
        count: leaveCount,
        percent: Math.round((leaveCount / safeTotal) * 100),
        color: '#d97706',
      },
      {
        key: 'absent' as const,
        label: 'Absent',
        count: absent,
        percent: Math.round((absent / safeTotal) * 100),
        color: '#dc2626',
      },
      {
        key: 'notPunched' as const,
        label: 'Not Punched',
        count: notPunched,
        percent: Math.round((notPunched / safeTotal) * 100),
        color: '#94a3b8',
      },
    ];

    return { total: safeTotal, segments };
  }

  /**
   * My Team — Team attendance %: line chart, last 8 weeks.
   * TODO(API): GET /api/dashboard/team/attendance-weekly?weeks=8
   */
  getTeamAttendance8Weeks(payload: DashboardPayload | null): WeeklyAttendancePoint[] {
    return [
      { week: 'W1 (Aug 31)', attendancePct: 91, onTimePct: 84 },
      { week: 'W2 (Sep 07)', attendancePct: 93, onTimePct: 86 },
      { week: 'W3 (Sep 14)', attendancePct: 89, onTimePct: 82 },
      { week: 'W4 (Sep 21)', attendancePct: 94, onTimePct: 88 },
      { week: 'W5 (Sep 28)', attendancePct: 92, onTimePct: 87 },
      { week: 'W6 (Oct 05)', attendancePct: 95, onTimePct: 90 },
      { week: 'W7 (Oct 12)', attendancePct: 94, onTimePct: 89 },
      { week: 'W8 (This Wk)', attendancePct: 96, onTimePct: 92 },
    ];
  }

  /**
   * My Team — Ticket SLA: bar chart of open tickets by age + resolved vs raised trend.
   * TODO(API): GET /api/dashboard/team/ticket-sla
   */
  getTicketSlaMetrics(payload: DashboardPayload | null): TicketSlaData {
    return {
      byAge: [
        { bucket: '< 24h', count: 4, color: '#059669' },
        { bucket: '1–3 days', count: 3, color: '#1373e5' },
        { bucket: '4–7 days', count: 2, color: '#d97706' },
        { bucket: '> 7d (SLA Breach)', count: 1, color: '#dc2626' },
      ],
      trend: [
        { period: 'W1', raised: 12, resolved: 10 },
        { period: 'W2', raised: 15, resolved: 14 },
        { period: 'W3', raised: 9, resolved: 11 },
        { period: 'W4', raised: 14, resolved: 13 },
        { period: 'W5', raised: 11, resolved: 12 },
        { period: 'W6', raised: 8, resolved: 10 },
      ],
    };
  }

  /**
   * Organization — Joinings vs exits: dual bar chart by month (last 6 months).
   * TODO(API): GET /api/dashboard/org/joinings-vs-exits?months=6
   */
  getJoiningsVsExits6m(payload: DashboardPayload | null): JoiningsExitsPoint[] {
    const trend = payload?.org?.headcountTrend || [];
    if (trend.length >= 6) {
      return trend.slice(-6).map((t, i, arr) => {
        const prev = i > 0 ? arr[i - 1].count : t.count - 2;
        const diff = t.count - prev;
        return {
          month: t.label,
          joinings: Math.max(1, diff > 0 ? diff + 1 : 2),
          exits: Math.max(0, diff < 0 ? Math.abs(diff) : 1),
        };
      });
    }
    return [
      { month: 'May 2026', joinings: 5, exits: 1 },
      { month: 'Jun 2026', joinings: 4, exits: 2 },
      { month: 'Jul 2026', joinings: 7, exits: 1 },
      { month: 'Aug 2026', joinings: 3, exits: 1 },
      { month: 'Sep 2026', joinings: 6, exits: 2 },
      { month: 'Oct 2026', joinings: 4, exits: 0 },
    ];
  }
}
