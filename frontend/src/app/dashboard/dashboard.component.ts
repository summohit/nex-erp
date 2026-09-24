import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { NoticesService, Notice } from '../services/notices';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { OnboardingService, EmployeeOnboardingTask } from '../services/onboarding.service';
import { AttendanceService, AttendanceRecord } from '../services/attendance';
import { LeavesService } from '../services/leaves';
import { DashboardService, DashboardPayload } from '../services/dashboard.service';
import { StatCardComponent } from '../shared/components/stat-card/stat-card.component';
import {
  LucideCheckCircle2, LucideCircle, LucideClock,
  LucideFileText, LucideCheckSquare, LucideCalendar, LucideUserCheck,
  LucideAlertCircle, LucideArrowRight, LucideMegaphone,
  LucideShield, LucideAward, LucideBanknote, LucideReceipt, LucideTrendingUp,
  LucideShoppingCart, LucideTarget, LucideCake, LucidePartyPopper, LucideGift,
  LucideSparkles, LucidePlay, LucideSquare, LucideMapPin,
  LucideChevronRight, LucideFolderKanban,
  LucideCheck, LucideX, LucideTicket, LucideUserPlus, LucideTrophy, LucideTimer,
  LucideCalendarDays, LucideRefreshCw, LucideHourglass, LucideCalendarClock,
  LucideAlertTriangle, LucideBell, LucidePaperclip, LucideImage, LucideFileSpreadsheet,
  LucideFile, LucideExternalLink
} from '@lucide/angular';
import { HotToastService } from '@ngneat/hot-toast';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    StatCardComponent,
    LucideCheckCircle2, LucideCircle, LucideClock,
    LucideFileText, LucideCheckSquare, LucideCalendar, LucideUserCheck,
    LucideAlertCircle, LucideArrowRight,
    LucideShield, LucideAward, LucideBanknote, LucideReceipt, LucideTrendingUp,
    LucideShoppingCart, LucideTarget, LucideCake, LucidePartyPopper, LucideGift,
    LucideSparkles, LucidePlay, LucideSquare, LucideMapPin,
    LucideChevronRight, LucideFolderKanban,
    LucideCheck, LucideX, LucideTicket, LucideUserPlus, LucideTrophy, LucideTimer,
    LucideCalendarDays, LucideRefreshCw, LucideHourglass, LucideCalendarClock,
    LucideMegaphone, LucideAlertTriangle, LucideBell, LucidePaperclip, LucideImage,
    LucideFileSpreadsheet, LucideFile, LucideExternalLink
  ],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.css']
})
export class DashboardComponent implements OnInit, OnDestroy {
  // ── Notice board ────────────────────────────────────────────────────────
  private noticesService = inject(NoticesService);

  notices = signal<Notice[]>([]);
  /** The one being shown in the popup, or null. */
  activeNotice = signal<Notice | null>(null);

  unreadNotices = computed(() => this.notices().filter((n) => !n.isRead));

  private loadNotices() {
    this.noticesService.forDashboard().subscribe({
      next: (list) => {
        this.notices.set(list || []);
        // Only HIGH priority interrupts. Everything else waits to be noticed
        // in the list -- a popup for every routine announcement is a popup
        // people learn to dismiss without reading.
        const urgent = (list || []).find((n) => !n.isRead && n.priority === 'HIGH');
        if (urgent) this.activeNotice.set(urgent);
      },
      // Silent: a dashboard that loads without its notices is better than one
      // that greets people with an error.
      error: () => {},
    });
  }

  openNotice(n: Notice) {
    this.activeNotice.set(n);
  }

