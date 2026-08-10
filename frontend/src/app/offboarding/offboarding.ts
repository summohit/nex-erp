import { Component, OnInit, inject, signal, computed, effect } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OffboardingService, Resignation, OffboardingTask, ExitInterview } from '../services/offboarding.service';
import { AuthService } from '../services/auth.service';
import { EmployeeService, Employee } from '../services/employee.service';
import { HotToastService } from '@ngneat/hot-toast';
import { 
  LucideDoorOpen, 
  LucideCheckCircle2, 
  LucideClock, 
  LucideXCircle, 
  LucideClipboardCheck,
  LucideX
} from '@lucide/angular';

@Component({
  selector: 'app-offboarding',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    LucideDoorOpen,
    LucideCheckCircle2,
    LucideClock,
    LucideXCircle,
    LucideClipboardCheck,
    LucideX
  ],
  templateUrl: './offboarding.html',
  styleUrls: ['./offboarding.css']
})
export class OffboardingComponent implements OnInit {
  private offboardingService = inject(OffboardingService);
  private authService = inject(AuthService);
  private employeeService = inject(EmployeeService);
  private toast = inject(HotToastService);

  activeTab = signal<'resignations' | 'tasks' | 'exit'>('resignations');
  
  resignations = signal<Resignation[]>([]);
  tasks = signal<OffboardingTask[]>([]);
  interviews = signal<ExitInterview[]>([]);
  
  currentUserRole = signal<string>('');
  currentEmployeeId = signal<number>(0);

  // Modals
  showResignModal = signal(false);
  resignForm = { reason: '', intendedLastWorkingDay: '' };

  showApproveModal = signal(false);
  approveForm = { id: 0, status: 'APPROVED', approvedLastWorkingDay: '', remarks: '' };

  showTaskModal = signal(false);
  taskForm = { id: 0, remarks: '' };

  showInterviewModal = signal(false);
  interviewForm = { employeeId: 0, feedback: '', rating: 3 };
  employees = signal<Employee[]>([]);

  constructor() {
    effect(() => {
      const user = this.authService.currentUser();
      if (user) {
        this.currentUserRole.set(user.role);
        this.currentEmployeeId.set(user.employeeId || 0);
        this.loadData();
      }
    });
  }

  ngOnInit() {
  }

  isManagerOrAdmin() {
    const r = this.currentUserRole();
    return ['SUPERADMIN', 'ADMIN', 'HR', 'MANAGER'].includes(r);
  }

  isAdminOrHr() {
    const r = this.currentUserRole();
    return ['SUPERADMIN', 'ADMIN', 'HR'].includes(r);
  }

  canClearTasks() {
    const r = this.currentUserRole();
    return ['SUPERADMIN', 'ADMIN', 'HR', 'FINANCE'].includes(r);
  }

  setTab(tab: 'resignations' | 'tasks' | 'exit') {
    this.activeTab.set(tab);
    this.loadData();
  }

  loadData() {
    if (this.activeTab() === 'resignations') {
      this.offboardingService.getResignations().subscribe(res => this.resignations.set(res));
    } else if (this.activeTab() === 'tasks') {
      if (this.canClearTasks()) {
        this.offboardingService.getTasks().subscribe(res => this.tasks.set(res));
      }
    } else if (this.activeTab() === 'exit') {
      if (this.isAdminOrHr()) {
        this.offboardingService.getExitInterviews().subscribe(res => this.interviews.set(res));
        this.employeeService.getEmployees().subscribe(res => this.employees.set(res || []));
      }
    }
  }

  // --- Resignations ---
  openResignModal() {
    this.resignForm = { reason: '', intendedLastWorkingDay: '' };
    this.showResignModal.set(true);
  }

  closeResignModal() {
    this.showResignModal.set(false);
  }

  submitResignation() {
    if (!this.resignForm.reason || !this.resignForm.intendedLastWorkingDay) {
      this.toast.error('Please fill all fields');
      return;
    }
    this.offboardingService.submitResignation(this.resignForm.reason, this.resignForm.intendedLastWorkingDay)
      .subscribe({
        next: () => {
          this.toast.success('Resignation submitted successfully');
          this.closeResignModal();
          this.loadData();
        },
        error: (err) => this.toast.error(err.error?.message || 'Error submitting resignation')
      });
  }

  openApproveModal(resignation: Resignation) {
    this.approveForm = { 
      id: resignation.id, 
      status: 'APPROVED', 
      approvedLastWorkingDay: resignation.intendedLastWorkingDay.split('T')[0], 
      remarks: '' 
    };
    this.showApproveModal.set(true);
  }

  closeApproveModal() {
    this.showApproveModal.set(false);
  }

  submitApprove() {
    this.offboardingService.updateResignationStatus(
      this.approveForm.id,
      this.approveForm.status,
      this.approveForm.status === 'APPROVED' ? this.approveForm.approvedLastWorkingDay : undefined,
      this.approveForm.remarks
    ).subscribe({
      next: () => {
        this.toast.success(`Resignation ${this.approveForm.status.toLowerCase()}`);
        this.closeApproveModal();
        this.loadData();
      },
      error: (err) => this.toast.error(err.error?.message || 'Error updating status')
    });
  }

  // --- Tasks ---
  openTaskModal(task: OffboardingTask) {
    this.taskForm = { id: task.id, remarks: '' };
    this.showTaskModal.set(true);
  }

  closeTaskModal() {
    this.showTaskModal.set(false);
  }

  submitTask() {
    this.offboardingService.clearTask(this.taskForm.id, this.taskForm.remarks)
      .subscribe({
        next: () => {
          this.toast.success('Task cleared');
          this.closeTaskModal();
          this.loadData();
        },
        error: (err) => this.toast.error(err.error?.message || 'Error clearing task')
      });
  }

  // --- Exit Interviews ---
  openInterviewModal() {
    this.interviewForm = { employeeId: 0, feedback: '', rating: 3 };
    this.showInterviewModal.set(true);
  }

  closeInterviewModal() {
    this.showInterviewModal.set(false);
  }

  submitInterview() {
    if (!this.interviewForm.employeeId || !this.interviewForm.feedback) {
      this.toast.error('Please fill all fields');
      return;
    }
    this.offboardingService.submitExitInterview(
      this.interviewForm.employeeId,
      this.interviewForm.feedback,
      this.interviewForm.rating
    ).subscribe({
      next: () => {
        this.toast.success('Exit interview saved');
        this.closeInterviewModal();
        this.loadData();
      },
      error: (err) => this.toast.error(err.error?.message || 'Error saving interview')
    });
  }
}
