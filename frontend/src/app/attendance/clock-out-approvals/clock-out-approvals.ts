import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HotToastService } from '@ngneat/hot-toast';
import { firstValueFrom } from 'rxjs';
import {
  LucideInbox, LucideClock, LucideCheck, LucideX, LucidePaperclip,
  LucideAlertCircle, LucideRefreshCw, LucideCalendarDays, LucideSearch,
  LucideCheckCircle2, LucideAlertTriangle, LucideExternalLink,
  LucideLayers, LucideSparkles, LucideBuilding, LucideArrowUpDown,
  LucideCheckCheck
} from '@lucide/angular';
import { AttendanceService } from '../../services/attendance';
import { DialogService } from '../../shared/services/dialog.service';
import { AttendanceFilterDrawerComponent, AttendanceFilterValue, AttendanceDatePreset } from '../../shared/components/attendance-filter-drawer/attendance-filter-drawer';

/**
 * §Att5: Enhanced Late Clock-out Approval Queue.
 *
 * Every row here is somebody's attendance record sitting in limbo. The company
 * chose to block rather than flag, which means an unanswered row is a day that
 * does not count and, at month end, pay that does not happen — so the page is
 * built to be emptied with clarity, priority triage, and zero friction.
 */
@Component({
  selector: 'app-clock-out-approvals',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    LucideInbox, LucideClock, LucideCheck, LucideX, LucidePaperclip,
    LucideAlertCircle, LucideRefreshCw, LucideCalendarDays, LucideSearch,
    LucideCheckCircle2, LucideAlertTriangle, LucideExternalLink,
    LucideLayers, LucideSparkles, LucideBuilding, LucideArrowUpDown,
    LucideCheckCheck
    , AttendanceFilterDrawerComponent
  ],
  templateUrl: './clock-out-approvals.html',
  styleUrls: ['./clock-out-approvals.css'],
})
export class ClockOutApprovalsComponent implements OnInit {
  private attendanceService = inject(AttendanceService);
  private dialog = inject(DialogService);
  private toast = inject(HotToastService);

  rows = signal<any[]>([]);
  isLoading = signal(false);
  canApprove = signal<boolean | null>(null);
  busyId = signal<number | null>(null);
  isBatchApproving = signal(false);

  search = signal('');
  filterDrawerOpen = signal(false);
  filterStartDate = signal('');
  filterEndDate = signal('');
  filterDatePreset = signal<AttendanceDatePreset>('ALL');
  filterDepartment = signal('');
  filterProofStatus = signal('');
  filterTab = signal<'ALL' | 'URGENT' | 'RECENT' | 'HAS_PROOF'>('ALL');
  sortOrder = signal<'OLDEST' | 'NEWEST'>('OLDEST');

  get approvalFilterGroups() {
    const departments = [...new Set(
      [...this.rows(), ...this.geoRows()]
        .map((row) => row.employee?.department?.name || row.employee?.department)
        .filter((name): name is string => typeof name === 'string' && !!name),
    )].sort((a, b) => a.localeCompare(b));
    return [
      {
        key: 'department',
        label: 'Department',
        placeholder: 'All departments',
        options: departments.map((name) => ({ value: name, label: name })),
      },
      {
        key: 'proof',
        label: 'Supporting evidence',
        placeholder: 'With or without attachment',
        options: [
          { value: 'HAS_PROOF', label: 'Has attachment' },
          { value: 'NO_PROOF', label: 'No attachment' },
        ],
      },
    ];
  }

  get approvalFilterValues(): Record<string, string> {
    return { department: this.filterDepartment(), proof: this.filterProofStatus() };
  }

  get activeApprovalFilterCount(): number {
    return Number(!!this.filterStartDate() || !!this.filterEndDate())
      + Number(!!this.search().trim())
      + Number(!!this.filterDepartment())
      + Number(!!this.filterProofStatus());
  }

  // Computed KPI statistics
  totalCount = computed(() => this.rows().length);
  staleCount = computed(() => this.rows().filter(r => this.isStale(r)).length);
  recentCount = computed(() => this.rows().filter(r => !this.isStale(r)).length);
  proofCount = computed(() => this.rows().filter(r => !!r.clockOutProofUrl).length);

  // ── B3: clock-ins / clock-outs outside the office radius ─────────────────
  geoCanApprove = signal(false);
  geoRows = signal<any[]>([]);
  geoBusyId = signal<number | null>(null);
  visibleGeoRows = computed(() => this.geoRows().filter(row => this.matchesFilter(row)));

  private matchesFilter(row: any): boolean {
    const query = this.search().trim().toLowerCase();
    const name = this.employeeName(row).toLowerCase();
    const employeeId = String(row.employee?.id ?? row.employeeId ?? '');
    const employeeCode = String(row.employee?.employeeCode ?? '').toLowerCase();
    const department = row.employee?.department?.name ?? row.employee?.department ?? '';
    if (query && !name.includes(query) && !employeeId.includes(query) && !employeeCode.includes(query)
      && !String(department).toLowerCase().includes(query)) return false;
    if (this.filterDepartment() && department !== this.filterDepartment()) return false;
    const date = String(row.date ?? '').slice(0, 10);
    return (!this.filterStartDate() || date >= this.filterStartDate())
      && (!this.filterEndDate() || date <= this.filterEndDate());
  }

