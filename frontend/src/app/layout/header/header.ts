import { Component, inject, signal, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, NavigationEnd, RouterModule } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';
import { NotificationsService } from '../../services/notifications.service';
import { SpotlightSearchComponent } from '../../shared/components/spotlight-search/spotlight-search.component';
import { 
  LucideSearch, LucideBell, LucidePlus, LucideUser, LucideLogOut, 
  LucideSettings, LucideCheck, LucideChevronDown, LucideFileText, LucideBriefcase, LucideX, LucideKanban
} from '@lucide/angular';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule,
    RouterModule,
    SpotlightSearchComponent,
    LucideSearch, LucideBell, LucidePlus, LucideUser, LucideLogOut, 
    LucideSettings, LucideCheck, LucideChevronDown, LucideFileText, LucideBriefcase, LucideX, LucideKanban
  ],
  templateUrl: './header.html',
  styleUrls: ['./header.css']
})
export class HeaderComponent implements OnInit {
  private router = inject(Router);
  private authService = inject(AuthService);
  notificationsService = inject(NotificationsService);

  @ViewChild(SpotlightSearchComponent) spotlightSearch!: SpotlightSearchComponent;

  currentUser = this.authService.currentUser;
  pageTitle = signal<string>('Dashboard');

  isNotificationOpen = signal<boolean>(false);
  isProfileMenuOpen = signal<boolean>(false);
  isQuickCreateOpen = signal<boolean>(false);

  ngOnInit() {
    this.updateTitle(this.router.url);
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: any) => {
      this.updateTitle(event.urlAfterRedirects);
    });
  }

  openSpotlight() {
    if (this.spotlightSearch) {
      this.spotlightSearch.open();
    }
  }

  private updateTitle(url: string) {
    if (url.includes('/payroll')) {
      this.pageTitle.set('Payroll & Compensation');
    } else if (url.includes('/employees/directory')) {
      this.pageTitle.set('Employee Directory');
    } else if (url.includes('/employees/onboarding')) {
      this.pageTitle.set('Onboarding');
    } else if (url.includes('/employees/org-chart')) {
      this.pageTitle.set('Organization Chart');
    } else if (url.includes('/employees/documents')) {
      this.pageTitle.set('Employee Documents Center');
    } else if (url.includes('/employees/') && url.includes('/profile')) {
      this.pageTitle.set('Employee Profile');
    } else if (url.includes('/attendance')) {
      this.pageTitle.set('Attendance & Leave Management');
    } else if (url.includes('/settings/master-data')) {
      this.pageTitle.set('Master Data Management');
    } else if (url.includes('/settings/company')) {
      this.pageTitle.set('Company Profile');
    } else if (url.includes('/appreciation')) {
      this.pageTitle.set('Appreciation & Awards');
    } else if (url.includes('/settings/permissions')) {
      this.pageTitle.set('Roles & Permissions');
    } else {
      this.pageTitle.set('Dashboard');
    }
  }

  toggleNotifications() {
    this.isNotificationOpen.set(!this.isNotificationOpen());
    this.isProfileMenuOpen.set(false);
    this.isQuickCreateOpen.set(false);
  }

  toggleProfileMenu() {
    this.isProfileMenuOpen.set(!this.isProfileMenuOpen());
    this.isNotificationOpen.set(false);
    this.isQuickCreateOpen.set(false);
  }

  toggleQuickCreate() {
    this.isQuickCreateOpen.set(!this.isQuickCreateOpen());
    this.isNotificationOpen.set(false);
    this.isProfileMenuOpen.set(false);
  }

  markAllAsRead() {
    this.notificationsService.markAllAsRead();
  }

  markSingleAsRead(id: number) {
    this.notificationsService.markAsRead(id);
  }

  getUserInitials(): string {
    const u = this.currentUser();
    if (!u) return 'U';
    const fn = (u.employee?.firstName || u.firstName || '').charAt(0).toUpperCase();
    const ln = (u.employee?.lastName || u.lastName || '').charAt(0).toUpperCase();
    return (fn + ln) || 'U';
  }

  getUserRoleLabel(): string {
    const u = this.currentUser();
    if (!u) return 'Employee';
    const r = u.role || 'EMPLOYEE';
    if (r === 'SUPER_ADMIN' || r === 'ADMIN') return 'Administrator';
    if (r === 'HR_MANAGER') return 'HR Manager';
    return 'Team Member';
  }

  hasAccessToDirectory(): boolean {
    const role = this.currentUser()?.role || '';
    return ['ADMIN', 'SUPER_ADMIN', 'HR_MANAGER'].includes(role);
  }

  logout() {
    this.authService.logout();
    this.router.navigate(['/']);
  }
}
