import { Component, signal, computed, inject, OnInit, ViewChild, ElementRef } from '@angular/core';
import { jobPublicUrl, shareJobOnWhatsApp, copyText } from '../job-share';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  LucidePlus, LucideBriefcase, LucideMapPin, LucideClock, LucideSparkles,
  LucideX, LucideMoreVertical, LucideSearch, LucideBold, LucideItalic,
  LucideList, LucideListOrdered, LucideHelpCircle, LucideTrash2, LucideBuilding,
  LucideUser, LucideChevronDown, LucideCheck, LucideEye, LucideEyeOff, LucideAlertCircle,
  LucideSlidersHorizontal
} from '@lucide/angular';
import { AgGridAngular } from 'ag-grid-angular';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import { ColDef, AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { MasterDataService, Department, Designation, Branch } from '../../services/master-data.service';
import { JobsService, Job } from '../../services/jobs.service';
import { EmployeeService, Employee } from '../../services/employee.service';
import { ActionCellRendererComponent } from '../../shared/components/action-cell-renderer.component';
import { environment } from '../../../environments/environment';
import { HotToastService } from '@ngneat/hot-toast';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header';
import { SearchableSelectComponent } from '../../shared/components/searchable-select/searchable-select.component';
import { DatePresetFilterComponent, DatePreset, DateRange } from '../../shared/components/date-preset-filter/date-preset-filter';

ModuleRegistry.registerModules([AllCommunityModule]);

/** Employment types offered on a job posting. */
const EMPLOYMENT_TYPES = ['Full Time', 'Part Time', 'Contractual', 'Freelancer', 'Internship', 'Trainee'];

declare var Quill: any;

@Component({
  selector: 'app-job-postings',
  standalone: true,
  imports: [
    PageHeaderComponent, DatePresetFilterComponent, SearchableSelectComponent,
    CommonModule, FormsModule, LucidePlus, LucideBriefcase,
    LucideSparkles, LucideX, LucideSearch,
    LucideHelpCircle, LucideTrash2, LucideBuilding,
    LucideUser, LucideChevronDown, LucideCheck, LucideEye, LucideEyeOff,
    LucideAlertCircle, LucideSlidersHorizontal,
    AgGridAngular, DatePipe, SkeletonComponent
  ],
  templateUrl: './job-postings.html',
  styleUrls: ['./job-postings.css'],
  providers: [DatePipe]
})
export class JobPostingsComponent implements OnInit {
  private masterDataService = inject(MasterDataService);
  private router = inject(Router);
  private http = inject(HttpClient);
  private jobsService = inject(JobsService);
  private employeeService = inject(EmployeeService);
  private toast = inject(HotToastService);
  
  @ViewChild('quillContainer') quillContainer!: ElementRef;
  private quillInstance: any = null;

  isLoading = signal<boolean>(true);
  departments = signal<Department[]>([]);
  designations = signal<Designation[]>([]);
  filteredDesignations = signal<Designation[]>([]);
  allDesignations = signal<Designation[]>([]);
  branches = signal<Branch[]>([]);
  hrEmployees = signal<Employee[]>([]);

  jobs = signal<Job[]>([]);

  // KPI Metrics
  activeCount = computed(() => this.jobs().filter(j => (j.status || '').toLowerCase() === 'open').length);
  totalOpeningsCount = computed(() => this.jobs().reduce((acc, j) => acc + (j.totalOpenings || 1), 0));
  totalApplicantsCount = computed(() => this.jobs().reduce((acc, j) => acc + (j.applicants || j._count?.applications || 0), 0));
  activeInterviewsCount = computed(() => {
    const apps = this.totalApplicantsCount();
    return Math.max(12, Math.round(apps * 0.1));
  });

  // Table pagination & filtering state
  page = signal(1);
  pageSize = signal(20);
  readonly pageSizes = [20, 50, 100, 200];
  setPageSize(n: number) { this.pageSize.set(Number(n)); this.page.set(1); }

  /** Recruiters who own at least one posting, for the Recruiter filter (12 Nov 2026). */
  recruiterOptions = computed(() => {
    const seen = new Map<string, string>();
    for (const j of this.jobs() as any[]) {
      if (j?.recruiter?.id != null) seen.set(String(j.recruiter.id), this.getRecruiterName(j));
    }
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  });

  /** Options for the shared searchable dropdowns (same as the Employee pages). */
  readonly modeOptions = [
    { id: 'On-site', name: 'On-site' }, { id: 'Remote', name: 'Remote' }, { id: 'Hybrid', name: 'Hybrid' },
  ];
  setMode(v: string | null) { this.filterWorkLocationType = v || ''; this.onFilterChange(); }
  setRecruiter(v: string | null) { this.filterRecruiter = v || ''; this.onFilterChange(); }

  /** Job state (13 Nov 2026): Overdue = closing date passed, openings still unfilled. */
  filterJobState = '';
  readonly jobStateOptions = [
    { id: 'OPEN', name: 'Open' },
    { id: 'OVERDUE', name: 'Overdue' },
    { id: 'CLOSED', name: 'Closed' },
    { id: 'DRAFT', name: 'Draft' },
  ];
  setJobState(v: string | null) { this.filterJobState = v || ''; this.onFilterChange(); }

  /** Posted-date dropdown (12 Nov 2026), shared with the Employee pages. */
  datePreset: DatePreset = 'ALL';
  onDateRange(r: DateRange) {
    if (!r) { this.filterDuration = 'all'; this.onDurationChange(); return; }
    this.filterPostedFrom = this.toDateInputValue(r.from);
    this.filterPostedTo = this.toDateInputValue(r.to);
    this.onCustomDateChange();
  }

  /**
   * The filter fields are plain properties, which a computed() cannot see
   * change; this tick is bumped on every filter change so the list re-filters
   * at once (12 Nov 2026 — the filters did nothing until something else moved).
   */
  private filterTick = signal(0);
  private refilter() { this.filterTick.update(n => n + 1); }

  filteredJobs = computed(() => {
    this.filterTick();
    let list = this.jobs();
    const query = (this.searchText || '').toLowerCase().trim();
    if (query) {
      list = list.filter(j =>
        (j.title || '').toLowerCase().includes(query) ||
        (j.jobId || '').toLowerCase().includes(query) ||
        (j.department || '').toLowerCase().includes(query) ||
        (j.location || '').toLowerCase().includes(query) ||
        (j.experienceYears || '').toLowerCase().includes(query) ||
        (this.getRecruiterName(j) || '').toLowerCase().includes(query)
      );
    }
    if (this.filterJobState) {
      const st = this.filterJobState;
      list = list.filter(j => {
        const s = String(j.status || '').toUpperCase();
        if (st === 'OVERDUE') return !!(j as any).isOverdue;
        if (st === 'OPEN') return s === 'OPEN' && !(j as any).isOverdue;
        return s === st;
      });
    }
    // Recruiter filter (12 Nov 2026).
    if (this.filterRecruiter) {
      list = list.filter(j => String((j as any).recruiter?.id ?? '') === this.filterRecruiter);
    }
    if (this.filterWorkLocationType) {
      list = list.filter(j =>
        (j.workLocationType || '').toLowerCase() === this.filterWorkLocationType.toLowerCase() ||
        (j.location || '').toLowerCase() === this.filterWorkLocationType.toLowerCase()
      );
    }
    if (this.filterDuration !== 'all' && this.filterPostedFrom) {
      const from = new Date(`${this.filterPostedFrom}T00:00:00`).getTime();
      list = list.filter(j => {
        const d = j.postedDate || j.createdAt;
        return d ? new Date(d).getTime() >= from : true;
      });
    }
    if (this.filterDuration !== 'all' && this.filterPostedTo) {
      const to = new Date(`${this.filterPostedTo}T23:59:59`).getTime();
      list = list.filter(j => {
        const d = j.postedDate || j.createdAt;
        return d ? new Date(d).getTime() <= to : true;
      });
    }
    return list;
  });

  totalFilteredJobs = computed(() => this.filteredJobs().length);
  pageCount = computed(() => Math.ceil(this.totalFilteredJobs() / this.pageSize()) || 1);
  pagedJobs = computed(() => {
    const start = (this.page() - 1) * this.pageSize();
    return this.filteredJobs().slice(start, start + this.pageSize());
  });

  rangeLabel = computed(() => {
    const total = this.totalFilteredJobs();
    if (total === 0) return '0';
    const start = (this.page() - 1) * this.pageSize() + 1;
    const end = Math.min(this.page() * this.pageSize(), total);
    return `${start}–${end}`;
  });

  ngOnInit() {
    this.masterDataService.getDepartments(true).subscribe(res => {
      this.departments.set(res);
    });
    this.masterDataService.getDesignations(true).subscribe(res => {
      this.designations.set(res);
      this.allDesignations.set(res);
    });
    this.masterDataService.getBranches().subscribe(res => {
      this.branches.set(res);
    });
    this.employeeService.getEmployees().subscribe(res => {
      this.hrEmployees.set(res.filter(e => e.department?.name === 'HR' || e.department?.name === 'Human Resources'));
      // Sync selected recruiter if editing
      if (this.jobForm.recruiterId) {
        const hr = this.hrEmployees().find(e => String(e.id) === String(this.jobForm.recruiterId));
        if (hr) this.selectedRecruiterEmployee = hr;
      }
    });
    this.loadJobs();
  }

  loadJobs() {
    this.isLoading.set(true);
    this.jobsService.getJobs().subscribe({
      next: (res) => {
        const mappedJobs = res.map(j => {
          let questions = [];
          if (j.screeningQuestions) {
             try { questions = JSON.parse(j.screeningQuestions); } catch(e) {}
          }
          return {
            ...j,
            // A readable reference for the posting list.  It is based on the
            // immutable creation date, so the label remains stable if the job
            // is edited or its published date changes later.
            jobId: this.formatJobId(j.createdAt),
            department: j.department?.name || 'General',
            designation: j.designation?.name || '',
            location: j.branch?.name || 'Remote',
            address: j.branch?.address || '',
            applicants: j._count?.applications || 0,
            screeningQuestions: questions as any
          };
        });
        mappedJobs.sort((a, b) => {
          const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          if (timeB !== timeA) return timeB - timeA;
          return (b.id || 0) - (a.id || 0);
        });
        this.jobs.set(mappedJobs);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Error fetching jobs', err);
        this.isLoading.set(false);
      }
    });
  }

  private formatJobId(createdAt?: Date): string {
    if (!createdAt) return 'JOB-—';
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return 'JOB-—';
    const formatted = new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    }).format(date).replace(/\//g, '');
    return `JOB-${formatted}`;
  }

  /** Ticking "never expires" clears any date already chosen. */
  onNeverExpiresChange(checked: boolean) {
    if (checked) this.jobForm.endDate = '';
  }

  onDesignationInput() {
    const match = this.allDesignations().find(d => d.name.toLowerCase() === (this.jobForm.designationName || '').toLowerCase());
    this.jobForm.designationId = match ? String(match.id) : '';
  }

  onDepartmentChange() {
    const dept = this.departments().find(d => d.name === this.jobForm.departmentName);
    this.jobForm.departmentId = dept ? String(dept.id) : '';
    const deptId = Number(this.jobForm.departmentId);
    if (deptId) {
      this.filteredDesignations.set(this.designations().filter(d => d.departmentId === deptId));
      this.jobForm.designationId = '';
    } else {
      this.filteredDesignations.set([]);
    }
  }

  onBranchChange() {
    const branch = this.branches().find(b => b.id === Number(this.jobForm.branchId));
    if (branch) {
      this.jobForm.location = branch.name;
      this.jobForm.address = branch.address || branch.name;
    }
  }

  // Grid State
  gridApi: any;
  searchText = '';
  filterStatus = '';
  filterDepartment = '';
  filterRecruiter = '';
  filterLocation = '';
  filterWorkLocationType = '';
  filterEmploymentType = '';
  filterDuration = 'all';
  filterPostedFrom = '2026-01-01';
  filterPostedTo = '2026-12-31';
  filterMonth = '';
  filterYear = '';
  isFilterDrawerOpen = signal(false);

  readonly months = [
    { value: '0', label: 'January' }, { value: '1', label: 'February' },
    { value: '2', label: 'March' }, { value: '3', label: 'April' },
    { value: '4', label: 'May' }, { value: '5', label: 'June' },
    { value: '6', label: 'July' }, { value: '7', label: 'August' },
    { value: '8', label: 'September' }, { value: '9', label: 'October' },
    { value: '10', label: 'November' }, { value: '11', label: 'December' },
  ];

  /** Values are derived from the postings so historical data is always filterable. */
  get postingLocations(): string[] {
    return [...new Set(this.jobs().map(job => job.location).filter(Boolean) as string[])].sort();
  }

  get postingEmploymentTypes(): string[] {
    return [...new Set(this.jobs().map(job => job.type).filter(Boolean))].sort();
  }

  get postingYears(): string[] {
    return [...new Set(this.jobs()
      .map(job => job.postedDate || job.createdAt)
      .filter(Boolean)
      .map(date => String(new Date(date as Date).getFullYear())))]
      .filter(year => year !== 'NaN')
      .sort((a, b) => Number(b) - Number(a));
  }

  defaultColDef: ColDef = {
    flex: 1,
    minWidth: 150,
    filter: true,
    sortable: true
  };

  gridOptions = {
    pagination: true,
    paginationPageSize: 10,
    paginationPageSizeSelector: [10, 25, 50, 100],
    // Let the page own scrolling. This avoids separate vertical and horizontal
    // scrollbars inside the postings table.
    domLayout: 'autoHeight' as const,
    suppressHorizontalScroll: true,
    // Tint each row by posting status — kept light so the status badge and the
    // row-hover highlight both stay readable.
    getRowStyle: (params: any) => {
      switch (params.data?.status) {
        case 'Open':   return { backgroundColor: '#F0FDF4' };  // green-50
        case 'Closed': return { backgroundColor: '#eff6ff' };  // red-50
        case 'Draft':  return { backgroundColor: '#f3efff' };  // yellow-50
        default:       return undefined;
      }
    },
    isExternalFilterPresent: () => this.hasAdditionalFilters(),
    doesExternalFilterPass: (params: any) => this.matchesAdditionalFilters(params.data)
  };

  colDefs: ColDef[] = [
    {
      headerName: 'Job ID',
      field: 'jobId',
      width: 145,
      minWidth: 145,
      flex: 0,
      pinned: 'left',
      cellRenderer: (params: any) => `<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;font-weight:700;color:#2563EB;white-space:nowrap;">${params.value || 'JOB-—'}</span>`,
    },
    { 
      headerName: 'Job Title', 
      field: 'title',
      minWidth: 320,
      flex: 2.3,
      pinned: 'left',
      wrapText: true,
      autoHeight: true,
      cellRenderer: (params: any) => {
        if (!params.value) return '';
        const exp = params.data.experienceYears ? `<span style="font-size: 11px; color: #64748B; margin-left: 6px;">(${params.data.experienceYears})</span>` : '';
        return `<div style="font-weight:600;color:#0F172A;white-space:normal;line-height:18px;padding:7px 0;">${params.value}${exp}</div>`;
      }
    },
    { field: 'experienceYears', headerName: 'Experience', width: 140, flex: 0 },
    { field: 'type', headerName: 'Type', width: 120, flex: 0 },
    {
      field: 'status',
      headerName: 'Status',
      width: 120,
      flex: 0,
      cellRenderer: (params: any) => {
        const val = params.data?.isOverdue ? 'Overdue' : params.value;
        let bg = '#F1F5F9', color = '#475569';
        if (val === 'Overdue') { bg = '#FEE2E2'; color = '#B91C1C'; }
        if (val === 'Open') { bg = '#DCFCE7'; color = '#166534'; }
        if (val === 'Closed') { bg = '#dbeafe'; color = '#595a5b'; }
        if (val === 'Draft') { bg = '#f3efff'; color = '#4f2aa7'; }
        return `<span style="background: ${bg}; color: ${color}; padding: 4px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; text-transform: uppercase;">${val}</span>`;
      }
    },
    {
      headerName: 'Recruiter',
      width: 200,
      flex: 0,
      valueGetter: (params: any) => params.data.recruiter ? `${params.data.recruiter.firstName} ${params.data.recruiter.lastName}` : 'Unassigned',
      cellRenderer: (params: any) => {
        const r = params.data.recruiter;
        if (!r) return '<span style="color:#94a3b8;font-size:13px;">Unassigned</span>';
        const name = `${r.firstName} ${r.lastName}`;
        const initials = (r.firstName?.[0] || '') + (r.lastName?.[0] || '');
        const colors = ['#6366f1','#8b5cf6','#6b3fd6','#6b3fd6','#10b981','#06b6d4','#3b82f6','#6b3fd6'];
        let hash = 0;
        for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
        const bg = colors[Math.abs(hash) % colors.length];
        const avatar = r.avatarUrl
          ? `<img src="${r.avatarUrl}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0;" />`
          : `<div style="width:28px;height:28px;border-radius:50%;background:${bg};color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${initials.toUpperCase()}</div>`;
        return `<div style="display:flex;align-items:center;gap:8px;height:100%;">${avatar}<span style="font-size:13px;color:#0f172a;">${name}</span></div>`;
      }
    },
    {
      headerName: 'Openings',
      width: 120,
      flex: 0,
      valueGetter: (params: any) => {
        const total = params.data.totalOpenings || 1;
        const filled = params.data.applications?.length || 0;
        return `${filled} / ${total}`;
      }
    },
    {
      field: 'postedDate',
      headerName: 'Posted Date',
      valueFormatter: (params: any) => {
        if (!params.value) return '';
        const d = new Date(params.value);
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
      }
    },
    {
      field: 'endDate',
      headerName: 'End Date',
      valueFormatter: (params: any) => {
        if (!params.value) return '—';
        const d = new Date(params.value);
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
      }
    },
    {
      headerName: 'Actions',
      width: 100,
      flex: 0,
      sortable: false,
      filter: false,
      pinned: 'right',
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: {
        onView: (data: any) => this.viewJobDetails(data),
        viewLabel: 'View Details',
        // Sharing a posting only makes sense while it is open to applicants.
        extraActions: [
          { label: 'Share on WhatsApp', show: (d: any) => d?.status === 'OPEN', onClick: (d: any) => this.shareJob(d, 'whatsapp') },
          { label: 'Copy link', show: (d: any) => d?.status === 'OPEN', onClick: (d: any) => this.shareJob(d, 'copy') },
        ],
        onEdit: (data: any) => this.editJob(data),
        onDelete: (data: any) => this.deleteJob(data)
      }
    }
  ];

  /**
   * Opening details from anywhere on the row. Clicks inside the pinned Actions
   * column are ignored so the row handler does not fire alongside a menu choice.
   */
  async shareJob(job: any, how: 'whatsapp' | 'copy') {
    if (!job?.companyId) { this.toast.error('Could not build the careers link for this job'); return; }
    const url = jobPublicUrl(job.companyId, job.id);
    if (how === 'whatsapp') {
      shareJobOnWhatsApp(job.title, job.location, url);
    } else {
      await copyText(url);
      this.toast.success('Job link copied — paste it anywhere to share');
    }
  }

  onRowClicked(event: any) {
    if (event?.column?.getColDef()?.headerName === 'Actions') return;
    if (event?.data) this.viewJobDetails(event.data);
  }

  onGridReady(params: any) {
    this.gridApi = params.api;
    // Apply default Open filter after grid is ready
    setTimeout(() => this.applyFilters(), 0);
  }

  onSearch() {
    if (this.gridApi) {
      this.gridApi.setGridOption('quickFilterText', this.searchText);
    }
  }

  applyFilters() {
    if (!this.gridApi) return;
    const filterModel: any = {};
    if (this.filterStatus) {
      filterModel['status'] = { filterType: 'text', type: 'equals', filter: this.filterStatus };
    }
    if (this.filterDepartment) {
      filterModel['department'] = { filterType: 'text', type: 'equals', filter: this.filterDepartment };
    }
    this.gridApi.setFilterModel(Object.keys(filterModel).length > 0 ? filterModel : null);
    this.gridApi.onFilterChanged();
  }

  private hasAdditionalFilters(): boolean {
    return !!(
      this.filterRecruiter ||
      this.filterLocation ||
      this.filterWorkLocationType ||
      this.filterEmploymentType ||
      this.filterPostedFrom ||
      this.filterPostedTo ||
      this.filterMonth ||
      this.filterYear
    );
  }

  private matchesAdditionalFilters(job: any): boolean {
    const recruiterId = job?.recruiter?.id ? String(job.recruiter.id) : '';
    if (this.filterRecruiter && recruiterId !== this.filterRecruiter) return false;
    if (this.filterLocation && job?.location !== this.filterLocation) return false;
    if (this.filterWorkLocationType && job?.workLocationType !== this.filterWorkLocationType) return false;
    if (this.filterEmploymentType && job?.type !== this.filterEmploymentType) return false;

    const filterDateValue = job?.postedDate || job?.createdAt;
    if (this.filterMonth || this.filterYear) {
      if (!filterDateValue) return false;
      const filterDate = new Date(filterDateValue);
      if (this.filterMonth && filterDate.getMonth() !== Number(this.filterMonth)) return false;
      if (this.filterYear && filterDate.getFullYear() !== Number(this.filterYear)) return false;
    }

    if (this.filterPostedFrom || this.filterPostedTo) {
      const dateValue = job?.postedDate;
      if (!dateValue) return false;
      const date = new Date(dateValue);
      date.setHours(0, 0, 0, 0);
      if (this.filterPostedFrom) {
        const from = new Date(`${this.filterPostedFrom}T00:00:00`);
        if (date < from) return false;
      }
      if (this.filterPostedTo) {
        const to = new Date(`${this.filterPostedTo}T00:00:00`);
        if (date > to) return false;
      }
    }
    return true;
  }

  clearFilters() {
    queueMicrotask(() => this.refilter());
    this.searchText = '';
    this.filterStatus = '';
    this.filterDepartment = '';
    this.filterRecruiter = '';
    this.filterJobState = '';
    this.filterLocation = '';
    this.filterWorkLocationType = '';
    this.filterEmploymentType = '';
    this.filterDuration = 'all';
    this.datePreset = 'ALL';
    this.filterPostedFrom = '2026-01-01';
    this.filterPostedTo = '2026-12-31';
    this.filterMonth = '';
    this.filterYear = '';
    this.page.set(1);
    this.onSearch();
    if (this.gridApi) {
      this.gridApi.setFilterModel(null);
      this.gridApi.onFilterChanged();
    }
  }

  onDurationChange() {
    queueMicrotask(() => this.refilter());
    if (!this.filterDuration || this.filterDuration === 'all') {
      this.filterPostedFrom = '2026-01-01';
      this.filterPostedTo = '2026-12-31';
      this.page.set(1);
      this.applyFilters();
      return;
    }
    if (this.filterDuration === 'custom') {
      this.page.set(1);
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let from = new Date(today);
    let to = new Date(today);

    switch (this.filterDuration) {
      case 'today':
        break;
      case 'last30':
        from.setDate(from.getDate() - 29);
        break;
      case 'thisMonth':
        from = new Date(today.getFullYear(), today.getMonth(), 1);
        break;
      case 'lastMonth':
        from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        to = new Date(today.getFullYear(), today.getMonth(), 0);
        break;
      case 'last90':
        from.setDate(from.getDate() - 89);
        break;
      case 'last6Months':
        from.setMonth(from.getMonth() - 6);
        from.setDate(from.getDate() + 1);
        break;
      case 'lastYear':
        from.setFullYear(from.getFullYear() - 1);
        from.setDate(from.getDate() + 1);
        break;
    }

    this.filterPostedFrom = this.toDateInputValue(from);
    this.filterPostedTo = this.toDateInputValue(to);
    this.page.set(1);
    this.applyFilters();
  }

  onCustomDateChange() {
    queueMicrotask(() => this.refilter());
    this.filterDuration = 'custom';
    this.page.set(1);
    this.applyFilters();
  }

  onFilterChange() {
    queueMicrotask(() => this.refilter());
    this.page.set(1);
    this.applyFilters();
  }

  onSearchInput() {
    queueMicrotask(() => this.refilter());
    this.page.set(1);
    this.onSearch();
  }

  goPage(p: number) {
    this.page.set(Math.min(Math.max(1, p), this.pageCount()));
  }

  hasActiveFilters(): boolean {
    return !!(
      this.searchText ||
      this.filterRecruiter ||
      this.filterJobState ||
      this.filterWorkLocationType ||
      (this.filterDuration && this.filterDuration !== 'all') ||
      this.filterStatus ||
      this.filterDepartment
    );
  }

  getRecruiterName(j: any): string {
    if (j?.recruiter?.firstName) {
      return `${j.recruiter.firstName} ${j.recruiter.lastName || ''}`.trim();
    }
    const hr = this.hrEmployees();
    if (hr && hr.length > 0) {
      const assigned = hr[(j?.id || 0) % hr.length];
      return `${assigned.firstName} ${assigned.lastName || ''}`.trim();
    }
    return 'Aditya Sharma';
  }

  getRecruiterInitials(j: any): string {
    const name = this.getRecruiterName(j);
    const parts = name.split(' ').filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return (name.slice(0, 2) || 'AS').toUpperCase();
  }

  getRecruiterAvatarColor(j: any): string {
    const name = this.getRecruiterName(j);
    const colors = ['#2563eb', '#10b981', '#7c3aed', '#f59e0b', '#dc2626', '#06b6d4', '#4f46e5', '#059669'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  formatTableDate(val?: Date | string): string {
    if (!val) return '—';
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }

  exportCsv() {
    const list = this.filteredJobs();
    if (!list || list.length === 0) {
      this.toast.error('No jobs to export');
      return;
    }
    const headers = ['JOB ID', 'JOB TITLE', 'DEPARTMENT', 'EXPERIENCE', 'TYPE', 'LOCATION', 'STATUS', 'RECRUITER', 'OPENINGS', 'POSTED DATE'];
    const rows = list.map(j => [
      `"${j.jobId || ''}"`,
      `"${(j.title || '').replace(/"/g, '""')}"`,
      `"${(j.department || '').replace(/"/g, '""')}"`,
      `"${j.experienceYears || ''}"`,
      `"${j.type || ''}"`,
      `"${j.workLocationType || j.location || ''}"`,
      `"${(j.status || '').toUpperCase()}"`,
      `"${(this.getRecruiterName(j) || '').replace(/"/g, '""')}"`,
      `"${j.applicants || 0} / ${j.totalOpenings || 1}"`,
      `"${this.formatTableDate(j.postedDate || j.createdAt)}"`
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `job-postings-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    this.toast.success(`Exported ${list.length} job postings to CSV`);
  }

  private toDateInputValue(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  openFilterDrawer() {
    this.isFilterDrawerOpen.set(true);
  }

  closeFilterDrawer() {
    this.isFilterDrawerOpen.set(false);
  }

  // Drawer & Form State
  isCreateModalOpen = signal(false);
  drawerMode = signal<'create' | 'edit' | 'view'>('create');
  selectedJob = signal<Job | null>(null);
  screeningQuestions = signal<string[]>([]);
  newQuestionInput = '';
  requiredSkills = signal<string[]>([]);
  newSkillInput = '';
  
  jobForm: any = {
    title: '',
    departmentId: '',
    departmentName: '',
    designationId: '',
    designationName: '',
    branchId: '',
    experienceYears: '3-5 Years',
    type: 'Full Time',
    typeOther: '',
    workLocationType: 'On-site',
    recruiterId: '',
    recruiterName: '',
    totalOpenings: 1,
    startDate: '',
    endDate: '',
    neverExpires: false,
    discloseSalary: false,
    status: 'Open',
    location: '',
    address: '',
    descriptionHtml: '',
    minSalary: '',
    maxSalary: '',
    aiPrompt: ''
  };

  isSubmitted = false;

  isFieldInvalid(field: string): boolean {
    if (!this.isSubmitted) return false;
    switch (field) {
      case 'department':
        return !this.jobForm.departmentName && !this.jobForm.departmentId;
      case 'title':
        return !this.jobForm.title || !this.jobForm.title.trim();
      case 'type':
        return !this.jobForm.type;
      case 'typeOther':
        return this.jobForm.type === 'Other' && (!this.jobForm.typeOther || !this.jobForm.typeOther.trim());
      case 'endDate':
        return !!(this.jobForm.startDate && this.jobForm.endDate && !this.jobForm.neverExpires && this.jobForm.endDate < this.jobForm.startDate);
      case 'maxSalary':
        return !!(this.jobForm.minSalary && this.jobForm.maxSalary && Number(this.jobForm.maxSalary) < Number(this.jobForm.minSalary));
      default:
        return false;
    }
  }

  onFieldInput(field?: string) {
    // Dynamically re-evaluates isFieldInvalid
  }

  focusFirstInvalidField() {
    const fields = [
      { key: 'department', isInvalid: () => !this.jobForm.departmentName && !this.jobForm.departmentId },
      { key: 'title', isInvalid: () => !this.jobForm.title || !this.jobForm.title.trim() },
      { key: 'type', isInvalid: () => !this.jobForm.type },
      { key: 'typeOther', isInvalid: () => this.jobForm.type === 'Other' && (!this.jobForm.typeOther || !this.jobForm.typeOther.trim()) },
      { key: 'endDate', isInvalid: () => !!(this.jobForm.startDate && this.jobForm.endDate && !this.jobForm.neverExpires && this.jobForm.endDate < this.jobForm.startDate) },
      { key: 'maxSalary', isInvalid: () => !!(this.jobForm.minSalary && this.jobForm.maxSalary && Number(this.jobForm.maxSalary) < Number(this.jobForm.minSalary)) },
    ];

    const first = fields.find(f => f.isInvalid());
    if (!first) return;

    setTimeout(() => {
      const targetLabel = document.querySelector(`[data-field="${first.key}"]`) as HTMLElement | null;
      const targetGroup = targetLabel ? (targetLabel.closest('.form-group') as HTMLElement | null) : null;
      const targetElement = targetGroup || targetLabel;

      if (targetElement) {
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetElement.classList.add('field-highlight-pulse');
        setTimeout(() => targetElement.classList.remove('field-highlight-pulse'), 1500);

        if (first.key === 'department') {
          const trigger = targetElement.querySelector('.custom-select-trigger') as HTMLElement | null;
          trigger?.focus();
          if (!this.deptDropdownOpen) {
            this.toggleDeptDropdown();
          }
        } else {
          const input = targetElement.querySelector('input, select, textarea') as HTMLElement | null;
          input?.focus({ preventScroll: true });
        }
      }
    }, 50);
  }

  // Searchable Dropdowns state
  deptDropdownOpen = false;
  deptSearchQuery = '';
  
  recruiterDropdownOpen = false;
  recruiterSearchQuery = '';
  selectedRecruiterEmployee: Employee | null = null;

  toggleDeptDropdown() {
    this.deptDropdownOpen = !this.deptDropdownOpen;
    if (this.deptDropdownOpen) {
      this.deptSearchQuery = '';
      this.recruiterDropdownOpen = false;
    }
  }

  selectDepartment(dept: Department) {
    this.jobForm.departmentId = String(dept.id);
    this.jobForm.departmentName = dept.name;
    this.deptDropdownOpen = false;
    this.onDepartmentChange();
  }

  get filteredDepartmentOptions(): Department[] {
    const q = this.deptSearchQuery.toLowerCase().trim();
    if (!q) return this.departments();
    return this.departments().filter(d => d.name.toLowerCase().includes(q));
  }

  toggleRecruiterDropdown() {
    this.recruiterDropdownOpen = !this.recruiterDropdownOpen;
    if (this.recruiterDropdownOpen) {
      this.recruiterSearchQuery = '';
      this.deptDropdownOpen = false;
    }
  }

  selectRecruiter(emp: Employee | null) {
    if (!emp) {
      this.jobForm.recruiterId = '';
      this.jobForm.recruiterName = '';
      this.selectedRecruiterEmployee = null;
    } else {
      this.jobForm.recruiterId = String(emp.id);
      this.jobForm.recruiterName = `${emp.firstName} ${emp.lastName}`;
      this.selectedRecruiterEmployee = emp;
    }
    this.recruiterDropdownOpen = false;
  }

  get filteredRecruiterOptions(): Employee[] {
    const q = this.recruiterSearchQuery.toLowerCase().trim();
    if (!q) return this.hrEmployees();
    return this.hrEmployees().filter(e => 
      `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
      `${e.user?.email || ''}`.toLowerCase().includes(q)
    );
  }

  getInitials(firstName?: string, lastName?: string): string {
    const f = firstName ? firstName.charAt(0).toUpperCase() : '';
    const l = lastName ? lastName.charAt(0).toUpperCase() : '';
    return f + l || 'HR';
  }

  getAvatarColor(name: string): string {
    if (!name) return '#6366f1';
    const colors = ['#6366f1', '#8b5cf6', '#6b3fd6', '#6b3fd6', '#10b981', '#06b6d4', '#3b82f6', '#6b3fd6'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  // AI State
  isGeneratingAI = signal(false);

  openCreateModal() {
    this.isSubmitted = false;
    this.deptDropdownOpen = false;
    this.recruiterDropdownOpen = false;
    this.selectedRecruiterEmployee = null;
    this.drawerMode.set('create');
    this.selectedJob.set(null);
    this.screeningQuestions.set([]);
    this.requiredSkills.set([]);
    this.jobForm = { 
      title: '', 
      departmentId: '', 
      departmentName: '',
      designationId: '',
      designationName: '',
      branchId: '',
      experienceYears: '3-5 Years',
      type: 'Full Time',
      typeOther: '',
      workLocationType: 'On-site',
      recruiterId: '',
      recruiterName: '',
      totalOpenings: 1,
      startDate: '',
      endDate: '',
      neverExpires: false,
      discloseSalary: false,
      status: 'Open',
      location: '',
      address: '',
      descriptionHtml: '',
      minSalary: '',
      maxSalary: '',
      aiPrompt: ''
    };
    this.filteredDesignations.set([]);
    this.isCreateModalOpen.set(true);
    setTimeout(() => this.initQuill(), 100);
  }

  closeCreateModal() {
    this.isSubmitted = false;
    this.deptDropdownOpen = false;
    this.recruiterDropdownOpen = false;
    this.isCreateModalOpen.set(false);
  }

  editJob(job: Job) {
    this.isSubmitted = false;
    this.deptDropdownOpen = false;
    this.recruiterDropdownOpen = false;
    this.selectedJob.set(job);
    this.drawerMode.set('edit');
    const dept = this.departments().find(d => d.name.toLowerCase() === job.department.toLowerCase());
    const deptId = dept ? String(dept.id) : '';
    
    if (deptId) {
      this.filteredDesignations.set(this.designations().filter(d => d.departmentId === Number(deptId)));
    }
    const desig = this.designations().find(d => d.name.toLowerCase() === (job.designation || '').toLowerCase());
    const branch = this.branches().find(b => b.name.toLowerCase() === (job.location || '').toLowerCase());
    const hr = this.hrEmployees().find(e => e.id === (job as any).recruiterId);
    this.selectedRecruiterEmployee = hr || null;

    this.jobForm = {
      title: job.title,
      departmentId: deptId,
      departmentName: dept ? dept.name : '',
      designationId: desig ? String(desig.id) : '',
      designationName: desig ? desig.name : (job.designation || ''),
      branchId: branch ? String(branch.id) : '',
      experienceYears: job.experienceYears || '3-5 Years',
      type: EMPLOYMENT_TYPES.includes(job.type) ? job.type : 'Other',
      typeOther: EMPLOYMENT_TYPES.includes(job.type) ? '' : job.type,
      workLocationType: (job as any).workLocationType || 'On-site',
      recruiterId: (job as any).recruiterId ? String((job as any).recruiterId) : '',
      recruiterName: hr ? `${hr.firstName} ${hr.lastName}` : '',
      // 0 is "unlimited" and must survive the round trip into the form.
      totalOpenings: (job as any).totalOpenings ?? 1,
      startDate: (job as any).startDate ? new Date((job as any).startDate).toISOString().split('T')[0] : '',
      endDate: (job as any).endDate ? new Date((job as any).endDate).toISOString().split('T')[0] : '',
      // No end date stored means the posting was set to never expire.
      neverExpires: !(job as any).endDate,
      discloseSalary: (job as any).discloseSalary || false,
      status: job.status || 'Open',
      location: job.location || '',
      address: job.address || branch?.address || '',
      descriptionHtml: job.descriptionHtml || `<h3>About the Role</h3><p>We are seeking an experienced ${job.title} to join our ${job.department} team.</p>`,
      minSalary: job.minSalary || '',
      maxSalary: job.maxSalary || '',
      aiPrompt: ''
    };
    this.screeningQuestions.set((job.screeningQuestions as any) || []);
    this.requiredSkills.set((job as any).requiredSkills || []);
    this.isCreateModalOpen.set(true);
    setTimeout(() => this.initQuill(), 100);
  }

  viewJobDetails(job: Job) {
    this.router.navigate(['/recruitment/jobs', job.id]);
  }

  deleteJob(job: Job) {
    if (confirm(`Are you sure you want to delete the job posting "${job.title}"?`)) {
      this.jobsService.deleteJob(job.id).subscribe({
        next: () => {
          this.jobs.update(jobs => jobs.filter(j => j.id !== job.id));
        },
        error: (err) => console.error('Error deleting job', err)
      });
    }
  }

  saveJob() {
    this.isSubmitted = true;

    if (
      this.isFieldInvalid('department') ||
      this.isFieldInvalid('title') ||
      this.isFieldInvalid('type') ||
      this.isFieldInvalid('typeOther') ||
      this.isFieldInvalid('endDate') ||
      this.isFieldInvalid('maxSalary')
    ) {
      if (this.isFieldInvalid('department') && this.isFieldInvalid('title')) {
        this.toast.error('Please enter Department and Custom Job Title');
      } else if (this.isFieldInvalid('department')) {
        this.toast.error('Department is required');
      } else if (this.isFieldInvalid('title')) {
        this.toast.error('Custom Job Title is required');
      } else if (this.isFieldInvalid('type') || this.isFieldInvalid('typeOther')) {
        this.toast.error('Employment Type is required');
      } else if (this.isFieldInvalid('endDate')) {
        this.toast.error('End date cannot be earlier than start date');
      } else if (this.isFieldInvalid('maxSalary')) {
        this.toast.error('Max salary cannot be less than min salary');
      }
      this.focusFirstInvalidField();
      return;
    }

    const dept = this.departments().find(d => d.name === this.jobForm.departmentName);
    const deptId = dept ? dept.id : null;
    const hr = this.hrEmployees().find(e => `${e.firstName} ${e.lastName}` === this.jobForm.recruiterName);
    // Resolve designation: prefer typed name match over stored ID
    const desigByName = this.allDesignations().find(d => d.name.toLowerCase() === (this.jobForm.designationName || '').toLowerCase());
    const desigId = desigByName ? desigByName.id : (Number(this.jobForm.designationId) || null);
    const branchId = Number(this.jobForm.branchId) || null;
    
    const payload = {
      title: this.jobForm.title.trim(),
      departmentId: deptId,
      designationId: desigId,
      branchId: branchId,
      experienceYears: this.jobForm.experienceYears,
      type: this.jobForm.type === 'Other' ? this.jobForm.typeOther : this.jobForm.type,
      workLocationType: this.jobForm.workLocationType,
      recruiterId: hr ? hr.id : null,
      // 0 means "unlimited" in this form, so only an empty box falls back to 1.
      totalOpenings: this.jobForm.totalOpenings === '' || this.jobForm.totalOpenings === null || this.jobForm.totalOpenings === undefined
        ? 1
        : Number(this.jobForm.totalOpenings),
      startDate: this.jobForm.startDate || null,
      endDate: this.jobForm.neverExpires ? null : (this.jobForm.endDate || null),
      discloseSalary: this.jobForm.discloseSalary,
      status: this.jobForm.status,
      minSalary: this.jobForm.minSalary ? Number(this.jobForm.minSalary) : null,
      maxSalary: this.jobForm.maxSalary ? Number(this.jobForm.maxSalary) : null,
      descriptionHtml: this.jobForm.descriptionHtml,
      screeningQuestions: JSON.stringify(this.screeningQuestions()),
      requiredSkills: this.requiredSkills()
    };
    
    if (this.drawerMode() === 'edit' && this.selectedJob()) {
      const currentId = this.selectedJob()!.id;
      this.jobsService.updateJob(currentId, payload).subscribe({
        next: () => {
          this.loadJobs();
          this.closeCreateModal();
          this.toast.success('Job updated!');
        },
        error: (err) => {
          console.error('Error updating job', err);
          this.toast.error('Could not update the job. Please try again.');
        }
      });
    } else {
      this.jobsService.createJob(payload).subscribe({
        next: () => {
          if (this.gridApi) {
            this.gridApi.applyColumnState({
              defaultState: { sort: null }
            });
          }
          this.loadJobs();
          this.closeCreateModal();
          this.toast.success('Job created!');
        },
        error: (err) => {
          console.error('Error creating job', err);
          this.toast.error('Could not create the job. Please try again.');
        }
      });
    }
  }

  /**
   * Ready-made questions the recruiter can tick instead of typing. They are
   * stored as plain strings like custom ones, so nothing downstream has to know
   * whether a question came from this list or was written by hand.
   */
  readonly questionLibrary: string[] = [
    'Tell us about a recent project you are proud of.',
    'What motivates you to do your best work?',
    'Where do you see your career in the next two years?',
    'Why are you interested in this role?',
    'When can you start if selected?',
    'What are your top three technical skills?',
    'What are your salary expectations?',
    'Describe a time you solved a complex problem.',
    'Have you ever led a team? Briefly explain.',
    'Any questions for us?',
  ];

  isQuestionSelected(question: string): boolean {
    return this.screeningQuestions().includes(question);
  }

  toggleLibraryQuestion(question: string) {
    this.screeningQuestions.update(list =>
      list.includes(question)
        ? list.filter(q => q !== question)
        : [...list, question]
    );
  }

  addScreeningQuestion() {
    const text = this.newQuestionInput.trim();
    // Silently ignore a duplicate — two identical questions would collide in the
    // answers map, which is keyed by question text.
    if (text && !this.screeningQuestions().includes(text)) {
      this.screeningQuestions.update(q => [...q, text]);
    }
    this.newQuestionInput = '';
  }

  removeScreeningQuestion(index: number) {
    this.screeningQuestions.update(q => q.filter((_, i) => i !== index));
  }

  suggestedSkills = ['Cisco ACI', 'Python', 'AWS', 'Network Routing', 'BGP', 'Firewall', 'Troubleshooting', 'Communication', 'Docker', 'Linux'];

  addRequiredSkill(skillName?: string) {
    const raw = (skillName || this.newSkillInput).trim();
    if (!raw) return;

    const skills = raw.split(/[,;\n]+/).map(s => s.trim()).filter(s => s.length > 0);
    this.requiredSkills.update(current => {
      const updated = [...current];
      for (const s of skills) {
        if (!updated.some(existing => existing.toLowerCase() === s.toLowerCase())) {
          updated.push(s);
        }
      }
      return updated;
    });

    if (!skillName) {
      this.newSkillInput = '';
    }
  }

  removeRequiredSkill(index: number) {
    this.requiredSkills.update(s => s.filter((_, i) => i !== index));
  }

  initQuill() {
    if (!this.quillContainer) return;
    
    if (!this.quillInstance) {
      if (typeof Quill === 'undefined') {
        console.warn('Quill is loading...');
        setTimeout(() => this.initQuill(), 200);
        return;
      }

      const toolbarOptions = [
        [{ 'header': [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        ['blockquote', 'code-block'],
        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
        [{ 'script': 'sub'}, { 'script': 'super' }],
        [{ 'indent': '-1'}, { 'indent': '+1' }],
        [{ 'color': [] }, { 'background': [] }],
        [{ 'align': [] }],
        ['link', 'clean']
      ];

      this.quillInstance = new Quill(this.quillContainer.nativeElement, {
        modules: { toolbar: toolbarOptions },
        theme: 'snow',
        placeholder: 'Compose job description...'
      });

      this.quillInstance.on('text-change', () => {
        this.jobForm.descriptionHtml = this.quillInstance.root.innerHTML;
      });
    }

    if (this.quillInstance) {
      this.quillInstance.clipboard.dangerouslyPasteHTML(this.jobForm.descriptionHtml || '');
    }
  }

  async generateWithAI() {
    const desig = this.designations().find(d => d.id === Number(this.jobForm.designationId))?.name || this.jobForm.title;
    if (!desig && !this.jobForm.aiPrompt) return;
    
    this.isGeneratingAI.set(true);
    
    const dept = this.departments().find(d => d.id === Number(this.jobForm.departmentId))?.name || 'General';

    try {
      const response: any = await firstValueFrom(
        this.http.post(`${environment.apiUrl}/ai/generate-job-description`, {
          title: desig || 'Professional',
          department: dept,
          location: this.jobForm.location,
          instructions: `Required Experience: ${this.jobForm.experienceYears}. ${this.jobForm.aiPrompt || ''}`
        })
      );

      const rawText: string = response.result || '';

      // Separate Screening Questions from main Job Description
      let descriptionPart = rawText;
      let extractedQuestions: string[] = [];

      const questionsMatch = rawText.match(/(###?\s*Suggested Screening Questions[\s\S]*)/i);
      if (questionsMatch) {
        const questionsBlock = questionsMatch[1];
        descriptionPart = rawText.replace(questionsBlock, '').trim();

        // Extract numbered questions
        const matches = questionsBlock.match(/\d+\.\s+([^\n]+)/g);
        if (matches) {
          extractedQuestions = matches.map(q => q.replace(/^\d+\.\s+/, '').trim());
        }
      }

      this.screeningQuestions.set(extractedQuestions);

      // Convert Markdown to clean HTML
      const htmlContent = this.convertMarkdownToHtml(descriptionPart);
      this.jobForm.descriptionHtml = htmlContent;

      if (this.quillInstance) {
        this.quillInstance.clipboard.dangerouslyPasteHTML(htmlContent);
      }

    } catch (err: any) {
      console.error('Groq AI Generation error:', err);
      const errHtml = '<p style="color: #1373e5;">Failed to generate job description. Please ensure your Groq API key is set and backend is running.</p>';
      this.jobForm.descriptionHtml = errHtml;
      if (this.quillInstance) {
        this.quillInstance.clipboard.dangerouslyPasteHTML(errHtml);
      }
    } finally {
      this.isGeneratingAI.set(false);
    }
  }

  private convertMarkdownToHtml(md: string): string {
    if (!md) return '';
    let html = md
      .replace(/^### (.*$)/gim, '<h3 style="font-size: 15px; font-weight: 700; color: #0f172a; margin-top: 16px; margin-bottom: 6px;">$1</h3>')
      .replace(/^#### (.*$)/gim, '<h4 style="font-size: 13px; font-weight: 700; color: #0f172a; margin-top: 12px; margin-bottom: 4px;">$1</h4>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/^\* (.*$)/gim, '<li>$1</li>')
      .replace(/^- (.*$)/gim, '<li>$1</li>')
      .replace(/^• (.*$)/gim, '<li>$1</li>');

    html = html.replace(/\n\n/g, '<br>').replace(/\n/g, '<br>');
    return html;
  }
}
