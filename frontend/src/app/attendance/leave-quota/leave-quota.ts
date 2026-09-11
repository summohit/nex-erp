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
  LucideFileText, LucideAlertCircle
} from '@lucide/angular';

import { LeavesService, QuotaReport, QuotaRow } from '../../services/leaves';

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
  ],
  templateUrl: './leave-quota.html',
  styleUrls: ['./leave-quota.css'],
})
export class LeaveQuotaComponent implements OnInit {
  private leavesService = inject(LeavesService);
  private toast = inject(HotToastService);

  loading = signal(true);
  report = signal<QuotaReport | null>(null);

  /** Balances are keyed by year, so the year is the report's primary axis. */
  year = signal<number>(new Date().getFullYear());
  /** null = every leave type, totalled. Otherwise one type's figures. */
  leaveTypeId = signal<number | null>(null);
  search = signal('');
  quickFilter = signal<QuickFilterType>('ALL');

  detailRow = signal<QuotaRow | null>(null);

  private gridApi?: GridApi;

  /** Five years back and one forward covers every realistic report. */
  readonly years = computed(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: 7 }, (_, i) => current + 1 - i);
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

  onYearChange(value: string) {
    this.year.set(Number(value));
    this.load();
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
    return typeId === null ? row.totals : row.byType[typeId] ?? { allocated: 0, used: 0, carriedOver: 0, remaining: 0 };
  }

  rows = computed(() => {
    const report = this.report();
    if (!report) return [];
    const term = this.search().trim().toLowerCase();
    const filter = this.quickFilter();

    return report.rows
      .map((r) => {
        const cell = this.cellFor(r);
        const entitlement = cell.allocated + cell.carriedOver;
        const utilisation = entitlement > 0 ? (cell.used / entitlement) * 100 : 0;
        return {
          ...r,
          allocated: cell.allocated,
          used: cell.used,
          carriedOver: cell.carriedOver,
          remaining: cell.remaining,
          utilisation,
        };
      })
      .filter((r) => {
        // Search filter
        if (term) {
          const matchesTerm =
            r.employee.name.toLowerCase().includes(term) ||
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
        const entitlement = cell.allocated + cell.carriedOver;
        const util = entitlement > 0 ? (cell.used / entitlement) * 100 : 0;
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
        carriedOver: cell.carriedOver,
        used: cell.used,
        remaining: cell.remaining,
      };
    }) : [];

    const totals = rows.reduce(
      (acc, r) => ({
        allocated: acc.allocated + r.allocated,
        carriedOver: acc.carriedOver + r.carriedOver,
        used: acc.used + r.used,
        remaining: acc.remaining + r.remaining,
      }),
      { allocated: 0, carriedOver: 0, used: 0, remaining: 0 },
    );
    const entitlement = totals.allocated + totals.carriedOver;
    return {
      ...totals,
      people: rows.length,
      filteredPeople: this.rows().length,
      utilisation: entitlement > 0 ? (totals.used / entitlement) * 100 : 0,
      missingBalances: rows.filter((r) => r.hasNoBalances).length,
    };
  });

  /** Shown while carry-forward has not run — the remaining column understates. */
  carryForwardPending = computed(() => {
    const report = this.report();
    if (!report) return false;
    const carriesForward = report.leaveTypes.some((t) => t.carryForward);
    return carriesForward && !report.carryForwardApplied;
  });

  selectedTypeName = computed(() => {
    const id = this.leaveTypeId();
    if (id === null) return 'All leave types';
    return this.report()?.leaveTypes.find((t) => t.id === id)?.name ?? 'All leave types';
  });

  // ── grid options matching system standards ───────────────────────────────

  gridOptions: GridOptions = {
    theme: 'legacy' as const,
    animateRows: true,
  };

  columnDefs: ColDef[] = [
    {
      field: 'employee.name',
      headerName: 'Employee',
      flex: 1.5,
      minWidth: 260,
      maxWidth: 420,
      pinned: 'left',
      cellRenderer: (p: any) => {
        const e = p.data?.employee;
        if (!e) return '';
        const name = (e.name || '?').trim();
        const initials = name.split(' ').map((s: string) => s[0]).slice(0, 2).join('').toUpperCase();
        const avatarHtml = e.avatarUrl
          ? `<img src="${this.escape(e.avatarUrl)}" class="avatar-img-sm" alt="" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" /><div class="avatar-circle-sm" style="display:none;">${initials}</div>`
          : `<div class="avatar-circle-sm">${initials}</div>`;
        const sub = [e.designation, e.department].filter(Boolean).join(' · ');
        const code = e.employeeCode ? `<span class="tag-mono">${this.escape(e.employeeCode)}</span>` : '';
        const inactive = e.isActive ? '' : '<span class="status-round status-archived" style="padding: 1px 6px; font-size: 10px;"><span class="status-dot"></span>Inactive</span>';

        return `
          <div class="cell-user-avatar-row">
            ${avatarHtml}
            <div class="user-text-stack">
              <div class="cell-title-bold" style="display: flex; align-items: center; gap: 6px;">
                <span>${this.escape(name)}</span>
                ${inactive}
              </div>
              <div class="cell-subtitle-row">
                ${code}
                <span title="${this.escape(sub)}">${this.escape(sub || 'Staff')}</span>
              </div>
            </div>
          </div>`;
      },
    },
    {
      field: 'allocated',
      headerName: 'Allocated',
      width: 125,
      type: 'numericColumn',
      valueFormatter: (p) => this.days(p.value),
      cellRenderer: (p: any) => `<span class="cell-title-bold" style="font-variant-numeric: tabular-nums;">${this.days(p.value)}</span>`
    },
    {
      field: 'carriedOver',
      headerName: 'Carried In',
      width: 125,
      type: 'numericColumn',
      valueFormatter: (p) => this.days(p.value),
      cellRenderer: (p: any) => {
        if (!p.value || p.value === 0) {
          return '<span style="color: #94A3B8; font-weight: 500;">—</span>';
        }
        return `<span style="color: #7000FF; font-weight: 700; font-variant-numeric: tabular-nums;">+${this.days(p.value)}</span>`;
      }
    },
    {
      field: 'used',
      headerName: 'Used',
      width: 115,
      type: 'numericColumn',
      valueFormatter: (p) => this.days(p.value),
      cellRenderer: (p: any) => `<span class="cell-title-bold" style="font-variant-numeric: tabular-nums;">${this.days(p.value)}</span>`
    },
    {
      field: 'remaining',
      headerName: 'Remaining',
      width: 155,
      type: 'numericColumn',
      valueFormatter: (p) => this.days(p.value),
      cellRenderer: (p: any) => {
        if (p.data?.hasNoBalances) {
          return '<span class="status-round status-archived"><span class="status-dot"></span>Unassigned</span>';
        }
        const val = Number(p.value ?? 0);
        if (val <= 0) {
          return `<span class="status-round status-rejected"><span class="status-dot"></span>${this.days(val)} left</span>`;
        }
        if (val <= 2) {
          return `<span class="status-round status-pending"><span class="status-dot"></span>${this.days(val)} left</span>`;
        }
        return `<span class="status-round status-available"><span class="status-dot"></span>${this.days(val)} left</span>`;
      },
    },
    {
      field: 'utilisation',
      headerName: 'Used %',
      width: 170,
      cellRenderer: (p: any) => {
        if (p.data?.hasNoBalances) {
          return '<span style="color: #94A3B8; font-size: 11.5px;">—</span>';
        }
        const pct = Math.min(100, Math.max(0, p.value || 0));
        let barColor = '#10B981';
        let textColor = '#047857';
        if (pct >= 80) {
          barColor = '#EF4444';
          textColor = '#B91C1C';
        } else if (pct >= 50) {
          barColor = '#F59E0B';
          textColor = '#B45309';
        }

        return `
          <div style="display: flex; align-items: center; gap: 8px; width: 100%; height: 100%;">
            <div style="flex: 1; height: 6px; background: #F1F5F9; border-radius: 9999px; overflow: hidden;">
              <div style="height: 100%; width: ${pct}%; background: ${barColor}; border-radius: 9999px; transition: width 0.3s ease;"></div>
            </div>
            <span style="font-size: 12px; font-weight: 700; color: ${textColor}; min-width: 34px; text-align: right; font-variant-numeric: tabular-nums;">${pct.toFixed(0)}%</span>
          </div>`;
      },
    },
    {
      headerName: 'Action',
      width: 125,
      sortable: false,
      cellRenderer: () => `
        <div style="display: flex; align-items: center; justify-content: center; height: 100%;">
          <button class="btn-view" type="button" title="View leave breakdown">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
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
      columnKeys: ['employee.name', 'allocated', 'carriedOver', 'used', 'remaining', 'utilisation'],
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
      ...(row.byType[t.id] ?? { allocated: 0, used: 0, carriedOver: 0, remaining: 0 }),
    }));
  });

  // ── formatting ─────────────────────────────────────────────────────────────

  /** Half-days are real, so keep the .5 but drop a pointless .0. */
  days(value: number | null | undefined): string {
    const n = Number(value ?? 0);
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
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
