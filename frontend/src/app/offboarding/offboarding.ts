import { Component, OnInit, inject, signal, computed, effect } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OffboardingService, Resignation, OffboardingTask, ExitInterview } from '../services/offboarding.service';
import { AuthService } from '../services/auth.service';
import { EmployeeService, Employee } from '../services/employee.service';
import { HotToastService } from '@ngneat/hot-toast';
import { ActivatedRoute } from '@angular/router';
import { 
  LucideDoorOpen, 
  LucideCheckCircle2, 
  LucideClock, 
  LucideXCircle, 
  LucideClipboardCheck,
  LucideX,
  LucideEye,
  LucideMail,
  LucideCalendarDays,
  LucideMessageSquare,
  LucideUserRound
} from '@lucide/angular';

@Component({
  selector: 'app-offboarding',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    LucideDoorOpen,
    LucideCheckCircle2,
    LucideClipboardCheck,
    LucideX,
    LucideEye,
    LucideMail,
    LucideCalendarDays,
    LucideMessageSquare,
    LucideUserRound
  ],
  templateUrl: './offboarding.html',
  styleUrls: ['./offboarding.css']
})
export class OffboardingComponent implements OnInit {
  private offboardingService = inject(OffboardingService);
  private authService = inject(AuthService);
  private employeeService = inject(EmployeeService);
  private toast = inject(HotToastService);
  private route = inject(ActivatedRoute);

  activeTab = signal<'resignations' | 'tasks' | 'exit'>('resignations');
  
  resignations = signal<Resignation[]>([]);
  tasks = signal<OffboardingTask[]>([]);
  interviews = signal<ExitInterview[]>([]);
  
  currentUserRole = signal<string>('');
  currentEmployeeId = signal<number>(0);
  private focusedEmployeeId = signal<number | null>(null);

  // Modals
  showResignModal = signal(false);
  resignForm = { reason: '', intendedLastWorkingDay: '' };

  showApproveModal = signal(false);
  approveForm = { id: 0, status: 'APPROVED', approvedLastWorkingDay: '', remarks: '' };

  showResignationDetails = signal(false);
  selectedResignation = signal<Resignation | null>(null);
  inlineStatusBusy = signal<number | null>(null);
  openStatusDropdownId = signal<number | null>(null);
  openActionMenuId = signal<number | null>(null);
  resignationPage = signal(1);
  resignationPageSize = signal(10);
  readonly resignationPageSizeOptions = [10, 25, 50, 100];
  resignationSearch = signal('');
  resignationStatusFilter = signal('ALL');
  pendingResignationCount = computed(() => this.resignations().filter((item) => item.status === 'PENDING').length);
  approvedResignationCount = computed(() => this.resignations().filter((item) => item.status === 'APPROVED').length);
  pendingTaskCount = computed(() => this.tasks().filter((item) => item.status === 'PENDING').length);
  clearedTaskCount = computed(() => this.tasks().filter((item) => item.status === 'CLEARED').length);
  filteredResignations = computed(() => {
    const query = this.resignationSearch().trim().toLowerCase();
    const status = this.resignationStatusFilter();
    return this.resignations().filter((item) => {
      const matchesStatus = status === 'ALL' || item.status === status;
      const matchesSearch = !query || [
        item.employee?.firstName,
        item.employee?.lastName,
        item.employee?.employeeCode,
        item.employee?.user?.email,
        item.reason,
        item.approver?.email,
        item.status,
      ].some((value) => value?.toLowerCase().includes(query));
      return matchesStatus && matchesSearch;
    });
  });
  resignationPageCount = computed(() => Math.max(1, Math.ceil(this.filteredResignations().length / this.resignationPageSize())));
  pagedResignations = computed(() => {
    const page = Math.min(this.resignationPage(), this.resignationPageCount());
    const start = (page - 1) * this.resignationPageSize();
    return this.filteredResignations().slice(start, start + this.resignationPageSize());
  });
  resignationRangeStart = computed(() => this.filteredResignations().length ? (Math.min(this.resignationPage(), this.resignationPageCount()) - 1) * this.resignationPageSize() + 1 : 0);
  resignationRangeEnd = computed(() => Math.min(this.resignationRangeStart() + this.resignationPageSize() - 1, this.filteredResignations().length));

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
    this.route.queryParamMap.subscribe((params) => {
      const employeeId = Number(params.get('employeeId'));
      this.focusedEmployeeId.set(Number.isInteger(employeeId) && employeeId > 0 ? employeeId : null);
      if (employeeId > 0) {
        this.activeTab.set('resignations');
        this.loadData();
      }
    });
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

  setResignationPage(page: number) {
    this.resignationPage.set(Math.max(1, Math.min(page, this.resignationPageCount())));
  }

