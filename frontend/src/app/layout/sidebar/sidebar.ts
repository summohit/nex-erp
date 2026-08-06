import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';
import { PermissionsService, RolePermission } from '../../services/permissions.service';
import { HotToastService } from '@ngneat/hot-toast';
import { LucideLayoutDashboard, LucideUsers, LucideBriefcase, LucideCalendarClock, LucideBanknote, LucideLaptop, LucideSettings, LucideChevronDown, LucideChevronRight, LucideChevronLeft, LucideUser, LucideTrophy, LucideKanban, LucideLogOut, LucideX } from '@lucide/angular';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, LucideLayoutDashboard, LucideUsers, LucideBriefcase, LucideCalendarClock, LucideBanknote, LucideLaptop, LucideSettings, LucideChevronDown, LucideChevronRight, LucideChevronLeft, LucideUser, LucideTrophy, LucideKanban, LucideLogOut, LucideX],
  templateUrl: './sidebar.html',
  styleUrls: ['./sidebar.css']
})
export class SidebarComponent implements OnInit {
  private authService = inject(AuthService);
  private permissionsService = inject(PermissionsService);
  public router = inject(Router);
  private toast = inject(HotToastService);

  user = signal<any>(null);
  expandedMenu = signal<string | null>(null);
  allowedModules = signal<Set<string>>(new Set(['overview']));
  isCollapsed = signal<boolean>(false);
  logoFailed = signal<boolean>(false);

  onLogoError() {
    this.logoFailed.set(true);
  }

  menuSections = [
    {
      title: 'MAIN',
      items: [
        {
          id: 'overview',
          title: 'Dashboard',
          icon: 'lucideLayoutDashboard',
          route: '/dashboard'
        },
        {
          id: 'employees',
          title: 'Employees',
          icon: 'lucideUsers',
          route: '/employees',
          subItems: [
            { id: 'employees/directory', title: 'Employee Directory', route: '/employees/directory' },
            { id: 'employees/me/profile', title: 'My Profile', route: '/employees/me/profile' },
            { id: 'employees/org-chart', title: 'Organization Chart', route: '/employees/org-chart' },
            { id: 'employees/onboarding', title: 'Onboarding', route: '/employees/onboarding' },
            { id: 'employees/documents', title: 'Documents', route: '/employees/documents' }
          ]
        },
        {
          id: 'recruitment',
          title: 'Recruitment',
          icon: 'lucideBriefcase',
          route: '/recruitment',
          subItems: [
            { id: 'recruitment/jobs', title: 'Job Postings', route: '/recruitment/jobs' },
            { id: 'recruitment/candidates', title: 'Candidates (ATS)', route: '/recruitment/candidates' },
            { id: 'recruitment/interviews', title: 'Interviews', route: '/recruitment/interviews' },
            { id: 'recruitment/careers', title: 'Public Careers Page ↗', route: '/careers', external: true }
          ]
        },
        {
          id: 'projects',
          title: 'Projects',
          icon: 'lucideKanban',
          route: '/projects'
        },
        {
          id: 'attendance',
          title: 'Attendance & Leave',
          icon: 'lucideCalendarClock',
          route: '/attendance',
          subItems: [
            { id: 'attendance/timesheets', title: 'Timesheets', route: '/attendance/timesheets' },
            { id: 'attendance/leaves', title: 'Time Off Requests', route: '/attendance/leaves' },
            { id: 'attendance/balances', title: 'Leave Balances', route: '/attendance/balances' },
            { id: 'attendance/shifts', title: 'Shift Roster', route: '/attendance/shifts' },
            { id: 'attendance/holidays', title: 'Holidays', route: '/attendance/holidays' }
          ]
        },
        {
          id: 'appreciation',
          title: 'Appreciation',
          icon: 'lucideTrophy',
          route: '/appreciation'
        },
        {
          id: 'payroll',
          title: 'Payroll & Expenses',
          icon: 'lucideBanknote',
          route: '/payroll',
          subItems: [
            { id: 'payroll/processing', title: 'Salary Processing', route: '/payroll/processing' },
            { id: 'payroll/payslips', title: 'Payslips', route: '/payroll/payslips' },
            { id: 'payroll/expenses', title: 'Expense Claims', route: '/payroll/expenses' },
            { id: 'payroll/structure', title: 'Salary Structure', route: '/payroll/structure' }
          ]
        },
        {
          id: 'assets',
          title: 'Assets & IT',
          icon: 'lucideLaptop',
          route: '/assets',
          subItems: [
            { id: 'assets/inventory', title: 'Asset Inventory', route: '/assets/inventory' },
            { id: 'assets/assignments', title: 'Assignments', route: '/assets/assignments' },
            { id: 'assets/requests', title: 'Hardware Requests', route: '/assets/requests' }
          ]
        }
      ]
    },
    {
      title: 'OTHERS',
      items: [
        {
          id: 'settings',
          title: 'Settings',
          icon: 'lucideSettings',
          route: '/settings',
          subItems: [
            { id: 'settings/company', title: 'Company Profile', route: '/settings/company' },
            { id: 'settings/master-data', title: 'Master Data', route: '/settings/master-data' },
            { id: 'settings/permissions', title: 'Roles & Permissions', route: '/settings/permissions' },
            { id: 'settings/integrations', title: 'Integrations', route: '/settings/integrations' }
          ]
        }
      ]
    }
  ];

