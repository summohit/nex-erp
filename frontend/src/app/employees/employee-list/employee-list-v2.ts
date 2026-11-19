import { Component, inject, OnInit, signal, HostListener, computed, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProfileModalService } from '../../shared/profile-modal/profile-modal.service';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { EmployeeService, Employee } from '../../services/employee.service';
import { MasterDataService, Department, Designation } from '../../services/master-data.service';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucidePlus,
  LucideTable,
  LucideFilter,
  LucideSearch,
  LucideX,
  LucideChevronRight,
  LucideUpload,
  LucideLayoutGrid,
  LucideList,
  LucideBuilding,
  LucideMail,
  LucidePhone,
  LucideUserPlus,
  LucideClock,
  LucideCheckSquare,
  LucideTrendingUp,
  LucideRotateCcw,
} from '@lucide/angular';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { ActionCellRendererComponent } from '../../shared/components/action-cell-renderer.component';
import { EmployeeDrawerComponent } from '../employee-drawer/employee-drawer';
import { BulkUploadModalComponent } from '../components/bulk-upload-modal/bulk-upload-modal';
import { SearchableSelectComponent } from '../../shared/components/searchable-select/searchable-select.component';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header';
import { DatePresetFilterComponent, DatePreset, DateRange, inDateRange } from '../../shared/components/date-preset-filter/date-preset-filter';

ModuleRegistry.registerModules([AllCommunityModule]);

@Component({
  selector: 'app-employee-list-v2',
  standalone: true,
  imports: [
    CommonModule,
    DatePresetFilterComponent,
    PageHeaderComponent,
    FormsModule,
    RouterLink,
    LucidePlus,
    LucideTable,
    LucideFilter,
    LucideSearch,
    LucideX,
    LucideChevronRight,
    LucideUpload,
    LucideLayoutGrid,
    LucideList,
    LucideBuilding,
    LucideMail,
    LucidePhone,
    LucideUserPlus,
    LucideClock,
    LucideCheckSquare,
    LucideTrendingUp,
    LucideRotateCcw,
    AgGridAngular,
    EmployeeDrawerComponent,
    BulkUploadModalComponent,
    SearchableSelectComponent
  ],
  templateUrl: './employee-list-v2.html',
  styleUrls: ['./employee-list-v2.css']
})
export class EmployeeListComponentV2 implements OnInit {

  @ViewChild('directorySearch') directorySearch?: ElementRef<HTMLInputElement>;

  private employeeService = inject(EmployeeService);
  private masterDataService = inject(MasterDataService);
  private toast = inject(HotToastService);
  private router = inject(Router);
  private profileModal = inject(ProfileModalService);
  private route = inject(ActivatedRoute);
  public authService = inject(AuthService);

  employees = signal<Employee[]>([]);
  isLoading = signal<boolean>(true);
  departments = signal<Department[]>([]);
  designations = signal<Designation[]>([]);

  departmentOptions = computed(() => this.departments().map(d => ({ id: d.id, name: d.name })));
  designationOptions = computed(() => this.designations().map(d => ({ id: d.id, name: d.name })));
  roleOptions = [
    { id: 'ADMIN', name: 'Admin' },
    { id: 'HR', name: 'HR' },
    { id: 'FINANCE', name: 'Finance' },
    { id: 'EMPLOYEE', name: 'Employee' },
    { id: 'OFFICE_STAFF', name: 'Office Staff' }
  ];
  onboardingStatusOptions = [
    { id: 'PENDING', name: 'Pending' },
    { id: 'IN_PROGRESS', name: 'In Progress' },
    { id: 'COMPLETED', name: 'Completed' }
  ];
  /** Employment status (4 Nov 2026): probation, overdue probation, confirmed, trainee, contract. */
  employmentStatusOptions = [
    { id: 'PROBATION', name: 'On probation' },
    { id: 'OVERDUE', name: 'Probation overdue' },
    { id: 'CONFIRMED', name: 'Confirmed' },
    { id: 'PERMANENT', name: 'Permanent' },
    { id: 'TRAINEE', name: 'Trainee' },
    { id: 'CONTRACT', name: 'Contract' },
  ];
  filterEmploymentStatus: string | null = null;
  /** Directory opens on Active (management, 11 Nov); Reset returns to Active. */
  // Active employees by default (asked 16 Nov 2026); the box shows 'Active'.
  // Pick 'All employees' (clear) or 'Deactivated' to see the others.
  filterAccountStatus: string | null = 'ACTIVE';
  accountStatusOptions = [
    { id: 'ACTIVE', name: 'Active' },
    { id: 'DEACTIVATED', name: 'Deactivated' },
    { id: 'OFFBOARDED', name: 'Offboarded' },
  ];

  accountStatus(e: any): 'ACTIVE' | 'DEACTIVATED' | 'OFFBOARDED' {
    if (e?.offboardingStatus === 'SEPARATED') return 'OFFBOARDED';
    if (['SUSPENDED', 'INACTIVE', 'BLOCKED'].includes(String(e?.user?.status || '').toUpperCase())) return 'DEACTIVATED';
    return 'ACTIVE';
  }

  /** Bar colours for the employment mix: settled staff in brand blues, the
      rest in the same tones as their status chips. */
  private readonly mixColours: Record<string, string> = {
    PERMANENT: '#2563eb',
    CONFIRMED: '#3b82f6',
    PROBATION: '#f59e0b',
    OVERDUE: '#ef4444',
    TRAINEE: '#10b981',
    CONTRACT: '#8b5cf6',
  };

