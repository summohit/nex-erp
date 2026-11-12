import { Component, OnInit, inject, signal, computed, effect } from '@angular/core';
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
  LucideClock,
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
    LucideClock,
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

  activeTab = signal<'resignations' | 'tasks' | 'exit'>('resignations');

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
  taskForm = { id: 0, remarks: '' };

  showInterviewModal = signal(false);
  interviewForm = { employeeId: 0, feedback: '', rating: 3 };
  employees = signal<Employee[]>([]);

  // AG Grid Configuration (Employee Directory Standard)
  readonly paginationPageSize = 20;
  readonly paginationPageSizeSelector = [20, 50, 100, 200];

  readonly defaultColDef: ColDef = {
    sortable: true,
    filter: true,
    resizable: true
  };

  readonly resignationGridOptions: GridOptions = {
    headerHeight: 44,
    rowHeight: 60,
    suppressCellFocus: true,
    enableCellTextSelection: true,
    onCellClicked: (event: any) => this.onResignationGridCellClicked(event)
  };

  readonly taskGridOptions: GridOptions = {
    headerHeight: 44,
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
        minWidth: 230,
        flex: 1.4,
        valueGetter: (params: any) => params.data ? this.employeeName(params.data) : '',
        cellRenderer: (params: any) => {
          const res: Resignation = params.data;
          if (!res) return '';
          const fullName = this.esc(this.employeeName(res));
          const email = this.esc(res.employee?.user?.email || '—');
          const initials = this.esc(this.getInitials(this.employeeName(res)));
          const avatarUrl = res.employee?.avatarUrl;
          const avatarHtml = avatarUrl
            ? `<img src="${this.esc(avatarUrl)}" alt="" style="width:36px; height:36px; border-radius:50%; object-fit:cover; flex-shrink:0; box-shadow:0 0 0 1px rgba(15,23,42,.08);" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex';" />`
              + `<span style="display:none; width:36px; height:36px; border-radius:50%; background:#e0e9ff; color:#2563eb; font-weight:700; font-size:12px; align-items:center; justify-content:center; flex-shrink:0;">${initials}</span>`
            : `<span style="display:inline-flex; width:36px; height:36px; border-radius:50%; background:#e0e9ff; color:#2563eb; font-weight:700; font-size:12px; align-items:center; justify-content:center; flex-shrink:0;">${initials}</span>`;
          return `
            <div style="display:flex; align-items:center; gap:10px; min-width:0; width:100%; overflow:hidden; line-height:1.3;">
              ${avatarHtml}
              <div style="display:flex; flex-direction:column; gap:2px; min-width:0; flex:1; overflow:hidden;">
                <span class="offb-emp-name" style="font-weight:600; color:#0f172a; font-size:13.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; transition:color .15s ease;">${fullName}</span>
                <span style="font-size:11.5px; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${email}</span>
              </div>
            </div>
          `;
        }
      },
      {
        colId: 'employeeCode',
        headerName: 'Employee ID',
        width: 120,
        minWidth: 110,
        flex: 0,
        valueGetter: (params: any) => params.data ? this.employeeIdentifier(params.data) : '',
        cellRenderer: (params: any) => {
          const code = this.esc(params.value || '—');
          return `<span style="display:inline-flex; align-items:center; padding:2px 8px; border-radius:6px; background:#eff6ff; border:1px solid #dbeafe; color:#1d4ed8; font-size:11.5px; font-weight:600; font-variant-numeric:tabular-nums;">${code}</span>`;
        }
      },
      {
        field: 'reason',
        headerName: 'Reason',
        minWidth: 210,
        flex: 1.5,
        cellRenderer: (params: any) => {
          const text = this.esc(params.value || '—');
          return `<span style="color:#334155; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; width:100%;" title="${text}">${text}</span>`;
        }
      },
      {
        field: 'intendedLastWorkingDay',
        headerName: 'Intended LWD',
        width: 135,
        minWidth: 125,
        flex: 0,
        cellRenderer: (params: any) => {
          const d = this.formatDisplayDate(params.value);
          return `<span style="color:#475569; font-size:12.5px; font-weight:500; font-variant-numeric:tabular-nums;">${this.esc(d)}</span>`;
        }
      },
      {
        field: 'approvedLastWorkingDay',
        headerName: 'Approved LWD',
        width: 135,
        minWidth: 125,
        flex: 0,
        cellRenderer: (params: any) => {
          const d = params.value ? this.formatDisplayDate(params.value) : '—';
          return `<span style="color:${params.value ? '#475569' : '#94a3b8'}; font-size:12.5px; font-weight:500; font-variant-numeric:tabular-nums;">${this.esc(d)}</span>`;
        }
      },
      {
        colId: 'approver',
        headerName: 'Approver',
        minWidth: 155,
        flex: 1,
        valueGetter: (params: any) => params.data?.approver?.email || '—',
        cellRenderer: (params: any) => {
          const v = this.esc(params.value || '—');
          return `<span style="color:${params.value && params.value !== '—' ? '#475569' : '#94a3b8'}; font-size:12.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${v}">${v}</span>`;
        }
      },
      {
        field: 'status',
        headerName: 'Status',
        width: 150,
        minWidth: 140,
        flex: 0,
        cellRenderer: (params: any) => {
          const res: Resignation = params.data;
          if (!res) return '';
          const st = (res.status || 'PENDING').toUpperCase();
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
        width: canManage ? 100 : 68,
        minWidth: canManage ? 100 : 68,
        flex: 0,
        sortable: false,
        filter: false,
        resizable: false,
        cellRenderer: (params: any) => {
          const res: Resignation = params.data;
          if (!res) return '';
          const viewBtn = `<button type="button" class="g-icon-btn" data-act="view" title="View resignation details" aria-label="View resignation details"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg></button>`;
          const reviewBtn = canManage && res.status === 'PENDING'
            ? `<button type="button" class="g-icon-btn" data-act="review" title="Review resignation" aria-label="Review resignation"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></button>`
            : '';
          return `<div style="display:flex; align-items:center; gap:6px;">${viewBtn}${reviewBtn}</div>`;
        }
      }
    ];
  });

  taskColDefs = computed<ColDef[]>(() => {
    return [
      {
        colId: 'employee',
        headerName: 'Employee ID',
        width: 135,
        minWidth: 120,
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
        width: 160,
        minWidth: 140,
        flex: 0,
        cellRenderer: (params: any) => {
          const dept = this.esc(params.value || '—');
          return `<span style="display:inline-flex; align-items:center; height:24px; padding:0 9px; border-radius:6px; background:#eff6ff; color:#1d4ed8; font-size:12px; font-weight:500;">${dept}</span>`;
        }
      },
      {
        field: 'taskName',
        headerName: 'Clearance Task',
        minWidth: 260,
        flex: 2,
        cellRenderer: (params: any) => {
          const task: OffboardingTask = params.data;
          if (!task) return '';
          const name = this.esc(task.taskName || 'Untitled task');
          const desc = this.esc(task.description || '');
          return `
            <div style="display:flex; flex-direction:column; gap:2px; min-width:0; width:100%; overflow:hidden; line-height:1.3;">
              <strong style="font-weight:600; color:#0f172a; font-size:13.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${name}">${name}</strong>
              ${desc ? `<span style="font-size:12px; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${desc}">${desc}</span>` : ''}
            </div>
          `;
        }
      },
      {
        colId: 'clearedBy',
        headerName: 'Cleared By',
        minWidth: 170,
        flex: 1,
        valueGetter: (params: any) => params.data?.clearedBy?.email || '—',
        cellRenderer: (params: any) => {
          const v = this.esc(params.value || '—');
          return `<span style="color:${params.value && params.value !== '—' ? '#475569' : '#94a3b8'}; font-size:12.5px;">${v}</span>`;
        }
      },
      {
        field: 'status',
        headerName: 'Status',
        width: 130,
        minWidth: 120,
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
        width: 90,
        minWidth: 80,
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

  setTab(tab: 'resignations' | 'tasks' | 'exit') {
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
    } else if (this.activeTab() === 'exit') {
      if (this.isAdminOrHr()) {
        this.offboardingService.getExitInterviews().subscribe(res => this.interviews.set(res));
        this.employeeService.getEmployees().subscribe(res => this.employees.set(res || []));
      }
    }
  }

  // --- Resignations ---
  openResignModal() {
    this.resignForm = { reason: '', intendedLastWorkingDay: '' };
    this.showResignModal.set(true);
  }

  closeResignModal() {
    this.showResignModal.set(false);
  }

  submitResignation() {
    if (!this.resignForm.reason || !this.resignForm.intendedLastWorkingDay) {
      this.toast.error('Please fill all fields');
      return;
    }
    this.offboardingService.submitResignation(this.resignForm.reason, this.resignForm.intendedLastWorkingDay)
      .subscribe({
        next: () => {
          this.toast.success('Resignation submitted successfully');
          this.closeResignModal();
          this.loadData();
        },
        error: (err) => this.toast.error(err.error?.message || 'Error submitting resignation')
      });
  }

  openApproveModal(resignation: Resignation) {
    this.approveForm = {
      id: resignation.id,
      status: 'APPROVED',
      approvedLastWorkingDay: resignation.intendedLastWorkingDay.split('T')[0],
      remarks: ''
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
    this.offboardingService.updateResignationStatus(
      this.approveForm.id,
      this.approveForm.status,
      this.approveForm.status === 'APPROVED' ? this.approveForm.approvedLastWorkingDay : undefined,
      this.approveForm.remarks
    ).subscribe({
      next: () => {
        this.toast.success(`Resignation ${this.approveForm.status.toLowerCase()}`);
        this.closeApproveModal();
        this.loadData();
      },
      error: (err) => this.toast.error(err.error?.message || 'Error updating status')
    });
  }

  // --- Tasks ---
  openTaskModal(task: OffboardingTask) {
    this.taskForm = { id: task.id, remarks: '' };
    this.showTaskModal.set(true);
  }

  closeTaskModal() {
    this.showTaskModal.set(false);
  }

  submitTask() {
    this.offboardingService.clearTask(this.taskForm.id, this.taskForm.remarks)
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
}
