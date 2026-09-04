import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DragDropModule, CdkDragDrop, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { CandidatesService, JobApplication } from '../../services/candidates.service';
import { JobsService, Job } from '../../services/jobs.service';
import { HotToastService } from '@ngneat/hot-toast';
import { 
  LucideX, LucideLayoutGrid, LucideTable, LucideFileText, 
  LucideMail, LucidePhone, LucideLink, LucideGlobe, LucideBriefcase,
  LucideClock, LucideBuilding, LucideTrash2, LucideSparkles,
  LucideInbox, LucideEye, LucideStar, LucideUsers, LucideAward,
  LucideCheckCircle, LucideXCircle, LucideArrowLeft, LucideChevronRight,
  LucideFilter, LucideDownload, LucideAlertCircle, LucideCheckCircle2,
  LucidePenLine, LucideCopy, LucideExternalLink, LucideChevronDown,
  LucideCheck, LucideMapPin,
  LucideEdit2
} from '@lucide/angular';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, AllCommunityModule, ModuleRegistry } from 'ag-grid-community';

ModuleRegistry.registerModules([AllCommunityModule]);

@Component({
  selector: 'app-candidates',
  standalone: true,
  imports: [
    CommonModule, FormsModule, DragDropModule, AgGridAngular, DatePipe, RouterLink,
    LucideX, LucideLayoutGrid, LucideTable, LucideFileText,
    LucideMail, LucidePhone, LucideLink, LucideGlobe, LucideBriefcase,
    LucideClock, LucideBuilding, LucideTrash2, LucideSparkles,
    LucideInbox, LucideEye, LucideStar, LucideUsers, LucideAward,
    LucideCheckCircle, LucideXCircle, LucideArrowLeft, LucideChevronRight,
    LucideFilter, LucideDownload, LucideAlertCircle, LucideCheckCircle2,
    LucidePenLine, LucideCopy, LucideExternalLink, LucideChevronDown,
    LucideCheck, LucideMapPin,
    LucideEdit2,
  ],
  templateUrl: './candidates.html',
  styleUrls: ['./candidates.css'],
  providers: [DatePipe]
})
export class CandidatesComponent implements OnInit {
  private candidatesService = inject(CandidatesService);
  private jobsService = inject(JobsService);
  private toast = inject(HotToastService);
  private datePipe = inject(DatePipe);
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  viewMode = signal<'KANBAN' | 'TABLE'>('KANBAN');
  
  jobs = signal<Job[]>([]);
  selectedJobId = signal<number | null>(null);

  selectedJob = computed(() => {
    const id = this.selectedJobId();
    if (!id) return null;
    return this.jobs().find(j => j.id === id) || null;
  });

  applications = signal<JobApplication[]>([]);
  
  // Pipeline columns
  colNew = computed(() => this.applications().filter(a => a.status === 'NEW'));
  colReviewing = computed(() => this.applications().filter(a => a.status === 'REVIEWING'));
  colShortlisted = computed(() => this.applications().filter(a => a.status === 'SHORTLISTED'));
  colInterviewing = computed(() => this.applications().filter(a => a.status === 'INTERVIEWING'));
  colOffered = computed(() => this.applications().filter(a => a.status === 'OFFERED'));
  colHired = computed(() => this.applications().filter(a => a.status === 'HIRED'));
  colRejected = computed(() => this.applications().filter(a => a.status === 'REJECTED'));

  // Detail drawer
  selectedApp = signal<JobApplication | null>(null);
  activeTab = signal<'details' | 'interviews'>('details');
  showInterviewForm = signal(false);
  showSalaryPrompt = signal(false);
  pendingStatusChange = signal<{ id: number, status: string } | null>(null);
  offeredSalaryInput = signal<number | null>(null);
  // Both print on the generated offer letter, so they are captured at offer time.
  joiningDateInput = signal<string>('');
  addressInput = signal<string>('');

  pendingCandidate = computed(() => {
    const pending = this.pendingStatusChange();
    if (!pending) return null;
    return this.applications().find(a => a.id === pending.id) || this.selectedApp() || null;
  });

  pendingRejectCandidate = computed(() => {
    const id = this.pendingRejectId();
    if (!id) return null;
    return this.applications().find(a => a.id === id) || this.selectedApp() || null;
  });

  salaryExceedsBudget = computed(() => {
    const cand = this.pendingCandidate();
    const offered = this.offeredSalaryInput();
    if (!cand?.job?.maxSalary || !offered) return false;
    return Number(offered) > Number(cand.job.maxSalary);
  });

