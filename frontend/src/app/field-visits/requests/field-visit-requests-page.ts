import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucideMapPin, LucideRoute, LucidePlus, LucideSearch,
  LucideX, LucideCalendarDays, LucideUsers, LucideBuilding,
  LucideClock, LucideArrowRight, LucideCheckCircle2,
  LucideRotateCcw, LucideRefreshCw, LucideFilter, LucideCheck,
} from '@lucide/angular';
import { FieldVisitRequestsService, FieldVisitRequest } from '../../services/field-visit-requests';
import { FieldVisitRequestFormComponent } from './field-visit-request-form';
import { MyFieldVisitComponent } from '../my-field-visit/my-field-visit';
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
  ],
  templateUrl: './field-visit-requests-page.html',
  styleUrls: ['./field-visit-requests-page.css'],
})
export class FieldVisitRequestsPageComponent implements OnInit {
  private api = inject(FieldVisitRequestsService);
  private locationRequests = inject(VisitLocationRequestsService);
  private router = inject(Router);
  private toast = inject(HotToastService);
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

  /** Request id currently being approved/rejected from the table. */
  deciding = signal<number | null>(null);

  /** Approve straight from the table (the row itself still opens the detail). */
  approveRow(r: FieldVisitRequest, event: Event): void {
    event.stopPropagation();
    if (this.deciding()) return;
    this.deciding.set(r.id);
    this.api.approve(r.id).subscribe({
      next: () => {
        this.deciding.set(null);
        this.toast.success(`${r.requestNumber} approved — tasks and attendance are assigned`);
        this.load();
      },
      error: (err) => {
        this.deciding.set(null);
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

  private messageOf(err: any): string {
    const message = err?.error?.message;
    if (Array.isArray(message)) return message.join(', ');
    return message || 'Something went wrong. Try again in a moment.';
  }
}
