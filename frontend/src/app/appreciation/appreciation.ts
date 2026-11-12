import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AgGridModule } from 'ag-grid-angular';
import { 
  ColDef, 
  AllCommunityModule, 
  ModuleRegistry, 
  GridOptions, 
  ValueFormatterParams 
} from 'ag-grid-community';
import { AppreciationService, Appreciation, AwardType } from '../services/appreciation.service';
import { EmployeeService, Employee } from '../services/employee.service';
import { UploadService } from '../services/upload.service';
import { AuthService } from '../services/auth.service';
import { HotToastService } from '@ngneat/hot-toast';
import { PageHeaderComponent } from '../shared/components/page-header/page-header';
import { SearchableSelectComponent, SearchableSelectOption } from '../shared/components/searchable-select/searchable-select.component';
import { DatePresetFilterComponent, DatePreset, DateRange } from '../shared/components/date-preset-filter/date-preset-filter';
import { ActionCellRendererComponent } from '../shared/components/action-cell-renderer.component';
import { 
  LucideTrophy, 
  LucideStar, 
  LucideRibbon,
  LucidePlus,
  LucideDownload,
  LucideX,
  LucideUploadCloud,
  LucideSearch,
  LucideCalendar,
  LucideEye,
  LucideTrash2,
  LucideEdit2,
  LucideCheck,
  LucideMoreHorizontal,
  LucideFilter
} from '@lucide/angular';

ModuleRegistry.registerModules([AllCommunityModule]);

@Component({
  selector: 'app-appreciation',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    AgGridModule,
    PageHeaderComponent,
    SearchableSelectComponent,
    DatePresetFilterComponent,
    ActionCellRendererComponent,
    LucideTrophy,
    LucideStar,
    LucideRibbon,
    LucidePlus,
    LucideDownload,
    LucideX,
    LucideUploadCloud,
    LucideSearch,
    LucideCalendar,
    LucideEye,
    LucideTrash2,
    LucideEdit2,
    LucideCheck,
    LucideMoreHorizontal,
    LucideFilter
  ],
  providers: [DatePipe],
  templateUrl: './appreciation.html',
  styleUrls: ['./appreciation.css']
})
export class AppreciationComponent implements OnInit {
  private appreciationService = inject(AppreciationService);
  private employeeService = inject(EmployeeService);
  private uploadService = inject(UploadService);
  public authService = inject(AuthService);
  private toast = inject(HotToastService);
  private datePipe = inject(DatePipe);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  activeTab = signal<'list' | 'types'>('list');
  appreciations = signal<Appreciation[]>([]);
  awardTypes = signal<AwardType[]>([]);
  employees = signal<Employee[]>([]);
  isLoading = signal<boolean>(false);

  // Filters for Appreciations
  searchQuery = signal<string>('');
  filterAwardTypeId = signal<number | null>(null);
  filterDepartmentId = signal<number | null>(null);
  datePreset = signal<DatePreset>('ALL');
  dateRange = signal<DateRange>(null);

  // Filters for Award Categories
  searchCategoryQuery = signal<string>('');
  filterCategoryStatus = signal<string | null>(null);
  filterCategoryColor = signal<string | null>(null);

  // Pagination config
  paginationPageSize = 20;
  paginationPageSizeSelector = [20, 50, 100, 200];

  colorThemes = [
    { id: 'orange', label: 'Orange', bg: '#fff7ed', border: '#ffedd5', dot: '#ea580c' },
    { id: 'blue', label: 'Blue', bg: '#eff6ff', border: '#dbeafe', dot: '#2563eb' },
    { id: 'green', label: 'Green', bg: '#ecfdf5', border: '#a7f3d0', dot: '#059669' },
    { id: 'purple', label: 'Purple', bg: '#f5f3ff', border: '#ede9fe', dot: '#7c3aed' },
    { id: 'red', label: 'Red', bg: '#fef2f2', border: '#fee2e2', dot: '#dc2626' },
    { id: 'yellow', label: 'Yellow', bg: '#fefce8', border: '#fef08a', dot: '#ca8a04' }
  ];

