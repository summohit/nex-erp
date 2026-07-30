import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';
import { PermissionsService, RolePermission } from '../../services/permissions.service';
import { HotToastService } from '@ngneat/hot-toast';
import { LucideLayoutDashboard, LucideUsers, LucideBriefcase, LucideCalendarClock, LucideBanknote, LucideLaptop, LucideSettings, LucideChevronDown, LucideChevronRight, LucideUser } from '@lucide/angular';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, LucideLayoutDashboard, LucideUsers, LucideBriefcase, LucideCalendarClock, LucideBanknote, LucideLaptop, LucideSettings, LucideChevronDown, LucideChevronRight, LucideUser],
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

  menuSections = [
    {
      title: 'MAIN',
      items: [
        {
          id: 'overview',
          title: 'Overview',
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
            { id: 'recruitment/interviews', title: 'Interviews', route: '/recruitment/interviews' }
          ]
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
        const allowed = new Set<string>(['overview']);
        perms.forEach(p => {
          if (p.action === 'VIEW') {
            allowed.add(p.module);
          }
        });
        // We always allow 'My Profile' for all users, but we didn't give it an ID. Let's add it manually just in case
        allowed.add('employees/me/profile');
        this.allowedModules.set(allowed);
      }
    });
  }

  hasAccess(moduleId: string): boolean {
    return this.allowedModules().has(moduleId);
  }

  hasVisibleItems(section: any): boolean {
    return section.items.some((item: any) => this.hasAccess(item.id));
  }

  ngOnInit() {
    // Check initially
    this.checkExpandedMenu(this.router.url);
    
    // Subscribe to router changes so if they navigate, it expands automatically
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: any) => {
      this.checkExpandedMenu(event.urlAfterRedirects);
    });
  }

  private checkExpandedMenu(url: string) {
    for (const section of this.menuSections) {
      for (const item of section.items) {
        if (item.subItems) {
          const hasActiveSubItem = item.subItems.some(sub => url.includes(sub.route));
          if (hasActiveSubItem) {
            this.expandedMenu.set(item.id);
            return;
          }
        }
      }
    }
  }

  logout() {
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
    if (!hasSubItems) {
      if (menuId !== 'overview') {
        this.comingSoon(event);
      } else {
        this.router.navigate(['/dashboard']);
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
    const allowedRoutes = ['/settings/master-data', '/settings/company', '/settings/permissions', '/employees/directory', '/employees/me/profile', '/employees/onboarding', '/payroll/processing', '/payroll/payslips', '/payroll/expenses', '/payroll/structure'];
    if (allowedRoutes.includes(subItem.route) || subItem.route.startsWith('/employees/') || subItem.route.startsWith('/attendance/') || subItem.route.startsWith('/payroll/')) {
      this.router.navigate([subItem.route]);
    } else {
      this.comingSoon(event);
    }
  }
}