  constructor() {
    this.authService.getMe().subscribe({
      next: (user) => {
        this.user.set(user);
        this.loadPermissions(user.role);
      }
    });
  }

  loadPermissions(role: string) {
    if (role === 'SUPERADMIN') {
      // Superadmin sees everything, we can just allow everything
      const allAllowed = new Set<string>();
      allAllowed.add('overview');
      this.menuSections.forEach(sec => {
        sec.items.forEach(item => {
          allAllowed.add(item.id);
          if (item.subItems) {
            item.subItems.forEach((sub: any) => allAllowed.add(sub.id));
          }
        });
      });
      this.allowedModules.set(allAllowed);
      return;
    }

    this.permissionsService.getAllPermissions(role).subscribe({
      next: (perms) => {
        const allowed = new Set<string>(['overview', 'employees/me/profile']);
        
        if (perms && perms.length > 0) {
          perms.forEach(p => {
            if (p.action === 'VIEW') {
              allowed.add(p.module);
            }
          });
        } else {
          // Fallback defaults based on RBAC role
          if (role === 'ADMIN' || role === 'HR' || role === 'FINANCE') {
            allowed.add('assets');
            allowed.add('assets/inventory');
            allowed.add('assets/assignments');
            allowed.add('assets/requests');
          } else {
            // Standard Employee / Other roles: Only Hardware Requests
            allowed.add('assets');
            allowed.add('assets/requests');
          }
        }
        
        allowed.add('recruitment/careers');

        // Auto-add parent module ID if any sub-item is allowed
        this.menuSections.forEach(sec => {
          sec.items.forEach(item => {
            if (item.subItems && item.subItems.some((sub: any) => allowed.has(sub.id))) {
              allowed.add(item.id);
            }
          });
        });

        this.allowedModules.set(allowed);
      }
    });
  }

  hasAccess(moduleId: string): boolean {
    const item = this.findMenuItem(moduleId);
    if (item && item.subItems) {
      return item.subItems.some((sub: any) => this.allowedModules().has(sub.id));
    }
    return this.allowedModules().has(moduleId);
  }

  private findMenuItem(id: string): any {
    for (const sec of this.menuSections) {
      for (const item of sec.items) {
        if (item.id === id) return item;
      }
    }
    return null;
  }

  hasVisibleItems(section: any): boolean {
    return section.items.some((item: any) => this.hasAccess(item.id));
  }

  isMainItemActive(item: any): boolean {
    const currentUrl = this.router.url;
    if (item.route && item.route !== '/') {
      if (item.route === '/dashboard' && (currentUrl === '/dashboard' || currentUrl === '/')) {
        return true;
      }
      if (item.route !== '/dashboard' && currentUrl.startsWith(item.route)) {
        return true;
      }
    }
    if (item.subItems) {
      return item.subItems.some((sub: any) => currentUrl.includes(sub.route));
    }
    return false;
  }

