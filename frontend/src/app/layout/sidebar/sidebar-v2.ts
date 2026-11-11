import { Component, inject, signal, computed, effect, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';
import { LayoutService } from '../../services/layout.service';
import { MenusService } from '../../services/menus.service';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucideLayoutDashboard, LucideUsers, LucideBriefcase, LucideCalendarClock,
  LucideBanknote, LucideLaptop, LucideSettings, LucideChevronDown,
  LucideChevronRight, LucideChevronLeft, LucideUser, LucideTrophy,
  LucideKanban, LucideLogOut, LucideX, LucideBuilding, LucideTarget,
  LucideDoorOpen, LucideFunnel, LucideShoppingCart, LucideBug,
  LucideMapPin, LucideMegaphone, LucideCheckCircle2, LucideMessageCircle,
  LucideList, LucideSearch
} from '@lucide/angular';

/** Leave pages the server lists separately; the sidebar shows them as one "Leaves" entry. */
const LEAVE_MENU_ROUTES = new Set([
  '/attendance/leaves',
  '/attendance/approvals',
  '/attendance/balances',
]);

/** Map a server menu icon name to the rail's icon key. */
const ICON_KEYS: Record<string, string> = {
  lucideLayoutDashboard: 'dashboard', 'check-circle': 'approvals', funnel: 'crm', 'shopping-cart': 'sales',
  lucideKanban: 'delivery', kanban: 'delivery', lucideUsers: 'employees', lucideBriefcase: 'recruitment',
  target: 'performance', lucideCalendarClock: 'attendance', lucideBanknote: 'payroll', building: 'clients',
  lucideBuilding: 'clients', lucideLaptop: 'assets', lucideTrophy: 'appreciation', 'door-open': 'offboarding',
  megaphone: 'notices', 'message-circle': 'chat', lucideSettings: 'settings', bug: 'bug', 'map-pin': 'map',
};

export interface SidebarSubItem {
  id: string;
  title: string;
  route: string;
  badge?: string | number;
  external?: boolean;
}

export interface SidebarModule {
  id: string;
  title: string;
  icon: string;
  route?: string;
  badge?: number;
  status?: 'LIVE' | 'WIP';
  sectionTitle?: string;
  items: SidebarSubItem[];
}

@Component({
  selector: 'app-sidebar-v2',
  standalone: true,
  imports: [
    CommonModule,
    LucideLayoutDashboard, LucideUsers, LucideBriefcase, LucideCalendarClock,
    LucideBanknote, LucideLaptop, LucideSettings, LucideChevronDown,
    LucideChevronRight, LucideChevronLeft, LucideUser, LucideTrophy,
    LucideKanban, LucideLogOut, LucideX, LucideBuilding, LucideTarget,
    LucideDoorOpen, LucideFunnel, LucideShoppingCart, LucideBug,
    LucideMapPin, LucideMegaphone, LucideCheckCircle2, LucideMessageCircle,
    LucideList, LucideSearch
  ],
  templateUrl: './sidebar-v2.html',
  styleUrls: ['./sidebar-v2.css']
})
export class SidebarComponentV2 implements OnInit {
  private authService = inject(AuthService);
  public router = inject(Router);
  private toast = inject(HotToastService);
  readonly layout = inject(LayoutService);

  private menusService = inject(MenusService);

  user = signal<any>(null);
  isLoading = signal<boolean>(true);
  /** The second panel is closed by default and opens for modules that have sub-pages. */
  isDrawerCollapsed = signal<boolean>(true);
  activeModuleId = signal<string>('');
  viewMode = signal<'single' | 'tree'>('single');
  searchFilter = signal<string>('');
  showLogoutModal = signal<boolean>(false);
  logoFailed = signal<boolean>(false);
  /** Current path, so the active sub-page follows navigation. */
  private currentPath = signal<string>('');

  /**
   * Modules and their pages come from the server menu (role-filtered, same
   * names as the pages themselves) — never a hand-written list, which drifted
   * from the real tabs and showed every user every module.
   */
  modules: SidebarModule[] = [];
  settingsModule: SidebarModule | null = null;

  currentActiveModule = computed(() => {
    const id = this.activeModuleId();
    if (this.settingsModule && id === this.settingsModule.id) return this.settingsModule;
    return this.modules.find(m => m.id === id) ?? null;
  });

