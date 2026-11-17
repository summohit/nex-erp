import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HotToastService } from '@ngneat/hot-toast';
import { firstValueFrom } from 'rxjs';
import { LucideCalendarDays } from '@lucide/angular';
import { FieldVisitChangeRow, FieldVisitRequestsService } from '../../services/field-visit-requests';

/**
 * Field visit change requests (16 Nov 2026): prepone, postpone, date change and
 * cancel requests on approved trips, pending first (longest wait on top) and
 * history after. Used on Field visits and on Approval Requests → Field Visits.
 */
@Component({
  selector: 'app-field-visit-change-requests',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, LucideCalendarDays],
  templateUrl: './change-requests.html',
  styleUrls: ['./change-requests.css'],
})
export class FieldVisitChangeRequestsComponent implements OnInit {
  /** Free-text filter from the host page's search box. */
  @Input() set search(v: string | null | undefined) { this.query.set((v ?? '').trim().toLowerCase()); }
  @Output() pendingCount = new EventEmitter<number>();
  /** A change was approved or rejected; the host may reload its trips. */
  @Output() decided = new EventEmitter<void>();

  private api = inject(FieldVisitRequestsService);
  private toast = inject(HotToastService);

  private query = signal('');
  changeRows = signal<FieldVisitChangeRow[]>([]);
  changeView = signal<'Pending' | 'History' | 'All'>('Pending');
  changeType = signal<'' | 'Prepone' | 'Postpone' | 'Date change' | 'Cancel'>('');
  changeBusy = signal<number | null>(null);
  rejectingChange = signal<number | null>(null);

  // ── Bulk approve (16 Nov 2026) ──
  selected = signal<Set<number>>(new Set());
  bulkBusy = signal(false);
  /** Rows on screen this person may decide. */
  selectable = computed(() => this.visibleChanges().filter((c) => c.canReview));
  selectedRows = computed(() => this.selectable().filter((c) => this.selected().has(c.id)));
  allSelected = computed(() => this.selectable().length > 0 && this.selectedRows().length === this.selectable().length);

  toggle(c: FieldVisitChangeRow, on: boolean) {
    const next = new Set(this.selected());
    on ? next.add(c.id) : next.delete(c.id);
    this.selected.set(next);
  }

  toggleAll(on: boolean) {
    this.selected.set(on ? new Set(this.selectable().map((c) => c.id)) : new Set());
  }

  /** Approve each selected change in turn; report how many went through. */
  async approveSelected() {
    const rows = this.selectedRows();
    if (!rows.length) return;
    this.bulkBusy.set(true);
    let ok = 0; const failed: string[] = [];
    for (const c of rows) {
      try { await firstValueFrom(this.api.approveModification(c.requestId)); ok++; }
      catch (err) { failed.push(`${c.requestNumber}: ${this.messageOf(err)}`); }
    }
    this.bulkBusy.set(false);
    this.selected.set(new Set());
    if (ok) this.toast.success(`${ok} change request${ok === 1 ? '' : 's'} approved`);
    if (failed.length) this.toast.error(failed.join(' · '), { duration: 8000 });
    this.loadChanges(); this.decided.emit();
  }
  rejectChangeText = '';

  visibleChanges = computed(() => {
    const view = this.changeView(); const type = this.changeType(); const q = this.query();
    return this.changeRows().filter((c) =>
      (view === 'All' || (view === 'Pending' ? c.status === 'Pending' : c.status !== 'Pending'))
      && (!type || c.type === type)
      && (!q || [c.requestNumber, c.project?.name, c.location, c.reason, c.requestedBy?.firstName, c.requestedBy?.lastName]
        .filter(Boolean).join(' ').toLowerCase().includes(q)));
  });
  changeCounts = computed(() => {
    const rows = this.changeRows();
    return { Pending: rows.filter((c) => c.status === 'Pending').length, History: rows.filter((c) => c.status !== 'Pending').length, All: rows.length };
  });

  ngOnInit() { this.loadChanges(); }

  loadChanges() {
    this.api.changeRequests().subscribe({
      next: (rows) => { this.changeRows.set(rows || []); this.pendingCount.emit(this.changeCounts().Pending); },
      error: () => this.changeRows.set([]),
    });
  }

  initials(p: { firstName?: string; lastName?: string }): string {
    return ((p.firstName || '?').charAt(0) + (p.lastName || '').charAt(0)).toUpperCase();
  }

  /** A steady colour per person for initials avatars. */
  avatarBg(p: { id?: number; firstName?: string }): string {
    const hues = [221, 262, 199, 160, 24, 340, 45, 290];
    return `hsl(${hues[(p.id ?? (p.firstName || 'x').charCodeAt(0)) % hues.length]} 65% 45%)`;
  }

  teamNames(c: FieldVisitChangeRow): string {
    return c.team.map((m) => `${m.firstName} ${m.lastName}`.trim()).join(', ');
  }

  dayCount(r: { startDate: string; endDate: string }): number {
    return Math.round((+new Date(r.endDate) - +new Date(r.startDate)) / 86_400_000) + 1;
  }

  waitedFor(iso: string): string {
    const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
    return h < 1 ? 'just now' : h < 24 ? `${h}h waiting` : `${Math.floor(h / 24)}d waiting`;
  }

  private messageOf(err: any): string {
    const m = err?.error?.message;
    return Array.isArray(m) ? m[0] : m || 'Something went wrong';
  }

  approveChange(c: FieldVisitChangeRow) {
    this.changeBusy.set(c.id);
    this.api.approveModification(c.requestId).subscribe({
      next: () => { this.changeBusy.set(null); this.toast.success(`${c.type} approved for ${c.requestNumber}`); this.loadChanges(); this.decided.emit(); },
      error: (err) => { this.changeBusy.set(null); this.toast.error(this.messageOf(err)); },
    });
  }

  rejectChange(c: FieldVisitChangeRow) {
    const reason = this.rejectChangeText.trim();
    if (!reason) { this.toast.error('Say why the change is rejected.'); return; }
    this.changeBusy.set(c.id);
    this.api.rejectModification(c.requestId, reason).subscribe({
      next: () => {
        this.changeBusy.set(null); this.rejectingChange.set(null); this.rejectChangeText = '';
        this.toast.success(`${c.type} rejected for ${c.requestNumber}`); this.loadChanges(); this.decided.emit();
      },
      error: (err) => { this.changeBusy.set(null); this.toast.error(this.messageOf(err)); },
    });
  }
}
