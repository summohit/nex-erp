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

  toggleMobileNav() {
    this.setMobileNav(!this.isMobileNavOpen());
  }

  closeMobileNav() {
    this.setMobileNav(false);
  }

  private setMobileNav(open: boolean) {
    this.isMobileNavOpen.set(open);
    // The body class is what the layout padding and the rail's transform read;
    // both sit outside this component tree.
    document.body.classList.toggle('sidebar-mobile-open', open);
    // The page behind a full-height menu must not scroll under it.
    document.body.classList.toggle('nav-scroll-lock', open);
  }
}