  /** The one sub-page that matches the current URL best (longest route prefix), so only one is ever highlighted. */
  activeSubId = computed(() => {
    const path = this.currentPath();
    let best: SidebarSubItem | null = null;
    for (const mod of [...this.modules, ...(this.settingsModule ? [this.settingsModule] : [])]) {
      for (const sub of mod.items) {
        if (!sub.route || sub.external) continue;
        const hit = path === sub.route || path.startsWith(sub.route + '/')
          || (sub.id === 'attendance/leaves' && LEAVE_MENU_ROUTES.has(path));
        if (hit && (!best || sub.route.length > best.route.length)) best = sub;
      }
    }
    return best?.id ?? null;
  });

  filteredActiveItems = computed(() => {
    const mod = this.currentActiveModule();
    if (!mod) return [];
    const term = this.searchFilter().trim().toLowerCase();
    if (!term) return mod.items;
    return mod.items.filter(item => item.title.toLowerCase().includes(term));
  });

  filteredTreeModules = computed(() => {
    const term = this.searchFilter().trim().toLowerCase();
    const withPages = this.modules.filter(m => m.items.length);
    if (!term) return withPages;
    return withPages
      .map(mod => ({
        ...mod,
        items: mod.items.filter(item =>
          item.title.toLowerCase().includes(term) || mod.title.toLowerCase().includes(term)
        )
      }))
      .filter(mod => mod.items.length > 0);
  });

  /** The panel shows only when open and the module has pages to list (or the all-modules view is on). */
  drawerVisible = computed(() => !this.isDrawerCollapsed()
    && (this.viewMode() === 'tree' || !!this.currentActiveModule()?.items.length));

  private bodyClassSync = effect(() => {
    document.body.classList.toggle('sidebar-collapsed', !this.drawerVisible());
  });

  /** Hover/focus label for rail icons (fixed-position, so the scrolling rail can't clip it). */
  railTip = signal<{ text: string; top: number; left: number } | null>(null);

  showRailTip(event: Event) {
    const el = (event.target as HTMLElement)?.closest?.('[data-label]') as HTMLElement | null;
    if (!el) { this.railTip.set(null); return; }
    const r = el.getBoundingClientRect();
    this.railTip.set({ text: el.dataset['label'] || '', top: r.top + r.height / 2, left: r.right + 10 });
  }

  hideRailTip() {
    this.railTip.set(null);
  }

  onLogoError() {
    this.logoFailed.set(true);
  }

  private loadMenus() {
    this.menusService.getSidebarMenus().subscribe({
      next: (sections) => {
        const all: SidebarModule[] = [];
        for (const section of sections || []) {
          for (const item of section.items || []) all.push(this.toModule(item));
        }
        this.settingsModule = all.find(m => m.icon === 'settings' || m.title.toLowerCase() === 'settings') ?? null;
        this.modules = all.filter(m => m !== this.settingsModule);
        this.isLoading.set(false);
        this.updateActiveModuleFromUrl(this.router.url);
      },
      error: () => {
        this.toast.error('Failed to load menu');
        this.isLoading.set(false);
      },
    });
  }

  /** Server menu item → rail module. Leave pages fold into one "Leaves" entry. */
  private toModule(item: any): SidebarModule {
    let subs: SidebarSubItem[] = (item.subItems || []).map((s: any) => ({
      id: s.id, title: s.title, route: s.route, external: !!s.external,
    }));
    if (item.id === 'recruitment' && subs.some(s => s.route === '/recruitment/candidates') && !subs.some(s => s.route === '/recruitment/offer-letters')) {
      subs.push({ id: 'recruitment/offer-letters', title: 'Offer Letters', route: '/recruitment/offer-letters' });
    }
    const leaves = subs.filter(s => LEAVE_MENU_ROUTES.has(s.route));
    if (leaves.length) {
      const at = subs.findIndex(s => LEAVE_MENU_ROUTES.has(s.route));
      subs = subs.filter(s => !LEAVE_MENU_ROUTES.has(s.route));
      subs.splice(at, 0, { id: 'attendance/leaves', title: 'Leaves', route: '/attendance/leaves' });
    }
    return {
      id: item.id,
      title: item.title,
      icon: ICON_KEYS[item.icon] ?? 'dashboard',
      route: item.route ?? subs[0]?.route,
      items: subs,
    };
  }

