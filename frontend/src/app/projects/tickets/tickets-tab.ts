import { Component, inject, input, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucidePlus, LucideX, LucideCheck, LucideTicket, LucideClock, LucideUser,
  LucideCalendar, LucideAlertTriangle, LucideLoader2, LucidePencil, LucideArrowRight,
  LucideSearch, LucideChevronDown,
} from '@lucide/angular';
import {
  ProjectTicketsService, ProjectTicket, ProjectTicketStatus,
} from '../../services/project-tickets';
import { ProjectsService } from '../../services/projects';
import { AuthService } from '../../services/auth.service';

/**
 * Project tickets (§29, §30).
 *
 * Its own component rather than another block inside project-detail, which is
 * already four and a half thousand lines — the same call milestones made.
 *
 * ── What a ticket is ─────────────────────────────────────────────────────
 * A proposed task. A project manager can already create a task outright, so a
 * ticket is specifically for work that needs somebody else's yes first: scope
 * the client has asked for that grows the project. The approval is the whole
 * point, which is why the screen leads with status and who is waiting on whom.
 *
 * Once approved the ticket stops being something you act on and becomes the
 * record of why a task exists — so a converted ticket shows its task and
 * offers no buttons.
 */
@Component({
  selector: 'app-tickets-tab',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    LucidePlus, LucideX, LucideCheck, LucideTicket, LucideClock, LucideUser,
    LucideCalendar, LucideAlertTriangle, LucideLoader2, LucidePencil, LucideArrowRight,
    LucideSearch, LucideChevronDown,
  ],
  templateUrl: './tickets-tab.html',
  styleUrls: ['./tickets-tab.css'],
})
export class TicketsTabComponent {
  private api = inject(ProjectTicketsService);
  private projectsService = inject(ProjectsService);
  private auth = inject(AuthService);
  private toast = inject(HotToastService);

  projectId = input.required<number>();

  tickets = signal<ProjectTicket[]>([]);
  members = signal<any[]>([]);
  loading = signal(true);
  saving = signal(false);

  /** The ticket being edited, or 'new', or null when the form is closed. */
  editing = signal<number | 'new' | null>(null);
  statusFilter = signal<string>('ALL');
  /** Ids with a decision in flight, so a button cannot be pressed twice. */
  busy = signal<Set<number>>(new Set());

  /** Searchable assignee dropdown & validation state */
  assigneeDropdownOpen = signal(false);
  assigneeSearchQuery = signal('');
  submitted = signal(false);

  form = this.blankForm();

  private role = computed(() => this.auth.currentUser()?.role ?? 'EMPLOYEE');
  isAdmin = computed(() => ['SUPERADMIN', 'ADMIN'].includes(this.role()));

  readonly STATUSES: { value: string; label: string }[] = [
    { value: 'ALL', label: 'All' },
    { value: 'REQUESTED', label: 'Awaiting approval' },
    { value: 'CONVERTED', label: 'Converted to task' },
    { value: 'COMPLETED', label: 'Completed' },
    { value: 'REJECTED', label: 'Rejected' },
    { value: 'CANCELLED', label: 'Cancelled' },
  ];

  readonly PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;

  constructor() {
    effect(() => {
      const id = this.projectId();
      if (id) this.load(id);
    });
  }

  visible = computed(() => {
    const f = this.statusFilter();
    const list = this.tickets();
    const filtered = f === 'ALL' ? list : list.filter((t) => t.status === f);
    return [...filtered].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  });

  awaitingCount = computed(() => this.tickets().filter((t) => t.status === 'REQUESTED').length);

  filteredMembers = computed(() => {
    const q = this.assigneeSearchQuery().toLowerCase().trim();
    const list = this.members();
    if (!q) return list;
    return list.filter((m) => {
      const name = `${m.firstName || ''} ${m.lastName || ''}`.toLowerCase();
      const role = (m.memberRole || '').toLowerCase();
      const email = (m.user?.email || '').toLowerCase();
      return name.includes(q) || role.includes(q) || email.includes(q);
    });
  });

  /**
   * The employee currently chosen, for the closed selector (§6).
   *
   * A method, not a computed. `form` is a plain object, so a computed reading
   * form.proposedAssigneeId has no signal to invalidate it: it evaluated once
   * with nothing selected, cached null, and kept saying "Select employee…"
   * after a choice was made. That is exactly the confusion this section is
   * about, and it got worse the longer the list, because the picked name
   * scrolled out of view with nothing on the trigger to confirm it.
   *
   * Resolved against the full member list rather than the filtered one, so a
   * search that excludes the chosen person does not blank the trigger.
   */
  selectedMember() {
    const id = this.form.proposedAssigneeId;
    if (!id) return null;
    return this.members().find((m) => m.id === id) || null;
  }