  setQuickOfferedSalary(amount: number) {
    this.offeredSalaryInput.set(amount);
  }

  // ── E-signature link sharing ──────────────────────────────
  copiedKey = signal<string | null>(null);

  /** Built client-side so the link always matches the host actually in use. */
  getSigningLink(ol: any): string {
    return `${window.location.origin}${ol?.signingPath || ''}`;
  }

  copyText(value: string, key: string) {
    if (!value) return;
    navigator.clipboard.writeText(value).then(() => {
      this.copiedKey.set(key);
      this.toast.success(key === 'pw' ? 'Password copied' : 'Signing link copied');
      setTimeout(() => { if (this.copiedKey() === key) this.copiedKey.set(null); }, 2000);
    });
  }

  /**
   * Opens the offer modal, seeding the offer-letter fields from whatever the
   * candidate record already has (address falls back to the location they
   * applied with; joining date defaults to two weeks out).
   */
  private openSalaryPrompt(app: JobApplication, status: string) {
    this.pendingStatusChange.set({ id: app.id, status });
    this.offeredSalaryInput.set(app.offeredSalary ?? null);
    this.addressInput.set(app.address || app.currentLocation || '');

    if (app.joiningDate) {
      this.joiningDateInput.set(app.joiningDate.split('T')[0]);
    } else {
      const d = new Date();
      d.setDate(d.getDate() + 14);
      this.joiningDateInput.set(d.toISOString().split('T')[0]);
    }

    this.showSalaryPrompt.set(true);
  }

  showRejectPrompt = signal(false);
  pendingRejectId = signal<number | null>(null);
  rejectReasonInput = signal<string>('');
  
  showAnnexureModal = signal(false);
  annexureData = signal<any>(null);
  isLoadingAnnexure = signal(false);

  offerLetter = signal<any>(null);
  isGeneratingOfferLetter = signal(false);
  
  newInterview = signal<any>({});
  editInterviewMode = signal<number | null>(null);
  isSubmittingInterview = signal<boolean>(false);
  interviews = signal<any[]>([]);
  minDate = new Date().toISOString().slice(0, 16);
  employees = signal<any[]>([]);
  parseInt = parseInt;
  Math = Math;

  isEmpDropdownOpen = signal(false);
  empSearchQuery = signal('');

  selectedEmp = computed(() => {
    const id = this.newInterview().interviewerId;
    return this.employees().find(e => e.id === id) || null;
  });

  filteredEmployees = computed(() => {
    const query = this.empSearchQuery().toLowerCase();
    if (!query) return this.employees();
    return this.employees().filter(e => {
      const matchName = `${e.firstName} ${e.lastName}`.toLowerCase().includes(query);
      const matchDept = e.department?.name?.toLowerCase().includes(query);
      const matchRole = e.designation?.name?.toLowerCase().includes(query);
      return matchName || matchDept || matchRole;
    });
  });

  toggleEmpDropdown() {
    this.isEmpDropdownOpen.set(!this.isEmpDropdownOpen());
    if (this.isEmpDropdownOpen()) {
      this.empSearchQuery.set('');
    }
  }

  closeEmpDropdown() {
    this.isEmpDropdownOpen.set(false);
  }

  selectEmpFromDropdown(id: number | null) {
    this.newInterview.update(v => ({ ...v, interviewerId: id || undefined }));
    this.closeEmpDropdown();
  }
  
  parsedAnswers = computed(() => {
    const app = this.selectedApp();
    if (!app || !app.answers) return [];
    try {
      return JSON.parse(app.answers);
    } catch {
      return [];
    }
  });