  constructor() {
    this.authService.getMe().subscribe({
      next: (user) => {
        this.user.set(user);
        this.loadMenus();
      },
      error: () => this.isLoading.set(false)
    });
  }

  ngOnInit() {
    // Closed unless the person left it open last time.
    if (localStorage.getItem('sidebar_collapsed') === 'false') this.isDrawerCollapsed.set(false);
    this.currentPath.set(this.router.url.split('?')[0]);

    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: any) => {
      this.updateActiveModuleFromUrl(event.urlAfterRedirects);
      this.closeMobileNav();
    });
  }

  /** Active module = the one owning the best-matching page (or whose own route matches). */
  updateActiveModuleFromUrl(url: string) {
    const path = url.split('?')[0];
    this.currentPath.set(path);
    const all = [...this.modules, ...(this.settingsModule ? [this.settingsModule] : [])];
    const subId = this.activeSubId();
    const owner = all.find(m => m.items.some(s => s.id === subId))
      ?? all.find(m => m.route && (path === m.route || path.startsWith(m.route + '/')))
      ?? (path === '/' ? all.find(m => m.route === '/dashboard') : undefined);
    if (owner) this.activeModuleId.set(owner.id);
  }

  /** A module with sub-pages opens the panel; one without just navigates. */
  onSelectModule(mod: SidebarModule | null) {
    if (!mod) return;
    if (!mod.items.length || (mod.items.length === 1 && !mod.items[0].external)) {
      const route = mod.items[0]?.route ?? mod.route;
      if (route) this.router.navigate([route]);
      this.setDrawer(true);
      return;
    }
    if (this.activeModuleId() === mod.id && !this.isDrawerCollapsed()) {
      this.setDrawer(true);
      return;
    }
    this.activeModuleId.set(mod.id);
    this.viewMode.set('single');
    this.setDrawer(false);
  }

  toggleDrawer() {
    this.setDrawer(!this.isDrawerCollapsed());
  }

  private setDrawer(collapsed: boolean) {
    this.isDrawerCollapsed.set(collapsed);
    localStorage.setItem('sidebar_collapsed', String(collapsed));
  }

  toggleViewMode() {
    this.viewMode.set(this.viewMode() === 'single' ? 'tree' : 'single');
  }

  onSearchInput(event: Event) {
    const val = (event.target as HTMLInputElement).value;
    this.searchFilter.set(val);
  }

  onItemClick(item: SidebarSubItem, event: Event) {
    if (item.external || item.route === '/careers') {
      let route = item.route;
      // The public careers page is addressed by the company id.
      if (item.route === '/careers' && this.user()?.companyId) route = `/careers/${btoa(String(this.user().companyId))}`;
      window.open(route, '_blank');
      return;
    }
    // Ctrl/Cmd-click or middle-click: let the browser open the link in a new tab.
    if (event instanceof MouseEvent && (event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1)) return;
    event.preventDefault();
    if (item.route) {
      this.router.navigate([item.route]);
    }
    this.closeMobileNav();
  }

  isSubItemActive(item: SidebarSubItem): boolean {
    return !!item && item.id === this.activeSubId();
  }

  getUserInitials(): string {
    const u = this.user();
    if (u?.employee?.firstName && u?.employee?.lastName) {
      return (u.employee.firstName[0] + u.employee.lastName[0]).toUpperCase();
    }
    if (u?.email) {
      const namePart = u.email.split('@')[0];
      const segments = namePart.split('.');
      if (segments.length >= 2) {
        return (segments[0][0] + segments[1][0]).toUpperCase();
      }
      return namePart.substring(0, 2).toUpperCase();
    }
    return 'MS';
  }

  closeMobileNav() {
    this.layout.closeMobileNav();
  }

  goToProfile() {
    if (this.user()?.employee?.id) {
      this.router.navigate(['/employees', this.user().employee.id, 'profile']);
    } else {
      this.promptLogout();
    }
  }

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
    this.router.navigate(['/login']);
  }
}
