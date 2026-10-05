import { Component, inject, signal, computed, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { HotToastService } from '@ngneat/hot-toast';
import { forkJoin } from 'rxjs';
import {
  LucideCheck,
  LucideX,
  LucideLoader2,
  LucideClock,
  LucideChevronDown,
  LucideChevronRight,
  LucideAlertTriangle,
  LucideSearch,
  LucideFilter,
  LucideRefreshCw,
  LucideHistory,
  LucideCheckCircle2,
  LucideXCircle,
  LucideSlidersHorizontal,
  LucideFolderKanban,
  LucideUser,
  LucideFileText,
  LucideArrowUpDown,
  LucideCalendar,
  LucideSparkles,
  LucideInfo,
  LucideTimer,
  LucideSliders,
  LucideMapPin,
  LucideEye,
  LucideExternalLink,
  LucideUsers,
  LucidePaperclip,
  LucideCheckSquare,
  LucideLayers,
} from '@lucide/angular';
import {
  TaskHoursRequestsService,
  TaskHoursRequest,
  TaskHoursActivity,
} from '../../services/task-hours-requests';
import { ProjectsService, ScopeRequest } from '../../services/projects';
import { BudgetRequestsService, BudgetRequest } from '../../services/budget-requests';
import { DialogService } from '../../shared/services/dialog.service';
import { DialogHostComponent } from '../../shared/components/dialog-host/dialog-host.component';
import {
  VisitLocationRequest,
  VisitLocationRequestCapabilities,
  VisitLocationRequestsService,
} from '../../services/visit-location-requests.service';
import { FieldVisitRequest, FieldVisitRequestsService } from '../../services/field-visit-requests';

export type RequestTabFilter = 'AWAITING' | 'HISTORY' | 'APPROVED' | 'REJECTED' | 'ALL';

/**
 * The kinds of decision a project throws up.
 *
 * Separate tabs rather than one merged stream: the four carry genuinely
 * different facts — hours carry a baseline and a ceiling, a budget request
 * carries money, a task approval carries a two-step state, a scope request
 * carries a scope call and its evidence. Flattening them to a common shape
 * would hide the thing each decision actually turns on.
 */
export type ProjectRequestType = 'HOURS' | 'TASKS' | 'BUDGET' | 'SCOPE' | 'VISIT_LOCATIONS' | 'FIELD_VISITS';
export type RequestSortOption = 'newest' | 'oldest' | 'hours-desc' | 'hours-asc';

@Component({
  selector: 'app-task-hours-requests-tab',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    // This route is a child of the main layout, so the dialog host is already
    // on the page — but importing it here keeps the component self-sufficient
    // if it is ever mounted standalone, which is exactly the trap project
    // detail fell into.
    DialogHostComponent,
    LucideCheck,
    LucideX,
    LucideLoader2,
    LucideClock,
    LucideChevronDown,
    LucideChevronRight,
    LucideAlertTriangle,
    LucideSearch,
    LucideFilter,
    LucideRefreshCw,
    LucideHistory,
    LucideCheckCircle2,
    LucideXCircle,
    LucideSlidersHorizontal,
    LucideFolderKanban,
    LucideUser,
    LucideFileText,
    LucideArrowUpDown,
    LucideCalendar,
    LucideSparkles,
    LucideInfo,
    LucideTimer,
    LucideSliders,
    LucideMapPin,
    LucideEye,
    LucideExternalLink,
    LucideUsers,
    LucidePaperclip,
    LucideCheckSquare,
    LucideLayers,
  ],
  templateUrl: './task-hours-requests-tab.html',
  styleUrls: ['./task-hours-requests-tab.css'],
})
export class TaskHoursRequestsTabComponent {
  private api = inject(TaskHoursRequestsService);
  private toast = inject(HotToastService);

  private projectsApi = inject(ProjectsService);
  private budgetApi = inject(BudgetRequestsService);
  private locationApi = inject(VisitLocationRequestsService);
  private fieldVisitApi = inject(FieldVisitRequestsService);
  private route = inject(ActivatedRoute);
  private dialog = inject(DialogService);

