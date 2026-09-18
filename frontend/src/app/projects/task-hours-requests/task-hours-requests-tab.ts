import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucideCheck, LucideX, LucideLoader2, LucideClock, LucideChevronDown,
  LucideChevronRight, LucideAlertTriangle,
} from '@lucide/angular';
import {
  TaskHoursRequestsService, TaskHoursRequest, TaskHoursActivity,
} from '../../services/task-hours-requests';

/**
 * Request tracking (§4).
 *
 * One screen for every additional-hours request, with the history behind each
 * one. The list answers "what is waiting on me and what happened to what I
 * asked for"; the timeline answers "why does this task have eight hours when
 * it was planned for four".
 *
 * Requested and approved hours are deliberately separate columns. A manager
 * granting two of the four hours asked for is the interesting case, and
 * collapsing them into one number hides exactly that.
 */
@Component({
  selector: 'app-task-hours-requests-tab',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    LucideCheck, LucideX, LucideLoader2, LucideClock, LucideChevronDown,
    LucideChevronRight, LucideAlertTriangle,
  ],
  templateUrl: './task-hours-requests-tab.html',
  styleUrls: ['./task-hours-requests-tab.css'],
})
export class TaskHoursRequestsTabComponent {
  private api = inject(TaskHoursRequestsService);
  private toast = inject(HotToastService);

  requests = signal<TaskHoursRequest[]>([]);
  loading = signal(true);
  busy = signal<Set<number>>(new Set());

  filterStatus = signal<string>('ALL');

  /** Timelines are fetched on demand — most rows are never expanded. */
  expanded = signal<Set<number>>(new Set());
  timelines = signal<Record<number, TaskHoursActivity[]>>({});

  /** The row being rejected, and the reason being typed for it. */
  rejectingId = signal<number | null>(null);
  rejectReason = '';

  /** The row being approved with a different figure than was asked for. */
  editingHoursId = signal<number | null>(null);
  approvedHoursDraft: number | null = null;

  openCount = computed(() => this.requests().filter((r) => r.status === 'REQUESTED').length);

  readonly statusOptions = [
    { value: 'ALL', label: 'All requests' },
    { value: 'REQUESTED', label: 'Awaiting a decision' },
    { value: 'APPROVED', label: 'Approved' },
    { value: 'REJECTED', label: 'Rejected' },
  ];

  constructor() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.api.listAll({ status: this.filterStatus() }).subscribe({
      next: (rows) => {
        this.requests.set(rows || []);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.toast.error(err?.error?.message || 'Could not load requests');
      },
    });
  }

  onStatusChange(value: string) {
    this.filterStatus.set(value);
    this.load();
  }

  isBusy(id: number) { return this.busy().has(id); }

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
    this.editingHoursId.set(r.id);
    this.approvedHoursDraft = r.requestedHours;
  }

  cancelEdit() {
    this.editingHoursId.set(null);
    this.approvedHoursDraft = null;
  }

  approve(r: TaskHoursRequest, approvedHours?: number | null) {
    this.setBusy(r.id, true);
    this.api.review(r.id, 'APPROVED', { approvedHours: approvedHours ?? null }).subscribe({
      next: () => {
        this.setBusy(r.id, false);
        this.cancelEdit();
        // The timeline gained an entry, so drop the cached copy.
        this.timelines.update((m) => { const n = { ...m }; delete n[r.id]; return n; });
        this.toast.success(`Approved ${approvedHours ?? r.requestedHours}h on ${r.issue.key}`);
        this.load();
      },
      error: (err) => {
        this.setBusy(r.id, false);
        this.toast.error(err?.error?.message || 'Could not approve the request');
      },
    });
  }

  startReject(r: TaskHoursRequest) {
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
      this.toast.error('A reason is required — it is what the requester reads');
      return;
    }
    this.setBusy(r.id, true);
    this.api.review(r.id, 'REJECTED', { reason }).subscribe({
      next: () => {
        this.setBusy(r.id, false);
        this.cancelReject();
        this.timelines.update((m) => { const n = { ...m }; delete n[r.id]; return n; });
        this.toast.success(`Rejected the request on ${r.issue.key}`);
        this.load();
      },
      error: (err) => {
        this.setBusy(r.id, false);
        this.toast.error(err?.error?.message || 'Could not reject the request');
      },
    });
  }

  /** Whether this viewer may rule on the row. The server decides for real. */
  canReview(r: TaskHoursRequest): boolean {
    return r.status === 'REQUESTED';
  }

  fullName(p: { firstName: string; lastName: string } | null): string {
    return p ? `${p.firstName} ${p.lastName}`.trim() : '—';
  }

  /** A readable label for a timeline action. */
  actionLabel(action: string): string {
    switch (action) {
      case 'CREATED': return 'Request created';
      case 'SUBMITTED': return 'Request submitted';
      case 'APPROVED': return 'Request approved';
      case 'REJECTED': return 'Request rejected';
      case 'HOURS_MODIFIED': return 'Hours modified';
      case 'UPDATED': return 'Request updated';
      default: return action;
    }
  }
}
