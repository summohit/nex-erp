import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucideChevronLeft, LucideChevronRight, LucideClock, LucideUser, LucideUsers,
  LucideBuilding2, LucideCoins, LucideCheck, LucideX, LucideSend, LucideFilter,
  LucideChevronDown, LucideAlertTriangle, LucideTimer, LucidePencilLine,
  LucideCalendarDays, LucideLoader2, LucideRotateCcw, LucideInfo,
  LucideCheckCircle2, LucideAlertCircle, LucideBriefcase, LucideTag,
  LucideCalendar, LucideFileText, LucideHourglass, LucideSearch,
} from '@lucide/angular';
import {
  TimesheetsService, TimesheetScope, TimesheetWeek, TimesheetOverview,
  TimesheetDay, TimesheetFilters, TimesheetStatus, OverviewRow, TimesheetEntry,
} from '../services/timesheets';
import { AuthService } from '../services/auth.service';
import { EmployeeService } from '../services/employee.service';
import { ProjectsService } from '../services/projects';
import { ClientsService } from '../services/clients';
import { MasterDataService } from '../services/master-data.service';

/**
 * The Timesheet (§20–§22) — the central time-management screen.
 *
 * ── Why one screen and not four ──────────────────────────────────────────
 * §21 asks for an Employee view, a PM view, an Admin view and a Finance view.
 * They are the same table of the same week over a different set of people, so
 * they are one screen with a scope switch. Four routes would have meant four
 * copies of the week navigator, the filters and the approval buttons, and the
 * fourth copy is always the one that stops matching the other three.
 *
 * ── The number the screen exists for ─────────────────────────────────────
 * Unlogged. Logged hours alone say nothing about whether a day is accounted
 * for; an eight-hour day with two hours booked is what a manager needs to see,
 * and that is only visible as the gap between login and logged.
 *
 * ── Nothing is recomputed here ───────────────────────────────────────────
 * Hours, statuses and cost all arrive reconciled. The one thing this component
 * decides for itself is which scope tabs to offer, and the server refuses a
 * scope the caller may not have anyway.
 */
@Component({
  selector: 'app-timesheets',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    LucideChevronLeft, LucideChevronRight, LucideClock, LucideUser, LucideUsers,
    LucideBuilding2, LucideCoins, LucideCheck, LucideX, LucideSend, LucideFilter,
    LucideChevronDown, LucideAlertTriangle, LucideTimer, LucidePencilLine,
    LucideCalendarDays, LucideLoader2, LucideRotateCcw, LucideInfo,
    LucideCheckCircle2, LucideAlertCircle, LucideBriefcase, LucideTag,
    LucideCalendar, LucideFileText, LucideHourglass, LucideSearch,
  ],
  templateUrl: './timesheets.html',
  styleUrls: ['./timesheets.css'],
})
export class TimesheetsComponent implements OnInit {
  private api = inject(TimesheetsService);
  private auth = inject(AuthService);
  private employeeService = inject(EmployeeService);
  private projectsService = inject(ProjectsService);
  private clientsService = inject(ClientsService);
  private masterData = inject(MasterDataService);
  private toast = inject(HotToastService);
  private router = inject(Router);

  // ── Scope ──────────────────────────────────────────────────────────────

  scope = signal<TimesheetScope>('ME');

  private role = computed(() => this.auth.currentUser()?.role ?? 'EMPLOYEE');
  private isPm = computed(() => !!this.auth.currentUser()?.employee?.isProjectManager);

  /**
   * Which tabs this person gets. The server enforces the same rule and 403s
   * regardless — this only decides what is worth showing, so that a tab is
   * never offered that opens onto an error.
   */
  scopes = computed(() => {
    const role = this.role();
    const admin = role === 'SUPERADMIN' || role === 'ADMIN';
    const tabs: { key: TimesheetScope; label: string; icon: string }[] = [
      { key: 'ME', label: 'My Timesheet', icon: 'user' },
    ];
    if (admin || this.isPm()) tabs.push({ key: 'TEAM', label: 'My Team', icon: 'users' });
    if (admin) tabs.push({ key: 'ALL', label: 'All Employees', icon: 'building' });
    if (admin || role === 'FINANCE') tabs.push({ key: 'FINANCE', label: 'Cost Hours', icon: 'coins' });
    return tabs;
  });

