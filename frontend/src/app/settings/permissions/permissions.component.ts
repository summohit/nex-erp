import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PermissionsService, RolePermission } from '../../services/permissions.service';
import { MasterDataService, Department } from '../../services/master-data.service';
import { HotToastService } from '@ngneat/hot-toast';
import { LucideShield, LucideChevronDown, LucideChevronRight } from '@lucide/angular';

interface PermissionNode {
  id: string;
  title: string;
  enabled: boolean;
}

interface PermissionCategory extends PermissionNode {
  isExpanded: boolean;
  subItems: PermissionNode[];
}

@Component({
  selector: 'app-permissions',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideShield, LucideChevronDown, LucideChevronRight],
  templateUrl: './permissions.component.html',
  styleUrls: ['./permissions.component.css']
})
export class PermissionsComponent implements OnInit {
  private permissionsService = inject(PermissionsService);
  private masterDataService = inject(MasterDataService);
  private toast = inject(HotToastService);

  activeTab: 'departments' | 'matrix' = 'departments';

  // Tab 1: Departments -> Roles
  departments: Department[] = [];
  isLoadingDepartments = false;
  savingDeptId: number | null = null;
  
  roles = ['SUPERADMIN', 'ADMIN', 'HR', 'FINANCE', 'SALES', 'EMPLOYEE', 'OFFICE_STAFF'];

  // Tab 2: Matrix
  selectedRole = 'HR';
  isLoadingMatrix = false;

  sidebarModules: PermissionCategory[] = [
    {
      id: 'employees', title: 'Employees', isExpanded: true, enabled: false,
      subItems: [
        { id: 'employees/directory', title: 'Employee Directory', enabled: false },
        { id: 'employees/org-chart', title: 'Organization Chart', enabled: false },
        { id: 'employees/onboarding', title: 'Onboarding', enabled: false },
        { id: 'employees/documents', title: 'Documents', enabled: false }
      ]
    },
    {
      id: 'recruitment', title: 'Recruitment', isExpanded: true, enabled: false,
      subItems: [
        { id: 'recruitment/jobs', title: 'Job Postings', enabled: false },
        { id: 'recruitment/candidates', title: 'Candidates (ATS)', enabled: false },
        { id: 'recruitment/interviews', title: 'Interviews', enabled: false },
        { id: 'recruitment/careers-page', title: 'Public Careers Page', enabled: false }
      ]
    },
    {
      id: 'projects', title: 'Projects', isExpanded: true, enabled: false,
      subItems: []
    },
    {
      id: 'performance', title: 'Performance', isExpanded: true, enabled: false,
      subItems: []
    },
    {
      id: 'offboarding', title: 'Offboarding', isExpanded: true, enabled: false,
      subItems: []
    },
    {
      id: 'attendance', title: 'Attendance & Leave', isExpanded: true, enabled: false,
      subItems: [
        { id: 'attendance/timesheets', title: 'Timesheets', enabled: false },
        { id: 'attendance/leaves', title: 'Time Off Requests', enabled: false },
        { id: 'attendance/shifts', title: 'Shift Roster', enabled: false },
        { id: 'attendance/holidays', title: 'Holidays', enabled: false }
      ]
    },
    {
      id: 'appreciation', title: 'Appreciation & Awards', isExpanded: true, enabled: false,
      subItems: [
        { id: 'appreciation/list', title: 'Appreciations List', enabled: false },
        { id: 'appreciation/types', title: 'Award Categories', enabled: false }
      ]
    },
    {
      id: 'payroll', title: 'Payroll & Expenses', isExpanded: true, enabled: false,
      subItems: [
        { id: 'payroll/processing', title: 'Salary Processing', enabled: false },
        { id: 'payroll/payslips', title: 'Payslips', enabled: false },
        { id: 'payroll/expenses', title: 'Expense Claims', enabled: false },
        { id: 'payroll/taxes', title: 'Tax Declarations', enabled: false }
      ]
    },
    {
      id: 'assets', title: 'Assets & IT', isExpanded: true, enabled: false,
      subItems: [
        { id: 'assets/inventory', title: 'Asset Inventory', enabled: false },
        { id: 'assets/assignments', title: 'Assignments', enabled: false },
        { id: 'assets/requests', title: 'Hardware Requests', enabled: false }
      ]
    },
    {
      id: 'clients', title: 'Clients', isExpanded: true, enabled: false,
      subItems: []
    },
    {
      id: 'crm/leads', title: 'CRM', isExpanded: true, enabled: false,
      subItems: []
    },
    {
      id: 'sales', title: 'Sales', isExpanded: true, enabled: false,
      subItems: [
        { id: 'sales/quotations', title: 'Quotations', enabled: false },
        { id: 'sales/orders', title: 'Sales Orders', enabled: false },
        { id: 'sales/pos', title: 'Point of Sale', enabled: false }
      ]
    },
    {
      id: 'settings', title: 'Settings', isExpanded: true, enabled: false,
      subItems: [
        { id: 'settings/company', title: 'Company Profile', enabled: false },
        { id: 'settings/master-data', title: 'Master Data', enabled: false },
        { id: 'settings/permissions', title: 'Roles & Permissions', enabled: false },
        { id: 'settings/integrations', title: 'Integrations', enabled: false }
      ]
    }
  ];

  ngOnInit() {
    this.loadDepartments();
    this.loadPermissions();
  }

  setTab(tab: 'departments' | 'matrix') {
    this.activeTab = tab;
  }

