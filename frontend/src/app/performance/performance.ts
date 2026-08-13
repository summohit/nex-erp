import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PerformanceService, PerformanceGoal, PerformanceReview, CompanyOKR, AppraisalCycle, PeerFeedback } from '../services/performance.service';
import { EmployeeService, Employee } from '../services/employee.service';
import { AuthService } from '../services/auth.service';
import { HotToastService } from '@ngneat/hot-toast';
import { 
  LucideTarget, 
  LucideAward, 
  LucideClock, 
  LucidePlus,
  LucideX,
  LucideTrash,
  LucideCheck,
  LucideXCircle,
  LucideTrendingUp,
  LucideUsers,
  LucideCalendar
} from '@lucide/angular';

@Component({
  selector: 'app-performance',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideTarget, 
    LucideAward, 
    LucideClock, 
    LucidePlus,
    LucideX,
    LucideTrash,
    LucideCheck,
    LucideXCircle,
    LucideTrendingUp,
    LucideUsers,
    LucideCalendar
  ],
  providers: [DatePipe],
  templateUrl: './performance.html',
  styleUrls: ['./performance.css']
})
export class PerformanceComponent implements OnInit {
  private performanceService = inject(PerformanceService);
  private employeeService = inject(EmployeeService);
  public authService = inject(AuthService); // changed to public to access in template if needed
  private toast = inject(HotToastService);
  private datePipe = inject(DatePipe);

  activeTab = signal<'goals' | 'reviews' | 'okrs' | 'cycles'>('goals');
  
  myGoals = signal<PerformanceGoal[]>([]);
  myReviews = signal<PerformanceReview[]>([]);
  teamReviews = signal<PerformanceReview[]>([]);
  mySubordinates = signal<Employee[]>([]);
  
  companyOKRs = signal<CompanyOKR[]>([]);
  appraisalCycles = signal<AppraisalCycle[]>([]);
  peerRequests = signal<PeerFeedback[]>([]);

  isManager = computed(() => {
    return this.mySubordinates().length > 0;
  });

  isHR = computed(() => {
    // Basic check for HR role, or just showing the cycles tab to admins
    return this.authService.currentUser()?.role === 'HR' || this.authService.currentUser()?.role === 'ADMIN';
  });

  // Goal Modal
  isGoalModalOpen = signal<boolean>(false);
  showGoalErrors = signal<boolean>(false);
  isSavingGoal = signal<boolean>(false);
  goalForm = { title: '', description: '', dueDate: '', targetValue: null as number | null, unit: '₹', okrId: null as number | null };

  // OKR Modal
  isOkrModalOpen = signal<boolean>(false);
  okrForm = { title: '', description: '', period: '', keyResults: [] as any[] };

  // Cycle Modal
  isCycleModalOpen = signal<boolean>(false);
  cycleForm = { name: '', startDate: '', endDate: '' };

  // Review Modal
  isReviewModalOpen = signal<boolean>(false);
  reviewForm: any = { employeeId: '', cycleName: '', rating: 0, feedback: '', status: 'PENDING_SELF_REVIEW', id: 0, cycleId: null };

  // Self Appraisal Modal
  isSelfAppraisalModalOpen = signal<boolean>(false);
  selfAppraisalForm = { reviewId: 0, selfRating: 0, selfFeedback: '' };

  minDate: string;

  constructor() {
    const today = new Date();
    this.minDate = today.toISOString().split('T')[0];
  }

  ngOnInit() {
    this.loadGoals();
    this.loadReviews();
    this.loadSubordinates();
    this.loadOKRs();
    this.loadCycles();
    this.loadPeerRequests();
  }

  setTab(tab: 'goals' | 'reviews' | 'okrs' | 'cycles') {
    this.activeTab.set(tab);
  }

  loadGoals() {
    this.performanceService.getMyGoals().subscribe(res => this.myGoals.set(res));
  }

  loadReviews() {
    this.performanceService.getMyReviews().subscribe(res => this.myReviews.set(res));
    this.performanceService.getTeamReviews().subscribe(res => this.teamReviews.set(res));
  }
  
  loadSubordinates() {
    this.employeeService.getEmployees().subscribe(emps => {
      const currentUserId = this.authService.currentUser()?.employeeId;
      if (currentUserId) {
        this.mySubordinates.set(emps.filter((e: any) => e.managerId === currentUserId));
      }
    });
  }

  loadOKRs() {
    this.performanceService.getCompanyOKRs().subscribe(res => this.companyOKRs.set(res));
  }

  loadCycles() {
    this.performanceService.getAppraisalCycles().subscribe(res => this.appraisalCycles.set(res));
  }

  loadPeerRequests() {
    this.performanceService.getMyPeerRequests().subscribe(res => this.peerRequests.set(res));
  }

  // --- Goals CRUD ---
  openGoalModal() {
    this.goalForm = { title: '', description: '', dueDate: '', targetValue: null, unit: '₹', okrId: null };
    this.showGoalErrors.set(false);
    this.isGoalModalOpen.set(true);
  }
  closeGoalModal() { this.isGoalModalOpen.set(false); }

  saveGoal() {
    if (!this.goalForm.title || !this.goalForm.dueDate || !this.goalForm.description) {
      this.showGoalErrors.set(true);
      return;
    }
    this.isSavingGoal.set(true);
    this.performanceService.createGoal(this.goalForm).subscribe({
      next: () => {
        this.toast.success('Goal created successfully');
        this.closeGoalModal();
        this.loadGoals();
        this.isSavingGoal.set(false);
      },
      error: () => {
        this.toast.error('Failed to create goal');
        this.isSavingGoal.set(false);
      }
    });
  }

