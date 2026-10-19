import { MyPipCardComponent } from './my-pip-card/my-pip-card';
import { TaskHoursRequestsTabComponent } from '../projects/task-hours-requests/task-hours-requests-tab';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucideAlertCircle,
  LucideAlertTriangle,
  LucideArrowRight,
  LucideAward,
  LucideBanknote,
  LucideBarChart3,
  LucideBell,
  LucideBuilding2,
  LucideCake,
  LucideCalendar,
  LucideCalendarClock,
  LucideCalendarDays,
  LucideCheck,
  LucideCheckCircle2,
  LucideCheckSquare,
  LucideChevronRight,
  LucideCircle,
  LucideClock,
  LucideExternalLink,
  LucideFile,
  LucideFileSpreadsheet,
  LucideFileText,
  LucideFolderKanban,
  LucideGift,
  LucideImage,
  LucideLayers,
  LucideMapPin,
  LucideMegaphone,
  LucideMoon,
  LucidePaperclip,
  LucidePartyPopper,
  LucidePlay,
  LucideReceipt,
  LucideRefreshCw,
  LucideShield,
  LucideShoppingCart,
  LucideSparkles,
  LucideSquare,
  LucideSun,
  LucideTarget,
  LucideTicket,
  LucideTimer,
  LucideTrendingUp,
  LucideTrophy,
  LucideUserCheck,
  LucideUserPlus,
  LucideUsers,
  LucideX,
} from '@lucide/angular';

import { PeopleWatchCardComponent } from './people-watch-card/people-watch-card';
import { MyCalendarComponent } from './my-calendar/my-calendar';
import { ApexChartCardComponent } from './widgets/apex-chart-card.component';
import { WorkHoursHeatmapWidgetComponent } from './widgets/work-hours-heatmap-widget.component';
import { LeaveBalanceGaugeWidgetComponent } from './widgets/leave-balance-gauge-widget.component';
import { ProjectProgressWidgetComponent } from './widgets/project-progress-widget.component';
import { TeamPresenceWidgetComponent } from './widgets/team-presence-widget.component';
import { DashboardAnalyticsMockService } from './services/dashboard-analytics-mock.service';

import {
  Notice,
  noticeBodyHtml,
  noticeBodyText,
  NoticesService,
} from '../services/notices';
import { AuthService } from '../services/auth.service';
import {
  EmployeeOnboardingTask,
  OnboardingService,
} from '../services/onboarding.service';
import { AttendanceRecord, AttendanceService } from '../services/attendance';
import { LeavesService } from '../services/leaves';
import {
  DashboardPayload,
  DashboardService,
} from '../services/dashboard.service';
import { StatCardComponent } from '../shared/components/stat-card/stat-card.component';
import {
  OutsideOfficeAnswer,
  OutsideOfficeService,
} from '../shared/services/outside-office.service';
import { GeolocationService } from '../shared/services/geolocation.service';

export type DashboardTab = 'workspace' | 'team' | 'organization';
export type TaskSortColumn = 'title' | 'priority' | 'status' | 'dueDate';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterModule,
    StatCardComponent,
    MyCalendarComponent,
    PeopleWatchCardComponent,
    MyPipCardComponent,
    TaskHoursRequestsTabComponent,
    ApexChartCardComponent,
    WorkHoursHeatmapWidgetComponent,
    LeaveBalanceGaugeWidgetComponent,
    ProjectProgressWidgetComponent,
    TeamPresenceWidgetComponent,
    LucideCheckCircle2,
    LucideCircle,
    LucideClock,
    LucideFileText,
    LucideCheckSquare,
    LucideCalendar,
    LucideUserCheck,
    LucideAlertCircle,
    LucideArrowRight,
    LucideShield,
    LucideAward,
    LucideBanknote,
    LucideReceipt,
    LucideTrendingUp,
    LucideShoppingCart,
    LucideTarget,
    LucideCake,
    LucidePartyPopper,
    LucideGift,
    LucideSparkles,
    LucidePlay,
    LucideSquare,
    LucideMapPin,
    LucideChevronRight,
    LucideFolderKanban,
    LucideCheck,
    LucideX,
    LucideTicket,
    LucideUserPlus,
    LucideTrophy,
    LucideTimer,
    LucideCalendarDays,
    LucideRefreshCw,
    LucideCalendarClock,
    LucideMegaphone,
    LucideAlertTriangle,
    LucideBell,
    LucidePaperclip,
    LucideImage,
    LucideFileSpreadsheet,
    LucideFile,
    LucideExternalLink,
    LucideUsers,
    LucideBuilding2,
    LucideLayers,
    LucideBarChart3,
    LucideMoon,
    LucideSun,
  ],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.css'],
})
export class DashboardComponent implements OnInit, OnDestroy {
  private noticesService = inject(NoticesService);
  private authService = inject(AuthService);
  private router = inject(Router);
  private onboardingService = inject(OnboardingService);
  private attendanceService = inject(AttendanceService);
  private leavesService = inject(LeavesService);
  private dashboardService = inject(DashboardService);
  private analyticsMock = inject(DashboardAnalyticsMockService);
  private toast = inject(HotToastService);
  private outsideOffice = inject(OutsideOfficeService);
  private geo = inject(GeolocationService);

