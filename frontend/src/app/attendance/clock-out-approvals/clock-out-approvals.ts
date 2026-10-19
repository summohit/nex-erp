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
  LucideCheckCheck, LucideMapPin, LucideFilter, LucideList, LucideGrid
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
    LucideCheckCheck, LucideMapPin, LucideFilter, LucideList, LucideGrid
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
  sortOrder = signal<'OLDEST' | 'NEWEST'>('NEWEST');

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
  visibleGeoRows = computed(() => this.geoRows());

  // The out-of-office queue's own filters, page and selection. It can run to
  activeQueueTab = signal<'GEO' | 'LATE'>('GEO');

  // ── Quick date range, shared by both queues ──
  quickRange = signal<'ALL' | 'TODAY' | '30' | '60' | '90' | 'CUSTOM'>('ALL');
  customFrom = signal('');
  customTo = signal('');

  private ymd(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** Today / last 30 / 60 / 90 days / custom — applied to both tabs at once. */
  setQuickRange(range: 'ALL' | 'TODAY' | '30' | '60' | '90' | 'CUSTOM') {
    this.quickRange.set(range);
    let from = '', to = '';
    if (range === 'TODAY') { from = to = this.ymd(new Date()); }
    else if (range === '30' || range === '60' || range === '90') {
      const start = new Date(); start.setDate(start.getDate() - (Number(range) - 1));
      from = this.ymd(start); to = this.ymd(new Date());
    } else if (range === 'CUSTOM') { from = this.customFrom(); to = this.customTo(); }
    this.applyRange(from, to);
  }

  setCustomRange(which: 'from' | 'to', value: string) {
    (which === 'from' ? this.customFrom : this.customTo).set(value || '');
    this.quickRange.set('CUSTOM');
    this.applyRange(this.customFrom(), this.customTo());
  }

  private applyRange(from: string, to: string) {
    this.geoFrom.set(from); this.geoTo.set(to);
    this.filterStartDate.set(from); this.filterEndDate.set(to);
    this.filterDatePreset.set(from || to ? 'CUSTOM' : 'ALL');
    this.geoPage.set(1);
    this.geoSelected.set(new Set());
    this.latePage.set(1);
    this.lateSelected.set(new Set());
  }

  // ── Habitual late-comers KPI: 5+ late days in the last 30 ──
  offenders = signal<{ employee: any; lateDays: number; lastLate: string }[]>([]);
  offendersOpen = signal(false);

  loadOffenders(): void {
    this.attendanceService.getLateOffenders(30, 5).subscribe({
      next: (res) => this.offenders.set(res?.offenders || []),
      error: () => this.offenders.set([]),
    });
  }
  geoTab = signal<'ALL' | 'IN' | 'OUT' | 'BOTH' | 'FAR'>('ALL');
  lateViewMode = signal<'table' | 'cards'>('table');

  // a hundred rows, so it needs more than the page-wide search.
  geoSearch = signal('');
  geoDept = signal('');
  geoType = signal<'ALL' | 'IN' | 'OUT'>('ALL');
  geoDistance = signal<'ALL' | 'NOGPS' | 'LT1' | '1TO10' | '10TO100' | 'GT100'>('ALL');
  geoFrom = signal('');
  geoTo = signal('');
  geoSort = signal<'OLDEST' | 'NEWEST' | 'FARTHEST'>('NEWEST');
  geoPage = signal(1);
  geoPageSize = signal(25);
  geoSelected = signal<Set<number>>(new Set());
  geoBulkBusy = signal(false);

  geoDepartments = computed(() => [...new Set(this.geoRows()
    .map((r) => r.employee?.department?.name).filter(Boolean))].sort() as string[]);

  lateDepartments = computed(() => [...new Set(this.rows()
    .map((r) => r.employee?.department?.name || r.employee?.department).filter((d): d is string => typeof d === 'string' && !!d))].sort());

  geoInCount = computed(() => this.visibleGeoRows().filter((r) => r.clockInOutside).length);
  geoOutCount = computed(() => this.visibleGeoRows().filter((r) => r.clockOutOutside).length);
  geoBothCount = computed(() => this.visibleGeoRows().filter((r) => r.clockInOutside && r.clockOutOutside).length);
  geoFarCount = computed(() => this.visibleGeoRows().filter((r) => {
    const km = this.geoMaxKm(r);
    return km != null && km >= 100;
  }).length);

  /** The farthest the person was, in or out; null when there was no GPS. */
  geoMaxKm(r: any): number | null {
    const kms = [r.clockInOutside ? r.clockInDistanceKm : null, r.clockOutOutside ? r.clockOutDistanceKm : null]
      .filter((k) => k != null) as number[];
    return kms.length ? Math.max(...kms) : null;
  }

  setGeoTab(tab: 'ALL' | 'IN' | 'OUT' | 'BOTH' | 'FAR') {
    this.geoTab.set(tab);
    if (tab === 'ALL') {
      this.geoType.set('ALL');
      this.geoDistance.set('ALL');
    } else if (tab === 'IN') {
      this.geoType.set('IN');
      this.geoDistance.set('ALL');
    } else if (tab === 'OUT') {
      this.geoType.set('OUT');
      this.geoDistance.set('ALL');
    } else if (tab === 'BOTH') {
      this.geoType.set('ALL');
      this.geoDistance.set('ALL');
    } else if (tab === 'FAR') {
      this.geoType.set('ALL');
      this.geoDistance.set('GT100');
    }
    this.geoPage.set(1);
    this.geoSelected.set(new Set());
  }

  geoFiltered = computed(() => {
    const q = this.geoSearch().trim().toLowerCase();
    const dept = this.geoDept(), type = this.geoType(), band = this.geoDistance();
    const from = this.geoFrom(), to = this.geoTo();
    const currentTab = this.geoTab();
    const rows = this.visibleGeoRows().filter((r) => {
      if (currentTab === 'BOTH' && (!r.clockInOutside || !r.clockOutOutside)) return false;
      if (currentTab === 'FAR') {
        const km = this.geoMaxKm(r);
        if (km == null || km < 100) return false;
      }
      if (q) {
        const hay = `${this.employeeName(r)} ${r.employee?.employeeCode ?? ''} ${this.employeeDesignation(r)} `
          + `${this.employeeDepartment(r)} ${r.clockInOutsideReason ?? ''} ${r.clockOutOutsideReason ?? ''}`;
        if (!hay.toLowerCase().includes(q)) return false;
      }
      if (dept && r.employee?.department?.name !== dept) return false;
      if (type === 'IN' && !r.clockInOutside) return false;
      if (type === 'OUT' && !r.clockOutOutside) return false;
      const km = this.geoMaxKm(r);
      if (band === 'NOGPS' && km != null) return false;
      if (band === 'LT1' && !(km != null && km < 1)) return false;
      if (band === '1TO10' && !(km != null && km >= 1 && km < 10)) return false;
      if (band === '10TO100' && !(km != null && km >= 10 && km < 100)) return false;
      if (band === 'GT100' && !(km != null && km >= 100)) return false;
      const day = String(r.date ?? '').slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    });
    const sort = this.geoSort();
    return [...rows].sort((a, b) => sort === 'FARTHEST'
      ? (this.geoMaxKm(b) ?? -1) - (this.geoMaxKm(a) ?? -1)
      : sort === 'NEWEST' ? String(b.date).localeCompare(String(a.date)) : String(a.date).localeCompare(String(b.date)));
  });

  geoPageCount = computed(() => Math.max(1, Math.ceil(this.geoFiltered().length / this.geoPageSize())));
  geoPageRows = computed(() => {
    const size = this.geoPageSize();
    const page = Math.min(this.geoPage(), this.geoPageCount());
    return this.geoFiltered().slice((page - 1) * size, page * size);
  });
  geoRangeLabel = computed(() => {
    const total = this.geoFiltered().length;
    if (!total) return '0 of 0';
    const size = this.geoPageSize();
    const page = Math.min(this.geoPage(), this.geoPageCount());
    const start = (page - 1) * size + 1;
    return `${start}–${Math.min(total, page * size)} of ${total}`;
  });
  geoHasFilters = computed(() => !!(this.geoSearch() || this.geoDept() || this.geoType() !== 'ALL'
    || this.geoDistance() !== 'ALL' || this.geoFrom() || this.geoTo() || this.geoTab() !== 'ALL'));
  geoAllOnPageSelected = computed(() => {
    const rows = this.geoPageRows();
    return rows.length > 0 && rows.every((r) => this.geoSelected().has(r.id));
  });

  /** Any filter change starts again at page one with nothing selected. */
  setGeoFilter(which: string, value: any) {
    ({ search: this.geoSearch, dept: this.geoDept, type: this.geoType, distance: this.geoDistance,
      from: this.geoFrom, to: this.geoTo, sort: this.geoSort } as any)[which].set(value);
    if (which === 'type') {
      if (value === 'IN') this.geoTab.set('IN');
      else if (value === 'OUT') this.geoTab.set('OUT');
      else this.geoTab.set('ALL');
    }
    this.geoPage.set(1);
    this.geoSelected.set(new Set());
  }

  resetGeoFilters() {
    for (const k of ['search', 'dept', 'from', 'to']) this.setGeoFilter(k, '');
    this.setGeoFilter('type', 'ALL');
    this.setGeoFilter('distance', 'ALL');
    this.geoTab.set('ALL');
    this.quickRange.set('ALL');
  }

  goGeoPage(p: number) {
    this.geoPage.set(Math.min(Math.max(1, p), this.geoPageCount()));
    this.geoSelected.set(new Set());
  }

  setGeoPageSize(size: number) {
    this.geoPageSize.set(Number(size) || 25);
    this.geoPage.set(1);
    this.geoSelected.set(new Set());
  }

  toggleGeoRow(id: number) {
    const next = new Set(this.geoSelected());
    next.has(id) ? next.delete(id) : next.add(id);
    this.geoSelected.set(next);
  }

  toggleGeoPage() {
    this.geoSelected.set(this.geoAllOnPageSelected() ? new Set() : new Set(this.geoPageRows().map((r) => r.id)));
  }

  clearGeoSelection() {
    this.geoSelected.set(new Set());
  }

  geoInitials(r: any): string {
    return `${r.employee?.firstName?.[0] ?? ''}${r.employee?.lastName?.[0] ?? ''}`.toUpperCase() || '?';
  }

  geoKmClass(km: number | null): string {
    if (km == null) return 'km-none';
    return km < 1 ? 'km-near' : km < 10 ? 'km-mid' : km < 100 ? 'km-far' : 'km-xfar';
  }

  /** Approve or reject every ticked row; one reason covers all the rejections. */
  async decideGeofenceBulk(action: 'APPROVE' | 'REJECT'): Promise<void> {
    const ids = [...this.geoSelected()];
    if (!ids.length || this.geoBulkBusy()) return;
    let note: string | undefined;
    if (action === 'REJECT') {
      const typed = await this.dialog.prompt(
        `Rejecting ${ids.length} out-of-office clock${ids.length === 1 ? '' : 's'}. The days stay as recorded and are flagged; this reason is shown to each person.`,
        'Reason for rejection',
        { placeholder: 'e.g. Clock in on arrival at the office, not while travelling', confirmLabel: `Reject ${ids.length}`, required: true },
      );
      if (!typed?.trim()) return;
      note = typed.trim();
    } else {
      const ok = await this.dialog.confirm(`Approve ${ids.length} out-of-office clock${ids.length === 1 ? '' : 's'}?`, 'Approve selected', 'Approve', 'Cancel');
      if (!ok) return;
    }
    this.geoBulkBusy.set(true);
    let done = 0, failed = 0;
    for (const id of ids) {
      try {
        await firstValueFrom(this.attendanceService.reviewGeofence(id, action, note));
        done++;
      } catch { failed++; }
    }
    this.geoBulkBusy.set(false);
    this.geoSelected.set(new Set());
    this.loadGeofence();
    if (failed) this.toast.error(`${done} ${action === 'APPROVE' ? 'approved' : 'rejected'}, ${failed} could not be saved`);
    else this.toast.success(`${done} ${action === 'APPROVE' ? 'approved' : 'rejected'}`);
  }

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
        const canGeo = !!res?.canApprove;
        this.geoCanApprove.set(canGeo);
        if (canGeo) {
          this.loadGeofence();
        } else if (this.activeQueueTab() === 'GEO') {
          this.activeQueueTab.set('LATE');
        }
      },
      error: () => {
        this.geoCanApprove.set(false);
        if (this.activeQueueTab() === 'GEO') {
          this.activeQueueTab.set('LATE');
        }
      },
    });
    this.attendanceService.canApproveClockOuts().subscribe({
      next: (res) => {
        this.canApprove.set(!!res?.canApprove);
        if (res?.canApprove) { this.load(); this.loadOffenders(); }
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

  latePage = signal(1);
  latePageSize = signal(25);
  lateSelected = signal<Set<number>>(new Set());

  visibleRows = computed(() => {
    const q = this.search().toLowerCase().trim();
    const tab = this.filterTab();
    const deptFilter = this.filterDepartment();
    let list = this.rows();

    if (tab === 'URGENT') {
      list = list.filter(r => this.isStale(r));
    } else if (tab === 'RECENT') {
      list = list.filter(r => !this.isStale(r));
    } else if (tab === 'HAS_PROOF') {
      list = list.filter(r => !!r.clockOutProofUrl);
    }

    if (deptFilter) {
      list = list.filter(r => this.employeeDepartment(r) === deptFilter);
    }

    const proof = this.filterProofStatus();
    if (proof === 'HAS_PROOF') list = list.filter(r => !!r.clockOutProofUrl);
    else if (proof === 'NO_PROOF') list = list.filter(r => !r.clockOutProofUrl);

    if (q) {
      list = list.filter((r) => {
        const name = this.employeeName(r).toLowerCase();
        const firstName = String(r.employee?.firstName ?? '').toLowerCase();
        const lastName = String(r.employee?.lastName ?? '').toLowerCase();
        const empId = String(r.employee?.id ?? r.employeeId ?? '').toLowerCase();
        const empCode = String(r.employee?.employeeCode ?? '').toLowerCase();
        const dept = this.employeeDepartment(r).toLowerCase();
        const desig = this.employeeDesignation(r).toLowerCase();
        const reason = String(r.clockOutReason ?? '').toLowerCase();

        return name.includes(q)
          || firstName.includes(q)
          || lastName.includes(q)
          || empId.includes(q)
          || empCode.includes(q)
          || dept.includes(q)
          || desig.includes(q)
          || reason.includes(q);
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

  latePageCount = computed(() => Math.max(1, Math.ceil(this.visibleRows().length / this.latePageSize())));

  latePageRows = computed(() => {
    const size = this.latePageSize();
    const page = Math.min(this.latePage(), this.latePageCount());
    return this.visibleRows().slice((page - 1) * size, page * size);
  });

  lateRangeLabel = computed(() => {
    const total = this.visibleRows().length;
    if (!total) return '0 of 0';
    const size = this.latePageSize();
    const page = Math.min(this.latePage(), this.latePageCount());
    const start = (page - 1) * size + 1;
    return `${start}–${Math.min(total, page * size)} of ${total}`;
  });

  lateAllOnPageSelected = computed(() => {
    const rows = this.latePageRows();
    return rows.length > 0 && rows.every((r) => this.lateSelected().has(r.id));
  });

  goLatePage(p: number): void {
    this.latePage.set(Math.min(Math.max(1, p), this.latePageCount()));
    this.lateSelected.set(new Set());
  }

  setLatePageSize(size: number): void {
    this.latePageSize.set(Number(size) || 25);
    this.latePage.set(1);
    this.lateSelected.set(new Set());
  }

  toggleLateRow(id: number): void {
    const next = new Set(this.lateSelected());
    next.has(id) ? next.delete(id) : next.add(id);
    this.lateSelected.set(next);
  }

  toggleLatePage(): void {
    this.lateSelected.set(this.lateAllOnPageSelected() ? new Set() : new Set(this.latePageRows().map((r) => r.id)));
  }

  clearLateSelection(): void {
    this.lateSelected.set(new Set());
  }

  hasActiveLateFilters = computed(() => {
    return !!(
      this.search().trim() ||
      this.filterTab() !== 'ALL' ||
      this.filterStartDate() ||
      this.filterEndDate() ||
      this.filterDepartment() ||
      this.filterProofStatus()
    );
  });

  switchTab(tab: 'GEO' | 'LATE'): void {
    this.activeQueueTab.set(tab);
    this.clearFilters();
    this.resetGeoFilters();
  }

  applyAttendanceFilters(filters: AttendanceFilterValue): void {
    this.filterStartDate.set(filters.startDate);
    this.filterEndDate.set(filters.endDate);
    this.filterDatePreset.set(filters.preset);
    this.search.set(filters.employeeQuery);
    this.filterDepartment.set(filters.filters['department'] || '');
    this.filterProofStatus.set(filters.filters['proof'] || '');
    this.latePage.set(1);
    this.lateSelected.set(new Set());
    this.filterDrawerOpen.set(false);
  }

  setFilterTab(tab: 'ALL' | 'URGENT' | 'RECENT' | 'HAS_PROOF'): void {
    this.filterTab.set(tab);
    this.latePage.set(1);
    this.lateSelected.set(new Set());
  }

  setLateDeptFilter(dept: string): void {
    this.filterDepartment.set(dept || '');
    this.latePage.set(1);
    this.lateSelected.set(new Set());
  }

  onLateSearchChange(val: string): void {
    this.search.set(val);
    this.latePage.set(1);
    this.lateSelected.set(new Set());
  }

  toggleSortOrder(): void {
    this.sortOrder.update(curr => curr === 'OLDEST' ? 'NEWEST' : 'OLDEST');
    this.latePage.set(1);
  }

  clearFilters(): void {
    this.search.set('');
    this.filterTab.set('ALL');
    this.filterStartDate.set('');
    this.filterEndDate.set('');
    this.quickRange.set('ALL');
    this.filterDatePreset.set('ALL');
    this.filterDepartment.set('');
    this.filterProofStatus.set('');
    this.latePage.set(1);
    this.lateSelected.set(new Set());
  }

  employeeName(row: any): string {
    return `${row.employee?.firstName ?? ''} ${row.employee?.lastName ?? ''}`.trim() || 'Unknown employee';
  }

  employeeDesignation(row: any): string {
    const d = row?.employee?.designation;
    if (typeof d === 'string') return d.trim() || 'Staff Member';
    if (d && typeof d === 'object') return d.name || 'Staff Member';
    return 'Staff Member';
  }

  employeeDepartment(row: any): string {
    const d = row?.employee?.department;
    if (typeof d === 'string') return d.trim();
    if (d && typeof d === 'object') return d.name || '';
    return '';
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
        const nextSel = new Set(this.lateSelected());
        if (nextSel.delete(row.id)) this.lateSelected.set(nextSel);
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

  async decideLateBulk(action: 'APPROVE' | 'REJECT'): Promise<void> {
    const ids = [...this.lateSelected()];
    if (!ids.length || this.isBatchApproving()) return;
    let note: string | undefined;
    if (action === 'REJECT') {
      const typed = await this.dialog.prompt(
        `Rejecting ${ids.length} late clock-out request${ids.length === 1 ? '' : 's'}. Tell the employees why — they will see this reason.`,
        'Reason for rejection',
        { placeholder: 'e.g. Please submit valid shift completion proof', confirmLabel: `Reject ${ids.length}`, required: true },
      );
      if (!typed?.trim()) return;
      note = typed.trim();
    } else {
      const ok = await this.dialog.confirm(
        `Approve ${ids.length} selected clock-out request${ids.length === 1 ? '' : 's'}? They will immediately count towards attendance and payroll.`,
        'Approve Selected',
        `Approve ${ids.length}`,
        'Cancel',
      );
      if (!ok) return;
    }

    this.isBatchApproving.set(true);
    let done = 0, failed = 0;
    for (const id of ids) {
      try {
        await firstValueFrom(this.attendanceService.reviewClockOut(id, action, note));
        done++;
      } catch {
        failed++;
      }
    }
    this.isBatchApproving.set(false);
    this.lateSelected.set(new Set());
    this.load();
    if (failed) {
      this.toast.error(`${done} ${action === 'APPROVE' ? 'approved' : 'rejected'}, ${failed} failed`);
    } else {
      this.toast.success(`Successfully ${action === 'APPROVE' ? 'approved' : 'rejected'} ${done} request${done === 1 ? '' : 's'}`);
    }
  }

  async approveAllVisible(): Promise<void> {
    const items = this.latePageRows();
    if (!items.length || this.isBatchApproving()) return;

    const confirmed = await this.dialog.confirm(
      `Are you sure you want to approve all ${items.length} clock-out requests on this page? They will immediately count towards attendance and payroll.`,
      'Approve Page',
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
    this.lateSelected.set(new Set());
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

  /** Where the person worked on the day of the clock-out (19 Oct 2026). */
  whereLabel(row: any): string {
    switch (row?.workType) {
      case 'FIELD_VISIT': return row.fieldVisit?.location ? `Field visit · ${row.fieldVisit.location}` : 'Field visit';
      case 'ON_SITE': return row.project?.name ? `On site · ${row.project.name}` : 'On site';
      case 'OUTSIDE': return 'Outside office / WFH';
      default: return 'Office';
    }
  }
  whereTitle(row: any): string {
    const v = row?.fieldVisit;
    if (!v) return this.whereLabel(row);
    return [v.requestNumber, v.location, v.project?.name].filter(Boolean).join(' · ');
  }
}