  /** Same reason as selectedMember above: `form` is not a signal. */
  dateError() {
    if (this.form.startDate && this.form.dueDate && this.form.dueDate < this.form.startDate) {
      return 'Due date cannot be earlier than start date';
    }
    return null;
  }


  private load(projectId: number) {
    this.loading.set(true);
    this.api.list(projectId).subscribe({
      next: (rows) => { this.tickets.set(rows || []); this.loading.set(false); },
      error: (e) => { this.loading.set(false); this.fail(e, 'Could not load tickets.'); },
    });

    // Members, because a proposed assignee has to be one — the server refuses
    // anybody else, so the picker should not offer them.
    this.projectsService.getProject(projectId).subscribe({
      next: (p: any) => {
        const list = p?.members?.map((m: any) => {
          if (!m.employee) return null;
          return {
            ...m.employee,
            memberRole: m.role || 'MEMBER',
          };
        }).filter(Boolean) ?? [];
        this.members.set(list);
      },
      error: () => this.members.set([]),
    });
  }

  reload() { this.load(this.projectId()); }

  private blankForm() {
    return {
      title: '',
      description: '',
      proposedAssigneeId: null as number | null,
      priority: 'MEDIUM',
      startDate: '',
      dueDate: '',
      estimatedHours: null as number | null,
    };
  }

  openNew() {
    this.submitted.set(false);
    this.assigneeDropdownOpen.set(false);
    this.assigneeSearchQuery.set('');
    this.form = this.blankForm();
    this.editing.set('new');
  }

  openEdit(ticket: ProjectTicket) {
    this.submitted.set(false);
    this.assigneeDropdownOpen.set(false);
    this.assigneeSearchQuery.set('');
    this.form = {
      title: ticket.title,
      description: ticket.description ?? '',
      proposedAssigneeId: ticket.proposedAssignee?.id ?? null,
      priority: ticket.priority,
      startDate: ticket.startDate ? ticket.startDate.slice(0, 10) : '',
      dueDate: ticket.dueDate ? ticket.dueDate.slice(0, 10) : '',
      estimatedHours: ticket.estimatedHours,
    };
    this.editing.set(ticket.id);
  }

  closeForm() {
    this.editing.set(null);
    this.submitted.set(false);
    this.assigneeDropdownOpen.set(false);
    this.assigneeSearchQuery.set('');
    this.form = this.blankForm();
  }

  toggleAssigneeDropdown() {
    const next = !this.assigneeDropdownOpen();
    this.assigneeDropdownOpen.set(next);
    if (next) {
      this.assigneeSearchQuery.set('');
    }
  }

  selectMember(m: any) {
    this.form.proposedAssigneeId = m.id;
    this.assigneeDropdownOpen.set(false);
    this.assigneeSearchQuery.set('');
  }

  clearMember(event?: Event) {
    if (event) event.stopPropagation();
    this.form.proposedAssigneeId = null;
    this.assigneeDropdownOpen.set(false);
  }