  readonly noticeHtml = noticeBodyHtml;
  readonly noticeText = noticeBodyText;

  // ── Information Architecture: Segmented Tabs & Dark Mode ────────────────
  activeTab = signal<DashboardTab>('workspace');
  darkMode = signal<boolean>(false);

  setTab(tab: DashboardTab) {
    this.activeTab.set(tab);
  }

  toggleDarkMode() {
    this.darkMode.set(!this.darkMode());
  }

  // ── Notice board ────────────────────────────────────────────────────────
  notices = signal<Notice[]>([]);
  activeNotice = signal<Notice | null>(null);
  unreadNotices = computed(() => this.notices().filter((n) => !n.isRead));

  private loadNotices() {
    this.noticesService.forDashboard().subscribe({
      next: (list) => this.notices.set(list || []),
      error: () => {},
    });
  }

  openNotice(n: Notice) {
    this.activeNotice.set(n);
  }

  dismissNotice(n: Notice | null) {
    this.activeNotice.set(null);
    if (!n || n.isRead) return;

    this.notices.update((list) =>
      list.map((x) => (x.id === n.id ? { ...x, isRead: true } : x))
    );
    this.noticesService.markRead(n.id).subscribe({ error: () => {} });
  }

  getInitials(first?: string, last?: string): string {
    const f = (first || '').trim()[0] || '';
    const l = (last || '').trim()[0] || '';
    return (f + l).toUpperCase() || 'NB';
  }

