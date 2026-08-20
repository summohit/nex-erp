import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { OnboardingService, EmployeeOnboardingTask } from '../services/onboarding.service';
import { AttendanceService, AttendanceRecord } from '../services/attendance';
import { LeavesService } from '../services/leaves';
import { DashboardService, DashboardPayload } from '../services/dashboard.service';
import { StatCardComponent } from '../shared/components/stat-card/stat-card.component';
import { ChartCardComponent } from '../shared/components/chart-card/chart-card.component';
import {
  LucideCheckCircle2, LucideCircle, LucideClock, LucideUsers, LucideBriefcase,
  LucideFileText, LucideCheckSquare, LucideCalendar, LucideUserCheck,
  LucideAlertCircle, LucideArrowRight, LucideBuilding, LucideLayers,
  LucideShield, LucideAward, LucideBanknote, LucideReceipt, LucideTrendingUp,
  LucideShoppingCart, LucideTarget, LucideCake, LucidePartyPopper, LucideGift
} from '@lucide/angular';
import { HotToastService } from '@ngneat/hot-toast';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    StatCardComponent,
    ChartCardComponent,
    LucideCheckCircle2, LucideCircle, LucideClock, LucideUsers, LucideBriefcase,
    LucideFileText, LucideCheckSquare, LucideCalendar, LucideUserCheck,
    LucideAlertCircle, LucideArrowRight, LucideBuilding, LucideLayers,
    LucideShield, LucideAward, LucideBanknote, LucideReceipt, LucideTrendingUp,
    LucideShoppingCart, LucideTarget, LucideCake, LucidePartyPopper, LucideGift
  ],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.css']
})
export class DashboardComponent implements OnInit {
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

  // Role Computation
  userRole = computed(() => this.user()?.role || 'EMPLOYEE');
  showOrgWidgets = computed(() => ['SUPERADMIN', 'ADMIN', 'HR'].includes(this.userRole()));
  isHR = computed(() => this.userRole() === 'HR');
  isFinance = computed(() => this.userRole() === 'FINANCE');
  isSales = computed(() => this.userRole() === 'SALES');
  isEmployee = computed(() => this.userRole() === 'EMPLOYEE');
  showRevenueWidgets = computed(() => ['SUPERADMIN', 'ADMIN', 'FINANCE'].includes(this.userRole()));
  showPayrollCharts = computed(() => ['SUPERADMIN', 'ADMIN', 'FINANCE'].includes(this.userRole()));

  // Dashboard Data
  dashboard = signal<DashboardPayload | null>(null);
  pendingApprovals = signal<any[]>([]);
  isLoadingMetrics = signal<boolean>(true);

  myPendingTasksCount = computed(() => (this.dashboard()?.common?.myTasks || []).filter(t => t.status !== 'DONE').length);
  myCompletedTasksCount = computed(() => (this.dashboard()?.common?.myTasks || []).filter(t => t.status === 'DONE').length);

  // ---------------- CHART SERIES (computed from dashboard payload) ----------------

  headcountTrendSeries = computed(() => {
    const trend = this.dashboard()?.org?.headcountTrend || [];
    return [{ name: 'Employees', data: trend.map(t => t.count) }];
  });
  headcountTrendCategories = computed(() => (this.dashboard()?.org?.headcountTrend || []).map(t => t.label));

  deptDonutSeries = computed(() => (this.dashboard()?.org?.headcount?.byDepartment || []).map(d => d.count));
  deptDonutLabels = computed(() => (this.dashboard()?.org?.headcount?.byDepartment || []).map(d => d.name));

  todayAttendanceSeries = computed(() => {
    const a = this.dashboard()?.org?.todayAttendance;
    if (!a || !a.totalEmployees) return [];
    const pct = (n: number) => Math.round((n / a.totalEmployees) * 100);
    return [pct(a.present), pct(a.late), pct(a.onLeave), pct(a.notClockedIn)];
  });
  todayAttendanceLabels = ['Present', 'Late', 'On Leave', 'Not Clocked In'];

  attendanceTrendSeries = computed(() => {
    const trend = this.dashboard()?.org?.attendanceTrend || [];
    return [{ name: 'Present', data: trend.map(t => t.present) }];
  });
  attendanceTrendCategories = computed(() =>
    (this.dashboard()?.org?.attendanceTrend || []).map(t => new Date(t.date).toLocaleDateString('en-US', { day: 'numeric', month: 'short' }))
  );

