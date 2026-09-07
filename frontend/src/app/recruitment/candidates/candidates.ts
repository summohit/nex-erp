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
  LucideEdit2,
  LucideSearch,
  LucideRotateCcw
} from '@lucide/angular';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, AllCommunityModule, ModuleRegistry, RowClassRules, GridOptions, GridApi } from 'ag-grid-community';
import { SearchableSelectComponent, SearchableSelectOption } from '../../shared/components/searchable-select/searchable-select.component';

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
    LucideSearch,
    LucideRotateCcw,
    SearchableSelectComponent,
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
  
  /**
   * The recruitment pipeline, in order. Single source of truth for the Kanban
   * columns, the KPI tiles, the status badges and the table's status filter.
   */
  readonly STAGES: { key: string; label: string; tone: string }[] = [
    { key: 'APPLIED',         label: 'Applied',         tone: 'blue'    },
    { key: 'PHONE_SCREENING', label: 'Phone Screening', tone: 'purple'  },
    { key: 'INTERVIEW',       label: 'Interview',       tone: 'amber'   },
    { key: 'NEGOTIATION',     label: 'Negotiation',     tone: 'orange'  },
    { key: 'OFFERED',         label: 'Offered',         tone: 'emerald' },
    { key: 'HIRED',           label: 'Hired',           tone: 'green'   },
    { key: 'ONBOARDED',       label: 'Onboarded',       tone: 'teal'    },
    { key: 'ON_HOLD',         label: 'On Hold',         tone: 'slate'   },
    { key: 'REJECTED',        label: 'Rejected',        tone: 'red'     },
  ];

  /** Applications grouped by stage key, so the board renders from one loop. */
  byStage = computed<Record<string, JobApplication[]>>(() => {
    const out: Record<string, JobApplication[]> = {};
    for (const s of this.STAGES) out[s.key] = [];
    for (const a of this.filteredApplications()) {
      // Legacy rows may still carry the retired vocabulary.
      const k = this.normaliseStage(a.status);
      (out[k] ||= []).push(a);
    }
    return out;
  });

  stageApps(key: string): JobApplication[] {
    return this.byStage()[key] || [];
  }

  /** Map any retired status onto a current stage. */
  normaliseStage(status: string | undefined): string {
    switch (status) {
      case 'NEW': return 'APPLIED';
      case 'REVIEWING':
      case 'SHORTLISTED': return 'PHONE_SCREENING';
      case 'INTERVIEWING': return 'INTERVIEW';
      default: return status || 'APPLIED';
    }
  }

  stageLabel(key: string): string {
    return this.STAGES.find(s => s.key === this.normaliseStage(key))?.label || key;
  }

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
  gridApi: GridApi | null = null;
  gridOptions: GridOptions = {
    suppressColumnVirtualisation: true,
    rowBuffer: 15,
    animateRows: false,
  };

  defaultColDef: ColDef = { flex: 1, minWidth: 130, filter: true, sortable: true, resizable: true };

  rowClassRules: RowClassRules = {
    'ats-row-rejected': (p: any) => this.normaliseStage(p.data?.status) === 'REJECTED',
    'ats-row-hired': (p: any) => ['HIRED', 'ONBOARDED'].includes(this.normaliseStage(p.data?.status)),
    'ats-row-offered': (p: any) => this.normaliseStage(p.data?.status) === 'OFFERED',
    'ats-row-interview': (p: any) => this.normaliseStage(p.data?.status) === 'INTERVIEW',
    'ats-row-negotiation': (p: any) => this.normaliseStage(p.data?.status) === 'NEGOTIATION',
    'ats-row-screening': (p: any) => ['PHONE_SCREENING', 'SHORTLISTED', 'REVIEWING'].includes(this.normaliseStage(p.data?.status)),
    'ats-row-on-hold': (p: any) => this.normaliseStage(p.data?.status) === 'ON_HOLD',
    'ats-row-applied': (p: any) => this.normaliseStage(p.data?.status) === 'APPLIED',
  };

  colDefs: ColDef[] = [
    { 
      headerName: 'Candidate', 
      field: 'fullName',
      pinned: 'left',
      lockPinned: true,
      suppressMovable: true,
      width: 280,
      minWidth: 260,
      cellRenderer: (params: any) => {
        if (!params.data) return '';
        const initials = this.getInitials(params.data.fullName);
        const grad = this.getAvatarGradient(params.data.fullName);
        const aiScore = params.data.aiScore;
        const scoreBadge = (aiScore !== undefined && aiScore !== null && aiScore > 0)
          ? `<span class="tbl-cand-ai ${this.getScoreClass(aiScore)}">★ ${aiScore}%</span>`
          : '';
        return `
          <div class="tbl-cand-cell">
            <div class="tbl-cand-avatar" style="background: ${grad};">
              ${initials}
            </div>
            <div class="tbl-cand-meta">
              <div class="tbl-cand-name-row">
                <span class="tbl-cand-name" title="${params.data.fullName}">${params.data.fullName}</span>
                ${scoreBadge}
              </div>
              <div class="tbl-cand-email" title="${params.data.email || ''}">${params.data.email || '—'}</div>
            </div>
          </div>
        `;
      }
    },
    { 
      headerName: 'Position', 
      field: 'jobTitle',
      colId: 'position',
      minWidth: 190,
      flex: 1.2,
      valueGetter: (p) => p.data?.job?.title || 'Unknown',
      cellRenderer: (p: any) => `
        <div class="tbl-position-cell">
          <svg class="tbl-pos-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>
          <span class="tbl-position-title" title="${p.value || ''}">${p.value || '—'}</span>
        </div>
      `
    },
    { 
      headerName: 'Department', 
      colId: 'department',
      minWidth: 155,
      flex: 1.0,
      valueGetter: (p) => p.data?.job?.department?.name || 'General',
      cellRenderer: (p: any) => `<span class="tbl-dept-badge">${p.value || 'General'}</span>`
    },
    { 
      headerName: 'Phone', 
      field: 'phone', 
      minWidth: 130,
      flex: 0.85,
      cellRenderer: (p: any) => p.value ? `<span class="tbl-phone">${p.value}</span>` : `<span class="tbl-empty">—</span>`
    },
    {
      headerName: 'Current CTC',
      field: 'currentCtc',
      minWidth: 125,
      flex: 0.8,
      filter: 'agNumberColumnFilter',
      valueFormatter: (p: any) => this.formatCtc(p.value),
      cellRenderer: (p: any) => {
        const ctc = this.formatCtc(p.value);
        return ctc ? `<span class="tbl-ctc-text">${ctc}</span>` : `<span class="tbl-empty">—</span>`;
      }
    },
    {
      headerName: 'Expected CTC',
      field: 'expectedCtc',
      minWidth: 130,
      flex: 0.85,
      filter: 'agNumberColumnFilter',
      valueFormatter: (p: any) => this.formatCtc(p.value),
      cellRenderer: (p: any) => {
        const ctc = this.formatCtc(p.value);
        return ctc ? `<span class="tbl-ctc-text highlight">${ctc}</span>` : `<span class="tbl-empty">—</span>`;
      }
    },
    { 
      headerName: 'Notice Period', 
      field: 'noticePeriod', 
      minWidth: 130,
      flex: 0.85,
      cellRenderer: (p: any) => {
        const np = String(p.value || '').trim();
        if (!np) return '<span class="tbl-empty">—</span>';
        let tone = 'slate';
        const lower = np.toLowerCase();
        if (lower.includes('immediate') || lower.includes('15')) tone = 'emerald';
        else if (lower.includes('30') || lower.includes('1 month')) tone = 'amber';
        return `<span class="tbl-notice-pill tone-${tone}"><span class="notice-dot"></span>${np}</span>`;
      }
    },
    { 
      headerName: 'Location', 
      field: 'currentLocation', 
      minWidth: 145,
      flex: 0.9,
      cellRenderer: (p: any) => {
        const loc = String(p.value || '').trim();
        if (!loc) return '<span class="tbl-empty">—</span>';
        return `<span class="tbl-location"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> ${loc}</span>`;
      }
    },
    {
      headerName: 'Status',
      field: 'status',
      minWidth: 150,
      flex: 0.95,
      filter: true,
      valueGetter: (p: any) => this.stageLabel(p.data?.status),
      cellRenderer: (p: any) => this.renderStatusBadge(p.data?.status)
    },
    { 
      headerName: 'Applied Date', 
      colId: 'appliedDate',
      minWidth: 130,
      flex: 0.85,
      valueGetter: (p) => this.datePipe.transform(p.data?.createdAt, 'MMM d, y'),
      cellRenderer: (p: any) => p.value ? `<span class="tbl-date">${p.value}</span>` : '<span class="tbl-empty">—</span>'
    },
    {
      headerName: '',
      width: 80,
      minWidth: 80,
      maxWidth: 80,
      flex: 0,
      pinned: 'right',
      lockPinned: true,
      suppressMovable: true,
      sortable: false,
      filter: false,
      cellRenderer: () => `<button class="btn-tbl-action" title="View Application">View</button>`,
      onCellClicked: (p: any) => this.openApplication(p.data)
    }
  ];

  onGridReady(params: any) {
    this.gridApi = params.api;
    setTimeout(() => {
      this.gridApi?.sizeColumnsToFit();
      this.gridApi?.refreshCells({ force: true });
    }, 50);
  }

  setViewMode(mode: 'KANBAN' | 'TABLE') {
    this.viewMode.set(mode);
    if (mode === 'TABLE') {
      setTimeout(() => {
        if (this.gridApi) {
          this.gridApi.sizeColumnsToFit();
          this.gridApi.refreshCells({ force: true });
        }
      }, 50);
    }
  }

  onRowClicked(event: any) {
    if (event && event.data) {
      this.openApplication(event.data);
    }
  }

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

  getAvatarGradient(name: string): string {
    const gradients = [
      'linear-gradient(135deg, #4f46e5, #3730a3)', // Indigo
      'linear-gradient(135deg, #0284c7, #0369a1)', // Sky
      'linear-gradient(135deg, #059669, #047857)', // Emerald
      'linear-gradient(135deg, #d97706, #b45309)', // Amber
      'linear-gradient(135deg, #7c3aed, #5b21b6)', // Violet
      'linear-gradient(135deg, #e11d48, #be123c)', // Rose
      'linear-gradient(135deg, #0d9488, #0f766e)', // Teal
    ];
    if (!name) return gradients[0];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const idx = Math.abs(hash) % gradients.length;
    return gradients[idx];
  }

  /**
   * CTC display. The source data is inconsistent: recruiters entered some values
   * in rupees (687171) and others in lakhs-per-annum (5.5, 21.5). A figure under
   * 1000 can't be an annual salary in rupees, so it's read as LPA.
   */
  formatCtc(v: any): string {
    const n = Number(v);
    if (!v || isNaN(n) || n <= 0) return '';
    if (n < 1000) return `₹${n.toFixed(2)} L`;              // entered as LPA
    if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
    if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
    return `₹${n.toLocaleString('en-IN')}`;
  }

  // ── Toolbar filters ────────────────────────────────────────────────────
  searchQuery = signal<string>('');
  filterPosition = signal<string>('');
  filterLocation = signal<string>('');
  filterNotice = signal<string>('');
  filterStatus = signal<string>('');
  filterMinCtc = signal<string>('');
  filterMaxCtc = signal<string>('');

  /** Distinct, sorted values for the dropdowns, taken from the loaded rows. */
  private distinct(pick: (a: any) => string | undefined | null): string[] {
    const set = new Set<string>();
    for (const a of this.applications()) {
      const v = (pick(a) || '').toString().trim();
      if (v) set.add(v);
    }
    return [...set].sort((x, y) => x.localeCompare(y));
  }
  positionOptions = computed(() => this.distinct(a => a.job?.title));
  locationOptions = computed(() => this.distinct(a => a.currentLocation));
  noticeOptions = computed(() => this.distinct(a => a.noticePeriod));

  jobSelectOptions = computed<SearchableSelectOption[]>(() => {
    return this.jobs().map(j => ({
      id: j.id,
      name: `${j.title}${j.department?.name ? ' (' + j.department.name + ')' : ''}`
    }));
  });

  positionSelectOptions = computed<SearchableSelectOption[]>(() => {
    return this.positionOptions().map(p => ({ id: p, name: p }));
  });

  stageSelectOptions = computed<SearchableSelectOption[]>(() => {
    return this.STAGES.map(s => ({ id: s.key, name: s.label }));
  });

  locationSelectOptions = computed<SearchableSelectOption[]>(() => {
    return this.locationOptions().map(l => ({ id: l, name: l }));
  });

  noticeSelectOptions = computed<SearchableSelectOption[]>(() => {
    return this.noticeOptions().map(n => ({ id: n, name: n }));
  });

  activeFilterCount = computed(() => {
    let count = 0;
    if (this.searchQuery().trim()) count++;
    if (this.selectedJobId()) count++;
    if (this.filterPosition()) count++;
    if (this.filterLocation()) count++;
    if (this.filterNotice()) count++;
    if (this.filterStatus()) count++;
    if (this.filterMinCtc() || this.filterMaxCtc()) count++;
    return count;
  });

  hasToolbarFilters = computed(() => this.activeFilterCount() > 0);

  clearToolbarFilters() {
    this.searchQuery.set('');
    this.selectedJobId.set(null);
    this.filterPosition.set('');
    this.filterLocation.set('');
    this.filterNotice.set('');
    this.filterStatus.set('');
    this.filterMinCtc.set('');
    this.filterMaxCtc.set('');
    this.onFilterChange();
  }

  /** Rows after the toolbar filters — expected CTC is compared in its own units. */
  filteredApplications = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const pos = this.filterPosition(), loc = this.filterLocation(), nt = this.filterNotice();
    const st = this.filterStatus();
    const min = parseFloat(this.filterMinCtc()), max = parseFloat(this.filterMaxCtc());
    return this.applications().filter(a => {
      if (q) {
        const matchName = (a.fullName || '').toLowerCase().includes(q);
        const matchEmail = (a.email || '').toLowerCase().includes(q);
        const matchPhone = (a.phone || '').toLowerCase().includes(q);
        const matchJob = (a.job?.title || '').toLowerCase().includes(q);
        if (!matchName && !matchEmail && !matchPhone && !matchJob) return false;
      }
      if (pos && (a.job?.title || '') !== pos) return false;
      if (loc && (a.currentLocation || '') !== loc) return false;
      if (nt && (a.noticePeriod || '') !== nt) return false;
      if (st && this.normaliseStage(a.status) !== st) return false;

      const ctc = Number(a.expectedCtc);
      // Compare like with like: bring LPA-entered values onto the rupee scale.
      const norm = !ctc || isNaN(ctc) ? NaN : (ctc < 1000 ? ctc * 100000 : ctc);
      if (!isNaN(min) && (isNaN(norm) || norm < min * 100000)) return false;
      if (!isNaN(max) && (isNaN(norm) || norm > max * 100000)) return false;
      return true;
    });
  });

  renderStatusBadge(status: string) {
    const key = this.normaliseStage(status);
    const label = this.stageLabel(key);
    const stage = this.STAGES.find(s => s.key === key);
    const tone = stage?.tone || 'slate';
    return `<span class="tbl-status-pill status-${tone}"><span class="status-dot"></span><span class="status-text">${label}</span></span>`;
  }

  scrollToColumn(stageKey: string) {
    // Columns are keyed by data-stage; the CSS class carries the colour tone.
    const element = document.querySelector(`.kanban-col[data-stage="${stageKey}"]`) as HTMLElement;
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