  /** Which kind of decision is on screen. */
  requestType = signal<ProjectRequestType>('HOURS');

  taskApprovals = signal<any[]>([]);
  budgetRequests = signal<BudgetRequest[]>([]);
  scopeRequests = signal<ScopeRequest[]>([]);
  visitLocationRequests = signal<VisitLocationRequest[]>([]);
  /** Field visit requests awaiting a decision this viewer may make. */
  fieldVisitRequests = signal<FieldVisitRequest[]>([]);
  locationCapabilities = signal<VisitLocationRequestCapabilities | null>(null);
  loadingOthers = signal(false);

  /** Raw requests loaded from the server */
  requests = signal<TaskHoursRequest[]>([]);
  loading = signal(true);
  busy = signal<Set<number>>(new Set());

  /** Filter & View states */
  activeTab = signal<RequestTabFilter>('AWAITING');
  searchQuery = signal<string>('');
  selectedProject = signal<string>('ALL');
  selectedRequester = signal<string>('ALL');
  sortBy = signal<RequestSortOption>('newest');

  /** Timelines fetched on demand */
  expanded = signal<Set<number>>(new Set());
  timelines = signal<Record<number, TaskHoursActivity[]>>({});

  /** The row being rejected, and the reason typed */
  rejectingId = signal<number | null>(null);
  rejectReason = '';

  /** The row being approved with custom hours */
  editingHoursId = signal<number | null>(null);
  approvedHoursDraft: number | null = null;

  // ── Metrics & Computed KPI Summaries ───────────────────────────────────────
  openRequests = computed(() => this.requests().filter((r) => r.status === 'REQUESTED'));
  openCount = computed(() => this.openRequests().length);
  openHours = computed(() =>
    this.openRequests().reduce((sum, r) => sum + (r.requestedHours || 0), 0),
  );

  approvedRequests = computed(() => this.requests().filter((r) => r.status === 'APPROVED'));
  approvedCount = computed(() => this.approvedRequests().length);
  approvedHours = computed(() =>
    this.approvedRequests().reduce((sum, r) => sum + (r.approvedHours ?? r.requestedHours ?? 0), 0),
  );

  rejectedRequests = computed(() => this.requests().filter((r) => r.status === 'REJECTED'));
  rejectedCount = computed(() => this.rejectedRequests().length);
  rejectedHours = computed(() =>
    this.rejectedRequests().reduce((sum, r) => sum + (r.requestedHours || 0), 0),
  );

  historyRequests = computed(() => this.requests().filter((r) => r.status !== 'REQUESTED'));
  historyCount = computed(() => this.historyRequests().length);
  historyHours = computed(() =>
    this.historyRequests().reduce((sum, r) => sum + (r.requestedHours || 0), 0),
  );

  totalCount = computed(() => this.requests().length);
  totalHours = computed(() => this.requests().reduce((sum, r) => sum + (r.requestedHours || 0), 0));