  // Table Setup
  defaultColDef: ColDef = { flex: 1, minWidth: 150, filter: true, sortable: true };
  colDefs: ColDef[] = [
    { 
      headerName: 'Candidate', 
      field: 'fullName',
      cellRenderer: (params: any) => {
        if (!params.data) return '';
        const initials = this.getInitials(params.data.fullName);
        return `
          <div style="display: flex; align-items: center; gap: 10px; line-height: 1.2;">
            <div style="width: 32px; height: 32px; border-radius: 50%; background: #e5e7eb; display: flex; align-items: center; justify-content: center; font-weight: 600; color: #4b5563; font-size: 13px;">
              ${initials}
            </div>
            <div>
              <div style="font-weight: 500; color: #111827;">${params.data.fullName}</div>
              <div style="font-size: 12px; color: #6b7280;">${params.data.email}</div>
            </div>
          </div>
        `;
      }
    },
    { headerName: 'Phone', field: 'phone' },
    { headerName: 'Job Title', valueGetter: (p) => p.data?.job?.title || 'Unknown' },
    { headerName: 'Department', valueGetter: (p) => p.data?.job?.department?.name || 'General' },
    { 
      headerName: 'Status', 
      field: 'status',
      cellRenderer: (p: any) => this.renderStatusBadge(p.value)
    },
    { 
      headerName: 'Applied Date', 
      valueGetter: (p) => this.datePipe.transform(p.data?.createdAt, 'MMM d, y, h:mm a') 
    },
    {
      headerName: 'Actions',
      width: 100,
      flex: 0,
      sortable: false,
      filter: false,
      cellRenderer: () => `<button class="btn-primary" style="padding: 4px 8px; font-size: 12px;">View</button>`,
      onCellClicked: (p: any) => this.openApplication(p.data)
    }
  ];

  ngOnInit() {
    this.loadJobs();

    this.route.queryParams.subscribe(params => {
      const qJobId = params['jobId'];
      if (qJobId) {
        this.selectedJobId.set(+qJobId);
      } else {
        this.selectedJobId.set(null);
      }
      this.loadApplications();

      const applicationId = params['applicationId'];
      if (applicationId) {
        this.candidatesService.getApplication(+applicationId).subscribe({
          next: (app) => this.openApplication(app),
          error: () => this.toast.error('Application not found')
        });
      }
    });
  }

  loadJobs() {
    this.jobsService.getJobs().subscribe({
      next: (jobs) => this.jobs.set(jobs),
      error: (err) => console.error('Failed to load jobs', err)
    });
  }

  loadApplications() {
    const jobId = this.selectedJobId() || undefined;
    this.candidatesService.getApplications(jobId).subscribe({
      next: (apps) => this.applications.set(apps),
      error: (err) => this.toast.error('Failed to load applications')
    });
  }

  // Analytics
  showAnalytics = signal<boolean>(false);
  analyticsData = signal<any>(null);

