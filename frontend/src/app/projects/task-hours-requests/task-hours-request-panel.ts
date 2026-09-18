import { Component, inject, input, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucidePlus, LucideX, LucideCheck, LucideLoader2, LucideClock, LucideAlertTriangle,
} from '@lucide/angular';
import {
  TaskHoursRequestsService, TaskHoursRequestList,
} from '../../services/task-hours-requests';

/**
 * Asking for more hours on a task, from the task itself (§3).
 *
 * This is the other half of the ceiling. The server refuses a log past the
 * assigned hours and tells the person to request more; without somewhere to do
 * that, the refusal is just a wall. So it lives on the task detail, next to
 * the time tracking it constrains, rather than on a separate screen the
 * refusal does not point to.
 *
 * Kept as its own component on purpose: project-detail is already sixteen
 * thousand lines across three files, and this has its own state, its own
 * fetch and its own form.
 */
@Component({
  selector: 'app-task-hours-request-panel',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    LucidePlus, LucideX, LucideCheck, LucideLoader2, LucideClock, LucideAlertTriangle,
  ],
  templateUrl: './task-hours-request-panel.html',
  styleUrls: ['./task-hours-request-panel.css'],
})
export class TaskHoursRequestPanelComponent {
  private api = inject(TaskHoursRequestsService);
  private toast = inject(HotToastService);

  issueId = input.required<number>();

  data = signal<TaskHoursRequestList | null>(null);
  loading = signal(true);
  saving = signal(false);
  formOpen = signal(false);

  form = { requestedHours: null as number | null, reason: '' };

  hours = computed(() => this.data()?.hours ?? null);
  requests = computed(() => this.data()?.requests ?? []);
  canRequest = computed(() => this.data()?.canRequest ?? false);

  /** The request already waiting on a decision, if there is one. */
  openRequest = computed(() => this.requests().find((r) => r.status === 'REQUESTED') ?? null);

  /**
   * Whether the task is out of hours. Null remaining means the task was never
   * estimated, which is unbounded rather than exhausted.
   */
  isExhausted = computed(() => {
    const h = this.hours();
    return h?.remaining != null && h.remaining <= 0;
  });

  constructor() {
    // Reloads when the panel is pointed at a different task.
    effect(() => {
      const id = this.issueId();
      if (id) this.load(id);
    });
  }

  private load(issueId: number) {
    this.loading.set(true);
    this.api.forIssue(issueId).subscribe({
      next: (d) => { this.data.set(d); this.loading.set(false); },
      // Silent: this panel is an addition to the task detail, and a failure
      // here must not bury the task itself under an error toast.
      error: () => { this.loading.set(false); },
    });
  }

  openForm() {
    this.form = { requestedHours: null, reason: '' };
    this.formOpen.set(true);
  }

  closeForm() {
    this.formOpen.set(false);
  }

  submit() {
    const requestedHours = Number(this.form.requestedHours);
    if (!Number.isFinite(requestedHours) || requestedHours <= 0) {
      this.toast.error('Enter how many additional hours you need');
      return;
    }
    const reason = this.form.reason.trim();
    if (!reason) {
      this.toast.error('A reason is required — it is what the manager rules on');
      return;
    }

    this.saving.set(true);
    this.api.create(this.issueId(), { requestedHours, reason }).subscribe({
      next: () => {
        this.saving.set(false);
        this.formOpen.set(false);
        this.toast.success('Request sent to the project manager');
        this.load(this.issueId());
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(err?.error?.message || 'Could not send the request');
      },
    });
  }

  fullName(p: { firstName: string; lastName: string } | null): string {
    return p ? `${p.firstName} ${p.lastName}`.trim() : '—';
  }
}
