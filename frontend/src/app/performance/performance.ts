import { Component, OnInit, inject, signal, computed, viewChild } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PerformanceService, PerformanceGoal, PerformanceReview, CompanyOKR, AppraisalCycle, PeerFeedback } from '../services/performance.service';
import { EmployeeService, Employee } from '../services/employee.service';
import { AuthService } from '../services/auth.service';
import { HotToastService } from '@ngneat/hot-toast';
import { ActivatedRoute } from '@angular/router';
import { PeopleWatchComponent } from './people-watch/people-watch';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { PageHeaderComponent } from '../shared/components/page-header/page-header';
import { SearchableSelectComponent } from '../shared/components/searchable-select/searchable-select.component';
import { LifecycleService } from '../services/lifecycle.service';
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
  LucideCalendar,
  LucideUserCheck,
  LucideAlertTriangle
} from '@lucide/angular';

ModuleRegistry.registerModules([AllCommunityModule]);

@Component({
  selector: 'app-performance',
  standalone: true,
  imports: [
    PeopleWatchComponent, AgGridAngular, PageHeaderComponent, SearchableSelectComponent,
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
    LucideCalendar,
    LucideUserCheck,
    LucideAlertTriangle
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

  activeTab = signal<'goals' | 'reviews' | 'okrs' | 'cycles' | 'people' | 'probation'>('goals');
  private route = inject(ActivatedRoute);
  private lifecycle = inject(LifecycleService);
  /** Has a PIP of their own: sees the Probation & PIP tab for it. */
  hasOwnPip = signal(false);
  /** Probation, notice and PIP: HR, admins, managers, and anyone with a PIP. */
  canSeePeople = computed(() => {
    const r = this.authService.currentUser()?.role;
    return r === 'HR' || r === 'ADMIN' || r === 'SUPERADMIN' || r === 'SUPER_ADMIN' || this.isManager() || this.hasOwnPip();
  });
  
  myGoals = signal<PerformanceGoal[]>([]);
  myReviews = signal<PerformanceReview[]>([]);
  teamReviews = signal<PerformanceReview[]>([]);
  mySubordinates = signal<Employee[]>([]);
  
  companyOKRs = signal<CompanyOKR[]>([]);
  /** The Probation / PIP tab's list, so its buttons can live in the page header (12 Nov 2026). */
  pw = viewChild(PeopleWatchComponent);
  setPwSection(section: any): void { this.pw()?.section.set(section); }

  // ── Filters on every tab (12 Nov 2026) ─────────────────────────────────────
  goalSearch = signal(''); goalStatus = signal('');
  readonly goalStatusOptions = [
    { id: 'NOT_STARTED', name: 'Not started' }, { id: 'IN_PROGRESS', name: 'In progress' },
    { id: 'ACHIEVED', name: 'Achieved' }, { id: 'MISSED', name: 'Missed' },
  ];
  reviewSearch = signal(''); reviewCycle = signal(''); reviewStatus = signal('');
  readonly reviewStatusOptions = [
    { id: 'PENDING_SELF_REVIEW', name: 'Pending self review' }, { id: 'SELF_REVIEWED', name: 'Self reviewed' },
    { id: 'MANAGER_REVIEWED', name: 'Manager reviewed' }, { id: 'ACKNOWLEDGED', name: 'Acknowledged' },
    { id: 'HR_APPROVED', name: 'HR approved' },
  ];
  okrSearch = signal(''); okrPeriod = signal('');
  cycleSearch = signal('');
  appraisalCycles = signal<AppraisalCycle[]>([]);

  filteredGoals = computed(() => {
    const q = this.goalSearch().trim().toLowerCase(), st = this.goalStatus();
    return (this.myGoals() as any[]).filter(g => (!st || g.status === st)
      && (!q || `${g.title} ${g.description || ''} ${g.okr?.title || ''}`.toLowerCase().includes(q)));
  });
  private reviewMatches(r: any): boolean {
    const q = this.reviewSearch().trim().toLowerCase();
    return (!this.reviewCycle() || r.cycleName === this.reviewCycle())
      && (!this.reviewStatus() || r.status === this.reviewStatus())
      && (!q || `${r.cycleName} ${r.employee?.firstName || ''} ${r.employee?.lastName || ''} ${r.reviewer?.firstName || ''} ${r.reviewer?.lastName || ''}`.toLowerCase().includes(q));
  }
  filteredMyReviews = computed(() => (this.myReviews() as any[]).filter(r => this.reviewMatches(r)));
  filteredTeamReviews = computed(() => (this.teamReviews() as any[]).filter(r => this.reviewMatches(r)));
  reviewCycleOptions = computed(() => [...new Set([...this.myReviews(), ...this.teamReviews()].map((r: any) => r.cycleName).filter(Boolean))]
    .sort().map(c => ({ id: c, name: c })));
  filteredOkrs = computed(() => {
    const q = this.okrSearch().trim().toLowerCase(), per = this.okrPeriod();
    return (this.companyOKRs() as any[]).filter(o => (!per || o.period === per)
      && (!q || `${o.title} ${o.description || ''}`.toLowerCase().includes(q)));
  });
  okrPeriodOptions = computed(() => [...new Set((this.companyOKRs() as any[]).map(o => o.period).filter(Boolean))].map(p => ({ id: p, name: p })));
  filteredCycles = computed(() => {
    const q = this.cycleSearch().trim().toLowerCase();
    return (this.appraisalCycles() as any[]).filter(c => !q || `${c.name} ${c.status}`.toLowerCase().includes(q));
  });

  // ── Tables: the same grid as the Employee Directory (12 Nov 2026) ──────────
  readonly gridDefaultColDef: ColDef = { minWidth: 110, filter: true, sortable: true, resizable: true };
  private esc(v: any): string {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]);
  }
  private nice(st: string): string { const t = String(st || '').replace(/_/g, ' ').toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); }
  private statusPill(st: string): string { return `<span class="g-pill st-${String(st || '').toLowerCase()}">${this.esc(this.nice(st))}</span>`; }
  private stars(n: number | null | undefined): string { return n ? `${'★'.repeat(n)}<span class="g-muted">${'★'.repeat(Math.max(0, 5 - n))}</span>` : '<span class="g-muted">—</span>'; }
  private btn(act: string, label: string, primary = false): string {
    return `<button type="button" class="g-btn${primary ? ' primary' : ''}" data-act="${act}">${label}</button>`;
  }
  private act(e: any): string | null { return (e.event?.target as HTMLElement)?.closest('[data-act]')?.getAttribute('data-act') ?? null; }

  readonly myReviewCols: ColDef[] = [
    { headerName: 'Cycle', field: 'cycleName', minWidth: 160, flex: 1, cellClass: 'g-strong' },
    { headerName: 'Reviewer', colId: 'reviewer', minWidth: 160, flex: 1,
      valueGetter: (p: any) => `${p.data?.reviewer?.firstName || ''} ${p.data?.reviewer?.lastName || ''}`.trim() || '—' },
    { headerName: 'Rating', field: 'rating', minWidth: 120, flex: 0.6, cellRenderer: (p: any) => `<span class="g-stars">${this.stars(p.value)}</span>` },
    { headerName: 'Status', field: 'status', minWidth: 170, flex: 0.9, cellRenderer: (p: any) => this.statusPill(p.value) },
    { headerName: 'Actions', colId: 'actions', minWidth: 230, flex: 1.2, sortable: false, filter: false,
      cellRenderer: (p: any) => `<div class="g-actions">`
        + (p.data?.status === 'PENDING_SELF_REVIEW' ? this.btn('self', 'Complete self review', true) : '')
        + (p.data?.status === 'MANAGER_REVIEWED' ? this.btn('ack', 'Acknowledge', true) : '')
        + this.btn('view', 'View') + `</div>` },
  ];
  readonly myReviewGridOptions = {
    headerHeight: 44, rowHeight: 60,
    onCellClicked: (e: any) => {
      const a = this.act(e);
      if (a === 'self') this.openSelfAppraisal(e.data);
      else if (a === 'ack') this.signoff(e.data.id, 'EMPLOYEE', 'ACKNOWLEDGED');
      else if (a === 'view') this.openReviewModal(e.data);
    },
  };
  readonly teamReviewCols: ColDef[] = [
    { headerName: 'Employee', colId: 'employee', minWidth: 220, flex: 1.3,
      valueGetter: (p: any) => `${p.data?.employee?.firstName || ''} ${p.data?.employee?.lastName || ''}`.trim(),
      cellRenderer: (p: any) => {
        const e = p.data?.employee || {};
        const ini = `${(e.firstName || '?')[0]}${(e.lastName || '')[0] || ''}`.toUpperCase();
        const face = e.avatarUrl ? `<img class="g-avatar" src="${this.esc(e.avatarUrl)}" alt="" style="object-fit:cover">` : `<span class="g-avatar">${this.esc(ini)}</span>`;
        return `<div class="g-person">${face}<strong>${this.esc(p.value)}</strong></div>`;
      } },
    { headerName: 'Cycle', field: 'cycleName', minWidth: 150, flex: 1 },
    { headerName: 'Rating', field: 'rating', minWidth: 120, flex: 0.6, cellRenderer: (p: any) => `<span class="g-stars">${this.stars(p.value)}</span>` },
    { headerName: 'Status', field: 'status', minWidth: 170, flex: 0.9, cellRenderer: (p: any) => this.statusPill(p.value) },
    { headerName: 'Actions', colId: 'actions', minWidth: 230, flex: 1.2, sortable: false, filter: false,
      cellRenderer: (p: any) => `<div class="g-actions">`
        + (p.data?.status === 'SELF_REVIEWED' ? this.btn('edit', 'Give feedback', true) : this.btn('edit', 'View / edit'))
        + (this.isHR() && p.data?.status === 'ACKNOWLEDGED' ? this.btn('hr', 'HR approve', true) : '') + `</div>` },
  ];
  readonly teamReviewGridOptions = {
    headerHeight: 44, rowHeight: 60,
    onCellClicked: (e: any) => {
      const a = this.act(e);
      if (a === 'edit') this.openReviewModal(e.data);
      else if (a === 'hr') this.signoff(e.data.id, 'HR', 'APPROVED');
    },
  };
  readonly cycleCols: ColDef[] = [
    { headerName: 'Name', field: 'name', minWidth: 200, flex: 1.4, cellClass: 'g-strong' },
    { headerName: 'Start date', field: 'startDate', minWidth: 140, flex: 0.8, sort: 'desc',
      valueFormatter: (p: any) => p.value ? new Date(p.value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—' },
    { headerName: 'End date', field: 'endDate', minWidth: 140, flex: 0.8,
      valueFormatter: (p: any) => p.value ? new Date(p.value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—' },
    { headerName: 'Status', field: 'status', minWidth: 140, flex: 0.7, cellRenderer: (p: any) => this.statusPill(p.value) },
  ];
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
    const tab = this.route.snapshot.queryParamMap.get('tab');
    if (tab === 'people') this.activeTab.set('people');
    if (tab === 'probation') this.activeTab.set('probation');
    this.lifecycle.myPips().subscribe({ next: (l) => this.hasOwnPip.set(l.length > 0), error: () => {} });
    this.loadGoals();
    this.loadReviews();
    this.loadSubordinates();
    this.loadOKRs();
    this.loadCycles();
    this.loadPeerRequests();
  }

  setTab(tab: 'goals' | 'reviews' | 'okrs' | 'cycles' | 'people' | 'probation') {
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
