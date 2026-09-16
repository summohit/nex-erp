import { Component, inject, input, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucidePause,
  LucidePlus, LucideTrash2, LucideChevronUp, LucideChevronDown,
  LucideFlag, LucideX, LucidePencil, LucideCheck,
  LucideCalendar, LucideClock, LucideCheckCircle2, LucideAlertTriangle,
  LucideSearch, LucideCheckSquare, LucideCoins, LucidePieChart,
  LucideCircleDot, LucideTrendingUp
} from '@lucide/angular';
import { ProjectsService, Milestone, MilestoneList } from '../../services/projects';
import { EmployeeService } from '../../services/employee.service';

/**
 * Project milestones (§13).
 *
 * Its own component rather than another block inside project-detail, which is
 * already four thousand lines. It owns one tab and talks to one endpoint.
 *
 * Every permission question — may I see the amounts, may I edit — is answered
 * by the list response, not re-derived from the user's role here. Deriving it
 * twice is how a UI ends up showing an edit button that the server refuses.
 */
@Component({
  selector: 'app-milestones-tab',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    LucidePlus, LucideTrash2, LucideChevronUp, LucideChevronDown,
    LucideFlag, LucideX, LucidePencil, LucideCheck,
    LucideCalendar, LucideClock, LucideCheckCircle2, LucideAlertTriangle,
    LucideSearch, LucideCheckSquare, LucideCoins, LucidePieChart,
    LucideCircleDot, LucideTrendingUp, LucidePause
  ],
  templateUrl: './milestones-tab.html',
  styleUrls: ['./milestones-tab.css']
})
export class MilestonesTabComponent {
  private projectsService = inject(ProjectsService);
  private employeeService = inject(EmployeeService);
  private toast = inject(HotToastService);

  /** The project whose milestones these are. */
  projectId = input.required<number>();

  data = signal<MilestoneList | null>(null);
  loading = signal(true);
  employees = signal<any[]>([]);

  /** Search query and filter tab */
  searchQuery = signal('');
  statusFilter = signal<string>('ALL');

  /** The milestone being edited, or 'new', or null when the form is closed. */
  editing = signal<number | 'new' | null>(null);
  saving = signal(false);

  readonly STATUSES = ['PENDING', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] as const;

  form = this.blankForm();

  milestones = computed(() => this.data()?.milestones ?? []);
  canManage = computed(() => this.data()?.canManage ?? false);
  canViewFinancials = computed(() => this.data()?.canViewFinancials ?? false);
  totals = computed(() => this.data()?.totals ?? null);
  currency = computed(() => this.data()?.currency ?? 'INR');

  /** Completed against total — the §41 "Milestones 3 / 5" card. */
  completedCount = computed(() => this.milestones().filter(m => m.status === 'COMPLETED').length);

  completionRate = computed(() => {
    const total = this.milestones().length;
    if (!total) return 0;
    return Math.round((this.completedCount() / total) * 100);
  });

  statusCounts = computed(() => {
    const list = this.milestones();
    return {
      ALL: list.length,
      IN_PROGRESS: list.filter(m => m.status === 'IN_PROGRESS').length,
      PENDING: list.filter(m => m.status === 'PENDING').length,
      ON_HOLD: list.filter(m => m.status === 'ON_HOLD').length,
      COMPLETED: list.filter(m => m.status === 'COMPLETED').length,
      CANCELLED: list.filter(m => m.status === 'CANCELLED').length,
    };
  });

  filteredMilestones = computed(() => {
    let list = this.milestones();
    const filter = this.statusFilter();
    if (filter !== 'ALL') {
      list = list.filter(m => m.status === filter);
    }
    const q = this.searchQuery().trim().toLowerCase();
    if (q) {
      list = list.filter(m =>
        m.name.toLowerCase().includes(q) ||
        (m.description && m.description.toLowerCase().includes(q)) ||
        (m.owner && this.ownerName(m).toLowerCase().includes(q))
      );
    }
    return list;
  });

  totalTasksDone = computed(() => this.milestones().reduce((sum, m) => sum + (m.taskDone || 0), 0));
  totalTasksTotal = computed(() => this.milestones().reduce((sum, m) => sum + (m.taskTotal || 0), 0));

  constructor() {
    // Re-fetch if the tab is ever pointed at a different project.
    effect(() => {
      const id = this.projectId();
      if (id) this.load(id);
    });

    this.employeeService.getEmployeesBasicList().subscribe({
      next: (list: any) => this.employees.set(list || []),
      error: () => {},
    });
  }

  private blankForm() {
    return {
      name: '',
      description: '',
      startDate: '',
      dueDate: '',
      status: 'PENDING' as string,
      amount: null as number | null,
      percentage: null as number | null,
    };
  }

