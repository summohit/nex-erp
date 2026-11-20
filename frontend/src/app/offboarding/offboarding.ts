import { Component, OnInit, inject, signal, computed, effect } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer } from '@angular/platform-browser';
import { environment } from '../../environments/environment';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, AllCommunityModule, ModuleRegistry, GridOptions } from 'ag-grid-community';
import { OffboardingService, Resignation, OffboardingTask, ExitInterview } from '../services/offboarding.service';
import { AuthService } from '../services/auth.service';
import { EmployeeService, Employee } from '../services/employee.service';
import { HotToastService } from '@ngneat/hot-toast';
import { ActivatedRoute } from '@angular/router';
import { PageHeaderComponent } from '../shared/components/page-header/page-header';
import { SearchableSelectComponent, SearchableSelectOption } from '../shared/components/searchable-select/searchable-select.component';
import { DatePresetFilterComponent, DatePreset, DateRange } from '../shared/components/date-preset-filter/date-preset-filter';
import {
  LucideDoorOpen,
  LucideCheckCircle2,
  LucideClock, LucideUserMinus,
  LucideXCircle,
  LucideClipboardCheck,
  LucideX,
  LucideEye,
  LucideMail,
  LucideCalendarDays,
  LucideMessageSquare,
  LucideUserRound,
  LucidePlus,
  LucideSearch,
  LucideRefreshCw
} from '@lucide/angular';

ModuleRegistry.registerModules([AllCommunityModule]);

@Component({
  selector: 'app-offboarding',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    AgGridAngular,
    PageHeaderComponent,
    SearchableSelectComponent,
    DatePresetFilterComponent,
    LucideDoorOpen,
    LucideCheckCircle2,
    LucideClock, LucideUserMinus,
    LucideXCircle,
    LucideClipboardCheck,
    LucideX,
    LucideEye,
    LucideMail,
    LucideCalendarDays,
    LucideMessageSquare,
    LucideUserRound,
    LucidePlus,
    LucideSearch,
    LucideRefreshCw
  ],
  templateUrl: './offboarding.html',
  styleUrls: ['./offboarding.css']
})
export class OffboardingComponent implements OnInit {
  private offboardingService = inject(OffboardingService);
  private authService = inject(AuthService);
  private employeeService = inject(EmployeeService);
  private toast = inject(HotToastService);
  private route = inject(ActivatedRoute);

  activeTab = signal<'resignations' | 'tasks' | 'exit' | 'fnf'>('resignations');

  resignations = signal<Resignation[]>([]);
  tasks = signal<OffboardingTask[]>([]);
  interviews = signal<ExitInterview[]>([]);

  currentUserRole = signal<string>('');
  currentEmployeeId = signal<number>(0);
  private focusedEmployeeId = signal<number | null>(null);

  // Modals
  showResignModal = signal(false);
  resignForm = { reason: '', intendedLastWorkingDay: '' };

  showApproveModal = signal(false);
  approveForm = { id: 0, status: 'APPROVED', approvedLastWorkingDay: '', remarks: '' };

  showResignationDetails = signal(false);
  selectedResignation = signal<Resignation | null>(null);
  inlineStatusBusy = signal<number | null>(null);
  openStatusDropdownId = signal<number | null>(null);
  openActionMenuId = signal<number | null>(null);

  // Pagination & Filters (Resignations)
  resignationPage = signal(1);
  resignationPageSize = signal(20);
  readonly resignationPageSizeOptions = [20, 50, 100, 200];
  resignationSearch = signal('');
  resignationStatusFilter = signal('ALL');
  resignationDatePreset = signal<DatePreset>('ALL');
  resignationDateRange = signal<DateRange>(null);

  // Filters (Clearance Tasks)
  taskSearch = signal('');
  taskStatusFilter = signal('ALL');
  taskDepartmentFilter = signal<string | null>(null);

  // KPI Counts
  pendingResignationCount = computed(() => this.resignations().filter((item) => item.status === 'PENDING').length);
  approvedResignationCount = computed(() => this.resignations().filter((item) => item.status === 'APPROVED').length);
  withdrawnResignationCount = computed(() => this.resignations().filter((item) => item.status === 'WITHDRAWN').length);
  rejectedResignationCount = computed(() => this.resignations().filter((item) => item.status === 'REJECTED').length);
  pendingTaskCount = computed(() => this.tasks().filter((item) => item.status === 'PENDING').length);
  clearedTaskCount = computed(() => this.tasks().filter((item) => item.status === 'CLEARED').length);

  readonly resignationStatusOptions: SearchableSelectOption[] = [
    { id: 'PENDING', name: 'Pending' },
    { id: 'APPROVED', name: 'Approved' },
    { id: 'REJECTED', name: 'Rejected' },
    { id: 'WITHDRAWN', name: 'Withdrawn' }
  ];

  readonly taskStatusOptions: SearchableSelectOption[] = [
    { id: 'PENDING', name: 'Pending' },
    { id: 'CLEARED', name: 'Cleared' }
  ];

  taskDepartmentOptions = computed<SearchableSelectOption[]>(() => {
    const depts = Array.from(new Set(this.tasks().map(t => t.department).filter(Boolean))).sort();
    return depts.map(d => ({ id: d, name: d }));
  });

  hasActiveResignationFilters = computed(() => {
    return !!this.resignationSearch().trim() ||
      this.resignationStatusFilter() !== 'ALL' ||
      this.resignationDatePreset() !== 'ALL' ||
      this.resignationDateRange() !== null;
  });

  hasActiveTaskFilters = computed(() => {
    return !!this.taskSearch().trim() ||
      this.taskStatusFilter() !== 'ALL' ||
      this.taskDepartmentFilter() !== null;
  });

  filteredResignations = computed(() => {
    const query = this.resignationSearch().trim().toLowerCase();
    const status = this.resignationStatusFilter();
    const range = this.resignationDateRange();

    return this.resignations().filter((item) => {
      const matchesStatus = status === 'ALL' || item.status === status;
      const matchesSearch = !query || [
        item.employee?.firstName,
        item.employee?.lastName,
        item.employee?.employeeCode,
        item.employee?.user?.email,
        item.reason,
        item.approver?.email,
        item.status,
      ].some((value) => value?.toLowerCase().includes(query));

      let matchesDate = true;
      if (range && range.from && range.to) {
        const dStr = item.intendedLastWorkingDay || item.createdAt;
        if (!dStr) {
          matchesDate = false;
        } else {
          const t = new Date(dStr).getTime();
          const fromT = new Date(range.from).setHours(0, 0, 0, 0);
          const toT = new Date(range.to).setHours(23, 59, 59, 999);
          matchesDate = t >= fromT && t <= toT;
        }
      }

      return matchesStatus && matchesSearch && matchesDate;
    });
  });

  filteredTasks = computed(() => {
    const q = this.taskSearch().trim().toLowerCase();
    const st = this.taskStatusFilter();
    const dept = this.taskDepartmentFilter();

    return this.tasks().filter((t) => {
      const matchesStatus = st === 'ALL' || t.status === st;
      const matchesDept = !dept || t.department === dept;
      const matchesSearch = !q || [
        t.taskName,
        t.description,
        t.department,
        t.clearedBy?.email,
        t.employee?.userId ? String(t.employee.userId) : ''
      ].some(v => v?.toLowerCase().includes(q));
      return matchesStatus && matchesDept && matchesSearch;
    });
  });

  resignationPageCount = computed(() => Math.max(1, Math.ceil(this.filteredResignations().length / this.resignationPageSize())));
  pagedResignations = computed(() => {
    const page = Math.min(this.resignationPage(), this.resignationPageCount());
    const start = (page - 1) * this.resignationPageSize();
    return this.filteredResignations().slice(start, start + this.resignationPageSize());
  });
  resignationRangeStart = computed(() => this.filteredResignations().length ? (Math.min(this.resignationPage(), this.resignationPageCount()) - 1) * this.resignationPageSize() + 1 : 0);
  resignationRangeEnd = computed(() => Math.min(this.resignationRangeStart() + this.resignationPageSize() - 1, this.filteredResignations().length));

  showTaskModal = signal(false);
  taskForm: { id: number; remarks: string; recoveryAmount: number | null; department?: string } = { id: 0, remarks: '', recoveryAmount: null };

