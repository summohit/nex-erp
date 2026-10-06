import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AgGridModule } from 'ag-grid-angular';
import { ColDef, GridApi, GridReadyEvent, GridOptions, AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucideDownload, LucideRefreshCw, LucideX,
  LucideTriangleAlert, LucideCalendarDays,
  LucideSearch, LucideClock, LucideCheckCircle2,
  LucideTrendingUp, LucidePieChart, LucideUsers,
  LucideFilter, LucideChevronRight, LucideInfo,
  LucideFileText, LucideAlertCircle, LucideExternalLink
} from '@lucide/angular';

import { LeavesService, QuotaReport, QuotaRow } from '../../services/leaves';
import { AttendanceFilterDrawerComponent, AttendanceFilterValue } from '../../shared/components/attendance-filter-drawer/attendance-filter-drawer';

ModuleRegistry.registerModules([AllCommunityModule]);

export type QuickFilterType = 'ALL' | 'LOW_REMAINING' | 'HIGH_USED' | 'UNASSIGNED';

@Component({
  selector: 'app-leave-quota',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule, AgGridModule,
    LucideDownload, LucideRefreshCw, LucideX, LucideTriangleAlert, LucideCalendarDays,
    LucideSearch, LucideClock, LucideCheckCircle2, LucideTrendingUp, LucidePieChart,
    LucideUsers, LucideFilter, LucideChevronRight, LucideInfo, LucideFileText, LucideAlertCircle,
    LucideExternalLink, AttendanceFilterDrawerComponent,
  ],
  templateUrl: './leave-quota.html',
  styleUrls: ['./leave-quota.css'],
})
export class LeaveQuotaComponent implements OnInit {
  private leavesService = inject(LeavesService);
  private toast = inject(HotToastService);

  loading = signal(true);
  report = signal<QuotaReport | null>(null);

  readonly currentYear = new Date().getFullYear();
  /** Balances are keyed by year, so the year is the report's primary axis. Default is current year. */
  year = signal<number>(new Date().getFullYear());
  /** null = every leave type, totalled. Otherwise one type's figures. */
  leaveTypeId = signal<number | null>(null);
  search = signal('');
  quickFilter = signal<QuickFilterType>('ALL');
  filterDrawerOpen = signal(false);

  detailRow = signal<QuotaRow | null>(null);

  private gridApi?: GridApi;

