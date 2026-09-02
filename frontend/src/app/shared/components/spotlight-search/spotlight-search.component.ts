import { Component, inject, signal, computed, HostListener, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { EmployeeService } from '../../../services/employee.service';
import { AuthService } from '../../../services/auth.service';
import { HotToastService } from '@ngneat/hot-toast';
import { ProjectsService } from '../../../services/projects';
import { MenusService } from '../../../services/menus.service';
import {
  LucideSearch, LucideArrowRight
} from '@lucide/angular';

/** A secondary action rendered as a button on a result row. */
export interface SearchRowAction {
  label: string;
  run: () => void;
  tone?: 'default' | 'primary' | 'danger';
}

export interface SearchResultItem {
  id: string;
  category: 'Navigation' | 'Employees' | 'Projects' | 'Settings';
  title: string;
  subtitle?: string;
  iconName: string;
  action: () => void;
  /** Permission module key (or prefix) required to show this item. Omit for always-visible items. */
  requiresModule?: string;
  /** Row buttons mirroring the Employee Directory's action menu. */
  actions?: SearchRowAction[];
}

@Component({
  selector: 'app-spotlight-search',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideSearch, LucideArrowRight
  ],
  templateUrl: './spotlight-search.component.html',
  styleUrls: ['./spotlight-search.component.css']
})
export class SpotlightSearchComponent {
  private router = inject(Router);
  private employeeService = inject(EmployeeService);
  private projectsService = inject(ProjectsService);
  private menusService = inject(MenusService);
  private authService = inject(AuthService);
  private toast = inject(HotToastService);

  @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;

  isOpen = signal<boolean>(false);
  query = signal<string>('');
  selectedIndex = signal<number>(0);

  employeesList = signal<any[]>([]);
  projectsList = signal<any[]>([]);
  private allowedModules = new Set<string>();

  // Navigation Items. `requiresModule` gates visibility against the user's actual sidebar permissions.
  private allNavItems: SearchResultItem[] = [
    { id: 'nav-dash', category: 'Navigation', title: 'Dashboard', subtitle: 'Executive overview & quick stats', iconName: 'layers', action: () => this.navigate('/dashboard') },
    { id: 'nav-emp', category: 'Navigation', title: 'Employee Directory', subtitle: 'View all staff and team profiles', iconName: 'user', action: () => this.navigate('/employees/directory'), requiresModule: 'employees/directory' },
    { id: 'nav-org', category: 'Navigation', title: 'Organization Chart', subtitle: 'Interactive visual org hierarchy', iconName: 'building', action: () => this.navigate('/employees/org-chart'), requiresModule: 'employees/org-chart' },
    { id: 'nav-docs', category: 'Navigation', title: 'Employee Documents Center', subtitle: 'Company policies & verification files', iconName: 'file-text', action: () => this.navigate('/employees/documents'), requiresModule: 'employees/documents' },
    { id: 'nav-att', category: 'Navigation', title: 'Attendance & Leave Management', subtitle: 'Clock-in logs & leave requests', iconName: 'calendar', action: () => this.navigate('/attendance'), requiresModule: 'attendance/' },
    { id: 'nav-prj', category: 'Navigation', title: 'Projects & Kanban Board', subtitle: 'Jira-style task management', iconName: 'briefcase', action: () => this.navigate('/projects'), requiresModule: 'projects' },
    { id: 'nav-pay', category: 'Navigation', title: 'Payroll & Compensation', subtitle: 'Salary slips & salary structures', iconName: 'dollar-sign', action: () => this.navigate('/payroll'), requiresModule: 'payroll/' },
    { id: 'nav-ast', category: 'Navigation', title: 'Asset Management', subtitle: 'Company hardware & laptops', iconName: 'briefcase', action: () => this.navigate('/assets'), requiresModule: 'assets/' },
    { id: 'nav-awa', category: 'Navigation', title: 'Appreciation & Awards', subtitle: 'Employee recognition badges', iconName: 'award', action: () => this.navigate('/appreciation'), requiresModule: 'appreciation' },
    { id: 'nav-master', category: 'Settings', title: 'Master Data Settings', subtitle: 'Manage Branches, Departments & Designations', iconName: 'settings', action: () => this.navigate('/settings/master-data'), requiresModule: 'settings/master-data' },
    { id: 'nav-perm', category: 'Settings', title: 'Roles & Permissions', subtitle: 'RBAC module access matrix', iconName: 'shield-check', action: () => this.navigate('/settings/permissions'), requiresModule: 'settings/permissions' },
  ];

  get navItems(): SearchResultItem[] {
    return this.allNavItems.filter(item => {
      if (!item.requiresModule) return true;
      if (item.requiresModule.endsWith('/')) {
        return [...this.allowedModules].some(m => m.startsWith(item.requiresModule!));
      }
      return this.allowedModules.has(item.requiresModule);
    });
  }

  constructor() {
    this.loadData();
  }