  private load(projectId: number) {
    this.loading.set(true);
    this.projectsService.getMilestones(projectId).subscribe({
      next: (res) => {
        this.data.set(res);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.toast.error(err?.error?.message || 'Could not load milestones');
      },
    });
  }

  symbol(): string {
    const c = this.currency();
    return c === 'USD' ? '$' : c === 'EUR' ? '€' : '₹';
  }

  money(value: number | null | undefined): string {
    if (value == null) return '—';
    return `${this.symbol()}${Number(value).toLocaleString('en-IN')}`;
  }

  statusClass(status: string): string {
    return `ms-status ms-${status.toLowerCase().replace('_', '-')}`;
  }

  ownerName(m: Milestone): string {
    if (!m.owner) return 'Unassigned';
    return `${m.owner.firstName || ''} ${m.owner.lastName || ''}`.trim();
  }

  ownerInitials(m: Milestone): string {
    if (!m.owner) return '?';
    const first = m.owner.firstName?.[0] || '';
    const last = m.owner.lastName?.[0] || '';
    return (first + last).toUpperCase() || '?';
  }

  setStatusFilter(filter: string) {
    this.statusFilter.set(filter);
  }

  isOverdue(m: Milestone): boolean {
    if (!m.dueDate || m.status === 'COMPLETED' || m.status === 'CANCELLED') return false;
    return new Date(m.dueDate) < new Date();
  }

  openCreate() {
    this.form = this.blankForm();
    this.editing.set('new');
  }

  openEdit(m: Milestone) {
    this.form = {
      name: m.name,
      description: m.description || '',
      startDate: m.startDate ? m.startDate.split('T')[0] : '',
      dueDate: m.dueDate ? m.dueDate.split('T')[0] : '',
      status: m.status,
      // Absent rather than null when the viewer may not see money, so these
      // stay untouched and the server keeps whatever is stored.
      amount: m.amount ?? null,
      percentage: m.percentage ?? null,
    };
    this.editing.set(m.id);
  }

  cancelEdit() {
    this.editing.set(null);
    this.form = this.blankForm();
  }

  save() {
    if (!this.form.name.trim()) {
      this.toast.error('Milestone name is required');
      return;
    }

    const payload: any = {
      name: this.form.name.trim(),
      description: this.form.description || null,
      startDate: this.form.startDate || null,
      dueDate: this.form.dueDate || null,
      status: this.form.status,
    };
    // Only send money if this viewer is allowed to set it — the server ignores
    // it otherwise, and sending it anyway invites confusion when it is dropped.
    if (this.canViewFinancials()) {
      payload.amount = this.form.amount;
      payload.percentage = this.form.percentage;
    }

    this.saving.set(true);
    const target = this.editing();
    const request = target === 'new'
      ? this.projectsService.createMilestone(this.projectId(), payload)
      : this.projectsService.updateMilestone(this.projectId(), target as number, payload);

    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.cancelEdit();
        this.load(this.projectId());
        this.toast.success(target === 'new' ? 'Milestone added' : 'Milestone updated');
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(err?.error?.message || 'Could not save the milestone');
      },
    });
  }

  /** Quick status change from the row, without opening the form. */
  setStatus(m: Milestone, status: string) {
    if (m.status === status) return;
    this.projectsService.updateMilestone(this.projectId(), m.id, { status } as any).subscribe({
      next: () => this.load(this.projectId()),
      error: (err) => this.toast.error(err?.error?.message || 'Could not update the milestone'),
    });
  }

  /**
   * Whether this milestone may still be deleted.
   *
   * Mirrors the server rule rather than replacing it: only a PENDING
   * milestone can go, because once work is booked against one, deleting it
   * would unlink that work and erase the amount an invoice is owed for.
   */
  canDelete(m: Milestone): boolean {
    return m.status === 'PENDING';
  }

  remove(m: Milestone) {
    // Worth a confirm: a milestone carries the contract value, and deleting
    // one unlinks every task booked against it.
    if (!confirm(`Delete "${m.name}"? Tasks booked against it will be unlinked, not deleted.`)) return;

    this.projectsService.deleteMilestone(this.projectId(), m.id).subscribe({
      next: () => {
        this.load(this.projectId());
        this.toast.success('Milestone deleted');
      },
      error: (err) => this.toast.error(err?.error?.message || 'Could not delete the milestone'),
    });
  }

  move(m: Milestone, direction: -1 | 1) {
    const ids = this.milestones().map(x => x.id);
    const from = ids.indexOf(m.id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length) return;

    ids.splice(to, 0, ids.splice(from, 1)[0]);
    this.projectsService.reorderMilestones(this.projectId(), ids).subscribe({
      next: () => this.load(this.projectId()),
      error: (err) => this.toast.error(err?.error?.message || 'Could not reorder milestones'),
    });
  }
}