  /** Current year first, then previous 4 years, and next year */
  readonly years = computed(() => {
    const current = this.currentYear;
    return [current, current - 1, current - 2, current - 3, current - 4, current + 1];
  });

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.leavesService.getQuotaReport(this.year()).subscribe({
      next: (res) => {
        this.report.set(res);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.toast.error(e?.error?.message || 'Could not load the leave quota report.');
      },
    });
  }

  onYearChange(value: any) {
    const num = Number(value);
    if (!isNaN(num) && num !== this.year()) {
      this.year.set(num);
      this.load();
    }
  }

  onLeaveTypeChange(value: any) {
    const num = value === 'null' || value === null || value === undefined ? null : Number(value);
    this.leaveTypeId.set(num);
  }

  /** Keep the report's related decisions in one place. */
  get quotaFilterGroups() {
    return [
      {
        key: 'leaveType',
        label: 'Leave type',
        placeholder: 'All leave types',
        options: (this.report()?.leaveTypes ?? []).map((type) => ({ value: String(type.id), label: type.name })),
      },
      {
        key: 'balanceHealth',
        label: 'Balance health',
        placeholder: 'All balances',
        options: [
          { value: 'LOW_REMAINING', label: 'Low remaining (2 days or less)' },
          { value: 'HIGH_USED', label: 'High utilisation (75% or more)' },
          { value: 'UNASSIGNED', label: 'No balance assigned' },
        ],
      },
    ];
  }

  get quotaFilterValues(): Record<string, string> {
    return {
      leaveType: this.leaveTypeId() === null ? '' : String(this.leaveTypeId()),
      balanceHealth: this.quickFilter() === 'ALL' ? '' : this.quickFilter(),
    };
  }

  get quotaFilterCount(): number {
    return Number(this.leaveTypeId() !== null) + Number(this.quickFilter() !== 'ALL') + Number(!!this.search().trim());
  }

  applyAttendanceFilters(filters: AttendanceFilterValue): void {
    this.search.set(filters.employeeQuery);
    const type = Number(filters.filters['leaveType']);
    this.leaveTypeId.set(Number.isInteger(type) && type > 0 ? type : null);
    const health = filters.filters['balanceHealth'];
    this.quickFilter.set(
      health === 'LOW_REMAINING' || health === 'HIGH_USED' || health === 'UNASSIGNED' ? health : 'ALL',
    );
    this.filterDrawerOpen.set(false);
  }

  setQuickFilter(filter: QuickFilterType) {
    this.quickFilter.set(filter);
  }

  clearFilters() {
    this.search.set('');
    this.leaveTypeId.set(null);
    this.quickFilter.set('ALL');
  }

  // ── the figures being shown ────────────────────────────────────────────────

  /**
   * One employee's numbers for whichever scope is selected — the totals across
   * every leave type, or a single type's cell.
   */
  private cellFor(row: QuotaRow) {
    const typeId = this.leaveTypeId();
    return typeId === null ? row.totals : row.byType[typeId] ?? { allocated: 0, used: 0, remaining: 0, encashed: 0 };
  }

  rows = computed(() => {
    const report = this.report();
    if (!report) return [];
    const term = this.search().trim().toLowerCase();
    const filter = this.quickFilter();

    return report.rows
      .map((r) => {
        const cell = this.cellFor(r);
        const utilisation = cell.allocated > 0 ? (cell.used / cell.allocated) * 100 : 0;
        return {
          ...r,
          allocated: cell.allocated,
          used: cell.used,
          encashed: cell.encashed,
          remaining: cell.remaining,
          utilisation,
        };
      })
      .filter((r) => {
        // Search filter
        if (term) {
          const matchesTerm =
            r.employee.name.toLowerCase().includes(term) ||
            String(r.employee.id).includes(term) ||
            (r.employee.employeeCode ?? '').toLowerCase().includes(term) ||
            (r.employee.department ?? '').toLowerCase().includes(term) ||
            (r.employee.designation ?? '').toLowerCase().includes(term);
          if (!matchesTerm) return false;
        }

        // Quick filter
        if (filter === 'LOW_REMAINING') {
          return !r.hasNoBalances && r.remaining <= 2;
        }
        if (filter === 'HIGH_USED') {
          return !r.hasNoBalances && r.utilisation >= 75;
        }
        if (filter === 'UNASSIGNED') {
          return r.hasNoBalances;
        }

        return true;
      });
  });

  quickFilterCounts = computed(() => {
    const report = this.report();
    if (!report) return { all: 0, lowRemaining: 0, highUsed: 0, unassigned: 0 };
    let lowRemaining = 0;
    let highUsed = 0;
    let unassigned = 0;

    for (const r of report.rows) {
      if (r.hasNoBalances) {
        unassigned++;
      } else {
        const cell = this.cellFor(r);
        const util = cell.allocated > 0 ? (cell.used / cell.allocated) * 100 : 0;
        if (cell.remaining <= 2) lowRemaining++;
        if (util >= 75) highUsed++;
      }
    }

    return {
      all: report.rows.length,
      lowRemaining,
      highUsed,
      unassigned,
    };
  });

  summary = computed(() => {
    const report = this.report();
    const rows = report ? report.rows.map((r) => {
      const cell = this.cellFor(r);
      return {
        ...r,
        allocated: cell.allocated,
        encashed: cell.encashed,
        used: cell.used,
        remaining: cell.remaining,
      };
    }) : [];

    const totals = rows.reduce(
      (acc, r) => ({
        allocated: acc.allocated + r.allocated,
        encashed: acc.encashed + r.encashed,
        used: acc.used + r.used,
        remaining: acc.remaining + r.remaining,
      }),
      { allocated: 0, encashed: 0, used: 0, remaining: 0 },
    );
    return {
      ...totals,
      people: rows.length,
      filteredPeople: this.rows().length,
      utilisation: totals.allocated > 0 ? (totals.used / totals.allocated) * 100 : 0,
      missingBalances: rows.filter((r) => r.hasNoBalances).length,
    };
  });

  /**
   * Nothing carries into next year, so what is still unused at the end of this
   * one either gets paid out or is gone. Worth saying while there is still time
   * to take it — and not worth saying once the year has been settled.
   */
  expiryPending = computed(() => {
    const report = this.report();
    if (!report) return false;
    if (report.encashmentSettled) return false;
    return this.summary().remaining > 0;
  });

  /** True once the closing payslip has bought back the year's unused days. */
  encashmentSettled = computed(() => this.report()?.encashmentSettled ?? false);

  /** Whether any type pays out at all — the rest simply expire. */
  hasEncashableTypes = computed(() => this.report()?.leaveTypes.some((t) => t.encashable) ?? false);

  selectedTypeName = computed(() => {
    const id = this.leaveTypeId();
    if (id === null) return 'All leave types';
    return this.report()?.leaveTypes.find((t) => t.id === id)?.name ?? 'All leave types';
  });

  // ── grid options matching system standards ───────────────────────────────

  gridOptions: GridOptions = {
    theme: 'legacy' as const,
    animateRows: true,
    domLayout: 'autoHeight',
  };

  columnDefs: ColDef[] = [
    {
      field: 'employee.name',
      headerName: 'Employee',
      flex: 1.8,
      minWidth: 230,
      cellRenderer: (p: any) => {
        const e = p.data?.employee;
        if (!e) return '';
        const name = (e.name || '?').trim();
        const initials = name.split(' ').map((s: string) => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'EM';
        const avatarHtml = e.avatarUrl
          ? `<img src="${this.escape(e.avatarUrl)}" class="lq-avatar-img" alt="" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" /><div class="lq-avatar-circle" style="display:none;">${initials}</div>`
          : `<div class="lq-avatar-circle">${initials}</div>`;
        const sub = [e.designation, e.department].filter(Boolean).join(' · ');
        const code = e.employeeCode ? `<span class="lq-code-tag">${this.escape(e.employeeCode)}</span>` : '';
        const inactive = e.isActive ? '' : '<span class="lq-inactive-badge">Inactive</span>';

        return `
          <div class="lq-user-cell">
            ${avatarHtml}
            <div class="lq-user-info">
              <div class="lq-user-name-row">
                <span class="lq-user-name" title="${this.escape(name)}">${this.escape(name)}</span>
                ${inactive}
              </div>
              <div class="lq-user-meta-row">
                ${code}
                <span class="lq-user-sub" title="${this.escape(sub)}">${this.escape(sub || 'Staff')}</span>
              </div>
            </div>
          </div>`;
      },
    },
    {
      field: 'allocated',
      headerName: 'Allocated',
      flex: 0.9,
      minWidth: 105,
      type: 'numericColumn',
      cellRenderer: (p: any) => {
        if (p.data?.hasNoBalances) return '<span class="lq-muted-dash">—</span>';
        return `<span class="lq-num-bold">${this.days(p.value)}</span>`;
      }
    },
    {
      field: 'used',
      headerName: 'Used',
      flex: 0.8,
      minWidth: 80,
      type: 'numericColumn',
      cellRenderer: (p: any) => {
        if (p.data?.hasNoBalances) return '<span class="lq-muted-dash">—</span>';
        const val = Number(p.value ?? 0);
        return `<span class="lq-num-used">${this.days(val)}</span>`;
      }
    },
    {
      field: 'remaining',
      headerName: 'Remaining',
      flex: 1.1,
      minWidth: 125,
      type: 'numericColumn',
      cellRenderer: (p: any) => {
        if (p.data?.hasNoBalances) {
          return '<span class="lq-status-chip unassigned"><span class="lq-dot"></span>Unassigned</span>';
        }
        const val = Number(p.value ?? 0);
        if (val < 0) {
          return `<span class="lq-status-chip overdrawn" title="Overdrawn leave balance by ${Math.abs(val)} days"><span class="lq-dot"></span>${this.days(val)} left</span>`;
        }
        if (val === 0) {
          return `<span class="lq-status-chip zero"><span class="lq-dot"></span>0 left</span>`;
        }
        if (val <= 2) {
          return `<span class="lq-status-chip low" title="Low balance warning"><span class="lq-dot"></span>${this.days(val)} left</span>`;
        }
        return `<span class="lq-status-chip healthy"><span class="lq-dot"></span>${this.days(val)} left</span>`;
      },
    },
    {
      field: 'encashed',
      headerName: 'Encashed',
      flex: 0.9,
      minWidth: 105,
      type: 'numericColumn',
      cellRenderer: (p: any) => {
        const val = Number(p.value ?? 0);
        if (!val) {
          return '<span class="lq-muted-dash">—</span>';
        }
        return `<span class="lq-encashed-tag" title="Paid out with December salary">${this.days(val)}</span>`;
      }
    },
    {
      field: 'utilisation',
      headerName: 'Utilisation',
      flex: 1.3,
      minWidth: 140,
      cellRenderer: (p: any) => {
        if (p.data?.hasNoBalances) {
          return '<span class="lq-muted-dash">—</span>';
        }
        const pct = Math.max(0, p.value || 0);
        const cappedPct = Math.min(100, pct);
        let colorClass = 'green';
        if (pct > 100) colorClass = 'over';
        else if (pct >= 75) colorClass = 'amber';
        else if (pct >= 50) colorClass = 'blue';

        return `
          <div class="lq-progress-cell">
            <div class="lq-progress-track">
              <div class="lq-progress-fill ${colorClass}" style="width: ${cappedPct}%;"></div>
            </div>
            <span class="lq-progress-label ${colorClass}">${pct.toFixed(0)}%</span>
          </div>`;
      },
    },
    {
      headerName: 'Action',
      flex: 0.9,
      minWidth: 110,
      sortable: false,
      cellRenderer: () => `
        <div class="lq-action-cell">
          <button class="lq-btn-breakdown" type="button" title="View detailed leave breakdown">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            <span>Breakdown</span>
          </button>
        </div>`,
      onCellClicked: (p: any) => this.openDetail(p.data),
    },
  ];

  defaultColDef: ColDef = {
    sortable: true,
    resizable: true,
    filter: false,
  };

  onGridReady(e: GridReadyEvent) {
    this.gridApi = e.api;
  }

  exportCsv() {
    if (!this.gridApi) return;
    this.gridApi.exportDataAsCsv({
      fileName: `leave-quota-${this.year()}${this.leaveTypeId() ? '-' + this.slug(this.selectedTypeName()) : ''}.csv`,
      columnKeys: ['employee.name', 'allocated', 'used', 'remaining', 'encashed', 'utilisation'],
    });
  }

  openDetail(row: QuotaRow | null) {
    if (row) this.detailRow.set(row);
  }

  closeDetail() {
    this.detailRow.set(null);
  }

  /** The per-type rows behind one employee's totals. */
  detailLines = computed(() => {
    const row = this.detailRow();
    const report = this.report();
    if (!row || !report) return [];
    return report.leaveTypes.map((t) => ({
      type: t,
      ...(row.byType[t.id] ?? { allocated: 0, used: 0, remaining: 0, encashed: 0 }),
    }));
  });

  // ── formatting ─────────────────────────────────────────────────────────────

  /** Half-days are real, so keep the .5 but drop a pointless .0. */
  days(value: number | null | undefined): string {
    const n = Number(value ?? 0);
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }

  getInitials(name: string | null | undefined): string {
    if (!name) return '?';
    return name.trim().split(' ').map((s) => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
  }

  private slug(s: string) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  private escape(s: string) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
    ));
  }
}
