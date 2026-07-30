import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { OnboardingService, EmployeeOnboardingTask } from '../services/onboarding.service';
import { AttendanceService, AttendanceRecord } from '../services/attendance';
import { LucideCheckCircle2, LucideCircle, LucideClock } from '@lucide/angular';
import { HotToastService } from '@ngneat/hot-toast';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, LucideCheckCircle2, LucideCircle, LucideClock],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.css']
})
export class DashboardComponent implements OnInit {
  private authService = inject(AuthService);
  private router = inject(Router);
  private onboardingService = inject(OnboardingService);
  private attendanceService = inject(AttendanceService);
  private toast = inject(HotToastService);

  user = signal<any>(null);
  onboardingStatus = signal<string>('COMPLETED');
  onboardingTasks = signal<EmployeeOnboardingTask[]>([]);
  isCompletingTask = signal<number | null>(null);

  todayAttendance = signal<AttendanceRecord | null>(null);
  isClocking = signal<boolean>(false);

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
      },
      error: () => {
        this.authService.logout();
        this.router.navigate(['/']);
      }
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
        
        // Update local state for immediate feedback
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
}
