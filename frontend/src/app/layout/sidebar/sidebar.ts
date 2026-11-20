import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';
import { LayoutService } from '../../services/layout.service';
import { MenusService, MenuOrder, applySavedOrder } from '../../services/menus.service';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { HotToastService } from '@ngneat/hot-toast';
import { LucideLayoutDashboard, LucideUsers, LucideBriefcase, LucideCalendarClock, LucideBanknote, LucideLaptop, LucideSettings, LucideChevronDown, LucideChevronRight, LucideChevronLeft, LucideUser, LucideTrophy, LucideKanban, LucideLogOut, LucideX, LucideBuilding, LucideTarget, LucideDoorOpen, LucideFunnel, LucideShoppingCart, LucideBug, LucideMapPin, LucideMegaphone, LucideCheckCircle2, LucideMessageCircle } from '@lucide/angular';

const LEAVE_MENU_ROUTES = new Set([
  '/attendance/leaves',
  '/attendance/approvals',
  '/attendance/balances',
  '/attendance/leave-quota',
]);

// The self-service tabs attendanceLandingGuard sends Super Admin and HR on to /attendance/all.
const ATTENDANCE_SELF_ROUTES = new Set([
  '/attendance/attendance',
  '/attendance/my-attendance',
  '/attendance/timesheets',
]);

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, DragDropModule, LucideLayoutDashboard, LucideUsers, LucideBriefcase, LucideCalendarClock, LucideBanknote, LucideLaptop, LucideSettings, LucideChevronDown, LucideChevronRight, LucideChevronLeft, LucideUser, LucideTrophy, LucideKanban, LucideLogOut, LucideX, LucideBuilding, LucideTarget, LucideDoorOpen, LucideFunnel, LucideShoppingCart, LucideBug, LucideMapPin, LucideMegaphone, LucideCheckCircle2, LucideMessageCircle],
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
    forkJoin({
      menus: this.menusService.getSidebarMenus(),
      order: this.menusService.getMenuOrder().pipe(catchError(() => of(null))),
    }).subscribe({
      next: ({ menus, order }) => {
        const merged = this.mergeLeaveMenuItems(menus);
        this.defaultSections = JSON.parse(JSON.stringify(merged));
        this.menuSections = this.ordered(merged, order);
        this.checkExpandedMenu(this.router.url);
        this.isLoading.set(false);
      },
      error: () => {
        this.toast.error('Failed to load menu');
        this.isLoading.set(false);
      }
    });
  }

  // ── Arrange my menu (16 Nov 2026) ──────────────────────────────────────
  // Each person drags menus (within a section) and sub-pages (within a menu)
  // into their own order; saved to their profile on the server.
  arranging = signal(false);
  private defaultSections: any[] = [];

  private ordered(sections: any[], order: MenuOrder | null): any[] {
    for (const section of sections) {
      section.items = applySavedOrder(section.items || [], order?.modules, (i: any) => i.id);
      for (const item of section.items) {
        if (item.subItems?.length) item.subItems = applySavedOrder(item.subItems, order?.subs?.[item.id], (x: any) => x.id);
      }
    }
    return sections;
  }

  toggleArrange() {
    const on = !this.arranging();
    this.arranging.set(on);
    if (on) this.toast.info('Drag menus and sub-pages into the order you want. Click Done when finished.', { duration: 4000 });
  }

  dropItem(section: any, e: CdkDragDrop<any[]>) {
    if (e.previousIndex === e.currentIndex) return;
    moveItemInArray(section.items, e.previousIndex, e.currentIndex);
    this.saveOrder();
  }

  dropSub(item: any, e: CdkDragDrop<any[]>) {
    if (e.previousIndex === e.currentIndex) return;
    moveItemInArray(item.subItems, e.previousIndex, e.currentIndex);
    this.saveOrder();
  }

  private saveOrder() {
    const items = this.menuSections.flatMap((s: any) => s.items || []);
    const order: MenuOrder = {
      modules: items.map((i: any) => i.id),
      subs: Object.fromEntries(items.filter((i: any) => i.subItems?.length > 1).map((i: any) => [i.id, i.subItems.map((x: any) => x.id)])),
    };
    this.menusService.saveMenuOrder(order).subscribe({ error: () => this.toast.error('Could not save your menu order') });
  }

  resetOrder() {
    this.menuSections = JSON.parse(JSON.stringify(this.defaultSections));
    this.menusService.saveMenuOrder(null).subscribe({
      next: () => this.toast.success('Menu order reset'),
      error: () => this.toast.error('Could not reset the menu order'),
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
      'Dashboard', 'Employees', 'Recruitment', 'Delivery', 'Attendance & Leave',
      'Performance', 'CRM', 'Sales', 'Settings',
      'Appreciation', 'Offboarding', 'Payroll & Expenses', 'Clients', 'Assets & IT', 'Assets & Inventory',
      'Notice Board', 'Website Chat',
    ];
    if (doneModules.includes(title)) return 'DONE';
    return 'WIP';
  }

  isMainItemActive(item: any): boolean {
    const currentUrl = this.router.url;
    const currentPath = currentUrl.split('?')[0];
    if (item.route && item.route !== '/') {
      if (item.route === '/dashboard' && (currentUrl === '/dashboard' || currentUrl === '/')) {
        return true;
      }
      if (item.route !== '/dashboard' && currentPath.startsWith(item.route)) {
        return true;
      }
    }
    if (item.subItems) {
      return item.subItems.some((sub: any) =>
        this.isMergedLeavesItem(sub)
          ? this.isLeaveRoute(currentPath)
          : currentPath.startsWith(sub.route) || currentUrl.includes(sub.route),
      );
    }
    return false;
  }

  isSubItemActive(sub: any): boolean {
    if (!sub?.route) return false;
    if (sub.route.includes('?')) return this.router.url === sub.route;
    const currentPath = this.router.url.split('?')[0];
    if (this.isMergedLeavesItem(sub)) return this.isLeaveRoute(currentPath);
    // Super Admin and HR are redirected from the Attendance item's own route
    // (/attendance/timesheets etc.) to the company-wide /attendance/all, so the
    // item must light up there too or no sub-item looks selected.
    if (currentPath === '/attendance/all' && ATTENDANCE_SELF_ROUTES.has(sub.route)) return true;
    return currentPath === sub.route;
  }

  private mergeLeaveMenuItems(sections: any[]): any[] {
    return sections.map(section => ({
      ...section,
      items: section.items.map((item: any) => {
        // These creation shortcuts were previously composed client-side and
        // may also exist in older database menu rows. Keep setup accessible
        // through Inventory Setup, without exposing each shortcut in the menu.
        if (item.id === 'assets' || item.route === '/assets') {
          const hiddenSetupRoutes = new Set([
            '/assets/inventory?setup=category',
            '/assets/inventory?setup=brand',
            '/assets/inventory?setup=subcategory',
            '/assets/inventory?setup=vendor',
          ]);
          return {
            ...item,
            subItems: (item.subItems || []).filter((sub: any) => !hiddenSetupRoutes.has(sub.route)),
          };
        }
        if (item.id === 'recruitment' && item.subItems?.some((sub: any) => sub.route === '/recruitment/candidates') && !item.subItems.some((sub: any) => sub.route === '/recruitment/offer-letters')) {
          return { ...item, subItems: [...item.subItems, { id: 'recruitment/offer-letters', title: 'Offer Letters', route: '/recruitment/offer-letters' }] };
        }
        if (item.id !== 'attendance' || !item.subItems?.length) return item;

        const leaveItems = item.subItems.filter((sub: any) => LEAVE_MENU_ROUTES.has(sub.route));
        if (leaveItems.length === 0) return item;

        const firstLeaveIndex = item.subItems.findIndex((sub: any) => LEAVE_MENU_ROUTES.has(sub.route));
        const mergedLeaves = { ...leaveItems[0], id: 'attendance/leaves', title: 'Leaves', route: '/attendance/leaves' };
        const subItems = item.subItems.filter((sub: any) => !LEAVE_MENU_ROUTES.has(sub.route));
        subItems.splice(firstLeaveIndex, 0, mergedLeaves);
        return { ...item, subItems };
      }),
    }));
  }

  private isMergedLeavesItem(sub: any): boolean {
    return sub?.id === 'attendance/leaves' && sub?.title === 'Leaves';
  }

  private isLeaveRoute(path: string): boolean {
    return LEAVE_MENU_ROUTES.has(path);
  }

  ngOnInit() {
    const savedState = localStorage.getItem('sidebar_collapsed');
    if (savedState === 'true') {
      this.isCollapsed.set(true);
      document.body.classList.add('sidebar-collapsed');
    }

    // Check initially
    this.checkExpandedMenu(this.router.url);

    window.addEventListener('sidebar-toggle', (e: any) => {
      this.isCollapsed.set(e.detail?.collapsed ?? false);
    });
    
    // Subscribe to router changes so if they navigate, it expands automatically
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: any) => {
      this.checkExpandedMenu(event.urlAfterRedirects);
      // On a phone the rail covers the page, so navigating has to close it —
      // otherwise the destination is behind the menu you just used.
      this.closeMobileNav();
    });
  }

  /**
   * On a phone the rail slides over the content instead of pushing it: at 375px
   * there is no room for a 260px sidebar and a usable page at the same time.
   * The header's hamburger drives the same state, so it lives in LayoutService.
   */
  readonly layout = inject(LayoutService);

  closeMobileNav() {
    this.layout.closeMobileNav();
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
          const currentPath = url.split('?')[0];
          const hasActiveSubItem = item.subItems.some((sub: any) =>
            this.isMergedLeavesItem(sub)
              ? this.isLeaveRoute(currentPath)
              : url.includes(sub.route) || this.isSubItemActive(sub),
          );
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

  /** Ctrl/Cmd/Shift-click or middle-click: let the browser open the link itself. */
  private opensElsewhere(event: Event): boolean {
    const e = event as MouseEvent;
    return !!(e && (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1));
  }

  toggleMenu(menuItem: any, event: Event) {
    // While arranging, a click only opens a group (to arrange its pages); it never navigates.
    if (this.arranging() && !menuItem.subItems?.length) { event.preventDefault(); return; }
    if (!menuItem.subItems?.length && menuItem.route && this.opensElsewhere(event)) return;
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
    if (this.arranging()) { event.preventDefault(); return; }
    if (subItem.route && !subItem.external && subItem.route !== '/careers' && this.opensElsewhere(event)) return;
    event.preventDefault();
    if (subItem.external || subItem.route === '/careers') {
      // Plain /careers, without the encoded company id (16 Nov 2026).
      window.open(subItem.route, '_blank');
      return;
    }
    
    if (subItem.route) {
      this.router.navigate([subItem.route]);
    } else {
      this.comingSoon(event);
    }
  }
}