  isAdmin = computed(() => {
    const role = this.authService.currentUser()?.role;
    return role === 'ADMIN' || role === 'HR' || role === 'SUPERADMIN';
  });

  latestHonoreeName = computed(() => {
    const list = this.appreciations();
    if (!list.length || !list[0].employee) return 'None';
    const e = list[0].employee;
    return `${e.firstName} ${e.lastName || ''}`.trim();
  });

  latestHonoreeAward = computed(() => {
    const list = this.appreciations();
    if (!list.length || !list[0].awardType) return 'No awards yet';
    return list[0].awardType.title;
  });

  awardTypeOptions = computed<SearchableSelectOption[]>(() => {
    return this.awardTypes().map(t => ({
      id: t.id,
      name: t.title
    }));
  });

  departmentOptions = computed<SearchableSelectOption[]>(() => {
    const deptMap = new Map<number, string>();
    this.employees().forEach(e => {
      if (e.department?.id && e.department?.name) {
        deptMap.set(e.department.id, e.department.name);
      }
    });
    this.appreciations().forEach(a => {
      const d = (a.employee as any)?.department;
      if (d?.id && d?.name) {
        deptMap.set(d.id, d.name);
      }
    });
    return Array.from(deptMap.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, name]) => ({ id, name }));
  });

  statusOptions: SearchableSelectOption[] = [
    { id: 'ACTIVE', name: 'Active' },
    { id: 'INACTIVE', name: 'Inactive' }
  ];

  colorOptions: SearchableSelectOption[] = [
    { id: 'orange', name: 'Orange' },
    { id: 'blue', name: 'Blue' },
    { id: 'green', name: 'Green' },
    { id: 'purple', name: 'Purple' },
    { id: 'red', name: 'Red' },
    { id: 'yellow', name: 'Yellow' }
  ];

  filteredAppreciations = computed<Appreciation[]>(() => {
    let list = this.appreciations();
    const q = this.searchQuery().trim().toLowerCase();
    const typeId = this.filterAwardTypeId();
    const deptId = this.filterDepartmentId();
    const range = this.dateRange();

    if (q) {
      list = list.filter(a => {
        const name = `${a.employee?.firstName || ''} ${a.employee?.lastName || ''}`.toLowerCase();
        const award = (a.awardType?.title || '').toLowerCase();
        const summary = (a.summary || '').toLowerCase();
        return name.includes(q) || award.includes(q) || summary.includes(q);
      });
    }

    if (typeId !== null) {
      list = list.filter(a => a.awardTypeId === Number(typeId));
    }

    if (deptId !== null) {
      list = list.filter(a => {
        const emp = this.employees().find(e => e.id === a.employeeId);
        const empDeptId = emp?.department?.id || (a.employee as any)?.department?.id;
        return empDeptId === Number(deptId);
      });
    }

    if (range && range.from && range.to) {
      const fromTime = new Date(range.from).setHours(0, 0, 0, 0);
      const toTime = new Date(range.to).setHours(23, 59, 59, 999);
      list = list.filter(a => {
        if (!a.givenDate) return false;
        const t = new Date(a.givenDate).getTime();
        return t >= fromTime && t <= toTime;
      });
    }

    return list;
  });

  filteredAwardTypes = computed<AwardType[]>(() => {
    let list = this.awardTypes();
    const q = this.searchCategoryQuery().trim().toLowerCase();
    const status = this.filterCategoryStatus();
    const color = this.filterCategoryColor();

    if (q) {
      list = list.filter(t => (t.title || '').toLowerCase().includes(q));
    }

    if (status === 'ACTIVE') {
      list = list.filter(t => t.status === true);
    } else if (status === 'INACTIVE') {
      list = list.filter(t => t.status === false);
    }

    if (color) {
      list = list.filter(t => (t.color || '').toLowerCase() === color.toLowerCase());
    }

    return list;
  });

  hasActiveFilters = computed<boolean>(() => {
    return !!this.searchQuery().trim() ||
      this.filterAwardTypeId() !== null ||
      this.filterDepartmentId() !== null ||
      this.datePreset() !== 'ALL' ||
      this.dateRange() !== null;
  });

  hasActiveCategoryFilters = computed<boolean>(() => {
    return !!this.searchCategoryQuery().trim() ||
      this.filterCategoryStatus() !== null ||
      this.filterCategoryColor() !== null;
  });

  clearFilters() {
    this.searchQuery.set('');
    this.filterAwardTypeId.set(null);
    this.filterDepartmentId.set(null);
    this.datePreset.set('ALL');
    this.dateRange.set(null);
  }

  clearCategoryFilters() {
    this.searchCategoryQuery.set('');
    this.filterCategoryStatus.set(null);
    this.filterCategoryColor.set(null);
  }

  onDateRange(range: DateRange) {
    this.dateRange.set(range);
  }

  getInitials(name: string): string {
    if (!name) return 'EM';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  }

  getAvatarColor(name: string): { bg: string; text: string } {
    const colors = [
      { bg: '#EFF6FF', text: '#2563EB' },
      { bg: '#F5F3FF', text: '#7C3AED' },
      { bg: '#ECFDF5', text: '#059669' },
      { bg: '#FFFBEB', text: '#D97706' },
      { bg: '#FEF2F2', text: '#DC2626' },
      { bg: '#F0FDFA', text: '#0D9488' }
    ];
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  formatDisplayDate(val: any): string {
    if (!val) return '—';
    const d = new Date(val);
    if (isNaN(d.getTime())) return '—';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = d.getDate();
    const mon = months[d.getMonth()];
    const yr = d.getFullYear();
    return `${day} ${mon} ${yr}`;
  }

  /** Status cells: a soft tinted chip with the same dot as the Employee Directory. */
  private statusDot(label: string, tone: 'good' | 'wait' | 'bad' | 'off', title = ''): string {
    const [dot, bg, text] = {
      good: ['#059669', '#ecfdf5', '#047857'],
      wait: ['#d97706', '#fffbeb', '#b45309'],
      bad: ['#dc2626', '#fef2f2', '#b91c1c'],
      off: ['#94a3b8', '#f1f5f9', '#475569'],
    }[tone];
    return `<span title="${title}" style="display:inline-flex; align-items:center; gap:6px; height:24px; padding:0 8px; border-radius:6px; background:${bg}; font-size:12px; font-weight:500; color:${text}; white-space:nowrap;">`
      + `<span style="width:6px; height:6px; border-radius:50%; background:${dot}; flex-shrink:0;"></span>${label}</span>`;
  }

  // AG Grid Configuration
  defaultColDef: ColDef = {
    sortable: true,
    filter: true,
    resizable: true
  };

  gridOptions: GridOptions = {
    headerHeight: 44,
    rowHeight: 80,
    suppressCellFocus: true,
    enableCellTextSelection: true,
    suppressHorizontalScroll: false,
    overlayNoRowsTemplate: '<div class="ag-no-rows" style="padding: 24px; text-align: center;"><div style="font-size: 24px; margin-bottom: 8px;">🏆</div><div style="font-weight: 600; color: #475569;">No appreciation records found</div><div style="font-size: 12px; color: #94a3b8; margin-top: 4px;">Try clearing or adjusting your search filters.</div></div>'
  };

  appreciationColDefs: ColDef[] = [
    {
      field: 'employee',
      headerName: 'Employee Name',
      minWidth: 180,
      flex: 0.9,
      cellRenderer: (params: any) => {
        const emp = params.data?.employee;
        if (!emp) return '<span style="color:#94a3b8;">Unassigned</span>';
        const fn = emp.firstName || '';
        const ln = emp.lastName || '';
        const toTitle = (s: string) => s.toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase());
        const initials = `${fn.charAt(0)}${ln.charAt(0)}`.toUpperCase() || 'EM';
        const fullName = toTitle(`${fn} ${ln}`.trim());
        const avatarUrl = emp.avatarUrl;

        const avatarHtml = avatarUrl 
            ? `<img src="${avatarUrl}" alt="${fullName}" style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover; flex-shrink: 0; box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.08);" onerror="this.onerror=null; this.src='assets/default-avatar.png';" />`
            : `<div style="width: 36px; height: 36px; border-radius: 50%; background: #F1F5F9; display: flex; align-items: center; justify-content: center; font-weight: 600; color: #475569; font-size: 13px; flex-shrink: 0; box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.08);">${initials}</div>`;

        return `
          <div style="display: flex; align-items: center; gap: 12px; line-height: 1.25; min-width: 0; width: 100%;">
            ${avatarHtml}
            <div style="min-width: 0; flex: 1;">
              <div class="emp-name-text" title="Click to view details" style="font-weight: 600; color: #0F172A; font-size: 13.5px; white-space: normal; overflow-wrap: anywhere; transition: color 0.15s ease;">${fullName}</div>
            </div>
          </div>
        `;
      }
    },
    {
      field: 'awardType.title',
      headerName: 'Award Name',
      minWidth: 200,
      flex: 1.2,
      cellRenderer: (params: any) => {
        const award = params.data?.awardType;
        if (!award) return '<span style="color:#94a3b8;">—</span>';
        const color = award.color || 'orange';
        const colorMap: Record<string, { bg: string; text: string; border: string }> = {
          orange: { bg: '#fff7ed', text: '#ea580c', border: '#ffedd5' },
          blue: { bg: '#eff6ff', text: '#2563eb', border: '#dbeafe' },
          green: { bg: '#ecfdf5', text: '#059669', border: '#a7f3d0' },
          purple: { bg: '#f5f3ff', text: '#7c3aed', border: '#ede9fe' },
          red: { bg: '#fef2f2', text: '#dc2626', border: '#fee2e2' },
          yellow: { bg: '#fefce8', text: '#ca8a04', border: '#fef08a' }
        };
        const theme = colorMap[color] || colorMap['orange'];
        return `
          <div style="display: flex; align-items: center; gap: 10px; min-width: 0; height: 100%;">
            <div style="width: 34px; height: 34px; border-radius: 8px; background: ${theme.bg}; color: ${theme.text}; border: 1px solid ${theme.border}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path><path d="M4 22h16"></path><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"></path><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"></path><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"></path></svg>
            </div>
            <span style="font-weight: 600; color: #0f172a; font-size: 13.5px; line-height: 1.3; white-space: normal; overflow-wrap: anywhere; min-width: 0;">${award.title}</span>
          </div>
        `;
      }
    },
    {
      field: 'summary',
      headerName: 'Recognition Summary',
      minWidth: 260,
      flex: 1.6,
      cellStyle: {
        'white-space': 'normal',
        'line-height': '1.45',
        'display': 'flex',
        'align-items': 'center',
        'overflow': 'hidden'
      },
      cellRenderer: (params: any) => {
        const text = String(params.value || '').trim();
        if (!text) return '<span style="color:#94a3b8;">—</span>';
        const id = params.data?.id;
        const isLong = text.length > 70;
        const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        return `
          <div style="width: 100%; min-width: 0; overflow: hidden; display: flex; flex-direction: column; align-items: flex-start; gap: 3px;">
            <div style="width: 100%; font-size: 13px; line-height: 1.45; color: #334155; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; word-break: break-word;" title="${escaped}">${escaped}</div>
            ${isLong ? `
              <button type="button" class="btn-read-more" data-action="view" data-id="${id}" title="Read full recognition summary" aria-label="Read full recognition summary">
                <span>Read more</span>
                <svg class="btn-read-more-arrow" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
              </button>
            ` : ''}
          </div>
        `;
      }
    },
    {
      field: 'givenDate',
      headerName: 'Given On',
      width: 130,
      minWidth: 120,
      flex: 0.8,
      cellRenderer: (params: any) => {
        const d = this.formatDisplayDate(params.value);
        return `<span style="color: #475569; font-size: 13px; font-weight: 500; font-variant-numeric: tabular-nums;">${d}</span>`;
      }
    },
    {
      headerName: 'Actions',
      width: 84,
      minWidth: 84,
      flex: 0,
      sortable: false,
      filter: false,
      resizable: false,
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: () => ({
        onView: (data: any) => this.openDetailModal(data),
        viewLabel: 'View Details',
        ...(this.isAdmin() ? { onDelete: (data: any) => this.deleteAppreciation(data), deleteLabel: 'Delete' } : {})
      })
    }
  ];

  awardTypeColDefs: ColDef[] = [
    {
      field: 'color',
      headerName: 'Icon',
      width: 76,
      minWidth: 70,
      flex: 0,
      cellRenderer: (params: any) => {
        const color = params.data?.color || 'orange';
        const colorMap: Record<string, { bg: string; text: string; border: string }> = {
          orange: { bg: '#fff7ed', text: '#ea580c', border: '#ffedd5' },
          blue: { bg: '#eff6ff', text: '#2563eb', border: '#dbeafe' },
          green: { bg: '#ecfdf5', text: '#059669', border: '#a7f3d0' },
          purple: { bg: '#f5f3ff', text: '#7c3aed', border: '#ede9fe' },
          red: { bg: '#fef2f2', text: '#dc2626', border: '#fee2e2' },
          yellow: { bg: '#fefce8', text: '#ca8a04', border: '#fef08a' }
        };
        const theme = colorMap[color] || colorMap['orange'];
        return `
          <div style="display: flex; align-items: center; height: 100%;">
            <div style="width: 34px; height: 34px; border-radius: 8px; background: ${theme.bg}; color: ${theme.text}; border: 1px solid ${theme.border}; display: flex; align-items: center; justify-content: center;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path><path d="M4 22h16"></path><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"></path><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"></path><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"></path></svg>
            </div>
          </div>
        `;
      }
    },
    {
      field: 'title',
      headerName: 'Category Title',
      minWidth: 260,
      flex: 2,
      cellRenderer: (params: any) => {
        return `<span style="font-weight: 600; color: #0f172a; font-size: 13.5px;">${params.value || ''}</span>`;
      }
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 130,
      minWidth: 120,
      flex: 0,
      cellRenderer: (params: any) => {
        const active = !!params.value;
        return this.statusDot(active ? 'Active' : 'Inactive', active ? 'good' : 'off');
      }
    },
    {
      headerName: 'Total Honors',
      width: 150,
      minWidth: 130,
      flex: 0,
      valueGetter: (params: any) => {
        const typeId = params.data?.id;
        const count = this.appreciations().filter(a => a.awardTypeId === typeId).length;
        return `${count} Awarded`;
      },
      cellRenderer: (params: any) => {
        return `<span style="color: #475569; font-size: 13px; font-weight: 600;">${params.value}</span>`;
      }
    },
    {
      headerName: 'Actions',
      width: 84,
      minWidth: 84,
      flex: 0,
      sortable: false,
      filter: false,
      resizable: false,
      hide: !this.isAdmin(),
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: {
        onEdit: (data: any) => this.openEditTypeModal(data),
        editLabel: 'Edit Category',
        onDelete: (data: any) => this.deleteAwardType(data),
        deleteLabel: 'Delete Category'
      }
    }
  ];

  onCellClicked(event: any) {
    const colId = event.colDef?.colId || event.colDef?.field || event.colDef?.headerName;
    if (colId === 'Actions' || colId === 'actions') return;

    const target = event.event?.target as HTMLElement;
    if (!target) return;
    const btn = target.closest('button[data-action]');
    if (btn) {
      const action = btn.getAttribute('data-action');
      const id = Number(btn.getAttribute('data-id'));

      if (action === 'view') {
        const appr = this.appreciations().find(a => a.id === id);
        if (appr) this.openDetailModal(appr);
      }
      return;
    }

    // Clicking anywhere else on an appreciation row opens the details modal
    if (this.activeTab() === 'list' && event.data) {
      this.openDetailModal(event.data);
    }
  }

  // Modal & Menu States
  openMenuId = signal<number | null>(null);
  isDetailModalOpen = signal<boolean>(false);
  selectedAppreciation = signal<Appreciation | null>(null);

  toggleActionMenu(id: number, event: Event) {
    event.stopPropagation();
    if (this.openMenuId() === id) {
      this.openMenuId.set(null);
    } else {
      this.openMenuId.set(id);
    }
  }

  closeActionMenu() {
    this.openMenuId.set(null);
  }

  isGiveModalOpen = signal<boolean>(false);
  isSubmittingGive = signal<boolean>(false);
  selectedFile: File | null = null;
  giveForm = {
    employeeId: '',
    awardTypeId: '',
    givenDate: new Date().toISOString().split('T')[0],
    summary: '',
    photoUrl: ''
  };

  isTypeModalOpen = signal<boolean>(false);
  isSubmittingType = signal<boolean>(false);
  typeForm = {
    id: 0,
    title: '',
    icon: 'trophy',
    color: 'orange',
    status: true
  };

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      const tab = params.get('tab');
      if (tab === 'types') {
        this.activeTab.set('types');
      } else {
        this.activeTab.set('list');
      }
    });

    this.loadData();
  }

  setTab(tab: 'list' | 'types') {
    this.activeTab.set(tab);
    this.router.navigate(['/appreciation', tab]);
  }

  loadData() {
    this.isLoading.set(true);
    this.appreciationService.getAppreciations().subscribe({
      next: (res) => {
        this.appreciations.set(res || []);
        this.isLoading.set(false);
      },
      error: () => {
        this.toast.error('Failed to load appreciations');
        this.isLoading.set(false);
      }
    });

    this.appreciationService.getAwardTypes().subscribe({
      next: (res) => this.awardTypes.set(res || []),
      error: () => this.toast.error('Failed to load award categories')
    });

    this.employeeService.getEmployees().subscribe({
      next: (res) => this.employees.set(res || [])
    });
  }

  // --- View Details ---
  openDetailModal(appr: Appreciation) {
    this.selectedAppreciation.set(appr);
    this.isDetailModalOpen.set(true);
  }

  closeDetailModal() {
    this.isDetailModalOpen.set(false);
    this.selectedAppreciation.set(null);
  }

  giveSubmitted = signal<boolean>(false);

  // --- Give Appreciation ---
  openGiveModal() {
    this.giveForm = {
      employeeId: '',
      awardTypeId: '',
      givenDate: new Date().toISOString().split('T')[0],
      summary: '',
      photoUrl: ''
    };
    this.giveSubmitted.set(false);
    this.selectedFile = null;
    this.isGiveModalOpen.set(true);
  }

  closeGiveModal() {
    this.isGiveModalOpen.set(false);
  }

  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      this.selectedFile = file;
      this.uploadService.uploadFile(file).subscribe({
        next: (res) => {
          this.giveForm.photoUrl = res.url;
          this.toast.success('Certificate/Photo uploaded successfully');
        },
        error: () => this.toast.error('Failed to upload photo')
      });
    }
  }

  removeUploadedFile(event: Event) {
    event.stopPropagation();
    this.selectedFile = null;
    this.giveForm.photoUrl = '';
  }

  saveGiveAppreciation() {
    this.giveSubmitted.set(true);
    if (!this.giveForm.employeeId || !this.giveForm.awardTypeId || !this.giveForm.givenDate || !this.giveForm.summary.trim()) {
      this.toast.error('Please fill all required fields');
      return;
    }

    this.isSubmittingGive.set(true);
    this.appreciationService.createAppreciation(this.giveForm).subscribe({
      next: () => {
        this.toast.success('Appreciation awarded successfully!');
        this.closeGiveModal();
        this.loadData();
        this.isSubmittingGive.set(false);
      },
      error: (err) => {
        this.toast.error(err.error?.message || 'Failed to grant appreciation');
        this.isSubmittingGive.set(false);
      }
    });
  }

  deleteAppreciation(idOrData: any, event?: Event) {
    if (event && event.stopPropagation) event.stopPropagation();
    const id = typeof idOrData === 'object' ? idOrData?.id : idOrData;
    if (!id) return;
    if (!confirm('Are you sure you want to delete this appreciation?')) return;
    this.appreciationService.deleteAppreciation(id).subscribe({
      next: () => {
        this.toast.success('Appreciation record deleted');
        this.loadData();
      },
      error: () => this.toast.error('Failed to delete appreciation')
    });
  }

  // --- Award Types CRUD ---
  openAddTypeModal() {
    this.typeForm = { id: 0, title: '', icon: 'trophy', color: 'orange', status: true };
    this.isTypeModalOpen.set(true);
  }

  openEditTypeModal(type: AwardType) {
    this.typeForm = { ...type };
    this.isTypeModalOpen.set(true);
  }

  closeTypeModal() {
    this.isTypeModalOpen.set(false);
  }

  saveAwardType() {
    if (!this.typeForm.title.trim()) {
      this.toast.error('Award title is required');
      return;
    }

    this.isSubmittingType.set(true);
    if (this.typeForm.id) {
      this.appreciationService.updateAwardType(this.typeForm.id, this.typeForm).subscribe({
        next: () => {
          this.toast.success('Award Category updated');
          this.closeTypeModal();
          this.loadData();
          this.isSubmittingType.set(false);
        },
        error: () => {
          this.toast.error('Failed to update award category');
          this.isSubmittingType.set(false);
        }
      });
    } else {
      this.appreciationService.createAwardType(this.typeForm).subscribe({
        next: () => {
          this.toast.success('New Award Category created');
          this.closeTypeModal();
          this.loadData();
          this.isSubmittingType.set(false);
        },
        error: () => {
          this.toast.error('Failed to create award category');
          this.isSubmittingType.set(false);
        }
      });
    }
  }

  deleteAwardType(idOrData: any) {
    const id = typeof idOrData === 'object' ? idOrData?.id : idOrData;
    if (!id) return;
    if (!confirm('Are you sure you want to delete this award category?')) return;
    this.appreciationService.deleteAwardType(id).subscribe({
      next: () => {
        this.toast.success('Award category deleted');
        this.loadData();
      },
      error: () => this.toast.error('Failed to delete award category')
    });
  }

  exportToCsv() {
    const list = this.activeTab() === 'list' ? this.filteredAppreciations() : [];
    if (this.activeTab() === 'list') {
      if (list.length === 0) {
        this.toast.error('No appreciations to export');
        return;
      }

      let csv = 'Employee Name,Award Name,Given On,Summary\n';
      list.forEach(a => {
        const empName = `"${a.employee?.firstName || ''} ${a.employee?.lastName || ''}".trim()`;
        const award = `"${a.awardType?.title || '-'}"`;
        const date = `"${this.formatDisplayDate(a.givenDate)}"`;
        const summary = `"${(a.summary || '').replace(/"/g, '""')}"`;
        csv += `${empName},${award},${date},${summary}\n`;
      });

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `appreciations_export_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } else {
      const types = this.filteredAwardTypes();
      if (types.length === 0) {
        this.toast.error('No award categories to export');
        return;
      }

      let csv = 'Category Title,Theme Color,Status,Total Honorees\n';
      types.forEach(t => {
        const title = `"${t.title || ''}"`;
        const color = `"${t.color || 'orange'}"`;
        const status = t.status ? 'Active' : 'Inactive';
        const count = this.appreciations().filter(a => a.awardTypeId === t.id).length;
        csv += `${title},${color},${status},${count}\n`;
      });

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `award_categories_export_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    }
  }
}
