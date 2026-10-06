import { Component, inject, signal, effect, OnInit, ViewChild, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, NavigationEnd, RouterModule } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';
import { NotificationsService } from '../../services/notifications.service';
import { AttendanceService } from '../../services/attendance';
import { TicketService } from '../../services/ticket.service';
import { SpotlightSearchComponent } from '../../shared/components/spotlight-search/spotlight-search.component';
import { LayoutService } from '../../services/layout.service';
import {
  LucideSearch, LucideBell, LucideUser, LucideLogOut,
  LucideSettings, LucideCheck, LucideChevronDown, LucideX, LucideKanban, LucideClock,
  LucidePlay, LucideSquare, LucideLoader2, LucideLock, LucideEye, LucideEyeOff, LucideTicket,
  LucideArrowRight, LucideMenu
} from '@lucide/angular';
import { HotToastService } from '@ngneat/hot-toast';
import { DialogService } from '../../shared/services/dialog.service';
import { GeolocationService } from '../../shared/services/geolocation.service';
import { OutsideOfficeAnswer, OutsideOfficeService } from '../../shared/services/outside-office.service';
import { UploadService } from '../../services/upload.service';
import { PushNotificationsService } from '../../services/push-notifications.service';
import { ProjectsService } from '../../services/projects';

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
    LucideArrowRight, LucideMenu
  ],
  templateUrl: './header.html',
  styleUrls: ['./header.css']
})
export class HeaderComponent implements OnInit, OnDestroy {
  /** Drives the phone navigation; the rail itself reads the same state. */
  readonly layout = inject(LayoutService);

  private router = inject(Router);
  private authService = inject(AuthService);
  private attendanceService = inject(AttendanceService);
  private ticketService = inject(TicketService);
  private toast = inject(HotToastService);
  private dialog = inject(DialogService);
  private geo = inject(GeolocationService);
  private outsideOffice = inject(OutsideOfficeService);
  private uploadService = inject(UploadService);
  private push = inject(PushNotificationsService);
  private projectsService = inject(ProjectsService);
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
  activeTaskTimer = signal<{ projectId: number; issueId: number; taskKey: string; taskTitle: string } | null>(null);
  isTaskTimerModalOpen = signal(false);
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

