import { Component, OnInit, inject, signal, computed, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucideMapPin, LucideRoute, LucidePlus, LucideSearch,
  LucideX, LucideCalendarDays, LucideUsers, LucideBuilding,
  LucideClock, LucideArrowRight, LucideCheckCircle2,
  LucideRotateCcw, LucideRefreshCw, LucideFilter, LucideCheck,
  LucideChevronDown, LucideAlertTriangle,
} from '@lucide/angular';
import { FieldVisitRequestsService, FieldVisitRequest, FieldVisitRequestTask } from '../../services/field-visit-requests';
import { FieldVisitRequestFormComponent } from './field-visit-request-form';
import { MyFieldVisitComponent } from '../my-field-visit/my-field-visit';
import { DialogService } from '../../shared/services/dialog.service';
import { RoleService } from '../../services/role.service';
import { VisitLocationFormModalComponent } from '../../shared/components/visit-location-form-modal/visit-location-form-modal';
import {
  VisitLocationRequestCapabilities,
  VisitLocationRequestsService,
} from '../../services/visit-location-requests.service';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
};

@Component({
  selector: 'app-field-visit-requests-page',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule, MyFieldVisitComponent,
    FieldVisitRequestFormComponent, VisitLocationFormModalComponent,
    LucideMapPin, LucideRoute, LucidePlus, LucideSearch,
    LucideX, LucideCalendarDays, LucideUsers, LucideBuilding,
    LucideClock, LucideArrowRight, LucideCheckCircle2,
    LucideRotateCcw, LucideRefreshCw, LucideFilter, LucideCheck,
    LucideChevronDown, LucideAlertTriangle,
  ],
  templateUrl: './field-visit-requests-page.html',
  styleUrls: ['./field-visit-requests-page.css'],
})
export class FieldVisitRequestsPageComponent implements OnInit {
  private api = inject(FieldVisitRequestsService);
  private locationRequests = inject(VisitLocationRequestsService);
  private router = inject(Router);
  private toast = inject(HotToastService);
  private dialog = inject(DialogService);
  /** Admins see every company visit; everyone else their own trips and projects. */
  readonly isCompanyWide = inject(RoleService).isAdmin;

  locationCapabilities = signal<VisitLocationRequestCapabilities | null>(null);
  isLocationFormOpen = signal(false);
  allRequests = signal<FieldVisitRequest[]>([]);
  isLoading = signal(true);

  // Filters
  statusFilter = signal<string>('');
  searchQuery = signal<string>('');
  selectedProjectId = signal<number | null>(null);
  selectedEmployeeId = signal<number | null>(null);
  dateRangeFilter = signal<string>('');

  // Multi-selection
  selectedIds = signal<Set<number>>(new Set());

  selectedRequests = computed(() => {
    const ids = this.selectedIds();
    return this.filteredRequests().filter((r) => ids.has(r.id));
  });

  selectedCount = computed(() => this.selectedIds().size);

  isAllSelected = computed(() => {
    const rows = this.filteredRequests();
    return rows.length > 0 && rows.every((r) => this.selectedIds().has(r.id));
  });

  isPartiallySelected = computed(() => {
    const size = this.selectedIds().size;
    const len = this.filteredRequests().length;
    return size > 0 && size < len;
  });

  hasPastSelected = computed(() => {
    return this.selectedRequests().some((r) => this.isPastVisit(r));
  });

  // Status dropdown popover state
  activeStatusMenuId = signal<number | null>(null);
  isBulkLoading = signal(false);

  statusOptions = [
    { status: 'APPROVED', label: 'Approved', color: '#16a34a' },
    { status: 'COMPLETED', label: 'Completed', color: '#4f46e5' },
    { status: 'PENDING_APPROVAL', label: 'Pending approval', color: '#d97706' },
    { status: 'REJECTED', label: 'Rejected', color: '#dc2626' },
    { status: 'CANCELLED', label: 'Cancelled', color: '#94a3b8' },
  ];

