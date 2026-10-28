import { Component, inject, OnInit, signal, HostListener, computed, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProfileModalService } from '../../shared/profile-modal/profile-modal.service';
import { Router, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { EmployeeService, Employee } from '../../services/employee.service';
import { MasterDataService, Department, Designation } from '../../services/master-data.service';
import { HotToastService } from '@ngneat/hot-toast';
import { LucidePlus, LucideSearch, LucideX, LucideChevronRight, LucideUpload, LucideLayoutGrid, LucideList, LucideBuilding, LucideMail, LucidePhone } from '@lucide/angular';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { ActionCellRendererComponent } from '../../shared/components/action-cell-renderer.component';
import { EmployeeDrawerComponent } from '../employee-drawer/employee-drawer';
import { BulkUploadModalComponent } from '../components/bulk-upload-modal/bulk-upload-modal';
import { SearchableSelectComponent } from '../../shared/components/searchable-select/searchable-select.component';

ModuleRegistry.registerModules([AllCommunityModule]);

@Component({
  selector: 'app-employee-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucidePlus,
    LucideSearch,
    LucideX,
    LucideChevronRight,
    LucideUpload,
    LucideLayoutGrid,
    LucideList,
    LucideBuilding,
    LucideMail,
    LucidePhone,
    AgGridAngular,
    EmployeeDrawerComponent,
    BulkUploadModalComponent,
    SearchableSelectComponent
  ],
  templateUrl: './employee-list.html',
  styleUrls: ['./employee-list.css']
})
export class EmployeeListComponent implements OnInit {

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
  offboardingStatusOptions = [
    { id: 'NONE', name: 'Not started' },
    { id: 'IN_PROGRESS', name: 'In progress' },
    { id: 'SEPARATED', name: 'Offboarded' },
  ];

  viewMode = signal<'table' | 'cards'>('cards');
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
      return searchable.includes(query);
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

  paginationPageSize = 100;
  paginationPageSizeSelector = [20, 50, 100, 200];

  gridOptions = {
    headerHeight: 48,
    rowHeight: 70,
    // The directory uses a compact desktop layout; prevent AG Grid from
    // rendering a second horizontal scrollbar beneath the table.
    suppressHorizontalScroll: true,
    // Keep former employees visually separate from the live directory.
    rowClassRules: {
      'offboarded-employee-row': (params: any) => params.data?.offboardingStatus === 'SEPARATED',
      'deactivated-employee-row': (params: any) =>
        ['SUSPENDED', 'INACTIVE', 'BLOCKED'].includes(String(params.data?.user?.status || '').toUpperCase()),
    },
    selectionColumnDef: {
      width: 52,
      minWidth: 52,
      maxWidth: 52,
      sortable: false,
      resizable: false,
      suppressHeaderMenuButton: true,
    },
    rowSelection: {
      mode: 'multiRow' as const,
      checkboxes: true,
      headerCheckbox: true,
      enableClickSelection: false
    },
    // Clicking the person opens their full profile in a popup (17 Oct 2026).
    onCellClicked: (e: any) => {
      if (e.colDef?.field === 'firstName' && e.data?.id) this.openProfile(e.data);
      if (e.colDef?.field === 'offboardingStatus' && e.data?.id) {
        this.router.navigate(['/offboarding'], { queryParams: { employeeId: e.data.id } });
      }
    },
  };

  openProfile(emp: any) {
    this.profileModal.open(emp?.id);
  }

