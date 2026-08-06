import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { OnboardingService, EmployeeOnboardingTask } from '../services/onboarding.service';
import { AttendanceService, AttendanceRecord } from '../services/attendance';
import { EmployeeService } from '../services/employee.service';
import { ProjectsService } from '../services/projects';
import { LeavesService } from '../services/leaves';
import { 
  LucideCheckCircle2, LucideCircle, LucideClock, LucideUsers, LucideBriefcase,
  LucideFileText, LucideTrendingUp, LucideCheckSquare, LucideCalendar, LucideUserCheck,
  LucideAlertCircle, LucideArrowRight, LucidePlus, LucideBuilding, LucideLayers,
  LucideShield, LucideAward
} from '@lucide/angular';
import { HotToastService } from '@ngneat/hot-toast';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule, 
    RouterModule,
    LucideCheckCircle2, LucideCircle, LucideClock, LucideUsers, LucideBriefcase,
    LucideFileText, LucideTrendingUp, LucideCheckSquare, LucideCalendar, LucideUserCheck,
    LucideAlertCircle, LucideArrowRight, LucidePlus, LucideBuilding, LucideLayers,
    LucideShield, LucideAward
  ],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.css']
})
export class DashboardComponent implements OnInit {
  private authService = inject(AuthService);
  private router = inject(Router);
  private onboardingService = inject(OnboardingService);
  private attendanceService = inject(AttendanceService);
  private employeeService = inject(EmployeeService);
  private projectsService = inject(ProjectsService);
  private leavesService = inject(LeavesService);
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
  isExecutive = computed(() => ['ADMIN', 'SUPER_ADMIN'].includes(this.userRole()));
  isManager = computed(() => ['HR_MANAGER', 'MANAGER'].includes(this.userRole()));
  isEmployee = computed(() => !this.isExecutive() && !this.isManager());

  // Metrics Data Signals
  employees = signal<any[]>([]);
  projects = signal<any[]>([]);
  leaveRequests = signal<any[]>([]);
  myLeaveBalances = signal<any[]>([]);
  myTasks = signal<any[]>([]);
  isLoadingMetrics = signal<boolean>(true);

  // Computed Dashboard Metrics
  totalEmployeesCount = computed(() => this.employees().length);
  totalProjectsCount = computed(() => this.projects().length);
  pendingApprovalsCount = computed(() => this.leaveRequests().filter(r => r.status === 'PENDING').length);
  
  departmentBreakdown = computed(() => {
    const map = new Map<string, number>();
    for (const emp of this.employees()) {
      const dept = emp.department?.name || 'Unassigned';
      map.set(dept, (map.get(dept) || 0) + 1);
    }
    return Array.from(map.entries()).map(([name, count]) => ({ name, count }));
  });

  myPendingTasksCount = computed(() => this.myTasks().filter(t => t.status !== 'DONE').length);
  myCompletedTasksCount = computed(() => this.myTasks().filter(t => t.status === 'DONE').length);

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
        this.loadRoleMetrics();
      },
      error: () => {
        this.authService.logout();
        this.router.navigate(['/']);
      }
    });
  }

  loadRoleMetrics() {
    this.isLoadingMetrics.set(true);

    // Common: Get Projects
    this.projectsService.getProjects().subscribe({
      next: (projs) => {
        this.projects.set(projs || []);
        
        // Extract My Tasks across projects
        const currentUserId = this.user()?.id;
        const myTasksList: any[] = [];
        for (const p of projs || []) {
          if (p.issues) {
            for (const issue of p.issues) {
              if (issue.assigneeId === currentUserId || issue.reporterId === currentUserId) {
                myTasksList.push({ ...issue, projectKey: p.key, projectName: p.name });
              }
            }
          }
        }
        this.myTasks.set(myTasksList);
      }
    });

    // Executive / Manager: Load Employees & Leave Approvals
    if (this.isExecutive() || this.isManager()) {
      this.employeeService.getEmployees().subscribe({
        next: (emps) => this.employees.set(emps || [])
      });

      this.leavesService.getRequests().subscribe({
        next: (reqs) => this.leaveRequests.set(reqs || [])
      });
    }

    // Employee: Load Personal Leave Balances
    this.leavesService.getMyBalances().subscribe({
      next: (bals) => this.myLeaveBalances.set(bals || []),
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
        this.leaveRequests.update(list => list.map(r => r.id === reqId ? { ...r, status: 'APPROVED' } : r));
      },
      error: () => this.toast.error('Failed to approve request')
    });
  }

  rejectLeave(reqId: number) {
    this.leavesService.updateRequestStatus(reqId, 'REJECTED', 'Not feasible for project timeline').subscribe({
      next: () => {
        this.toast.success('Leave request rejected');
        this.leaveRequests.update(list => list.map(r => r.id === reqId ? { ...r, status: 'REJECTED' } : r));
      },
      error: () => this.toast.error('Failed to reject request')
    });
  }
}