  // --- Department Roles Tab ---
  loadDepartments() {
    this.isLoadingDepartments = true;
    this.masterDataService.getDepartments().subscribe({
      next: (data) => {
        this.departments = data;
        this.isLoadingDepartments = false;
      },
      error: () => {
        this.toast.error('Failed to load departments');
        this.isLoadingDepartments = false;
      }
    });
  }

  updateDepartmentRole(dept: Department, newRole: string) {
    if (dept.defaultRole === newRole) return;
    this.savingDeptId = dept.id;
    this.masterDataService.updateDepartment(dept.id, { defaultRole: newRole }).subscribe({
      next: () => {
        dept.defaultRole = newRole;
        this.toast.success(`Role updated for ${dept.name}`);
        this.savingDeptId = null;
        this.checkDepartmentRoleMismatches(dept, newRole);
      },
      error: () => {
        this.toast.error('Failed to update role');
        this.savingDeptId = null;
      }
    });
  }

  // --- Existing-Employee Role Sync Modal ---
  isSyncModalOpen = false;
  syncModalDept: Department | null = null;
  syncModalNewRole = '';
  syncModalCandidates: { employeeId: number, firstName: string, lastName: string, email: string, currentRole: string, selected: boolean }[] = [];
  isSyncing = false;

  private checkDepartmentRoleMismatches(dept: Department, newRole: string) {
    this.masterDataService.getDepartmentRoleMismatches(dept.id, newRole).subscribe({
      next: (mismatches) => {
        if (mismatches.length === 0) return;
        this.syncModalDept = dept;
        this.syncModalNewRole = newRole;
        this.syncModalCandidates = mismatches.map(m => ({ ...m, selected: false }));
        this.isSyncModalOpen = true;
      }
    });
  }

  toggleSyncCandidate(candidate: { selected: boolean }) {
    candidate.selected = !candidate.selected;
  }

  selectAllSyncCandidates(checked: boolean) {
    this.syncModalCandidates.forEach(c => c.selected = checked);
  }

  get selectedSyncCount(): number {
    return this.syncModalCandidates.filter(c => c.selected).length;
  }

  closeSyncModal() {
    this.isSyncModalOpen = false;
    this.syncModalDept = null;
    this.syncModalCandidates = [];
  }

  confirmSyncRoles() {
    const selectedIds = this.syncModalCandidates.filter(c => c.selected).map(c => c.employeeId);
    if (selectedIds.length === 0 || !this.syncModalDept) return;

    this.isSyncing = true;
    this.masterDataService.syncDepartmentRoles(this.syncModalDept.id, this.syncModalNewRole, selectedIds).subscribe({
      next: (res) => {
        this.toast.success(`Updated ${res.updatedCount} employee(s) to ${this.syncModalNewRole}`);
        this.isSyncing = false;
        this.closeSyncModal();
      },
      error: () => {
        this.toast.error('Failed to sync roles');
        this.isSyncing = false;
      }
    });
  }

  // --- Matrix Tab ---
  selectRole(role: string) {
    this.selectedRole = role;
    this.loadPermissions();
  }

  loadPermissions() {
    this.isLoadingMatrix = true;
    this.permissionsService.getAllPermissions(this.selectedRole).subscribe({
      next: (perms) => {
        // Reset all toggles
        this.sidebarModules.forEach(cat => {
          cat.enabled = false;
          cat.subItems.forEach(sub => sub.enabled = false);
        });

        // Apply active permissions
        perms.forEach(p => {
          if (p.action === 'VIEW') {
            const cat = this.sidebarModules.find(c => c.id === p.module);
            if (cat) cat.enabled = true;
            else {
              // Check subitems
              this.sidebarModules.forEach(c => {
                const sub = c.subItems.find(s => s.id === p.module);
                if (sub) sub.enabled = true;
              });
            }
          }
        });
        
        this.isLoadingMatrix = false;
      },
      error: () => {
        this.toast.error('Failed to load permissions matrix');
        this.isLoadingMatrix = false;
      }
    });
  }

  toggleCategory(category: PermissionCategory, enabled: boolean) {
    category.enabled = enabled;
    this.permissionsService.setPermission(this.selectedRole, category.id, 'VIEW', enabled).subscribe({
      next: () => {
        // If enabling category, let's optionally enable all subitems to save clicks
        if (enabled) {
          category.subItems.forEach(sub => {
            if (!sub.enabled) {
              sub.enabled = true;
              this.permissionsService.setPermission(this.selectedRole, sub.id, 'VIEW', true).subscribe();
            }
          });
        } else {
          // If disabling, disable all subitems
           category.subItems.forEach(sub => {
            if (sub.enabled) {
              sub.enabled = false;
              this.permissionsService.setPermission(this.selectedRole, sub.id, 'VIEW', false).subscribe();
            }
          });
        }
        this.toast.success(`${category.title} updated`);
      },
      error: () => {
        category.enabled = !enabled;
        this.toast.error('Failed to update permission');
      }
    });
  }

  toggleSubItem(subItem: PermissionNode, category: PermissionCategory, enabled: boolean) {
    subItem.enabled = enabled;
    this.permissionsService.setPermission(this.selectedRole, subItem.id, 'VIEW', enabled).subscribe({
      next: () => {
        // If enabling a subitem, ensure the parent category is enabled
        if (enabled && !category.enabled) {
          category.enabled = true;
          this.permissionsService.setPermission(this.selectedRole, category.id, 'VIEW', true).subscribe();
        }
        this.toast.success(`${subItem.title} updated`);
      },
      error: () => {
        subItem.enabled = !enabled;
        this.toast.error('Failed to update permission');
      }
    });
  }

  toggleExpand(category: PermissionCategory) {
    category.isExpanded = !category.isExpanded;
  }
}