  save() {
    this.submitted.set(true);

    if (!this.form.title.trim()) {
      this.toast.error('Ticket title is required.');
      return;
    }
    if (!this.form.description.trim()) {
      this.toast.error('Ticket details / description are required.');
      return;
    }
    if (!this.form.proposedAssigneeId) {
      this.toast.error('Please assign this ticket to a team member.');
      return;
    }
    if (!this.form.priority) {
      this.toast.error('Priority is required.');
      return;
    }
    if (!this.form.startDate) {
      this.toast.error('Start date is required.');
      return;
    }
    if (!this.form.dueDate) {
      this.toast.error('Due date is required.');
      return;
    }
    if (this.form.dueDate < this.form.startDate) {
      this.toast.error('Due date cannot be earlier than start date.');
      return;
    }
    if (this.form.estimatedHours == null || Number(this.form.estimatedHours) <= 0) {
      this.toast.error('Estimated hours are required and must be greater than 0.');
      return;
    }

    if (this.saving()) return;
    this.saving.set(true);

    const payload = {
      title: this.form.title.trim(),
      description: this.form.description.trim(),
      proposedAssigneeId: this.form.proposedAssigneeId,
      priority: this.form.priority,
      startDate: this.form.startDate,
      dueDate: this.form.dueDate,
      estimatedHours: Number(this.form.estimatedHours),
    };

    const editing = this.editing();
    const request$ =
      editing === 'new'
        ? this.api.create(this.projectId(), payload)
        : this.api.update(editing as number, payload);

    request$.subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success(editing === 'new' ? 'Ticket raised for approval.' : 'Ticket updated.');
        this.closeForm();
        this.reload();
      },
      error: (e) => { this.saving.set(false); this.fail(e, 'Could not save that ticket.'); },
    });
  }

  approve(ticket: ProjectTicket) {
    if (this.isBusy(ticket.id)) return;
    this.setBusy(ticket.id, true);
    this.api.review(ticket.id, 'APPROVED').subscribe({
      next: () => {
        this.setBusy(ticket.id, false);
        // Approval creates the task in the same breath — say so, because the
        // user did not press anything called "create task".
        this.toast.success(`${ticket.ticketNumber} approved and converted to a task.`);
        this.reload();
      },
      error: (e) => { this.setBusy(ticket.id, false); this.fail(e, 'Could not approve that ticket.'); },
    });
  }

  /** §30 rejection. The reason reaches the PM, so it is collected up front. */
  reject(ticket: ProjectTicket) {
    const reason = window.prompt(
      `Why is ${ticket.ticketNumber} being rejected?\n\nThe project manager sees this.`,
    );
    if (reason === null) return;
    if (!reason.trim()) {
      this.toast.error('A rejection needs a reason.');
      return;
    }
    if (this.isBusy(ticket.id)) return;
    this.setBusy(ticket.id, true);
    this.api.review(ticket.id, 'REJECTED', reason.trim()).subscribe({
      next: () => {
        this.setBusy(ticket.id, false);
        this.toast.success(`${ticket.ticketNumber} rejected.`);
        this.reload();
      },
      error: (e) => { this.setBusy(ticket.id, false); this.fail(e, 'Could not reject that ticket.'); },
    });
  }

  cancel(ticket: ProjectTicket) {
    if (!window.confirm(`Withdraw ${ticket.ticketNumber}?`)) return;
    if (this.isBusy(ticket.id)) return;
    this.setBusy(ticket.id, true);
    this.api.cancel(ticket.id).subscribe({
      next: () => {
        this.setBusy(ticket.id, false);
        this.toast.success(`${ticket.ticketNumber} withdrawn.`);
        this.reload();
      },
      error: (e) => { this.setBusy(ticket.id, false); this.fail(e, 'Could not withdraw that ticket.'); },
    });
  }

  isBusy(id: number) { return this.busy().has(id); }

  private setBusy(id: number, busy: boolean) {
    const next = new Set(this.busy());
    busy ? next.add(id) : next.delete(id);
    this.busy.set(next);
  }

  // ── display ────────────────────────────────────────────────────────────

  statusLabel(status: ProjectTicketStatus): string {
    return {
      REQUESTED: 'Awaiting approval',
      APPROVED: 'Approved',
      REJECTED: 'Rejected',
      CONVERTED: 'Converted to task',
      COMPLETED: 'Completed',
      CANCELLED: 'Withdrawn',
    }[status];
  }

  /** A ticket still open to editing, withdrawal or a decision. */
  isOpen(ticket: ProjectTicket) { return ticket.status === 'REQUESTED'; }

  fullName(p: { firstName?: string; lastName?: string } | null): string {
    if (!p) return 'Unassigned';
    return `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'Unnamed';
  }

  initials(p: { firstName?: string; lastName?: string } | null): string {
    if (!p) return '?';
    return `${(p.firstName || '').charAt(0)}${(p.lastName || '').charAt(0)}`.toUpperCase() || '?';
  }

  getMemberColor(p: { firstName?: string; lastName?: string } | null): string {
    const name = this.fullName(p);
    const colors = [
      '#3b82f6', '#10b981', '#8b5cf6', '#6b3fd6', '#06b6d4',
      '#6b3fd6', '#6366f1', '#14b8a6', '#1373e5', '#84cc16'
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  hours(n: number | null): string {
    if (n == null) return 'Not estimated';
    return n === 1 ? '1 hour' : `${n} hours`;
  }

  trackById = (_: number, t: ProjectTicket) => t.id;

  private fail(err: any, fallback: string) {
    this.toast.error(err?.error?.message || fallback);
  }
}
