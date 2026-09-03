import { Component, inject, signal, effect, OnInit, ViewChild, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, NavigationEnd, RouterModule } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';
import { NotificationsService } from '../../services/notifications.service';
import { AttendanceService } from '../../services/attendance';
import { EmployeeService } from '../../services/employee.service';
import { TicketService } from '../../services/ticket.service';
import { SpotlightSearchComponent } from '../../shared/components/spotlight-search/spotlight-search.component';
import {
  LucideSearch, LucideBell, LucideUser, LucideLogOut,
  LucideSettings, LucideCheck, LucideChevronDown, LucideX, LucideKanban, LucideClock,
  LucidePlay, LucideSquare, LucideLoader2, LucideLock, LucideEye, LucideEyeOff, LucideTicket,
  LucideArrowRight
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
    LucideSearch, LucideBell, LucideUser, LucideLogOut,
    LucideChevronDown, LucideX, LucideKanban, LucideClock,
    LucidePlay, LucideSquare, LucideLoader2, LucideLock, LucideEye, LucideEyeOff, LucideTicket,
    LucideArrowRight
  ],
  templateUrl: './header.html',
  styleUrls: ['./header.css']
})
export class HeaderComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private authService = inject(AuthService);
  private attendanceService = inject(AttendanceService);
  private employeeService = inject(EmployeeService);
  private ticketService = inject(TicketService);
  private toast = inject(HotToastService);
  notificationsService = inject(NotificationsService);

  // Change Password Modal
  isChangePasswordModalOpen = signal<boolean>(false);
  isChangingPassword = signal<boolean>(false);
  showNewPassword = signal<boolean>(false);
  showConfirmPassword = signal<boolean>(false);
  newPassword = '';
  confirmPassword = '';

  @ViewChild(SpotlightSearchComponent) spotlightSearch!: SpotlightSearchComponent;

  currentUser = this.authService.currentUser;
  pageTitle = signal<string>('Dashboard');

  isNotificationOpen = signal<boolean>(false);
  isProfileMenuOpen = signal<boolean>(false);

  // Systray Attendance
  isClockedIn = signal<boolean>(false);
  isClocking = signal<boolean>(false);
  clockInTime = signal<Date | null>(null);
  timerStr = signal<string>('00:00:00');
  totalHoursStr = signal<string>('');
  private timerInterval: any;

  // Open-ticket indicator — only meaningful for the dev team and management,
  // who are the ones expected to act on incoming tickets.
  canSeeTicketAlerts = signal<boolean>(false);
  openTicketCount = signal<number>(0);

  /**
   * Ticket events now produce real notifications, so an arriving notification is
   * the cue that the open count may have moved. This replaces the old 60-second
   * poll and reacts faster than it did. Declared as a field so it runs inside
   * the injection context — effect() throws NG0203 from ngOnInit.
   */
  private seenNotificationCount = 0;
  private notificationWatcher = effect(() => {
    const count = this.notificationsService.notifications().length;
    if (count > this.seenNotificationCount) this.refreshTicketCount();
    this.seenNotificationCount = count;
  });

  ngOnInit() {
    this.updateTitle(this.router.url);
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: any) => {
      this.updateTitle(event.urlAfterRedirects);
      // Leaving the helpdesk is when the count is most likely stale.
      if (event.urlAfterRedirects?.startsWith('/crm/tickets')) this.refreshTicketCount();
    });

    this.checkTodayAttendance();
    this.initTicketAlerts();
  }

  ngOnDestroy() {
    if (this.timerInterval) clearInterval(this.timerInterval);
  }

  // ─── Ticket alerts ─────────────────────────────────────────────────────────

  private initTicketAlerts() {
    this.ticketService.getMyPermissions().subscribe({
      next: (p) => {
        if (!p.canManage) return;
        this.canSeeTicketAlerts.set(true);
        this.refreshTicketCount();
      },
      error: () => { /* helpdesk unavailable — leave the indicator hidden */ },
    });
  }

  private refreshTicketCount() {
    if (!this.canSeeTicketAlerts()) return;
    this.ticketService.getStats().subscribe({
      next: (s) => this.openTicketCount.set(s.open ?? 0),
      error: () => { /* keep the last known count */ },
    });
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
      this.executeClock('clockOut');
    } else {
      this.executeClock('clockIn');
    }
  }

  private executeClock(action: 'clockIn' | 'clockOut') {
    const proceed = (lat?: number, lng?: number) => {
      const sub = action === 'clockIn'
        ? this.attendanceService.clockIn(lat, lng)
        : this.attendanceService.clockOut(lat, lng);

      sub.subscribe({
        next: () => {
          this.toast.success(action === 'clockIn' ? 'Clocked in successfully' : 'Clocked out successfully');
          this.checkTodayAttendance();
          this.isClocking.set(false);
        },
        error: (err) => {
          this.toast.error(err.error?.message || `Failed to ${action === 'clockIn' ? 'clock in' : 'clock out'}`);
          this.isClocking.set(false);
        }
      });
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => proceed(position.coords.latitude, position.coords.longitude),
        (error) => {
          this.toast.error('Location access is required to clock in/out. Please enable location access and try again.');
          this.isClocking.set(false);
        }
      );
    } else {
      this.toast.error('Location access is required to clock in/out. Your browser does not support location access.');
      this.isClocking.set(false);
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
  }

  toggleProfileMenu() {
    this.isProfileMenuOpen.set(!this.isProfileMenuOpen());
    this.isNotificationOpen.set(false);
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
    if (r === 'SUPERADMIN' || r === 'ADMIN') return 'Administrator';
    if (r === 'HR') return 'HR Manager';
    if (r === 'FINANCE') return 'Finance';
    if (r === 'SALES') return 'Sales';
    return 'Team Member';
  }

  logout() {
    this.authService.logout();
    this.router.navigate(['/']);
  }

  openChangePasswordModal() {
    this.newPassword = '';
    this.confirmPassword = '';
    this.showNewPassword.set(false);
    this.showConfirmPassword.set(false);
    this.isChangePasswordModalOpen.set(true);
    this.isProfileMenuOpen.set(false);
  }

  closeChangePasswordModal() {
    this.isChangePasswordModalOpen.set(false);
  }

  submitChangePassword() {
    if (!this.newPassword || this.newPassword.length < 8) {
      this.toast.error('Password must be at least 8 characters');
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.toast.error('Passwords do not match');
      return;
    }

    const employeeId = this.currentUser()?.employee?.id;
    if (!employeeId) {
      this.toast.error('Could not determine your employee profile');
      return;
    }

    this.isChangingPassword.set(true);
    this.employeeService.updateProfile(employeeId, { password: this.newPassword }).subscribe({
      next: () => {
        this.toast.success('Password reset successfully');
        this.isChangingPassword.set(false);
        this.closeChangePasswordModal();
      },
      error: (err) => {
        this.toast.error(err.error?.message || 'Failed to reset password');
        this.isChangingPassword.set(false);
      }
    });
  }
}