  /**
   * Dismiss, and remember that this person has seen it.
   *
   * The local state is updated first so the popup closes at once; the request
   * only has to persist what the reader has already been told has happened.
   */
  dismissNotice(n: Notice | null) {
    this.activeNotice.set(null);
    if (!n || n.isRead) return;

    this.notices.update((list) =>
      list.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)),
    );
    this.noticesService.markRead(n.id).subscribe({ error: () => {} });
  }

  getInitials(first?: string, last?: string): string {
    const f = (first || '').trim()[0] || '';
    const l = (last || '').trim()[0] || '';
    return (f + l).toUpperCase() || 'NB';
  }

  getAvatarBg(first?: string, last?: string): string {
    const str = `${first || ''}${last || ''}`.toLowerCase();
    const colors = [
      'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)',
      'linear-gradient(135deg, #10B981 0%, #047857 100%)',
      'linear-gradient(135deg, #6b3fd6 0%, #4f2aa7 100%)',
      'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)',
      'linear-gradient(135deg, #6b3fd6 0%, #6a6b6c 100%)',
      'linear-gradient(135deg, #06B6D4 0%, #0E7490 100%)',
    ];
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  getFileType(fileName?: string): 'pdf' | 'image' | 'spreadsheet' | 'doc' | 'other' {
    const ext = (fileName || '').split('.').pop()?.toLowerCase() || '';
    if (ext === 'pdf') return 'pdf';
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext)) return 'image';
    if (['xlsx', 'xls', 'csv'].includes(ext)) return 'spreadsheet';
    if (['doc', 'docx', 'txt', 'rtf'].includes(ext)) return 'doc';
    return 'other';
  }

  fileSize(bytes?: number | null): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  private authService = inject(AuthService);
  private router = inject(Router);
  private onboardingService = inject(OnboardingService);
  private attendanceService = inject(AttendanceService);
  private leavesService = inject(LeavesService);
  private dashboardService = inject(DashboardService);
  private toast = inject(HotToastService);

  user = signal<any>(null);
  onboardingStatus = signal<string>('COMPLETED');
  onboardingTasks = signal<EmployeeOnboardingTask[]>([]);
  isCompletingTask = signal<number | null>(null);

  todayAttendance = signal<AttendanceRecord | null>(null);
  todayDate = new Date();
  isClocking = signal<boolean>(false);

  // Live Real-Time Clock & Shift Duration
  currentTime = signal<Date>(new Date());
  private clockInterval: any = null;

  greetingText = computed(() => {
    const hour = this.currentTime().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  });

  formattedTime = computed(() => {
    return this.currentTime().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  });

  formattedDate = computed(() => {
    return this.currentTime().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  });

  workedDuration = computed(() => {
    const att = this.todayAttendance();
    if (!att || !att.clockIn) return '0h 0m';
    const start = new Date(att.clockIn).getTime();
    const end = att.clockOut ? new Date(att.clockOut).getTime() : this.currentTime().getTime();
    const diffMs = Math.max(0, end - start);
    const hrs = Math.floor(diffMs / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    return `${hrs}h ${mins}m`;
  });

  // Role Computation
  userRole = computed(() => this.user()?.role || 'EMPLOYEE');
  showOrgWidgets = computed(() => ['SUPERADMIN', 'ADMIN', 'HR'].includes(this.userRole()));
  isHR = computed(() => this.userRole() === 'HR');
  isFinance = computed(() => this.userRole() === 'FINANCE');
  isSales = computed(() => this.userRole() === 'SALES');
  isEmployee = computed(() => this.userRole() === 'EMPLOYEE');

  // Dashboard Data
  dashboard = signal<DashboardPayload | null>(null);
  pendingApprovals = signal<any[]>([]);
  isLoadingMetrics = signal<boolean>(true);
myLeaveBalanceDays = computed(() => {
    const b = (this.dashboard()?.common?.myLeaveBalance || []) as any[];
    const total = b.reduce((s: number, x: any) => s + ((x.allocated || 0) - (x.used || 0)), 0);
    return total % 1 !== 0 ? total.toFixed(1) : String(Math.round(total));
  });

  myOpenTicketsCount = computed(() => {
    const t = this.dashboard()?.common?.myTickets || [];
    return t.filter(x => !['RESOLVED', 'CLOSED', 'CANCELLED'].includes(x.status)).length;
  });

  // ---------------- NEW WIDGET HELPERS ----------------

  shiftDateFormat(d: string) {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  calendarEventsFor(date: string) {
    return (this.dashboard()?.common?.myCalendar?.events || []).filter(e => e.date === date);
  }

  calendarCalendarType(e: string): string {
    const map: Record<string, string> = {
      HOLIDAY: 'holiday',
      BIRTHDAY: 'birthday',
      LEAVE: 'leave',
      SHIFT: 'shift',
      DAY_OFF: 'day_off'
    };
    return map[e] || 'default';
  }

  anyTodayMilestones() {
    const c = this.dashboard()?.common;
    return !!((c?.todayJoinings?.length || 0) + (c?.todayAnniversaries?.length || 0));
  }

  minutesToHm(mins: number) {
    if (!mins) return '0m';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
  }

  weekLogMaxMinutes = computed(() => {
    const days = this.dashboard()?.common?.weekTimelogs?.days || [];
    return Math.max(1, ...days.map(d => d.minutes || 0));
  });

  weekBarHeight(mins: number) {
    return Math.max(8, Math.round((mins / this.weekLogMaxMinutes()) * 100));
  }

  isOverdue(due: string | null | undefined) {
    if (!due) return false;
    return new Date(due) < this.todayDate;
  }

  todayKey = computed(() => {
    const d = this.currentTime();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  daysUntil(date: string | null | undefined) {
    if (!date) return 0;
    const target = new Date(date + 'T00:00:00');
    return Math.max(0, Math.round((target.getTime() - this.todayDate.getTime()) / 86400000));
  }

  appreciationAwardColor(c: string) {
    const colors: Record<string, string> = {
      orange: '#1373e5',
      purple: '#9333ea',
      blue: '#2563eb',
      green: '#059669',
      red: '#1373e5',
      yellow: '#6b3fd6'
    };
    return colors[c] || '#94a3b8';
  }

  ngOnInit() {
    this.loadNotices();

    this.clockInterval = setInterval(() => {
      this.currentTime.set(new Date());
    }, 1000);

    this.authService.getMe().subscribe({
      next: (user) => {
        if (!user.company?.onboardingCompleted) {
          this.router.navigate(['/onboarding']);
          return;
        }
        this.user.set(user);
        this.loadOnboardingTasks();
        this.loadAttendance();
        this.loadDashboard();
      },
      error: () => {
        this.authService.logout();
        this.router.navigate(['/']);
      }
    });
  }

  ngOnDestroy() {
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
      this.clockInterval = null;
    }
  }


  loadDashboard() {
    this.isLoadingMetrics.set(true);
    this.dashboardService.getDashboard().subscribe({
      next: (payload) => {
        this.dashboard.set(payload);
        this.pendingApprovals.set(payload.org?.pendingLeaveApprovals || []);
      },
      error: () => this.toast.error('Failed to load dashboard data'),
      complete: () => this.isLoadingMetrics.set(false)
    });
  }

  loadOnboardingTasks() {
    this.onboardingService.getMyTasks().subscribe({
      next: (res) => {
        this.onboardingStatus.set(res.status);
        this.onboardingTasks.set(res.tasks);
      }
    });
  }

  getCompletedCount(): number {
    return this.onboardingTasks().filter(t => t.isCompleted).length;
  }

  getProgressPercentage(): number {
    const tasks = this.onboardingTasks();
    if (!tasks.length) return 0;
    return Math.round((this.getCompletedCount() / tasks.length) * 100);
  }

  completeTask(task: EmployeeOnboardingTask) {
    if (task.isCompleted || this.isCompletingTask() !== null) return;

    this.isCompletingTask.set(task.id);
    this.onboardingService.completeTask(task.id).subscribe({
      next: (res) => {
        this.toast.success('Task marked as complete!');
        this.isCompletingTask.set(null);

        const tasks = [...this.onboardingTasks()];
        const idx = tasks.findIndex(t => t.id === task.id);
        if (idx !== -1) {
          tasks[idx].isCompleted = true;
          this.onboardingTasks.set(tasks);
        }

        this.onboardingStatus.set(res.newStatus);

        if (res.newStatus === 'COMPLETED') {
          this.toast.success('ðŸŽ‰ You have completed all onboarding tasks!', { duration: 5000 });
        }
      },
      error: () => {
        this.toast.error('Failed to complete task');
        this.isCompletingTask.set(null);
      }
    });
  }

  loadAttendance() {
    this.attendanceService.getTodayAttendance().subscribe({
      next: (res: any) => this.todayAttendance.set(res)
    });
  }

  clockInOut() {
    this.isClocking.set(true);
    const attendance = this.todayAttendance();
    const action = (!attendance || !attendance.clockIn) ? 'clockIn' : 'clockOut';

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          this.executeClockAction(action, position.coords.latitude, position.coords.longitude);
        },
        (error) => {
          this.toast.error('Location access denied. Clocking in without location.');
          this.executeClockAction(action);
        }
      );
    } else {
      this.executeClockAction(action);
    }
  }

  private executeClockAction(action: 'clockIn' | 'clockOut', lat?: number, lng?: number) {
    const sub = action === 'clockIn'
      ? this.attendanceService.clockIn(lat, lng)
      : this.attendanceService.clockOut(lat, lng);

    sub.subscribe({
      next: (res) => {
        this.toast.success(`Successfully ${action === 'clockIn' ? 'Clocked In' : 'Clocked Out'}!`);
        this.todayAttendance.set(res);
        this.isClocking.set(false);
      },
      error: (err) => {
        this.toast.error(err.error?.message || 'Failed to clock action');
        this.isClocking.set(false);
      }
    });
  }

  approveLeave(reqId: number) {
    this.leavesService.updateRequestStatus(reqId, 'APPROVED').subscribe({
      next: () => {
        this.toast.success('Leave request approved!');
        this.pendingApprovals.update(list => list.filter(r => r.id !== reqId));
      },
      error: () => this.toast.error('Failed to approve request')
    });
  }

  rejectLeave(reqId: number) {
    this.leavesService.updateRequestStatus(reqId, 'REJECTED', 'Not feasible for project timeline').subscribe({
      next: () => {
        this.toast.success('Leave request rejected');
        this.pendingApprovals.update(list => list.filter(r => r.id !== reqId));
      },
      error: () => this.toast.error('Failed to reject request')
    });
  }
}
