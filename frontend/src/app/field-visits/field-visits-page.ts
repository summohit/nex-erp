import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import {
  LucideMapPin, LucideRuler, LucideClock, LucideNavigation, LucideCamera,
  LucideUsers, LucideCheckCircle, LucideFileText, LucideX,
  LucideRefreshCw, LucideRotateCcw, LucideSearch, LucideExternalLink,
} from '@lucide/angular';
import {
  FieldVisitsService, FieldVisit, FieldVisitSummary,
} from '../services/field-visits';
import { EmployeeService } from '../services/employee.service';
import { ProjectsService } from '../services/projects';
import { SkeletonComponent } from '../shared/components/skeleton/skeleton.component';

type RangeKey = '7d' | '30d' | '90d' | '6m' | '1y' | 'custom';

interface FilterOption {
  id: number;
  label: string;
}

const EMPTY_SUMMARY: FieldVisitSummary = {
  total: 0, active: 0, completed: 0, cancelled: 0,
  totalDistanceKm: 0, totalDurationMins: 0, photoCount: 0, employeesOut: 0,
};

@Component({
  selector: 'app-field-visits-page',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule, SkeletonComponent,
    LucideMapPin, LucideRuler, LucideClock, LucideNavigation, LucideCamera,
    LucideUsers, LucideCheckCircle, LucideFileText, LucideX,
    LucideRefreshCw, LucideRotateCcw, LucideSearch, LucideExternalLink,
  ],
  templateUrl: './field-visits-page.html',
  styleUrls: ['./field-visits-page.css'],
})
export class FieldVisitsPageComponent implements OnInit {
  private fieldVisitsService = inject(FieldVisitsService);
  private employeeService = inject(EmployeeService);
  private projectsService = inject(ProjectsService);

  visits = signal<FieldVisit[]>([]);
  summary = signal<FieldVisitSummary>(EMPTY_SUMMARY);
  isLoading = signal(true);

  employees = signal<FilterOption[]>([]);
  projects = signal<FilterOption[]>([]);

  range = signal<RangeKey>('30d');
  fromDate = signal('');
  toDate = signal('');
  employeeId = signal<number | null>(null);
  projectId = signal<number | null>(null);
  status = signal('');
  search = signal('');

  selected = signal<FieldVisit | null>(null);

  readonly ranges: { key: RangeKey; label: string }[] = [
    { key: '7d', label: '7 days' },
    { key: '30d', label: '30 days' },
    { key: '90d', label: '90 days' },
    { key: '6m', label: '6 months' },
    { key: '1y', label: '1 year' },
    { key: 'custom', label: 'Custom' },
  ];

  /**
   * Free-text is applied client-side over the already-filtered rows — the server
   * filters are the ones that change the KPI numbers, so a name search must not
   * silently make the cards disagree with the table.
   */
  filteredVisits = computed(() => {
    const q = this.search().trim().toLowerCase();
    if (!q) return this.visits();
    return this.visits().filter((v) => {
      const name = `${v.employee?.firstName ?? ''} ${v.employee?.lastName ?? ''}`.toLowerCase();
      return (
        name.includes(q) ||
        (v.project?.name ?? '').toLowerCase().includes(q) ||
        (v.purpose ?? '').toLowerCase().includes(q) ||
        (v.startAddress ?? '').toLowerCase().includes(q) ||
        (v.endAddress ?? '').toLowerCase().includes(q) ||
        (v.notes ?? '').toLowerCase().includes(q)
      );
    });
  });

  hasActiveFilters = computed(() =>
    this.range() !== '30d' ||
    this.employeeId() !== null ||
    this.projectId() !== null ||
    this.status() !== '' ||
    this.search() !== ''
  );

  totalHours = computed(() => this.summary().totalDurationMins / 60);

  /** Average km per completed visit — 0 completed would otherwise divide by zero. */
  avgDistance = computed(() => {
    const s = this.summary();
    return s.completed > 0 ? s.totalDistanceKm / s.completed : 0;
  });

  ngOnInit() {
    this.applyRange('30d');

    this.employeeService.getEmployeesBasicList().subscribe({
      next: (list) => this.employees.set(
        (list || [])
          .map((e: any) => ({ id: e.id, label: `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim() }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      ),
      error: () => this.employees.set([]),
    });

    this.projectsService.getProjects().subscribe({
      next: (list: any) => this.projects.set(
        (list || [])
          .map((p: any) => ({ id: p.id, label: p.name }))
          .sort((a: FilterOption, b: FilterOption) => a.label.localeCompare(b.label)),
      ),
      error: () => this.projects.set([]),
    });
  }

  /** Presets set the actual dates so the server only ever sees a from/to pair. */
  applyRange(key: RangeKey) {
    this.range.set(key);
    if (key === 'custom') return;

    const to = new Date();
    const from = new Date();
    switch (key) {
      case '7d': from.setDate(from.getDate() - 7); break;
      case '30d': from.setDate(from.getDate() - 30); break;
      case '90d': from.setDate(from.getDate() - 90); break;
      case '6m': from.setMonth(from.getMonth() - 6); break;
      case '1y': from.setFullYear(from.getFullYear() - 1); break;
    }
    this.fromDate.set(this.toInputDate(from));
    this.toDate.set(this.toInputDate(to));
    this.load();
  }

  onCustomDateChange() {
    this.range.set('custom');
    if (this.fromDate() && this.toDate()) this.load();
  }

  load() {
    this.isLoading.set(true);
    this.fieldVisitsService.getCompanyVisits({
      from: this.fromDate() || undefined,
      to: this.toDate() || undefined,
      employeeId: this.employeeId() ?? undefined,
      projectId: this.projectId() ?? undefined,
      status: this.status() || undefined,
    }).subscribe({
      next: (res) => {
        this.visits.set(res.visits || []);
        this.summary.set(res.summary || EMPTY_SUMMARY);
        this.isLoading.set(false);
      },
      error: () => {
        this.visits.set([]);
        this.summary.set(EMPTY_SUMMARY);
        this.isLoading.set(false);
      },
    });
  }

  resetFilters() {
    this.employeeId.set(null);
    this.projectId.set(null);
    this.status.set('');
    this.search.set('');
    this.applyRange('30d');
  }

  openVisit(visit: FieldVisit) {
    this.selected.set(visit);
  }

  closeVisit() {
    this.selected.set(null);
  }

  pointCount(visit: FieldVisit): number {
    return Array.isArray(visit.routePoints) ? visit.routePoints.length : 0;
  }

  statusClass(status: string): string {
    switch (status) {
      case 'IN_PROGRESS': return 'st-progress';
      case 'COMPLETED': return 'st-completed';
      case 'CANCELLED': return 'st-cancelled';
      default: return 'st-completed';
    }
  }

  initials(visit: FieldVisit): string {
    return (visit.employee?.firstName?.[0] ?? '') + (visit.employee?.lastName?.[0] ?? '');
  }

  mapUrl(lat?: number | null, lng?: number | null): string {
    return `https://www.google.com/maps?q=${lat},${lng}`;
  }

  private toInputDate(d: Date): string {
    // Local Y-M-D, not toISOString() — that shifts to UTC and can land on the
    // previous day for anyone east of Greenwich, which is everyone here.
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
}