  // ── Filter Dropdown Options ───────────────────────────────────────────────
  availableProjects = computed(() => {
    const map = new Map<string, { id: number; name: string; key: string }>();
    for (const r of this.requests()) {
      if (r.issue?.project) {
        map.set(String(r.issue.project.id), r.issue.project);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  });

  availableRequesters = computed(() => {
    const map = new Map<string, { id: number; name: string }>();
    for (const r of this.requests()) {
      if (r.requestedBy) {
        map.set(String(r.requestedBy.id), {
          id: r.requestedBy.id,
          name: this.fullName(r.requestedBy),
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  });

  hasActiveFilters = computed(() => {
    return (
      this.searchQuery().trim().length > 0 ||
      this.selectedProject() !== 'ALL' ||
      this.selectedRequester() !== 'ALL' ||
      this.sortBy() !== 'newest' ||
      this.activeTab() !== 'AWAITING'
    );
  });

  // ── Filtered & Sorted Request List ────────────────────────────────────────
  filteredRequests = computed(() => {
    let list = [...this.requests()];

    // 1. Status / View Tab Filter
    const tab = this.activeTab();
    if (tab === 'AWAITING') {
      list = list.filter((r) => r.status === 'REQUESTED');
    } else if (tab === 'HISTORY') {
      list = list.filter((r) => r.status !== 'REQUESTED');
    } else if (tab === 'APPROVED') {
      list = list.filter((r) => r.status === 'APPROVED');
    } else if (tab === 'REJECTED') {
      list = list.filter((r) => r.status === 'REJECTED');
    }

    // 2. Project Filter
    const proj = this.selectedProject();
    if (proj !== 'ALL') {
      list = list.filter((r) => String(r.issue?.project?.id) === proj);
    }

    // 3. Requester Filter
    const reqer = this.selectedRequester();
    if (reqer !== 'ALL') {
      list = list.filter((r) => String(r.requestedBy?.id) === reqer);
    }

    // 4. Search Filter
    const query = this.searchQuery().trim().toLowerCase();
    if (query) {
      list = list.filter((r) => {
        const taskKey = r.issue?.key?.toLowerCase() || '';
        const taskTitle = r.issue?.title?.toLowerCase() || '';
        const projectName = r.issue?.project?.name?.toLowerCase() || '';
        const reqName = this.fullName(r.requestedBy).toLowerCase();
        const revName = this.fullName(r.reviewedBy).toLowerCase();
        const reason = (r.reason || '').toLowerCase();
        const rejectionReason = (r.rejectionReason || '').toLowerCase();

        return (
          taskKey.includes(query) ||
          taskTitle.includes(query) ||
          projectName.includes(query) ||
          reqName.includes(query) ||
          revName.includes(query) ||
          reason.includes(query) ||
          rejectionReason.includes(query)
        );
      });
    }

    // 5. Sorting
    const sort = this.sortBy();
    list.sort((a, b) => {
      if (sort === 'newest') {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      if (sort === 'oldest') {
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      if (sort === 'hours-desc') {
        return (b.requestedHours || 0) - (a.requestedHours || 0);
      }
      if (sort === 'hours-asc') {
        return (a.requestedHours || 0) - (b.requestedHours || 0);
      }
      return 0;
    });

    return list;
  });

  constructor() {
    this.load();
    // Loaded up front so the tab badge shows how many trips are waiting
    // before anyone clicks into it.
    this.loadFieldVisits();
    this.route.queryParamMap.subscribe((params) => {
      const type = params.get('type');
      if (!this.isRequestType(type)) return;
      this.requestType.set(type);
      if (type !== 'HOURS') this.loadOthers(type);
    });
  }

  private isRequestType(value: string | null): value is ProjectRequestType {
    return (
      value != null && ['HOURS', 'TASKS', 'BUDGET', 'SCOPE', 'VISIT_LOCATIONS', 'FIELD_VISITS'].includes(value)
    );
  }

  load() {
    this.loading.set(true);
    this.api.listAll({ status: 'ALL' }).subscribe({
      next: (rows) => {
        this.requests.set(rows || []);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.toast.error(err?.error?.message || 'Could not load additional hours requests');
      },
    });
  }

  refresh() {
    const type = this.requestType();
    type === 'HOURS' ? this.load() : this.loadOthers(type);
  }

  isCurrentQueueLoading(): boolean {
    return this.requestType() === 'HOURS' ? this.loading() : this.loadingOthers();
  }

  currentPendingCount(): number {
    return this.countFor(this.requestType());
  }

  setActiveTab(tab: RequestTabFilter) {
    this.activeTab.set(tab);
  }

  onProjectChange(val: string) {
    this.selectedProject.set(val);
  }

  onRequesterChange(val: string) {
    this.selectedRequester.set(val);
  }

  onSortChange(val: RequestSortOption) {
    this.sortBy.set(val);
  }

  clearSearch() {
    this.searchQuery.set('');
  }

  clearAllFilters() {
    this.searchQuery.set('');
    this.selectedProject.set('ALL');
    this.selectedRequester.set('ALL');
    this.sortBy.set('newest');
    this.activeTab.set(this.openCount() > 0 ? 'AWAITING' : 'ALL');
  }

  isBusy(id: number) {
    return this.busy().has(id);
  }

  private setBusy(id: number, on: boolean) {
    const next = new Set(this.busy());
    on ? next.add(id) : next.delete(id);
    this.busy.set(next);
  }

  toggleTimeline(r: TaskHoursRequest) {
    const next = new Set(this.expanded());
    if (next.has(r.id)) {
      next.delete(r.id);
      this.expanded.set(next);
      return;
    }
    next.add(r.id);
    this.expanded.set(next);

    if (this.timelines()[r.id]) return;
    this.api.timeline(r.id).subscribe({
      next: (rows) => this.timelines.update((m) => ({ ...m, [r.id]: rows || [] })),
      error: () => this.toast.error('Could not load this request’s history'),
    });
  }

  timelineFor(id: number): TaskHoursActivity[] | null {
    return this.timelines()[id] ?? null;
  }

  startApproveWithEdit(r: TaskHoursRequest) {
    this.cancelReject();
    this.editingHoursId.set(r.id);
    this.approvedHoursDraft = r.requestedHours;
  }

  cancelEdit() {
    this.editingHoursId.set(null);
    this.approvedHoursDraft = null;
  }

  approve(r: TaskHoursRequest, approvedHours?: number | null) {
    const hoursToGrant = approvedHours !== undefined ? approvedHours : r.requestedHours;
    if (hoursToGrant != null && (isNaN(Number(hoursToGrant)) || Number(hoursToGrant) <= 0)) {
      this.toast.error('Please enter a valid positive number of hours');
      return;
    }

    this.setBusy(r.id, true);
    this.api.review(r.id, 'APPROVED', { approvedHours: hoursToGrant }).subscribe({
      next: () => {
        this.setBusy(r.id, false);
        this.cancelEdit();
        // Drop timeline cache to refresh
        this.timelines.update((m) => {
          const n = { ...m };
          delete n[r.id];
          return n;
        });
        this.toast.success(`Approved ${hoursToGrant}h for ${r.issue.key}`);
        this.load();
      },
      error: (err) => {
        this.setBusy(r.id, false);
        this.toast.error(err?.error?.message || 'Could not approve the request');
      },
    });
  }

  startReject(r: TaskHoursRequest) {
    this.cancelEdit();
    this.rejectingId.set(r.id);
    this.rejectReason = '';
  }

  cancelReject() {
    this.rejectingId.set(null);
    this.rejectReason = '';
  }

  confirmReject(r: TaskHoursRequest) {
    const reason = this.rejectReason.trim();
    if (!reason) {
      this.toast.error('A rejection reason is required so the requester knows why');
      return;
    }
    this.setBusy(r.id, true);
    this.api.review(r.id, 'REJECTED', { reason }).subscribe({
      next: () => {
        this.setBusy(r.id, false);
        this.cancelReject();
        this.timelines.update((m) => {
          const n = { ...m };
          delete n[r.id];
          return n;
        });
        this.toast.success(`Declined additional hours on ${r.issue.key}`);
        this.load();
      },
      error: (err) => {
        this.setBusy(r.id, false);
        this.toast.error(err?.error?.message || 'Could not reject the request');
      },
    });
  }

  canReview(r: TaskHoursRequest): boolean {
    return r.status === 'REQUESTED';
  }

  fullName(p: { firstName: string; lastName: string } | null): string {
    return p ? `${p.firstName} ${p.lastName}`.trim() : '—';
  }

  getInitials(name: string): string {
    if (!name || name === '—') return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  getAvatarBg(name: string): string {
    const colors = [
      '#4F46E5',
      '#2563EB',
      '#0D9488',
      '#059669',
      '#6b3fd6',
      '#7e7f80',
      '#7C3AED',
      '#6b3fd6',
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const idx = Math.abs(hash) % colors.length;
    return colors[idx];
  }

  actionLabel(action: string): string {
    switch (action) {
      case 'CREATED':
        return 'Request created';
      case 'SUBMITTED':
        return 'Request submitted';
      case 'APPROVED':
        return 'Request approved';
      case 'REJECTED':
        return 'Request declined';
      case 'HOURS_MODIFIED':
        return 'Scope adjusted';
      case 'UPDATED':
        return 'Request updated';
      default:
        return action;
    }
  }

  // ── The other three kinds of project request ──────────────────────────────

  /** What the hero says, so the page describes whichever queue is open. */
  readonly TYPE_META: Record<ProjectRequestType, { title: string; blurb: string }> = {
    HOURS: {
      title: 'Additional Hours Requests',
      blurb:
        'Review effort extension requests from delivery teams, authorize task scope adjustments, and audit historical time allocations.',
    },
    TASKS: {
      title: 'Task Approvals',
      blurb:
        'Tasks raised by a project manager, waiting on the technical architect and then an administrator. Until one is approved it sits on the board locked.',
    },
    BUDGET: {
      title: 'Budget Requests',
      blurb:
        'Requests to increase a project\u2019s agreed budget or planned hours. An administrator decides; approving moves the money on the project itself.',
    },
    SCOPE: {
      title: 'Scope Requests',
      blurb:
        'Raised from a project\u2019s Fix button \u2014 anything needing a decision that is not a task or a budget change, with the requester\u2019s own in-scope or out-of-scope call.',
    },
    FIELD_VISITS: {
      title: 'Field Visit Requests',
      blurb:
        'Trips raised by project managers, waiting on an administrator. Approving assigns the tasks and schedules attendance for everyone on the visit.',
    },
    VISIT_LOCATIONS: {
      title: 'Visit Location Requests',
      blurb:
        'Review new client and site locations proposed by project managers. Approval makes a location immediately available for field visit planning.',
    },
  };

  get typeTitle(): string {
    return this.TYPE_META[this.requestType()].title;
  }
  get typeBlurb(): string {
    return this.TYPE_META[this.requestType()].blurb;
  }

  setRequestType(type: ProjectRequestType) {
    if (type === this.requestType()) return;
    this.requestType.set(type);
    if (type !== 'HOURS') this.loadOthers(type);
  }

  /**
   * Each queue already answers "what may this person act on" server-side, so
   * the client asks and shows what comes back rather than second-guessing the
   * viewer's role. An architect gets tasks awaiting technical review; an
   * administrator gets everything.
   */
  loadOthers(type: ProjectRequestType) {
    this.loadingOthers.set(true);
    const done = () => this.loadingOthers.set(false);

    if (type === 'TASKS') {
      this.projectsApi.getPendingTaskApprovals().subscribe({
        next: (rows) => {
          this.taskApprovals.set(rows || []);
          done();
        },
        error: () => {
          this.taskApprovals.set([]);
          done();
        },
      });
    } else if (type === 'BUDGET') {
      this.budgetApi.pending().subscribe({
        next: (rows) => {
          this.budgetRequests.set(rows || []);
          done();
        },
        error: () => {
          this.budgetRequests.set([]);
          done();
        },
      });
    } else if (type === 'SCOPE') {
      this.projectsApi.getPendingScopeRequests().subscribe({
        next: (rows) => {
          this.scopeRequests.set(rows || []);
          done();
        },
        error: () => {
          this.scopeRequests.set([]);
          done();
        },
      });
    } else if (type === 'FIELD_VISITS') {
      this.loadFieldVisits(done);
    } else if (type === 'VISIT_LOCATIONS') {
      forkJoin({
        capabilities: this.locationApi.capabilities(),
        requests: this.locationApi.list(),
      }).subscribe({
        next: ({ capabilities, requests }) => {
          this.locationCapabilities.set(capabilities);
          this.visitLocationRequests.set(requests || []);
          done();
        },
        error: (err) => {
          this.locationCapabilities.set(null);
          this.visitLocationRequests.set([]);
          done();
          this.toast.error(err?.error?.message || 'Could not load visit location requests');
        },
      });
    }
  }

  /** How many are waiting, for the badge on each type tab. */
  countFor(type: ProjectRequestType): number {
    if (type === 'HOURS') return this.openCount();
    if (type === 'TASKS') return this.taskApprovals().length;
    if (type === 'BUDGET') return this.budgetRequests().length;
    if (type === 'SCOPE') return this.scopeRequests().length;
    if (type === 'FIELD_VISITS') return this.fieldVisitRequests().length;
    return this.visitLocationRequests().filter((request) => request.status === 'PENDING').length;
  }

  // ── Task approvals ────────────────────────────────────────────────────────

  approvalStageLabel(issue: any): string {
    return issue?.approvalState === 'PENDING_TECHNICAL'
      ? 'Awaiting technical architect'
      : 'Awaiting administrator';
  }

  async decideTaskApproval(issue: any, action: 'APPROVE' | 'REJECT') {
    let reason: string | undefined;
    if (action === 'REJECT') {
      const typed = await this.dialog.prompt(
        `What needs changing on "${issue.title}"? The manager who raised it will see this and can send it back once fixed.`,
        'Send Task Back',
        {
          placeholder: 'e.g. Needs an estimate and a clearer acceptance criterion',
          confirmLabel: 'Send back',
          required: true,
        },
      );
      if (!typed || !typed.trim()) return;
      reason = typed.trim();
    } else {
      const ok = await this.dialog.confirm(
        `Approve "${issue.title}"? It becomes ordinary work the team can pick up.`,
        'Approve Task',
        'Approve',
        'Cancel',
      );
      if (!ok) return;
    }

    this.projectsApi.reviewIssueApproval(issue.projectId, issue.id, action, reason).subscribe({
      next: () => {
        this.toast.success(action === 'APPROVE' ? 'Task approved' : 'Sent back to the manager');
        this.loadOthers('TASKS');
      },
      error: (err) => this.toast.error(err?.error?.message || 'Could not record that decision'),
    });
  }

  /**
   * §PB8: archive rather than send back. Its own action, and its own button,
   * because "fix this and return" and "this is not happening" are different
   * decisions and collapsing them is how rejection quietly became a dead end.
   */
  async archiveTaskApproval(issue: any) {
    const reason = await this.dialog.prompt(
      `Archive "${issue.title}" instead of sending it back? It will not return for approval, and the manager who raised it will be told why.`,
      'Archive Task',
      {
        placeholder: 'e.g. Duplicate of TSK-19, closing this one',
        confirmLabel: 'Archive task',
        required: true,
      },
    );
    if (!reason || !reason.trim()) return;

    this.projectsApi.archiveIssueFromApproval(issue.projectId, issue.id, reason.trim()).subscribe({
      next: () => {
        this.toast.success('Task archived');
        this.loadOthers('TASKS');
      },
      error: (err) => this.toast.error(err?.error?.message || 'Could not archive that task'),
    });
  }

  // ── Field Visit Details Modal ─────────────────────────────────────────────
  viewingVisit = signal<FieldVisitRequest | null>(null);

  openVisitDetails(r: FieldVisitRequest) {
    this.viewingVisit.set(r);
  }

  closeVisitDetails() {
    this.viewingVisit.set(null);
  }

  /** Approve or reject from the modal, then close it. */
  async decideVisitFromModal(r: FieldVisitRequest, decision: 'APPROVED' | 'REJECTED') {
    this.closeVisitDetails();
    await this.decideFieldVisit(r, decision);
  }

  isGeneralVisit(r: FieldVisitRequest): boolean {
    return !!r.project?.isSystem;
  }

  /** "09:00" → "9:00 AM", for the visit's daily hours. */
  clockLabel(t?: string | null): string {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    if (!Number.isFinite(h)) return t;
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${ampm}`;
  }

  // ── Task Details Modal (§Complete Task Inspection) ────────────────────────
  viewingTask = signal<any | null>(null);

  openTaskDetails(t: any) {
    this.viewingTask.set(t);
  }

  closeTaskDetails() {
    this.viewingTask.set(null);
  }

  @HostListener('document:keydown.escape')
  onEscapeKey() {
    if (this.viewingVisit()) {
      this.closeVisitDetails();
      return;
    }
    if (this.viewingTask()) {
      this.closeTaskDetails();
    }
  }

  async decideFromModal(issue: any, action: 'APPROVE' | 'REJECT') {
    await this.decideTaskApproval(issue, action);
    this.closeTaskDetails();
  }

  async archiveFromModal(issue: any) {
    await this.archiveTaskApproval(issue);
    this.closeTaskDetails();
  }

  getPriorityColor(priority: string | undefined | null): string {
    const colors: Record<string, string> = {
      'CRITICAL': '#ef4444',
      'HIGH': '#f97316',
      'MEDIUM': '#0c66e4',
      'LOW': '#22c55e',
    };
    return (priority && colors[priority]) || '#94a3b8';
  }

  getPriorityLabel(priority: string | undefined | null): string {
    if (!priority) return 'None';
    return priority.charAt(0).toUpperCase() + priority.slice(1).toLowerCase();
  }

  getPriorityBadgeClass(priority: string | undefined | null): string {
    const p = (priority || '').toUpperCase();
    if (p === 'CRITICAL') return 'priority-critical';
    if (p === 'HIGH') return 'priority-high';
    if (p === 'MEDIUM') return 'priority-medium';
    if (p === 'LOW') return 'priority-low';
    return 'priority-default';
  }

  /** Deduplicate team members so the assignee isn't listed twice */
  getFilteredMembers(task: any): any[] {
    if (!task?.members || !Array.isArray(task.members)) return [];
    const assigneeId = task.assignee?.id;
    if (!assigneeId) return task.members;
    return task.members.filter((m: any) => m.employee?.id !== assigneeId);
  }

  // ── Budget requests ───────────────────────────────────────────────────────

  async decideBudgetRequest(request: BudgetRequest, decision: 'APPROVED' | 'REJECTED') {
    let reason: string | undefined;
    if (decision === 'REJECTED') {
      const typed = await this.dialog.prompt(
        `Why is this budget request being rejected?`,
        'Reject Budget Request',
        {
          placeholder: 'e.g. Not this quarter — revisit after the next milestone',
          confirmLabel: 'Reject request',
          required: true,
        },
      );
      if (!typed || !typed.trim()) return;
      reason = typed.trim();
    } else {
      const ok = await this.dialog.confirm(
        'Approving applies the increase to the project immediately. Continue?',
        'Approve Budget Request',
        'Approve',
        'Cancel',
      );
      if (!ok) return;
    }

    this.budgetApi.review(request.id, decision, reason).subscribe({
      next: () => {
        this.toast.success(
          decision === 'APPROVED' ? 'Budget request approved' : 'Budget request rejected',
        );
        this.loadOthers('BUDGET');
      },
      error: (err) => this.toast.error(err?.error?.message || 'Could not record that decision'),
    });
  }

  // ── Scope requests ────────────────────────────────────────────────────────

  scopeLabel(scope: string): string {
    return scope === 'OUT_OF_SCOPE' ? 'Out of scope' : 'In scope';
  }

  async decideScopeRequest(request: ScopeRequest, decision: 'APPROVED' | 'REJECTED') {
    let note: string | undefined;
    if (decision === 'REJECTED') {
      const typed = await this.dialog.prompt(
        `Why is "${request.title}" being rejected?`,
        'Reject Scope Request',
        {
          placeholder: 'e.g. Covered by the existing statement of work',
          confirmLabel: 'Reject request',
          required: true,
        },
      );
      if (!typed || !typed.trim()) return;
      note = typed.trim();
    } else {
      const ok = await this.dialog.confirm(
        `Approve "${request.title}"? This formally records the decision.`,
        'Approve Scope Request',
        'Approve',
        'Cancel',
      );
      if (!ok) return;
    }

    this.projectsApi.reviewScopeRequest(request.id, decision, note).subscribe({
      next: () => {
        this.toast.success(decision === 'APPROVED' ? 'Request approved' : 'Request rejected');
        this.loadOthers('SCOPE');
      },
      error: (err) => this.toast.error(err?.error?.message || 'Could not record that decision'),
    });
  }

  async decideVisitLocation(request: VisitLocationRequest, decision: 'APPROVED' | 'REJECTED') {
    let reason: string | undefined;
    if (decision === 'REJECTED') {
      const typed = await this.dialog.prompt(
        `Why should “${request.name}” not be added as a visit location?`,
        'Reject Visit Location',
        {
          placeholder: 'e.g. This site duplicates an existing client location',
          confirmLabel: 'Reject request',
          required: true,
        },
      );
      if (!typed?.trim()) return;
      reason = typed.trim();
    } else {
      const ok = await this.dialog.confirm(
        `Approve “${request.name}”? It will become available in field visit location selectors immediately.`,
        'Approve Visit Location',
        'Approve',
        'Cancel',
      );
      if (!ok) return;
    }

    this.locationApi.review(request.id, decision, reason).subscribe({
      next: () => {
        this.toast.success(
          decision === 'APPROVED' ? 'Visit location approved' : 'Visit location rejected',
        );
        this.loadOthers('VISIT_LOCATIONS');
      },
      error: (err) => this.toast.error(err?.error?.message || 'Could not record that decision'),
    });
  }

  // ── Field visits ──────────────────────────────────────────────────────────

  /**
   * Pending trips this viewer can actually decide. The field visit list is
   * already scoped server-side; `canReview` drops the viewer's own requests,
   * which they may not approve.
   */
  loadFieldVisits(done?: () => void) {
    this.fieldVisitApi.list({ status: 'PENDING_APPROVAL' }).subscribe({
      next: (rows) => {
        this.fieldVisitRequests.set((rows || []).filter((r) => r.canReview));
        done?.();
      },
      error: () => {
        this.fieldVisitRequests.set([]);
        done?.();
      },
    });
  }

  async decideFieldVisit(r: FieldVisitRequest, decision: 'APPROVED' | 'REJECTED') {
    if (decision === 'REJECTED') {
      const typed = await this.dialog.prompt(
        `Why is ${r.requestNumber} (${r.location}) being rejected? The manager who raised it acts on this.`,
        'Reject Field Visit',
        { placeholder: 'e.g. Dates clash with the site shutdown', confirmLabel: 'Reject request', required: true },
      );
      if (!typed?.trim()) return;
      this.fieldVisitApi.reject(r.id, typed.trim()).subscribe({
        next: () => {
          this.toast.success(`${r.requestNumber} rejected`);
          this.loadFieldVisits();
        },
        error: (err) => this.toast.error(err?.error?.message || 'Could not record that decision'),
      });
      return;
    }
    const ok = await this.dialog.confirm(
      `Approve ${r.requestNumber}? ${r.members?.length || 0} person(s) get the tasks and ${r.visitDays} day(s) of field attendance.`,
      'Approve Field Visit',
      'Approve',
      'Cancel',
    );
    if (!ok) return;
    this.fieldVisitApi.approve(r.id).subscribe({
      next: () => {
        this.toast.success(`${r.requestNumber} approved — tasks and attendance are assigned`);
        this.loadFieldVisits();
      },
      error: (err) => this.toast.error(err?.error?.message || 'Could not record that decision'),
    });
  }

  formatFileSize(bytes?: number | null): string {
    if (!bytes) return '';
    const kb = bytes / 1024;
    return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
  }
}
