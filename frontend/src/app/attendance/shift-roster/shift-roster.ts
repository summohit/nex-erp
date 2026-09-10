import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucideChevronLeft, LucideChevronRight, LucideX, LucideCalendar,
  LucideRotateCcw, LucideWandSparkles, LucideTrash2, LucideBadgeCheck, LucideXCircle,
} from '@lucide/angular';
import { ShiftsService, RosterAssignmentPayload, RosterCell, RosterGrid, RosterRow, RosterShift } from '../../services/shifts.service';
import { MasterDataService } from '../../services/master-data.service';
import { ProjectsService } from '../../services/projects';
import { AuthService } from '../../services/auth.service';

type ViewMode = 'week' | 'month';

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
    CommonModule, FormsModule, LucideChevronLeft, LucideChevronRight, LucideX,
    LucideCalendar, LucideRotateCcw, LucideWandSparkles, LucideTrash2,
    LucideBadgeCheck, LucideXCircle,
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

  loading = signal(false);
  grid = signal<RosterGrid>({ days: [], shifts: [], rows: [] });
  departments = signal<any[]>([]);
  projects = signal<any[]>([]);
  currentUser = this.authService.currentUser;

  viewMode = signal<ViewMode>('week');
  /** Monday of the displayed week, or the 1st for month view. */
  anchor = signal<Date>(this.startOfWeek(new Date()));
  filterDepartmentId = signal<number | null>(null);
  search = signal('');

  // Cell editor
  editorOpen = signal(false);
  editorRow = signal<RosterRow | null>(null);
  editorCell = signal<RosterCell | null>(null);

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
  noProject = signal(false);
  onsiteSubmitting = signal(false);

  // On-site "No Project" approval queue (Administrator / HR only).
  approvalsOpen = signal(false);
  pendingOnsite = signal<any[]>([]);

  ngOnInit() {
    this.masterData.getDepartments().subscribe({ next: (d: any) => this.departments.set(d || []) });
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
    this.noProject.set(false);
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

  private fmt(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  rangeStart = computed(() => {
    const a = this.anchor();
    return this.viewMode() === 'week' ? a : new Date(a.getFullYear(), a.getMonth(), 1);
  });

  rangeEnd = computed(() => {
    const s = this.rangeStart();
    if (this.viewMode() === 'week') {
      const e = new Date(s); e.setDate(e.getDate() + 6); return e;
    }
    return new Date(s.getFullYear(), s.getMonth() + 1, 0);
  });

  rangeLabel = computed(() => {
    const s = this.rangeStart(), e = this.rangeEnd();
    if (this.viewMode() === 'month') {
      return s.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    }
    const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
    return `${s.toLocaleDateString(undefined, opts)} – ${e.toLocaleDateString(undefined, { ...opts, year: 'numeric' })}`;
  });

  shift(step: number) {
    const a = new Date(this.anchor());
    if (this.viewMode() === 'week') a.setDate(a.getDate() + step * 7);
    else a.setMonth(a.getMonth() + step);
    this.anchor.set(a);
    this.load();
  }

  today() {
    const now = new Date();
    this.anchor.set(this.viewMode() === 'week' ? this.startOfWeek(now) : new Date(now.getFullYear(), now.getMonth(), 1));
    this.load();
  }

  setView(mode: ViewMode) {
    if (this.viewMode() === mode) return;
    this.viewMode.set(mode);
    const now = this.anchor();
    this.anchor.set(mode === 'week' ? this.startOfWeek(now) : new Date(now.getFullYear(), now.getMonth(), 1));
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

  visibleRows = computed(() => {
    const q = this.search().toLowerCase().trim();
    const rows = this.grid().rows;
    if (!q) return rows;
    return rows.filter(r =>
      r.employee.name.toLowerCase().includes(q) ||
      (r.employee.designation || '').toLowerCase().includes(q) ||
      (r.employee.department || '').toLowerCase().includes(q));
  });

  // ── cell presentation ───────────────────────────────────────────────────
  dayLabel(day: string): { num: string; name: string; isToday: boolean; isWeekend: boolean } {
    const d = new Date(`${day}T00:00:00`);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return {
      num: String(d.getDate()),
      name: d.toLocaleDateString(undefined, { weekday: 'short' }),
      isToday: d.getTime() === today.getTime(),
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
    };
  }

  /** Month view has ~31 columns, so it falls back to the short code. */
  cellLabel(cell: RosterCell): string {
    const s = cell.shift;
    if (!s) return '';
    return this.viewMode() === 'month' ? (s.shortCode || s.name) : s.name;
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

  // ── editing ─────────────────────────────────────────────────────────────
  openCell(row: RosterRow, cell: RosterCell) {
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

  toggleNoProject() {
    this.noProject.update(v => !v);
    if (this.noProject()) this.onsiteForm.projectId = null;
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
    if (!this.noProject() && !this.onsiteForm.projectId) return false;
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
          address, startTime, endTime,
        };
        if (this.noProject()) payload.needsApproval = true;
        else payload.projectId = this.onsiteForm.projectId;
        this.shiftsService.bulkAssignRoster(payload).subscribe({
          next: (r) => {
            this.toast.success(this.noProject()
              ? `${r.written} day(s) sent for Administrator & HR approval`
              : `Rostered on-site for ${r.written} day(s)`);
            this.closeOnsite();
            this.closeEditor();
            this.load();
            this.refreshApprovals();
          },
          error: (e) => { this.toast.error(e.error?.message || 'Failed to update roster'); this.onsiteSubmitting.set(false); },
        });
        return;
      }

      const payload: RosterAssignmentPayload = {
        employeeId,
        date: ctx.cell.date,
        shiftId: ctx.shiftId,
        address, startTime, endTime,
      };
      if (this.noProject()) payload.needsApproval = true;
      else payload.projectId = this.onsiteForm.projectId;
      this.shiftsService.assignRoster(payload).subscribe({
        next: () => {
          this.toast.success(this.noProject()
            ? 'Request sent — pending Administrator & HR approval'
            : 'Roster updated');
          this.closeOnsite();
          this.closeEditor();
          this.load();
          this.refreshApprovals();
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
        address, startTime, endTime,
      };
      if (this.noProject()) payload.needsApproval = true;
      else payload.projectId = this.onsiteForm.projectId;
      this.shiftsService.bulkAssignRoster(payload).subscribe({
        next: (r) => {
          this.toast.success(this.noProject()
            ? `Rostered ${r.written} day(s) — on-site (No Project) sent for Administrator & HR approval`
            : `Rostered ${r.written} day(s)`);
          this.closeOnsite();
          this.closeBulk();
          this.load();
          this.refreshApprovals();
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
  openBulk() {
    this.bulkForm = {
      shiftId: this.grid().shifts[0]?.id ?? null,
      isDayOff: false,
      start: this.fmt(this.rangeStart()),
      end: this.fmt(this.rangeEnd()),
      skipNonWorkingDays: true,
      overwriteExisting: true,
    };
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