  ngOnInit() {
    const savedState = localStorage.getItem('sidebar_collapsed');
    if (savedState === 'true') {
      this.isCollapsed.set(true);
      document.body.classList.add('sidebar-collapsed');
    }

    // Check initially
    this.checkExpandedMenu(this.router.url);
    
    // Subscribe to router changes so if they navigate, it expands automatically
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: any) => {
      this.checkExpandedMenu(event.urlAfterRedirects);
    });
  }

  toggleSidebar() {
    const newState = !this.isCollapsed();
    this.isCollapsed.set(newState);
    localStorage.setItem('sidebar_collapsed', newState.toString());
    
    if (newState) {
      document.body.classList.add('sidebar-collapsed');
      this.expandedMenu.set(null); // Collapse any open menus when collapsing sidebar
    } else {
      document.body.classList.remove('sidebar-collapsed');
    }
  }

  private checkExpandedMenu(url: string) {
    let activeFound = false;
    for (const section of this.menuSections) {
      for (const item of section.items) {
        if (item.subItems) {
          const hasActiveSubItem = item.subItems.some(sub => url.includes(sub.route));
          if (hasActiveSubItem) {
            this.expandedMenu.set(item.id);
            activeFound = true;
            return;
          }
        }
      }
    }
    if (!activeFound) {
      this.expandedMenu.set(null);
    }
  }

  showLogoutModal = signal<boolean>(false);

  promptLogout() {
    this.showLogoutModal.set(true);
  }

  cancelLogout() {
    this.showLogoutModal.set(false);
  }

  confirmLogout() {
    this.showLogoutModal.set(false);
    this.authService.logout();
    this.toast.info('Logged out successfully');
    this.router.navigate(['/']);
  }

  goToProfile() {
    if (this.user()?.employee?.id) {
      this.router.navigate(['/employees', this.user().employee.id, 'profile']);
    } else {
      this.toast.info('No employee profile found for this user.');
    }
  }

  comingSoon(event: Event) {
    event.preventDefault();
    this.toast.info('This module is coming soon!', {
      icon: '🚀',
      position: 'top-center'
    });
  }

  toggleMenu(menuId: string, event: Event, hasSubItems: boolean) {
    event.preventDefault();

    // If sidebar is collapsed, auto-expand it so submenus and labels are accessible
    if (this.isCollapsed()) {
      this.isCollapsed.set(false);
      localStorage.setItem('sidebar_collapsed', 'false');
      document.body.classList.remove('sidebar-collapsed');
    }

    if (!hasSubItems) {
      if (menuId === 'overview') {
        this.router.navigate(['/dashboard']);
      } else if (menuId === 'appreciation') {
        if (this.hasAccess('appreciation')) {
          this.router.navigate(['/appreciation']);
        } else {
          this.toast.error('You do not have permission to access Appreciation.');
        }
      } else if (menuId === 'projects') {
        if (this.hasAccess('projects')) {
          this.router.navigate(['/projects']);
        } else {
          this.toast.error('You do not have permission to access Projects.');
        }
      } else {
        this.comingSoon(event);
      }
      return;
    }
    
    if (this.expandedMenu() === menuId) {
      this.expandedMenu.set(null); // collapse
    } else {
      this.expandedMenu.set(menuId); // expand
    }
  }

  handleSubMenuClick(subItem: any, event: Event) {
    event.preventDefault();
    if (subItem.external || subItem.route === '/careers') {
      let route = subItem.route;
      if (subItem.route === '/careers') {
        const currentUser = this.user();
        if (currentUser && currentUser.companyId) {
          const encrypted = btoa(currentUser.companyId);
          route = `/careers/${encrypted}`;
        }
      }
      window.open(route, '_blank');
      return;
    }
    if (
      subItem.route.startsWith('/assets') ||
      subItem.route.startsWith('/employees/') ||
      subItem.route.startsWith('/attendance/') ||
      subItem.route.startsWith('/payroll/') ||
      subItem.route.startsWith('/settings/') ||
      subItem.route.startsWith('/recruitment/') ||
      subItem.route.startsWith('/projects')
    ) {
      this.router.navigate([subItem.route]);
    } else {
      this.comingSoon(event);
    }
  }
}