  getAvatarBg(first?: string, last?: string): string {
    const str = `${first || ''}${last || ''}`.toLowerCase();
    const colors = [
      'linear-gradient(135deg, #1373e5 0%, #1d4ed8 100%)',
      'linear-gradient(135deg, #059669 0%, #047857 100%)',
      'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)',
      'linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)',
      'linear-gradient(135deg, #ea580c 0%, #c2410c 100%)',
      'linear-gradient(135deg, #0891b2 0%, #0e7490 100%)',
    ];
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  getFileType(
    fileName?: string
  ): 'pdf' | 'image' | 'spreadsheet' | 'doc' | 'other' {
    const ext = (fileName || '').split('.').pop()?.toLowerCase() || '';
    if (ext === 'pdf') return 'pdf';
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext))
      return 'image';
    if (['xlsx', 'xls', 'csv'].includes(ext)) return 'spreadsheet';
    if (['doc', 'docx', 'txt', 'rtf'].includes(ext)) return 'doc';
    return 'other';
  }

  fileSize(bytes?: number | null): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  // ── User, Attendance & Shift Hub ────────────────────────────────────────
  user = signal<any>(null);
  onboardingStatus = signal<string>('COMPLETED');
  onboardingTasks = signal<EmployeeOnboardingTask[]>([]);
  isCompletingTask = signal<number | null>(null);

  todayAttendance = signal<AttendanceRecord | null>(null);
  todayDate = new Date();
  isClocking = signal<boolean>(false);

  currentTime = signal<Date>(new Date());
  private clockInterval: any = null;

  greetingText = computed(() => {
    const hour = this.currentTime().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  });

  formattedTime = computed(() => {
    return this.currentTime().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  });

  /** Standardized date format: "19 Oct 2026" */
  formattedDate = computed(() => {
    return this.formatStandardDate(this.currentTime());
  });

  formattedWeekday = computed(() => {
    return this.currentTime().toLocaleDateString('en-US', { weekday: 'long' });
  });

  workedDuration = computed(() => {
    const att = this.todayAttendance();
    if (!att || !att.clockIn) return '0h 0m';
    const start = new Date(att.clockIn).getTime();
    const end = att.clockOut
      ? new Date(att.clockOut).getTime()
      : this.currentTime().getTime();
    const diffMs = Math.max(0, end - start);
    const hrs = Math.floor(diffMs / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    return `${hrs}h ${mins}m`;
  });

  // ── Role Gating ─────────────────────────────────────────────────────────
  userRole = computed(() => String(this.user()?.role || 'EMPLOYEE').toUpperCase());
  showOrgWidgets = computed(() =>
    ['SUPERADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'].includes(
      this.userRole()
    )
  );
  /** Employee sees only My Workspace; managers/admins/HR see all 3 tabs */
  canSeeTeamAndOrg = computed(() => !this.isEmployee() || this.showOrgWidgets());
  isHR = computed(() => this.userRole() === 'HR');
  isFinance = computed(() => this.userRole() === 'FINANCE');
  isSales = computed(() => this.userRole() === 'SALES');
  isEmployee = computed(() => this.userRole() === 'EMPLOYEE');

  // ── Core Dashboard State ────────────────────────────────────────────────
  dashboard = signal<DashboardPayload | null>(null);
  pendingApprovals = signal<any[]>([]);
  isLoadingMetrics = signal<boolean>(true);
  dashboardError = signal<string | null>(null);

  myPaidLeaveBalance = computed(() =>
    ((this.dashboard()?.common?.myLeaveBalance || []) as any[]).filter(
      (x: any) => x.leaveType?.isPaid !== false
    )
  );

  myLeaveBalanceDays = computed(() => {
    const b = this.myPaidLeaveBalance();
    const total = b.reduce(
      (s: number, x: any) => s + ((x.allocated || 0) - (x.used || 0)),
      0
    );
    return total % 1 !== 0 ? total.toFixed(1) : String(Math.round(total));
  });

  myLeaveUsedTotal = computed(() => {
    const b = this.myPaidLeaveBalance();
    const fmt = (n: number) =>
      n % 1 !== 0 ? n.toFixed(1) : String(Math.round(n));
    const used = b.reduce((s: number, x: any) => s + (x.used || 0), 0);
    const allocated = b.reduce((s: number, x: any) => s + (x.allocated || 0), 0);
    return `${fmt(used)}/${fmt(allocated)}`;
  });

  myLeaveUsageDetail = computed(() => {
    const b = this.myPaidLeaveBalance();
    const fmt = (n: number) =>
      n % 1 !== 0 ? n.toFixed(1) : String(Math.round(n));
    const used = b.reduce((s: number, x: any) => s + (x.used || 0), 0);
    const allocated = b.reduce((s: number, x: any) => s + (x.allocated || 0), 0);
    return `${fmt(used)} of ${fmt(allocated)} days used`;
  });

  // ── "Today at a glance" Collapsed Strip for 0-data Widgets ──────────────
  todayGlanceChips = computed(() => {
    const c = this.dashboard()?.common;
    if (!c) return [];
    const chips: { text: string; tone: 'success' | 'info' | 'neutral' }[] = [];

    if (!c.onLeaveToday?.length) {
      chips.push({ text: 'Full team present (0 on leave)', tone: 'success' });
    } else {
      chips.push({
        text: `${c.onLeaveToday.length} on leave today`,
        tone: 'info',
      });
    }

    if (!c.onWfhToday?.length) {
      chips.push({ text: 'No WFH today', tone: 'neutral' });
    } else {
      chips.push({ text: `${c.onWfhToday.length} working remotely`, tone: 'info' });
    }

    const milestonesCount =
      (c.todayJoinings?.length || 0) + (c.todayAnniversaries?.length || 0);
    if (milestonesCount === 0) {
      chips.push({ text: 'No joinings or anniversaries today', tone: 'neutral' });
    } else {
      chips.push({
        text: `${milestonesCount} celebration${milestonesCount > 1 ? 's' : ''} today`,
        tone: 'success',
      });
    }

    return chips;
  });

  // ── Analytics & Chart Configurations ────────────────────────────────────
  kpiTelemetry = computed(() =>
    this.analyticsMock.getKpiTelemetry(this.dashboard())
  );

  heatmapWeeks = computed(() =>
    this.analyticsMock.getWorkHoursHeatmap12w(this.dashboard())
  );

  leaveGauges = computed(() =>
    this.analyticsMock.getLeaveGauges(this.dashboard())
  );

  projectProgressList = computed(() =>
    this.analyticsMock.getProjectProgressList(this.dashboard())
  );

  teamPresenceBreakdown = computed(() =>
    this.analyticsMock.getTeamPresenceBreakdown(this.dashboard())
  );

  /** Chart 1 (My Workspace, 8-col): Attendance trend (last 30 days, hours/day vs 9h target) */
  attendanceTrendOptions = computed(() => {
    const series = this.analyticsMock.getMyAttendanceTrend30d(this.dashboard());
    return {
      series: [
        {
          name: 'Hours Worked',
          data: series.map((p) => p.hours),
        },
      ],
      chart: {
        type: 'area',
        height: 265,
      },
      colors: ['#1373e5'],
      stroke: {
        curve: 'smooth',
        width: 2.5,
      },
      fill: {
        type: 'gradient',
        gradient: {
          shadeIntensity: 1,
          opacityFrom: 0.32,
          opacityTo: 0.02,
          stops: [0, 95, 100],
        },
      },
      dataLabels: { enabled: false },
      xaxis: {
        categories: series.map((p) => p.label),
        tickAmount: 8,
        labels: {
          style: { colors: '#64748b', fontSize: '11px', fontWeight: 600 },
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        min: 0,
        max: 12,
        tickAmount: 4,
        labels: {
          formatter: (v: number) => `${v}h`,
          style: { colors: '#64748b', fontSize: '11px', fontWeight: 600 },
        },
      },
      annotations: {
        yaxis: [
          {
            y: 9,
            borderColor: '#059669',
            strokeDashArray: 5,
            label: {
              borderColor: '#059669',
              style: {
                color: '#ffffff',
                background: '#059669',
                fontSize: '10.5px',
                fontWeight: 700,
                padding: { left: 6, right: 6, top: 2, bottom: 2 },
              },
              text: '9h Daily Target',
            },
          },
        ],
      },
      tooltip: {
        y: {
          formatter: (val: number) => `${val} hrs logged`,
        },
      },
    };
  });

  /** Chart 2 (My Workspace, 4-col): Task status donut with total in center */
  taskDonutData = computed(() =>
    this.analyticsMock.getTaskStatusDonut(this.dashboard())
  );

  taskDonutOptions = computed(() => {
    const d = this.taskDonutData();
    return {
      series: d.slices.map((s) => s.count),
      labels: d.slices.map((s) => s.label),
      colors: d.slices.map((s) => s.color),
      chart: {
        type: 'donut',
        height: 265,
      },
      stroke: {
        width: 2,
        colors: ['#ffffff'],
      },
      dataLabels: { enabled: false },
      legend: {
        position: 'bottom',
        fontSize: '12px',
        fontWeight: 600,
        labels: { colors: '#475569' },
      },
      plotOptions: {
        pie: {
          donut: {
            size: '70%',
            labels: {
              show: true,
              name: {
                show: true,
                fontSize: '12px',
                fontWeight: 600,
                color: '#64748b',
              },
              value: {
                show: true,
                fontSize: '24px',
                fontWeight: 800,
                color: '#0f172a',
                formatter: (val: string) => val,
              },
              total: {
                show: true,
                showAlways: true,
                label: 'Total Tasks',
                fontSize: '11.5px',
                fontWeight: 700,
                color: '#64748b',
                formatter: () => String(d.total),
              },
            },
          },
        },
      },
    };
  });

  /** Chart 3 (My Workspace): Overdue aging bar (0–7d, 8–30d, 30+ days) */
  overdueBuckets = computed(() =>
    this.analyticsMock.getOverdueAgingBuckets(this.dashboard())
  );

  overdueAgingOptions = computed(() => {
    const buckets = this.overdueBuckets();
    return {
      series: [
        {
          name: 'Overdue Tasks',
          data: buckets.map((b) => b.count),
        },
      ],
      chart: {
        type: 'bar',
        height: 215,
      },
      colors: buckets.map((b) => b.color),
      plotOptions: {
        bar: {
          distributed: true,
          borderRadius: 6,
          columnWidth: '48%',
        },
      },
      dataLabels: {
        enabled: true,
        style: { fontSize: '12px', fontWeight: 800, colors: ['#0f172a'] },
      },
      legend: { show: false },
      xaxis: {
        categories: buckets.map((b) => b.bucket),
        labels: {
          style: { colors: '#475569', fontSize: '11.5px', fontWeight: 700 },
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        allowDecimals: false,
        labels: {
          style: { colors: '#64748b', fontSize: '11px' },
        },
      },
    };
  });

  /** Chart 4 (My Team): Team attendance % line chart, last 8 weeks */
  teamAttendanceOptions = computed(() => {
    const pts = this.analyticsMock.getTeamAttendance8Weeks(this.dashboard());
    return {
      series: [
        {
          name: 'Attendance %',
          data: pts.map((p) => p.attendancePct),
        },
        {
          name: 'On-Time Arrival %',
          data: pts.map((p) => p.onTimePct),
        },
      ],
      chart: {
        type: 'line',
        height: 255,
      },
      colors: ['#1373e5', '#059669'],
      stroke: {
        curve: 'smooth',
        width: [3, 2.5],
        dashArray: [0, 4],
      },
      markers: {
        size: 4,
        hover: { size: 6 },
      },
      xaxis: {
        categories: pts.map((p) => p.week),
        labels: {
          style: { colors: '#64748b', fontSize: '11px', fontWeight: 600 },
        },
      },
      yaxis: {
        min: 70,
        max: 100,
        labels: {
          formatter: (v: number) => `${v}%`,
          style: { colors: '#64748b', fontSize: '11px', fontWeight: 600 },
        },
      },
      legend: {
        position: 'top',
        horizontalAlign: 'right',
        fontSize: '12px',
        fontWeight: 600,
      },
    };
  });

  /** Chart 5 (My Team): Ticket SLA bar chart (open by age + resolved vs raised) */
  ticketSlaOptions = computed(() => {
    const sla = this.analyticsMock.getTicketSlaMetrics(this.dashboard());
    return {
      series: [
        {
          name: 'Tickets Raised',
          data: sla.trend.map((t) => t.raised),
        },
        {
          name: 'Tickets Resolved',
          data: sla.trend.map((t) => t.resolved),
        },
      ],
      chart: {
        type: 'bar',
        height: 210,
      },
      colors: ['#94a3b8', '#059669'],
      plotOptions: {
        bar: {
          borderRadius: 5,
          columnWidth: '55%',
        },
      },
      dataLabels: { enabled: false },
      xaxis: {
        categories: sla.trend.map((t) => t.period),
        labels: {
          style: { colors: '#64748b', fontSize: '11px', fontWeight: 600 },
        },
      },
      yaxis: {
        labels: {
          style: { colors: '#64748b', fontSize: '11px' },
        },
      },
      legend: {
        position: 'top',
        horizontalAlign: 'right',
        fontSize: '11.5px',
        fontWeight: 600,
      },
    };
  });

  ticketSlaBuckets = computed(
    () => this.analyticsMock.getTicketSlaMetrics(this.dashboard()).byAge
  );

  /** Department headcount summary & sorted top-7 + tail grouping */
  deptHeadcountSummary = computed(() => {
    const raw = (this.dashboard()?.org?.headcount?.byDepartment || []).filter(
      (d) => Number(d.count || 0) > 0
    );
    const fallback = [
      { name: 'Information Technology', count: 49 },
      { name: 'IT Support', count: 13 },
      { name: 'Software Development', count: 10 },
      { name: 'Executive', count: 6 },
      { name: 'Operations', count: 6 },
      { name: 'Sales', count: 5 },
      { name: 'Finance', count: 2 },
    ];
    const sorted = [...(raw.length > 0 ? raw : fallback)].sort(
      (a, b) => Number(b.count || 0) - Number(a.count || 0)
    );
    const totalEmployees =
      this.dashboard()?.org?.headcount?.total ||
      sorted.reduce((sum, d) => sum + Number(d.count || 0), 0) ||
      1;

    const topItems = sorted.slice(0, 7);
    const tailItems = sorted.slice(7);
    const tailCount = tailItems.reduce((sum, d) => sum + Number(d.count || 0), 0);

    const chartRows = [...topItems];
    if (tailItems.length > 0 && tailCount > 0) {
      chartRows.push({
        name: `Other (${tailItems.length} depts)`,
        count: tailCount,
      });
    }

    const largest = sorted[0] || { name: 'Engineering', count: 0 };
    const avgSize =
      sorted.length > 0 ? (totalEmployees / sorted.length).toFixed(1) : '0';

    return {
      totalDepts: sorted.length,
      totalEmployees,
      largestName: largest.name,
      largestCount: largest.count,
      avgSize,
      chartRows,
    };
  });

  /** Chart 6 (Organization): Headcount by department bar chart */
  deptHeadcountOptions = computed(() => {
    const summary = this.deptHeadcountSummary();
    const list = summary.chartRows;
    const total = Math.max(1, summary.totalEmployees);
    const maxVal = Math.max(...list.map((d) => d.count), 10);
    const palette = [
      '#1373e5',
      '#4f46e5',
      '#0891b2',
      '#059669',
      '#7c3aed',
      '#d97706',
      '#ea580c',
      '#64748b',
    ];

    return {
      series: [
        {
          name: 'Employees',
          data: list.map((d) => d.count),
        },
      ],
      chart: {
        type: 'bar',
        height: 280,
      },
      colors: list.map((_, idx) => palette[idx % palette.length]),
      plotOptions: {
        bar: {
          horizontal: true,
          distributed: true,
          borderRadius: 6,
          borderRadiusApplication: 'end',
          barHeight: '62%',
          dataLabels: {
            position: 'top',
          },
        },
      },
      dataLabels: {
        enabled: true,
        textAnchor: 'start',
        offsetX: 6,
        style: {
          fontSize: '11.5px',
          fontWeight: 800,
          colors: ['#0f172a'],
        },
        formatter: (val: number) => {
          const pct = Math.round((Number(val || 0) / total) * 100);
          return `${val} (${pct}%)`;
        },
      },
      legend: { show: false },
      grid: {
        xaxis: { lines: { show: true } },
        yaxis: { lines: { show: false } },
        padding: { right: 42, left: 4, top: -6, bottom: -4 },
      },
      xaxis: {
        categories: list.map((d) => d.name),
        max: Math.ceil(maxVal * 1.24),
        labels: {
          style: { colors: '#64748b', fontSize: '11px', fontWeight: 600 },
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: {
          maxWidth: 165,
          style: { colors: '#1e293b', fontSize: '12px', fontWeight: 700 },
        },
      },
      tooltip: {
        y: {
          formatter: (val: number) => {
            const pct = ((Number(val || 0) / total) * 100).toFixed(1);
            return `${val} employees (${pct}% of workforce)`;
          },
        },
      },
    };
  });

  joiningsExitsSummary = computed(() => {
    const pts = this.analyticsMock.getJoiningsVsExits6m(this.dashboard());
    const totalJoinings = pts.reduce((s, p) => s + p.joinings, 0);
    const totalExits = pts.reduce((s, p) => s + p.exits, 0);
    const net = totalJoinings - totalExits;
    return { totalJoinings, totalExits, net };
  });

  /** Chart 7 (Organization): Joinings vs exits dual bar chart (last 6 months) */
  joiningsExitsOptions = computed(() => {
    const pts = this.analyticsMock.getJoiningsVsExits6m(this.dashboard());
    return {
      series: [
        {
          name: 'New Joinings',
          data: pts.map((p) => p.joinings),
        },
        {
          name: 'Exits / Attrition',
          data: pts.map((p) => p.exits),
        },
      ],
      chart: {
        type: 'bar',
        height: 280,
      },
      colors: ['#059669', '#dc2626'],
      plotOptions: {
        bar: {
          borderRadius: 6,
          columnWidth: '50%',
        },
      },
      dataLabels: { enabled: false },
      xaxis: {
        categories: pts.map((p) => p.month),
        labels: {
          style: { colors: '#64748b', fontSize: '11px', fontWeight: 600 },
        },
      },
      yaxis: {
        allowDecimals: false,
        labels: {
          style: { colors: '#64748b', fontSize: '11px' },
        },
      },
      legend: {
        position: 'top',
        horizontalAlign: 'right',
        fontSize: '12px',
        fontWeight: 600,
      },
    };
  });

  // ── Priority Tasks Table: Sorting + Overdue Badge + Max 5 Rows ──────────
  taskSortCol = signal<TaskSortColumn>('dueDate');
  taskSortDir = signal<'asc' | 'desc'>('asc');

  toggleTaskSort(col: TaskSortColumn) {
    if (this.taskSortCol() === col) {
      this.taskSortDir.set(this.taskSortDir() === 'asc' ? 'desc' : 'asc');
    } else {
      this.taskSortCol.set(col);
      this.taskSortDir.set('asc');
    }
  }

  sortedPriorityTasks = computed(() => {
    const tasks = [...(this.dashboard()?.common?.myTasks || [])];
    const col = this.taskSortCol();
    const dir = this.taskSortDir() === 'asc' ? 1 : -1;
    const prioRank: Record<string, number> = {
      URGENT: 4,
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1,
    };

    tasks.sort((a, b) => {
      if (col === 'title') {
        return a.title.localeCompare(b.title) * dir;
      }
      if (col === 'priority') {
        const rA = prioRank[String(a.priority || '').toUpperCase()] || 0;
        const rB = prioRank[String(b.priority || '').toUpperCase()] || 0;
        return (rB - rA) * dir;
      }
      if (col === 'status') {
        return String(a.status || '').localeCompare(String(b.status || '')) * dir;
      }
      const dA = a.dueDate ? new Date(a.dueDate).getTime() : 9999999999999;
      const dB = b.dueDate ? new Date(b.dueDate).getTime() : 9999999999999;
      return (dA - dB) * dir;
    });

    return tasks.slice(0, 5);
  });

  overdueDaysCount(due: string | null | undefined): number {
    if (!due) return 0;
    const target = new Date(due);
    target.setHours(0, 0, 0, 0);
    const now = new Date(this.todayDate);
    now.setHours(0, 0, 0, 0);
    const diff = Math.floor((now.getTime() - target.getTime()) / 86400000);
    return Math.max(0, diff);
  }

  isOverdue(due: string | null | undefined): boolean {
    return this.overdueDaysCount(due) > 0;
  }

  // ── Pending Leave Approvals: Bulk Selection & Actions ───────────────────
  selectedApprovalIds = signal<Set<number>>(new Set());
  isBulkApproving = signal<boolean>(false);

  decidableApprovals = computed(() =>
    this.pendingApprovals().filter((req) => this.canDecideLeave(req))
  );

  allApprovalsSelected = computed(() => {
    const decidable = this.decidableApprovals();
    if (!decidable.length) return false;
    const sel = this.selectedApprovalIds();
    return decidable.every((r) => sel.has(r.id));
  });

  toggleApprovalSelection(id: number) {
    const next = new Set(this.selectedApprovalIds());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selectedApprovalIds.set(next);
  }

  toggleAllApprovals() {
    const decidable = this.decidableApprovals();
    if (this.allApprovalsSelected()) {
      this.selectedApprovalIds.set(new Set());
    } else {
      this.selectedApprovalIds.set(new Set(decidable.map((r) => r.id)));
    }
  }

  bulkApproveLeaves() {
    const ids = Array.from(this.selectedApprovalIds());
    if (!ids.length || this.isBulkApproving()) return;

    this.isBulkApproving.set(true);
    const calls = ids.map((id) =>
      this.leavesService
        .updateRequestStatus(id, 'APPROVED')
        .pipe(catchError(() => of(null)))
    );

    forkJoin(calls).subscribe({
      next: () => {
        this.toast.success(
          `Approved ${ids.length} leave request${ids.length > 1 ? 's' : ''}!`
        );
        const approvedSet = new Set(ids);
        this.pendingApprovals.update((list) =>
          list.filter((r) => !approvedSet.has(r.id))
        );
        this.selectedApprovalIds.set(new Set());
        this.isBulkApproving.set(false);
      },
      error: () => {
        this.toast.error('Failed to complete bulk approval');
        this.isBulkApproving.set(false);
      },
    });
  }

  // ── Standardized Formatting & TrackBy Helpers ───────────────────────────
  formatStandardDate(input: string | Date | null | undefined): string {
    return this.analyticsMock.formatStandardDate(input);
  }

  formatRelativeTime(input: string | Date | null | undefined): string {
    return this.analyticsMock.formatRelativeTime(input, this.currentTime());
  }

  leaveDurationLabel(req: any): string {
    if (req?.isHalfDay) return '0.5 day (Half Day)';
    const explicit = Number(req?.totalDays ?? req?.days ?? 0);
    if (explicit > 0) return `${explicit} ${explicit === 1 ? 'day' : 'days'}`;
    if (req?.startDate && req?.endDate) {
      const s = new Date(req.startDate);
      const e = new Date(req.endDate);
      s.setHours(0, 0, 0, 0);
      e.setHours(0, 0, 0, 0);
      const diff = Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
      return `${diff} ${diff === 1 ? 'day' : 'days'}`;
    }
    return '1 day';
  }

  anyTodayMilestones(): boolean {
    const c = this.dashboard()?.common;
    return !!(
      (c?.todayJoinings?.length || 0) + (c?.todayAnniversaries?.length || 0)
    );
  }

  minutesToHm(mins: number) {
    if (!mins) return '0m';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
  }

  todayKey = computed(() => {
    const d = this.currentTime();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  daysUntil(date: string | null | undefined) {
    if (!date) return 0;
    // Holidays arrive as full timestamps, birthdays as plain days: use the day part.
    const target = new Date(String(date).slice(0, 10) + 'T00:00:00');
    return Math.max(
      0,
      Math.round((target.getTime() - this.todayDate.getTime()) / 86400000)
    );
  }

  appreciationAwardColor(c: string) {
    const colors: Record<string, string> = {
      orange: '#ea580c',
      purple: '#7c3aed',
      blue: '#1373e5',
      green: '#059669',
      red: '#dc2626',
      yellow: '#d97706',
    };
    return colors[c] || '#64748b';
  }

  trackById = (_: number, item: { id: any }) => item.id;
  trackByIndex = (idx: number) => idx;

  // ── Lifecycle & Actions ─────────────────────────────────────────────────
  ngOnInit() {
    this.loadNotices();

    this.clockInterval = setInterval(() => {
      this.currentTime.set(new Date());
    }, 1000);

    this.authService.getMe().subscribe({
      next: (user) => {
        if (!user.company?.onboardingCompleted) {
          this.router.navigate(['/onboarding']);
          return;
        }
        this.user.set(user);
        this.loadOnboardingTasks();
        this.loadAttendance();
        this.loadDashboard();
      },
      error: () => {
        this.authService.logout();
        this.router.navigate(['/']);
      },
    });
  }

  ngOnDestroy() {
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
      this.clockInterval = null;
    }
  }

  loadDashboard() {
    this.isLoadingMetrics.set(true);
    this.dashboardError.set(null);
    this.dashboardService.getDashboard().subscribe({
      next: (payload) => {
        this.dashboard.set(payload);
        this.pendingApprovals.set(payload.org?.pendingLeaveApprovals || []);
      },
      error: () => {
        this.dashboardError.set('Unable to load latest dashboard telemetry.');
        this.toast.error('Failed to load dashboard data');
        this.isLoadingMetrics.set(false);
      },
      complete: () => this.isLoadingMetrics.set(false),
    });
  }

  loadOnboardingTasks() {
    this.onboardingService.getMyTasks().subscribe({
      next: (res) => {
        this.onboardingStatus.set(res.status);
        this.onboardingTasks.set(res.tasks);
      },
    });
  }

  getCompletedCount(): number {
    return this.onboardingTasks().filter((t) => t.isCompleted).length;
  }

  getProgressPercentage(): number {
    const tasks = this.onboardingTasks();
    if (!tasks.length) return 0;
    return Math.round((this.getCompletedCount() / tasks.length) * 100);
  }

  completeTask(task: EmployeeOnboardingTask) {
    if (task.isCompleted || this.isCompletingTask() !== null) return;

    this.isCompletingTask.set(task.id);
    this.onboardingService.completeTask(task.id).subscribe({
      next: (res) => {
        this.toast.success('Task marked as complete!');
        this.isCompletingTask.set(null);

        const tasks = [...this.onboardingTasks()];
        const idx = tasks.findIndex((t) => t.id === task.id);
        if (idx !== -1) {
          tasks[idx].isCompleted = true;
          this.onboardingTasks.set(tasks);
        }

        this.onboardingStatus.set(res.newStatus);

        if (res.newStatus === 'COMPLETED') {
          this.toast.success('All onboarding tasks completed!', {
            duration: 5000,
          });
        }
      },
      error: () => {
        this.toast.error('Failed to complete task');
        this.isCompletingTask.set(null);
      },
    });
  }

  loadAttendance() {
    this.attendanceService.getTodayAttendance().subscribe({
      next: (res: any) => this.todayAttendance.set(res),
    });
  }

  clockInOut() {
    this.isClocking.set(true);
    const attendance = this.todayAttendance();
    const action = !attendance || !attendance.clockIn ? 'clockIn' : 'clockOut';

    void this.geo
      .locateForClock()
      .then(({ lat, lng }) => this.executeClockAction(action, lat, lng));
  }

  private executeClockAction(
    action: 'clockIn' | 'clockOut',
    lat?: number,
    lng?: number,
    outside?: OutsideOfficeAnswer
  ) {
    const sub =
      action === 'clockIn'
        ? this.attendanceService.clockIn(
            lat,
            lng,
            outside?.reason,
            outside?.proofUrl
          )
        : this.attendanceService.clockOut(
            lat,
            lng,
            undefined,
            undefined,
            outside?.reason,
            outside?.proofUrl
          );

    sub.subscribe({
      next: (res) => {
        this.toast.success(
          `Successfully ${action === 'clockIn' ? 'Clocked In' : 'Clocked Out'}!` +
            (outside ? ' Sent for admin review (outside office).' : '')
        );
        this.todayAttendance.set(res);
        this.isClocking.set(false);
      },
      error: (err) => {
        if (this.outsideOffice.isOutsideOffice(err)) {
          this.isClocking.set(false);
          void this.outsideOffice.ask(err).then((ans) => {
            if (!ans) return;
            this.isClocking.set(true);
            this.executeClockAction(action, lat, lng, ans);
          });
          return;
        }
        this.toast.error(err.error?.message || 'Failed to clock action');
        this.isClocking.set(false);
      },
    });
  }

  canDecideLeave(req: any): boolean {
    const me = this.authService.currentUser();
    if (me?.role === 'SUPERADMIN' || me?.role === 'SUPER_ADMIN') return true;
    const myEmail = String(me?.email || '').toLowerCase();
    return (
      !myEmail ||
      String(req?.employee?.user?.email || '').toLowerCase() !== myEmail
    );
  }

  approveLeave(reqId: number) {
    this.leavesService.updateRequestStatus(reqId, 'APPROVED').subscribe({
      next: () => {
        this.toast.success('Leave request approved!');
        this.pendingApprovals.update((list) =>
          list.filter((r) => r.id !== reqId)
        );
        const sel = new Set(this.selectedApprovalIds());
        sel.delete(reqId);
        this.selectedApprovalIds.set(sel);
      },
      error: () => this.toast.error('Failed to approve request'),
    });
  }

  rejectLeave(reqId: number) {
    this.leavesService
      .updateRequestStatus(
        reqId,
        'REJECTED',
        'Not feasible for project timeline'
      )
      .subscribe({
        next: () => {
          this.toast.success('Leave request rejected');
          this.pendingApprovals.update((list) =>
            list.filter((r) => r.id !== reqId)
          );
          const sel = new Set(this.selectedApprovalIds());
          sel.delete(reqId);
          this.selectedApprovalIds.set(sel);
        },
        error: () => this.toast.error('Failed to reject request'),
      });
  }
}
