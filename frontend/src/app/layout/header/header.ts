import { Component, inject, signal, OnInit, ViewChild, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, NavigationEnd, RouterModule } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';
import { NotificationsService } from '../../services/notifications.service';
import { AttendanceService } from '../../services/attendance';
import { SpotlightSearchComponent } from '../../shared/components/spotlight-search/spotlight-search.component';
import { 
  LucideSearch, LucideBell, LucidePlus, LucideUser, LucideLogOut, 
  LucideSettings, LucideCheck, LucideChevronDown, LucideFileText, LucideBriefcase, LucideX, LucideKanban, LucideClock,
  LucidePlay, LucideSquare, LucideLoader2
} from '@lucide/angular';
import { HotToastService } from '@ngneat/hot-toast';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule,
    RouterModule,
    SpotlightSearchComponent,
    LucideSearch, LucideBell, LucidePlus, LucideUser, LucideLogOut, 
    LucideChevronDown, LucideFileText, LucideBriefcase, LucideX, LucideKanban, LucideClock,
    LucidePlay, LucideSquare, LucideLoader2
  ],
  templateUrl: './header.html',
  styleUrls: ['./header.css']
})
export class HeaderComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private authService = inject(AuthService);
  private attendanceService = inject(AttendanceService);
  private toast = inject(HotToastService);
  notificationsService = inject(NotificationsService);

  @ViewChild(SpotlightSearchComponent) spotlightSearch!: SpotlightSearchComponent;

  currentUser = this.authService.currentUser;
  pageTitle = signal<string>('Dashboard');

  isNotificationOpen = signal<boolean>(false);
  isProfileMenuOpen = signal<boolean>(false);
  isQuickCreateOpen = signal<boolean>(false);

  // Systray Attendance
  isClockedIn = signal<boolean>(false);
  isClocking = signal<boolean>(false);
  clockInTime = signal<Date | null>(null);
  timerStr = signal<string>('00:00:00');
  totalHoursStr = signal<string>('');
  private timerInterval: any;

  ngOnInit() {
    this.updateTitle(this.router.url);
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: any) => {
      this.updateTitle(event.urlAfterRedirects);
    });

    this.checkTodayAttendance();
  }

  ngOnDestroy() {
    if (this.timerInterval) clearInterval(this.timerInterval);
  }

  checkTodayAttendance() {
    this.attendanceService.getTodayAttendance().subscribe({
      next: (res) => {
        if (res && res.clockIn && !res.clockOut) {
          this.isClockedIn.set(true);
          this.clockInTime.set(new Date(res.clockIn));
          this.totalHoursStr.set('');
          this.startTimer();
        } else {
          this.isClockedIn.set(false);
          this.clockInTime.set(null);
          if (this.timerInterval) clearInterval(this.timerInterval);
          if (res && res.clockIn && res.clockOut) {
            this.timerStr.set('');
            const total = res.totalHours || (new Date(res.clockOut).getTime() - new Date(res.clockIn).getTime()) / 3600000;
            const hrs = Math.floor(total);
            const mins = Math.round((total - hrs) * 60);
            this.totalHoursStr.set(`${hrs}h ${mins}m`);
          } else {
            this.timerStr.set('00:00:00');
            this.totalHoursStr.set('');
          }
        }
      },
      error: () => {
        this.isClockedIn.set(false);
      }
    });
  }

  startTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      const inTime = this.clockInTime();
      if (!inTime) return;
      let diff = new Date().getTime() - inTime.getTime();
      if (diff < 0) diff = 0;
      const hrs = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      this.timerStr.set(`${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
    }, 1000);
  }

  toggleClock() {
    if (this.isClocking()) return;
    this.isClocking.set(true);
    if (this.isClockedIn()) {
      this.attendanceService.clockOut().subscribe({
        next: () => {
          this.toast.success('Clocked out successfully');
          this.checkTodayAttendance();
          this.isClocking.set(false);
        },
        error: (err) => {
          this.toast.error(err.error?.message || 'Failed to clock out');
          this.isClocking.set(false);
        }
      });
    } else {
      this.attendanceService.clockIn().subscribe({
        next: () => {
          this.toast.success('Clocked in successfully');
          this.checkTodayAttendance();
          this.isClocking.set(false);
        },
        error: (err) => {
          this.toast.error(err.error?.message || 'Failed to clock in');
          this.isClocking.set(false);
        }
      });
    }
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