  isFormOpen = signal(false);
  editing = signal<FieldVisitRequest | null>(null);

  statuses = [
    { key: '', label: 'All' },
    { key: 'DRAFT', label: 'Draft' },
    { key: 'PENDING_APPROVAL', label: 'Pending approval' },
    { key: 'APPROVED', label: 'Approved' },
    // A trip whose days are all done. It had no tab, so "All 9" never added
    // up to the tabs beside it.
    { key: 'COMPLETED', label: 'Completed' },
    { key: 'REJECTED', label: 'Rejected' },
    { key: 'CANCELLED', label: 'Cancelled' },
  ];

  dateRangeOptions = [
    { key: '', label: 'All dates' },
    { key: 'UPCOMING', label: 'Upcoming visits' },
    { key: 'THIS_MONTH', label: 'This month' },
    { key: 'PAST', label: 'Past visits' },
  ];

  availableProjects = computed(() => {
    const map = new Map<number, string>();
    for (const r of this.allRequests()) {
      if (r.project?.id && r.project?.name) {
        const key = (r.project as any).key;
        map.set(r.project.id, key ? `${key} · ${r.project.name}` : r.project.name);
      }
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  availableEmployees = computed(() => {
    const map = new Map<number, string>();
    for (const r of this.allRequests()) {
      for (const m of r.members || []) {
        if (m.employee?.id) {
          const name = `${m.employee.firstName ?? ''} ${m.employee.lastName ?? ''}`.trim() || `Employee ${m.employee.id}`;
          map.set(m.employee.id, name);
        }
      }
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  /**
   * Every filter except the status tab. The tab counts and KPIs are built from
   * this, so they always describe what the other filters left — before, the
   * counts were over everything and stopped matching the table as soon as a
   * project or person was picked.
   */
  private baseRows = computed(() => {
    let rows = this.allRequests();

    const projectId = this.selectedProjectId();
    if (projectId !== null) {
      rows = rows.filter((r) => r.project?.id === Number(projectId));
    }

    const employeeId = this.selectedEmployeeId();
    if (employeeId !== null) {
      rows = rows.filter((r) => r.members?.some((m) => m.employee?.id === Number(employeeId)));
    }

    const range = this.dateRangeFilter();
    if (range) {
      // Local calendar days, compared as YYYY-MM-DD. toISOString() turned
      // local midnight into the previous day in UTC (IST is +5:30), so
      // "upcoming" dropped today's visits.
      const today = this.localDay(new Date());
      const start = (r: FieldVisitRequest) => this.localDay(r.startDate);
      const end = (r: FieldVisitRequest) => this.localDay(r.endDate);
      if (range === 'UPCOMING') {
        // Still to finish: today's and ongoing trips count as upcoming.
        rows = rows.filter((r) => end(r) >= today);
      } else if (range === 'PAST') {
        rows = rows.filter((r) => end(r) < today);
      } else if (range === 'THIS_MONTH') {
        // Overlaps the month at all — a trip from 28 Sep to 3 Oct is in October.
        const monthStart = today.slice(0, 8) + '01';
        const monthEnd = today.slice(0, 8) + '31';
        rows = rows.filter((r) => start(r) <= monthEnd && end(r) >= monthStart);
      }
    }

    const q = this.searchQuery().trim().toLowerCase();
    if (q) {
      const name = (p: any) => `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.toLowerCase();
      rows = rows.filter((r) =>
        r.requestNumber?.toLowerCase().includes(q) ||
        r.project?.name?.toLowerCase().includes(q) ||
        ((r.project as any)?.key ?? '').toLowerCase().includes(q) ||
        r.location?.toLowerCase().includes(q) ||
        name((r as any).raisedBy).includes(q) ||
        r.members?.some((m) => name(m.employee).includes(q))
      );
    }
    return rows;
  });

  statusCounts = computed(() => {
    const rows = this.baseRows();
    const counts: Record<string, number> = { '': rows.length };
    for (const s of this.statuses) if (s.key) counts[s.key] = 0;
    for (const r of rows) {
      if (counts[r.status] !== undefined) counts[r.status]++;
    }
    return counts;
  });

  summaryKpis = computed(() => {
    const rows = this.baseRows();
    // A completed trip was approved first; leaving it out made "Approved
    // visits" read 0 while five visits had happened.
    const approved = rows.filter((r) => r.status === 'APPROVED' || r.status === 'COMPLETED');
    const pending = rows.filter((r) => r.status === 'PENDING_APPROVAL');
    return {
      total: rows.length,
      approved: approved.length,
      pending: pending.length,
      totalDays: approved.reduce((sum, r) => sum + (r.visitDays || 0), 0),
      totalPeople: approved.reduce((sum, r) => sum + (r.members?.length || 0), 0),
    };
  });

  filteredRequests = computed(() => {
    const status = this.statusFilter();
    const rows = this.baseRows();
    return status ? rows.filter((r) => r.status === status) : rows;
  });

  /** YYYY-MM-DD in the viewer's own timezone. */
  private localDay(value: string | Date): string {
    const d = new Date(value);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  hasActiveFilters = computed(() => {
    return (
      !!this.statusFilter() ||
      !!this.searchQuery().trim() ||
      this.selectedProjectId() !== null ||
      this.selectedEmployeeId() !== null ||
      !!this.dateRangeFilter()
    );
  });

  ngOnInit(): void {
    this.load();
    this.locationRequests.capabilities().subscribe({
      next: (capabilities) => this.locationCapabilities.set(capabilities),
      error: () => this.locationCapabilities.set(null),
    });
  }

  addVisitLocation(): void {
    if (this.locationCapabilities()?.isAdmin) {
      void this.router.navigate(['/settings/master-data'], {
        queryParams: { tab: 'visit-locations', open: 'add' },
      });
      return;
    }
    if (this.locationCapabilities()?.isProjectManager) {
      this.isLocationFormOpen.set(true);
    }
  }

  load(): void {
    this.isLoading.set(true);
    this.api.list().subscribe({
      next: (rows) => {
        this.allRequests.set(rows);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.toast.error(this.messageOf(err));
        this.isLoading.set(false);
      },
    });
  }

  setStatus(status: string): void {
    this.statusFilter.set(status);
  }

  resetFilters(): void {
    this.statusFilter.set('');
    this.searchQuery.set('');
    this.selectedProjectId.set(null);
    this.selectedEmployeeId.set(null);
    this.dateRangeFilter.set('');
  }

  label(status: string): string {
    return STATUS_LABELS[status] ?? status;
  }

  isPastVisit(r: FieldVisitRequest): boolean {
    const today = this.localDay(new Date());
    const end = this.localDay(r.endDate);
    return end < today;
  }

  toggleSelectAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked) {
      const all = new Set(this.filteredRequests().map((r) => r.id));
      this.selectedIds.set(all);
    } else {
      this.selectedIds.set(new Set());
    }
  }

  toggleSelect(id: number, event: Event): void {
    event.stopPropagation();
    this.selectedIds.update((set) => {
      const next = new Set(set);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  clearSelection(): void {
    this.selectedIds.set(new Set());
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.activeStatusMenuId.set(null);
  }

  toggleStatusMenu(r: FieldVisitRequest, event: Event): void {
    event.stopPropagation();
    this.activeStatusMenuId.update((curr) => (curr === r.id ? null : r.id));
  }

  onSelectStatus(r: FieldVisitRequest, targetStatus: string, event: Event): void {
    event.stopPropagation();
    this.activeStatusMenuId.set(null);
    if (r.status === targetStatus || this.deciding()) return;

    if (targetStatus === 'APPROVED') {
      if (this.isPastVisit(r)) {
        const ok = window.confirm(
          `This visit ended in the past (${r.startDate.slice(0, 10)} to ${r.endDate.slice(0, 10)}).\n\nApproving will retroactively authorize the field visit and schedule historical attendance.\n\nDo you want to proceed?`
        );
        if (!ok) return;
      }
      this.approveViaStatus(r);
      return;
    }

    if (targetStatus === 'REJECTED') {
      const reason = window.prompt(`Reject ${r.requestNumber}? Give the reason — the manager acts on it:`)?.trim();
      if (!reason) return;
      this.deciding.set(r.id);
      this.api.reject(r.id, reason).subscribe({
        next: () => {
          this.deciding.set(null);
          this.toast.success(`${r.requestNumber} rejected`);
          this.load();
        },
        error: (err) => {
          this.deciding.set(null);
          this.toast.error(this.messageOf(err));
        },
      });
      return;
    }

    if (targetStatus === 'CANCELLED') {
      const reason = window.prompt(`Cancel ${r.requestNumber}? Optional reason:`)?.trim();
      this.deciding.set(r.id);
      this.api.cancel(r.id, reason || undefined).subscribe({
        next: () => {
          this.deciding.set(null);
          this.toast.success(`${r.requestNumber} cancelled`);
          this.load();
        },
        error: (err) => {
          this.deciding.set(null);
          this.toast.error(this.messageOf(err));
        },
      });
      return;
    }

    if (targetStatus === 'COMPLETED') {
      this.deciding.set(r.id);
      this.api.complete(r.id).subscribe({
        next: () => {
          this.deciding.set(null);
          this.toast.success(`${r.requestNumber} marked as completed`);
          this.load();
        },
        error: (err) => {
          this.deciding.set(null);
          this.toast.error(this.messageOf(err));
        },
      });
      return;
    }

    if (targetStatus === 'PENDING_APPROVAL') {
      this.deciding.set(r.id);
      this.api.changeStatus(r.id, 'PENDING_APPROVAL').subscribe({
        next: () => {
          this.deciding.set(null);
          this.toast.success(`${r.requestNumber} moved to pending approval`);
          this.load();
        },
        error: (err) => {
          this.deciding.set(null);
          this.toast.error(this.messageOf(err));
        },
      });
      return;
    }
  }

  /**
   * The status dropdown's "Approved". Goes through the status endpoint (it also
   * handles drafts and re-approvals) but offers the same choice as the detail
   * page when rostered days off are all that is in the way.
   */
  private approveViaStatus(r: FieldVisitRequest, overrideDayOff = false): void {
    this.deciding.set(r.id);
    this.api.changeStatus(r.id, 'APPROVED', undefined, overrideDayOff ? { overrideDayOff: true } : {}).subscribe({
      next: () => {
        this.deciding.set(null);
        this.toast.success(`${r.requestNumber} approved`);
        this.load();
      },
      error: async (err) => {
        this.deciding.set(null);
        if (!overrideDayOff && err?.error?.code === 'ROSTER_DAY_OFF_CLASH') {
          const ok = await this.dialog.confirm(
            this.messageOf(err),
            `${r.requestNumber} falls on rostered days off`,
            'Approve and override days off',
            'Cancel',
          );
          if (ok) this.approveViaStatus(r, true);
          return;
        }
        this.toast.error(this.messageOf(err));
      },
    });
  }

  bulkApprove(): void {
    const ids = Array.from(this.selectedIds());
    if (!ids.length || this.isBulkLoading()) return;

    if (this.hasPastSelected()) {
      const ok = window.confirm(
        `Some of the ${ids.length} selected visits are in the past. Approving will retroactively authorize them and record past attendance. Continue?`
      );
      if (!ok) return;
    }

    this.runBulkApprove(ids, false);
  }

  /**
   * Approve a selection, then deal with what did not go through.
   *
   * Previously the reasons were dropped — "0 of 1 visits approved" and nothing
   * else. Now visits stopped only by rostered days off are offered the override
   * in one go, and anything else that failed is reported with its reason.
   */
  private runBulkApprove(ids: number[], overrideDayOff: boolean): void {
    this.isBulkLoading.set(true);
    this.api.bulkChangeStatus(ids, 'APPROVED', undefined, overrideDayOff ? { overrideDayOff: true } : {}).subscribe({
      next: async (results) => {
        this.isBulkLoading.set(false);
        const ok = results.filter((r) => r.success).length;
        const dayOff = results.filter((r) => !r.success && r.code === 'ROSTER_DAY_OFF_CLASH');
        const other = results.filter((r) => !r.success && r.code !== 'ROSTER_DAY_OFF_CLASH');

        if (ok) this.toast.success(`${ok} of ${results.length} visits approved`);
        for (const f of other) this.toast.error(f.error || 'Could not approve', { duration: 9000 });
        this.load();

        if (dayOff.length && !overrideDayOff) {
          const details = dayOff.map((f) => f.error).join(' ');
          const go = await this.dialog.confirm(
            details,
            `${dayOff.length} visit${dayOff.length > 1 ? 's fall' : ' falls'} on rostered days off`,
            'Approve and override days off',
            'Cancel',
          );
          if (go) { this.runBulkApprove(dayOff.map((f) => f.id), true); return; }
        }
        this.clearSelection();
      },
      error: (err) => {
        this.isBulkLoading.set(false);
        this.toast.error(this.messageOf(err));
      },
    });
  }

  bulkMarkCompleted(): void {
    const ids = Array.from(this.selectedIds());
    if (!ids.length || this.isBulkLoading()) return;

    this.isBulkLoading.set(true);
    this.api.bulkChangeStatus(ids, 'COMPLETED').subscribe({
      next: (results) => {
        this.isBulkLoading.set(false);
        const successes = results.filter((r) => r.success).length;
        this.toast.success(`${successes} of ${ids.length} visits marked as completed`);
        this.clearSelection();
        this.load();
      },
      error: (err) => {
        this.isBulkLoading.set(false);
        this.toast.error(this.messageOf(err));
      },
    });
  }

  bulkReject(): void {
    const ids = Array.from(this.selectedIds());
    if (!ids.length || this.isBulkLoading()) return;

    const reason = window.prompt(`Give a reason for rejecting the ${ids.length} selected visit(s):`)?.trim();
    if (!reason) return;

    this.isBulkLoading.set(true);
    this.api.bulkChangeStatus(ids, 'REJECTED', reason).subscribe({
      next: (results) => {
        this.isBulkLoading.set(false);
        const successes = results.filter((r) => r.success).length;
        this.toast.success(`${successes} of ${ids.length} visits rejected`);
        this.clearSelection();
        this.load();
      },
      error: (err) => {
        this.isBulkLoading.set(false);
        this.toast.error(this.messageOf(err));
      },
    });
  }

  bulkCancel(): void {
    const ids = Array.from(this.selectedIds());
    if (!ids.length || this.isBulkLoading()) return;

    const reason = window.prompt(`Optional reason for cancelling the ${ids.length} selected visit(s):`)?.trim();

    this.isBulkLoading.set(true);
    this.api.bulkChangeStatus(ids, 'CANCELLED', reason || undefined).subscribe({
      next: (results) => {
        this.isBulkLoading.set(false);
        const successes = results.filter((r) => r.success).length;
        this.toast.success(`${successes} of ${ids.length} visits cancelled`);
        this.clearSelection();
        this.load();
      },
      error: (err) => {
        this.isBulkLoading.set(false);
        this.toast.error(this.messageOf(err));
      },
    });
  }

  onBulkStatusSelect(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const targetStatus = select.value;
    select.value = '';
    if (!targetStatus) return;

    const ids = Array.from(this.selectedIds());
    if (!ids.length) return;

    if (targetStatus === 'APPROVED') {
      this.bulkApprove();
      return;
    }
    if (targetStatus === 'COMPLETED') {
      this.bulkMarkCompleted();
      return;
    }
    if (targetStatus === 'REJECTED') {
      this.bulkReject();
      return;
    }
    if (targetStatus === 'CANCELLED') {
      this.bulkCancel();
      return;
    }

    this.isBulkLoading.set(true);
    this.api.bulkChangeStatus(ids, targetStatus).subscribe({
      next: (results) => {
        this.isBulkLoading.set(false);
        const successes = results.filter((r) => r.success).length;
        this.toast.success(`${successes} of ${ids.length} visits updated to ${this.label(targetStatus)}`);
        this.clearSelection();
        this.load();
      },
      error: (err) => {
        this.isBulkLoading.set(false);
        this.toast.error(this.messageOf(err));
      },
    });
  }

  /** Request id currently being approved/rejected from the table. */
  deciding = signal<number | null>(null);

  /** Approve straight from the table (the row itself still opens the detail). */
  approveRow(r: FieldVisitRequest, event?: Event, overrideDayOff = false): void {
    event?.stopPropagation();
    if (this.deciding()) return;
    this.deciding.set(r.id);
    this.api.approve(r.id, overrideDayOff ? { overrideDayOff: true } : {}).subscribe({
      next: () => {
        this.deciding.set(null);
        this.toast.success(`${r.requestNumber} approved — tasks and attendance are assigned`);
        this.load();
      },
      error: async (err) => {
        this.deciding.set(null);
        // Same offer as the detail page: if rostered days off are the only
        // thing in the way, the approver may choose to roster them on site.
        if (!overrideDayOff && err?.error?.code === 'ROSTER_DAY_OFF_CLASH') {
          const ok = await this.dialog.confirm(
            this.messageOf(err),
            `${r.requestNumber} falls on rostered days off`,
            'Approve and override days off',
            'Cancel',
          );
          if (ok) this.approveRow(r, undefined, true);
          return;
        }
        this.toast.error(this.messageOf(err));
      },
    });
  }

  rejectRow(r: FieldVisitRequest, event: Event): void {
    event.stopPropagation();
    if (this.deciding()) return;
    const reason = window.prompt(`Reject ${r.requestNumber}? Give the reason — the manager acts on it.`)?.trim();
    if (!reason) return;
    this.deciding.set(r.id);
    this.api.reject(r.id, reason).subscribe({
      next: () => {
        this.deciding.set(null);
        this.toast.success(`${r.requestNumber} rejected`);
        this.load();
      },
      error: (err) => {
        this.deciding.set(null);
        this.toast.error(this.messageOf(err));
      },
    });
  }

  openForm(request?: FieldVisitRequest): void {
    this.editing.set(request ?? null);
    this.isFormOpen.set(true);
  }

  closeForm(): void {
    this.isFormOpen.set(false);
    this.editing.set(null);
  }

  onSaved(): void {
    this.closeForm();
    this.load();
  }

  /** The row itself is the visit detail; nested links deliberately override it. */
  openRequest(request: FieldVisitRequest): void {
    void this.router.navigate(['/field-visits/requests', request.id]);
  }

  openProject(request: FieldVisitRequest, event: Event): void {
    event.stopPropagation();
    if (request.project?.id) void this.router.navigate(['/projects', request.project.id]);
  }

  openTask(request: FieldVisitRequest, task: FieldVisitRequestTask, event: Event): void {
    event.stopPropagation();
    if (!task.issueId || !request.project?.id) return;
    void this.router.navigate(['/projects', request.project.id], { queryParams: { task: task.issueId } });
  }

  private messageOf(err: any): string {
    const message = err?.error?.message;
    if (Array.isArray(message)) return message.join(', ');
    return message || 'Something went wrong. Try again in a moment.';
  }
}
