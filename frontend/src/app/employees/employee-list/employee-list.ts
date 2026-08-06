import { Component, inject, OnInit, signal, HostListener, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { EmployeeService, Employee } from '../../services/employee.service';
import { MasterDataService, Department, Designation } from '../../services/master-data.service';
import { HotToastService } from '@ngneat/hot-toast';
import { LucidePlus, LucideSearch, LucideX, LucideChevronRight, LucideUpload } from '@lucide/angular';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { ActionCellRendererComponent } from '../../shared/components/action-cell-renderer.component';
import { EmployeeDrawerComponent } from '../employee-drawer/employee-drawer';
import { BulkUploadModalComponent } from '../components/bulk-upload-modal/bulk-upload-modal';

ModuleRegistry.registerModules([AllCommunityModule]);

@Component({
  selector: 'app-employee-list',
  standalone: true,
  imports: [CommonModule, FormsModule, LucidePlus, LucideSearch, LucideX, LucideChevronRight, LucideUpload, AgGridAngular, EmployeeDrawerComponent, BulkUploadModalComponent],
  templateUrl: './employee-list.html',
  styleUrls: ['./employee-list.css']
})
export class EmployeeListComponent implements OnInit {
  private employeeService = inject(EmployeeService);
  private masterDataService = inject(MasterDataService);
  private toast = inject(HotToastService);
  private router = inject(Router);
  public authService = inject(AuthService);

  employees = signal<Employee[]>([]);
  departments = signal<Department[]>([]);
  designations = signal<Designation[]>([]);
  
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

  // --- Modal Search State ---
  isSearchModalOpen = signal<boolean>(false);
  modalSearchQuery = signal<string>('');
  
  filteredModalEmployees = computed(() => {
    const q = this.modalSearchQuery().toLowerCase().trim();
    if (!q) return []; // Only show results when typing, or return top employees
    return this.employees().filter(e => 
      (e.firstName && e.firstName.toLowerCase().includes(q)) || 
      (e.lastName && e.lastName.toLowerCase().includes(q)) ||
      (e.department?.name && e.department.name.toLowerCase().includes(q)) ||
      (e.designation?.name && e.designation.name.toLowerCase().includes(q))
    ).slice(0, 10); // Limit to top 10 results
  });

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      this.openSearchModal();
    }
    if (event.key === 'Escape' && this.isSearchModalOpen()) {
      this.closeSearchModal();
    }
  }

  openSearchModal() {
    this.modalSearchQuery.set('');
    this.isSearchModalOpen.set(true);
  }

  closeSearchModal() {
    this.isSearchModalOpen.set(false);
  }

  selectModalEmployee(emp: Employee) {
    this.closeSearchModal();
    // For now, let's just open the drawer to view their profile, 
    // or navigate to their profile page.
    // We'll open the drawer.
    this.openDrawer(emp);
  }
  // -------------------------

  // Filters state
  searchText = '';
  filterDepartmentId: number | null = null;
  filterDesignationId: number | null = null;
  filterRole: string | null = null;
  filterOnboardingStatus: string | null = null;

  defaultColDef: ColDef = {
    flex: 1,
    minWidth: 150,
    filter: true,
    sortable: true
  };

  gridOptions = {
    rowSelection: 'multiple' as const,
    suppressRowClickSelection: true
  };

  colDefs: ColDef[] = [
    { 
      headerName: 'Employee Name',
      field: 'firstName',
      headerCheckboxSelection: true, 
      checkboxSelection: true,
      minWidth: 260,
      flex: 1.5,
      cellRenderer: (params: any) => {
        if (!params.data) return '';
        const fn = params.data.firstName || '';
        const ln = params.data.lastName || '';
        const initials = `${fn.charAt(0)}${ln.charAt(0)}`.toLowerCase();
        const fullName = `${fn} ${ln}`.trim().toLowerCase();
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
      field: 'department.name', 
      headerName: 'Department',
      flex: 1.2,
      valueFormatter: (params) => params.value || 'Unassigned'
    },
    { 
      field: 'designation.name', 
      headerName: 'Designation',
      flex: 1.2,
      valueFormatter: (params) => params.value || 'Unassigned'
    },
    {
      field: 'user.role',
      headerName: 'Role',
      width: 140,
      cellRenderer: (params: any) => {
        if (!params.value) return '';
        const roleStr = params.value;
        let bg = '#F1F5F9'; let color = '#64748B';
        if (roleStr === 'EMPLOYEE') { bg = '#EFF6FF'; color = '#3B82F6'; }
        else if (roleStr === 'HR') { bg = '#FCE7F3'; color = '#EC4899'; }
        else if (roleStr === 'SUPERADMIN' || roleStr === 'ADMIN') { bg = '#F1F5F9'; color = '#64748B'; }
        else if (roleStr === 'FINANCE') { bg = '#FEF9C3'; color = '#CA8A04'; }

        return `<span style="background: ${bg}; color: ${color}; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.2px;">${roleStr}</span>`;
      }
    },
    {
      field: 'onboardingStatus',
      headerName: 'Onboarding',
      width: 140,
      cellRenderer: (params: any) => {
        if (!params.value) return '';
        const statusStr = params.value;
        let color = '#64748B'; let bg = '#F1F5F9'; let label = statusStr;
        if (statusStr === 'PENDING') {
          color = '#64748B'; bg = '#F1F5F9'; label = 'Pending';
        } else if (statusStr === 'IN_PROGRESS') {
          color = '#2563EB'; bg = '#EFF6FF'; label = 'In Progress';
        } else if (statusStr === 'COMPLETED') {
          color = '#16A34A'; bg = '#DCFCE7'; label = 'Completed';
        }

        return `<span style="background: ${bg}; color: ${color}; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 700;">${label}</span>`;
      }
    },
    { 
      headerName: 'Actions',
      width: 90,
      flex: 0,
      sortable: false,
      filter: false,
      pinned: 'right',
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: {
        onEdit: (data: any) => this.openDrawer(data),
        onDelete: (data: any) => this.deleteEmployee(data.id),
        onViewProfile: (data: any) => this.router.navigate(['/employees', data.id, 'profile']),
        onResendVerification: (data: any) => {
          if (!data.user?.email) return;
          this.authService.resendVerification(data.user.email).subscribe({
            next: () => this.toast.success(`Verification email sent to ${data.user.email}`),
            error: () => this.toast.error('Failed to send verification email')
          });
        }
      }
    }
  ];

  ngOnInit() {
    this.loadEmployees();
    this.loadMasterData();
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

    this.gridApi.setFilterModel(Object.keys(filterModel).length > 0 ? filterModel : null);
  }

  clearFilters() {
    this.searchText = '';
    this.filterDepartmentId = null;
    this.filterDesignationId = null;
    this.filterRole = null;
    this.filterOnboardingStatus = null;
    this.onSearch();
    if (this.gridApi) {
      this.gridApi.setFilterModel(null);
    }
  }

  loadEmployees() {
    this.employeeService.getEmployees().subscribe({
      next: (data) => this.employees.set(data),
      error: (err) => {
        this.toast.error('Failed to load employees');
        console.error(err);
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

  deleteEmployee(id: number) {
    if (!confirm('Are you sure you want to delete this employee? This will also remove their user account and login access.')) return;

    this.employeeService.deleteEmployee(id).subscribe({
      next: () => {
        this.toast.success('Employee deleted');
        this.loadEmployees();
      },
      error: () => this.toast.error('Failed to delete employee')
    });
  }
}