    // Silent: only re-registers a browser that has already said yes. Not
    // redundant — FCM rotates registration tokens on its own schedule, so a
    // browser that registered once and never again quietly stops receiving
    // anything. Never prompts; that is pushPrompt() below, behind a click.
    void this.push.resumeIfAlreadyGranted();
  }

  // ── push notifications ───────────────────────────────────────────────────

  /**
   * Offer to turn on push, but only where the offer is still live.
   *
   * Hidden once the answer is known either way. `denied` is sticky — the
   * browser will not re-prompt and only the site settings panel can undo it —
   * so a button that silently does nothing is worse than no button.
   */
  get canOfferPush(): boolean {
    return this.push.permission === 'default';
  }

  async enablePush() {
    const ok = await this.push.enable();
    this.toast[ok ? 'success' : 'error'](
      ok
        ? 'Shift reminders will now reach you even with this tab closed.'
        : 'Notifications were not enabled. You can turn them on in your browser’s site settings.',
    );
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
      this.projectsService.getMyActiveTimer().subscribe({
        next: (timer) => {
          if (timer) {
            this.activeTaskTimer.set(timer);
            this.isTaskTimerModalOpen.set(true);
            this.isClocking.set(false);
            return;
          }
          this.executeClock('clockOut');
        },
        error: () => {
          this.toast.error('Could not check the active task timer. Please try clocking out again.');
          this.isClocking.set(false);
        },
      });
    } else {
      this.executeClock('clockIn');
    }
  }

  closeTaskTimerModal(): void {
    if (this.isClocking()) return;
    this.isTaskTimerModalOpen.set(false);
    this.activeTaskTimer.set(null);
  }

  resolveTaskTimerAndClockOut(action: 'pause' | 'stop'): void {
    const timer = this.activeTaskTimer();
    if (!timer || this.isClocking()) return;
    this.isClocking.set(true);
    this.projectsService.stopTime(timer.projectId, timer.issueId).subscribe({
      next: () => {
        this.isTaskTimerModalOpen.set(false);
        this.activeTaskTimer.set(null);
        this.toast.success(action === 'pause' ? 'Task timer paused' : 'Task timer stopped');
        this.executeClock('clockOut');
      },
      error: (err) => {
        this.toast.error(err?.error?.message || 'Could not stop the task timer.');
        this.isClocking.set(false);
      },
    });
  }

  /**
   * Two refusals the server sends that are instructions, not errors.
   *
   * Both arrive as a 400 carrying a stable `code`, because matching on the
   * message text would break the first time somebody rewords it. See
   * OpenSessionError / LateClockOutError on the server.
   */
  private static readonly OPEN_PREVIOUS_SESSION = 'OPEN_PREVIOUS_SESSION';
  private static readonly LATE_REASON_REQUIRED = 'LATE_CLOCK_OUT_REASON_REQUIRED';

  private executeClock(
    action: 'clockIn' | 'clockOut', reason?: string, proofUrl?: string,
    outside?: OutsideOfficeAnswer,
  ) {
    const proceed = (lat?: number, lng?: number) => {
      const sub = action === 'clockIn'
        ? this.attendanceService.clockIn(lat, lng, outside?.reason, outside?.proofUrl)
        : this.attendanceService.clockOut(lat, lng, reason, proofUrl, outside?.reason, outside?.proofUrl);

      sub.subscribe({
        next: () => {
          this.toast.success(
            (action === 'clockIn' ? 'Clocked in successfully' : 'Clocked out successfully')
              + (outside ? ' — sent for admin review (outside office)' : ''),
          );
          this.checkTodayAttendance();
          this.isClocking.set(false);
        },
        error: (err) => {
          const body = err?.error ?? {};

          // "You still have yesterday open." Offer to close it rather than
          // showing a dead end — it is the only way forward, and the user
          // cannot reach that day from this button otherwise.
          if (body.code === HeaderComponent.OPEN_PREVIOUS_SESSION) {
            this.isClocking.set(false);
            void this.offerToCloseOpenSession(body.openSessionDate, body.message);
            return;
          }

          // "That is a previous day — why are you closing it now?" Ask, then
          // retry the same clock-out with the answer attached.
          if (body.code === HeaderComponent.LATE_REASON_REQUIRED) {
            this.isClocking.set(false);
            void this.askLateClockOutReason(body.openSessionDate);
            return;
          }

          // B3: outside the office radius on a General Shift day. Ask why,
          // then send the same clock again with the answer.
          if (this.outsideOffice.isOutsideOffice(err)) {
            this.isClocking.set(false);
            void this.outsideOffice.ask(err).then((ans) => {
              if (!ans) return;
              this.isClocking.set(true);
              this.executeClock(action, reason, proofUrl, ans);
            });
            return;
          }

          this.toast.error(body.message || `Failed to ${action === 'clockIn' ? 'clock in' : 'clock out'}`);
          this.isClocking.set(false);
        }
      });
    };

    // Bounded, retried, and explained — see GeolocationService for why a bare
    // getCurrentPosition hangs or silently drops the location in Safari. Still
    // lets the person continue without one, in which case the server decides:
    // an office (General Shift) day answers with the reason box, any other
    // shift clocks as normal.
    void this.geo.locateForClock().then(({ lat, lng }) => proceed(lat, lng));
  }

  /**
   * A clock-in was refused because an earlier day is still open.
   *
   * Closing that day is the only thing that unblocks them, and this button is
   * the only clock control on the screen, so the offer is made here rather than
   * leaving them to work out that "clock out" now means something else.
   */
  private async offerToCloseOpenSession(openDate: string | undefined, message: string) {
    const ok = await this.dialog.confirm(
      message,
      openDate ? `Session still open from ${this.formatDay(openDate)}` : 'Session still open',
      'Clock out from that shift',
      'Not now',
    );
    if (!ok) return;

    this.isClocking.set(true);
    // No reason yet: the server decides whether this counts as a previous day,
    // and answers with LATE_CLOCK_OUT_REASON_REQUIRED if it does. Guessing here
    // would mean two implementations of "after midnight".
    this.executeClock('clockOut');
  }

  /**
   * Ask why a previous day is being closed now, then retry with the answer.
   *
   * §Att4 adds proof beside the reason, and §Att5 means the answer now goes to
   * somebody: the day is closed but does not count until it is approved, so
   * the dialog says so rather than letting the clock-out look final.
   */
  private async askLateClockOutReason(openDate: string | undefined) {
    const day = openDate ? this.formatDay(openDate) : 'a previous day';
    const answer = await this.dialog.promptWithAttachment(
      `You are clocking out for ${day}. Please say why — it is saved against that day's record and sent for approval, and the day does not count as attended until it is approved.`,
      'Reason for late clock-out',
      {
        placeholder: 'e.g. Left the site in a hurry and forgot to clock out',
        confirmLabel: 'Clock out',
        required: true,
        accept: 'image/*,application/pdf',
        attachmentLabel: 'Attach a screenshot or photo (optional)',
        attachmentHint: 'Anything that backs up the reason — a ticket, a site photo, a message. Up to 10 MB.',
      },
    );
    if (!answer) return;

    this.isClocking.set(true);

    // No file: nothing to wait for.
    if (!answer.file) {
      this.executeClock('clockOut', answer.text);
      return;
    }

    // The upload has to finish first — the clock-out carries the URL, and
    // there is no second call to attach it afterwards. A failed upload must
    // not silently drop the proof, so it asks rather than deciding for them.
    this.uploadService.uploadAttendanceProof(answer.file).subscribe({
      next: (res: any) => {
        const url = res?.url ?? res?.path ?? res?.location ?? null;
        this.executeClock('clockOut', answer.text, url ?? undefined);
      },
      error: async () => {
        this.isClocking.set(false);
        const ok = await this.dialog.confirm(
          'The attachment could not be uploaded. Clock out with just the reason, or cancel and try again?',
          'Attachment failed',
          'Clock out without it',
          'Cancel',
        );
        if (!ok) return;
        this.isClocking.set(true);
        this.executeClock('clockOut', answer.text);
      },
    });
  }

  /** "2026-09-14" → "14 Sep 2026". */
  private formatDay(iso: string): string {
    const d = new Date(`${iso}T00:00:00`);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
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

  dismissNotification(event: Event, id: number) {
    event.stopPropagation();
    this.notificationsService.dismissNotification(id);
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

    this.isChangingPassword.set(true);
    this.authService.changePassword(this.newPassword).subscribe({
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