  loadGeofence(): void {
    this.attendanceService.getPendingGeofence().subscribe({
      next: (rows) => this.geoRows.set(rows || []),
      error: () => this.geoRows.set([]),
    });
  }

  /** "In 2.31 km away · Out 0.40 km away", for the card. */
  geoSummary(row: any): string {
    const part = (label: string, outside: boolean, km: number | null) =>
      outside ? `${label} ${km == null ? 'no GPS' : km.toFixed(2) + ' km away'}` : '';
    return [part('In', row.clockInOutside, row.clockInDistanceKm), part('Out', row.clockOutOutside, row.clockOutDistanceKm)]
      .filter(Boolean).join(' · ');
  }

  async decideGeofence(row: any, action: 'APPROVE' | 'REJECT'): Promise<void> {
    if (this.geoBusyId() !== null) return;
    let note: string | undefined;
    if (action === 'REJECT') {
      const typed = await this.dialog.prompt(
        `Rejecting ${this.employeeName(row)}'s out-of-office clock on ${this.formatDate(row.date)}. `
          + 'The day stays as recorded and is flagged; tell them why — they will see this.',
        'Reason for rejection',
        { placeholder: 'e.g. No client visit was scheduled that day', confirmLabel: 'Reject', required: true },
      );
      if (!typed?.trim()) return;
      note = typed.trim();
    }
    this.geoBusyId.set(row.id);
    this.attendanceService.reviewGeofence(row.id, action, note).subscribe({
      next: () => {
        this.geoRows.update((rs) => rs.filter((r) => r.id !== row.id));
        this.geoBusyId.set(null);
        this.toast.success(action === 'APPROVE' ? 'Approved' : 'Rejected — the day is flagged');
      },
      error: (err) => {
        this.geoBusyId.set(null);
        this.toast.error(err?.error?.message || 'Could not record that decision');
        this.loadGeofence();
      },
    });
  }

  ngOnInit(): void {
    this.attendanceService.canApproveGeofence().subscribe({
      next: (res) => {
        this.geoCanApprove.set(!!res?.canApprove);
        if (res?.canApprove) this.loadGeofence();
      },
      error: () => this.geoCanApprove.set(false),
    });
    this.attendanceService.canApproveClockOuts().subscribe({
      next: (res) => {
        this.canApprove.set(!!res?.canApprove);
        if (res?.canApprove) this.load();
      },
      error: () => this.canApprove.set(false),
    });
  }

  load(): void {
    this.isLoading.set(true);
    this.attendanceService.getPendingClockOuts().subscribe({
      next: (data) => {
        this.rows.set(data ?? []);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.isLoading.set(false);
        this.toast.error(err?.error?.message || 'Could not load the approval queue');
      },
    });
  }

  visibleRows = computed(() => {
    const q = this.search().toLowerCase().trim();
    const tab = this.filterTab();
    let list = this.rows();

    if (tab === 'URGENT') {
      list = list.filter(r => this.isStale(r));
    } else if (tab === 'RECENT') {
      list = list.filter(r => !this.isStale(r));
    } else if (tab === 'HAS_PROOF') {
      list = list.filter(r => !!r.clockOutProofUrl);
    }
    const proof = this.filterProofStatus();
    if (proof === 'HAS_PROOF') list = list.filter(r => !!r.clockOutProofUrl);
    else if (proof === 'NO_PROOF') list = list.filter(r => !r.clockOutProofUrl);

    if (q) {
      list = list.filter((r) => {
        const name = `${r.employee?.firstName ?? ''} ${r.employee?.lastName ?? ''}`.toLowerCase();
        return name.includes(q)
          || String(r.employee?.id ?? r.employeeId ?? '').includes(q)
          || (r.employee?.employeeCode ?? '').toLowerCase().includes(q)
          || (r.employee?.department?.name ?? '').toLowerCase().includes(q)
          || (r.employee?.designation ?? '').toLowerCase().includes(q)
          || (r.clockOutReason ?? '').toLowerCase().includes(q);
      });
    }

    const from = this.filterStartDate();
    const to = this.filterEndDate();
    if (from || to) {
      list = list.filter(r => {
        const date = String(r.date ?? '').slice(0, 10);
        return !!date && (!from || date >= from) && (!to || date <= to);
      });
    }

    const order = this.sortOrder();
    return [...list].sort((a, b) => {
      const dateA = new Date(a.date).getTime() || 0;
      const dateB = new Date(b.date).getTime() || 0;
      return order === 'OLDEST' ? dateA - dateB : dateB - dateA;
    });
  });

