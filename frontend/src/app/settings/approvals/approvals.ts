import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HotToastService } from '@ngneat/hot-toast';
import { LucideShieldCheck, LucideUserPlus, LucideX, LucideInfo, LucideRefreshCw } from '@lucide/angular';
import {
  SearchableSelectComponent, SearchableSelectOption,
} from '../../shared/components/searchable-select/searchable-select.component';
import { DialogService } from '../../shared/services/dialog.service';
import { EmployeeService } from '../../services/employee.service';
import { ApprovalDelegatesService, ApprovalWorkflowGroup } from './approvals.service';

/**
 * Who approves what (§Att5, and the same screen will serve §PB7/§PB8/§Att9).
 *
 * Each workflow here is a decision with no natural owner in the data — a
 * forgotten clock-out belongs to nobody's project — which is why they would
 * otherwise all land on the company owner. This page is how that bottleneck is
 * opened up.
 *
 * Deliberately additive only. The Super Admin can approve everything regardless
 * of what is on these lists, so no edit here can lock a workflow away from the
 * one person able to fix it. Some workflows also trust a role in code — HR on
 * clock-outs, for instance — and that is not the Super Admin's to revoke, so it
 * is stated on screen rather than being editable here.
 */
@Component({
  selector: 'app-approval-settings',
  standalone: true,
  imports: [
    CommonModule, FormsModule, SearchableSelectComponent,
    LucideShieldCheck, LucideUserPlus, LucideX, LucideInfo, LucideRefreshCw,
  ],
  templateUrl: './approvals.html',
  styleUrls: ['./approvals.css'],
})
export class ApprovalSettingsComponent implements OnInit {
  private delegates = inject(ApprovalDelegatesService);
  private employeeService = inject(EmployeeService);
  private dialog = inject(DialogService);
  private toast = inject(HotToastService);

  groups = signal<ApprovalWorkflowGroup[]>([]);
  employeeOptions = signal<SearchableSelectOption[]>([]);
  isLoading = signal(false);
  /** Which workflow's picker is open, and who is selected in it. */
  addingTo = signal<string | null>(null);
  picked = signal<number | null>(null);
  busy = signal(false);

  /**
   * What each workflow already trusts without anybody being added.
   *
   * Stated so the page does not read as though these lists are the whole rule —
   * an empty list does not mean nobody can approve.
   */
  readonly alwaysAllowed: Record<string, string> = {
    CLOCK_OUT: 'Super Admin and HR can always approve these.',
    PURCHASE_ORDER: 'A Super Admin can always approve these.',
    TASK: 'A Super Admin can always approve these.',
    LEAVE_ON_BEHALF: 'A Super Admin can always approve these.',
    EXPENSE_CLAIM: 'Super Admin, Admin, HR and Finance can always approve and pay these.',
  };

  ngOnInit(): void {
    this.load();
    this.employeeService.getEmployeesBasicList().subscribe({
      next: (list) => this.employeeOptions.set(
        (list ?? []).map((e: any) => ({
          id: e.id,
          name: `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim() || `Employee ${e.id}`,
          subtitle: e.employeeCode || e.designation || undefined,
        })),
      ),
      error: () => this.toast.error('Could not load the employee list'),
    });
  }

  load(): void {
    this.isLoading.set(true);
    this.delegates.list().subscribe({
      next: (data) => {
        this.groups.set(data ?? []);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.isLoading.set(false);
        this.toast.error(err?.error?.message || 'Could not load approval settings');
      },
    });
  }

  openPicker(workflow: string): void {
    this.addingTo.set(workflow);
    this.picked.set(null);
  }

  cancelPicker(): void {
    this.addingTo.set(null);
    this.picked.set(null);
  }

  /** Already on this workflow — offering them again would only produce a no-op. */
  optionsFor(group: ApprovalWorkflowGroup): SearchableSelectOption[] {
    const taken = new Set(group.delegates.map((d) => d.employeeId));
    return this.employeeOptions().filter((o) => !taken.has(o.id));
  }

  grant(workflow: string): void {
    const employeeId = this.picked();
    if (employeeId == null || this.busy()) return;
    this.busy.set(true);

    this.delegates.grant(workflow, employeeId).subscribe({
      next: () => {
        this.busy.set(false);
        this.cancelPicker();
        this.toast.success('Added to the approval list');
        this.load();
      },
      error: (err) => {
        this.busy.set(false);
        this.toast.error(err?.error?.message || 'Could not add that person');
      },
    });
  }

  /**
   * Taking somebody off is asked about rather than done on a click: the person
   * removed stops seeing a queue they may be the only one watching.
   */
  async revoke(group: ApprovalWorkflowGroup, row: any): Promise<void> {
    const name = `${row.employee?.firstName ?? ''} ${row.employee?.lastName ?? ''}`.trim() || 'this person';
    const last = group.delegates.length === 1;

    const ok = await this.dialog.confirm(
      last
        ? `${name} is the only person added to "${group.label}". Removing them leaves it to whoever the rule already trusts. Continue?`
        : `${name} will no longer be able to approve "${group.label}".`,
      'Remove from approval list',
      'Remove',
      'Keep',
    );
    if (!ok) return;

    this.busy.set(true);
    this.delegates.revoke(group.workflow, row.employeeId).subscribe({
      next: () => {
        this.busy.set(false);
        this.toast.success(`${name} removed`);
        this.load();
      },
      error: (err) => {
        this.busy.set(false);
        this.toast.error(err?.error?.message || 'Could not remove that person');
      },
    });
  }

  initials(row: any): string {
    const f = row.employee?.firstName?.[0] ?? '';
    const l = row.employee?.lastName?.[0] ?? '';
    return (f + l).toUpperCase() || '?';
  }

  fullName(row: any): string {
    return `${row.employee?.firstName ?? ''} ${row.employee?.lastName ?? ''}`.trim() || 'Unknown';
  }
}