  projectStatusSeries = computed(() => (this.dashboard()?.org?.projectStatus || []).map(p => p.count));
  projectStatusLabels = computed(() => (this.dashboard()?.org?.projectStatus || []).map(p => p.status));

  recruitmentSeries = computed(() => {
    const pipeline = this.dashboard()?.org?.recruitmentAnalytics?.pipeline;
    if (!pipeline) return [];
    return [{ name: 'Applications', data: Object.values(pipeline) }];
  });
  recruitmentCategories = computed(() => {
    const pipeline = this.dashboard()?.org?.recruitmentAnalytics?.pipeline;
    return pipeline ? Object.keys(pipeline) : [];
  });

  onboardingPipelineSeries = computed(() => {
    const pipeline = this.dashboard()?.org?.onboardingPipeline || [];
    return [{ name: 'Employees', data: pipeline.map(p => p._count) }];
  });
  onboardingPipelineCategories = computed(() => (this.dashboard()?.org?.onboardingPipeline || []).map(p => p.onboardingStatus));

  leaveByTypeSeries = computed(() => {
    const data = this.dashboard()?.org?.leaveByType || [];
    return [{ name: 'Requests', data: data.map(d => d.count) }];
  });
  leaveByTypeCategories = computed(() => (this.dashboard()?.org?.leaveByType || []).map(d => d.name));

  payrollTrendSeries = computed(() => {
    const trend = this.dashboard()?.finance?.payrollTrend || [];
    return [
      { name: 'Earnings', data: trend.map(t => Math.round(t.earnings)) },
      { name: 'Deductions', data: trend.map(t => Math.round(t.deductions)) }
    ];
  });
  payrollTrendCategories = computed(() => (this.dashboard()?.finance?.payrollTrend || []).map(t => t.label));

  deptSalaryCostSeries = computed(() => [{ name: 'Salary Cost', data: (this.dashboard()?.finance?.deptSalaryCost || []).map(d => d.total) }]);
  deptSalaryCostCategories = computed(() => (this.dashboard()?.finance?.deptSalaryCost || []).map(d => d.name));

  expensesByCategorySeries = computed(() => (this.dashboard()?.finance?.expensesByCategory || []).map(e => e.total));
  expensesByCategoryLabels = computed(() => (this.dashboard()?.finance?.expensesByCategory || []).map(e => e.category));

  revenueTrendSeries = computed(() => {
    const trend = this.dashboard()?.sales?.revenueTrend || [];
    return [{ name: 'Revenue', data: trend.map(t => t.total) }];
  });
  revenueTrendCategories = computed(() => (this.dashboard()?.sales?.revenueTrend || []).map(t => t.label));

  leadsPipelineSeries = computed(() => {
    const data = this.dashboard()?.sales?.leadsPipeline?.byStatus || [];
    return [{ name: 'Leads', data: data.map(d => d._count) }];
  });
  leadsPipelineCategories = computed(() => (this.dashboard()?.sales?.leadsPipeline?.byStatus || []).map(d => d.status));

  quotationsByStatusSeries = computed(() => (this.dashboard()?.sales?.quotationsByStatus || []).map(q => q._count));
  quotationsByStatusLabels = computed(() => (this.dashboard()?.sales?.quotationsByStatus || []).map(q => q.status));

  myTasksByStatusSeries = computed(() => (this.dashboard()?.common?.myTasksByStatus || []).map(s => s.count));
  myTasksByStatusLabels = computed(() => (this.dashboard()?.common?.myTasksByStatus || []).map(s => s.name));

  myLeaveBalanceSeries = computed(() => {
    const balances = this.dashboard()?.common?.myLeaveBalance || [];
    return [{ name: 'Remaining', data: balances.map((b: any) => Math.max(b.allocated + (b.carriedOver || 0) - b.used, 0)) }];
  });
  myLeaveBalanceCategories = computed(() => (this.dashboard()?.common?.myLeaveBalance || []).map((b: any) => b.leaveType?.name || 'Leave'));

  myHoursLoggedSeries = computed(() => [{ name: 'Hours', data: (this.dashboard()?.common?.myHoursLogged || []).map(h => h.hours) }]);
  myHoursLoggedCategories = computed(() =>
    (this.dashboard()?.common?.myHoursLogged || []).map(h => new Date(h.date).toLocaleDateString('en-US', { weekday: 'short' }))
  );

  ngOnInit() {
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
          this.toast.success('🎉 You have completed all onboarding tasks!', { duration: 5000 });
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