  applyAttendanceFilters(filters: AttendanceFilterValue): void {
    this.filterStartDate.set(filters.startDate);
    this.filterEndDate.set(filters.endDate);
    this.filterDatePreset.set(filters.preset);
    this.search.set(filters.employeeQuery);
    this.filterDepartment.set(filters.filters['department'] || '');
    this.filterProofStatus.set(filters.filters['proof'] || '');
    this.filterDrawerOpen.set(false);
  }

  setFilterTab(tab: 'ALL' | 'URGENT' | 'RECENT' | 'HAS_PROOF'): void {
    this.filterTab.set(tab);
  }

  toggleSortOrder(): void {
    this.sortOrder.update(curr => curr === 'OLDEST' ? 'NEWEST' : 'OLDEST');
  }

  clearFilters(): void {
    this.search.set('');
    this.filterTab.set('ALL');
    this.filterStartDate.set('');
    this.filterEndDate.set('');
    this.filterDatePreset.set('ALL');
    this.filterDepartment.set('');
    this.filterProofStatus.set('');
  }

  employeeName(row: any): string {
    return `${row.employee?.firstName ?? ''} ${row.employee?.lastName ?? ''}`.trim() || 'Unknown employee';
  }

  initials(row: any): string {
    const f = row.employee?.firstName?.[0] ?? '';
    const l = row.employee?.lastName?.[0] ?? '';
    return (f + l).toUpperCase() || '?';
  }

  getAvatarColor(name: string): string {
    if (!name) return '#6366f1';
    const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f97316', '#10b981', '#06b6d4', '#3b82f6'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  waitingDays(row: any): number {
    const day = new Date(row.date);
    if (isNaN(day.getTime())) return 0;
    const ms = Date.now() - day.getTime();
    return Math.max(0, Math.floor(ms / 86400000));
  }

  isStale(row: any): boolean {
    return this.waitingDays(row) >= 7;
  }

  sessionDuration(row: any): string {
    if (!row.clockIn || !row.clockOut) return '—';
    const inTime = new Date(row.clockIn).getTime();
    const outTime = new Date(row.clockOut).getTime();
    if (isNaN(inTime) || isNaN(outTime) || outTime <= inTime) return '—';
    const diffMins = Math.round((outTime - inTime) / 60000);
    const h = Math.floor(diffMins / 60);
    const m = diffMins % 60;
    if (h >= 24) {
      const days = Math.floor(h / 24);
      const remH = h % 24;
      return `${days}d ${remH}h ${m}m`;
    }
    return `${h}h ${m}m`;
  }

  approve(row: any): void {
    this.decide(row, 'APPROVE');
  }

  async reject(row: any): Promise<void> {
    const note = await this.dialog.prompt(
      `Rejecting ${this.employeeName(row)}'s clock-out for ${this.formatDate(row.date)}. Tell them why — they will see this.`,
      'Reason for rejection',
      {
        placeholder: 'e.g. Site records show you left at 17:00, not 21:00',
        confirmLabel: 'Reject clock-out',
        required: true,
      },
    );
    if (!note) return;
    this.decide(row, 'REJECT', note);
  }

  private decide(row: any, action: 'APPROVE' | 'REJECT', note?: string): void {
    if (this.busyId() !== null || this.isBatchApproving()) return;
    this.busyId.set(row.id);

    this.attendanceService.reviewClockOut(row.id, action, note).subscribe({
      next: () => {
        this.rows.update((rs) => rs.filter((r) => r.id !== row.id));
        this.busyId.set(null);
        this.toast.success(
          action === 'APPROVE'
            ? `Approved ${this.employeeName(row)}'s clock-out`
            : `Rejected ${this.employeeName(row)}'s clock-out`,
        );
      },
      error: (err) => {
        this.busyId.set(null);
        this.toast.error(err?.error?.message || 'Could not record that decision');
        this.load();
      },
    });
  }

  async approveAllVisible(): Promise<void> {
    const items = this.visibleRows();
    if (!items.length || this.isBatchApproving()) return;

    const confirmed = await this.dialog.confirm(
      `Are you sure you want to approve all ${items.length} clock-out requests currently displayed? They will immediately count towards attendance and payroll.`,
      'Approve All Shown',
      `Approve ${items.length} Requests`,
      'Cancel'
    );
    if (!confirmed) return;

    this.isBatchApproving.set(true);
    let succeeded = 0;
    for (const item of items) {
      try {
        await firstValueFrom(this.attendanceService.reviewClockOut(item.id, 'APPROVE'));
        succeeded++;
      } catch (err) {
        console.error('Failed to approve', item.id, err);
      }
    }

    this.isBatchApproving.set(false);
    this.toast.success(`Successfully approved ${succeeded} clock-out request${succeeded === 1 ? '' : 's'}`);
    this.load();
  }

  formatDate(value: string | Date): string {
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  formatTime(value: string | Date | null | undefined): string {
    if (!value) return '—';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
}
