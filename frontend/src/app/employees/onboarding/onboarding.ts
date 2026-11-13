import { Component, OnInit, inject, signal, Output, EventEmitter, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header';
import { FormsModule } from '@angular/forms';
import { DragDropModule, CdkDragDrop, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { OnboardingService, OnboardingTemplate, OnboardingBoardData } from '../../services/onboarding.service';
import { HotToastService } from '@ngneat/hot-toast';
import { ProfileModalService } from '../../shared/profile-modal/profile-modal.service';
import { DatePresetFilterComponent, DatePreset, DateRange, inDateRange } from '../../shared/components/date-preset-filter/date-preset-filter';
import {
  LucidePlus,
  LucideX,
  LucideSettings,
  LucideListTodo,
  LucideCheckCircle2,
  LucideClock,
  LucideGripVertical,
  LucideLayoutGrid,
  LucideTable,
  LucideSearch,
  LucideUser,
  LucideUsers,
  LucideExternalLink,
  LucideAlertCircle,
  LucideCheck,
  LucideCalendar,
  LucideSparkles,
  LucideTrash2,
  LucideRefreshCw
} from '@lucide/angular';
import { AgGridAngular } from 'ag-grid-angular';
import { CandidatesService } from '../../services/candidates.service';
import { EmployeeService } from '../../services/employee.service';
import { ColDef, AllCommunityModule, ModuleRegistry } from 'ag-grid-community';

ModuleRegistry.registerModules([AllCommunityModule]);

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [
    CommonModule,
    PageHeaderComponent,
    DatePresetFilterComponent,
    FormsModule,
    DragDropModule,
    LucidePlus,
    LucideX,
    LucideSettings,
    LucideListTodo,
    LucideCheckCircle2,
    LucideClock,
    LucideGripVertical,
    LucideLayoutGrid,
    LucideTable,
    LucideSearch,
    LucideUser,
    LucideUsers,
    LucideExternalLink,
    LucideAlertCircle,
    LucideCheck,
    LucideCalendar,
    LucideSparkles,
    LucideTrash2,
    LucideRefreshCw,
    AgGridAngular
  ],
  templateUrl: './onboarding.html',
  styleUrls: ['./onboarding.css']
})
export class OnboardingComponent implements OnInit {
  private onboardingService = inject(OnboardingService);
  private toast = inject(HotToastService);
  profileModal = inject(ProfileModalService);

  boardData = signal<OnboardingBoardData>({ pending: [], inProgress: [], completed: [] });
  templates = signal<OnboardingTemplate[]>([]);
  isLoading = signal<boolean>(true);

  viewMode = signal<'KANBAN' | 'TABLE'>('TABLE');
  searchTerm = signal('');
  /** Department and joining-date filters (12 Nov 2026), as on the other Employee pages. */
  selectedDepartment = signal<string>('ALL');
  datePreset = signal<DatePreset>('ALL');
  dateRange = signal<DateRange>(null);
  departments = computed(() => {
    const d = this.boardData();
    const all = [...(d?.pending || []), ...(d?.inProgress || []), ...(d?.completed || [])];
    return [...new Set(all.map((e: any) => e.department?.name).filter(Boolean))].sort() as string[];
  });

  resetFilters() {
    this.searchTerm.set('');
    this.selectedDepartment.set('ALL');
    this.datePreset.set('ALL');
    this.dateRange.set(null);
  }

  // Summary Metrics
  totalCount = computed(() => {
    const d = this.boardData();
    return (d.pending?.length || 0) + (d.inProgress?.length || 0) + (d.completed?.length || 0);
  });
  pendingCount = computed(() => this.boardData().pending?.length || 0);
  inProgressCount = computed(() => this.boardData().inProgress?.length || 0);
  completedCount = computed(() => this.boardData().completed?.length || 0);
  completionRate = computed(() => {
    const total = this.totalCount();
    if (!total) return 0;
    return Math.round((this.completedCount() / total) * 100);
  });

