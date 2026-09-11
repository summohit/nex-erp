import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AgGridModule } from 'ag-grid-angular';
import { ColDef, GridApi, GridReadyEvent, AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucideDownload, LucideRefreshCw, LucideX,
  LucideTriangleAlert, LucideCalendarDays,
} from '@lucide/angular';

import { LeavesService, QuotaReport, QuotaRow } from '../../services/leaves';

ModuleRegistry.registerModules([AllCommunityModule]);

@Component({
  selector: 'app-leave-quota',
  standalone: true,
  imports: [
    CommonModule, FormsModule, AgGridModule,
    LucideDownload, LucideRefreshCw, LucideX, LucideTriangleAlert, LucideCalendarDays,
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

    return report.rows
      .filter((r) =>
        !term ||
        r.employee.name.toLowerCase().includes(term) ||
        (r.employee.employeeCode ?? '').toLowerCase().includes(term) ||
        (r.employee.department ?? '').toLowerCase().includes(term),
      )
      .map((r) => {
        const cell = this.cellFor(r);
        return {
          ...r,
          allocated: cell.allocated,
          used: cell.used,
          carriedOver: cell.carriedOver,
          remaining: cell.remaining,
          // Entitlement is what they were given plus what rolled in; used
          // against that is the only utilisation figure that means anything.
          utilisation: cell.allocated + cell.carriedOver > 0
            ? (cell.used / (cell.allocated + cell.carriedOver)) * 100
            : 0,
        };
      });
  });

  summary = computed(() => {
    const rows = this.rows();
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
      utilisation: entitlement > 0 ? (totals.used / entitlement) * 100 : 0,
      // Nobody can take leave they were never allocated, so this is the row
      // that actually needs fixing before the report means anything.
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

  // ── grid ───────────────────────────────────────────────────────────────────

  columnDefs: ColDef[] = [
    {
      field: 'employee.name',
      headerName: 'EMPLOYEE',
      flex: 1,
      minWidth: 220,
      maxWidth: 380,
      pinned: 'left',
      cellRenderer: (p: any) => {
        const e = p.data?.employee;
        if (!e) return '';
        const initials = (e.name || '?').split(' ').map((s: string) => s[0]).slice(0, 2).join('');
        const avatar = e.avatarUrl
          ? `<img class="q-avatar-img" src="${this.escape(e.avatarUrl)}" alt="" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" /><span class="q-avatar" style="display:none;">${this.escape(initials)}</span>`
          : `<span class="q-avatar">${this.escape(initials)}</span>`;
        const sub = [e.designation, e.department].filter(Boolean).join(' · ');
        return `
          <div class="q-emp">
            ${avatar}
            <div class="q-emp-text">
              <span class="q-emp-name">${this.escape(e.name)}${e.isActive ? '' : ' <span class="q-inactive">inactive</span>'}</span>
              <span class="q-emp-sub">${this.escape(sub)}</span>
            </div>
          </div>`;
      },
    },
    { field: 'allocated', headerName: 'ALLOCATED', width: 125, type: 'numericColumn', valueFormatter: (p) => this.days(p.value) },
    { field: 'carriedOver', headerName: 'CARRIED IN', width: 125, type: 'numericColumn', valueFormatter: (p) => this.days(p.value) },
    { field: 'used', headerName: 'USED', width: 110, type: 'numericColumn', valueFormatter: (p) => this.days(p.value) },
    {
      field: 'remaining',
      headerName: 'REMAINING',
      width: 135,
      type: 'numericColumn',
      valueFormatter: (p) => this.days(p.value),
      cellClass: (p) => (p.value <= 0 ? 'q-none-left' : p.value <= 2 ? 'q-low-left' : ''),
    },
    {
      field: 'utilisation',
      headerName: 'USED %',
      width: 150,
      cellRenderer: (p: any) => {
        if (p.data?.hasNoBalances) return '<span class="q-muted">no balance set</span>';
        const pct = Math.min(100, Math.max(0, p.value || 0));
        return `
          <div class="q-bar-wrap" title="${pct.toFixed(0)}% of entitlement used">
            <div class="q-bar"><div class="q-bar-fill" style="width:${pct}%"></div></div>
            <span class="q-bar-label">${pct.toFixed(0)}%</span>
          </div>`;
      },
    },
    {
      headerName: '',
      width: 96,
      sortable: false,
      cellRenderer: () => '<button class="q-view-btn" type="button">Breakdown</button>',
      onCellClicked: (p: any) => this.openDetail(p.data),
    },
  ];

  defaultColDef: ColDef = { sortable: true, resizable: true, filter: false };

  onGridReady(e: GridReadyEvent) {
    this.gridApi = e.api;
  }

  exportCsv() {
    if (!this.gridApi) return;
    this.gridApi.exportDataAsCsv({
      fileName: `leave-quota-${this.year()}${this.leaveTypeId() ? '-' + this.slug(this.selectedTypeName()) : ''}.csv`,
      // The Breakdown button would export as empty text, and the progress bar
      // as markup — the raw percentage is what belongs in a spreadsheet.
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
