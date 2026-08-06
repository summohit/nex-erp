import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, NavigationEnd, RouterModule } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';
import { 
  LucideSearch, LucideBell, LucidePlus, LucideUser, LucideLogOut, 
  LucideSettings, LucideCheck, LucideChevronDown, LucideFileText, LucideBriefcase, LucideX
} from '@lucide/angular';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule,
    RouterModule,
    LucideSearch, LucideBell, LucidePlus, LucideUser, LucideLogOut, 
    LucideSettings, LucideCheck, LucideChevronDown, LucideFileText, LucideBriefcase, LucideX
  ],
  templateUrl: './header.html',
  styleUrls: ['./header.css']
})
export class HeaderComponent implements OnInit {
  private router = inject(Router);
  private authService = inject(AuthService);

  currentUser = this.authService.currentUser;
  pageTitle = signal<string>('Dashboard');

  isNotificationOpen = signal<boolean>(false);
  isProfileMenuOpen = signal<boolean>(false);
  isQuickCreateOpen = signal<boolean>(false);
  globalSearchQuery = signal<string>('');

  notifications = signal<any[]>([
    { id: 1, title: 'Task Assigned', desc: 'You were assigned to issue DEN1-2', time: '10m ago', unread: true },
    { id: 2, title: 'Leave Approved', desc: 'Your annual leave request was approved', time: '1h ago', unread: true },
    { id: 3, title: 'Payslip Ready', desc: 'Your payslip for this month is generated', time: '1d ago', unread: false }
  ]);

  unreadNotificationsCount = signal<number>(2);

  ngOnInit() {
    this.updateTitle(this.router.url);
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: any) => {
      this.updateTitle(event.urlAfterRedirects);
    });
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
    this.notifications.update(list => list.map(n => ({ ...n, unread: false })));
    this.unreadNotificationsCount.set(0);
  }

  getUserInitials(): string {
    const u = this.currentUser();
    if (!u) return 'U';
    const fn = (u.firstName || '').charAt(0).toUpperCase();
    const ln = (u.lastName || '').charAt(0).toUpperCase();
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

  logout() {
    this.authService.logout();
    this.router.navigate(['/']);
  }
}