  /** Headcount strip above the filters, from the full list (not the filtered one). */
  headcount = computed(() => {
    const all = this.employees();
    const current = all.filter(e => (e as any).offboardingStatus !== 'SEPARATED');
    const deactivated = current.filter(e => ['SUSPENDED', 'INACTIVE', 'BLOCKED'].includes(String(e.user?.status || '').toUpperCase())).length;
    const counts: Record<string, number> = {};
    current.forEach(e => { const k = this.employmentStatus(e); counts[k] = (counts[k] || 0) + 1; });
    const total = current.length;
    const mix = this.employmentStatusOptions
      .map(o => ({ id: o.id, label: o.name, count: counts[o.id] || 0, colour: this.mixColours[o.id], pct: total ? ((counts[o.id] || 0) / total) * 100 : 0 }))
      .filter(m => m.count > 0);
    return {
      total,
      offboarded: all.length - total,
      active: total - deactivated,
      deactivated,
      onProbation: (counts['PROBATION'] || 0) + (counts['OVERDUE'] || 0),
      overdue: counts['OVERDUE'] || 0,
      onboarding: current.filter(e => e.onboardingStatus === 'IN_PROGRESS').length,
      onboardingPending: current.filter(e => (e.onboardingStatus || 'PENDING') === 'PENDING').length,
      mix,
    };
  });

  /** Clicking a segment or its legend filters to it; clicking it again clears. */
  toggleEmploymentFilter(id: string) {
    this.filterEmploymentStatus = this.filterEmploymentStatus === id ? null : id;
    this.applyFilters();
  }

  employmentStatus(e: any): string {
    if (e?.probationEndDate && !e?.probationConfirmedAt) {
      const end = new Date(e.probationEndDate); end.setHours(23, 59, 59);
      return end.getTime() < Date.now() ? 'OVERDUE' : 'PROBATION';
    }
    if (e?.employmentCategory === 'TRAINEE') return 'TRAINEE';
    if (e?.employmentCategory === 'CONTRACT') return 'CONTRACT';
    return e?.probationConfirmedAt ? 'CONFIRMED' : 'PERMANENT';
  }
  employmentBadge(e: any): { label: string; cls: string; title: string } {
    const s = this.employmentStatus(e);
    const d = (v: any) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
    switch (s) {
      case 'PROBATION': return { label: `Probation · ends ${d(e.probationEndDate).replace(/ \d{4}$/, '')}`, cls: 'emp-probation', title: `On probation until ${d(e.probationEndDate)}` };
      case 'OVERDUE': return { label: 'Probation overdue', cls: 'emp-overdue', title: `Probation ended ${d(e.probationEndDate)} — not decided yet` };
      case 'CONFIRMED': return { label: 'Confirmed', cls: 'emp-confirmed', title: `Confirmed on ${d(e.probationConfirmedAt)}` };
      case 'TRAINEE': return { label: 'Trainee', cls: 'emp-trainee', title: 'Trainee' };
      case 'CONTRACT': return { label: 'Contract', cls: 'emp-contract', title: 'Contract' };
      default: return { label: 'Permanent', cls: 'emp-permanent', title: 'Permanent' };
    }
  }

  offboardingStatusOptions = [
    { id: 'NONE', name: 'Not started' },
    { id: 'IN_PROGRESS', name: 'In progress' },
    { id: 'SEPARATED', name: 'Offboarded' },
  ];

  viewMode = signal<'table' | 'cards'>('table');
  isDrawerOpen = false;
  isBulkUploadOpen = false;
  selectedEmployee: Employee | null = null;
  gridApi: any;

  isAdmin(): boolean {
    const role = this.authService.currentUser()?.role;
    return role === 'ADMIN' || role === 'HR' || role === 'SUPERADMIN';
  }

  openBulkUpload() {
    this.isBulkUploadOpen = true;
  }

  onBulkUploadClose(success: boolean) {
    this.isBulkUploadOpen = false;
    if (success) {
      this.toast.success('Bulk upload completed');
      this.loadEmployees();
    }
  }