  onFilterChange() {
    const jobId = this.selectedJobId();
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { jobId: jobId || null },
      queryParamsHandling: 'merge'
    });
    this.loadApplications();
  }

  clearJobFilter() {
    this.selectedJobId.set(null);
    this.onFilterChange();
  }

  openAnalytics() {
    this.candidatesService.getAnalytics().subscribe({
      next: (data) => {
        this.analyticsData.set(data);
        this.showAnalytics.set(true);
      },
      error: () => this.toast.error('Failed to load analytics')
    });
  }

  closeAnalytics() {
    this.showAnalytics.set(false);
  }

  getDonutSegments(data: any) {
    if (!data || !data.totalApplications) return [];
    const total = data.totalApplications;
    const stages = [
      { label: 'New', count: data.pipeline.NEW || 0, color: '#2563eb' },
      { label: 'Reviewing', count: data.pipeline.REVIEWING || 0, color: '#8b5cf6' },
      { label: 'Shortlisted', count: data.pipeline.SHORTLISTED || 0, color: '#ea580c' },
      { label: 'Interviewing', count: data.pipeline.INTERVIEWING || 0, color: '#d97706' },
      { label: 'Offered / Hired', count: (data.pipeline.OFFERED || 0) + (data.pipeline.HIRED || 0), color: '#10b981' },
      { label: 'Rejected', count: data.pipeline.REJECTED || 0, color: '#ef4444' },
    ];

    const circumference = 251.32; // 2 * PI * 40
    let currentOffset = 0;

    return stages.map(stage => {
      const pct = total > 0 ? stage.count / total : 0;
      const strokeDasharray = `${pct * circumference} ${circumference}`;
      const strokeDashoffset = -currentOffset;
      currentOffset += pct * circumference;
      return {
        ...stage,
        pct: Math.round(pct * 100),
        strokeDasharray,
        strokeDashoffset
      };
    });
  }

  exportCSV() {
    const apps = this.applications();
    if (apps.length === 0) return;
    
    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += 'ID,Name,Email,Phone,Applied For,Status,Experience,Notice Period,AI Score,Applied Date\n';
    
    apps.forEach(app => {
      const row = [
        app.id,
        `"${app.fullName}"`,
        `"${app.email}"`,
        `"${app.phone}"`,
        `"${app.job?.title || ''}"`,
        app.status,
        `"${app.experienceYears || ''}"`,
        `"${app.noticePeriod || ''}"`,
        app.aiScore || '',
        `"${this.datePipe.transform(app.createdAt, 'medium')}"`
      ];
      csvContent += row.join(',') + '\n';
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `candidates_export_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // --- Kanban Logic ---

  drop(event: CdkDragDrop<JobApplication[]>, newStatus: string) {
    if (event.previousContainer === event.container) {
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
    } else {
      transferArrayItem(
        event.previousContainer.data,
        event.container.data,
        event.previousIndex,
        event.currentIndex,
      );
      
      const movedItem = event.container.data[event.currentIndex];
      
      if (newStatus === 'HIRED' || newStatus === 'OFFERED') {
        this.openSalaryPrompt(movedItem, newStatus);
      } else if (newStatus === 'REJECTED') {
        this.pendingRejectId.set(movedItem.id);
        this.rejectReasonInput.set('');
        this.showRejectPrompt.set(true);
      } else {
        movedItem.status = newStatus;
        this.candidatesService.updateStatus(movedItem.id, newStatus).subscribe({
          next: () => {
            this.toast.success(`Moved ${movedItem.fullName} to ${newStatus}`);
            this.loadApplications(); 
          },
          error: () => {
            this.toast.error('Failed to update status');
            this.loadApplications(); 
          }
        });
      }
    }
  }

  submitSalaryPrompt() {
    const pending = this.pendingStatusChange();
    if (!pending) return;
    
    this.candidatesService.updateStatus(
      pending.id,
      pending.status,
      this.offeredSalaryInput() || undefined,
      undefined,
      this.joiningDateInput() || undefined,
      this.addressInput() || undefined,
    ).subscribe({
      next: (updatedApp) => {
        if (updatedApp.approvalStatus === 'PENDING_APPROVAL') {
          this.toast.success('Salary exceeds maximum. Sent for approval.');
        } else {
          this.toast.success(`Moved to ${updatedApp.status}`);
        }
        this.closeSalaryPrompt();
        this.loadApplications();
        if (this.selectedApp()?.id === updatedApp.id) {
           this.selectedApp.set(updatedApp);
        }
      },
      error: () => {
        this.toast.error('Failed to update status');
        this.closeSalaryPrompt();
        this.loadApplications();
      }
    });
  }

  closeSalaryPrompt() {
    this.showSalaryPrompt.set(false);
    this.pendingStatusChange.set(null);
    this.offeredSalaryInput.set(null);
    this.joiningDateInput.set('');
    this.addressInput.set('');
    this.loadApplications(); // Revert kanban UI if canceled
  }

  submitRejectPrompt() {
    const id = this.pendingRejectId();
    if (!id) return;

    this.candidatesService.updateStatus(id, 'REJECTED', undefined, this.rejectReasonInput().trim() || undefined).subscribe({
      next: (updatedApp) => {
        this.toast.success('Application rejected');
        this.closeRejectPrompt();
        this.loadApplications();
        if (this.selectedApp()?.id === updatedApp.id) {
          this.selectedApp.set(updatedApp);
        }
      },
      error: () => {
        this.toast.error('Failed to reject application');
        this.closeRejectPrompt();
        this.loadApplications();
      }
    });
  }

  closeRejectPrompt() {
    this.showRejectPrompt.set(false);
    this.pendingRejectId.set(null);
    this.rejectReasonInput.set('');
    this.loadApplications(); // Revert kanban UI if canceled
  }

  // --- Detail Drawer ---

  openApplication(app: JobApplication) {
    this.selectedApp.set(app);
    this.activeTab.set('details');
    this.showInterviewForm.set(false);
    this.editInterviewMode.set(null);
    this.newInterview.set({});
    
    // Load interviews if already fetched, or fetch them
    this.loadInterviews(app.id);
    this.loadOfferLetter(app.id);

    // Also load employees for interviewer dropdown if not loaded
    if (this.employees().length === 0) {
      this.http.get<any[]>(`${environment.apiUrl}/employees`).subscribe(emps => {
        this.employees.set(emps);
      });
    }
  }

  closeDrawer() {
    this.selectedApp.set(null);
    this.offeredSalaryInput.set(null);
    this.offerLetter.set(null);
  }

  loadOfferLetter(applicationId: number) {
    this.candidatesService.getOfferLetter(applicationId).subscribe({
      next: (letter) => this.offerLetter.set(letter),
      error: () => this.offerLetter.set(null)
    });
  }

  generateOfferLetter() {
    const app = this.selectedApp();
    if (!app) return;
    this.isGeneratingOfferLetter.set(true);
    this.candidatesService.generateOfferLetter(app.id).subscribe({
      next: (letter) => {
        this.offerLetter.set(letter);
        this.isGeneratingOfferLetter.set(false);
        this.toast.success('Offer letter generated');
      },
      error: (err) => {
        this.isGeneratingOfferLetter.set(false);
        this.toast.error(err?.error?.message || 'Failed to generate offer letter');
      }
    });
  }

  viewAnnexure(applicationId: number) {
    this.isLoadingAnnexure.set(true);
    this.showAnnexureModal.set(true);
    this.candidatesService.getAnnexure(applicationId).subscribe({
      next: (data) => {
        this.annexureData.set(data);
        this.isLoadingAnnexure.set(false);
      },
      error: (err) => {
        console.error('Failed to load annexure', err);
        this.toast.error(err.error?.message || 'Failed to load annexure');
        this.closeAnnexureModal();
      }
    });
  }

  closeAnnexureModal() {
    this.showAnnexureModal.set(false);
    this.annexureData.set(null);
    this.isLoadingAnnexure.set(false);
  }

  printAnnexure() {
    window.print();
  }

  loadInterviews(appId: number) {
    this.candidatesService.getInterviews(appId).subscribe({
      next: (data) => this.interviews.set(data),
      error: () => this.toast.error('Failed to load interviews')
    });
  }

  editScheduledInterview(interview: any) {
    this.editInterviewMode.set(interview.id);
    this.newInterview.set({
      title: interview.title,
      scheduledAt: new Date(new Date(interview.scheduledAt).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16),
      durationMins: interview.durationMins,
      interviewerId: interview.interviewerId,
      locationUrl: interview.locationUrl
    });
    this.showInterviewForm.set(true);
  }

  cancelInterviewForm() {
    this.showInterviewForm.set(false);
    this.editInterviewMode.set(null);
    this.newInterview.set({});
    this.isSubmittingInterview.set(false);
  }

  submitInterview() {
    const app = this.selectedApp();
    if (!app) return;
    const data = this.newInterview();
    if (!data.title || !data.scheduledAt) {
      this.toast.error('Title and Date are required');
      return;
    }
    
    this.isSubmittingInterview.set(true);
    const editId = this.editInterviewMode();
    if (editId) {
      this.candidatesService.updateInterview(editId, data).subscribe({
        next: (res) => {
          this.toast.success('Interview updated');
          this.cancelInterviewForm();
          this.loadInterviews(app.id);
          this.isSubmittingInterview.set(false);
        },
        error: () => {
          this.toast.error('Failed to update interview');
          this.isSubmittingInterview.set(false);
        }
      });
    } else {
      this.candidatesService.scheduleInterview(app.id, data).subscribe({
        next: (res) => {
          this.toast.success('Interview scheduled');
          this.cancelInterviewForm();
          this.loadInterviews(app.id);
          this.isSubmittingInterview.set(false);
        },
        error: () => {
          this.toast.error('Failed to schedule interview');
          this.isSubmittingInterview.set(false);
        }
      });
    }
  }

  updateInterviewStatus(id: number, status: string, rating?: number, feedback?: string) {
    this.candidatesService.updateInterview(id, { status, rating, feedback }).subscribe({
      next: () => {
        this.toast.success('Interview updated');
        const app = this.selectedApp();
        if (app) this.loadInterviews(app.id);
      },
      error: () => this.toast.error('Failed to update interview')
    });
  }

  updateDrawerStatus(newStatus: string) {
    const app = this.selectedApp();
    if (!app) return;
    
    if (newStatus === 'HIRED' || newStatus === 'OFFERED') {
      this.openSalaryPrompt(app, newStatus);
      return;
    }

    if (newStatus === 'REJECTED') {
      this.pendingRejectId.set(app.id);
      this.rejectReasonInput.set('');
      this.showRejectPrompt.set(true);
      return;
    }

    this.candidatesService.updateStatus(app.id, newStatus).subscribe({
      next: (updatedApp) => {
        this.toast.success('Status updated');
        this.selectedApp.set(updatedApp);
        this.loadApplications(); // Sync main board
      },
      error: () => this.toast.error('Failed to update status')
    });
  }

  approveSalary() {
    const app = this.selectedApp();
    if (!app) return;
    this.candidatesService.approveSalary(app.id).subscribe({
      next: () => {
        this.toast.success('Salary approved');
        this.loadApplications();
        if (this.selectedApp()?.id === app.id) {
          this.selectedApp.update(a => ({ ...a!, approvalStatus: 'APPROVED' }));
        }
      },
      error: () => this.toast.error('Failed to approve salary')
    });
  }

  rejectSalary() {
    const app = this.selectedApp();
    if (!app) return;
    this.candidatesService.rejectSalary(app.id).subscribe({
      next: () => {
        this.toast.success('Salary rejected');
        this.loadApplications();
        if (this.selectedApp()?.id === app.id) {
          this.selectedApp.update(a => ({ ...a!, approvalStatus: 'REJECTED' }));
        }
      },
      error: () => this.toast.error('Failed to reject salary')
    });
  }

  onboardCandidate() {
    const app = this.selectedApp();
    if (!app) return;
    
    this.candidatesService.onboardCandidate(app.id).subscribe({
      next: () => {
        this.toast.success('Candidate successfully onboarded as a new Employee!');
        this.closeDrawer();
        this.loadApplications();
      },
      error: (err) => {
        this.toast.error(err.error?.message || 'Failed to onboard candidate');
      }
    });
  }

  deleteApplication() {
    const app = this.selectedApp();
    if (!app) return;

    if (confirm(`Are you sure you want to delete the application for ${app.fullName}?`)) {
      this.candidatesService.deleteApplication(app.id).subscribe({
        next: () => {
          this.toast.success('Application deleted');
          this.closeDrawer();
          this.loadApplications();
        },
        error: () => this.toast.error('Failed to delete application')
      });
    }
  }

  // --- Helpers ---

  getInitials(name: string): string {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  renderStatusBadge(status: string) {
    let color = '#6b7280'; let bg = '#f3f4f6'; let label = status;
    switch(status) {
      case 'NEW': color = '#2563eb'; bg = '#eff6ff'; break;
      case 'REVIEWING': color = '#8b5cf6'; bg = '#f5f3ff'; break;
      case 'SHORTLISTED': color = '#ea580c'; bg = '#fff7ed'; break;
      case 'INTERVIEWING': color = '#d97706'; bg = '#fef3c7'; break;
      case 'OFFERED': color = '#059669'; bg = '#ecfdf5'; break;
      case 'HIRED': color = '#15803d'; bg = '#dcfce7'; break;
      case 'ONBOARDED': color = '#1e3a8a'; bg = '#dbeafe'; break;
      case 'REJECTED': color = '#dc2626'; bg = '#fef2f2'; break;
    }
    return `<span style="background: ${bg}; color: ${color}; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 500;">${label}</span>`;
  }

  scrollToColumn(colName: string) {
    const element = document.querySelector(`.kanban-col-${colName}`) as HTMLElement;
    if (element) {
      const container = element.parentElement;
      if (container) {
        container.scrollTo({
          left: element.offsetLeft - 24,
          behavior: 'smooth'
        });
      }
    }
  }

  getScoreClass(score: number): string {
    if (score >= 80) return 'score-high';
    if (score >= 50) return 'score-medium';
    return 'score-low';
  }

  parsedAiSummary() {
    const app = this.selectedApp();
    if (!app || !app.aiSummary) return null;
    try {
      // The aiSummary is stringified JSON now
      return JSON.parse(app.aiSummary);
    } catch (e) {
      // Fallback for legacy plain text summaries
      return {
        score: app.aiScore || 0,
        strengths: app.aiSummary,
        matchingSkills: [],
        missingSkills: [],
        recommendation: 'CONSIDER'
      };
    }
  }

  getRecommendationClass(rec: string): string {
    switch (rec) {
      case 'STRONG_HIRE': return 'rec-strong';
      case 'CONSIDER': return 'rec-consider';
      case 'NOT_RECOMMENDED': return 'rec-not';
      default: return 'rec-consider';
    }
  }

  // --- Feedback Helpers ---

  getRatingStrokeDasharray(rating: number): string {
    if (!rating) return '0 100';
    const percentage = (rating / 5) * 100;
    return `${percentage} ${100 - percentage}`;
  }

  getRatingColor(rating: number): string {
    if (rating >= 4) return '#10b981'; // Emerald Green
    if (rating === 3) return '#f59e0b'; // Amber
    return '#ef4444'; // Red
  }
}
