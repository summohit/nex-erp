import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { EmployeeService, Employee } from '../../services/employee.service';
import { MasterDataService, Department, Designation } from '../../services/master-data.service';
import { HotToastService } from '@ngneat/hot-toast';
import { LucidePlus, LucideSearch, LucideX } from '@lucide/angular';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { ActionCellRendererComponent } from '../../shared/components/action-cell-renderer.component';
import { EmployeeDrawerComponent } from '../employee-drawer/employee-drawer';

ModuleRegistry.registerModules([AllCommunityModule]);

@Component({
  selector: 'app-employee-list',
  standalone: true,
  imports: [CommonModule, FormsModule, LucidePlus, LucideSearch, LucideX, AgGridAngular, EmployeeDrawerComponent],
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
  selectedEmployee: Employee | null = null;
  gridApi: any;

  isAdmin(): boolean {
    const role = this.authService.currentUser()?.role;
    return role === 'ADMIN' || role === 'HR' || role === 'SUPERADMIN';
  }

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
      minWidth: 250,
      cellRenderer: (params: any) => {
        if (!params.data) return '';
        return `
          <div style="display: flex; align-items: center; gap: 10px; line-height: 1.2;">
            <div style="width: 32px; height: 32px; border-radius: 50%; background: #e5e7eb; display: flex; align-items: center; justify-content: center; font-weight: 600; color: #4b5563; font-size: 13px;">
              ${params.data.firstName.charAt(0)}${params.data.lastName.charAt(0)}
            </div>
            <div>
              <div style="font-weight: 500; color: #111827;">${params.data.firstName} ${params.data.lastName}</div>
              <div style="font-size: 12px; color: #6b7280;">${params.data.user?.email || ''}</div>
            </div>
          </div>
        `;
      }
    },
    { 
      field: 'department.name', 
      headerName: 'Department',
      valueFormatter: (params) => params.value || 'Unassigned'
    },
    { 
      field: 'designation.name', 
      headerName: 'Designation',
      valueFormatter: (params) => params.value || 'Unassigned'
    },
    {
      field: 'user.role',
      headerName: 'Role',
      width: 130,
      cellRenderer: (params: any) => {
        if (!params.value) return '';
        const roleStr = params.value;
        const colorMap: any = {
          'ADMIN': '#8b5cf6',
          'HR': '#ec4899',
          'FINANCE': '#eab308',
          'EMPLOYEE': '#3b82f6'
        };
        const color = colorMap[roleStr] || '#6b7280';
        return `<span style="background: ${color}20; color: ${color}; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 500;">${roleStr}</span>`;
      }
    },
    {
      field: 'onboardingStatus',
      headerName: 'Onboarding',
      width: 140,
      cellRenderer: (params: any) => {
        if (!params.value) return '';
        const statusStr = params.value;
        let color = '#6b7280';
        let bg = '#f3f4f6';
        let label = statusStr;
        
        if (statusStr === 'PENDING') {
          color = '#6b7280'; bg = '#f3f4f6'; label = 'Pending';
        } else if (statusStr === 'IN_PROGRESS') {
          color = '#2563eb'; bg = '#eff6ff'; label = 'In Progress';
        } else if (statusStr === 'COMPLETED') {
          color = '#059669'; bg = '#ecfdf5'; label = 'Completed';
        }

        return `<span style="background: ${bg}; color: ${color}; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 500;">${label}</span>`;
      }
    },
    { 
      headerName: 'Actions',
      width: 120,
      flex: 0,
      sortable: false,
      filter: false,
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: {
        onEdit: (data: any) => this.openDrawer(data),
        onDelete: (data: any) => this.deleteEmployee(data.id),
        onViewProfile: (data: any) => this.router.navigate(['/employees', data.id, 'profile'])
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