  filteredBoardData = computed(() => {
    const term = this.searchTerm().toLowerCase().trim();
    const dept = this.selectedDepartment();
    const range = this.dateRange();
    const data = this.boardData();
    if (!term && dept === 'ALL' && !range) return data;

    const filterFn = (emp: any) => {
      if (dept !== 'ALL' && emp.department?.name !== dept) return false;
      if (!inDateRange(emp.joiningDate, range)) return false;
      if (!term) return true;
      const name = `${emp.firstName || ''} ${emp.lastName || ''}`.toLowerCase();
      const designation = (emp.designation?.name || '').toLowerCase();
      const department = (emp.department?.name || '').toLowerCase();
      const code = (emp.employeeCode || '').toLowerCase();
      return name.includes(term) || designation.includes(term) || department.includes(term) || code.includes(term);
    };

    return {
      pending: data.pending.filter(filterFn),
      inProgress: data.inProgress.filter(filterFn),
      completed: data.completed.filter(filterFn)
    };
  });

  tableData = computed(() => {
    const data = this.filteredBoardData();
    return [...data.pending, ...data.inProgress, ...data.completed];
  });

  defaultColDef: ColDef = {
    flex: 1,
    minWidth: 150,
    filter: true,
    sortable: true
  };

  colDefs: ColDef[] = [
    { 
      headerName: 'Employee',
      field: 'firstName',
      minWidth: 280,
      cellRenderer: (params: any) => {
        if (!params.data) return '';
        const initials = this.getInitials(params.data.firstName, params.data.lastName);
        const bg = this.getAvatarBg(params.data.id);
        const avatar = params.data.avatarUrl
          ? `<img src="${params.data.avatarUrl}" style="width:34px;height:34px;border-radius:50%;object-fit:cover;flex-shrink:0;border:1px solid #e2e8f0;" onerror="this.style.display='none'" />`
          : `<div style="width:34px;height:34px;border-radius:50%;background:${bg};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;flex-shrink:0;">${initials}</div>`;
        return `
          <div style="display: flex; align-items: center; gap: 10px; line-height: 1.25; cursor: pointer;">
            ${avatar}
            <div style="min-width: 0; overflow: hidden;">
              <div style="font-weight: 600; color: #0f172a; white-space: nowrap; text-overflow: ellipsis; overflow: hidden;">${params.data.firstName} ${params.data.lastName || ''}</div>
              <div style="font-size: 11.5px; color: #64748b; margin-top: 1px;">#${params.data.employeeCode || 'N/A'} • ${params.data.designation?.name || 'No Designation'}</div>
            </div>
          </div>
        `;
      },
      onCellClicked: (params: any) => {
        this.openUserProfile(params.data?.id);
      }
    },
    {
      headerName: 'Department',
      field: 'department.name',
      valueGetter: (params) => params.data?.department?.name || '—',
      minWidth: 160
    },
    { 
      field: 'onboardingStatus', 
      headerName: 'Status',
      minWidth: 140,
      cellRenderer: (params: any) => {
        if (!params.value) return '';
        const statusStr = params.value;
        let color = '#d97706'; let bg = '#fef3c7'; let label = 'Not Started';
        if (statusStr === 'IN_PROGRESS') { color = '#2563eb'; bg = '#eff6ff'; label = 'In Progress'; }
        if (statusStr === 'COMPLETED') { color = '#059669'; bg = '#ecfdf5'; label = 'Completed'; }
        // align-self/height: the grid cell is a stretching flex box, which pulled the tag to full row height.
        return `<span style="align-self: center; height: auto; line-height: 1.4; background: ${bg}; color: ${color}; padding: 3px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;">${label}</span>`;
      }
    },
    {
      headerName: 'Progress',
      minWidth: 180,
      valueGetter: (params) => {
        return this.getProgressPercentage(params.data?.onboardingTasks);
      },
      cellRenderer: (params: any) => {
        if (!params.data) return '';
        const percent = this.getProgressPercentage(params.data.onboardingTasks);
        const completed = this.getCompletedCount(params.data.onboardingTasks);
        const total = params.data.onboardingTasks?.length || 0;
        const color = percent === 100 ? '#10b981' : (percent > 0 ? '#2563eb' : '#94a3b8');
        return `
          <div style="width: 100%; display: flex; align-items: center; gap: 10px;">
            <div style="flex: 1; height: 6px; background: #f1f5f9; border-radius: 4px; overflow: hidden;">
              <div style="width: ${percent}%; height: 100%; background: ${color}; border-radius: 4px;"></div>
            </div>
            <span style="font-size: 12px; font-weight: 600; color: #475569; min-width: 42px;">${completed}/${total}</span>
          </div>
        `;
      }
    },
    { 
      headerName: 'Action',
      width: 120,
      flex: 0,
      sortable: false,
      filter: false,
      cellRenderer: (params: any) => {
        const label = params.data?.onboardingStatus === 'PENDING' ? 'Start onboarding' : 'View tasks';
        return `<button style="padding: 5px 12px; font-size: 12px; font-weight: 600; border-radius: 6px; background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; cursor: pointer;">${label}</button>`;
      },
      onCellClicked: (params: any) => {
        this.openChecklist(params.data);
      }
    }
  ];

