import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import {
  LucideAward,
  LucideBriefcase,
  LucideBuilding,
  LucideCalendar,
  LucideCalendarCheck,
  LucideCalendarClock,
  LucideCalendarDays,
  LucideCheck,
  LucideChevronDown,
  LucideClock,
  LucideFileText,
  LucideInfo,
  LucideMapPin,
  LucideMinus,
  LucidePlus,
  LucideSearch,
  LucideSparkles,
  LucideUserCheck,
  LucideUsers,
  LucideX,
} from '@lucide/angular';
import { environment } from '../../../../environments/environment';

export interface CompOffCredit {
  id: number;
  date: string | null;
  days: number;
  reason: string;
  creditedOn: string;
  clockIn: string | null;
  clockOut: string | null;
  shift: string | null;
  onsite: boolean;
  project: string | null;
  fieldVisit: { id: number; number: string; location: string; project: string | null } | null;
}

export interface CompOffPerson {
  employee: {
    id: number;
    firstName: string;
    lastName?: string | null;
    employeeCode?: string | null;
    avatarUrl?: string | null;
    department?: { name: string } | null;
    designation?: { name: string } | null;
  };
  allocated: number;
  used: number;
  remaining: number;
  earnedFromWork: number;
  addedManually: number;
  credits: CompOffCredit[];
  used_leaves: { id: number; from: string; to: string; halfDay: boolean; reason?: string | null }[];
}

/**
 * Comp-off history: which day each compensatory off was earned for and why
 * (holiday, weekly off, rostered day off), the clock times and the field visit
 * or project behind it, and where it was used.
 *
 * An employee sees their own. HR and admins (`allEmployees`) see everyone,
 * with search, quick filters, and expandable details per person.
 */
@Component({
  selector: 'app-comp-off-history',
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    FormsModule,
    LucideAward,
    LucideBriefcase,
    LucideBuilding,
    LucideCalendar,
    LucideCalendarCheck,
    LucideCalendarClock,
    LucideCalendarDays,
    LucideCheck,
    LucideChevronDown,
    LucideClock,
    LucideFileText,
    LucideInfo,
    LucideMapPin,
    LucideMinus,
    LucidePlus,
    LucideSearch,
    LucideSparkles,
    LucideUserCheck,
    LucideUsers,
    LucideX,
  ],
  templateUrl: './comp-off-history.html',
  styleUrl: './comp-off-history.css',
})
export class CompOffHistoryComponent implements OnChanges {
  private http = inject(HttpClient);

  @Input() open = false;
  @Input() allEmployees = false;
  @Output() closed = new EventEmitter<void>();

  year = signal(new Date().getFullYear());
  loading = signal(false);
  error = signal<string | null>(null);
  people = signal<CompOffPerson[]>([]);
  query = signal('');
  filterStatus = signal<'all' | 'balance' | 'zero'>('all');
  expandedIds = signal<Set<number>>(new Set());

  readonly years = [0, 1, 2].map((i) => new Date().getFullYear() - i);

  countWithBalance = computed(() => this.people().filter((p) => p.remaining > 0).length);
  countZeroBalance = computed(() => this.people().filter((p) => p.remaining === 0).length);

  totalBalanceDays = computed(() => this.people().reduce((sum, p) => sum + (p.remaining || 0), 0));
  totalAllocatedDays = computed(() => this.people().reduce((sum, p) => sum + (p.allocated || 0), 0));
  totalUsedDays = computed(() => this.people().reduce((sum, p) => sum + (p.used || 0), 0));

  filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const status = this.filterStatus();
    return this.people().filter((p) => {
      if (status === 'balance' && p.remaining <= 0) return false;
      if (status === 'zero' && p.remaining > 0) return false;
      if (!q) return true;
      const matchStr = `${p.employee.firstName} ${p.employee.lastName || ''} ${p.employee.employeeCode || ''} ${p.employee.department?.name || ''} ${p.employee.designation?.name || ''}`.toLowerCase();
      return matchStr.includes(q);
    });
  });

  allAreExpanded = computed(() => {
    const f = this.filtered();
    return f.length > 0 && f.every((p) => this.expandedIds().has(p.employee.id));
  });

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.open) this.close();
  }

  ngOnChanges() {
    if (this.open) this.load();
  }

  setYear(y: number) {
    this.year.set(Number(y));
    this.load();
  }

  setFilter(status: 'all' | 'balance' | 'zero') {
    this.filterStatus.set(status);
  }

  clearQuery() {
    this.query.set('');
  }

  load() {
    this.loading.set(true);
    this.error.set(null);
    const params: Record<string, string> = { year: String(this.year()) };
    if (!this.allEmployees) params['mine'] = '1';
    this.http.get<{ employees: CompOffPerson[] }>(`${environment.apiUrl}/attendance/comp-off/history`, { params }).subscribe({
      next: (res) => {
        const list = res?.employees || [];
        this.people.set(list);
        if (!this.allEmployees && list.length) {
          this.expandedIds.set(new Set([list[0].employee.id]));
        } else {
          this.expandedIds.set(new Set());
        }
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message || 'Could not load comp-off history');
        this.loading.set(false);
      },
    });
  }

  isExpanded(id: number): boolean {
    return this.expandedIds().has(id);
  }

  toggle(id: number) {
    this.expandedIds.update((set) => {
      const next = new Set(set);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  toggleAll() {
    if (this.allAreExpanded()) {
      this.expandedIds.set(new Set());
    } else {
      const ids = new Set(this.filtered().map((p) => p.employee.id));
      this.expandedIds.set(ids);
    }
  }

  name(p: CompOffPerson): string {
    return `${p?.employee?.firstName || ''} ${p?.employee?.lastName || ''}`.trim() || 'Employee';
  }

  initials(p: CompOffPerson): string {
    const f = (p?.employee?.firstName || '').trim()[0] || '';
    const l = (p?.employee?.lastName || '').trim()[0] || '';
    return (f + l).toUpperCase() || '?';
  }

  avatarBg(p: CompOffPerson): string {
    const gradients = [
      'linear-gradient(135deg, #3b82f6, #1d4ed8)',
      'linear-gradient(135deg, #8b5cf6, #6d28d9)',
      'linear-gradient(135deg, #0ea5e9, #0284c7)',
      'linear-gradient(135deg, #10b981, #059669)',
      'linear-gradient(135deg, #f59e0b, #d97706)',
      'linear-gradient(135deg, #ec4899, #be185d)',
      'linear-gradient(135deg, #6366f1, #4338ca)',
      'linear-gradient(135deg, #14b8a6, #0f766e)',
    ];
    let hash = 0;
    const key = `${p?.employee?.id ?? 0}-${p?.employee?.firstName ?? ''}`;
    for (let i = 0; i < key.length; i++) {
      hash = key.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % gradients.length;
    return gradients[index];
  }

  close() {
    this.closed.emit();
  }
}
