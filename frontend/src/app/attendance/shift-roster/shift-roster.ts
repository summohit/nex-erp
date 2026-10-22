import { Component, OnInit, computed, inject, signal, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucideChevronLeft, LucideChevronRight, LucideX, LucideCalendar,
  LucideRotateCcw, LucideWandSparkles, LucideTrash2, LucideBadgeCheck, LucideXCircle,
  LucideBuilding2, LucideMapPin, LucideClock, LucideAlertCircle, LucideCheckCircle2,
  LucideArrowRight, LucideBriefcase, LucideInfo, LucideUserCheck, LucideUsers, LucideSearch, LucideCheck,
  LucideHouse, LucideFileSpreadsheet, LucideUpload, LucideDownload, LucideFileText, LucideCalendarCheck, LucidePlus
} from '@lucide/angular';
import { ShiftsService, RosterAssignmentPayload, RosterCell, RosterGrid, RosterRow, RosterShift } from '../../services/shifts.service';
import { MasterDataService } from '../../services/master-data.service';
import { ProjectsService } from '../../services/projects';
import { AuthService } from '../../services/auth.service';
import { WfhService } from '../../services/wfh.service';
import { EmployeeService } from '../../services/employee.service';
import { SearchableSelectComponent, SearchableSelectOption } from '../../shared/components/searchable-select/searchable-select.component';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import { AttendanceFilterDrawerComponent, AttendanceFilterValue } from '../../shared/components/attendance-filter-drawer/attendance-filter-drawer';
import { firstValueFrom } from 'rxjs';

type ViewMode = 'week' | 'month';

interface RosterCellTooltip {
  row: RosterRow;
  cell: RosterCell;
  top: number;
  left: number;
  placement: 'top' | 'bottom';
  arrowLeft: number;
  holidayName: string | null;
}

interface OnSiteCtx {
  source: 'cell' | 'bulk';
  shiftId: number;
  shiftName: string;
  row?: RosterRow;
  cell?: RosterCell;
  bulk?: {
    employeeIds: number[]; start: string; end: string;
    skipNonWorkingDays: boolean; overwriteExisting: boolean;
  };
}

@Component({
  selector: 'app-shift-roster',
  standalone: true,
  imports: [
    RouterLink,
    CommonModule, FormsModule, LucideChevronLeft, LucideChevronRight, LucideX,
    LucideCalendar, LucideRotateCcw, LucideWandSparkles, LucideTrash2,
    LucideBadgeCheck, LucideXCircle, LucideBuilding2, LucideMapPin,
    LucideClock, LucideAlertCircle, LucideCheckCircle2, LucideArrowRight,
    LucideBriefcase, LucideInfo, LucideUserCheck, LucideUsers, LucideSearch, LucideCheck,
    LucideHouse, LucideFileSpreadsheet, LucideUpload, LucideDownload, LucideFileText, LucideCalendarCheck, LucidePlus,
    SearchableSelectComponent, SkeletonComponent, AttendanceFilterDrawerComponent
  ],
  templateUrl: './shift-roster.html',
  styleUrls: ['./shift-roster.css'],
})
export class ShiftRosterComponent implements OnInit {
  private shiftsService = inject(ShiftsService);
  private masterData = inject(MasterDataService);
  private toast = inject(HotToastService);
  private projectsService = inject(ProjectsService);
  private authService = inject(AuthService);
  private wfhApi = inject(WfhService);
  private employeesApi = inject(EmployeeService);

