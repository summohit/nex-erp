import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PermissionsService, RolePermission, WebsiteChatUserAccess } from '../../services/permissions.service';
import { AuthService } from '../../services/auth.service';
import { MasterDataService, Department } from '../../services/master-data.service';
import { HotToastService } from '@ngneat/hot-toast';
import { LucideShield, LucideChevronDown, LucideChevronRight, LucideSearch, LucideX, LucideTrash2, LucideUsers, LucideMessageSquare } from '@lucide/angular';

interface PermissionNode {
  id: string;
  title: string;
  enabled: boolean;
}

interface PermissionCategory extends PermissionNode {
  isExpanded: boolean;
  subItems: PermissionNode[];
  viewAllEnabled?: boolean;
  viewAllLabel?: string;
  viewAllHint?: string;
  /** Only the super admin may switch this on or off. */
  superadminOnly?: boolean;
}

@Component({
  selector: 'app-permissions',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideShield,
    LucideChevronDown,
    LucideChevronRight,
    LucideSearch,
    LucideX,
    LucideTrash2,
    LucideUsers,
    LucideMessageSquare,
  ],
  templateUrl: './permissions.component.html',
  styleUrls: ['./permissions.component.css']
})
export class PermissionsComponent implements OnInit {
  private permissionsService = inject(PermissionsService);
  private masterDataService = inject(MasterDataService);
  private toast = inject(HotToastService);
  private auth = inject(AuthService);

  activeTab: 'departments' | 'matrix' | 'chat-access' = 'departments';

  get isSuperadmin(): boolean {
    return this.auth.currentUser()?.role === 'SUPERADMIN';
  }

  // Tab 1: Departments -> Roles
  departments: Department[] = [];
  isLoadingDepartments = false;
  savingDeptId: number | null = null;
  
  roles = ['SUPERADMIN', 'ADMIN', 'HR', 'FINANCE', 'OPERATIONS_MANAGER', 'SALES', 'EMPLOYEE', 'OFFICE_STAFF'];

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
      id: 'projects', title: 'Delivery', isExpanded: true, enabled: false,
      subItems: [], viewAllEnabled: false,
      viewAllLabel: 'View All Projects',
      viewAllHint: 'Grants all-project visibility to users with this account role or a department configured with this default role.'
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
        { id: 'attendance/timesheets', title: 'Attendance', enabled: false },
        { id: 'attendance/leaves', title: 'Time Off Requests', enabled: false },
        { id: 'attendance/approvals', title: 'Leave Approvals', enabled: false },
        { id: 'attendance/balances', title: 'Leave Balances', enabled: false },
        { id: 'attendance/shifts', title: 'Shift Roster', enabled: false },
        { id: 'attendance/shift-summary', title: 'Shift Attendance', enabled: false },
        { id: 'attendance/timeline', title: 'Team Timeline', enabled: false },
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
      subItems: [], viewAllEnabled: false
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
        { id: 'settings/letter-templates', title: 'Letter Templates', enabled: false },
        { id: 'settings/permissions', title: 'Roles & Permissions', enabled: false },
        { id: 'settings/system', title: 'System Settings', enabled: false },
        { id: 'settings/integrations', title: 'Integrations', enabled: false }
      ]
    }
  ];

  ngOnInit() {
    this.loadDepartments();
    this.loadPermissions();
  }

  setTab(tab: 'departments' | 'matrix' | 'chat-access') {
    this.activeTab = tab;
    if (tab === 'chat-access') this.loadChatAccess();
  }

  // --- Website Chat per-user access (super admin only) ---
  chatUsers: WebsiteChatUserAccess[] = [];
  chatUserSearch = '';
  isLoadingChatUsers = false;
  savingChatUserId: number | null = null;

  /** People the super admin has given Website Chat to — the only rows in the table. */
  get shownChatUsers(): WebsiteChatUserAccess[] {
    return this.chatUsers.filter(u => u.override === true);
  }

  /** Search results for "Add person": active people not already shown (super admins always have it). */
  get chatAddCandidates(): WebsiteChatUserAccess[] {
    const q = this.chatUserSearch.trim().toLowerCase();
    if (!q) return [];
    return this.chatUsers
      .filter(u => u.override !== true && u.role !== 'SUPERADMIN' && u.isActive)
      .filter(u =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.designation && u.designation.toLowerCase().includes(q)) ||
        (u.department && u.department.toLowerCase().includes(q))
      )
      .slice(0, 8);
  }

  clearChatSearch() {
    this.chatUserSearch = '';
  }

  getAvatarBg(nameOrEmail: string): string {
    const colors = [
      '#4f46e5', '#2563eb', '#0284c7', '#0d9488',
      '#059669', '#7c3aed', '#9333ea', '#c026d3',
      '#db2777', '#e11d48', '#d97706', '#475569'
    ];
    let hash = 0;
    const str = nameOrEmail || '';
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  getInitials(nameOrEmail: string): string {
    if (!nameOrEmail) return '?';
    const parts = nameOrEmail.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  getRoleBadgeClass(role: string): string {
    switch (role?.toUpperCase()) {
      case 'SUPERADMIN': return 'badge-role-superadmin';
      case 'ADMIN': return 'badge-role-admin';
      case 'HR': return 'badge-role-hr';
      case 'FINANCE': return 'badge-role-finance';
      case 'SALES': return 'badge-role-sales';
      case 'OPERATIONS_MANAGER': return 'badge-role-ops';
      default: return 'badge-role-employee';
    }
  }

  loadChatAccess() {
    this.isLoadingChatUsers = true;
    this.permissionsService.getWebsiteChatUsers().subscribe({
      next: (users) => { this.chatUsers = users; this.isLoadingChatUsers = false; },
      error: () => { this.toast.error('Failed to load users'); this.isLoadingChatUsers = false; }
    });
  }

  showChatTo(u: WebsiteChatUserAccess) {
    this.saveChatAccess(u, true, `Website Chat shown to ${u.name}`);
    this.chatUserSearch = '';
  }

  removeChatFrom(u: WebsiteChatUserAccess) {
    this.saveChatAccess(u, null, `Website Chat hidden from ${u.name}`);
  }

  private saveChatAccess(u: WebsiteChatUserAccess, granted: boolean | null, ok: string) {
    this.savingChatUserId = u.userId;
    this.permissionsService.setWebsiteChatUser(u.userId, granted).subscribe({
      next: () => {
        u.override = granted;
        u.hasAccess = granted ?? u.fromRole;
        this.savingChatUserId = null;
        this.toast.success(ok);
      },
      error: (e) => { this.savingChatUserId = null; this.toast.error(e?.error?.message || 'Failed to update access'); }
    });
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
          if (cat.viewAllEnabled !== undefined) cat.viewAllEnabled = false;
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
          } else if (p.action === 'VIEW_ALL') {
            const cat = this.sidebarModules.find(c => c.id === p.module);
            if (cat) cat.viewAllEnabled = true;
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

  toggleViewAll(category: PermissionCategory, enabled: boolean) {
    category.viewAllEnabled = enabled;
    this.permissionsService.setPermission(this.selectedRole, category.id, 'VIEW_ALL', enabled).subscribe({
      next: () => {
        this.toast.success(`${category.viewAllLabel} ${enabled ? 'enabled' : 'disabled'} for ${this.selectedRole}`);
      },
      error: () => {
        category.viewAllEnabled = !enabled;
        this.toast.error('Failed to update permission');
      }
    });
  }
}
