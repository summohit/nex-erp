import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucideChevronLeft, LucideChevronRight, LucideClock, LucideUser, LucideUsers,
  LucideBuilding2, LucideCoins, LucideCheck, LucideX, LucideSend, LucideFilter,
  LucideChevronDown, LucideAlertTriangle, LucideTimer, LucidePencilLine,
  LucideCalendarDays, LucideLoader2, LucideRotateCcw, LucideInfo,
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

  weekEnd = computed(() => {
    const d = new Date(this.weekStart());
    d.setDate(d.getDate() + this.rangeDays() - 1);
    return d;
  });

  /** The grid gets a column per day, so it only stays readable for a week. */
  showDayColumns = computed(() => this.rangeDays() <= 7);

  weekDays = computed(() => {
    const out: { date: Date; key: string; isToday: boolean }[] = [];
    const todayKey = this.dayKey(new Date());
    for (let i = 0; i < this.rangeDays(); i++) {
      const d = new Date(this.weekStart());
      d.setDate(d.getDate() + i);
      const key = this.dayKey(d);
      out.push({ date: d, key, isToday: key === todayKey });
    }
    return out;
  });

  isCurrentWeek = computed(
    () => this.dayKey(this.weekStart()) === this.dayKey(this.mondayOf(new Date())),
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
    this.weekStart.set(this.mondayOf(new Date()));
    this.rangeDays.set(7);
    this.load();
  }

  /**
   * Week, fortnight, month or quarter, anchored so the range ends today rather
   * than starting today — the question is always about work already done.
   */
  setRange(days: number) {
    this.rangeDays.set(days);
    if (days === 7) {
      this.weekStart.set(this.mondayOf(new Date()));
    } else {
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

  private shiftWeek(days: number) {
    const d = new Date(this.weekStart());
    d.setDate(d.getDate() + days);
    this.weekStart.set(d);
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

  /**
   * §22: a rejection with no reason is an instruction nobody can act on, so
   * the reason is collected before the request rather than refused after it.
   */
  rejectDay(employeeId: number, day: TimesheetDay) {
    const reason = window.prompt(
      `Why is ${this.shortDate(day.date)} being rejected?\n\nThe employee sees this, so say what needs to change.`,
    );
    if (reason === null) return;
    if (!reason.trim()) {
      this.toast.error('A rejection needs a reason.');
      return;
    }
    this.review(employeeId, day, 'REJECTED', reason.trim());
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
