import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucideMapPin, LucideRoute, LucidePlus, LucideSearch,
  LucideX, LucideCalendarDays, LucideUsers, LucideBuilding,
  LucideClock, LucideArrowRight, LucideCheckCircle2,
  LucideRotateCcw, LucideRefreshCw, LucideFilter,
} from '@lucide/angular';
import { FieldVisitRequestsService, FieldVisitRequest } from '../../services/field-visit-requests';
import { FieldVisitRequestFormComponent } from './field-visit-request-form';

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
    CommonModule, FormsModule, RouterModule,
    FieldVisitRequestFormComponent,
    LucideMapPin, LucideRoute, LucidePlus, LucideSearch,
    LucideX, LucideCalendarDays, LucideUsers, LucideBuilding,
    LucideClock, LucideArrowRight, LucideCheckCircle2,
    LucideRotateCcw, LucideRefreshCw, LucideFilter,
  ],
  templateUrl: './field-visit-requests-page.html',
  styleUrls: ['./field-visit-requests-page.css'],
})
export class FieldVisitRequestsPageComponent implements OnInit {
  private api = inject(FieldVisitRequestsService);
  private toast = inject(HotToastService);

  allRequests = signal<FieldVisitRequest[]>([]);
  isLoading = signal(true);

  // Filters
  statusFilter = signal<string>('');
  searchQuery = signal<string>('');
  selectedProjectId = signal<number | null>(null);
  selectedEmployeeId = signal<number | null>(null);
  dateRangeFilter = signal<string>('');

  isFormOpen = signal(false);
  editing = signal<FieldVisitRequest | null>(null);

  statuses = [
    { key: '', label: 'All' },
    { key: 'DRAFT', label: 'Draft' },
    { key: 'PENDING_APPROVAL', label: 'Pending approval' },
    { key: 'APPROVED', label: 'Approved' },
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
        map.set(r.project.id, r.project.name);
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

  statusCounts = computed(() => {
    const all = this.allRequests();
    const counts: Record<string, number> = {
      '': all.length,
      'DRAFT': 0,
      'PENDING_APPROVAL': 0,
      'APPROVED': 0,
      'REJECTED': 0,
      'CANCELLED': 0,
    };
    for (const r of all) {
      if (counts[r.status] !== undefined) {
        counts[r.status]++;
      }
    }
    return counts;
  });

  summaryKpis = computed(() => {
    const all = this.allRequests();
    const approved = all.filter((r) => r.status === 'APPROVED');
    const pending = all.filter((r) => r.status === 'PENDING_APPROVAL');
    const totalDays = approved.reduce((sum, r) => sum + (r.visitDays || 0), 0);
    const totalPeople = approved.reduce((sum, r) => sum + (r.members?.length || 0), 0);
    return {
      total: all.length,
      approved: approved.length,
      pending: pending.length,
      totalDays,
      totalPeople,
    };
  });

  filteredRequests = computed(() => {
    let rows = this.allRequests();

    // 1. Status Tab filter
    if (this.statusFilter()) {
      rows = rows.filter((r) => r.status === this.statusFilter());
    }

    // 2. Project filter
    if (this.selectedProjectId() !== null) {
      rows = rows.filter((r) => r.project?.id === this.selectedProjectId());
    }

    // 3. Employee / Team member filter
    if (this.selectedEmployeeId() !== null) {
      rows = rows.filter((r) => r.members?.some((m) => m.employee?.id === this.selectedEmployeeId()));
    }

    // 4. Date range filter
    if (this.dateRangeFilter()) {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const todayStr = now.toISOString().slice(0, 10);

      if (this.dateRangeFilter() === 'UPCOMING') {
        rows = rows.filter((r) => r.startDate >= todayStr);
      } else if (this.dateRangeFilter() === 'PAST') {
        rows = rows.filter((r) => r.endDate < todayStr);
      } else if (this.dateRangeFilter() === 'THIS_MONTH') {
        const ym = todayStr.slice(0, 7);
        rows = rows.filter((r) => r.startDate.startsWith(ym) || r.endDate.startsWith(ym));
      }
    }

    // 5. Search query
    const q = this.searchQuery().trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) =>
        r.requestNumber?.toLowerCase().includes(q) ||
        r.project?.name?.toLowerCase().includes(q) ||
        r.location?.toLowerCase().includes(q) ||
        r.members?.some((m) =>
          `${m.employee?.firstName ?? ''} ${m.employee?.lastName ?? ''}`.toLowerCase().includes(q)
        )
      );
    }

    return rows;
  });

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

  private messageOf(err: any): string {
    const message = err?.error?.message;
    if (Array.isArray(message)) return message.join(', ');
    return message || 'Something went wrong. Try again in a moment.';
  }
}