  colDefs: ColDef[] = [
    { 
      headerName: 'Employee Name',
      field: 'firstName',
      width: 280,
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

        const avatarHtml = avatarUrl 
            ? `<img src="${avatarUrl}" style="width: 34px; height: 34px; border-radius: 50%; object-fit: cover; flex-shrink: 0; border: 1px solid #E2E8F0;" />`
            : `<div style="width: 34px; height: 34px; border-radius: 50%; background: #E2E8F0; display: flex; align-items: center; justify-content: center; font-weight: 700; color: #475569; font-size: 12px; flex-shrink: 0; text-transform: lowercase;">${initials}</div>`;

        return `
          <div style="display: flex; align-items: center; gap: 12px; line-height: 1.25; padding: 4px 0;">
            ${avatarHtml}
            <div>
              <div style="font-weight: 700; color: #0F172A; font-size: 13px;">${fullName}</div>
              <div style="font-size: 11.5px; color: #64748B; margin-top: 1px;">${email}</div>
            </div>
          </div>
        `;
      }
    },
    {
      field: 'employeeCode',
      headerName: 'ID',
      width: 115,
      valueFormatter: (params) => params.value || '—'
    },
    {
      field: 'department.name',
      headerName: 'Department',
      width: 205,
      wrapText: true,
      valueFormatter: (params) => params.value || 'Unassigned'
    },
    { 
      field: 'designation.name', 
      headerName: 'Designation',
      width: 190,
      cellRenderer: (params: any) => {
        const value = String(params.value || 'Unassigned')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
        return `<div style="display:flex; align-items:center; height:100%; white-space:normal; line-height:18px; overflow:hidden;">${value}</div>`;
      }
    },
    {
      field: 'user.role',
      headerName: 'Role',
      width: 125,
      cellRenderer: (params: any) => {
        let badges = '';
        if (params.value) {
          const roleStr = params.value;
          let bg = '#F1F5F9'; let color = '#64748B';
          if (roleStr === 'EMPLOYEE') { bg = '#EFF6FF'; color = '#3B82F6'; }
          else if (roleStr === 'HR') { bg = '#FCE7F3'; color = '#6b3fd6'; }
          else if (roleStr === 'SUPERADMIN' || roleStr === 'ADMIN') { bg = '#F1F5F9'; color = '#64748B'; }
          else if (roleStr === 'FINANCE') { bg = '#f3efff'; color = '#4f2aa7'; }
          badges += `<span style="background: ${bg}; color: ${color}; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.2px;">${roleStr}</span>`;
        }
        if (params.data?.isProjectManager) {
          badges += ` <span style="background: #EDE9FE; color: #6D28D9; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.2px; border: 1px solid #DDD6FE;">PM</span>`;
        }
        return badges;
      }
    },
    {
      field: 'user.status',
      headerName: 'Status',
      width: 115,
      cellRenderer: (params: any) => {
        if (!params.value) return '';
        const statusStr = params.value;
        let color = '#64748B'; let bg = '#F1F5F9'; let label = statusStr;
        if (statusStr === 'ACTIVE') {
          color = '#16A34A'; bg = '#DCFCE7'; label = 'Active';
        } else if (statusStr === 'PENDING_VERIFICATION') {
          color = '#4f2aa7'; bg = '#f3efff'; label = 'Pending Verification';
        } else if (statusStr === 'SUSPENDED' || statusStr === 'INACTIVE' || statusStr === 'BLOCKED') {
          color = '#1373e5'; bg = '#dbeafe'; label = 'Deactivated';
        }

        return `<span style="background: ${bg}; color: ${color}; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 700;">${label}</span>`;
      }
    },
    {
      field: 'onboardingStatus',
      headerName: 'Onboarding',
      width: 150,
      cellRenderer: (params: any) => {
        const statusStr = params.value || 'PENDING';
        let color = '#64748B'; let bg = '#F1F5F9'; let label = statusStr;
        if (statusStr === 'PENDING') {
          color = '#64748B'; bg = '#F1F5F9'; label = 'Pending';
        } else if (statusStr === 'IN_PROGRESS') {
          color = '#2563EB'; bg = '#EFF6FF'; label = 'In Progress';
        } else if (statusStr === 'COMPLETED') {
          color = '#16A34A'; bg = '#DCFCE7'; label = 'Completed';
        }

        return `<span style="background:${bg}; color:${color}; padding:4px 10px; border-radius:6px; font-size:11px; font-weight:700;">${label}</span>`;
      }
    },
    {
      field: 'offboardingStatus',
      headerName: 'Offboarding',
      width: 150,
      cellRenderer: (params: any) => {
        const status = params.value || 'NONE';
        if (status === 'NONE') return `<span style="font-size:12px; color:#94A3B8;">N/A</span>`;
        const separated = status === 'SEPARATED';
        const label = separated ? 'Offboarded' : 'In progress';
        const background = separated ? '#F1F5F9' : '#FFF7ED';
        const color = separated ? '#475569' : '#C2410C';
        return `<button type="button" style="padding:0; border:0; background:transparent; cursor:pointer;"><span style="background:${background}; color:${color}; padding:4px 10px; border-radius:6px; font-size:11px; font-weight:700;">${label}</span></button>`;
      }
    },
    { 
      headerName: 'Actions',
      width: 72,
      flex: 0,
      sortable: false,
      filter: false,
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: {
        onEdit: (data: any) => this.openDrawer(data),
        onDelete: (data: any) => this.deleteEmployee(data),
        deleteLabel: (data: any) => data?.user?.status === 'SUSPENDED' ? 'Activate' : 'Deactivate',
        onViewProfile: (data: any) => this.openProfile(data),
        onResendVerification: (data: any) => this.resendVerification(data)
      }
    }
  ];

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
    if (this.searchText && this.searchText.trim()) {
      const q = this.searchText.toLowerCase().trim();
      list = list.filter(e =>
        (e.firstName && e.firstName.toLowerCase().includes(q)) ||
        (e.lastName && e.lastName.toLowerCase().includes(q)) ||
        (e.user?.email && e.user.email.toLowerCase().includes(q)) ||
        (e.employeeCode && e.employeeCode.toLowerCase().includes(q)) ||
        (e.department?.name && e.department.name.toLowerCase().includes(q)) ||
        (e.designation?.name && e.designation.name.toLowerCase().includes(q))
      );
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
        { colId: 'department.name' },
        { colId: 'designation.name' },
        { colId: 'user.role' },
        { colId: 'user.status' },
        { colId: 'onboardingStatus' },
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

    this.gridApi.setFilterModel(Object.keys(filterModel).length > 0 ? filterModel : null);
  }

  clearFilters() {
    this.searchText = '';
    this.filterDepartmentId = null;
    this.filterDesignationId = null;
    this.filterRole = null;
    this.filterOnboardingStatus = null;
    this.filterOffboardingStatus = null;
    this.onSearch();
    if (this.gridApi) {
      this.gridApi.setFilterModel(null);
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
          return rank(a) - rank(b);
        });
        this.employees.set(sorted);
        this.isLoading.set(false);
        this.openPendingEditFromQuery();
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
}