  inlineSearchOpen = false;

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      this.focusDirectorySearch();
    }
    if (event.key === 'Escape' && this.inlineSearchOpen) {
      this.inlineSearchOpen = false;
      this.directorySearch?.nativeElement.blur();
    }
  }

  focusDirectorySearch() {
    this.inlineSearchOpen = true;
    setTimeout(() => this.directorySearch?.nativeElement.focus());
  }

  onDirectorySearch(value: string) {
    this.searchText = value;
    this.inlineSearchOpen = true;
    this.onSearch();
  }

  directorySearchSuggestions(): Employee[] {
    const query = this.searchText.trim().toLowerCase();
    if (!query) return [];
    return this.employees().filter((employee: any) => {
      const searchable = [employee.firstName, employee.lastName, employee.employeeCode,
        employee.user?.email, employee.department?.name, employee.designation?.name]
        .filter(Boolean).join(' ').toLowerCase();
      return query.split(/\s+/).every(w => searchable.includes(w));
    }).slice(0, 8);
  }

  selectDirectorySuggestion(employee: Employee) {
    this.searchText = `${employee.firstName || ''} ${employee.lastName || ''}`.trim();
    this.inlineSearchOpen = false;
    // AG Grid's quick filter indexes the raw first-name field separately from
    // the last name, so a full display name can fail to match even though the
    // suggestion came from that row. Filter by the employee's unique code
    // while keeping the full, readable name in the input.
    if (this.gridApi) {
      this.gridApi.setGridOption('quickFilterText', employee.employeeCode || employee.user?.email || employee.firstName || '');
    }
  }

  // Filters state
  searchText = '';
  filterDepartmentId: number | null = null;
  filterDesignationId: number | null = null;
  filterRole: string | null = null;
  filterOnboardingStatus: string | null = null;
  filterOffboardingStatus: string | null = null;

  defaultColDef: ColDef = {
    minWidth: 120,
    filter: true,
    sortable: true
  };

  paginationPageSize = 20;
  paginationPageSizeSelector = [20, 50, 100, 200];

  /** Joined within (12 Nov 2026), the same date filter as the other Employee pages. */
  datePreset: DatePreset = 'ALL';
  dateRange: DateRange = null;
  /** "+ Filters" panel and the chips under the bar (12 Nov 2026). */
  moreOpen = false;
  moreFilterCount(): number {
    return [this.filterDesignationId, this.filterRole, this.filterOffboardingStatus].filter(v => !!v).length;
  }
  activeChips(): { id: string; key: string; value: string }[] {
    const name = (opts: { id: any; name: string }[], v: any) => opts.find(o => String(o.id) === String(v))?.name ?? String(v);
    const chips: { id: string; key: string; value: string }[] = [];
    if (this.filterDepartmentId) chips.push({ id: 'dept', key: 'Department', value: name(this.departmentOptions(), this.filterDepartmentId) });
    if (this.dateRange) chips.push({ id: 'joined', key: 'Joined', value: this.joinedLabel() });
    if (this.filterDesignationId) chips.push({ id: 'desig', key: 'Designation', value: name(this.designationOptions(), this.filterDesignationId) });
    if (this.filterRole) chips.push({ id: 'role', key: 'Role', value: name(this.roleOptions, this.filterRole) });
    if (this.filterOnboardingStatus) chips.push({ id: 'onb', key: 'Onboarding', value: name(this.onboardingStatusOptions, this.filterOnboardingStatus) });
    if (this.filterOffboardingStatus) chips.push({ id: 'offb', key: 'Offboarding', value: name(this.offboardingStatusOptions, this.filterOffboardingStatus) });
    if (this.filterEmploymentStatus) chips.push({ id: 'emp', key: 'Employment', value: name(this.employmentStatusOptions, this.filterEmploymentStatus) });
    return chips;
  }
  private joinedLabel(): string {
    const r = this.dateRange!;
    const f = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return f(r.from) === f(r.to) ? f(r.from) : `${f(r.from)} – ${f(r.to)}`;
  }
  removeChip(id: string) {
    if (id === 'dept') this.filterDepartmentId = null;
    if (id === 'desig') this.filterDesignationId = null;
    if (id === 'role') this.filterRole = null;
    if (id === 'onb') this.filterOnboardingStatus = null;
    if (id === 'offb') this.filterOffboardingStatus = null;
    if (id === 'emp') this.filterEmploymentStatus = null;
    if (id === 'joined') { this.datePreset = 'ALL'; this.dateRange = null; }
    this.applyFilters();
    this.gridApi?.onFilterChanged();
  }

  onDateRange(r: DateRange) {
    this.dateRange = r;
    this.gridApi?.onFilterChanged();
  }

  gridOptions = {
    isExternalFilterPresent: () => !!this.dateRange || !!this.filterAccountStatus || this.personalOnly,
    doesExternalFilterPass: (node: any) =>
      inDateRange(node.data?.joiningDate, this.dateRange) &&
      (!this.personalOnly || (node.data?.user?.status === 'ACTIVE' && this.isPersonalEmail(node.data))) &&
      (!this.filterAccountStatus || this.accountStatus(node.data) === this.filterAccountStatus),
    headerHeight: 44,
    rowHeight: 72,
    // Keep every directory column at a readable width.  On a narrow viewport
    // AG Grid's horizontal rail is intentionally available rather than
    // shrinking text until names, emails, and job titles are cut off.
    suppressHorizontalScroll: false,
    // Keep former employees visually separate from the live directory.
    rowClassRules: {
      'offboarded-employee-row': (params: any) => params.data?.offboardingStatus === 'SEPARATED',
      'deactivated-employee-row': (params: any) =>
        ['SUSPENDED', 'INACTIVE', 'BLOCKED'].includes(String(params.data?.user?.status || '').toUpperCase()),
    },
    // Clicking anywhere in the row (or view profile) redirects to their profile page.
    onCellClicked: (e: any) => {
      if (!e.data?.id) return;
      // Skip actions column and selection checkbox column
      const colId = e.colDef?.colId || e.colDef?.field;
      if (colId === 'Actions' || colId === 'actions' || e.colDef?.headerName === 'Actions') return;
      if (colId === 'ag-Grid-AutoColumn' || e.colDef?.checkboxSelection) return;

      if (e.colDef?.field === 'offboardingStatus' && e.data?.offboardingStatus !== 'NONE') {
        this.router.navigate(['/offboarding'], { queryParams: { employeeId: e.data.id } });
        return;
      }
      this.openProfile(e.data);
    },
  };

  openProfile(emp: any) {
    const id = emp?.id ?? emp;
    if (id) {
      this.router.navigate(['/employees', id, 'profile']);
    }
  }

  /** Status cells: a soft tinted chip with the same dot as the header's shift clock. */
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

  onboardingLabel(status?: string | null): string {
    if (status === 'IN_PROGRESS') return 'Onboarding in progress';
    if (status === 'PENDING') return 'Onboarding pending';
    return 'Onboarded';
  }

  /** SUPERADMIN → "Super admin", OPERATIONS_MANAGER → "Operations manager"; HR stays HR. */
  roleLabel(role?: string | null): string {
    const r = String(role || 'EMPLOYEE').toUpperCase();
    if (r === 'HR') return 'HR';
    if (r === 'SUPERADMIN') return 'Super admin';
    const words = r.toLowerCase().replace(/_/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  colDefs: ColDef[] = [
    { 
      headerName: 'Employee Name',
      field: 'firstName',
      // The quick filter matches every typed word; give it the whole name (and
      // code / email) so "Akshara Shukla" finds Akshara Shukla (16 Nov 2026).
      getQuickFilterText: (params: any) => [params.data?.firstName, params.data?.lastName,
        params.data?.employeeCode, params.data?.user?.email].filter(Boolean).join(' '),
      flex: 1.2,
      minWidth: 280,
      width: 310,
      cellRenderer: (params: any) => {
        if (!params.data) return '';
        const fn = params.data.firstName || '';
        const ln = params.data.lastName || '';
        // Lowercase first, then capitalise each word — otherwise names typed in
        // caps ("JOHN DOE") stay shouting, since \b\w alone only touches the
        // leading letter of each word.
        const toTitle = (s: string) => s.toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase());
        const initials = `${fn.charAt(0)}${ln.charAt(0)}`.toUpperCase();
        const fullName = toTitle(`${fn} ${ln}`.trim());
        const email = params.data.user?.email || '';
        const avatarUrl = params.data.avatarUrl || params.data.user?.avatarUrl;

        // Onboarding status displayed just below their email with colored text
        const onbStatus = params.data.onboardingStatus || 'PENDING';
        let onbLabel = 'Onboarding pending';
        let onbColor = '#64748B'; // slate
        let onbDotColor = '#94A3B8';

        if (onbStatus === 'COMPLETED') {
          onbLabel = 'Onboarded';
          onbColor = '#059669'; // emerald
          onbDotColor = '#10B981';
        } else if (onbStatus === 'IN_PROGRESS') {
          onbLabel = 'Onboarding in progress';
          onbColor = '#D97706'; // amber
          onbDotColor = '#F59E0B';
        }

        const avatarHtml = avatarUrl 
            ? `<img src="${avatarUrl}" style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover; flex-shrink: 0; box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.08);" />`
            : `<div style="width: 36px; height: 36px; border-radius: 50%; background: #F1F5F9; display: flex; align-items: center; justify-content: center; font-weight: 600; color: #475569; font-size: 13px; flex-shrink: 0;">${initials}</div>`;

        return `
          <div style="display: flex; align-items: center; gap: 12px; line-height: 1.25; padding: 2px 0; min-width: 0; width: 100%;">
            ${avatarHtml}
            <div style="min-width: 0; flex: 1;">
              <div class="emp-name-text" title="Click to view full profile" style="font-weight: 600; color: #0F172A; font-size: 13.5px; white-space: normal; overflow-wrap: anywhere; transition: color 0.15s ease;">${fullName}</div>
              <div style="font-size: 12px; color: #64748B; margin-top: 1px; white-space: normal; overflow-wrap: anywhere;">${email}</div>
              <div style="font-size: 11.5px; font-weight: 600; color: ${onbColor}; margin-top: 3px; display: inline-flex; align-items: center; gap: 5px;">
                <span style="width: 5px; height: 5px; border-radius: 50%; background: ${onbDotColor}; display: inline-block; flex-shrink: 0;"></span>
                <span>${onbLabel}</span>
              </div>
            </div>
          </div>
        `;
      }
    },
    {
      field: 'employeeCode',
      headerName: 'ID',
      width: 95,
      minWidth: 85,
      flex: 0,
      cellClass: 'cell-mono',
      valueFormatter: (params) => params.value || '—'
    },
    {
      colId: 'deptDesig',
      headerName: 'Department & Designation',
      flex: 1.6,
      minWidth: 320,
      width: 360,
      cellStyle: {
        display: 'flex',
        alignItems: 'center',
        lineHeight: 'normal',
      },
      valueGetter: (params: any) => {
        if (!params.data) return '';
        const dept = params.data.department?.name || 'Unassigned';
        const desig = params.data.designation?.name || 'Unassigned';
        return `${dept} ${desig}`;
      },
      cellRenderer: (params: any) => {
        if (!params.data) return '';
        const dept = String(params.data.department?.name || 'Unassigned')
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const desig = String(params.data.designation?.name || 'Unassigned')
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const titleText = `Department: ${dept}\nDesignation: ${desig}`;

        return `
          <div title="${titleText}" style="display: flex; flex-direction: column; gap: 5px; justify-content: center; height: 100%; min-width: 0; line-height: 1.3;">
            <div style="display: flex; align-items: center; gap: 6px; min-width: 0; line-height: 1.2;">
              <span style="font-size: 10px; font-weight: 700; color: #475569; background: #F1F5F9; border: 1px solid #E2E8F0; padding: 1px 5px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.04em; flex-shrink: 0; line-height: 14px;">Dept</span>
              <span style="font-weight: 600; color: #0F172A; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 16px;">${dept}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px; min-width: 0; line-height: 1.2;">
              <span style="font-size: 10px; font-weight: 700; color: #475569; background: #F1F5F9; border: 1px solid #E2E8F0; padding: 1px 5px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.04em; flex-shrink: 0; line-height: 14px;">Desig</span>
              <span style="color: #475569; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 16px;">${desig}</span>
            </div>
          </div>
        `;
      }
    },
    {
      field: 'department.name',
      hide: true,
      filter: 'agTextColumnFilter',
      suppressColumnsToolPanel: true
    },
    {
      field: 'designation.name',
      hide: true,
      filter: 'agTextColumnFilter',
      suppressColumnsToolPanel: true
    },
    {
      field: 'user.role',
      hide: true,
      filter: 'agTextColumnFilter',
      suppressColumnsToolPanel: true
    },
    {
      field: 'user.status',
      headerName: 'Status',
      width: 105,
      minWidth: 95,
      flex: 0,
      cellRenderer: (params: any) => {
        if (!params.value) return '';
        const statusStr = params.value;
        if (statusStr === 'ACTIVE') return this.statusDot('Active', 'good');
        if (statusStr === 'PENDING_VERIFICATION') return this.statusDot('Pending verification', 'wait');
        if (['SUSPENDED', 'INACTIVE', 'BLOCKED'].includes(statusStr)) return this.statusDot('Deactivated', 'off');
        return this.statusDot(this.roleLabel(statusStr), 'off');
      }
    },
    {
      colId: 'employment',
      headerName: 'Employment',
      width: 140,
      minWidth: 125,
      flex: 0,
      filter: 'agTextColumnFilter',
      valueGetter: (params: any) => this.employmentStatus(params.data),
      cellRenderer: (params: any) => {
        const b = this.employmentBadge(params.data);
        const tones: Record<string, 'good' | 'wait' | 'bad' | 'off'> = {
          'emp-probation': 'wait', 'emp-overdue': 'bad', 'emp-confirmed': 'good',
          'emp-trainee': 'off', 'emp-contract': 'off', 'emp-permanent': 'off',
        };
        return this.statusDot(b.label, tones[b.cls], b.title);
      }
    },
    {
      field: 'onboardingStatus',
      hide: true,
      filter: 'agTextColumnFilter',
      suppressColumnsToolPanel: true
    },
    {
      field: 'offboardingStatus',
      headerName: 'Offboarding',
      width: 120,
      minWidth: 110,
      flex: 0,
      cellRenderer: (params: any) => {
        const status = params.value || 'NONE';
        if (status === 'NONE') return `<span style="font-size:13px; color:#94A3B8;">—</span>`;
        const separated = status === 'SEPARATED';
        const dot = this.statusDot(separated ? 'Offboarded' : 'In progress', separated ? 'off' : 'wait');
        return `<button type="button" style="padding:0; border:0; background:transparent; cursor:pointer;">${dot}</button>`;
      }
    },
    { 
      headerName: 'Actions',
      width: 68,
      minWidth: 68,
      flex: 0,
      sortable: false,
      filter: false,
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: {
        onEdit: (data: any) => this.openDrawer(data),
        onDelete: (data: any) => this.deleteEmployee(data),
        deleteLabel: (data: any) => data?.user?.status === 'SUSPENDED' ? 'Activate' : 'Deactivate',
        onViewProfile: (data: any) => this.openProfile(data),
        onResendVerification: (data: any) => this.resendVerification(data),
        // Super Admin only, and only on the shared HR login (16 Nov 2026).
        extraActions: [{
          label: 'Send welcome email',
          show: () => this.canIntro(),
          onClick: (data: any) => this.sendWelcome(data),
        }, {
          label: 'Send intro email',
          show: () => this.canIntro(),
          onClick: (data: any) => this.openIntro(data),
        }, {
          label: 'Change login email',
          show: (data: any) => this.canChangeEmail(data),
          onClick: (data: any) => this.openEmailChange(data),
        }, {
          // Only for people already on an office login, i.e. after a change (19 Nov 2026).
          label: 'Resend login email notice',
          show: (data: any) => this.canChangeEmail(data)
            && String(data?.user?.email || '').toLowerCase().endsWith('@' + EmployeeListComponentV2.OFFICE_DOMAIN),
          onClick: (data: any) => this.resendLoginNotice(data),
        }, {
          label: 'Hand over HR login',
          show: (data: any) => this.canHandover(data),
          onClick: (data: any) => this.openHandover(data),
        }],
      }
    }
  ];

  // ── Hand over the shared HR login (16 Nov 2026) ──
  handoverFrom: any = null;
  handoverToId: number | null = null;
  handoverBusy = false;

  // ── Personal → office login email (16 Nov 2026) ──
  static readonly OFFICE_DOMAIN = 'ces-pl.com';
  emailFor: any = null;
  newLoginEmail = '';
  emailBusy = false;
  /** Directory filter: only people still logging in with a personal address. */
  personalOnly = false;

  isPersonalEmail(e: any): boolean {
    const email = String(e?.user?.email || '').toLowerCase();
    return !!email && !email.endsWith('@' + EmployeeListComponentV2.OFFICE_DOMAIN);
  }

  personalEmailCount(): number {
    return this.employees().filter((e: any) => e.user?.status === 'ACTIVE' && this.isPersonalEmail(e)).length;
  }

  // ── Welcome + intro emails (#16, 19 Nov 2026) ──
  introFor: any = null;
  introStatus: any = null;
  introSubject = '';
  introMessage = '';
  introDeptIds = new Set<number>();
  introPeople: any[] = [];
  introEveryone = false;
  introSearch = '';
  introStep: 'compose' | 'preview' = 'compose';
  introBusy = false;

  canIntro(): boolean { return ['SUPERADMIN', 'HR'].includes(this.authService.currentUser()?.role || ''); }

  sendWelcome(data: any, force = false) {
    const name = `${data?.firstName ?? ''} ${data?.lastName ?? ''}`.trim();
    if (!force && !confirm(`Send the welcome email to ${name} (${data?.user?.email})?`)) return;
    this.employeeService.sendWelcomeEmail(data.id, force).subscribe({
      next: (r: any) => this.toast.success(r?.emailed ? `Welcome email sent to ${r.to}.` : 'Notification sent; the email could not be delivered.'),
      error: (e: any) => {
        if (e?.status === 409 && confirm(`${e.error?.message}\n\nSend it again?`)) { this.sendWelcome(data, true); return; }
        if (e?.status !== 409) this.toast.error(e?.error?.message || 'Could not send the welcome email');
      },
    });
  }

  openIntro(data: any) {
    this.introFor = data; this.introStatus = null; this.introStep = 'compose';
    this.introDeptIds = new Set(data?.departmentId ? [Number(data.departmentId)] : []);
    this.introPeople = []; this.introEveryone = false; this.introSearch = '';
    this.introSubject = ''; this.introMessage = '';
    this.employeeService.getIntroStatus(data.id).subscribe({
      next: (s: any) => { this.introStatus = s; this.introSubject = s.defaultSubject; this.introMessage = s.defaultMessage; },
      error: (e: any) => { this.toast.error(e?.error?.message || 'Could not open the intro'); this.introFor = null; },
    });
  }

  toggleIntroDept(id: number) { this.introDeptIds.has(id) ? this.introDeptIds.delete(id) : this.introDeptIds.add(id); this.introDeptIds = new Set(this.introDeptIds); }

  introSearchResults(): any[] {
    const q = this.introSearch.trim().toLowerCase();
    if (q.length < 2) return [];
    const picked = new Set(this.introPeople.map(p => p.id));
    return this.employees().filter((e: any) => e.user?.status === 'ACTIVE' && e.id !== this.introFor?.id && !picked.has(e.id)
      && `${e.firstName} ${e.lastName} ${e.employeeCode ?? ''}`.toLowerCase().includes(q)).slice(0, 6);
  }

  addIntroPerson(e: any) { this.introPeople = [...this.introPeople, e]; this.introSearch = ''; }
  removeIntroPerson(id: number) { this.introPeople = this.introPeople.filter(p => p.id !== id); }

  introRecipientCount(): number {
    const active = this.employees().filter((e: any) => e.user?.status === 'ACTIVE');
    if (this.introEveryone) return active.length;
    const ids = new Set<number>([this.introFor?.id, ...this.introPeople.map(p => p.id)]);
    active.forEach((e: any) => { if (e.departmentId && this.introDeptIds.has(Number(e.departmentId))) ids.add(e.id); });
    return ids.size;
  }

  sendIntro(force = false) {
    if (!this.introFor) return;
    this.introBusy = true;
    this.employeeService.sendIntroEmail(this.introFor.id, {
      departmentIds: [...this.introDeptIds], employeeIds: this.introPeople.map(p => p.id), everyone: this.introEveryone,
      subject: this.introSubject, message: this.introMessage, force,
    }).subscribe({
      next: (r: any) => {
        this.introBusy = false; this.introFor = null;
        this.toast.success(`Intro sent to ${r.recipients} ${r.recipients === 1 ? 'person' : 'people'} (email + notification)${r.failed ? ` · ${r.failed} email(s) failed` : ''}.`, { duration: 6000 });
      },
      error: (e: any) => {
        this.introBusy = false;
        if (e?.status === 409 && confirm(`${e.error?.message}\n\nSend it again?`)) { this.sendIntro(true); return; }
        if (e?.status !== 409) this.toast.error(e?.error?.message || 'Could not send the intro');
      },
    });
  }

  resendLoginNotice(data: any) {
    const name = `${data?.firstName ?? ''} ${data?.lastName ?? ''}`.trim();
    if (!confirm(`Resend the "login email has been changed" email and notification to ${name} (${data?.user?.email})?`)) return;
    this.employeeService.resendLoginEmailNotice(data.id).subscribe({
      next: (r: any) => this.toast.success(r?.emailed
        ? `Sent again to ${r.email} and ${r.previousEmail}.`
        : 'Notification sent; the email could not be delivered.', { duration: 6000 }),
      error: (e: any) => this.toast.error(e?.error?.message || 'Could not resend the notice'),
    });
  }

  canChangeEmail(data: any): boolean {
    const role = this.authService.currentUser()?.role;
    if (role !== 'SUPERADMIN' && role !== 'HR') return false;
    if (!data?.user || EmployeeListComponentV2Shared.isShared(data.user.email)) return false;
    return !(role === 'HR' && data.user.role === 'SUPERADMIN');
  }

  openEmailChange(data: any) {
    this.emailFor = data;
    // A sensible first guess; the admin edits it to the real mailbox name.
    const guess = `${data.firstName || ''}.${data.lastName || ''}`.toLowerCase().replace(/[^a-z.]/g, '').replace(/^\.|\.$/g, '');
    this.newLoginEmail = this.isPersonalEmail(data) && guess ? `${guess}@${EmployeeListComponentV2.OFFICE_DOMAIN}` : '';
  }

  emailError(): string {
    const v = this.newLoginEmail.trim().toLowerCase();
    if (!v) return '';
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(v)) return 'Enter a valid email address.';
    if (!v.endsWith('@' + EmployeeListComponentV2.OFFICE_DOMAIN)) return `Use an @${EmployeeListComponentV2.OFFICE_DOMAIN} address.`;
    if (v === String(this.emailFor?.user?.email || '').toLowerCase()) return 'That is already their login email.';
    if (this.employees().some((e: any) => String(e.user?.email || '').toLowerCase() === v)) return 'Another person already uses this email.';
    return '';
  }

  confirmEmailChange() {
    const emp = this.emailFor;
    const email = this.newLoginEmail.trim().toLowerCase();
    if (!emp || !email || this.emailError()) return;
    this.emailBusy = true;
    this.employeeService.changeLoginEmail(emp.id, email).subscribe({
      next: (r: any) => {
        this.emailBusy = false;
        this.emailFor = null;
        this.toast.success(`${emp.firstName} now signs in with ${r.email}.${r.emailed ? '' : ' (Notification email could not be sent.)'}`, { duration: 6000 });
        this.loadEmployees();
      },
      error: (e: any) => { this.emailBusy = false; this.toast.error(e?.error?.message || 'Could not change the email'); },
    });
  }

  togglePersonalOnly() {
    this.personalOnly = !this.personalOnly;
    this.gridApi?.onFilterChanged();
  }

  /** The profile page's "Hand over HR login" button lands here with ?handover=<id>. */
  private openHandoverFromQuery() {
    const forEmail = this.route.snapshot.queryParamMap.get('loginEmail');
    if (forEmail) {
      const m = this.employees().find((e: any) => String(e.id) === String(forEmail));
      if (m && this.canChangeEmail(m)) this.openEmailChange(m);
      this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
      return;
    }
    const id = this.route.snapshot.queryParamMap.get('handover');
    if (!id) return;
    const match = this.employees().find((e: any) => String(e.id) === String(id));
    if (match && this.canHandover(match)) this.openHandover(match);
    this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
  }

  canHandover(data: any): boolean {
    return this.authService.currentUser()?.role === 'SUPERADMIN'
      && EmployeeListComponentV2Shared.isShared(data?.user?.email);
  }

  handoverQuery = '';

  openHandover(data: any) {
    this.handoverFrom = data;
    this.handoverToId = null;
    this.handoverQuery = '';
  }

  /** Active employees for the hand over list, filtered word by word. */
  handoverMatches(): any[] {
    const words = this.handoverQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return this.employees()
      .filter((e: any) => e.id !== this.handoverFrom?.id && e.user?.status === 'ACTIVE')
      .filter((e: any) => {
        const text = [e.firstName, e.lastName, e.employeeCode, e.user?.email, e.designation?.name].filter(Boolean).join(' ').toLowerCase();
        return words.every(w => text.includes(w));
      })
      .slice(0, 50);
  }

  handoverCandidates() {
    return this.employees()
      .filter((e: any) => e.id !== this.handoverFrom?.id && e.user?.status === 'ACTIVE')
      .map((e: any) => ({ id: e.id, name: `${e.firstName} ${e.lastName}${e.employeeCode ? ' · #' + e.employeeCode : ''} — ${e.user?.email}` }));
  }

  handoverTarget(): any {
    return this.employees().find((e: any) => e.id === Number(this.handoverToId));
  }

  confirmHandover() {
    const from = this.handoverFrom;
    const to = this.handoverTarget();
    if (!from || !to) { this.toast.error('Choose who takes over.'); return; }
    this.handoverBusy = true;
    this.employeeService.handoverSharedLogin(from.id, to.id).subscribe({
      next: (r: any) => {
        this.handoverBusy = false;
        this.handoverFrom = null;
        this.toast.success(`${r.shared} now belongs to ${r.to.name}. ${r.reporteesMoved} reportee(s) moved.`, { duration: 6000 });
        this.loadEmployees();
      },
      error: (e: any) => { this.handoverBusy = false; this.toast.error(e?.error?.message || 'Hand over failed'); },
    });
  }

  /** Shared by the grid row menu and the directory search suggestions. */
  resendVerification(emp: any) {
    if (!emp?.user?.email) return;
    this.authService.resendVerification(emp.user.email).subscribe({
      next: () => this.toast.success(`Verification email sent to ${emp.user.email}`),
      error: () => this.toast.error('Failed to send verification email')
    });
  }

  viewProfile(emp: any) {
    this.openProfile(emp);
  }

  /** Opens the edit drawer from a directory search result. */
  editFromSearch(emp: any) {
    this.openDrawer(emp);
  }

  ngOnInit() {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      this.viewMode.set('cards');
    } else {
      this.viewMode.set('table');
    }
    this.loadEmployees();
    this.loadMasterData();
  }

  getFilteredEmployees(): Employee[] {
    let list = this.employees();
    if (this.filterDepartmentId) {
      list = list.filter(e => (e.departmentId ?? e.department?.id) === Number(this.filterDepartmentId));
    }
    if (this.filterDesignationId) {
      list = list.filter(e => (e.designationId ?? e.designation?.id) === Number(this.filterDesignationId));
    }
    if (this.filterRole) {
      list = list.filter(e => (e.user?.role || e.role) === this.filterRole);
    }
    if (this.filterOnboardingStatus) {
      list = list.filter(e => (e.onboardingStatus || (e as any).onboardingStatus) === this.filterOnboardingStatus);
    }
    if (this.filterOffboardingStatus) {
      list = list.filter(e => ((e as any).offboardingStatus || 'NONE') === this.filterOffboardingStatus);
    }
    if (this.filterEmploymentStatus) {
      list = list.filter(e => this.employmentStatus(e) === this.filterEmploymentStatus);
    }
    if (this.filterAccountStatus) {
      list = list.filter(e => this.accountStatus(e) === this.filterAccountStatus);
    }
    if (this.searchText && this.searchText.trim()) {
      // Every word must appear somewhere, so a full name matches (16 Nov 2026).
      const words = this.searchText.toLowerCase().trim().split(/\s+/);
      list = list.filter(e => {
        const text = [e.firstName, e.lastName, e.user?.email, e.employeeCode, e.department?.name, e.designation?.name]
          .filter(Boolean).join(' ').toLowerCase();
        return words.every(w => text.includes(w));
      });
    }
    return list;
  }

  getEmployeeInitials(emp: Employee): string {
    const f = emp.firstName ? emp.firstName.charAt(0) : '';
    const l = emp.lastName ? emp.lastName.charAt(0) : '';
    return `${f}${l}`.toUpperCase() || 'EM';
  }

  toTitleCase(str: string): string {
    if (!str) return '';
    return str.toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase());
  }

  /**
   * Spotlight search sends `?edit=<id>` when someone picks Edit on a result.
   * Runs after the list loads, since the drawer needs the full employee record.
   */
  private openPendingEditFromQuery() {
    const id = this.route.snapshot.queryParamMap.get('edit');
    if (!id) return;

    const match = this.employees().find((e: any) => String(e.id) === String(id));
    if (match) this.openDrawer(match);

    // Clear it so a refresh does not reopen the drawer.
    this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
  }

  loadMasterData() {
    this.masterDataService.getDepartments(true).subscribe({
      next: (data) => this.departments.set(data)
    });
    this.masterDataService.getDesignations(true).subscribe({
      next: (data) => this.designations.set(data)
    });
  }

  onGridReady(params: any) {
    this.gridApi = params.api;
    // Keep the directory's key identifiers in the requested order, ahead of
    // the wider descriptive fields.  The row-selection checkbox remains the
    // grid's leading utility column.
    this.gridApi.applyColumnState({
      state: [
        { colId: 'employeeCode' },
        { colId: 'firstName' },
        { colId: 'deptDesig' },
        { colId: 'user.status' },
        { colId: 'employment' },
        { colId: 'offboardingStatus' },
        { colId: 'Actions' },
      ],
      applyOrder: true,
    });
    this.gridApi.sizeColumnsToFit();
  }

  onSearch() {
    if (this.gridApi) {
      this.gridApi.setGridOption('quickFilterText', this.searchText);
    }
  }

  applyFilters() {
    if (!this.gridApi) return;
    
    // We can use AG Grid's external filter OR just filter the model before passing to rowData.
    // AG Grid external filter is better, or we can just apply column filters via API.
    const filterModel: any = {};
    
    if (this.filterDepartmentId) {
      const dept = this.departments().find(d => d.id === Number(this.filterDepartmentId));
      if (dept) {
        filterModel['department.name'] = { filterType: 'text', type: 'equals', filter: dept.name };
      }
    }
    
    if (this.filterDesignationId) {
      const desig = this.designations().find(d => d.id === Number(this.filterDesignationId));
      if (desig) {
        filterModel['designation.name'] = { filterType: 'text', type: 'equals', filter: desig.name };
      }
    }

    if (this.filterRole) {
      filterModel['user.role'] = { filterType: 'text', type: 'equals', filter: this.filterRole };
    }

    if (this.filterOnboardingStatus) {
      filterModel['onboardingStatus'] = { filterType: 'text', type: 'equals', filter: this.filterOnboardingStatus };
    }

    if (this.filterOffboardingStatus) {
      filterModel['offboardingStatus'] = { filterType: 'text', type: 'equals', filter: this.filterOffboardingStatus };
    }

    if (this.filterEmploymentStatus) {
      filterModel['employment'] = { filterType: 'text', type: 'equals', filter: this.filterEmploymentStatus };
    }

    this.gridApi.setFilterModel(Object.keys(filterModel).length > 0 ? filterModel : null);
    // The account-status and joined-date filters are external: the grid only
    // re-checks them when told to (16 Nov 2026).
    this.gridApi.onFilterChanged();
  }

  getActiveFilterCount(): number {
    let count = 0;
    if (this.searchText && this.searchText.trim()) count++;
    if (this.filterDepartmentId) count++;
    if (this.filterDesignationId) count++;
    if (this.filterRole) count++;
    if (this.filterOnboardingStatus) count++;
    if (this.filterOffboardingStatus) count++;
    if (this.filterEmploymentStatus) count++;
    if (this.filterAccountStatus !== 'ACTIVE') count++;
    if (this.dateRange) count++;
    if (this.personalOnly) count++;
    return count;
  }

  hasActiveFilters(): boolean {
    return this.getActiveFilterCount() > 0;
  }

  clearFilters() {
    this.personalOnly = false;
    this.searchText = '';
    this.filterDepartmentId = null;
    this.filterDesignationId = null;
    this.filterRole = null;
    this.filterOnboardingStatus = null;
    this.filterOffboardingStatus = null;
    this.filterEmploymentStatus = null;
    this.filterAccountStatus = 'ACTIVE';
    this.datePreset = 'ALL';
    this.dateRange = null;
    this.onSearch();
    if (this.gridApi) {
      this.gridApi.setFilterModel(null);
      // The date filter is an external filter: setFilterModel(null) does not
      // re-run it when the column filters were already empty.
      this.gridApi.onFilterChanged();
    }
  }

  loadEmployees() {
    this.isLoading.set(true);
    this.employeeService.getEmployees().subscribe({
      next: (data) => {
        // Former employees always sit below the live directory.  Deactivated
        // employees remain below active staff but above employees who have
        // fully completed offboarding.
        const sorted = [...data].sort((a: any, b: any) => {
          const rank = (employee: any) => {
            if (employee.offboardingStatus === 'SEPARATED') return 2;
            if (employee.user?.status === 'SUSPENDED') return 1;
            return 0;
          };
          // 17 Nov 2026: newest joiners first (joining date, not the day the
          // record was created — old hires entered late must not jump the queue).
          const joined = (e: any) => (e.joiningDate ? new Date(e.joiningDate).getTime() : 0);
          return rank(a) - rank(b) || joined(b) - joined(a);
        });
        this.employees.set(sorted);
        this.isLoading.set(false);
        this.openPendingEditFromQuery();
        this.openHandoverFromQuery();
      },
      error: (err) => {
        this.toast.error('Failed to load employees');
        console.error(err);
        this.isLoading.set(false);
      }
    });
  }

  openDrawer(employee?: Employee) {
    this.selectedEmployee = employee || null;
    this.isDrawerOpen = true;
  }

  closeDrawer() {
    this.isDrawerOpen = false;
  }

  onSaveSuccess() {
    this.loadEmployees();
  }

  deleteEmployee(employee: any) {
    const isSuspended = employee.user?.status === 'SUSPENDED';
    const action = isSuspended ? 'activate' : 'deactivate';
    
    if (!confirm(`Are you sure you want to ${action} ${employee.firstName} ${employee.lastName}?`)) return;

    this.employeeService.deleteEmployee(employee.id).subscribe({
      next: (res: any) => {
        this.toast.success(`Employee ${res.newStatus === 'SUSPENDED' ? 'deactivated' : 'activated'} successfully`);
        this.loadEmployees();
      },
      error: () => this.toast.error(`Failed to ${action} employee`)
    });
  }

  goToProbation(event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.router.navigate(['/performance'], { queryParams: { tab: 'probation' } });
  }

  goToOnboarding(event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.router.navigate(['/employees/onboarding']);
  }
}

/** Shared HR login check, kept outside the class so the grid callbacks can use it. */
export const EmployeeListComponentV2Shared = {
  isShared: (email?: string | null) => ['hr@ces-pl.com'].includes(String(email || '').toLowerCase()),
};