  showInterviewModal = signal(false);
  interviewForm = { employeeId: 0, feedback: '', rating: 3 };
  employees = signal<Employee[]>([]);

  // AG Grid Configuration (Employee Directory Standard)
  readonly paginationPageSize = 20;
  readonly paginationPageSizeSelector = [20, 50, 100, 200];

  readonly defaultColDef: ColDef = {
    sortable: true,
    filter: false,
    resizable: false
  };

  readonly resignationGridOptions: GridOptions = {
    domLayout: 'autoHeight',
    headerHeight: 42,
    rowHeight: 66,
    suppressCellFocus: true,
    suppressHorizontalScroll: false,
    enableCellTextSelection: true,
    onCellClicked: (event: any) => this.onResignationGridCellClicked(event)
  };

  readonly taskGridOptions: GridOptions = {
    domLayout: 'autoHeight',
    headerHeight: 42,
    rowHeight: 62,
    suppressCellFocus: true,
    enableCellTextSelection: true,
    onCellClicked: (event: any) => this.onTaskGridCellClicked(event)
  };

  private esc(v: any): string {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]);
  }

  formatDisplayDate(val?: string | null): string {
    if (!val) return '—';
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) return '—';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }

  statusSentenceCase(status?: string | null): string {
    if (!status) return '—';
    const s = status.toUpperCase();
    if (s === 'PENDING') return 'Pending';
    if (s === 'APPROVED') return 'Approved';
    if (s === 'REJECTED') return 'Rejected';
    if (s === 'WITHDRAWN') return 'Withdrawn';
    if (s === 'CLEARED') return 'Cleared';
    return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
  }

  private statusDot(label: string, tone: 'good' | 'wait' | 'blue' | 'bad' | 'off', title = ''): string {
    const [dot, bg, text] = {
      good: ['#059669', '#ecfdf5', '#047857'],
      wait: ['#d97706', '#fffbeb', '#b45309'],
      blue: ['#2563eb', '#eff6ff', '#1d4ed8'],
      bad: ['#dc2626', '#fef2f2', '#b91c1c'],
      off: ['#94a3b8', '#f1f5f9', '#475569'],
    }[tone];
    return `<span title="${this.esc(title)}" style="display:inline-flex; align-items:center; gap:6px; height:24px; padding:0 9px; border-radius:6px; background:${bg}; font-size:12px; font-weight:500; color:${text}; white-space:nowrap;">`
      + `<span style="width:6px; height:6px; border-radius:50%; background:${dot}; flex-shrink:0;"></span>${this.esc(label)}</span>`;
  }

  getInitials(name: string): string {
    const parts = (name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return 'EM';
  }

  resignationColDefs = computed<ColDef[]>(() => {
    const canManage = this.isManagerOrAdmin();
    const busyId = this.inlineStatusBusy();

    return [
      {
        colId: 'employee',
        headerName: 'Employee',
        minWidth: 205,
        flex: 1.5,
        valueGetter: (params: any) => params.data ? this.employeeName(params.data) : '',
        cellRenderer: (params: any) => {
          const res: Resignation = params.data;
          if (!res) return '';
          const fullName = this.esc(this.employeeName(res));
          const code = this.employeeIdentifier(res);
          const codeBadge = code && code !== '—'
            ? `<span style="display:inline-flex; align-items:center; padding:1px 6px; border-radius:5px; background:#eff6ff; border:1px solid #dbeafe; color:#1d4ed8; font-size:10.5px; font-weight:600; font-variant-numeric:tabular-nums; flex-shrink:0;">${this.esc(code)}</span>`
            : '';
          const email = this.esc(res.employee?.user?.email || '—');
          const initials = this.esc(this.getInitials(this.employeeName(res)));
          const avatarUrl = res.employee?.avatarUrl;
          const avatarHtml = avatarUrl
            ? `<img src="${this.esc(avatarUrl)}" alt="" style="width:34px; height:34px; border-radius:50%; object-fit:cover; flex-shrink:0; box-shadow:0 0 0 1px rgba(15,23,42,.08);" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex';" />`
              + `<span style="display:none; width:34px; height:34px; border-radius:50%; background:#e0e9ff; color:#2563eb; font-weight:700; font-size:12px; align-items:center; justify-content:center; flex-shrink:0;">${initials}</span>`
            : `<span style="display:inline-flex; width:34px; height:34px; border-radius:50%; background:#e0e9ff; color:#2563eb; font-weight:700; font-size:12px; align-items:center; justify-content:center; flex-shrink:0;">${initials}</span>`;
          return `
            <div style="display:flex; align-items:center; gap:10px; min-width:0; width:100%; overflow:hidden; line-height:1.3;">
              ${avatarHtml}
              <div style="display:flex; flex-direction:column; gap:2px; min-width:0; flex:1; overflow:hidden;">
                <div style="display:flex; align-items:center; gap:6px; min-width:0;">
                  <span class="offb-emp-name" style="font-weight:600; color:#0f172a; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; transition:color .15s ease;">${fullName}</span>
                  ${codeBadge}
                </div>
                <span style="font-size:11.5px; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${email}">${email}</span>
              </div>
            </div>
          `;
        }
      },
      {
        colId: 'exitReason',
        headerName: 'Type & Reason',
        minWidth: 200,
        flex: 1.7,
        valueGetter: (p: any) => `${this.exitTypeLabel(p.data?.exitType)} ${p.data?.reason || ''}`.trim(),
        cellRenderer: (params: any) => {
          const res: Resignation = params.data;
          if (!res) return '';
          const typeLabel = this.esc(this.exitTypeLabel((res as any).exitType));
          const rawReason = String(res.reason || '').trim();
          const isLong = rawReason.length > 48;
          const preview = isLong ? `${rawReason.slice(0, 48).trimEnd()}…` : rawReason;
          const reasonHtml = rawReason
            ? `<div style="display:flex; align-items:baseline; gap:5px; min-width:0; font-size:12px; color:#475569; line-height:1.35;">
                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; flex:1;" title="${this.esc(rawReason)}">${this.esc(preview)}</span>
                ${isLong ? `<button type="button" data-act="view" style="border:none; background:none; padding:0; color:#2563eb; font-size:11.5px; font-weight:600; cursor:pointer; flex-shrink:0; white-space:nowrap;">Read more</button>` : ''}
              </div>`
            : `<span style="font-size:12px; color:#94a3b8; line-height:1.3;">No reason provided</span>`;
          return `
            <div style="display:flex; flex-direction:column; gap:3px; min-width:0; width:100%; overflow:hidden; line-height:1.3;">
              <div style="display:flex; align-items:center; gap:6px;">
                <span style="display:inline-flex; align-items:center; padding:1px 7px; border-radius:5px; background:#f1f5f9; color:#334155; font-size:11px; font-weight:600; line-height:1.4;">${typeLabel}</span>
              </div>
              ${reasonHtml}
            </div>
          `;
        }
      },
      {
        colId: 'lwd',
        headerName: 'Last Working Day',
        minWidth: 145,
        flex: 1,
        valueGetter: (p: any) => p.data?.approvedLastWorkingDay || p.data?.intendedLastWorkingDay || '',
        cellRenderer: (params: any) => {
          const res: Resignation = params.data;
          if (!res) return '';
          const intended = this.formatDisplayDate(res.intendedLastWorkingDay);
          const approved = res.approvedLastWorkingDay ? this.formatDisplayDate(res.approvedLastWorkingDay) : '';
          if (approved) {
            return `
              <div style="display:flex; flex-direction:column; gap:2px; min-width:0; line-height:1.3;">
                <div style="display:flex; align-items:center; gap:5px;">
                  <span style="color:#0f172a; font-size:12.5px; font-weight:600; font-variant-numeric:tabular-nums; white-space:nowrap;">${this.esc(approved)}</span>
                  <span style="font-size:10px; font-weight:600; color:#047857; background:#ecfdf5; padding:1px 5px; border-radius:4px;">Approved</span>
                </div>
                <span style="color:#64748b; font-size:11px; font-variant-numeric:tabular-nums; white-space:nowrap;">Intended: ${this.esc(intended)}</span>
              </div>
            `;
          }
          return `
            <div style="display:flex; flex-direction:column; gap:2px; min-width:0; line-height:1.3;">
              <span style="color:#0f172a; font-size:12.5px; font-weight:600; font-variant-numeric:tabular-nums; white-space:nowrap;">${this.esc(intended)}</span>
              <span style="color:#64748b; font-size:11px; white-space:nowrap;">Intended LWD</span>
            </div>
          `;
        }
      },
      {
        colId: 'approver',
        headerName: 'Approver',
        minWidth: 130,
        flex: 1,
        valueGetter: (params: any) => params.data?.approver?.email || '—',
        cellRenderer: (params: any) => {
          const v = this.esc(params.value || '—');
          return `<span style="color:${params.value && params.value !== '—' ? '#475569' : '#94a3b8'}; font-size:12.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:block; width:100%;" title="${v}">${v}</span>`;
        }
      },
      {
        colId: 'progress',
        headerName: 'Exit progress',
        minWidth: 230,
        flex: 1,
        sortable: false,
        filter: false,
        autoHeight: true,
        cellRenderer: (params: any) => {
          const r: any = params.data;
          if (!r) return '';
          if (r.status !== 'APPROVED') return '<span style="color:#94a3b8;font-size:12.5px">—</span>';
          const p = r.progress || {};
          const chip = (label: string, state: 'done' | 'now' | 'todo') => {
            const c = state === 'done' ? 'background:#dcfce7;color:#166534' : state === 'now' ? 'background:#fef3c7;color:#92400e' : 'background:#f1f5f9;color:#64748b';
            return `<span style="${c};padding:2px 8px;border-radius:999px;font-size:11.5px;font-weight:600;white-space:nowrap">${state === 'done' ? '✓ ' : ''}${label}</span>`;
          };
          const isExit = r.exitType && r.exitType !== 'RESIGNATION';
          const ho = r.handoverReceivedAt ? chip('Handover received', 'done')
            : r.handoverSubmittedAt ? chip('Handover: waiting manager', 'now')
            : isExit ? '' : r.handover ? chip('Handover: draft', 'now') : chip('Handover: not started', 'todo');
          const ct = p.clearanceTotal || 0, cd = p.clearanceDone || 0;
          const cl = ct ? chip(`Verified ${cd}/${ct}`, cd === ct ? 'done' : cd ? 'now' : 'todo') : chip('Verified 0/3', 'todo');
          const sep = r.separatedAt ? chip('Separated', 'done') : chip('Not separated', 'todo');
          const fs = p.fnfStatus;
          const dueTxt = p.fnfDueDate ? new Date(p.fnfDueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
          const overdue = fs !== 'PAID' && p.fnfDueDate && new Date(p.fnfDueDate).getTime() < Date.now();
          const dueChip = dueTxt ? `<span style="${overdue ? 'background:#fee2e2;color:#b42318' : 'background:#eef2ff;color:#3730a3'};padding:2px 8px;border-radius:999px;font-size:11.5px;font-weight:600;white-space:nowrap">FNF date ${dueTxt}${overdue ? ' · overdue' : ''}</span>` : '';
          const fnf = fs === 'PAID' ? chip('FNF paid', 'done') : fs === 'APPROVED' ? chip('FNF: to pay', 'now') : fs === 'PENDING_APPROVAL' ? chip('FNF: approval', 'now') : fs === 'DRAFT' ? chip('FNF: draft', 'now') : chip('FNF: not started', 'todo');
          const next = !isExit && !r.handoverSubmittedAt ? 'Employee fills the handover'
            : !isExit && !r.handoverReceivedAt ? 'Manager marks handover received'
            : ct && cd < ct ? 'HR / Super Admin verify projects, assets & documents'
            : !r.separatedAt ? 'Separation on the last working day'
            : fs !== 'PAID' ? 'Prepare & pay FNF (Full & Final tab)' : 'Send relieving & experience letters';
          return `<div style="display:flex;flex-wrap:wrap;gap:4px;padding:6px 0;line-height:1.5">${ho}${cl}${sep}${fnf}${fs === 'PAID' ? '' : dueChip}</div><div style="font-size:11.5px;color:#475569;padding-bottom:6px"><b>Next:</b> ${next}</div>`;
        }
      },
      {
        field: 'status',
        headerName: 'Status',
        minWidth: 145,
        flex: 0.9,
        cellRenderer: (params: any) => {
          const res: Resignation = params.data;
          if (!res) return '';
          const st = (res.status || 'PENDING').toUpperCase();
          if (st === 'APPROVED' && res.separatedAt) return this.statusDot('Separated', 'wait');
          if (st === 'PENDING') {
            const who = res.stage === 'MANAGER' ? 'Manager' : res.stage === 'HR' ? 'HR' : res.stage === 'SUPERADMIN' ? 'Super Admin' : 'Review';
            return this.statusDot(`Waiting: ${who}`, 'blue');
          }
          if (canManage) {
            const toneClass = st === 'APPROVED' ? 'tone-good' : (st === 'REJECTED' ? 'tone-bad' : (st === 'WITHDRAWN' ? 'tone-wait' : 'tone-blue'));
            const disabledAttr = busyId === res.id ? 'disabled' : '';
            return `
              <select class="ag-inline-status-select ${toneClass}" data-act="inline-status" data-id="${res.id}" ${disabledAttr} title="Change resignation status" aria-label="Change resignation status">
                <option value="PENDING" ${st === 'PENDING' ? 'selected' : ''}>Pending</option>
                <option value="APPROVED" ${st === 'APPROVED' ? 'selected' : ''}>Approved</option>
                <option value="REJECTED" ${st === 'REJECTED' ? 'selected' : ''}>Rejected</option>
                <option value="WITHDRAWN" ${st === 'WITHDRAWN' ? 'selected' : ''}>Withdrawn</option>
              </select>
            `;
          }
          if (st === 'APPROVED') return this.statusDot('Approved', 'good');
          if (st === 'REJECTED') return this.statusDot('Rejected', 'bad');
          if (st === 'WITHDRAWN') return this.statusDot('Withdrawn', 'wait');
          return this.statusDot('Pending', 'blue');
        }
      },
      {
        colId: 'actions',
        headerName: 'Actions',
        width: 112,
        minWidth: 108,
        flex: 0,
        sortable: false,
        filter: false,
        resizable: false,
        cellRenderer: (params: any) => {
          const res: Resignation = params.data;
          if (!res) return '';
          const viewBtn = `<button type="button" class="g-icon-btn" data-act="view" title="View resignation details" aria-label="View resignation details"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg></button>`;
          const reviewBtn = res.status === 'PENDING' && this.canActOn(res)
            ? `<button type="button" class="g-icon-btn" data-act="review" title="Review resignation" aria-label="Review resignation"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></button>`
            : '';
          const handoverBtn = res.status === 'APPROVED'
            ? `<button type="button" class="g-icon-btn" data-act="handover" title="Exit handover form" aria-label="Exit handover form"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15l2 2 4-4"/></svg></button>`
            : '';
          const withdrawBtn = this.canWithdraw(res)
            ? `<button type="button" class="g-icon-btn g-icon-danger" data-act="withdraw" title="Withdraw my resignation" aria-label="Withdraw my resignation"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg></button>`
            : '';
          return `<div style="display:flex; align-items:center; gap:5px;">${viewBtn}${reviewBtn}${handoverBtn}${withdrawBtn}</div>`;
        }
      }
    ];
  });

  taskColDefs = computed<ColDef[]>(() => {
    return [
      {
        colId: 'employee',
        headerName: 'Emp ID',
        width: 100,
        minWidth: 92,
        flex: 0,
        valueGetter: (params: any) => params.data?.employee?.userId ? `#${params.data.employee.userId}` : '—',
        cellRenderer: (params: any) => {
          const v = this.esc(params.value || '—');
          return `<span style="display:inline-flex; align-items:center; padding:2px 8px; border-radius:6px; background:#f1f5f9; color:#334155; font-size:12px; font-weight:600; font-variant-numeric:tabular-nums;">${v}</span>`;
        }
      },
      {
        field: 'department',
        headerName: 'Department',
        minWidth: 120,
        flex: 0.9,
        cellRenderer: (params: any) => {
          const dept = this.esc(params.value || '—');
          return `<span style="display:inline-flex; align-items:center; height:24px; padding:0 9px; border-radius:6px; background:#eff6ff; color:#1d4ed8; font-size:12px; font-weight:500;">${dept}</span>`;
        }
      },
      {
        field: 'taskName',
        headerName: 'Clearance Task',
        minWidth: 210,
        flex: 2,
        cellRenderer: (params: any) => {
          const task: OffboardingTask = params.data;
          if (!task) return '';
          const name = this.esc(task.taskName || 'Untitled task');
          const desc = this.esc(task.description || '');
          return `
            <div style="display:flex; flex-direction:column; gap:2px; min-width:0; width:100%; overflow:hidden; line-height:1.3;">
              <strong style="font-weight:600; color:#0f172a; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${name}">${name}</strong>
              ${desc ? `<span style="font-size:11.5px; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${desc}">${desc}</span>` : ''}
            </div>
          `;
        }
      },
      {
        headerName: 'Recovery',
        width: 105, minWidth: 96, flex: 0,
        valueGetter: (p: any) => p.data?.recoveryAmount ?? null,
        cellRenderer: (p: any) => p.value ? `<span style="color:#b91c1c;font-weight:600;">₹${Number(p.value).toLocaleString('en-IN')}</span>` : '<span style="color:#94a3b8">—</span>',
      },
      {
        colId: 'clearedBy',
        headerName: 'Cleared By',
        minWidth: 140,
        flex: 1,
        valueGetter: (params: any) => params.data?.clearedBy?.email || '—',
        cellRenderer: (params: any) => {
          const v = this.esc(params.value || '—');
          return `<span style="color:${params.value && params.value !== '—' ? '#475569' : '#94a3b8'}; font-size:12.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:block; width:100%;" title="${v}">${v}</span>`;
        }
      },
      {
        field: 'status',
        headerName: 'Status',
        width: 112,
        minWidth: 104,
        flex: 0,
        cellRenderer: (params: any) => {
          const st = String(params.value || '').toUpperCase();
          if (st === 'CLEARED') return this.statusDot('Cleared', 'good');
          return this.statusDot('Pending', 'wait');
        }
      },
      {
        colId: 'actions',
        headerName: 'Actions',
        width: 80,
        minWidth: 74,
        flex: 0,
        sortable: false,
        filter: false,
        resizable: false,
        cellRenderer: (params: any) => {
          const task: OffboardingTask = params.data;
          if (!task || task.status !== 'PENDING') return `<span style="color:#94a3b8; font-size:12px;">—</span>`;
          return `<button type="button" class="g-icon-btn" data-act="clear-task" title="Clear task" aria-label="Clear task"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg></button>`;
        }
      }
    ];
  });

  onResignationGridCellClicked(event: any) {
    const res: Resignation | undefined = event?.data;
    if (!res) return;
    const target = event?.event?.target as HTMLElement | null;
    if (target?.closest('[data-act="inline-status"]')) {
      return;
    }
    const actEl = target?.closest('[data-act]') as HTMLElement | null;
    if (actEl) {
      const act = actEl.getAttribute('data-act');
      if (act === 'view') this.openResignationDetails(res);
      else if (act === 'review') this.openApproveModal(res);
      else if (act === 'handover') this.openHandover(res);
      else if (act === 'withdraw') this.openWithdraw(res);
      return;
    }
    if (event.colDef?.colId === 'actions' || event.colDef?.field === 'status') return;
    this.openResignationDetails(res);
  }

  onResignationGridChange(event: Event) {
    const select = (event.target as HTMLElement | null)?.closest('select[data-act="inline-status"]') as HTMLSelectElement | null;
    if (!select) return;
    const id = Number(select.getAttribute('data-id'));
    const nextStatus = select.value;
    const resignation = this.resignations().find(r => r.id === id);
    if (resignation && nextStatus) {
      this.selectInlineStatus(resignation, nextStatus, event);
    }
  }

  onTaskGridCellClicked(event: any) {
    const task: OffboardingTask | undefined = event?.data;
    if (!task) return;
    const target = event?.event?.target as HTMLElement | null;
    const actEl = target?.closest('[data-act="clear-task"]');
    if (actEl && task.status === 'PENDING') {
      this.openTaskModal(task);
    }
  }

  constructor() {
    effect(() => {
      const user = this.authService.currentUser();
      if (user) {
        this.currentUserRole.set(user.role);
        this.currentEmployeeId.set(user.employeeId || 0);
        this.loadData();
      }
    });
  }

  ngOnInit() {
    this.route.queryParamMap.subscribe((params) => {
      const employeeId = Number(params.get('employeeId'));
      this.focusedEmployeeId.set(Number.isInteger(employeeId) && employeeId > 0 ? employeeId : null);
      if (employeeId > 0) {
        this.activeTab.set('resignations');
        this.loadData();
      }
      // ?handover=<resignationId> opens that exit handover (reminder popup link).
      const hid = Number(params.get('handover'));
      if (hid > 0) {
        this.activeTab.set('resignations');
        this.offboardingService.getResignations().subscribe((res) => {
          this.resignations.set(res);
          const r = res.find((x) => x.id === hid);
          if (r) this.openHandover(r);
        });
      }
    });
  }

  isManagerOrAdmin() {
    const r = this.currentUserRole();
    return ['SUPERADMIN', 'ADMIN', 'HR', 'MANAGER'].includes(r);
  }

  isAdminOrHr() {
    const r = this.currentUserRole();
    return ['SUPERADMIN', 'ADMIN', 'HR'].includes(r);
  }

  canClearTasks() {
    const r = this.currentUserRole();
    return ['SUPERADMIN', 'ADMIN', 'HR', 'FINANCE'].includes(r);
  }

  setTab(tab: 'resignations' | 'tasks' | 'exit' | 'fnf') {
    this.activeTab.set(tab);
    this.loadData();
  }

  setResignationPage(page: number) {
    this.resignationPage.set(Math.max(1, Math.min(page, this.resignationPageCount())));
  }

  setResignationPageSize(size: string | number) {
    this.resignationPageSize.set(Number(size) || 20);
    this.resignationPage.set(1);
  }

  updateResignationSearch(value: string) {
    this.resignationSearch.set(value);
    this.resignationPage.set(1);
  }

  updateResignationStatusFilter(value: string) {
    this.resignationStatusFilter.set(value || 'ALL');
    this.resignationPage.set(1);
  }

  onResignationDateRange(range: DateRange) {
    this.resignationDateRange.set(range);
    this.resignationPage.set(1);
  }

  clearResignationFilters() {
    this.resignationSearch.set('');
    this.resignationStatusFilter.set('ALL');
    this.resignationDatePreset.set('ALL');
    this.resignationDateRange.set(null);
    this.resignationPage.set(1);
  }

  clearTaskFilters() {
    this.taskSearch.set('');
    this.taskStatusFilter.set('ALL');
    this.taskDepartmentFilter.set(null);
  }

  /** The directory is the canonical employee-photo source. This keeps the
   * resignation register compatible with older API responses that omit it. */
  private hydrateResignationAvatars() {
    this.employeeService.getEmployees().subscribe({
      next: (employees) => {
        const avatarByEmployeeId = new Map(
          employees
            .map((employee) => [employee.id, employee.avatarUrl || employee.user?.avatarUrl] as const)
            .filter(([, avatarUrl]) => !!avatarUrl),
        );
        this.resignations.update((items) => items.map((item) => {
          const avatarUrl = item.employee?.avatarUrl || avatarByEmployeeId.get(item.employeeId);
          const directoryEmployee = employees.find((employee) => employee.id === item.employeeId);
          return item.employee && directoryEmployee ? {
            ...item,
            employee: {
              ...item.employee,
              avatarUrl,
              firstName: item.employee.firstName || directoryEmployee.firstName,
              lastName: item.employee.lastName || directoryEmployee.lastName,
              employeeCode: item.employee.employeeCode || directoryEmployee.employeeCode,
            },
          } : item;
        }));
      },
      // The table remains usable for roles that cannot load the directory.
      error: () => undefined,
    });
  }

  handleAvatarError(resignation: Resignation) {
    if (resignation.employee) {
      resignation.employee.avatarUrl = null;
    }
  }

  employeeName(resignation: Resignation): string {
    const employee = resignation.employee;
    const name = [employee?.firstName, employee?.lastName].filter(Boolean).join(' ').trim();
    return name || 'Employee record unavailable';
  }

  employeeIdentifier(resignation: Resignation): string {
    return resignation.employee?.employeeCode || `ID ${resignation.employeeId}`;
  }

  loadData() {
    if (this.activeTab() === 'resignations') {
      this.offboardingService.getResignations().subscribe(res => {
        this.resignations.set(res);
        const focusedEmployeeId = this.focusedEmployeeId();
        if (focusedEmployeeId) {
          const focused = res.find((item) => item.employeeId === focusedEmployeeId);
          if (focused) {
            this.resignationSearch.set(this.employeeName(focused));
            this.openResignationDetails(focused);
          }
        }
        this.setResignationPage(this.resignationPage());
        this.hydrateResignationAvatars();
      });
    } else if (this.activeTab() === 'tasks') {
      if (this.canClearTasks()) {
        this.offboardingService.getTasks().subscribe(res => this.tasks.set(res));
      }
    } else if (this.activeTab() === 'fnf') {
      if (this.isAdminOrHr()) this.loadFnfList();
    } else if (this.activeTab() === 'exit') {
      if (this.isAdminOrHr()) {
        this.offboardingService.getExitInterviews().subscribe(res => this.interviews.set(res));
        this.employeeService.getEmployees().subscribe(res => this.employees.set(res || []));
      }
    }
  }

  // --- Resignations ---
  openResignModal() {
    if (this.myActiveResignation()) { this.toast.error('You already have a resignation in progress.'); return; }
    this.resignForm = { reason: '', intendedLastWorkingDay: '' };
    this.resignTried.set(false); this.resignError.set(''); this.resignSubmitting.set(false);
    this.myNotice.set(null);
    const me = this.myEmployeeId();
    if (me) this.offboardingService.getNotice(me).subscribe({ next: (n) => {
      this.myNotice.set(n);
      if (!this.resignForm.intendedLastWorkingDay) this.resignForm.intendedLastWorkingDay = n.earliest.slice(0, 10);
    }, error: () => {} });
    this.showResignModal.set(true);
  }

  closeResignModal() {
    this.showResignModal.set(false);
  }

  /** My own pending/approved resignation, if any: no second one can be raised. */
  myActiveResignation = computed(() => {
    const me = this.myEmployeeId();
    return me ? this.resignations().find((r) => r.employeeId === me && ['PENDING', 'APPROVED'].includes(r.status)) ?? null : null;
  });
  resignSubmitting = signal(false);
  resignTried = signal(false);
  resignError = signal('');
  resignReasonError() {
    if (!this.resignTried()) return '';
    const r = (this.resignForm.reason || '').trim();
    return !r ? 'Please add a reason for leaving.' : r.length < 10 ? 'Please write at least 10 characters.' : '';
  }
  resignDateError() {
    if (!this.resignTried()) return '';
    const d = this.resignForm.intendedLastWorkingDay;
    if (!d) return 'Please pick your intended last working day.';
    if (d < new Date().toISOString().slice(0, 10)) return 'The last working day cannot be in the past.';
    return '';
  }

  submitResignation() {
    if (this.resignSubmitting()) return;
    this.resignTried.set(true);
    this.resignError.set('');
    if (this.resignReasonError() || this.resignDateError()) return;
    this.resignSubmitting.set(true);
    this.offboardingService.submitResignation(this.resignForm.reason.trim(), this.resignForm.intendedLastWorkingDay)
      .subscribe({
        next: () => {
          this.resignSubmitting.set(false);
          this.toast.success('Resignation submitted successfully');
          this.closeResignModal();
          this.loadData();
        },
        error: (err) => {
          this.resignSubmitting.set(false);
          this.resignError.set(err.error?.message || 'Could not submit the resignation. Please try again.');
        }
      });
  }

  /** The employee takes back their own pending resignation. */
  withdrawing = signal<Resignation | null>(null);
  withdrawNote = '';
  withdrawBusy = signal(false);
  canWithdraw(r: Resignation): boolean {
    return r.status === 'PENDING' && !(r as any).initiatedById && !!this.myEmployeeId() && r.employeeId === this.myEmployeeId();
  }
  openWithdraw(r: Resignation) { this.withdrawing.set(r); this.withdrawNote = ''; }
  confirmWithdraw() {
    const r = this.withdrawing(); if (!r || this.withdrawBusy()) return;
    this.withdrawBusy.set(true);
    this.offboardingService.withdrawResignation(r.id, this.withdrawNote).subscribe({
      next: () => { this.withdrawBusy.set(false); this.withdrawing.set(null); this.toast.success('Resignation withdrawn'); this.loadData(); },
      error: (e) => { this.withdrawBusy.set(false); this.toast.error(e?.error?.message || 'Could not withdraw.'); },
    });
  }

  // ── Offboarding part 1 (20 Nov 2026): Manager → HR → Super Admin ──
  reviewing = signal<Resignation | null>(null);
  decision: { decision: 'APPROVE' | 'REJECT'; note: string; lastWorkingDay: string; shortNoticeAction: string } = { decision: 'APPROVE', note: '', lastWorkingDay: '', shortNoticeAction: '' };
  deciding = signal(false);

  exitTypeLabel(t?: string | null): string {
    return t === 'TERMINATION' ? 'Termination' : t === 'ABSCONDING' ? 'Absconding' : t === 'CONTRACT_END' ? 'Contract end' : 'Resignation';
  }
  stageLabel(s?: string | null): string {
    return s === 'MANAGER' ? 'Reporting manager' : s === 'HR' ? 'HR' : s === 'SUPERADMIN' ? 'Super Admin' : 'Done';
  }
  canActOn(r: Resignation): boolean {
    const role = this.currentUserRole();
    if (r.status !== 'PENDING') return false;
    if (role === 'SUPERADMIN') return true;
    if (r.stage === 'MANAGER') return !!this.myEmployeeId() && (r.employee as any)?.managerId === this.myEmployeeId();
    if (r.stage === 'HR') return ['HR', 'ADMIN'].includes(role);
    return false;
  }
  /** HR's step, or a Super Admin approving early (their approval is final). */
  setsFinalDay(r: Resignation): boolean {
    const st = (r as any).stage;
    return st === 'HR' || (this.currentUserRole() === 'SUPERADMIN' && st === 'MANAGER');
  }
  saFinal(r: Resignation): boolean { return this.currentUserRole() === 'SUPERADMIN' && (r as any).stage !== 'SUPERADMIN'; }
  myEmployeeId(): number | null { return (this.authService.currentUser() as any)?.employeeId ?? null; }

  /** Days short of the notice for the LWD being chosen (HR step). */
  decisionShortDays(): number {
    const r = this.reviewing();
    if (!r?.earliestLastWorkingDay || !this.decision.lastWorkingDay) return 0;
    const e = new Date(r.earliestLastWorkingDay.slice(0, 10) + 'T00:00:00Z').getTime();
    const l = new Date(this.decision.lastWorkingDay + 'T00:00:00Z').getTime();
    return Math.max(0, Math.round((e - l) / 86400000));
  }

  openApproveModal(resignation: Resignation) {
    this.reviewing.set(resignation);
    this.decision = {
      decision: 'APPROVE', note: '',
      lastWorkingDay: (resignation.approvedLastWorkingDay || resignation.intendedLastWorkingDay).split('T')[0],
      shortNoticeAction: resignation.shortNoticeAction || '',
    };
    this.showApproveModal.set(true);
  }

  openResignationDetails(resignation: Resignation) {
    this.openActionMenuId.set(null);
    this.selectedResignation.set(resignation);
    this.showResignationDetails.set(true);
  }

  toggleActionMenu(resignationId: number, event: Event) {
    event.stopPropagation();
    this.openActionMenuId.update((openId) => openId === resignationId ? null : resignationId);
  }

  closeResignationDetails() {
    this.showResignationDetails.set(false);
    this.selectedResignation.set(null);
  }

  reviewFromDetails() {
    const resignation = this.selectedResignation();
    if (!resignation) return;
    this.closeResignationDetails();
    this.openApproveModal(resignation);
  }

  toggleStatusDropdown(resignationId: number, event: Event) {
    event.stopPropagation();
    this.openStatusDropdownId.update((openId) => openId === resignationId ? null : resignationId);
  }

  selectInlineStatus(resignation: Resignation, nextStatus: string, event: Event) {
    event.stopPropagation();
    this.openStatusDropdownId.set(null);
    if (!nextStatus || nextStatus === resignation.status) return;

    this.inlineStatusBusy.set(resignation.id);
    const approvedLastWorkingDay = nextStatus === 'APPROVED'
      ? (resignation.approvedLastWorkingDay || resignation.intendedLastWorkingDay).split('T')[0]
      : undefined;

    this.offboardingService.updateResignationStatus(resignation.id, nextStatus, approvedLastWorkingDay).subscribe({
      next: (updated) => {
        this.resignations.update((items) => items.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
        if (this.selectedResignation()?.id === updated.id) this.selectedResignation.update((item) => item ? { ...item, ...updated } : item);
        this.inlineStatusBusy.set(null);
        this.toast.success(`Status changed to ${nextStatus.toLowerCase()}`);
      },
      error: (err) => {
        this.inlineStatusBusy.set(null);
        this.toast.error(err.error?.message || 'Could not update the resignation status');
      },
    });
  }

  closeApproveModal() {
    this.showApproveModal.set(false);
  }

  submitApprove() {
    const r = this.reviewing();
    if (!r) return;
    if (this.decision.decision === 'REJECT' && !this.decision.note.trim()) { this.toast.error('Say why it is rejected.'); return; }
    if (this.setsFinalDay(r) && this.decision.decision === 'APPROVE' && this.decisionShortDays() > 0 && !this.decision.shortNoticeAction) {
      this.toast.error('Notice is short — choose waive or recover in FNF.'); return;
    }
    this.deciding.set(true);
    this.offboardingService.decideExit(r.id, {
      decision: this.decision.decision, note: this.decision.note.trim() || undefined,
      ...(this.setsFinalDay(r) ? { lastWorkingDay: this.decision.lastWorkingDay, shortNoticeAction: this.decision.shortNoticeAction || undefined } : {}),
    }).subscribe({
      next: (u: any) => {
        this.deciding.set(false);
        const done = u?.status === 'APPROVED' ? 'Exit approved — clearance started.' : u?.status === 'REJECTED' ? 'Exit rejected.' : `Approved — now waiting for ${this.stageLabel(u?.stage)}.`;
        this.toast.success(done);
        this.closeApproveModal();
        this.loadData();
      },
      error: (err) => { this.deciding.set(false); this.toast.error(err.error?.message || 'Could not save the decision'); },
    });
  }

  // ── HR starts an exit ──
  showStartExit = signal(false);
  startForm = { employeeId: '' as any, exitType: 'RESIGNATION', reason: '', lastWorkingDay: '', shortNoticeAction: '' };
  startNotice = signal<{ type: string; days: number; earliest: string } | null>(null);
  starting = signal(false);
  employeeOptions = computed<SearchableSelectOption[]>(() => this.employees().map((e: any) => ({
    id: String(e.id), name: `${e.firstName} ${e.lastName || ''}`.trim(), subtitle: e.user?.email || e.employeeCode || '',
    avatarUrl: e.avatarUrl || undefined,
  })) as any);

  openStartExit() {
    this.startForm = { employeeId: '', exitType: 'RESIGNATION', reason: '', lastWorkingDay: '', shortNoticeAction: '' };
    this.startNotice.set(null);
    if (!this.employees().length) this.employeeService.getEmployees().subscribe(res => this.employees.set(res || []));
    this.showStartExit.set(true);
  }
  onStartEmployee(id: any) {
    this.startForm.employeeId = id ? String(id) : '';
    this.startNotice.set(null);
    if (id) this.offboardingService.getNotice(Number(id)).subscribe({ next: (n) => this.startNotice.set(n), error: () => {} });
  }
  startShortDays(): number {
    const n = this.startNotice();
    if (this.startForm.exitType !== 'RESIGNATION' || !n || !this.startForm.lastWorkingDay) return 0;
    const e = new Date(n.earliest.slice(0, 10) + 'T00:00:00Z').getTime();
    const l = new Date(this.startForm.lastWorkingDay + 'T00:00:00Z').getTime();
    return Math.max(0, Math.round((e - l) / 86400000));
  }
  submitStartExit() {
    const f = this.startForm;
    if (!f.employeeId || !f.reason.trim() || !f.lastWorkingDay) { this.toast.error('Pick the person, the last working day and a reason.'); return; }
    if (this.startShortDays() > 0 && !f.shortNoticeAction) { this.toast.error('Notice is short — choose waive or recover in FNF.'); return; }
    this.starting.set(true);
    this.offboardingService.initiateExit({ employeeId: Number(f.employeeId), exitType: f.exitType, reason: f.reason.trim(), lastWorkingDay: f.lastWorkingDay, shortNoticeAction: f.shortNoticeAction || undefined }).subscribe({
      next: (r: any) => {
        this.starting.set(false); this.showStartExit.set(false);
        this.toast.success(r?.status === 'APPROVED' ? 'Exit started and approved.' : 'Exit started — waiting for Super Admin approval.');
        this.loadData();
      },
      error: (err) => { this.starting.set(false); this.toast.error(err.error?.message || 'Could not start the exit'); },
    });
  }

  // ── Notice periods (settings) ──
  showNoticePolicy = signal(false);
  noticePolicy: Record<string, number> = { PROBATION: 15, CONFIRMED: 30, TRAINEE: 7, CONTRACT: 15 };
  openNoticePolicy() {
    this.offboardingService.getNoticePolicy().subscribe({ next: (p) => { this.noticePolicy = { ...p }; this.showNoticePolicy.set(true); }, error: () => this.showNoticePolicy.set(true) });
  }
  saveNoticePolicy() {
    this.offboardingService.saveNoticePolicy(this.noticePolicy).subscribe({
      next: () => { this.toast.success('Notice periods saved'); this.showNoticePolicy.set(false); },
      error: (err) => this.toast.error(err.error?.message || 'Could not save'),
    });
  }

  // Own notice in the resign form
  myNotice = signal<{ type: string; days: number; earliest: string } | null>(null);
  myShortDays(): number {
    const n = this.myNotice();
    if (!n || !this.resignForm.intendedLastWorkingDay) return 0;
    const e = new Date(n.earliest.slice(0, 10) + 'T00:00:00Z').getTime();
    const l = new Date(this.resignForm.intendedLastWorkingDay + 'T00:00:00Z').getTime();
    return Math.max(0, Math.round((e - l) / 86400000));
  }

  // ── Offboarding part 2 (20 Nov 2026): exit handover form ──
  handoverFor = signal<Resignation | null>(null);
  handover = signal<any | null>(null);
  handoverBusy = signal(false);
  handoverTab = signal<'projects' | 'assets' | 'documents' | 'separation' | 'receive'>('projects');
  /** Only active colleagues can take over work (not the leaver, not deactivated people). */
  handoverPeople = computed(() => this.employees().filter((e: any) =>
    (e.user?.status ?? 'ACTIVE') !== 'SUSPENDED' && e.offboardingStatus !== 'SEPARATED' && !e.isCompanyAccount && e.id !== this.handoverFor()?.employeeId));
  receiveNote = '';

  handoverDocsCheckedCount(hv: any): number {
    const d = hv?.form?.documents;
    if (!d) return 0;
    return [d.clientDocuments, d.projectFiles, d.passwordTransfer, d.knowledgeTransfer].filter(Boolean).length;
  }

  openHandover(r: Resignation) {
    this.handoverFor.set(r); this.handover.set(null); this.handoverTab.set('projects'); this.receiveNote = ''; this.reporteesTo = r.reporteesToId ?? null;
    if (!this.employees().length) this.employeeService.getEmployees().subscribe(res => this.employees.set(res || []));
    this.offboardingService.getHandover(r.id).subscribe({
      next: (h) => {
        this.lastDayInput = this.ymd(h?.header?.lastWorkingDay); this.fnfDueInput = this.ymd(h?.header?.fnfDueDate);
        const fill = () => (h?.form?.projects || []).forEach((p: any) => {
          if (p.handoverToId && !p.handoverToName) { const e = this.employees().find((x: any) => x.id === p.handoverToId); if (e) p.handoverToName = this.personLabel(e); }
        });
        if (this.employees().length) fill(); else this.employeeService.getEmployees().subscribe(res => { this.employees.set(res || []); fill(); });
        this.handover.set(h);
      },
      error: (e) => { this.toast.error(e?.error?.message || 'Could not open the handover'); this.handoverFor.set(null); },
    });
  }
  clearNote = '';
  clearRecovery: number | null = null;
  clearBusy = signal(false);
  verifySection(section: 'projects' | 'assets' | 'documents', verified: boolean) {
    const r = this.handoverFor(); const h = this.handover(); if (!r || !h) return;
    if (!verified && !confirm('Reopen this section? It will need to be verified again.')) return;
    this.clearBusy.set(true);
    this.offboardingService.verifyClearance(r.id, { section, verified, note: this.clearNote, recoveryAmount: section === 'assets' ? Number(this.clearRecovery) || 0 : undefined }).subscribe({
      next: (cl) => { this.clearBusy.set(false); this.clearNote = ''; this.clearRecovery = null; h.clearance = cl || {}; this.handover.set({ ...h }); this.toast.success(verified ? 'Verified' : 'Reopened'); this.loadData(); },
      error: (e) => { this.clearBusy.set(false); this.toast.error(e?.error?.message || 'Could not save'); },
    });
  }
  closeHandover() { this.handoverFor.set(null); this.handover.set(null); }
  personLabel(e: any): string { return `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim() + (e.employeeCode ? ` (#${e.employeeCode})` : ''); }
  /** Typed name → colleague id when it matches someone; free text is kept as-is. */
  matchHandoverPerson(row: any) {
    const v = String(row.handoverToName || '').trim().toLowerCase();
    const hit = this.handoverPeople().find((e: any) => this.personLabel(e).toLowerCase() === v || `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim().toLowerCase() === v);
    row.handoverToId = hit ? hit.id : null;
  }
  addWorkRow() { this.handover()?.form.work.push({ task: '', handoverToId: null, status: 'PENDING' }); }
  addProjectRow() { this.handover()?.form.projects.push({ name: '', client: '', currentStatus: '', handoverToId: null, status: 'PENDING' }); }
  addAssetRow() { this.handover()?.form.assets.push({ name: '', assetId: '', serialNo: '', returned: null, condition: '' }); }
  removeRow(list: any[], i: number) { list.splice(i, 1); }
  personName(id: any): string { const e: any = this.employees().find((x: any) => Number(x.id) === Number(id)); return e ? `${e.firstName} ${e.lastName || ''}`.trim() : '—'; }

  saveHandover(submit = false) {
    const r = this.handoverFor(); const h = this.handover();
    if (!r || !h) return;
    if (submit && !confirm('Submit the handover? You can\'t change it after this. I confirm that all assigned responsibilities, documents and company assets have been handed over properly.')) return;
    this.handoverBusy.set(true);
    this.offboardingService.saveHandover(r.id, h.form, submit).subscribe({
      next: () => { this.handoverBusy.set(false); this.toast.success(submit ? 'Handover submitted — your manager will confirm it.' : 'Draft saved'); if (submit) this.openHandover(r); },
      error: (e) => { this.handoverBusy.set(false); this.toast.error(e?.error?.message || 'Could not save'); },
    });
  }
  // ── Offboarding part 3 (20 Nov 2026): reportees + separate ──
  reporteesTo: number | null = null;
  lastDayInput = '';
  fnfDueInput = '';
  lastDaySaving = signal(false);
  private ymd(d: any): string { return d ? new Date(d).toISOString().slice(0, 10) : ''; }
  setReportees() {
    const r = this.handoverFor(); if (!r) return;
    if (!this.lastDayInput) { this.toast.error('Pick the last working day.'); return; }
    if (this.fnfDueInput && this.fnfDueInput < this.lastDayInput) { this.toast.error('The FNF date cannot be before the last working day.'); return; }
    this.lastDaySaving.set(true);
    this.offboardingService.setReporteesTo(r.id, this.reporteesTo, { lastWorkingDay: this.lastDayInput, fnfDueDate: this.fnfDueInput }).subscribe({
      next: (u) => {
        this.lastDaySaving.set(false);
        this.toast.success('Saved — dates and reportees updated.');
        (r as any).reporteesToId = this.reporteesTo; (r as any).approvedLastWorkingDay = u?.approvedLastWorkingDay;
        const h = this.handover(); if (h) { h.header.lastWorkingDay = u?.approvedLastWorkingDay ?? h.header.lastWorkingDay; if (u?.fnfDueDate) { h.header.fnfDueDate = u.fnfDueDate; h.header.fnfDueDateSet = true; } this.handover.set({ ...h }); }
        this.loadData();
      },
      error: (e) => { this.lastDaySaving.set(false); this.toast.error(e?.error?.message || 'Could not save'); },
    });
  }
  separateNow() {
    const r = this.handoverFor(); if (!r) return;
    if (!confirm(`Separate ${r.employee?.firstName} now? Their login is switched off, they are marked Separated and their reportees move. This can't be undone from here.`)) return;
    this.offboardingService.separateNow(r.id).subscribe({
      next: () => { this.toast.success('Separated — login switched off.'); this.closeHandover(); this.loadData(); },
      error: (e) => this.toast.error(e?.error?.message || 'Could not separate'),
    });
  }

  receiveHandover() {
    const r = this.handoverFor(); if (!r) return;
    this.handoverBusy.set(true);
    this.offboardingService.receiveHandover(r.id, this.receiveNote).subscribe({
      next: () => { this.handoverBusy.set(false); this.toast.success('Handover marked received'); this.openHandover(r); },
      error: (e) => { this.handoverBusy.set(false); this.toast.error(e?.error?.message || 'Could not save'); },
    });
  }

  // --- Tasks ---
  openTaskModal(task: OffboardingTask) {
    this.taskForm = { id: task.id, remarks: '', recoveryAmount: null, department: (task as any).department };
    this.showTaskModal.set(true);
  }

  closeTaskModal() {
    this.showTaskModal.set(false);
  }

  submitTask() {
    this.offboardingService.clearTask(this.taskForm.id, this.taskForm.remarks, this.taskForm.recoveryAmount)
      .subscribe({
        next: () => {
          this.toast.success('Task cleared');
          this.closeTaskModal();
          this.loadData();
        },
        error: (err) => this.toast.error(err.error?.message || 'Error clearing task')
      });
  }

  // --- Exit Interviews ---
  openInterviewModal() {
    this.interviewForm = { employeeId: 0, feedback: '', rating: 3 };
    this.showInterviewModal.set(true);
  }

  closeInterviewModal() {
    this.showInterviewModal.set(false);
  }

  submitInterview() {
    if (!this.interviewForm.employeeId || !this.interviewForm.feedback) {
      this.toast.error('Please fill all fields');
      return;
    }
    this.offboardingService.submitExitInterview(
      this.interviewForm.employeeId,
      this.interviewForm.feedback,
      this.interviewForm.rating
    ).subscribe({
      next: () => {
        this.toast.success('Exit interview saved');
        this.closeInterviewModal();
        this.loadData();
      },
      error: (err) => this.toast.error(err.error?.message || 'Error saving interview')
    });
  }

  // ─── Part 4: Full & Final settlement (20 Nov 2026) ───
  fnfRows = signal<any[]>([]);
  fnfFilter = signal<'ALL' | 'TODO' | 'PENDING_APPROVAL' | 'APPROVED' | 'PAID'>('ALL');
  fnfSearch = signal('');
  fnfOpen = signal(false);
  fnfData = signal<any | null>(null);
  fnfBusy = signal(false);
  fnfError = signal('');
  fnfPaidAt = '';
  fnfPaidRef = '';
  fnfNote = '';
  fnfProofUrl = signal('');
  fnfProofName = signal('');
  fnfUploading = signal(false);
  private http = inject(HttpClient);

  uploadFnfProof(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { this.fnfError.set('File is larger than 10 MB.'); return; }
    const fd = new FormData(); fd.append('file', file);
    this.fnfUploading.set(true); this.fnfError.set('');
    this.http.post<{ url: string }>(`${environment.apiUrl}/upload`, fd).subscribe({
      next: (r) => { this.fnfProofUrl.set(r.url); this.fnfProofName.set(file.name); this.fnfUploading.set(false); },
      error: (e) => { this.fnfUploading.set(false); this.fnfError.set(e?.error?.message || 'Upload failed.'); },
    });
  }

  isSuperAdminRole() { return this.currentUserRole() === 'SUPERADMIN'; }

  loadFnfList() {
    this.offboardingService.listFnf().subscribe({ next: (r) => this.fnfRows.set(r || []), error: () => this.fnfRows.set([]) });
  }

  fnfState(row: any): string { return row.fnf?.status ?? 'TODO'; }
  fnfStateLabel(s: string): string {
    return ({ TODO: 'Not started', NEW: 'Not started', DRAFT: 'Draft', PENDING_APPROVAL: 'Waiting: Super Admin', APPROVED: 'Approved — to pay', PAID: 'Paid' } as any)[s] ?? s;
  }
  fnfCount(s: string) { return this.fnfRows().filter((r) => s === 'ALL' || (s === 'TODO' ? ['TODO', 'DRAFT'].includes(this.fnfState(r)) : this.fnfState(r) === s)).length; }
  fnfFiltered() {
    const f = this.fnfFilter();
    const q = this.fnfSearch().trim().toLowerCase();
    return this.fnfRows()
      .filter((r) => f === 'ALL' || (f === 'TODO' ? ['TODO', 'DRAFT'].includes(this.fnfState(r)) : this.fnfState(r) === f))
      .filter((r) => {
        if (!q) return true;
        const name = `${r.employee?.firstName || ''} ${r.employee?.lastName || ''}`.toLowerCase();
        const code = String(r.employee?.employeeCode || '').toLowerCase();
        const dept = String(r.employee?.department?.name || '').toLowerCase();
        const type = String(r.exitType || '').toLowerCase();
        const status = this.fnfStateLabel(this.fnfState(r)).toLowerCase();
        return name.includes(q) || code.includes(q) || dept.includes(q) || type.includes(q) || status.includes(q);
      })
      .sort((a, b) => new Date(a.fnf?.dueDate ?? a.lastWorkingDay).getTime() - new Date(b.fnf?.dueDate ?? b.lastWorkingDay).getTime());
  }
  clearFnfFilters() {
    this.fnfSearch.set('');
    this.fnfFilter.set('ALL');
  }
  fnfDue(row: any): Date | null {
    if (row.fnf?.dueDate) return new Date(row.fnf.dueDate);
    if (row.fnfDueDate) return new Date(row.fnfDueDate);
    if (!row.lastWorkingDay) return null;
    return new Date(new Date(row.lastWorkingDay).getTime() + 45 * 86400000); // approx. until prepared
  }
  fnfOverdue(row: any) { const d = this.fnfDue(row); return !!d && this.fnfState(row) !== 'PAID' && d.getTime() < Date.now(); }

  openFnf(resignationId: number) {
    this.fnfOpen.set(true); this.fnfData.set(null); this.fnfError.set(''); this.fnfNote = '';
    this.fnfPaidAt = new Date().toISOString().slice(0, 10); this.fnfPaidRef = ''; this.fnfProofUrl.set(''); this.fnfProofName.set('');
    this.offboardingService.getFnf(resignationId).subscribe({
      next: (d) => this.fnfData.set({ ...d, fnf: d.fnf ? { ...d.fnf, lines: (d.fnf.lines || []).map((l: any) => ({ ...l })) } : null }),
      error: (e) => this.fnfError.set(e?.error?.message || 'Could not load the settlement.'),
    });
  }
  closeFnf() { this.fnfOpen.set(false); this.fnfData.set(null); }

  fnfEditable() { return this.fnfData()?.fnf?.status === 'DRAFT' && this.isAdminOrHr(); }
  fnfLines(type: 'EARNING' | 'DEDUCTION') { return (this.fnfData()?.fnf?.lines || []).filter((l: any) => l.type === type); }
  fnfTotal(type: 'EARNING' | 'DEDUCTION') { return this.fnfLines(type).reduce((t: number, l: any) => t + (Number(l.amount) || 0), 0); }
  fnfNet() { return this.fnfTotal('EARNING') - this.fnfTotal('DEDUCTION'); }

  addFnfLine(type: 'EARNING' | 'DEDUCTION') {
    const d = this.fnfData(); if (!d?.fnf) return;
    d.fnf.lines.push({ key: '', label: '', type, amount: 0, auto: false });
    this.fnfData.set({ ...d });
  }
  removeFnfLine(line: any) {
    const d = this.fnfData(); if (!d?.fnf) return;
    d.fnf.lines = d.fnf.lines.filter((l: any) => l !== line);
    this.fnfData.set({ ...d });
  }

  private fnfDone(obs: any, reloadId?: number) {
    this.fnfBusy.set(true); this.fnfError.set('');
    obs.subscribe({
      next: () => { this.fnfBusy.set(false); this.loadFnfList(); if (reloadId) this.openFnf(reloadId); },
      error: (e: any) => { this.fnfBusy.set(false); this.fnfError.set(e?.error?.message || 'Something went wrong.'); },
    });
  }
  prepareFnf() { const id = this.fnfData()?.resignation?.id; if (id) this.fnfDone(this.offboardingService.prepareFnf(id), id); }
  saveFnf(then?: 'submit') {
    const d = this.fnfData(); if (!d?.fnf?.id) return;
    this.fnfBusy.set(true); this.fnfError.set('');
    this.offboardingService.saveFnf(d.fnf.id, { lines: d.fnf.lines, notes: d.fnf.notes }).subscribe({
      next: () => { this.fnfBusy.set(false); if (then) this.fnfAct('submit'); else { this.loadFnfList(); this.openFnf(d.resignation.id); } },
      error: (e) => { this.fnfBusy.set(false); this.fnfError.set(e?.error?.message || 'Could not save.'); },
    });
  }
  fnfAct(action: 'submit' | 'approve' | 'reject' | 'paid') {
    const d = this.fnfData(); if (!d?.fnf?.id) return;
    if (action === 'reject' && !this.fnfNote.trim()) { this.fnfError.set('Say what needs changing.'); return; }
    if (action === 'paid' && !this.fnfProofUrl()) { this.fnfError.set('Upload the payment proof first.'); return; }
    if (action === 'paid' && !confirm(`Mark ₹${this.fnfNet().toFixed(2)} as paid?`)) return;
    const body = action === 'paid' ? { paidAt: this.fnfPaidAt, paidRef: this.fnfPaidRef, paidProofUrl: this.fnfProofUrl() } : { note: this.fnfNote };
    this.fnfDone(this.offboardingService.fnfAction(d.fnf.id, action, body), d.resignation.id);
  }
  printFnf() { window.print(); }

  // ─── Part 5: relieving & experience letter (20 Nov 2026) ───
  letterOpen = signal(false);
  letterData = signal<any | null>(null);
  letterBody = '';
  letterBodyInit: any = '';
  private sanitizer = inject(DomSanitizer);
  letterTo = '';
  letterBusy = signal(false);
  letterError = signal('');
  openExitLetter(resignationId: number) {
    this.letterOpen.set(true); this.letterData.set(null); this.letterError.set('');
    this.offboardingService.getExitLetter(resignationId).subscribe({
      next: (d) => { this.letterData.set({ ...d, resignationId }); this.letterBody = d.body || ''; this.letterBodyInit = this.sanitizer.bypassSecurityTrustHtml(d.body || ''); this.letterTo = d.sentTo || d.to || ''; },
      error: (e) => this.letterError.set(e?.error?.message || 'Could not load the letter.'),
    });
  }
  sendExitLetter() {
    const d = this.letterData(); if (!d) return;
    if (d.sentAt && !confirm('This letter was already sent. Send it again?')) return;
    this.letterBusy.set(true); this.letterError.set('');
    this.offboardingService.sendExitLetter(d.resignationId, { body: this.letterBody, to: this.letterTo }).subscribe({
      next: (r) => { this.letterBusy.set(false); this.letterData.set({ ...d, sentAt: r.sentAt, sentTo: r.to, pdfUrl: r.pdfUrl }); this.toast.success(`Letter sent to ${r.to}`); this.loadFnfList(); },
      error: (e) => { this.letterBusy.set(false); this.letterError.set(e?.error?.message || 'Could not send the letter.'); },
    });
  }
}
