import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PerformanceService, PerformanceGoal, PerformanceReview } from '../services/performance.service';
import { EmployeeService, Employee } from '../services/employee.service';
import { AuthService } from '../services/auth.service';
import { HotToastService } from '@ngneat/hot-toast';
import { 
  LucideTarget, 
  LucideAward, 
  LucideClock, 
  LucidePlus,
  LucideX,
  LucideTrash
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
    LucideTrash
  ],
  providers: [DatePipe],
  templateUrl: './performance.html',
  styleUrls: ['./performance.css']
})
export class PerformanceComponent implements OnInit {
  private performanceService = inject(PerformanceService);
  private employeeService = inject(EmployeeService);
  private authService = inject(AuthService);
  private toast = inject(HotToastService);
  private datePipe = inject(DatePipe);

  activeTab = signal<'goals' | 'reviews'>('goals');
  
  myGoals = signal<PerformanceGoal[]>([]);
  myReviews = signal<PerformanceReview[]>([]);
  teamReviews = signal<PerformanceReview[]>([]);
  mySubordinates = signal<Employee[]>([]);

  isManager = computed(() => {
    return this.mySubordinates().length > 0;
  });

  // Modal states
  isGoalModalOpen = signal<boolean>(false);
  goalForm = { title: '', description: '', dueDate: '' };

  isReviewModalOpen = signal<boolean>(false);
  reviewForm: any = { employeeId: '', cycleName: '', rating: 0, feedback: '', status: 'DRAFT', id: 0 };

  ngOnInit() {
    this.loadGoals();
    this.loadReviews();
    this.loadSubordinates();
  }

  setTab(tab: 'goals' | 'reviews') {
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

  // Goals CRUD
  openGoalModal() {
    this.goalForm = { title: '', description: '', dueDate: '' };
    this.isGoalModalOpen.set(true);
  }

  closeGoalModal() {
    this.isGoalModalOpen.set(false);
  }

  saveGoal() {
    if (!this.goalForm.title) {
      this.toast.error('Title is required');
      return;
    }
    this.performanceService.createGoal(this.goalForm).subscribe({
      next: () => {
        this.toast.success('Goal created successfully');
        this.closeGoalModal();
        this.loadGoals();
      },
      error: () => this.toast.error('Failed to create goal')
    });
  }

  updateGoalStatus(id: number, status: string) {
    this.performanceService.updateGoalStatus(id, status).subscribe({
      next: () => {
        this.toast.success('Goal status updated');
        this.loadGoals();
      },
      error: () => this.toast.error('Failed to update goal')
    });
  }
  
  deleteGoal(id: number) {
    if(!confirm('Are you sure you want to delete this goal?')) return;
    this.performanceService.deleteGoal(id).subscribe({
      next: () => {
        this.toast.success('Goal deleted');
        this.loadGoals();
      },
      error: () => this.toast.error('Failed to delete goal')
    });
  }

  // Reviews CRUD
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
      this.reviewForm = { id: 0, employeeId: '', cycleName: '', rating: 0, feedback: '', status: 'DRAFT' };
    }
    this.isReviewModalOpen.set(true);
  }

  closeReviewModal() {
    this.isReviewModalOpen.set(false);
  }

  saveReview() {
    if (!this.reviewForm.employeeId || !this.reviewForm.cycleName) {
      this.toast.error('Please fill required fields');
      return;
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
}
