import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';
import { MenusService } from '../../services/menus.service';
import { HotToastService } from '@ngneat/hot-toast';
import { LucideLayoutDashboard, LucideUsers, LucideBriefcase, LucideCalendarClock, LucideBanknote, LucideLaptop, LucideSettings, LucideChevronDown, LucideChevronRight, LucideChevronLeft, LucideUser, LucideTrophy, LucideKanban, LucideLogOut, LucideX, LucideBuilding, LucideTarget, LucideDoorOpen, LucideFunnel, LucideShoppingCart, LucideBug, LucideMapPin } from '@lucide/angular';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, LucideLayoutDashboard, LucideUsers, LucideBriefcase, LucideCalendarClock, LucideBanknote, LucideLaptop, LucideSettings, LucideChevronDown, LucideChevronRight, LucideChevronLeft, LucideUser, LucideTrophy, LucideKanban, LucideLogOut, LucideX, LucideBuilding, LucideTarget, LucideDoorOpen, LucideFunnel, LucideShoppingCart, LucideBug, LucideMapPin],
  templateUrl: './sidebar.html',
  styleUrls: ['./sidebar.css']
})
export class SidebarComponent implements OnInit {
  private authService = inject(AuthService);
  private menusService = inject(MenusService);
  public router = inject(Router);
  private toast = inject(HotToastService);

  user = signal<any>(null);
  expandedMenu = signal<string | null>(null);
  isCollapsed = signal<boolean>(false);
  logoFailed = signal<boolean>(false);
  isLoading = signal<boolean>(true);

  onLogoError() {
    this.logoFailed.set(true);
  }

  menuSections: any[] = [];

  constructor() {
    this.authService.getMe().subscribe({
      next: (user) => {
        this.user.set(user);
        this.loadMenus();
      },
      error: () => {
        this.isLoading.set(false);
      }
    });
  }

  loadMenus() {
    this.menusService.getSidebarMenus().subscribe({
      next: (menus) => {
        this.menuSections = menus;
        this.checkExpandedMenu(this.router.url);
        this.isLoading.set(false);
      },
      error: () => {
        this.toast.error('Failed to load menu');
        this.isLoading.set(false);
      }
    });
  }

  hasVisibleItems(section: any): boolean {
    return section.items && section.items.length > 0;
  }

  /**
   * Roadmap badge shown beside each sidebar module. This is a hand-maintained
   * list, not something derived from the code — update it when a module ships,
   * otherwise it quietly misreports the state of the project.
   *
   * Assets, Payroll, Clients, Offboarding and Appreciation were added here in
   * Sep 2026: all five were fully built but still displaying WIP.
   */
  getModuleStatus(title: string): 'DONE' | 'WIP' | null {
    const doneModules = [
      'Dashboard', 'Employees', 'Recruitment', 'Projects', 'Attendance & Leave',
      'Performance', 'CRM', 'Sales', 'Settings',
      'Appreciation', 'Offboarding', 'Payroll & Expenses', 'Clients', 'Assets & IT',
      'Field Visits',
    ];
    if (doneModules.includes(title)) return 'DONE';
    return 'WIP';
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
          const hasActiveSubItem = item.subItems.some((sub: any) => url.includes(sub.route));
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

  toggleMenu(menuItem: any, event: Event) {
    event.preventDefault();

    // If sidebar is collapsed, auto-expand it so submenus and labels are accessible
    if (this.isCollapsed()) {
      this.isCollapsed.set(false);
      localStorage.setItem('sidebar_collapsed', 'false');
      document.body.classList.remove('sidebar-collapsed');
    }

    const hasSubItems = menuItem.subItems && menuItem.subItems.length > 0;

    if (!hasSubItems) {
      if (menuItem.route) {
        this.router.navigate([menuItem.route]);
      } else {
        this.comingSoon(event);
      }
      return;
    }
    
    if (this.expandedMenu() === menuItem.id) {
      this.expandedMenu.set(null); // collapse
    } else {
      this.expandedMenu.set(menuItem.id); // expand
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
    
    if (subItem.route) {
      this.router.navigate([subItem.route]);
    } else {
      this.comingSoon(event);
    }
  }
}