  // ── The week ───────────────────────────────────────────────────────────

  weekStart = signal<Date>(this.mondayOf(new Date()));

  /**
   * How many days the screen shows. A week by default, because a timesheet is
   * submitted and reviewed weekly — but §21 asks for a date range, and "how
   * did last quarter actually go" is a question the same table answers.
   */
  rangeDays = signal<number>(7);
  customEndDate = signal<Date | null>(null);
  durationDropdownOpen = signal<boolean>(false);
  selectedDuration = signal<string>('This Week');
  customFromDate = signal<string>('');
  customToDate = signal<string>('');
  tableSearchQuery = signal<string>('');

  calMonth1 = signal<Date>(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  calMonth2 = computed(() => {
    const m = this.calMonth1();
    return new Date(m.getFullYear(), m.getMonth() + 1, 1);
  });
  pickerStart = signal<Date | null>(new Date());
  pickerEnd = signal<Date | null>(new Date());

  readonly DOW_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  daysMonth1 = computed(() => this.getCalendarDays(this.calMonth1()));
  daysMonth2 = computed(() => this.getCalendarDays(this.calMonth2()));

  pickerFormattedRange = computed(() => {
    const s = this.pickerStart();
    const e = this.pickerEnd();
    if (!s) return '01-01-2026 To 01-01-2026';
    const fmt = (d: Date) => {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}-${month}-${year}`;
    };
    if (!e) return `${fmt(s)} To ${fmt(s)}`;
    const minD = s < e ? s : e;
    const maxD = s < e ? e : s;
    return `${fmt(minD)} To ${fmt(maxD)}`;
  });

  readonly DURATION_OPTIONS = [
    'Today',
    'Last 30 Days',
    'This Month',
    'Last Month',
    'Last 90 Days',
    'Last 6 Months',
    'Last 1 Year',
    'Custom Range',
  ] as const;

  weekEnd = computed(() => {
    if (this.customEndDate()) {
      return this.customEndDate()!;
    }
    const d = new Date(this.weekStart());
    d.setDate(d.getDate() + this.rangeDays() - 1);
    return d;
  });

  /** The grid gets a column per day, so it only stays readable for a week. */
  showDayColumns = computed(() => {
    const s = this.weekStart().getTime();
    const e = this.weekEnd().getTime();
    const days = Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1;
    return days <= 7;
  });

  weekDays = computed(() => {
    if (!this.showDayColumns()) return [];
    const out: { date: Date; key: string; isToday: boolean }[] = [];
    const todayKey = this.dayKey(new Date());
    const s = new Date(this.weekStart());
    const e = new Date(this.weekEnd());
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      const cur = new Date(d);
      const key = this.dayKey(cur);
      out.push({ date: cur, key, isToday: key === todayKey });
    }
    return out;
  });

  durationDateText = computed(() => {
    const s = this.weekStart();
    const e = this.weekEnd();
    if (!s || !e) return 'Start Date To End Date';
    const fmt = (d: Date) => {
      const day = String(d.getDate()).padStart(2, '0');
      const month = d.toLocaleString('en-US', { month: 'short' });
      const year = d.getFullYear();
      return `${day} ${month} ${year}`;
    };
    return `${fmt(s)} To ${fmt(e)}`;
  });

  isCurrentWeek = computed(
    () => !this.customEndDate() && this.dayKey(this.weekStart()) === this.dayKey(this.mondayOf(new Date())),
  );

  // ── Data ───────────────────────────────────────────────────────────────

  myWeek = signal<TimesheetWeek | null>(null);
  overview = signal<TimesheetOverview | null>(null);
  loading = signal(false);

  /** The day whose entries are open in My Timesheet. */
  expandedDay = signal<string | null>(null);
  /** The person whose week is open in a team view, and their week. */
  expandedEmployee = signal<number | null>(null);
  expandedWeek = signal<TimesheetWeek | null>(null);
  expandedLoading = signal(false);

  /**
   * The entry open in the detail modal, with the day and person it belongs to.
   * Held rather than looked up again: the modal outlives a refresh of the list
   * behind it, and re-deriving it would empty the modal mid-read.
   */
  openEntry = signal<{ entry: TimesheetEntry; date: string; who: string } | null>(null);

  /** The "what the marks mean" panel. */
  legendOpen = signal(false);

  /** Day keys with a request in flight, so a button can't be pressed twice. */
  busyDays = signal<Set<string>>(new Set());

  // ── Filters (§21) ──────────────────────────────────────────────────────

  filtersOpen = signal(false);
  fEmployee = signal<string>('ALL');
  fProject = signal<string>('ALL');
  fClient = signal<string>('ALL');
  fDepartment = signal<string>('ALL');
  fPm = signal<string>('ALL');
  fSource = signal<string>('ALL');
  fStatus = signal<string>('ALL');
  fTask = signal<string>('');
  fBillable = signal<string>('ALL');

  employees = signal<any[]>([]);
  projects = signal<any[]>([]);
  clients = signal<any[]>([]);
  departments = signal<any[]>([]);

  // Searchable filter dropdown states
  fEmployeeDropdownOpen = signal<boolean>(false);
  fEmployeeSearchQuery = signal<string>('');
  fProjectDropdownOpen = signal<boolean>(false);
  fProjectSearchQuery = signal<string>('');

  projectManagers = computed(() => this.employees().filter((e) => e.isProjectManager));

  activeFilterCount = computed(
    () =>
      [this.fEmployee(), this.fProject(), this.fClient(), this.fDepartment(),
       this.fPm(), this.fSource(), this.fStatus(), this.fBillable()]
        .filter((v) => v !== 'ALL').length + (this.fTask().trim() ? 1 : 0),
  );

  readonly STATUS_OPTIONS: { value: TimesheetStatus; label: string }[] = [
    { value: 'NOT_SUBMITTED', label: 'Not submitted' },
    { value: 'SUBMITTED', label: 'Pending approval' },
    { value: 'APPROVED', label: 'Approved' },
    { value: 'REJECTED', label: 'Rejected' },
  ];

  filteredEmployees = computed(() => {
    const q = this.fEmployeeSearchQuery().toLowerCase().trim();
    const list = this.employees();
    if (!q) return list;
    return list.filter((e) => {
      const name = this.fullName(e).toLowerCase();
      const email = (e.email || e.user?.email || '').toLowerCase();
      const dept = (e.department?.name || '').toLowerCase();
      return name.includes(q) || email.includes(q) || dept.includes(q);
    });
  });

  filteredProjects = computed(() => {
    const q = this.fProjectSearchQuery().toLowerCase().trim();
    const list = this.projects();
    if (!q) return list;
    return list.filter((p) => {
      const name = (p.name || '').toLowerCase();
      const code = (p.projectCode || p.code || '').toLowerCase();
      return name.includes(q) || code.includes(q);
    });
  });

  filteredTableEmployees = computed(() => {
    const data = this.overview();
    if (!data || !data.employees) return [];
    const q = this.tableSearchQuery().toLowerCase().trim();
    if (!q) return data.employees;
    return data.employees.filter((row) => {
      const name = this.fullName(row.employee).toLowerCase();
      const code = (row.employee.employeeCode || '').toLowerCase();
      const dept = (row.employee.department?.name || '').toLowerCase();
      const email = ((row.employee as any).email || (row.employee as any).user?.email || '').toLowerCase();
      return name.includes(q) || code.includes(q) || dept.includes(q) || email.includes(q);
    });
  });

  tableTotals = computed(() => {
    const list = this.filteredTableEmployees();
    let loginHours = 0;
    let loggedHours = 0;
    let unloggedHours = 0;
    let cost = 0;
    let unratedHours = 0;
    for (const r of list) {
      loginHours += r.totals.loginHours || 0;
      loggedHours += r.totals.loggedHours || 0;
      unloggedHours += r.totals.unloggedHours || 0;
      if (r.cost?.amount != null) {
        cost += r.cost.amount;
      } else if (r.totals.loggedHours > 0) {
        unratedHours += r.totals.loggedHours;
      }
    }
    return { loginHours, loggedHours, unloggedHours, cost, unratedHours };
  });

  selectedEmployee = computed(() => {
    const id = this.fEmployee();
    if (id === 'ALL') return null;
    return this.employees().find((e) => String(e.id) === String(id)) || null;
  });

  selectedProject = computed(() => {
    const id = this.fProject();
    if (id === 'ALL') return null;
    return this.projects().find((p) => String(p.id) === String(id)) || null;
  });

  selectEmployee(id: string) {
    this.fEmployee.set(id);
    this.fEmployeeDropdownOpen.set(false);
  }

  selectProject(id: string) {
    this.fProject.set(id);
    this.fProjectDropdownOpen.set(false);
  }

  closeFilterDropdowns() {
    this.closeAllDropdowns();
  }

  goToTask(issueKey: string) {
    this.closeEntry();
    this.router.navigate(['/tasks'], { queryParams: { search: issueKey } });
  }

  ngOnInit() {
    this.load();
  }

  // ── Loading ────────────────────────────────────────────────────────────

  load() {
    const start = this.dayKey(this.weekStart());
    const end = this.dayKey(this.weekEnd());
    this.loading.set(true);
    this.collapseAll();

    if (this.scope() === 'ME') {
      this.api.getMyWeek(start, end).subscribe({
        next: (w) => { this.myWeek.set(w); this.loading.set(false); },
        error: (e) => { this.loading.set(false); this.fail(e, 'Could not load your timesheet.'); },
      });
      return;
    }

    this.ensureLookups();
    this.api.getOverview(this.scope(), start, end, this.currentFilters()).subscribe({
      next: (o) => { this.overview.set(o); this.loading.set(false); },
      error: (e) => { this.loading.set(false); this.fail(e, 'Could not load the timesheet.'); },
    });
  }

  private currentFilters(): TimesheetFilters {
    const num = (v: string) => (v === 'ALL' ? null : Number(v));
    return {
      task: this.fTask().trim() || null,
      billable: this.fBillable() === 'ALL' ? null : (this.fBillable() as 'BILLABLE' | 'NON_BILLABLE'),
      employeeId: num(this.fEmployee()),
      projectId: num(this.fProject()),
      clientId: num(this.fClient()),
      departmentId: num(this.fDepartment()),
      pmId: num(this.fPm()),
      source: this.fSource() === 'ALL' ? null : (this.fSource() as 'MANUAL' | 'TIMER'),
      status: this.fStatus() === 'ALL' ? null : (this.fStatus() as TimesheetStatus),
    };
  }

  /** Filter dropdowns are fetched once, and only for a view that has them. */
  private ensureLookups() {
    if (this.employees().length) return;
    this.employeeService.getEmployees().subscribe({ next: (e) => this.employees.set(e || []) });
    this.projectsService.getProjects().subscribe({ next: (p) => this.projects.set(p || []) });
    this.clientsService.getClients().subscribe({ next: (c) => this.clients.set(c || []) });
    this.masterData.getDepartments(true).subscribe({ next: (d) => this.departments.set(d || []) });
  }

  setScope(scope: TimesheetScope) {
    if (scope === this.scope()) return;
    this.scope.set(scope);
    this.load();
  }

  previousWeek() { this.shiftWeek(-this.rangeDays()); }
  nextWeek() { this.shiftWeek(this.rangeDays()); }

  thisWeek() {
    this.customEndDate.set(null);
    this.selectedDuration.set('This Week');
    this.weekStart.set(this.mondayOf(new Date()));
    this.rangeDays.set(7);
    this.load();
  }

  /**
   * Week, fortnight, month or quarter, anchored so the range ends today rather
   * than starting today — the question is always about work already done.
   */
  setRange(days: number) {
    this.customEndDate.set(null);
    this.rangeDays.set(days);
    if (days === 7) {
      this.selectedDuration.set('This Week');
      this.weekStart.set(this.mondayOf(new Date()));
    } else {
      this.selectedDuration.set(`Last ${days} Days`);
      const start = new Date();
      start.setDate(start.getDate() - (days - 1));
      start.setHours(0, 0, 0, 0);
      this.weekStart.set(start);
    }
    this.load();
  }

  readonly RANGES = [
    { days: 7, label: 'Week' },
    { days: 14, label: '2 weeks' },
    { days: 30, label: '30 days' },
    { days: 90, label: '90 days' },
  ];

  toggleDurationDropdown() {
    if (!this.durationDropdownOpen()) {
      const s = this.weekStart();
      const e = this.weekEnd();
      this.pickerStart.set(s);
      this.pickerEnd.set(e);
      this.calMonth1.set(new Date(s.getFullYear(), s.getMonth(), 1));
      this.durationDropdownOpen.set(true);
    } else {
      this.durationDropdownOpen.set(false);
    }
  }

  monthName(d: Date): string {
    return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  }

  prevMonth() {
    const m = new Date(this.calMonth1());
    m.setMonth(m.getMonth() - 1);
    this.calMonth1.set(m);
  }

  nextMonth() {
    const m = new Date(this.calMonth1());
    m.setMonth(m.getMonth() + 1);
    this.calMonth1.set(m);
  }

  prevMonth2() {
    this.prevMonth();
  }

  nextMonth2() {
    this.nextMonth();
  }

  selectPreset(preset: string) {
    this.selectedDuration.set(preset);
    if (preset === 'Custom Range') {
      return;
    }

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    let start: Date;
    let end: Date;

    if (preset === 'Today') {
      start = new Date(now);
      end = new Date(now);
    } else if (preset === 'Last 30 Days') {
      start = new Date(now);
      start.setDate(start.getDate() - 29);
      end = new Date(now);
    } else if (preset === 'This Month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    } else if (preset === 'Last Month') {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0);
    } else if (preset === 'Last 90 Days') {
      start = new Date(now);
      start.setDate(start.getDate() - 89);
      end = new Date(now);
    } else if (preset === 'Last 6 Months') {
      start = new Date(now);
      start.setMonth(start.getMonth() - 6);
      end = new Date(now);
    } else if (preset === 'Last 1 Year') {
      start = new Date(now);
      start.setFullYear(start.getFullYear() - 1);
      end = new Date(now);
    } else {
      start = this.mondayOf(now);
      end = new Date(start);
      end.setDate(end.getDate() + 6);
    }

    this.pickerStart.set(start);
    this.pickerEnd.set(end);
    this.calMonth1.set(new Date(start.getFullYear(), start.getMonth(), 1));
  }

  onDayClick(day: { date: Date; dateKey: string; isCurrentMonth: boolean }) {
    const clicked = new Date(day.date);
    clicked.setHours(0, 0, 0, 0);

    if (!this.pickerStart() || (this.pickerStart() && this.pickerEnd())) {
      this.pickerStart.set(clicked);
      this.pickerEnd.set(null);
      this.selectedDuration.set('Custom Range');
    } else {
      const s = this.pickerStart()!;
      if (clicked < s) {
        this.pickerStart.set(clicked);
        this.pickerEnd.set(s);
      } else {
        this.pickerEnd.set(clicked);
      }
      this.selectedDuration.set('Custom Range');
    }
  }

  isStartDate(d: Date): boolean {
    if (!this.pickerStart()) return false;
    return this.dayKey(d) === this.dayKey(this.pickerStart()!);
  }

  isEndDate(d: Date): boolean {
    if (!this.pickerEnd()) return false;
    return this.dayKey(d) === this.dayKey(this.pickerEnd()!);
  }

  isInRange(d: Date): boolean {
    const s = this.pickerStart();
    const e = this.pickerEnd();
    if (!s || !e) return false;
    const k = this.dayKey(d);
    const sk = this.dayKey(s);
    const ek = this.dayKey(e);
    const minK = sk < ek ? sk : ek;
    const maxK = sk < ek ? ek : sk;
    return k > minK && k < maxK;
  }

  getCalendarDays(monthDate: Date): { date: Date; dayNumber: number; isCurrentMonth: boolean; dateKey: string }[] {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const startDow = (firstDay.getDay() + 6) % 7; // Mon = 0, Sun = 6

    const days: { date: Date; dayNumber: number; isCurrentMonth: boolean; dateKey: string }[] = [];
    const cur = new Date(year, month, 1 - startDow);
    for (let i = 0; i < 42; i++) {
      days.push({
        date: new Date(cur),
        dayNumber: cur.getDate(),
        isCurrentMonth: cur.getMonth() === month,
        dateKey: this.dayKey(cur),
      });
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  }

  applyCustomRange() {
    const s = this.pickerStart();
    const e = this.pickerEnd() || s;
    if (!s || !e) return;

    const start = s < e ? s : e;
    const end = s < e ? e : s;

    this.weekStart.set(start);
    this.customEndDate.set(end);
    const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    this.rangeDays.set(diffDays);
    this.durationDropdownOpen.set(false);
    this.load();
  }

  cancelCustomRange() {
    this.customEndDate.set(null);
    this.selectedDuration.set('This Week');
    const mon = this.mondayOf(new Date());
    this.weekStart.set(mon);
    this.rangeDays.set(7);

    this.pickerStart.set(mon);
    const endMon = new Date(mon);
    endMon.setDate(endMon.getDate() + 6);
    this.pickerEnd.set(endMon);
    this.calMonth1.set(new Date(mon.getFullYear(), mon.getMonth(), 1));

    this.durationDropdownOpen.set(false);
    this.load();
  }

  closeAllDropdowns() {
    this.fEmployeeDropdownOpen.set(false);
    this.fProjectDropdownOpen.set(false);
    this.durationDropdownOpen.set(false);
  }

  private shiftWeek(days: number) {
    const d = new Date(this.weekStart());
    d.setDate(d.getDate() + days);
    this.weekStart.set(d);
    if (this.customEndDate()) {
      const end = new Date(this.customEndDate()!);
      end.setDate(end.getDate() + days);
      this.customEndDate.set(end);
    }
    this.load();
  }

  applyFilters() {
    this.filtersOpen.set(false);
    this.load();
  }

  clearFilters() {
    this.fEmployee.set('ALL'); this.fProject.set('ALL'); this.fClient.set('ALL');
    this.fDepartment.set('ALL'); this.fPm.set('ALL'); this.fSource.set('ALL');
    this.fStatus.set('ALL'); this.fTask.set(''); this.fBillable.set('ALL');
    this.fEmployeeSearchQuery.set('');
    this.fProjectSearchQuery.set('');
    this.tableSearchQuery.set('');
    this.closeAllDropdowns();
    this.load();
  }

  // ── Expanding ──────────────────────────────────────────────────────────

  private collapseAll() {
    this.openEntry.set(null);
    this.expandedDay.set(null);
    this.expandedEmployee.set(null);
    this.expandedWeek.set(null);
  }

  toggleDay(date: string) {
    this.expandedDay.set(this.expandedDay() === date ? null : date);
  }

  /** Opening a team row fetches that person's week — the list carries totals only. */
  toggleEmployee(employeeId: number) {
    if (this.expandedEmployee() === employeeId) {
      this.expandedEmployee.set(null);
      this.expandedWeek.set(null);
      return;
    }
    this.expandedEmployee.set(employeeId);
    this.expandedWeek.set(null);
    this.expandedLoading.set(true);
    this.api
      .getEmployeeWeek(employeeId, this.dayKey(this.weekStart()), this.dayKey(this.weekEnd()))
      .subscribe({
        next: (w) => { this.expandedWeek.set(w); this.expandedLoading.set(false); },
        error: (e) => { this.expandedLoading.set(false); this.fail(e, 'Could not load that week.'); },
      });
  }

  // ── Submit and review (§22) ────────────────────────────────────────────

  submitDay(day: TimesheetDay) {
    if (this.isBusy(day.date)) return;
    this.setBusy(day.date, true);
    this.api.submitDay(day.date).subscribe({
      next: () => {
        this.setBusy(day.date, false);
        this.toast.success(`${this.shortDate(day.date)} submitted for approval.`);
        this.load();
      },
      error: (e) => { this.setBusy(day.date, false); this.fail(e, 'Could not submit that day.'); },
    });
  }

  approveDay(employeeId: number, day: TimesheetDay) {
    this.review(employeeId, day, 'APPROVED');
  }

  // ── Rejection Modal (§22) ─────────────────────────────────────────────
  rejectModalOpen = signal(false);
  rejectTarget = signal<{ employeeId: number; day: TimesheetDay; employeeName?: string } | null>(null);
  rejectReasonText = signal('');

  openRejectModal(employeeId: number, day: TimesheetDay, employeeName?: string) {
    this.rejectTarget.set({ employeeId, day, employeeName });
    this.rejectReasonText.set('');
    this.rejectModalOpen.set(true);
  }

  closeRejectModal() {
    this.rejectModalOpen.set(false);
    this.rejectTarget.set(null);
    this.rejectReasonText.set('');
  }

  confirmRejection() {
    const target = this.rejectTarget();
    if (!target) return;
    const reason = this.rejectReasonText().trim();
    if (!reason) {
      this.toast.error('A rejection requires a reason explaining what needs to change.');
      return;
    }
    this.closeRejectModal();
    this.review(target.employeeId, target.day, 'REJECTED', reason);
  }

  /**
   * §22: a rejection with no reason is an instruction nobody can act on, so
   * the reason is collected before the request rather than refused after it.
   */
  rejectDay(employeeId: number, day: TimesheetDay, employeeName?: string) {
    this.openRejectModal(employeeId, day, employeeName);
  }

  private review(
    employeeId: number,
    day: TimesheetDay,
    decision: 'APPROVED' | 'REJECTED',
    reason?: string,
  ) {
    if (this.isBusy(day.date)) return;
    this.setBusy(day.date, true);
    this.api.reviewDay(employeeId, day.date, decision, reason).subscribe({
      next: () => {
        this.setBusy(day.date, false);
        this.toast.success(
          `${this.shortDate(day.date)} ${decision === 'APPROVED' ? 'approved' : 'rejected'}.`,
        );
        // Both the open week and the row behind it now say something different.
        const open = this.expandedEmployee();
        this.load();
        if (open) setTimeout(() => this.toggleEmployee(open), 0);
      },
      error: (e) => { this.setBusy(day.date, false); this.fail(e, 'Could not record that decision.'); },
    });
  }

  isBusy(date: string) { return this.busyDays().has(date); }

  private setBusy(date: string, busy: boolean) {
    const next = new Set(this.busyDays());
    busy ? next.add(date) : next.delete(date);
    this.busyDays.set(next);
  }

  // ── Header figures for the team views ──────────────────────────────────

  inactiveCount(data: TimesheetOverview): number {
    return data.employees.filter((e) => e.employee.isInactive).length;
  }


  pendingCount(data: TimesheetOverview): number {
    return data.employees.reduce((sum, e) => sum + e.counts.pending, 0);
  }

  /** Days carrying an over-booking, an unstopped timer, or no attendance. */
  attentionCount(data: TimesheetOverview): number {
    return data.employees.reduce((sum, e) => sum + e.counts.needsAttention, 0);
  }

  // ── The entry detail modal ─────────────────────────────────────────────

  showEntry(entry: TimesheetEntry, date: string, who: string) {
    this.openEntry.set({ entry, date, who });
  }

  closeEntry() {
    this.openEntry.set(null);
  }

  /** A time log's span in words, for the modal's header line. */
  entrySpan(entry: TimesheetEntry): string {
    if (!entry.endedAt) return `${this.time(entry.startedAt)} — still running`;
    return `${this.time(entry.startedAt)} – ${this.time(entry.endedAt)}`;
  }

  /**
   * Whether this single entry is long enough to be an unstopped timer. The
   * same twelve-hour line the server draws, repeated here only to decide
   * whether the modal shows the caveat.
   */
  isImplausibleEntry(entry: TimesheetEntry): boolean {
    return entry.hours > 12;
  }

  // ── Display helpers ────────────────────────────────────────────────────

  /**
   * Hours as "7h 30m".
   *
   * Never a decimal: a timesheet is read by people reconciling it against a
   * clock, and 7.5 has to be converted in the reader's head every time.
   */
  hhmm(hours: number | null | undefined): string {
    if (!hours) return '—';
    const total = Math.round(hours * 60);
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (!h) return `${m}m`;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  time(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
  }

  shortDate(key: string): string {
    return new Date(`${key}T00:00:00`).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short',
    });
  }

  statusLabel(status: TimesheetStatus): string {
    return {
      NOT_SUBMITTED: 'Not submitted',
      SUBMITTED: 'Pending',
      APPROVED: 'Approved',
      REJECTED: 'Rejected',
    }[status];
  }

  initials(first?: string, last?: string): string {
    return `${(first || '').charAt(0)}${(last || '').charAt(0)}`.toUpperCase() || '?';
  }

  fullName(p: { firstName?: string; lastName?: string }): string {
    return `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'Unnamed';
  }

  /** A weekend day with nothing on it is not a gap anyone needs to explain. */
  isEmptyWeekend(day: { date: string; loginHours: number; loggedHours: number }): boolean {
    const d = new Date(`${day.date}T00:00:00`).getDay();
    return (d === 0 || d === 6) && !day.loginHours && !day.loggedHours;
  }

  /** Cost, only ever rendered where the server sent it. */
  money(amount: number | null | undefined): string {
    if (amount == null) return '—';
    return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  }

  /**
   * How wide the expanded week has to be to sit under the row above it.
   *
   * Counted from the same two conditions the header uses rather than hardcoded:
   * a colspan that disagrees with the header is invisible until somebody opens
   * a row in the one view that has the extra column.
   */
  detailColspan(data: TimesheetOverview): number {
    // person + (day columns, when shown) + login/logged + approvals
    const base = 1 + (this.showDayColumns() ? this.weekDays().length : 0) + 2 + 1;
    return base + (data.hoursFiltered ? 0 : 1) + (data.canViewCost && this.scope() === 'FINANCE' ? 1 : 0);
  }

  dayOf(row: OverviewRow, key: string) {
    return row.days.find((d) => d.date === key) ?? null;
  }

  trackByDate = (_: number, d: { date: string }) => d.date;
  trackByEmployee = (_: number, r: OverviewRow) => r.employee.id;
  trackByEntry = (_: number, e: { id: number }) => e.id;

  private mondayOf(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /**
   * The LOCAL calendar day. Not toISOString(): that is UTC, and east of
   * Greenwich local midnight falls on the previous UTC date — which is the bug
   * that once filed every log under the day before and left the grid empty.
   */
  private dayKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private fail(err: any, fallback: string) {
    this.toast.error(err?.error?.message || fallback);
  }
}