  private loadData() {
    this.menusService.getSidebarMenus().subscribe({
      next: (sections: any[]) => {
        const ids = new Set<string>();
        for (const section of sections || []) {
          for (const item of section.items || []) {
            ids.add(item.id);
            for (const sub of item.subItems || []) {
              ids.add(sub.id);
            }
          }
        }
        this.allowedModules = ids;

        // Only fetch the full employee/project lists once we know the user is allowed to see them
        if (this.allowedModules.has('employees/directory')) {
          this.employeeService.getEmployees().subscribe({
            next: (res: any) => this.employeesList.set(res.data || res || []),
            error: () => this.employeesList.set([])
          });
        }
        if (this.allowedModules.has('projects')) {
          this.projectsService.getProjects().subscribe({
            next: (res: any) => this.projectsList.set(res.data || res || []),
            error: () => this.projectsList.set([])
          });
        }
      },
      error: () => { this.allowedModules = new Set<string>(); }
    });
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.toggleOpen();
    } else if (event.key === 'Escape' && this.isOpen()) {
      event.preventDefault();
      this.close();
    } else if (this.isOpen()) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.selectedIndex.update(i => (i + 1) % Math.max(1, this.filteredResults().length));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.selectedIndex.update(i => (i - 1 + this.filteredResults().length) % Math.max(1, this.filteredResults().length));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const results = this.filteredResults();
        if (results.length > 0 && results[this.selectedIndex()]) {
          results[this.selectedIndex()].action();
        }
      }
    }
  }

  open() {
    this.isOpen.set(true);
    this.query.set('');
    this.selectedIndex.set(0);
    setTimeout(() => {
      if (this.searchInput) {
        this.searchInput.nativeElement.focus();
      }
    }, 50);
  }

  close() {
    this.isOpen.set(false);
  }

  toggleOpen() {
    if (this.isOpen()) {
      this.close();
    } else {
      this.open();
    }
  }

  filteredResults = computed<SearchResultItem[]>(() => {
    const q = this.query().toLowerCase().trim();
    
    let list: SearchResultItem[] = [...this.navItems];

    // Dynamic Employee Search Results
    const empMatches: SearchResultItem[] = this.employeesList()
      .filter(e => 
        (e.firstName + ' ' + e.lastName).toLowerCase().includes(q) ||
        (e.email || '').toLowerCase().includes(q) ||
        (e.designation?.name || '').toLowerCase().includes(q)
      )
      .slice(0, 5)
      .map(e => ({
        id: `emp-${e.id}`,
        category: 'Employees' as const,
        title: `${e.firstName} ${e.lastName}`,
        subtitle: `${e.designation?.name || 'Staff'} • ${e.department?.name || 'General'}`,
        iconName: 'user',
        action: () => this.navigate(`/employees/${e.id}/profile`),
        actions: this.employeeRowActions(e),
      }));

    // Dynamic Project Search Results
    const prjMatches: SearchResultItem[] = this.projectsList()
      .filter(p => p.name.toLowerCase().includes(q) || (p.code || '').toLowerCase().includes(q))
      .slice(0, 5)
      .map(p => ({
        id: `prj-${p.id}`,
        category: 'Projects' as const,
        title: p.name,
        subtitle: `Project Code: ${p.code || 'PRJ'} • Status: ${p.status}`,
        iconName: 'briefcase',
        action: () => this.navigate(`/projects/${p.id}`)
      }));

    const combined = [...list, ...empMatches, ...prjMatches];

    if (!q) return combined;

    return combined.filter(item => 
      item.title.toLowerCase().includes(q) || 
      (item.subtitle && item.subtitle.toLowerCase().includes(q)) ||
      item.category.toLowerCase().includes(q)
    );
  });

  private navigate(path: string) {
    this.close();
    this.router.navigate([path]);
  }

  /**
   * Only staff who administer people get the management actions. Everyone else
   * still gets the row itself, which opens the profile.
   */
  private get canManageEmployees(): boolean {
    const token = localStorage.getItem('access_token');
    if (!token) return false;
    try {
      const role = JSON.parse(atob(token.split('.')[1])).role;
      return role === 'ADMIN' || role === 'HR' || role === 'SUPERADMIN';
    } catch {
      return false;
    }
  }

  /** Mirrors the Employee Directory row menu: View Profile, Edit, Resend, Deactivate. */
  private employeeRowActions(e: any): SearchRowAction[] {
    const actions: SearchRowAction[] = [
      { label: 'View Profile', run: () => this.navigate(`/employees/${e.id}/profile`) },
    ];
    if (!this.canManageEmployees) return actions;

    actions.push({
      label: 'Edit',
      // The edit drawer lives on the directory, so hand it the id to open.
      run: () => {
        this.close();
        this.router.navigate(['/employees/directory'], { queryParams: { edit: e.id } });
      },
    });

    if (e.user?.email && e.user?.status === 'PENDING') {
      actions.push({
        label: 'Resend Verification',
        tone: 'primary',
        run: () => {
          this.authService.resendVerification(e.user.email).subscribe({
            next: () => this.toast.success(`Verification email sent to ${e.user.email}`),
            error: () => this.toast.error('Failed to send verification email'),
          });
        },
      });
    }

    const isSuspended = e.user?.status === 'SUSPENDED';
    actions.push({
      label: isSuspended ? 'Activate' : 'Deactivate',
      tone: isSuspended ? 'primary' : 'danger',
      run: () => {
        const verb = isSuspended ? 'activate' : 'deactivate';
        if (!confirm(`Are you sure you want to ${verb} ${e.firstName} ${e.lastName}?`)) return;
        this.employeeService.deleteEmployee(e.id).subscribe({
          next: (res: any) => {
            this.toast.success(`Employee ${res.newStatus === 'SUSPENDED' ? 'deactivated' : 'activated'} successfully`);
            // Refresh the cached list so the row's label flips.
            this.employeeService.getEmployees().subscribe({
              next: (r: any) => this.employeesList.set(r.data || r || []),
            });
          },
          error: () => this.toast.error(`Failed to ${verb} employee`),
        });
      },
    });

    return actions;
  }
}