  isTemplateModalOpen = signal(false);
  newTemplate = { title: '', description: '' };
  isSaving = signal(false);

  selectedEmployee = signal<any>(null);
  isChecklistPanelOpen = signal(false);

  @Output() statusChanged = new EventEmitter<{ empId: number, status: string }>();

  drop(event: CdkDragDrop<any[]>) {
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
      let newStatus = 'PENDING';
      if (event.container.id === 'inProgressList') newStatus = 'IN_PROGRESS';
      if (event.container.id === 'completedList') newStatus = 'COMPLETED';
      
      this.statusChanged.emit({ empId: movedItem.id, status: newStatus });
      this.boardData.set({ ...this.boardData() });

      this.onboardingService.updateEmployeeStatus(movedItem.id, newStatus).subscribe({
        error: () => this.toast.error('Failed to update status')
      });
    }
  }

  ngOnInit() {
    this.loadBoard();
    this.loadSelfQueue();
    this.loadReadyToOnboard();
  }

  // --- Hired candidates who don't have a login yet (13 Nov 2026) ---
  private candidatesService = inject(CandidatesService);
  readyToOnboard = signal<any[]>([]);
  /** Which list the page shows (13 Nov 2026). */
  section = signal<'hires' | 'ready' | 'reviews'>('hires');
  /** Hired candidates whose joining date is over 30 days old are almost always stale records. */
  showOlderHires = signal(false);
  private isRecentHire(a: any): boolean {
    const cutoff = Date.now() - 30 * 86400000;
    const when = a.joiningDate || a.updatedAt;
    return !when || new Date(when).getTime() >= cutoff;
  }
  recentHires = computed(() => this.readyToOnboard().filter(a => this.isRecentHire(a)));
  olderHires = computed(() => this.readyToOnboard().filter(a => !this.isRecentHire(a)));
  startingId = signal<number | null>(null);

  loadReadyToOnboard() {
    this.candidatesService.getApplications().subscribe({
      next: (apps: any[]) => this.readyToOnboard.set((apps || []).filter(a => {
        if (a.status !== 'HIRED' || a.approvalStatus === 'PENDING_APPROVAL') return false;
        try { return !JSON.parse(a.answers || '{}')?.__traineeConversion?.sourceTraineeId; } catch { return true; }
      })),
      error: () => this.readyToOnboard.set([]),
    });
  }

  /** Creates the employee login and emails the temporary password. */
  startOnboarding(app: any) {
    this.startingId.set(app.id);
    this.candidatesService.onboardCandidate(app.id).subscribe({
      next: (res: any) => {
        if (res?.credentialsEmailed === false) this.toast.error(`Onboarding started, but the login email to ${app.email} failed.`);
        else this.toast.success(`Onboarding started — login details emailed to ${app.email}`);
        this.startingId.set(null);
        this.loadReadyToOnboard();
        this.loadSelfQueue();
        this.loadBoard();
      },
      error: (err) => { this.toast.error(err?.error?.message || 'Could not start onboarding'); this.startingId.set(null); },
    });
  }

  // --- Profile reviews (self-service onboarding, 13 Nov 2026) ---
  readonly selfSections = [
    { key: 'personal', label: 'Personal information' },
    { key: 'contact', label: 'Private contact & banking' },
    { key: 'address', label: 'Location & address' },
    { key: 'family', label: 'Family details' },
    { key: 'emergency', label: 'Emergency contacts' },
    { key: 'documents', label: 'Documents' },
    { key: 'resume', label: 'Resume & skills' },
  ];
  selfQueue = signal<any[]>([]);
  selfSubmittedCount = computed(() => this.selfQueue().filter(e => e.selfOnboardingStatus === 'SUBMITTED').length);
  reviewing = signal<any>(null);
  reviewNotes = signal<Record<string, string>>({});
  reviewBusy = signal(false);
  hasReviewNotes = computed(() => Object.values(this.reviewNotes()).some(v => v && v.trim()));

  loadSelfQueue() {
    this.onboardingService.getSelfOnboardingQueue().subscribe({
      next: (rows) => this.selfQueue.set(rows || []),
      error: () => this.selfQueue.set([]),
    });
  }

  selfStatusLabel(s: string): string {
    return ({ PENDING: 'Filling in', SUBMITTED: 'Waiting for review', CHANGES_REQUESTED: 'Sent back' } as Record<string, string>)[s] || s;
  }

  private employeeService = inject(EmployeeService);
  /** Full profile of the person being reviewed, loaded when the pop-up opens. */
  reviewProfile = signal<any>(null);
  reviewLoading = signal(false);

  openSelfReview(e: any) {
    this.reviewNotes.set({ ...(e.selfOnboardingStatus === 'CHANGES_REQUESTED' ? (e.selfOnboardingNotes || {}) : {}) });
    this.noteOpen.set({});
    this.expanded.set({});
    this.reviewing.set(e);
    this.reviewProfile.set(null);
    this.reviewLoading.set(true);
    this.employeeService.getProfile(e.id).subscribe({
      next: (p) => { this.reviewProfile.set(p); this.reviewLoading.set(false); },
      error: () => { this.reviewLoading.set(false); this.toast.error('Could not load the profile'); },
    });
  }

  canDecide = computed(() => this.reviewing()?.selfOnboardingStatus === 'SUBMITTED');

  /** What the new joiner entered, section by section, for the review pop-up. */
  reviewSections = computed(() => {
    const p = this.reviewProfile();
    if (!p) return [];
    const d = (v: any) => (v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
    const mask = (v: string) => (v ? (v.length > 4 ? '•••• ' + v.slice(-4) : v) : '');
    const f = (label: string, value: any, required = false) => ({ label, value: value === 0 ? '0' : (value || ''), required });
    return [
      { key: 'personal', label: 'Personal information', fields: [
        f('Legal name', [p.salutation, p.firstName, p.lastName].filter(x => !!x).join(' '), true),
        f('Gender', p.gender), f('Date of birth', d(p.dateOfBirth), true),
        f('Place of birth', [p.placeOfBirthCity, p.placeOfBirthCountry].filter(x => !!x).join(', ')),
        f('Nationality', p.nationality), f('ID number', p.identificationNo), f('Passport', p.passportNo),
      ] },
      { key: 'contact', label: 'Private contact & banking', fields: [
        f('Login email', p.user?.email), f('Mobile', p.phone),
        f('Bank', p.bankName), f('Account number', mask(p.bankAccountNumber), true), f('IFSC', p.ifscCode),
      ] },
      { key: 'address', label: 'Location & address', fields: [
        f('Street address', p.address, true), f('City', p.city), f('State', p.state), f('Country', p.country),
        f('PIN code', p.zipCode), f('Home–work distance', p.homeWorkDistanceKm ? p.homeWorkDistanceKm + ' km' : ''),
      ] },
      { key: 'family', label: 'Family details', fields: [
        f('Marital status', p.maritalStatus), f('Spouse', p.spouseName), f('Spouse birthdate', d(p.spouseBirthdate)),
        f('Children', p.childrenCount),
      ] },
      { key: 'emergency', label: 'Emergency contacts', required: true,
        list: (p.emergencyContacts || []).map((c: any) => `${c.name}${c.relationship ? ' (' + c.relationship + ')' : ''} · ${c.mobile || ''}${c.email ? ' · ' + c.email : ''}`) },
      { key: 'documents', label: 'Documents',
        list: (p.documents || []).map((doc: any) => `${doc.fileName}${doc.documentType && doc.documentType !== 'Other' ? ' — ' + doc.documentType : ''}`),
        links: (p.documents || []).map((doc: any) => doc.fileUrl) },
      { key: 'resume', label: 'Resume & skills',
        list: [
          ...(p.resumeLines || []).map((r: any) => `${r.type}: ${r.title}${r.organization ? ' — ' + r.organization : ''}${r.startDate ? ' (' + r.startDate + (r.endDate ? ' – ' + r.endDate : '') + ')' : ''}`),
          ...((p.skills || []).length ? ['Skills: ' + p.skills.map((s: any) => s.name + (s.level ? ' (' + s.level + ')' : '')).join(', ')] : []),
        ] },
    ] as any[];
  });

  /** Per-section summary for the review pop-up: what's filled, what's missing, and a status. */
  reviewSummary = computed(() => this.reviewSections().map((s: any) => {
    if (s.fields) {
      const filled = s.fields.filter((x: any) => !!x.value);
      const missingReq = s.fields.filter((x: any) => x.required && !x.value).map((x: any) => x.label);
      const empty = s.fields.filter((x: any) => !x.required && !x.value).map((x: any) => x.label);
      const status = missingReq.length ? 'missing' : filled.length === s.fields.length ? 'done' : filled.length ? 'partial' : 'empty';
      const rows = s.fields.filter((x: any) => x.value || x.required);
      return { ...s, filled, rows, missingReq, empty, done: filled.length, total: s.fields.length, status };
    }
    const missingReq = s.required && !s.list.length ? ['At least one contact'] : [];
    const status = missingReq.length ? 'missing' : s.list.length ? 'done' : 'empty';
    return { ...s, missingReq, empty: [], done: s.list.length ? 1 : 0, total: 1, status };
  }));

  missingCount = computed(() => this.reviewSummary().reduce((n: number, s: any) => n + s.missingReq.length, 0));
  completion = computed(() => {
    const secs = this.reviewSummary();
    if (!secs.length) return 0;
    const parts = secs.reduce((acc: number, s: any) => acc + (s.total ? s.done / s.total : 0), 0);
    return Math.round((parts / secs.length) * 100);
  });

  /** Sections whose note box is open (a section with a note stays open). */
  noteOpen = signal<Record<string, boolean>>({});
  toggleNote(key: string) { this.noteOpen.update(o => ({ ...o, [key]: !o[key] })); }

  /** Review pop-up: which section cards are open. */
  expanded = signal<Record<string, boolean>>({});
  isExpanded(s: any): boolean {
    const v = this.expanded()[s.key];
    return v === undefined ? (s.status !== 'empty' || !!this.reviewNotes()[s.key]) : v;
  }
  toggleSection(s: any) { this.expanded.update(e => ({ ...e, [s.key]: !this.isExpanded(s) })); }

  lastUpdated = computed(() => {
    const at = this.reviewProfile()?.updatedAt;
    if (!at) return '';
    const mins = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
    const h = Math.round(mins / 60);
    if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
    const d = Math.round(h / 24);
    return `${d} day${d === 1 ? '' : 's'} ago`;
  });

  sectionStatusLabel(s: string): string {
    return ({ done: 'Complete', partial: 'Partly filled', missing: 'Required missing', empty: 'Not started' } as Record<string, string>)[s] || s;
  }

  closeSelfReview() {
    this.reviewing.set(null);
    this.reviewProfile.set(null);
  }

  setReviewNote(key: string, value: string) {
    this.reviewNotes.update(n => ({ ...n, [key]: value }));
  }

  decideSelfReview(decision: 'APPROVE' | 'CHANGES') {
    const e = this.reviewing();
    if (!e) return;
    this.reviewBusy.set(true);
    this.onboardingService.reviewSelfOnboarding(e.id, decision, decision === 'CHANGES' ? this.reviewNotes() : undefined).subscribe({
      next: () => {
        this.toast.success(decision === 'APPROVE'
          ? `${e.firstName}'s onboarding is complete`
          : `Sent back to ${e.firstName} with your notes`);
        this.reviewBusy.set(false);
        this.closeSelfReview();
        this.loadSelfQueue();
        this.loadBoard();
      },
      error: (err) => { this.toast.error(err?.error?.message || 'Could not save the review'); this.reviewBusy.set(false); },
    });
  }

  loadBoard() {
    this.isLoading.set(true);
    this.onboardingService.getOnboardingBoard().subscribe({
      next: (data) => {
        this.boardData.set(data);
        this.isLoading.set(false);
      },
      error: () => {
        this.toast.error('Failed to load onboarding board');
        this.isLoading.set(false);
      }
    });
  }

  loadTemplates() {
    this.onboardingService.getTemplates().subscribe({
      next: (data) => this.templates.set(data),
      error: () => this.toast.error('Failed to load templates')
    });
  }

  openTemplateModal() {
    this.loadTemplates();
    this.isTemplateModalOpen.set(true);
  }

  closeTemplateModal() {
    this.isTemplateModalOpen.set(false);
    this.newTemplate = { title: '', description: '' };
  }

  addTemplate() {
    if (!this.newTemplate.title.trim()) {
      this.toast.error('Title is required');
      return;
    }
    
    this.isSaving.set(true);
    this.onboardingService.addTemplate(this.newTemplate).subscribe({
      next: () => {
        this.toast.success('Task template added');
        this.newTemplate = { title: '', description: '' };
        this.loadTemplates();
        this.isSaving.set(false);
      },
      error: () => {
        this.toast.error('Failed to add template');
        this.isSaving.set(false);
      }
    });
  }

  deleteTemplate(id: number) {
    if (!confirm('Remove this task from the default checklist?')) return;
    this.onboardingService.deleteTemplate(id).subscribe({
      next: () => {
        this.toast.success('Template removed');
        this.loadTemplates();
      },
      error: () => this.toast.error('Failed to remove template')
    });
  }

  getCompletedCount(tasks: any[]): number {
    if (!tasks || !tasks.length) return 0;
    return tasks.filter(t => t.isCompleted).length;
  }

  getProgressPercentage(tasks: any[]): number {
    if (!tasks || !tasks.length) return 0;
    return Math.round((this.getCompletedCount(tasks) / tasks.length) * 100);
  }
  
  getInitials(firstName: string, lastName: string): string {
    const f = (firstName || '').trim().charAt(0);
    const l = (lastName || '').trim().charAt(0);
    return `${f}${l}`.toUpperCase() || 'E';
  }

  getAvatarBg(id: number): string {
    const colors = [
      '#3b82f6', // blue
      '#8b5cf6', // violet
      '#10b981', // emerald
      '#f59e0b', // amber
      '#ec4899', // pink
      '#06b6d4', // cyan
      '#6366f1', // indigo
      '#14b8a6', // teal
    ];
    return colors[Math.abs(id || 0) % colors.length];
  }

  openUserProfile(empId: number, event?: Event) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    if (empId) {
      this.profileModal.open(empId);
    }
  }

  openChecklist(employee: any) {
    this.selectedEmployee.set(employee);
    this.isChecklistPanelOpen.set(true);
  }

  closeChecklist() {
    this.isChecklistPanelOpen.set(false);
    this.selectedEmployee.set(null);
  }

  toggleTask(task: any) {
    const newStatus = !task.isCompleted;
    task.isCompleted = newStatus;
    
    const emp = this.selectedEmployee();
    const completedCount = this.getCompletedCount(emp.onboardingTasks);
    const totalCount = emp.onboardingTasks.length;
    
    const previousStatus = emp.onboardingStatus;
    
    let expectedStatus = emp.onboardingStatus;
    if (completedCount === totalCount && totalCount > 0) {
      expectedStatus = 'COMPLETED';
    } else if (completedCount > 0) {
      expectedStatus = 'IN_PROGRESS';
    } else {
      expectedStatus = 'PENDING';
    }

    if (expectedStatus !== emp.onboardingStatus) {
      emp.onboardingStatus = expectedStatus;
      setTimeout(() => this.loadBoard(), 1000); 
    }

    this.onboardingService.toggleAdminTask(task.id, newStatus).subscribe({
      next: (res) => {
        if (res.newStatus === 'COMPLETED' && previousStatus !== 'COMPLETED') {
           this.toast.success('Employee successfully onboarded!');
        }
        if (res.newStatus !== emp.onboardingStatus) {
           this.loadBoard();
        }
      },
      error: () => {
        task.isCompleted = !newStatus;
        this.toast.error('Failed to update task');
      }
    });
  }
}
