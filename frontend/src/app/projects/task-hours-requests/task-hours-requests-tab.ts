import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucideCheck, LucideX, LucideLoader2, LucideClock, LucideChevronDown,
  LucideChevronRight, LucideAlertTriangle, LucideSearch, LucideFilter,
  LucideRefreshCw, LucideHistory, LucideCheckCircle2, LucideXCircle,
  LucideSlidersHorizontal, LucideFolderKanban, LucideUser, LucideFileText,
  LucideArrowUpDown, LucideCalendar, LucideSparkles, LucideInfo, LucideTimer,
  LucideSliders,
} from '@lucide/angular';
import {
  TaskHoursRequestsService, TaskHoursRequest, TaskHoursActivity,
} from '../../services/task-hours-requests';

export type RequestTabFilter = 'AWAITING' | 'HISTORY' | 'APPROVED' | 'REJECTED' | 'ALL';
export type RequestSortOption = 'newest' | 'oldest' | 'hours-desc' | 'hours-asc';

@Component({
  selector: 'app-task-hours-requests-tab',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule,
    LucideCheck, LucideX, LucideLoader2, LucideClock, LucideChevronDown,
    LucideChevronRight, LucideAlertTriangle, LucideSearch, LucideFilter,
    LucideRefreshCw, LucideHistory, LucideCheckCircle2, LucideXCircle,
    LucideSlidersHorizontal, LucideFolderKanban, LucideUser, LucideFileText,
    LucideArrowUpDown, LucideCalendar, LucideSparkles, LucideInfo, LucideTimer,
    LucideSliders,
  ],
  templateUrl: './task-hours-requests-tab.html',
  styleUrls: ['./task-hours-requests-tab.css'],
})
export class TaskHoursRequestsTabComponent {
  private api = inject(TaskHoursRequestsService);
  private toast = inject(HotToastService);

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
  openHours = computed(() => this.openRequests().reduce((sum, r) => sum + (r.requestedHours || 0), 0));

  approvedRequests = computed(() => this.requests().filter((r) => r.status === 'APPROVED'));
  approvedCount = computed(() => this.approvedRequests().length);
  approvedHours = computed(() => this.approvedRequests().reduce((sum, r) => sum + (r.approvedHours ?? r.requestedHours ?? 0), 0));

  rejectedRequests = computed(() => this.requests().filter((r) => r.status === 'REJECTED'));
  rejectedCount = computed(() => this.rejectedRequests().length);
  rejectedHours = computed(() => this.rejectedRequests().reduce((sum, r) => sum + (r.requestedHours || 0), 0));

  historyRequests = computed(() => this.requests().filter((r) => r.status !== 'REQUESTED'));
  historyCount = computed(() => this.historyRequests().length);
  historyHours = computed(() => this.historyRequests().reduce((sum, r) => sum + (r.requestedHours || 0), 0));

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
  }

  load() {
    this.loading.set(true);
    // Load all requests across the organization so client-side KPIs and multi-filters are instant
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
      '#4F46E5', '#2563EB', '#0D9488', '#059669',
      '#D97706', '#E11D48', '#7C3AED', '#DB2777'
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
      case 'CREATED': return 'Request created';
      case 'SUBMITTED': return 'Request submitted';
      case 'APPROVED': return 'Request approved';
      case 'REJECTED': return 'Request declined';
      case 'HOURS_MODIFIED': return 'Scope adjusted';
      case 'UPDATED': return 'Request updated';
      default: return action;
    }
  }
}
