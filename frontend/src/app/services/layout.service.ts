import { Injectable, signal } from '@angular/core';

/**
 * Shell state shared by the header and the sidebar, which are siblings and so
 * cannot talk to each other directly.
 *
 * Only the phone navigation lives here. The desktop collapse (260px ↔ 80px)
 * stays in SidebarComponent because nothing else reacts to it, and it persists
 * to localStorage — whereas an open phone menu should never survive a reload.
 */
@Injectable({ providedIn: 'root' })
export class LayoutService {
  /** True while the off-canvas rail covers the page on a phone. */
  readonly isMobileNavOpen = signal<boolean>(false);
  /**
   * Whether the current page's module has a sub-menu to open (12 Nov 2026).
   * The v2 sidebar sets it; the header hides its menu button on desktop when
   * there is nothing to open (single pages such as Approvals).
   */
  readonly hasSubMenu = signal<boolean>(true);
  readonly isSidebarCollapsed = signal<boolean>(
    typeof localStorage !== 'undefined' ? localStorage.getItem('sidebar_collapsed') === 'true' : false
  );

  toggleSidebar() {
    if (typeof window !== 'undefined' && window.innerWidth <= 1024) {
      this.toggleMobileNav();
      return;
    }
    const currentlyCollapsed = typeof document !== 'undefined' && document.body.classList.contains('sidebar-collapsed');
    const newState = !currentlyCollapsed;
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('sidebar-collapsed', newState);
    }
    this.isSidebarCollapsed.set(newState);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('sidebar_collapsed', String(newState));
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sidebar-toggle', { detail: { collapsed: newState } }));
    }
  }

  toggleMobileNav() {
    this.setMobileNav(!this.isMobileNavOpen());
  }

  closeMobileNav() {
    this.setMobileNav(false);
  }

  private setMobileNav(open: boolean) {
    this.isMobileNavOpen.set(open);
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('sidebar-mobile-open', open);
      document.body.classList.toggle('nav-scroll-lock', open);
    }
  }
}
