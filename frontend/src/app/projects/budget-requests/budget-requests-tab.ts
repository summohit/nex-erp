import { Component, inject, input, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucidePlus, LucideX, LucideCheck, LucideTrendingUp, LucideLoader2,
  LucideAlertTriangle, LucideArrowRight,
} from '@lucide/angular';
import {
  BudgetRequestsService, BudgetRequest, BudgetRequestList,
} from '../../services/budget-requests';

/**
 * Project budget and hours increase requests (§25).
 *
 * ── Why this screen exists at all ────────────────────────────────────────
 * A project manager can see the budget but cannot move it. Scope growing is
 * the moment a project stops being the one that was agreed to, so somebody
 * else has to say yes. The approval is the feature; this is the paper trail.
 *
 * ── Every number here is money ───────────────────────────────────────────
 * Which means the server refuses the whole endpoint to anyone who may not see
 * a project's budget. There is no partial view to render, so this component
 * does not strip fields or hide columns — if the request 403s, the tab simply
 * says so. Two separate permissions come back: reading and raising are not
 * the same, and finance may do only one of them.
 */
@Component({
  selector: 'app-budget-requests-tab',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    LucidePlus, LucideX, LucideCheck, LucideTrendingUp, LucideLoader2,
    LucideAlertTriangle, LucideArrowRight,
  ],
  templateUrl: './budget-requests-tab.html',
  styleUrls: ['./budget-requests-tab.css'],
})
export class BudgetRequestsTabComponent {
  private api = inject(BudgetRequestsService);
  private toast = inject(HotToastService);

  projectId = input.required<number>();

  data = signal<BudgetRequestList | null>(null);
  loading = signal(true);
  saving = signal(false);
  /** Set when the server refuses — this person may not see the budget. */
  forbidden = signal(false);

  formOpen = signal(false);
  busy = signal<Set<number>>(new Set());
  submitted = signal(false);

  form = this.blankForm();

  hasHours = computed(() => Number(this.form.additionalHours) > 0);
  hasBudget = computed(() => Number(this.form.additionalBudget) > 0);
  hasAmount = computed(() => this.hasHours() || this.hasBudget());

  requests = computed(() => {
    const list = this.data()?.requests ?? [];
    return [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  });
  canRequest = computed(() => this.data()?.canRequest ?? false);
  canApprove = computed(() => this.data()?.canApprove ?? false);
  currency = computed(() => this.data()?.currency ?? 'INR');
  current = computed(() => this.data()?.current ?? { estimatedHours: null, budgetAmount: null });

  pendingCount = computed(() => this.requests().filter((r) => r.status === 'PENDING').length);

  constructor() {
    effect(() => {
      const id = this.projectId();
      if (id) this.load(id);
    });
  }

  private load(projectId: number) {
    this.loading.set(true);
    this.forbidden.set(false);
    this.api.list(projectId).subscribe({
      next: (d) => { this.data.set(d); this.loading.set(false); },
      error: (e) => {
        this.loading.set(false);
        // 403 is the expected answer for most of the company, not an error
        // worth shouting about.
        if (e?.status === 403) this.forbidden.set(true);
        else this.fail(e, 'Could not load budget requests.');
      },
    });
  }

  reload() { this.load(this.projectId()); }

  private blankForm() {
    return {
      additionalHours: null as number | null,
      additionalBudget: null as number | null,
      reason: '',
    };
  }

  openForm() {
    this.submitted.set(false);
    this.form = this.blankForm();
    this.formOpen.set(true);
  }

  closeForm() {
    this.submitted.set(false);
    this.formOpen.set(false);
    this.form = this.blankForm();
  }

  save() {
    this.submitted.set(true);
    const hours = Number(this.form.additionalHours) || 0;
    const budget = Number(this.form.additionalBudget) || 0;
    if (hours <= 0 && budget <= 0) {
      this.toast.error('Ask for additional hours, additional budget, or both.');
      return;
    }
    if (!this.form.reason.trim()) {
      this.toast.error('A reason is required — it is what the approver rules on.');
      return;
    }
    if (this.saving()) return;
    this.saving.set(true);

    this.api.create(this.projectId(), {
      additionalHours: hours > 0 ? hours : null,
      additionalBudget: budget > 0 ? budget : null,
      reason: this.form.reason.trim(),
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success('Request sent for approval.');
        this.closeForm();
        this.reload();
      },
      error: (e) => { this.saving.set(false); this.fail(e, 'Could not send that request.'); },
    });
  }

  approve(request: BudgetRequest) {
    if (this.isBusy(request.id)) return;
    this.setBusy(request.id, true);
    this.api.review(request.id, 'APPROVED').subscribe({
      next: () => {
        this.setBusy(request.id, false);
        // Approval moves the project, so say so — nobody pressed "edit project".
        this.toast.success('Approved. The project has been updated.');
        this.reload();
      },
      error: (e) => { this.setBusy(request.id, false); this.fail(e, 'Could not approve that request.'); },
    });
  }

  reject(request: BudgetRequest) {
    const reason = window.prompt(
      'Why is this request being rejected?\n\nThe project manager sees this.',
    );
    if (reason === null) return;
    if (!reason.trim()) {
      this.toast.error('A rejection needs a reason.');
      return;
    }
    if (this.isBusy(request.id)) return;
    this.setBusy(request.id, true);
    this.api.review(request.id, 'REJECTED', reason.trim()).subscribe({
      next: () => {
        this.setBusy(request.id, false);
        this.toast.success('Request rejected.');
        this.reload();
      },
      error: (e) => { this.setBusy(request.id, false); this.fail(e, 'Could not reject that request.'); },
    });
  }

  cancel(request: BudgetRequest) {
    if (!window.confirm('Withdraw this request?')) return;
    if (this.isBusy(request.id)) return;
    this.setBusy(request.id, true);
    this.api.cancel(request.id).subscribe({
      next: () => {
        this.setBusy(request.id, false);
        this.toast.success('Request withdrawn.');
        this.reload();
      },
      error: (e) => { this.setBusy(request.id, false); this.fail(e, 'Could not withdraw that request.'); },
    });
  }

  isBusy(id: number) { return this.busy().has(id); }

  private setBusy(id: number, busy: boolean) {
    const next = new Set(this.busy());
    busy ? next.add(id) : next.delete(id);
    this.busy.set(next);
  }

  // ── display ────────────────────────────────────────────────────────────

  money(amount: number | null | undefined): string {
    if (amount == null) return '—';
    return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  }

  hours(n: number | null | undefined): string {
    if (n == null) return '—';
    return `${n.toLocaleString('en-IN')} hrs`;
  }

  statusLabel(status: string): string {
    return {
      PENDING: 'Awaiting approval',
      APPROVED: 'Approved',
      REJECTED: 'Rejected',
      CANCELLED: 'Withdrawn',
    }[status] || status;
  }

  fullName(p: { firstName?: string; lastName?: string } | null): string {
    if (!p) return 'Unknown';
    return `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'Unnamed';
  }

  /** An approved request moved something; a rejected one moved nothing. */
  movedHours(r: BudgetRequest): boolean {
    return r.status === 'APPROVED' && r.hoursBefore !== r.hoursAfter;
  }

  movedBudget(r: BudgetRequest): boolean {
    return r.status === 'APPROVED' && r.budgetBefore !== r.budgetAfter;
  }

  trackById = (_: number, r: BudgetRequest) => r.id;

  private fail(err: any, fallback: string) {
    this.toast.error(err?.error?.message || fallback);
  }
}