  setResignationPageSize(size: string | number) {
    this.resignationPageSize.set(Number(size) || 10);
    this.resignationPage.set(1);
  }

  updateResignationSearch(value: string) {
    this.resignationSearch.set(value);
    this.resignationPage.set(1);
  }

  updateResignationStatusFilter(value: string) {
    this.resignationStatusFilter.set(value);
    this.resignationPage.set(1);
  }

  clearResignationFilters() {
    this.resignationSearch.set('');
    this.resignationStatusFilter.set('ALL');
    this.resignationPage.set(1);
  }

  /** The directory is the canonical employee-photo source. This keeps the
   * resignation register compatible with older API responses that omit it. */
  private hydrateResignationAvatars() {
    this.employeeService.getEmployees().subscribe({
      next: (employees) => {
        const avatarByEmployeeId = new Map(
          employees
            .map((employee) => [employee.id, employee.avatarUrl || employee.user?.avatarUrl] as const)
            .filter(([, avatarUrl]) => !!avatarUrl),
        );
        this.resignations.update((items) => items.map((item) => {
          const avatarUrl = item.employee?.avatarUrl || avatarByEmployeeId.get(item.employeeId);
          const directoryEmployee = employees.find((employee) => employee.id === item.employeeId);
          return item.employee && directoryEmployee ? {
            ...item,
            employee: {
              ...item.employee,
              avatarUrl,
              firstName: item.employee.firstName || directoryEmployee.firstName,
              lastName: item.employee.lastName || directoryEmployee.lastName,
              employeeCode: item.employee.employeeCode || directoryEmployee.employeeCode,
            },
          } : item;
        }));
      },
      // The table remains usable for roles that cannot load the directory.
      error: () => undefined,
    });
  }

  handleAvatarError(resignation: Resignation) {
    if (resignation.employee) {
      resignation.employee.avatarUrl = null;
    }
  }

  employeeName(resignation: Resignation): string {
    const employee = resignation.employee;
    const name = [employee?.firstName, employee?.lastName].filter(Boolean).join(' ').trim();
    return name || 'Employee record unavailable';
  }

  employeeIdentifier(resignation: Resignation): string {
    return resignation.employee?.employeeCode || `ID ${resignation.employeeId}`;
  }

  loadData() {
    if (this.activeTab() === 'resignations') {
      this.offboardingService.getResignations().subscribe(res => {
        this.resignations.set(res);
        const focusedEmployeeId = this.focusedEmployeeId();
        if (focusedEmployeeId) {
          const focused = res.find((item) => item.employeeId === focusedEmployeeId);
          if (focused) {
            this.resignationSearch.set(this.employeeName(focused));
            this.openResignationDetails(focused);
          }
        }
        this.setResignationPage(this.resignationPage());
        this.hydrateResignationAvatars();
      });
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

  openResignationDetails(resignation: Resignation) {
    this.openActionMenuId.set(null);
    this.selectedResignation.set(resignation);
    this.showResignationDetails.set(true);
  }

  toggleActionMenu(resignationId: number, event: Event) {
    event.stopPropagation();
    this.openActionMenuId.update((openId) => openId === resignationId ? null : resignationId);
  }

  closeResignationDetails() {
    this.showResignationDetails.set(false);
    this.selectedResignation.set(null);
  }

  reviewFromDetails() {
    const resignation = this.selectedResignation();
    if (!resignation) return;
    this.closeResignationDetails();
    this.openApproveModal(resignation);
  }

  toggleStatusDropdown(resignationId: number, event: Event) {
    event.stopPropagation();
    this.openStatusDropdownId.update((openId) => openId === resignationId ? null : resignationId);
  }

  selectInlineStatus(resignation: Resignation, nextStatus: string, event: Event) {
    event.stopPropagation();
    this.openStatusDropdownId.set(null);
    if (!nextStatus || nextStatus === resignation.status) return;

    this.inlineStatusBusy.set(resignation.id);
    const approvedLastWorkingDay = nextStatus === 'APPROVED'
      ? (resignation.approvedLastWorkingDay || resignation.intendedLastWorkingDay).split('T')[0]
      : undefined;

    this.offboardingService.updateResignationStatus(resignation.id, nextStatus, approvedLastWorkingDay).subscribe({
      next: (updated) => {
        this.resignations.update((items) => items.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
        if (this.selectedResignation()?.id === updated.id) this.selectedResignation.update((item) => item ? { ...item, ...updated } : item);
        this.inlineStatusBusy.set(null);
        this.toast.success(`Status changed to ${nextStatus.toLowerCase()}`);
      },
      error: (err) => {
        this.inlineStatusBusy.set(null);
        this.toast.error(err.error?.message || 'Could not update the resignation status');
      },
    });
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