  // ---- Assign WFH (21 Oct 2026): HR / super admin, approved at once, not in the monthly limit
  wfhOpen = signal(false);
  wfhBusy = signal(false);
  wfhPeople = signal<{ id: number; name: string; sub: string; avatarUrl: string | null }[]>([]);
  wfhPicked = signal<number[]>([]);
  wfhQuery = signal('');
  wfhFrom = '';
  wfhTo = '';
  wfhReason = '';
  // ---- Permanent WFH (22 Oct 2026): HR / super admin only
  wfhMode = signal<'DAYS' | 'PERMANENT'>('DAYS');
  wfhStart = '';
  wfhWeekdays = signal<number[]>([]);
  readonly weekdayChips = [{ d: 1, l: 'Mon' }, { d: 2, l: 'Tue' }, { d: 3, l: 'Wed' }, { d: 4, l: 'Thu' }, { d: 5, l: 'Fri' }, { d: 6, l: 'Sat' }, { d: 0, l: 'Sun' }];
  permanentRules = signal<any[]>([]);
  canPermanentWfh(): boolean {
    const r = this.currentUser()?.role;
    return r === 'HR' || r === 'SUPERADMIN' || r === 'SUPER_ADMIN';
  }
  toggleWfhWeekday(d: number) {
    const cur = this.wfhWeekdays();
    this.wfhWeekdays.set(cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]);
  }
  ruleDays(r: any): string {
    if (!r.weekdays) return 'Every working day';
    const n = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return String(r.weekdays).split(',').map((x: string) => n[Number(x)]).join(', ');
  }
  loadPermanent() {
    if (!this.canPermanentWfh()) return;
    this.wfhApi.permanentList().subscribe({ next: (r) => this.permanentRules.set(r || []), error: () => {} });
  }
  savePermanentWfh() {
    if (!this.wfhPicked().length) { this.toast.error('Choose at least one employee'); return; }
    this.wfhBusy.set(true);
    this.wfhApi.setPermanent(this.wfhPicked(), this.wfhStart, this.wfhWeekdays(), this.wfhReason.trim() || undefined).subscribe({
      next: (r) => {
        this.wfhBusy.set(false); this.wfhPicked.set([]);
        this.toast.success(`Permanent WFH set for ${r.updated} ${r.updated === 1 ? 'person' : 'people'}`);
        this.loadPermanent(); this.load();
      },
      error: (e) => { this.wfhBusy.set(false); this.toast.error(e.error?.message || 'Could not set permanent WFH'); },
    });
  }
  endPermanentWfh(ids: number[]) {
    if (!ids.length) { this.toast.error('Choose at least one employee'); return; }
    if (!confirm(`End permanent WFH for ${ids.length === 1 ? 'this person' : ids.length + ' people'}? From today they work at the office as rostered.`)) return;
    this.wfhBusy.set(true);
    this.wfhApi.endPermanent(ids).subscribe({
      next: (r) => {
        this.wfhBusy.set(false);
        this.toast.success(r.ended ? `Permanent WFH ended for ${r.ended}` : 'None of them were on permanent WFH');
        this.loadPermanent(); this.load();
      },
      error: (e) => { this.wfhBusy.set(false); this.toast.error(e.error?.message || 'Could not end permanent WFH'); },
    });
  }
  /** Call a permanent-WFH person to the office for the day in the editor, or undo it. */
  setOfficeDay(atOffice: boolean) {
    const row = this.editorRow(), cell = this.editorCell();
    if (!row || !cell) return;
    this.wfhApi.officeDay(row.employee.id, cell.date, atOffice).subscribe({
      next: () => { this.toast.success(atOffice ? 'Set to work at the office this day' : 'Back to WFH this day'); this.closeEditor(); this.load(); },
      error: (e) => this.toast.error(e.error?.message || 'Could not update the day'),
    });
  }
  /** Copy the previous month's roster into the month on screen (21 Oct 2026). */
  copyPrevBusy = signal(false);
  copyPreviousMonth() {
    const d = new Date(this.rangeStart());
    const y = d.getFullYear(), m = d.getMonth() + 1;
    const name = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const prev = new Date(y, m - 2, 1).toLocaleDateString('en-IN', { month: 'long' });
    if (!confirm(`Copy ${prev}'s roster into ${name}?\n\nEach person's shift and days off are copied weekday for weekday (Sundays stay Sundays). Days in ${name} that already have an entry are not changed. On-site project days are copied as the plain shift.`)) return;
    this.copyPrevBusy.set(true);
    this.shiftsService.copyPreviousMonth(y, m).subscribe({
      next: (r) => { this.copyPrevBusy.set(false); this.toast.success(`Copied ${r.created} days for ${r.people} people`); this.load(); },
      error: (e) => { this.copyPrevBusy.set(false); this.toast.error(e.error?.message || 'Could not copy the roster'); },
    });
  }

  canAssignWfh(): boolean {
    const r = this.currentUser()?.role;
    return r === 'HR' || r === 'ADMIN' || r === 'SUPERADMIN' || r === 'SUPER_ADMIN';
  }

  myEmployeeId = computed<number | null>(() => {
    const u = this.currentUser();
    return u?.employeeId ?? u?.employee?.id ?? null;
  });

  addMyselfToWfh() {
    const myId = this.myEmployeeId();
    if (!myId) return;
    if (!this.wfhPicked().includes(myId)) {
      this.wfhPicked.set([...this.wfhPicked(), myId]);
    }
  }
  wfhMatches = computed(() => {
    const q = this.wfhQuery().trim().toLowerCase();
    const picked = new Set(this.wfhPicked());
    return this.wfhPeople().filter((p) => !picked.has(p.id) && (!q || `${p.name} ${p.sub}`.toLowerCase().includes(q))).slice(0, 30);
  });
  wfhPickedPeople = computed(() => {
    const ids = new Set(this.wfhPicked());
    return this.wfhPeople().filter((p) => ids.has(p.id));
  });
  removeWfhPicked(id: number) {
    this.wfhPicked.set(this.wfhPicked().filter((x) => x !== id));
  }
  setWfhPreset(preset: 'today' | 'tomorrow' | 'this_week' | 'next_week') {
    const now = new Date(Date.now() + 330 * 60_000);
    const formatDate = (d: Date) => d.toISOString().slice(0, 10);
    if (preset === 'today') {
      this.wfhFrom = formatDate(now);
      this.wfhTo = formatDate(now);
    } else if (preset === 'tomorrow') {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      this.wfhFrom = formatDate(tomorrow);
      this.wfhTo = formatDate(tomorrow);
    } else if (preset === 'this_week') {
      this.wfhFrom = formatDate(now);
      const day = now.getDay();
      const distToFriday = (5 - day + 7) % 7;
      const end = new Date(now);
      end.setDate(end.getDate() + distToFriday);
      this.wfhTo = formatDate(end);
    } else if (preset === 'next_week') {
      const day = now.getDay();
      const daysUntilNextMon = ((1 - day + 7) % 7) || 7;
      const nextMon = new Date(now);
      nextMon.setDate(nextMon.getDate() + daysUntilNextMon);
      const nextFri = new Date(nextMon);
      nextFri.setDate(nextFri.getDate() + 4);
      this.wfhFrom = formatDate(nextMon);
      this.wfhTo = formatDate(nextFri);
    }
  }
  openAssignWfh() {
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    this.wfhFrom = today; this.wfhTo = today; this.wfhReason = ''; this.wfhPicked.set([]); this.wfhQuery.set('');
    this.wfhStart = today; this.wfhWeekdays.set([]); this.wfhMode.set('DAYS'); this.loadPermanent();
    if (!this.wfhPeople().length) {
      this.employeesApi.getEmployeesBasicList().subscribe({
        next: (list: any[]) => this.wfhPeople.set((list || []).map((e) => ({
          id: e.id, name: `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim(), avatarUrl: e.avatarUrl ?? null,
          sub: [e.employeeCode, e.designation?.name ?? e.designation, e.department?.name ?? e.department].filter((x) => typeof x === 'string' && x).join(' · '),
        }))),
        error: () => {},
      });
    }
    this.wfhOpen.set(true);
  }
  wfhDates(): string[] {
    if (!this.wfhFrom) return [];
    const out: string[] = [];
    const end = new Date(`${this.wfhTo || this.wfhFrom}T00:00:00Z`);
    for (let d = new Date(`${this.wfhFrom}T00:00:00Z`); d <= end && out.length < 62; d.setUTCDate(d.getUTCDate() + 1)) {
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }
  saveAssignWfh() {
    const dates = this.wfhDates();
    if (!this.wfhPicked().length) { this.toast.error('Choose at least one employee'); return; }
    if (!dates.length) { this.toast.error('Choose the days'); return; }
    this.wfhBusy.set(true);
    this.wfhApi.assign(this.wfhPicked(), dates, this.wfhReason.trim() || undefined).subscribe({
      next: (r) => {
        this.wfhBusy.set(false); this.wfhOpen.set(false);
        this.toast.success(`WFH assigned: ${r.created} day${r.created === 1 ? '' : 's'}${(r as any).daysOff ? ` · ${(r as any).daysOff} days off skipped` : ''}${r.skipped ? ` · ${r.skipped} already WFH` : ''}`);
        this.load();
      },
      error: (e) => { this.wfhBusy.set(false); this.toast.error(e.error?.message || 'Could not assign WFH'); },
    });
  }

  loading = signal(false);
  loadingDepartments = signal(false);
  grid = signal<RosterGrid>({ days: [], shifts: [], rows: [] });
  departments = signal<any[]>([]);
  projects = signal<any[]>([]);
  currentUser = this.authService.currentUser;

  projectOptions = computed<SearchableSelectOption[]>(() => {
    return this.projects().map(p => ({
      id: p.id,
      name: p.name,
      subtitle: p.address || p.client?.name || undefined
    }));
  });

  shiftOptions = computed<SearchableSelectOption[]>(() => {
    return this.grid().shifts.map(s => ({
      id: s.id,
      name: s.name,
      subtitle: `${s.startTime || 'Flexible'} – ${s.endTime || 'Flexible'}${s.shortCode ? ' (' + s.shortCode + ')' : ''}`,
    }));
  });


  viewMode = signal<ViewMode>('week');
  /** Monday of the displayed week, or the 1st for month view. */
  anchor = signal<Date>(this.startOfWeek(new Date()));
  readonly monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  readonly rosterYears = Array.from({ length: 7 }, (_, index) => new Date().getFullYear() - 3 + index);
  rosterPage = signal(1);
  rosterPageSize = signal(10);
  readonly rosterPageSizes = [10, 25, 50];
  filterDepartmentId = signal<number | null>(null);
  filterEmployeeId = signal<number | null>(null);
  search = signal('');
  filterDrawerOpen = signal(false);
  rosterShiftFilter = signal('');
  rosterStateFilter = signal('');
  customRange = signal<{ start: Date; end: Date } | null>(null);

  employeeFilterOptions = computed<SearchableSelectOption[]>(() =>
    this.grid().rows.map(({ employee }) => ({
      id: employee.id,
      name: employee.name,
      subtitle: [employee.designation, employee.department, employee.employeeCode]
        .filter(Boolean)
        .join(' · '),
      avatarUrl: employee.avatarUrl || undefined,
      avatarText: employee.avatarUrl ? undefined : employee.name.charAt(0).toUpperCase(),
    })),
  );

  departmentFilterOptions = computed<SearchableSelectOption[]>(() =>
    this.departments().map((department) => ({
      id: Number(department.id),
      name: department.name,
    })),
  );

  get rosterFilterGroups() {
    return [
      {
        key: 'department',
        label: 'Department',
        placeholder: 'All departments',
        options: this.departments().map((department) => ({
          value: String(department.id),
          label: department.name,
        })),
      },
      {
        key: 'shift',
        label: 'Shift',
        placeholder: 'All shifts',
        options: this.grid().shifts.map((shift) => ({
          value: String(shift.id),
          label: `${shift.name}${shift.shortCode ? ` (${shift.shortCode})` : ''}`,
        })),
      },
      {
        key: 'rosterState',
        label: 'Roster entry',
        placeholder: 'All entry types',
        options: [
          { value: 'SHIFT', label: 'Assigned shift' },
          { value: 'DAY_OFF', label: 'Day off' },
          { value: 'LEAVE', label: 'On leave' },
          { value: 'UNASSIGNED', label: 'No shift assigned' },
          { value: 'ONSITE_PENDING', label: 'On-site approval pending' },
        ],
      },
    ];
  }

  get rosterFilterValues(): Record<string, string> {
    return {
      department: this.filterDepartmentId() ? String(this.filterDepartmentId()) : '',
      shift: this.rosterShiftFilter(),
      rosterState: this.rosterStateFilter(),
    };
  }

  get rosterFilterCount(): number {
    return Number(!!this.filterDepartmentId())
      + Number(!!this.rosterShiftFilter())
      + Number(!!this.rosterStateFilter())
      + Number(!!this.search().trim())
      + Number(!!this.customRange());
  }

  // Cell editor
  editorOpen = signal(false);
  editorRow = signal<RosterRow | null>(null);
  editorCell = signal<RosterCell | null>(null);
  hoveredCellTooltip = signal<RosterCellTooltip | null>(null);

  // Bulk assign ("Automate Shifts")
  bulkOpen = signal(false);
  bulkForm: any = { shiftId: null, isDayOff: false, start: '', end: '', skipNonWorkingDays: true, overwriteExisting: true };
  bulkSelection = signal<Set<number>>(new Set());

  // On-site ("where does the field work happen?")
  onsiteOpen = signal(false);
  onsiteCtx = signal<OnSiteCtx | null>(null);
  onsiteForm = {
    projectId: null as number | null,
    address: '',
    // A stint at a client site normally runs for a stretch, not a single day,
    // so the modal can span a range. 'day' keeps the old single-cell behaviour.
    span: 'day' as 'day' | 'range',
    start: '',
    end: '',
    // Blank means "use the shift's own timing" — the server reads it that way.
    startTime: '',
    endTime: '',
  };
  onsiteSubmitting = signal(false);

  // On-site "No Project" approval queue (Administrator / HR only).
  approvalsOpen = signal(false);
  pendingOnsite = signal<any[]>([]);

  /**
   * Company holidays by day (YYYY-MM-DD → name). A holiday overrides the
   * rostered shift on screen — nobody is expected in, whatever the roster says.
   */
  holidays = signal<Map<string, string>>(new Map());

  holidayOn(day: string): string | null {
    return this.holidays().get(day) ?? null;
  }

  ngOnInit() {
    this.masterData.getHolidays().subscribe({
      next: (rows: any) => {
        const map = new Map<string, string>();
        for (const h of rows || []) {
          // Stored as the day at UTC midnight, so the first ten characters are the day.
          if (h?.date) map.set(String(h.date).slice(0, 10), h.name || 'Holiday');
        }
        this.holidays.set(map);
      },
      error: () => this.holidays.set(new Map()),
    });
    this.loadingDepartments.set(true);
    this.masterData.getDepartments().subscribe({
      next: (d: any) => {
        this.departments.set(d || []);
        this.loadingDepartments.set(false);
      },
      error: () => this.loadingDepartments.set(false)
    });
    this.projectsService.getProjects().subscribe({
      next: (p: any) => this.projects.set(p || []),
      error: () => this.projects.set([]),
    });
    this.load();
    if (this.isApprover) this.loadPendingOnsite();
  }

  /** Reset the on-site form, seeding the range from the day being edited. */
  private resetOnsiteForm(anchorDate: string, shift?: RosterShift | null) {
    this.onsiteForm = {
      projectId: null, address: '',
      span: 'day', start: anchorDate, end: anchorDate,
      // Pre-fill with the shift's own hours so the fields show what will apply
      // if they are left alone, rather than looking empty and undecided.
      startTime: shift?.startTime || '',
      endTime: shift?.endTime || '',
    };
  }

  /** Extend the on-site range to the rest of the week / month from its start. */
  quickRange(unit: 'week' | 'month') {
    const from = new Date(`${this.onsiteForm.start || this.todayKey()}T00:00:00Z`);
    if (isNaN(from.getTime())) return;
    const to = new Date(from);
    if (unit === 'week') {
      // Through Sunday of the week the start falls in.
      to.setUTCDate(to.getUTCDate() + ((7 - to.getUTCDay()) % 7));
    } else {
      to.setUTCMonth(to.getUTCMonth() + 1, 0); // last day of that month
    }
    this.onsiteForm.span = 'range';
    this.onsiteForm.end = to.toISOString().slice(0, 10);
  }

  private todayKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /** True when the window differs from the shift's own hours. */
  get onsiteWindowChanged(): boolean {
    const shift = this.grid().shifts.find(s => s.id === this.onsiteCtx()?.shiftId);
    return (this.onsiteForm.startTime || '') !== (shift?.startTime || '')
        || (this.onsiteForm.endTime || '') !== (shift?.endTime || '');
  }

  /** The "Onsite Project" shift (and siblings) trigger the project/address flow. */
  isOnSiteShift(s: { name?: string } | null | undefined): boolean {
    // Support the common names used in shift setup: "Onsite", "On-site",
    // and "On Site".
    return !!s?.name && s.name.toLowerCase().replace(/[^a-z]/g, '').includes('onsite');
  }

  get isApprover(): boolean {
    const role = this.currentUser()?.role;
    return role === 'ADMIN' || role === 'HR' || role === 'SUPERADMIN';
  }

  get selectedProjectAddress(): string {
    const p = this.projects().find(x => x.id === this.onsiteForm.projectId);
    return p?.address || '';
  }

  // ── range helpers ───────────────────────────────────────────────────────
  private startOfWeek(d: Date): Date {
    const c = new Date(d);
    // Workway's week starts Monday.
    const diff = (c.getDay() + 6) % 7;
    c.setDate(c.getDate() - diff);
    c.setHours(0, 0, 0, 0);
    return c;
  }

  fmt(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  rangeStart = computed(() => {
    const custom = this.customRange();
    if (custom) return custom.start;
    const a = this.anchor();
    return this.viewMode() === 'week' ? a : new Date(a.getFullYear(), a.getMonth(), 1);
  });

  rangeEnd = computed(() => {
    const custom = this.customRange();
    if (custom) return custom.end;
    const s = this.rangeStart();
    if (this.viewMode() === 'week') {
      const e = new Date(s); e.setDate(e.getDate() + 6); return e;
    }
    return new Date(s.getFullYear(), s.getMonth() + 1, 0);
  });

  displayDays = computed(() => {
    if (this.grid().days && this.grid().days.length > 0) return this.grid().days;
    const days: string[] = [];
    const cur = new Date(this.rangeStart());
    const end = new Date(this.rangeEnd());
    while (cur <= end) {
      days.push(this.fmt(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  });

  rangeLabel = computed(() => {
    const s = this.rangeStart(), e = this.rangeEnd();
    if (this.customRange()) {
      const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
      return `${s.toLocaleDateString(undefined, opts)} – ${e.toLocaleDateString(undefined, opts)}`;
    }
    if (this.viewMode() === 'month') {
      return s.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    }
    const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
    return `${s.toLocaleDateString(undefined, opts)} – ${e.toLocaleDateString(undefined, { ...opts, year: 'numeric' })}`;
  });

  shift(step: number) {
    this.customRange.set(null);
    const a = new Date(this.anchor());
    if (this.viewMode() === 'week') a.setDate(a.getDate() + step * 7);
    else a.setMonth(a.getMonth() + step);
    this.anchor.set(a);
    this.rosterPage.set(1);
    this.load();
  }

  today() {
    this.customRange.set(null);
    const now = new Date();
    this.anchor.set(this.viewMode() === 'week' ? this.startOfWeek(now) : new Date(now.getFullYear(), now.getMonth(), 1));
    this.rosterPage.set(1);
    this.load();
  }

  setView(mode: ViewMode) {
    if (this.viewMode() === mode) return;
    this.customRange.set(null);
    this.viewMode.set(mode);
    const now = this.anchor();
    this.anchor.set(mode === 'week' ? this.startOfWeek(now) : new Date(now.getFullYear(), now.getMonth(), 1));
    this.rosterPage.set(1);
    this.load();
  }

  setRosterMonth(month: number): void {
    const current = this.anchor();
    this.customRange.set(null);
    this.anchor.set(new Date(current.getFullYear(), month, 1));
    this.rosterPage.set(1);
    this.load();
  }

  setRosterYear(year: number): void {
    const current = this.anchor();
    this.customRange.set(null);
    this.anchor.set(new Date(Number(year), current.getMonth(), 1));
    this.rosterPage.set(1);
    this.load();
  }

  // ── data ────────────────────────────────────────────────────────────────
  load() {
    this.loading.set(true);
    this.shiftsService.getRoster({
      start: this.fmt(this.rangeStart()),
      end: this.fmt(this.rangeEnd()),
      departmentId: this.filterDepartmentId() || undefined,
    }).subscribe({
      next: (g) => { this.grid.set(g); this.loading.set(false); },
      error: (e) => { this.toast.error(e.error?.message || 'Failed to load roster'); this.loading.set(false); },
    });
  }

  hasActiveLegendFilter = computed(() => {
    return !!this.rosterShiftFilter() || !!this.rosterStateFilter();
  });

  isShiftFilterActive(shiftId: number | string): boolean {
    return this.rosterShiftFilter() === String(shiftId);
  }

  isStateFilterActive(state: string): boolean {
    return this.rosterStateFilter() === state;
  }

  toggleShiftFilter(shiftId: number | string): void {
    const sId = String(shiftId);
    if (this.rosterShiftFilter() === sId) {
      this.rosterShiftFilter.set('');
    } else {
      this.rosterShiftFilter.set(sId);
      this.rosterStateFilter.set('');
    }
    this.rosterPage.set(1);
  }

  toggleStateFilter(state: string): void {
    if (this.rosterStateFilter() === state) {
      this.rosterStateFilter.set('');
    } else {
      this.rosterStateFilter.set(state);
      this.rosterShiftFilter.set('');
    }
    this.rosterPage.set(1);
  }

  clearLegendFilter(): void {
    this.rosterShiftFilter.set('');
    this.rosterStateFilter.set('');
    this.rosterPage.set(1);
  }

  isCellMatchingFilter(cell: RosterCell): boolean {
    const shiftId = this.rosterShiftFilter();
    const state = this.rosterStateFilter();
    if (!shiftId && !state) return true;

    if (shiftId) {
      return String(cell.shift?.id ?? '') === shiftId && !cell.isFieldVisit;
    }

    if (state === 'FIELD_VISIT') {
      return !!cell.isFieldVisit;
    }
    if (state === 'ONSITE_PENDING') {
      return cell.onSite?.approvalStatus === 'PENDING';
    }
    return cell.type === state;
  }

  visibleRows = computed(() => {
    const q = this.search().toLowerCase().trim();
    const employeeId = this.filterEmployeeId();
    const hasLegend = this.hasActiveLegendFilter();
    return this.grid().rows.filter((row) => {
      const matchesEmployee = !q
        || row.employee.name.toLowerCase().includes(q)
        || String(row.employee.id).includes(q)
        || (row.employee.employeeCode || '').toLowerCase().includes(q)
        || (row.employee.designation || '').toLowerCase().includes(q)
        || (row.employee.department || '').toLowerCase().includes(q);
      const matchesSelectedEmployee = employeeId === null || row.employee.id === employeeId;
      const matchesLegend = !hasLegend || row.cells.some((cell) => this.isCellMatchingFilter(cell));
      return matchesEmployee && matchesSelectedEmployee && matchesLegend;
    });
  });

  /**
   * One field visit is one employee/day roster cell. Count the complete
   * filtered result rather than just the current pagination page, so the
   * number at the top always agrees with the selected roster period.
   */
  fieldVisitCount = computed(() =>
    this.grid().rows.reduce(
      (total, row) => {
        const matchesEmployee = this.filterEmployeeId() === null || row.employee.id === this.filterEmployeeId();
        if (!matchesEmployee) return total;
        return total + row.cells.filter((cell) => cell.isFieldVisit).length;
      },
      0,
    ),
  );

  rosterPageCount = computed(() => Math.max(1, Math.ceil(this.visibleRows().length / this.rosterPageSize())));
  rosterPageNumbers = computed(() => Array.from({ length: this.rosterPageCount() }, (_, index) => index + 1));
  pagedRows = computed(() => {
    const page = Math.min(this.rosterPage(), this.rosterPageCount());
    const start = (page - 1) * this.rosterPageSize();
    return this.visibleRows().slice(start, start + this.rosterPageSize());
  });
  rosterRangeStart = computed(() => this.visibleRows().length ? (Math.min(this.rosterPage(), this.rosterPageCount()) - 1) * this.rosterPageSize() + 1 : 0);
  rosterRangeEnd = computed(() => Math.min(this.rosterRangeStart() + this.rosterPageSize() - 1, this.visibleRows().length));

  setRosterPage(page: number): void {
    this.rosterPage.set(Math.max(1, Math.min(page, this.rosterPageCount())));
  }

  setRosterPageSize(size: number): void {
    this.rosterPageSize.set(Number(size));
    this.rosterPage.set(1);
  }

  applyAttendanceFilters(filters: AttendanceFilterValue): void {
    this.search.set(filters.employeeQuery);
    this.filterEmployeeId.set(null);
    const departmentId = Number(filters.filters['department']);
    this.filterDepartmentId.set(Number.isInteger(departmentId) && departmentId > 0 ? departmentId : null);
    this.rosterShiftFilter.set(filters.filters['shift'] || '');
    this.rosterStateFilter.set(filters.filters['rosterState'] || '');
    this.customRange.set(
      filters.startDate && filters.endDate
        ? {
            start: new Date(`${filters.startDate}T00:00:00`),
            end: new Date(`${filters.endDate}T00:00:00`),
          }
        : null,
    );
    this.filterDrawerOpen.set(false);
    this.load();
  }

  setRosterDepartment(value: unknown): void {
    const departmentId = Number(value);
    this.filterDepartmentId.set(Number.isInteger(departmentId) && departmentId > 0 ? departmentId : null);
    this.filterEmployeeId.set(null);
    this.rosterPage.set(1);
    this.load();
  }

  setRosterEmployee(value: unknown): void {
    const employeeId = Number(value);
    this.filterEmployeeId.set(Number.isInteger(employeeId) && employeeId > 0 ? employeeId : null);
    this.rosterPage.set(1);
  }

  exportCsv(): void {
    const lines = [['employee_id', 'employee_name', 'date', 'assignment', 'shift_id', 'shift_name', 'note']];
    for (const row of this.visibleRows()) {
      for (const cell of row.cells) {
        lines.push([
          String(row.employee.id), row.employee.name, cell.date,
          cell.type === 'DAY_OFF' ? 'DAY_OFF' : cell.type,
          cell.shift?.id ? String(cell.shift.id) : '', cell.shift?.name || '', cell.note || '',
        ]);
      }
    }
    this.downloadCsv(lines, `shift-roster-${this.fmt(this.rangeStart())}-to-${this.fmt(this.rangeEnd())}.csv`);
  }

  downloadRosterTemplate(): void {
    this.downloadCsv([
      ['employee_id', 'date', 'shift_id', 'day_off', 'note'],
      ['123', '2026-10-12', '4', 'false', 'Optional note'],
      ['123', '2026-10-13', '', 'true', 'Weekly rest day'],
    ], 'shift-roster-import-template.csv');
  }

  async importCsv(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const text = await file.text();
    const rows = this.csvRows(text);
    const data = rows.slice(1).map((row) => ({
      employeeId: Number(row[0]), date: row[1], shiftId: row[2] ? Number(row[2]) : null,
      isDayOff: ['true', 'yes', '1'].includes((row[3] || '').trim().toLowerCase()), note: row[4] || undefined,
    })).filter((row) => Number.isInteger(row.employeeId) && /^\d{4}-\d{2}-\d{2}$/.test(row.date) && (row.isDayOff || !!row.shiftId));
    if (!data.length) {
      this.toast.error('No valid roster rows found. Download the template for the required columns.');
      return;
    }
    if (!confirm(`Import ${data.length} roster assignment${data.length === 1 ? '' : 's'}? Existing entries on those dates will be updated.`)) return;
    try {
      await Promise.all(data.map((row) => firstValueFrom(this.shiftsService.assignRoster(row))));
      this.toast.success(`Imported ${data.length} roster assignment${data.length === 1 ? '' : 's'}`);
      this.load();
    } catch (error: any) {
      this.toast.error(error?.error?.message || 'Import stopped because one or more roster rows were invalid.');
    }
  }

  private csvRows(text: string): string[][] {
    return text.replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter(Boolean).map((line) =>
      line.match(/(?:[^,\"]+|\"(?:[^\"]|\"\")*\")+/g)?.map((value) => value.replace(/^\"|\"$/g, '').replace(/\"\"/g, '\"').trim()) ?? [],
    );
  }

  private downloadCsv(rows: string[][], fileName: string): void {
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const blob = new Blob([rows.map((row) => row.map(escape).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = fileName; link.click(); URL.revokeObjectURL(url);
  }

  // ── cell presentation ───────────────────────────────────────────────────
  dayLabel(day: string): { num: string; name: string; weekday: string; month: string; isToday: boolean; isWeekend: boolean } {
    const d = new Date(`${day}T00:00:00`);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return {
      num: String(d.getDate()),
      name: d.toLocaleDateString(undefined, { weekday: 'short' }),
      weekday: d.toLocaleDateString(undefined, { weekday: 'long' }),
      month: d.toLocaleDateString(undefined, { month: 'short' }),
      isToday: d.getTime() === today.getTime(),
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
    };
  }

  /** Month view has ~31 columns, so it falls back to the short code. */
  cellLabel(cell: RosterCell): string {
    if (cell.isFieldVisit) return this.viewMode() === 'month' ? 'FV' : 'Field Visit';
    const s = cell.shift;
    if (!s) return '';
    return this.viewMode() === 'month' ? (s.shortCode || s.name.slice(0, 3).toUpperCase()) : s.name;
  }

  cellLeaveCode(cell: RosterCell): string {
    const l = (cell.label || '').toLowerCase();
    if (l.includes('casual')) return 'CL';
    if (l.includes('sick')) return 'SL';
    if (l.includes('comp')) return 'CO';
    if (l.includes('earned') || l.includes('privilege')) return 'EL';
    if (l.includes('maternity')) return 'ML';
    if (l.includes('paternity')) return 'PL';
    if (l.includes('unpaid') || l.includes('loss')) return 'LWP';
    return 'LV';
  }

  cellTime(cell: RosterCell): string {
    // An on-site day can carry its own window; show what will actually be
    // enforced rather than the shift's nominal hours.
    const on = cell.onSite;
    if (on?.startTime && on?.endTime) return `${on.startTime} - ${on.endTime}`;
    const s = cell.shift;
    if (!s) return '';
    if (s.shiftType === 'FLEXIBLE') return s.totalHours ? `${s.totalHours} hrs` : '';
    return s.startTime && s.endTime ? `${s.startTime} - ${s.endTime}` : '';
  }

  cellTitle(row: RosterRow, cell: RosterCell): string {
    const who = row.employee.name;
    if (cell.type === 'LEAVE') return `${who}: ${cell.label}${cell.isHalfDay ? ' (half day)' : ''}`;
    if (cell.type === 'DAY_OFF') return `${who}: day off${cell.isDefault ? ' (shift does not run this day)' : ''}`;
    if (cell.type === 'SHIFT') {
      if (cell.isFieldVisit) {
        let t = `${who}: 📍 Field Visit (${cell.note || 'On-site'}) · ${this.cellTime(cell)}`;
        if (cell.onSite?.projectName) t += ` · Project: ${cell.onSite.projectName}`;
        if (cell.onSite?.address) t += ` @ ${cell.onSite.address}`;
        return t;
      }
      let t = `${who}: ${cell.shift?.name} ${this.cellTime(cell)}${cell.isDefault ? ' (default shift)' : ''}`;
      if (cell.onSite) {
        if (cell.onSite.startTime && cell.onSite.endTime) {
          t += ` (on-site hours, not the shift's)`;
        }
        if (cell.onSite.projectName) t += ` · ${cell.onSite.projectName}`;
        if (cell.onSite.address) t += ` @ ${cell.onSite.address}`;
        if (cell.onSite.approvalStatus === 'PENDING') t += ' · awaiting Administrator/HR approval';
        else if (cell.onSite.approvalStatus === 'REJECTED') t += ' · request rejected';
      }
      return t;
    }
    return `${who}: no shift assigned — click to set one`;
  }

  // ── cell hover tooltip ─────────────────────────────────────────────────
  onCellMouseEnter(event: MouseEvent, row: RosterRow, cell: RosterCell) {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const tooltipWidth = 290;

    // Flip to bottom if there's not enough room above (e.g. first 2-3 rows)
    const placeBelow = rect.top < 230;
    const placement: 'top' | 'bottom' = placeBelow ? 'bottom' : 'top';

    const badgeCenterX = rect.left + rect.width / 2;

    // Clamp horizontally to stay within viewport
    const minMargin = 12;
    const maxLeft = Math.max(minMargin, window.innerWidth - tooltipWidth - minMargin);
    const tooltipLeft = Math.max(minMargin, Math.min(maxLeft, badgeCenterX - tooltipWidth / 2));

    // Vertical coordinate
    const tooltipTop = placement === 'bottom' ? rect.bottom + 8 : rect.top - 8;

    // Arrow pointer relative to tooltip box
    const rawArrowLeft = badgeCenterX - tooltipLeft;
    const arrowLeft = Math.max(16, Math.min(tooltipWidth - 16, rawArrowLeft));

    this.hoveredCellTooltip.set({
      row,
      cell,
      top: tooltipTop,
      left: tooltipLeft,
      placement,
      arrowLeft,
      holidayName: this.holidayOn(cell.date),
    });
  }

  onCellMouseLeave() {
    this.hoveredCellTooltip.set(null);
  }

  onRosterScroll() {
    if (this.hoveredCellTooltip()) {
      this.hoveredCellTooltip.set(null);
    }
  }

  @HostListener('window:scroll')
  onWindowScroll() {
    if (this.hoveredCellTooltip()) {
      this.hoveredCellTooltip.set(null);
    }
  }

  formatFullDate(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(`${dateStr}T00:00:00`);
    return d.toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  // ── editing ─────────────────────────────────────────────────────────────
  openCell(row: RosterRow, cell: RosterCell) {
    this.hoveredCellTooltip.set(null);
    // Leave is owned by the leave module; the roster must not silently override it.
    if (cell.type === 'LEAVE') {
      this.toast.info(`${row.employee.name} is on approved ${cell.label} this day`);
      return;
    }
    this.editorRow.set(row);
    this.editorCell.set(cell);
    this.editorOpen.set(true);
  }

  closeEditor() {
    this.hoveredCellTooltip.set(null);
    this.editorOpen.set(false);
    this.editorRow.set(null);
    this.editorCell.set(null);
  }

  applyCell(shiftId: number | null, isDayOff: boolean) {
    const row = this.editorRow(), cell = this.editorCell();
    if (!row || !cell) return;

    // On-site shifts need a location before the roster can be saved.
    const shift = this.grid().shifts.find(s => s.id === shiftId);
    if (!isDayOff && shift && this.isOnSiteShift(shift)) {
      this.resetOnsiteForm(cell.date, shift);
      this.onsiteCtx.set({ source: 'cell', shiftId: shift.id, shiftName: shift.name, row, cell });
      this.onsiteOpen.set(true);
      return;
    }

    this.shiftsService.assignRoster({
      employeeId: row.employee.id, date: cell.date, shiftId, isDayOff,
    }).subscribe({
      next: () => { this.toast.success('Roster updated'); this.closeEditor(); this.load(); },
      error: (e) => this.toast.error(e.error?.message || 'Failed to update roster'),
    });
  }

  // ── on-site details modal ──────────────────────────────────────────────
  onOnsiteProjectChange(id: number | null) {
    this.onsiteForm.projectId = id || null;
    const p = this.projects().find(x => x.id === this.onsiteForm.projectId);
    if (p?.address) this.onsiteForm.address = p.address;
  }

  resetToShiftTiming() {
    const shift = this.grid().shifts.find(s => s.id === this.onsiteCtx()?.shiftId);
    this.onsiteForm.startTime = shift?.startTime || '';
    this.onsiteForm.endTime = shift?.endTime || '';
  }

  get onsiteTimeError(): string {
    const { startTime: a, endTime: b } = this.onsiteForm;
    if (!a && !b) return '';
    if (!a || !b) return 'Enter both times, or clear both to use the shift timing.';
    if (a === b) return 'Start and end time cannot be the same.';
    return '';
  }

  get onsiteRangeError(): string {
    if (this.onsiteForm.span !== 'range') return '';
    const { start, end } = this.onsiteForm;
    if (!start || !end) return 'Pick both a start and an end date.';
    if (end < start) return 'The end date is before the start date.';
    return '';
  }

  get onsiteDayCount(): number {
    if (this.onsiteForm.span !== 'range') return 1;
    if (this.onsiteRangeError) return 0;
    const a = Date.parse(`${this.onsiteForm.start}T00:00:00Z`);
    const b = Date.parse(`${this.onsiteForm.end}T00:00:00Z`);
    return Math.round((b - a) / 86400000) + 1;
  }

  get canSubmitOnsite(): boolean {
    const addr = (this.onsiteForm.address || '').trim();
    if (!addr) return false;
    return !this.onsiteTimeError && !this.onsiteRangeError;
  }

  closeOnsite() {
    this.onsiteOpen.set(false);
    this.onsiteCtx.set(null);
    this.onsiteSubmitting.set(false);
  }

  submitOnsite() {
    const ctx = this.onsiteCtx();
    if (!ctx || !this.canSubmitOnsite) return;
    this.onsiteSubmitting.set(true);
    const address = this.onsiteForm.address.trim();

    // Blank means "use the shift's own timing"; the server stores null and
    // getEffectiveShift falls back to the shift.
    const startTime = this.onsiteForm.startTime || null;
    const endTime = this.onsiteForm.endTime || null;
    const projectId = this.onsiteForm.projectId || null;

    if (ctx.source === 'cell' && ctx.row && ctx.cell) {
      const employeeId = ctx.row.employee.id;

      // A multi-day stint is the same bulk write, just for one person — no
      // second backend path, and the range semantics stay identical.
      if (this.onsiteForm.span === 'range') {
        const payload: any = {
          employeeIds: [employeeId],
          start: this.onsiteForm.start,
          end: this.onsiteForm.end,
          shiftId: ctx.shiftId,
          skipNonWorkingDays: false,
          overwriteExisting: true,
          projectId,
          address, startTime, endTime,
        };
        this.shiftsService.bulkAssignRoster(payload).subscribe({
          next: (r) => {
            this.toast.success(`Rostered on-site for ${r.written} day(s)`);
            this.closeOnsite();
            this.closeEditor();
            this.load();
          },
          error: (e) => { this.toast.error(e.error?.message || 'Failed to update roster'); this.onsiteSubmitting.set(false); },
        });
        return;
      }

      const payload: RosterAssignmentPayload = {
        employeeId,
        date: ctx.cell.date,
        shiftId: ctx.shiftId,
        projectId,
        address, startTime, endTime,
      };
      this.shiftsService.assignRoster(payload).subscribe({
        next: () => {
          this.toast.success('Roster updated');
          this.closeOnsite();
          this.closeEditor();
          this.load();
        },
        error: (e) => { this.toast.error(e.error?.message || 'Failed to update roster'); this.onsiteSubmitting.set(false); },
      });
      return;
    }

    if (ctx.source === 'bulk' && ctx.bulk) {
      const b = ctx.bulk;
      const payload: any = {
        employeeIds: b.employeeIds,
        start: b.start, end: b.end,
        shiftId: ctx.shiftId,
        skipNonWorkingDays: b.skipNonWorkingDays,
        overwriteExisting: b.overwriteExisting,
        projectId,
        address, startTime, endTime,
      };
      this.shiftsService.bulkAssignRoster(payload).subscribe({
        next: (r) => {
          this.toast.success(`Rostered ${r.written} day(s)`);
          this.closeOnsite();
          this.closeBulk();
          this.load();
        },
        error: (e) => { this.toast.error(e.error?.message || 'Bulk assign failed'); this.onsiteSubmitting.set(false); },
      });
      return;
    }

    this.onsiteSubmitting.set(false);
  }

  // ── on-site approvals (Administrator / HR) ─────────────────────────────
  refreshApprovals() {
    if (this.isApprover) this.loadPendingOnsite();
  }

  loadPendingOnsite() {
    this.shiftsService.getOnsitePending().subscribe({
      next: (r) => this.pendingOnsite.set(r || []),
      error: () => this.pendingOnsite.set([]),
    });
  }

  openApprovals() {
    this.loadPendingOnsite();
    this.approvalsOpen.set(true);
  }

  closeApprovals() { this.approvalsOpen.set(false); }

  resolveOnsiteApproval(entryId: number, action: 'APPROVED' | 'REJECTED') {
    this.shiftsService.resolveOnsiteApproval(entryId, action).subscribe({
      next: () => {
        this.toast.success(action === 'APPROVED' ? 'On-site request approved' : 'On-site request rejected');
        this.loadPendingOnsite();
        this.load();
      },
      error: (e) => this.toast.error(e.error?.message || 'Failed to resolve request'),
    });
  }

  // ── bulk ────────────────────────────────────────────────────────────────
  bulkEmpSearch = signal('');
  /** Department chip in the bulk modal; '' = everyone. */
  bulkDept = signal('');
  /** Right pane: everyone in the department, or only who is ticked. */
  bulkView = signal<'all' | 'selected'>('all');

  /** Everyone in the chosen department (or all), for the "All users" tab. */
  bulkDeptTotal = computed(() => {
    const dept = this.bulkDept();
    return dept
      ? this.visibleRows().filter(r => (r.employee.department || 'No department') === dept).length
      : this.visibleRows().length;
  });

  /** How many ticked in a department, for the left pane. */
  selectedInDept(name: string): number {
    const sel = this.bulkSelection();
    return this.visibleRows().filter(r =>
      (r.employee.department || 'No department') === name && sel.has(r.employee.id)).length;
  }

  /** Department chips with head-counts, from the people on the roster. */
  bulkDeptChips = computed(() => {
    const counts = new Map<string, number>();
    for (const r of this.visibleRows()) {
      const d = r.employee.department || 'No department';
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
  });

  /** "12 people × 7 days" for the footer, so the reach is clear before applying. */
  get bulkSummary(): string {
    const people = this.bulkSelection().size;
    const days = this.bulkDayCount;
    if (!people || !days) return '';
    return `${people} ${people === 1 ? 'person' : 'people'} × ${days} ${days === 1 ? 'day' : 'days'}`
      + ` · up to ${people * days} roster entries`;
  }

  filteredBulkRows = computed(() => {
    const q = this.bulkEmpSearch().toLowerCase().trim();
    const dept = this.bulkDept();
    let rows = this.visibleRows();
    if (this.bulkView() === 'selected') {
      const sel = this.bulkSelection();
      rows = rows.filter(r => sel.has(r.employee.id));
    }
    if (dept) rows = rows.filter(r => (r.employee.department || 'No department') === dept);
    if (!q) return rows;
    return rows.filter(r =>
      r.employee.name.toLowerCase().includes(q) ||
      (r.employee.designation && r.employee.designation.toLowerCase().includes(q)) ||
      (r.employee.department && r.employee.department.toLowerCase().includes(q))
    );
  });

  get bulkDayCount(): number {
    if (!this.bulkForm.start || !this.bulkForm.end) return 0;
    const a = Date.parse(`${this.bulkForm.start}T00:00:00Z`);
    const b = Date.parse(`${this.bulkForm.end}T00:00:00Z`);
    if (isNaN(a) || isNaN(b) || b < a) return 0;
    return Math.round((b - a) / 86400000) + 1;
  }

  setBulkPreset(preset: 'this_week' | 'next_week' | 'this_month') {
    const now = new Date();
    if (preset === 'this_week') {
      const mon = this.startOfWeek(now);
      const sun = new Date(mon);
      sun.setUTCDate(sun.getUTCDate() + 6);
      this.bulkForm.start = this.fmt(mon);
      this.bulkForm.end = this.fmt(sun);
    } else if (preset === 'next_week') {
      const nextMon = this.startOfWeek(now);
      nextMon.setUTCDate(nextMon.getUTCDate() + 7);
      const nextSun = new Date(nextMon);
      nextSun.setUTCDate(nextSun.getUTCDate() + 6);
      this.bulkForm.start = this.fmt(nextMon);
      this.bulkForm.end = this.fmt(nextSun);
    } else if (preset === 'this_month') {
      const first = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
      const last = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0));
      this.bulkForm.start = this.fmt(first);
      this.bulkForm.end = this.fmt(last);
    }
  }

  openBulk() {
    this.bulkForm = {
      shiftId: this.grid().shifts[0]?.id ?? null,
      isDayOff: false,
      start: this.fmt(this.rangeStart()),
      end: this.fmt(this.rangeEnd()),
      skipNonWorkingDays: true,
      overwriteExisting: true,
    };
    this.bulkEmpSearch.set('');
    this.bulkDept.set('');
    this.bulkView.set('all');
    this.bulkSelection.set(new Set());
    this.bulkOpen.set(true);
  }

  closeBulk() { this.bulkOpen.set(false); }

  isSelected(id: number) { return this.bulkSelection().has(id); }

  toggleSelected(id: number) {
    const next = new Set(this.bulkSelection());
    next.has(id) ? next.delete(id) : next.add(id);
    this.bulkSelection.set(next);
  }

  toggleAllSelected() {
    const rows = this.visibleRows();
    this.bulkSelection.set(
      this.bulkSelection().size === rows.length ? new Set() : new Set(rows.map(r => r.employee.id)));
  }

  selectAllFiltered() {
    const current = new Set(this.bulkSelection());
    this.filteredBulkRows().forEach(r => current.add(r.employee.id));
    this.bulkSelection.set(current);
  }

  deselectAllFiltered() {
    const current = new Set(this.bulkSelection());
    this.filteredBulkRows().forEach(r => current.delete(r.employee.id));
    this.bulkSelection.set(current);
  }

  submitBulk() {
    const ids = [...this.bulkSelection()];
    if (!ids.length) { this.toast.error('Select at least one employee'); return; }
    const shiftId = this.bulkForm.isDayOff ? null : Number(this.bulkForm.shiftId);

    // On-site shift → ask for the project / address before applying the bulk.
    const shift = this.grid().shifts.find(s => s.id === shiftId);
    if (!this.bulkForm.isDayOff && shift && this.isOnSiteShift(shift)) {
      this.resetOnsiteForm(this.bulkForm.start, shift);
      this.onsiteCtx.set({
        source: 'bulk',
        shiftId: shift.id,
        shiftName: shift.name,
        bulk: {
          employeeIds: ids,
          start: this.bulkForm.start,
          end: this.bulkForm.end,
          skipNonWorkingDays: this.bulkForm.skipNonWorkingDays,
          overwriteExisting: this.bulkForm.overwriteExisting,
        },
      });
      this.onsiteOpen.set(true);
      return;
    }

    this.shiftsService.bulkAssignRoster({
      employeeIds: ids,
      start: this.bulkForm.start,
      end: this.bulkForm.end,
      shiftId,
      isDayOff: this.bulkForm.isDayOff,
      skipNonWorkingDays: this.bulkForm.skipNonWorkingDays,
      overwriteExisting: this.bulkForm.overwriteExisting,
    }).subscribe({
      next: (r) => {
        this.toast.success(`Rostered ${r.written} day(s)${r.skipped ? `, ${r.skipped} left alone` : ''}`);
        this.closeBulk();
        this.load();
      },
      error: (e) => this.toast.error(e.error?.message || 'Bulk assign failed'),
    });
  }

  clearSelectedRange() {
    const ids = [...this.bulkSelection()];
    if (!ids.length) { this.toast.error('Select at least one employee'); return; }
    if (!confirm(`Clear rostered shifts for ${ids.length} employee(s) between ${this.bulkForm.start} and ${this.bulkForm.end}? They fall back to their standing shift.`)) return;
    this.shiftsService.clearRoster({ employeeIds: ids, start: this.bulkForm.start, end: this.bulkForm.end })
      .subscribe({
        next: (r) => { this.toast.success(`Cleared ${r.cleared} entr(ies)`); this.closeBulk(); this.load(); },
        error: (e) => this.toast.error(e.error?.message || 'Clear failed'),
      });
  }

  trackDay = (_: number, d: string) => d;
  trackCell = (_: number, c: RosterCell) => c.date;
  trackRow = (_: number, r: RosterRow) => r.employee.id;
}