  updateGoalStatus(id: number, status: string) {
    this.performanceService.updateGoalStatus(id, status).subscribe({
      next: () => { this.toast.success('Goal status updated'); this.loadGoals(); },
      error: () => this.toast.error('Failed to update goal')
    });
  }

  updateGoalProgress(id: number, progress: number, currentValue: number) {
    this.performanceService.updateGoalProgress(id, { progress, currentValue }).subscribe({
      next: () => { this.toast.success('Progress updated'); this.loadGoals(); },
      error: () => this.toast.error('Failed to update progress')
    });
  }
  
  deleteGoal(id: number) {
    if(!confirm('Are you sure you want to delete this goal?')) return;
    this.performanceService.deleteGoal(id).subscribe({
      next: () => { this.toast.success('Goal deleted'); this.loadGoals(); },
      error: () => this.toast.error('Failed to delete goal')
    });
  }

  // --- OKRs CRUD ---
  openOkrModal() {
    this.okrForm = { title: '', description: '', period: '', keyResults: [] };
    this.isOkrModalOpen.set(true);
  }
  closeOkrModal() { this.isOkrModalOpen.set(false); }

  addKeyResult() {
    this.okrForm.keyResults.push({ title: '', targetValue: 0, unit: '₹' });
  }
  removeKeyResult(index: number) {
    this.okrForm.keyResults.splice(index, 1);
  }

  saveOKR() {
    this.performanceService.createOKR(this.okrForm).subscribe({
      next: () => {
        this.toast.success('Company OKR created');
        this.closeOkrModal();
        this.loadOKRs();
      },
      error: () => this.toast.error('Failed to create OKR')
    });
  }

  // --- Cycles CRUD ---
  openCycleModal() {
    this.cycleForm = { name: '', startDate: '', endDate: '' };
    this.isCycleModalOpen.set(true);
  }
  closeCycleModal() { this.isCycleModalOpen.set(false); }

  saveCycle() {
    this.performanceService.createAppraisalCycle(this.cycleForm).subscribe({
      next: () => {
        this.toast.success('Appraisal Cycle created');
        this.closeCycleModal();
        this.loadCycles();
      },
      error: () => this.toast.error('Failed to create cycle')
    });
  }

  // --- Reviews CRUD & Workflow ---
  openReviewModal(review?: PerformanceReview) {
    if (review) {
      this.reviewForm = {
        id: review.id,
        employeeId: review.employee?.id,
        cycleName: review.cycleName,
        rating: review.rating || 0,
        feedback: review.feedback || '',
        status: review.status
      };
    } else {
      this.reviewForm = { id: 0, employeeId: '', cycleName: '', cycleId: null, rating: 0, feedback: '', status: 'PENDING_SELF_REVIEW' };
    }
    this.isReviewModalOpen.set(true);
  }
  closeReviewModal() { this.isReviewModalOpen.set(false); }

  saveReview() {
    if (!this.reviewForm.employeeId || !this.reviewForm.cycleName) {
      this.toast.error('Please fill required fields');
      return;
    }
    
    // Auto-fill cycleId based on selected cycleName if possible
    const selectedCycle = this.appraisalCycles().find(c => c.name === this.reviewForm.cycleName);
    if(selectedCycle) {
      this.reviewForm.cycleId = selectedCycle.id;
    }

    const req = this.reviewForm.id
      ? this.performanceService.updateReview(this.reviewForm.id, this.reviewForm)
      : this.performanceService.createReview(this.reviewForm);

    req.subscribe({
      next: () => {
        this.toast.success('Review saved successfully');
        this.closeReviewModal();
        this.loadReviews();
      },
      error: () => this.toast.error('Failed to save review')
    });
  }

  openSelfAppraisal(review: PerformanceReview) {
    this.selfAppraisalForm = {
      reviewId: review.id,
      selfRating: review.selfRating || 0,
      selfFeedback: review.selfFeedback || ''
    };
    this.isSelfAppraisalModalOpen.set(true);
  }
  closeSelfAppraisalModal() { this.isSelfAppraisalModalOpen.set(false); }

  saveSelfAppraisal() {
    this.performanceService.submitSelfAppraisal(this.selfAppraisalForm.reviewId, this.selfAppraisalForm).subscribe({
      next: () => {
        this.toast.success('Self appraisal submitted');
        this.closeSelfAppraisalModal();
        this.loadReviews();
      },
      error: () => this.toast.error('Failed to submit self appraisal')
    });
  }

  submitManagerReview(review: PerformanceReview) {
    // In a real app this might open another modal, here we just submit what's already saved in the review form if we bind it.
    // Let's assume the user edits the rating inline or via the normal edit modal.
    // If we trigger this, we can just call updateReview + submitManagerAppraisal.
    this.performanceService.submitManagerAppraisal(review.id, { rating: review.rating, feedback: review.feedback }).subscribe({
      next: () => {
        this.toast.success('Manager review submitted');
        this.loadReviews();
      },
      error: () => this.toast.error('Failed to submit manager review')
    });
  }

  signoff(reviewId: number, role: 'EMPLOYEE' | 'HR', action: 'ACKNOWLEDGED' | 'APPROVED') {
    if(!confirm(`Are you sure you want to ${action.toLowerCase()} this review?`)) return;
    this.performanceService.signoffReview(reviewId, { role, action, comments: '' }).subscribe({
      next: () => {
        this.toast.success(`Review ${action.toLowerCase()}`);
        this.loadReviews();
      },
      error: () => this.toast.error('Failed to signoff')
    });
  }
}
